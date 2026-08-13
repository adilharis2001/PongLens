-- 108: Recollect becomes topics.
--
-- The question-and-answer card is gone. See
-- docs/superpowers/specs/2026-08-13-recollect-topics-design.md: generating a
-- recall question over coaching speech forces the model to invent the
-- situation the question turns on, and that invented precision is what made
-- every card read as fake.
--
-- The replacement reads what the journal already distilled. lessons.takeaways
-- holds { title, themes: [{ name, points[] }] } — topic to bullets — written
-- by /api/lesson under a contract that forbids inventing advice. Recollect
-- now sorts those points onto a closed list of topics and never touches the
-- raw speech-to-text again.

-- Derived data only. The journal itself is untouched by this migration.
drop trigger if exists recollect_source_delete_orphan on public.recollect_item_sources;
drop function if exists public.delete_orphan_recollect_item();
drop function if exists public.reveal_recollect_item(uuid, uuid, uuid, timestamptz);
drop function if exists public.add_recollect_to_working_on(uuid, uuid);
-- The old enqueue took a first_due_at. Replacing it leaves that overload
-- behind, still referencing tables this migration drops, and PostgREST would
-- have two candidates to resolve between.
drop function if exists public.enqueue_recollect_source(uuid, uuid, timestamptz, text);
-- Same signature, but its jsonb argument is points now rather than items,
-- and Postgres will not rename an input parameter in place.
drop function if exists public.complete_recollect_job(uuid, uuid, text, jsonb);
drop table if exists public.recollect_item_sources;
drop table if exists public.recollect_items;
drop table if exists public.recollect_jobs;

create table public.recollect_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Closed list. Free-form names drift ("Footwork & positioning",
  -- "Footwork & weight transfer", "Stance & balance" were three names for
  -- overlapping ground) and then nothing aggregates across lessons.
  topic_key text not null check (topic_key in (
    'serve', 'receive', 'forehand', 'backhand', 'footwork',
    'stance', 'transitions', 'tactics', 'practice', 'mental'
  )),
  last_reviewed_at timestamptz,
  review_count integer not null default 0 check (review_count >= 0),
  last_review_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, topic_key)
);

create table public.recollect_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic_id uuid not null references public.recollect_topics (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  -- Copied from the source, never rewritten. The distillation contract
  -- already produced short second-person sentences from things actually
  -- said; rephrasing them is another chance to drift.
  text text not null check (char_length(btrim(text)) between 1 and 400),
  theme_name text check (char_length(theme_name) <= 120),
  state text not null default 'active' check (state in ('active', 'dismissed')),
  last_shown_at timestamptz,
  focus_point_id uuid references public.focus_points (id) on delete set null,
  processor_version text not null
    check (char_length(processor_version) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recollect_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  content_hash text not null check (char_length(content_hash) = 64),
  processor_version text not null
    check (char_length(processor_version) between 1 and 40),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  accepted_count integer check (accepted_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, content_hash, processor_version)
);

create index recollect_topics_queue_idx
  on public.recollect_topics (user_id, last_reviewed_at nulls first);
create index recollect_points_topic_idx
  on public.recollect_points (topic_id, state, last_shown_at nulls first);
create index recollect_points_lesson_idx
  on public.recollect_points (lesson_id);
create unique index recollect_points_focus_point_idx
  on public.recollect_points (focus_point_id)
  where focus_point_id is not null;
create index recollect_jobs_claim_idx
  on public.recollect_jobs (user_id, status, available_at);

alter table public.recollect_topics enable row level security;
alter table public.recollect_points enable row level security;
alter table public.recollect_jobs enable row level security;

create policy "Owners read own Recollect topics"
  on public.recollect_topics for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners read own Recollect points"
  on public.recollect_points for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.recollect_topics from anon, authenticated;
revoke all on public.recollect_points from anon, authenticated;
revoke all on public.recollect_jobs from anon, authenticated;
grant select on public.recollect_topics to authenticated;
grant select on public.recollect_points to authenticated;

-- Queue one eligible entry. Re-saving an entry replaces the points it
-- contributed rather than adding a second copy of them.
create or replace function public.enqueue_recollect_source(
  p_owner_id uuid,
  p_lesson_id uuid,
  p_processor_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.lessons%rowtype;
  v_hash text;
  v_job public.recollect_jobs%rowtype;
begin
  if p_owner_id is null
     or p_lesson_id is null
     or char_length(coalesce(p_processor_version, '')) not between 1 and 40 then
    raise exception 'invalid Recollect source' using errcode = '22023';
  end if;

  select * into v_lesson
  from public.lessons
  where id = p_lesson_id and user_id = p_owner_id
  for update;
  if not found then
    raise exception 'lesson not found' using errcode = 'P0002';
  end if;
  if v_lesson.kind not in ('lesson', 'practice') then
    return jsonb_build_object('queued', false);
  end if;
  if exists (
    select 1 from public.recollect_preferences
    where user_id = p_owner_id and not enabled
  ) then
    return jsonb_build_object('queued', false);
  end if;

  -- No takeaways and not short means the entry was never distilled: the
  -- writer opted out of condensing, the text was off topic, or distillation
  -- failed. Recollect reads distilled text or a note short enough to read
  -- whole; it must never fall back to a long raw transcript, which is the
  -- speech-to-text soup the old design drowned in. MIN_DISTILL_CHARS in
  -- /api/lesson is the same 600.
  if v_lesson.takeaways is null
     and char_length(coalesce(v_lesson.transcript, '')) >= 600 then
    return jsonb_build_object('queued', false);
  end if;

  -- Hash the distilled takeaways when they exist, because that is what the
  -- processor reads. A transcript edit that leaves takeaways identical has
  -- nothing new to sort.
  v_hash := encode(
    extensions.digest(
      convert_to(
        coalesce(v_lesson.takeaways::text, v_lesson.transcript, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select * into v_job
  from public.recollect_jobs
  where lesson_id = p_lesson_id
    and content_hash = v_hash
    and processor_version = p_processor_version;
  if found then
    return jsonb_build_object(
      'queued', v_job.status in ('queued', 'processing', 'failed'),
      'job_id', v_job.id,
      'status', v_job.status
    );
  end if;

  delete from public.recollect_jobs where lesson_id = p_lesson_id;
  delete from public.recollect_points where lesson_id = p_lesson_id;

  insert into public.recollect_jobs (
    user_id, lesson_id, content_hash, processor_version
  ) values (p_owner_id, p_lesson_id, v_hash, p_processor_version)
  returning * into v_job;

  return jsonb_build_object(
    'queued', true, 'job_id', v_job.id, 'status', v_job.status
  );
end;
$$;

create or replace function public.claim_recollect_job(p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.recollect_jobs%rowtype;
  v_lesson public.lessons%rowtype;
begin
  select * into v_job
  from public.recollect_jobs
  where user_id = p_owner_id
    and attempt_count < 4
    and (
      (status in ('queued', 'failed') and available_at <= now())
      or (status = 'processing' and locked_at < now() - interval '10 minutes')
    )
  order by available_at, created_at
  for update skip locked
  limit 1;

  if not found then return null; end if;

  select * into v_lesson
  from public.lessons
  where id = v_job.lesson_id and user_id = p_owner_id;
  if not found then
    delete from public.recollect_jobs where id = v_job.id;
    return null;
  end if;

  update public.recollect_jobs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      last_error = null,
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return jsonb_build_object(
    'id', v_job.id,
    'user_id', v_job.user_id,
    'lesson_id', v_job.lesson_id,
    'content_hash', v_job.content_hash,
    'processor_version', v_job.processor_version,
    'attempt_count', v_job.attempt_count,
    -- Takeaways when the entry was distilled, the raw body when it was too
    -- short to need distilling. Never a long transcript.
    'takeaways', v_lesson.takeaways,
    'body', case
      when v_lesson.takeaways is null then left(v_lesson.transcript, 4000)
      else null
    end,
    'kind', v_lesson.kind
  );
end;
$$;

-- Store the sorted points. p_points is
-- [{ topic_key, text, theme_name, duplicate: boolean }]
create or replace function public.complete_recollect_job(
  p_owner_id uuid,
  p_job_id uuid,
  p_content_hash text,
  p_points jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.recollect_jobs%rowtype;
  v_entry jsonb;
  v_topic_id uuid;
  v_count integer := 0;
  v_current_hash text;
begin
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 60 then
    raise exception 'invalid Recollect points' using errcode = '22023';
  end if;

  select * into v_job from public.recollect_jobs
  where id = p_job_id and user_id = p_owner_id
  for update;
  if not found or v_job.status <> 'processing'
     or v_job.content_hash <> p_content_hash then
    return jsonb_build_object('stored', false, 'reason', 'stale_job');
  end if;
  if exists (
    select 1 from public.recollect_preferences
    where user_id = p_owner_id and not enabled
  ) then
    delete from public.recollect_jobs where id = p_job_id;
    return jsonb_build_object('stored', false, 'reason', 'disabled');
  end if;

  select encode(
    extensions.digest(
      convert_to(coalesce(l.takeaways::text, l.transcript, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) into v_current_hash
  from public.lessons l
  where l.id = v_job.lesson_id and l.user_id = p_owner_id;
  if v_current_hash is null or v_current_hash <> p_content_hash then
    delete from public.recollect_jobs where id = p_job_id;
    return jsonb_build_object('stored', false, 'reason', 'source_changed');
  end if;

  for v_entry in select value from jsonb_array_elements(p_points)
  loop
    if coalesce((v_entry ->> 'duplicate')::boolean, false) then
      continue;
    end if;

    insert into public.recollect_topics (user_id, topic_key)
    values (p_owner_id, v_entry ->> 'topic_key')
    on conflict (user_id, topic_key) do update
      set updated_at = now()
    returning id into v_topic_id;

    insert into public.recollect_points (
      user_id, topic_id, lesson_id, text, theme_name, processor_version
    ) values (
      p_owner_id,
      v_topic_id,
      v_job.lesson_id,
      left(btrim(v_entry ->> 'text'), 400),
      left(nullif(btrim(coalesce(v_entry ->> 'theme_name', '')), ''), 120),
      v_job.processor_version
    );
    v_count := v_count + 1;
  end loop;

  update public.recollect_jobs
  set status = 'complete',
      accepted_count = v_count,
      locked_at = null,
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('stored', true, 'accepted_count', v_count);
end;
$$;

-- Opening a topic IS the review: it stamps the topic, which drops it to the
-- bottom of the queue, and stamps the points it showed so the next visit
-- rotates to the ones behind them. Re-opening within the same view returns
-- the same points without reordering anything twice.
create or replace function public.open_recollect_topic(
  p_owner_id uuid,
  p_topic_id uuid,
  p_review_key uuid,
  p_limit integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic public.recollect_topics%rowtype;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_ids uuid[];
begin
  select * into v_topic
  from public.recollect_topics
  where id = p_topic_id and user_id = p_owner_id
  for update;
  if not found then
    raise exception 'topic not found' using errcode = 'P0002';
  end if;

  if v_topic.last_review_key is not distinct from p_review_key then
    select array_agg(id) into v_ids
    from public.recollect_points
    where topic_id = v_topic.id and state = 'active'
      and last_shown_at = v_topic.last_reviewed_at;
  else
    select array_agg(id) into v_ids
    from (
      select id from public.recollect_points
      where topic_id = v_topic.id and state = 'active'
      order by last_shown_at asc nulls first, created_at desc
      limit v_limit
    ) chosen;

    update public.recollect_points
    set last_shown_at = p_now, updated_at = now()
    where id = any(coalesce(v_ids, '{}'::uuid[]));

    update public.recollect_topics
    set last_reviewed_at = p_now,
        review_count = review_count + 1,
        last_review_key = p_review_key,
        updated_at = now()
    where id = v_topic.id;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'text', p.text,
        'inWorkingOn', p.focus_point_id is not null,
        'source', jsonb_build_object(
          'lessonId', l.id,
          'kind', l.kind,
          'createdAt', l.created_at,
          'title', l.takeaways ->> 'title'
        )
      )
      order by l.created_at desc, p.created_at
    )
    from public.recollect_points p
    join public.lessons l on l.id = p.lesson_id
    where p.id = any(coalesce(v_ids, '{}'::uuid[]))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.dismiss_recollect_point(
  p_owner_id uuid,
  p_point_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found uuid;
begin
  update public.recollect_points
  set state = 'dismissed', updated_at = now()
  where id = p_point_id and user_id = p_owner_id and state = 'active'
  returning id into v_found;
  if v_found is null then
    raise exception 'point not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('dismissed', true);
end;
$$;

create or replace function public.add_recollect_point_to_working_on(
  p_owner_id uuid,
  p_point_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_point public.recollect_points%rowtype;
  v_focus public.focus_points%rowtype;
  v_active integer;
begin
  select * into v_point
  from public.recollect_points
  where id = p_point_id and user_id = p_owner_id and state = 'active'
  for update;
  if not found then
    raise exception 'point not found' using errcode = 'P0002';
  end if;

  if v_point.focus_point_id is not null and exists (
    select 1 from public.focus_points
    where id = v_point.focus_point_id and user_id = p_owner_id
      and retired_at is null
  ) then
    return jsonb_build_object('result', 'duplicate');
  end if;

  select * into v_focus
  from public.focus_points
  where user_id = p_owner_id
    and retired_at is null
    and lower(btrim(label)) = lower(btrim(v_point.text))
  limit 1;
  if found then
    update public.recollect_points
    set focus_point_id = v_focus.id, updated_at = now()
    where id = v_point.id;
    return jsonb_build_object(
      'result', 'duplicate', 'focus_point', to_jsonb(v_focus)
    );
  end if;

  select count(*) into v_active
  from public.focus_points
  where user_id = p_owner_id and retired_at is null;
  if v_active >= 5 then
    return jsonb_build_object('result', 'full');
  end if;

  insert into public.focus_points (user_id, label)
  values (p_owner_id, left(v_point.text, 120))
  returning * into v_focus;
  update public.recollect_points
  set focus_point_id = v_focus.id, updated_at = now()
  where id = v_point.id;
  return jsonb_build_object('result', 'added', 'focus_point', to_jsonb(v_focus));
end;
$$;

create or replace function public.set_recollect_enabled(
  p_owner_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_disabled boolean := false;
  v_queued integer := 0;
begin
  select not enabled into v_was_disabled
  from public.recollect_preferences
  where user_id = p_owner_id;
  v_was_disabled := coalesce(v_was_disabled, false);

  insert into public.recollect_preferences (user_id, enabled, updated_at)
  values (p_owner_id, p_enabled, now())
  on conflict (user_id) do update
  set enabled = excluded.enabled, updated_at = now();

  if not p_enabled then
    delete from public.recollect_jobs where user_id = p_owner_id;
    delete from public.recollect_points where user_id = p_owner_id;
    delete from public.recollect_topics where user_id = p_owner_id;
    return jsonb_build_object('enabled', false, 'queued', 0);
  end if;

  if v_was_disabled then
    insert into public.recollect_jobs (
      user_id, lesson_id, content_hash, processor_version
    )
    select
      l.user_id,
      l.id,
      encode(
        extensions.digest(
          convert_to(coalesce(l.takeaways::text, l.transcript, ''), 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      'recollect-topics-v1'
    from public.lessons l
    where l.user_id = p_owner_id and l.kind in ('lesson', 'practice')
    on conflict (lesson_id, content_hash, processor_version) do nothing;
    get diagnostics v_queued = row_count;
  end if;

  return jsonb_build_object('enabled', true, 'queued', v_queued);
end;
$$;

-- A retired or deleted focus point releases its point. There is no schedule
-- to resume onto any more: the point simply rejoins its topic's rotation.
create or replace function public.resume_recollect_after_focus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.recollect_points
    set focus_point_id = null, updated_at = now()
    where focus_point_id = old.id and user_id = old.user_id;
    return old;
  end if;
  if old.retired_at is null and new.retired_at is not null then
    update public.recollect_points
    set focus_point_id = null, updated_at = now()
    where focus_point_id = new.id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.enqueue_recollect_source(uuid, uuid, text) from public;
revoke execute on function public.claim_recollect_job(uuid) from public;
revoke execute on function public.complete_recollect_job(uuid, uuid, text, jsonb) from public;
revoke execute on function public.open_recollect_topic(uuid, uuid, uuid, integer, timestamptz) from public;
revoke execute on function public.dismiss_recollect_point(uuid, uuid) from public;
revoke execute on function public.add_recollect_point_to_working_on(uuid, uuid) from public;
revoke execute on function public.set_recollect_enabled(uuid, boolean) from public;

grant execute on function public.enqueue_recollect_source(uuid, uuid, text) to service_role;
grant execute on function public.claim_recollect_job(uuid) to service_role;
grant execute on function public.complete_recollect_job(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.open_recollect_topic(uuid, uuid, uuid, integer, timestamptz) to service_role;
grant execute on function public.dismiss_recollect_point(uuid, uuid) to service_role;
grant execute on function public.add_recollect_point_to_working_on(uuid, uuid) to service_role;
grant execute on function public.set_recollect_enabled(uuid, boolean) to service_role;
