-- 057: Recollect — private, source-grounded spaced reminders for Journal.
--
-- Raw lesson/practice text remains in public.lessons. Recollect stores only
-- concise accepted prompts/cues, scheduling state, and source provenance.
-- Writes are service-role only; authenticated users reach them through
-- owner-verifying application routes.

create extension if not exists pgcrypto with schema extensions;

create table public.recollect_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  notice_seen_at timestamptz,
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
  next_segment integer not null default 0 check (next_segment >= 0),
  candidate_buffer jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidate_buffer) = 'array'),
  first_due_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  accepted_count integer check (accepted_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, content_hash, processor_version)
);

create table public.recollect_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null
    check (char_length(btrim(question)) between 1 and 240),
  cue text not null check (char_length(btrim(cue)) between 1 and 400),
  topic_key text not null
    check (char_length(topic_key) between 1 and 120),
  category text not null check (category in (
    'technique', 'tactics', 'positioning', 'serve_receive', 'practice', 'mental'
  )),
  priority numeric not null default 0.5 check (priority between 0 and 1),
  source_frequency integer not null default 1 check (source_frequency > 0),
  state text not null default 'active'
    check (state in ('active', 'dismissed')),
  schedule_step integer not null default 0 check (schedule_step >= 0),
  next_due_at timestamptz not null,
  last_revealed_at timestamptz,
  last_review_key uuid,
  focus_point_id uuid references public.focus_points (id) on delete set null,
  processor_version text not null
    check (char_length(processor_version) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recollect_item_sources (
  item_id uuid not null references public.recollect_items (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  segment_start integer not null check (segment_start >= 0),
  segment_end integer not null check (segment_end >= segment_start),
  evidence_hash text not null check (char_length(evidence_hash) = 64),
  created_at timestamptz not null default now(),
  primary key (item_id, lesson_id)
);

create index recollect_jobs_claim_idx
  on public.recollect_jobs (user_id, status, available_at);
create index recollect_items_due_idx
  on public.recollect_items (user_id, state, next_due_at);
create index recollect_items_topic_idx
  on public.recollect_items (user_id, topic_key);
create unique index recollect_items_focus_point_idx
  on public.recollect_items (focus_point_id)
  where focus_point_id is not null;
create index recollect_item_sources_lesson_idx
  on public.recollect_item_sources (lesson_id);

alter table public.recollect_preferences enable row level security;
alter table public.recollect_jobs enable row level security;
alter table public.recollect_items enable row level security;
alter table public.recollect_item_sources enable row level security;

create policy "Owners read own Recollect preference"
  on public.recollect_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners read own Recollect items"
  on public.recollect_items for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners read own Recollect sources"
  on public.recollect_item_sources for select to authenticated
  using (
    exists (
      select 1 from public.recollect_items i
      where i.id = recollect_item_sources.item_id
        and i.user_id = (select auth.uid())
    )
  );

revoke all on public.recollect_preferences from anon, authenticated;
revoke all on public.recollect_jobs from anon, authenticated;
revoke all on public.recollect_items from anon, authenticated;
revoke all on public.recollect_item_sources from anon, authenticated;
grant select on public.recollect_preferences to authenticated;
grant select on public.recollect_items to authenticated;
grant select on public.recollect_item_sources to authenticated;

create or replace function public.enqueue_recollect_source(
  p_owner_id uuid,
  p_lesson_id uuid,
  p_first_due_at timestamptz,
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

  v_hash := encode(
    extensions.digest(convert_to(v_lesson.transcript, 'UTF8'), 'sha256'),
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
  delete from public.recollect_item_sources where lesson_id = p_lesson_id;
  delete from public.recollect_items i
  where i.user_id = p_owner_id
    and not exists (
      select 1 from public.recollect_item_sources s where s.item_id = i.id
    );

  insert into public.recollect_jobs (
    user_id, lesson_id, content_hash, processor_version, first_due_at
  ) values (
    p_owner_id,
    p_lesson_id,
    v_hash,
    p_processor_version,
    coalesce(p_first_due_at, v_lesson.created_at + interval '1 day')
  )
  returning * into v_job;

  return jsonb_build_object(
    'queued', true,
    'job_id', v_job.id,
    'status', v_job.status
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
    'next_segment', v_job.next_segment,
    'candidate_buffer', v_job.candidate_buffer,
    'first_due_at', v_job.first_due_at,
    'attempt_count', v_job.attempt_count,
    'transcript', v_lesson.transcript,
    'kind', v_lesson.kind,
    'source_created_at', v_lesson.created_at,
    'source_title', v_lesson.takeaways ->> 'title'
  );
end;
$$;

create or replace function public.complete_recollect_job(
  p_owner_id uuid,
  p_job_id uuid,
  p_content_hash text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.recollect_jobs%rowtype;
  v_entry jsonb;
  v_item_id uuid;
  v_duplicate uuid;
  v_count integer := 0;
  v_current_hash text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid Recollect items' using errcode = '22023';
  end if;

  select * into v_job from public.recollect_jobs
  where id = p_job_id and user_id = p_owner_id
  for update;
  if not found or v_job.status <> 'processing' or v_job.content_hash <> p_content_hash then
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
    extensions.digest(convert_to(l.transcript, 'UTF8'), 'sha256'),
    'hex'
  ) into v_current_hash
  from public.lessons l
  where l.id = v_job.lesson_id and l.user_id = p_owner_id;
  if v_current_hash is null or v_current_hash <> p_content_hash then
    delete from public.recollect_jobs where id = p_job_id;
    return jsonb_build_object('stored', false, 'reason', 'source_changed');
  end if;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    v_item_id := null;
    v_duplicate := nullif(v_entry ->> 'duplicate_of', '')::uuid;
    if v_duplicate is not null then
      update public.recollect_items
      set source_frequency = source_frequency + 1,
          priority = greatest(priority, (v_entry ->> 'priority')::numeric),
          updated_at = now()
      where id = v_duplicate and user_id = p_owner_id and state = 'active'
      returning id into v_item_id;
    else
      insert into public.recollect_items (
        user_id, question, cue, topic_key, category, priority,
        next_due_at, processor_version
      ) values (
        p_owner_id,
        left(btrim(v_entry ->> 'question'), 240),
        left(btrim(v_entry ->> 'cue'), 400),
        left(btrim(v_entry ->> 'topic_key'), 120),
        v_entry ->> 'category',
        least(1, greatest(0, (v_entry ->> 'priority')::numeric)),
        v_job.first_due_at,
        v_job.processor_version
      )
      returning id into v_item_id;
    end if;

    if v_item_id is not null then
      insert into public.recollect_item_sources (
        item_id, lesson_id, segment_start, segment_end, evidence_hash
      ) values (
        v_item_id,
        v_job.lesson_id,
        (v_entry ->> 'segment_start')::integer,
        (v_entry ->> 'segment_end')::integer,
        v_entry ->> 'evidence_hash'
      )
      on conflict (item_id, lesson_id) do nothing;
      v_count := v_count + 1;
    end if;
  end loop;

  update public.recollect_jobs
  set status = 'complete',
      accepted_count = v_count,
      candidate_buffer = '[]'::jsonb,
      locked_at = null,
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object('stored', true, 'accepted_count', v_count);
end;
$$;

create or replace function public.reveal_recollect_item(
  p_owner_id uuid,
  p_item_id uuid,
  p_review_key uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.recollect_items%rowtype;
  v_source record;
  v_delay interval;
begin
  select * into v_item
  from public.recollect_items
  where id = p_item_id and user_id = p_owner_id and state = 'active'
  for update;
  if not found then
    raise exception 'reminder not found' using errcode = 'P0002';
  end if;

  select l.id, l.kind, l.created_at, l.takeaways ->> 'title' as title
  into v_source
  from public.recollect_item_sources s
  join public.lessons l on l.id = s.lesson_id
  where s.item_id = v_item.id and l.user_id = p_owner_id
  order by l.created_at desc
  limit 1;

  if v_item.last_review_key = p_review_key then
    return jsonb_build_object(
      'cue', v_item.cue,
      'source', jsonb_build_object(
        'lessonId', v_source.id,
        'kind', v_source.kind,
        'createdAt', v_source.created_at,
        'title', v_source.title
      )
    );
  end if;

  v_delay := case v_item.schedule_step
    when 0 then interval '3 days'
    when 1 then interval '7 days'
    when 2 then interval '14 days'
    when 3 then interval '30 days'
    else interval '60 days'
  end;

  update public.recollect_items
  set schedule_step = schedule_step + 1,
      next_due_at = p_now + v_delay,
      last_revealed_at = p_now,
      last_review_key = p_review_key,
      updated_at = now()
  where id = v_item.id;

  return jsonb_build_object(
    'cue', v_item.cue,
    'source', jsonb_build_object(
      'lessonId', v_source.id,
      'kind', v_source.kind,
      'createdAt', v_source.created_at,
      'title', v_source.title
    )
  );
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
    delete from public.recollect_items where user_id = p_owner_id;
    return jsonb_build_object('enabled', false, 'queued', 0);
  end if;

  if v_was_disabled then
    insert into public.recollect_jobs (
      user_id, lesson_id, content_hash, processor_version, first_due_at
    )
    select
      l.user_id,
      l.id,
      encode(
        extensions.digest(convert_to(l.transcript, 'UTF8'), 'sha256'),
        'hex'
      ),
      'recollect-v2',
      now() + interval '1 day'
    from public.lessons l
    where l.user_id = p_owner_id and l.kind in ('lesson', 'practice')
    on conflict (lesson_id, content_hash, processor_version) do nothing;
    get diagnostics v_queued = row_count;
  end if;

  return jsonb_build_object('enabled', true, 'queued', v_queued);
end;
$$;

create or replace function public.add_recollect_to_working_on(
  p_owner_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.recollect_items%rowtype;
  v_focus public.focus_points%rowtype;
  v_active integer;
begin
  select * into v_item
  from public.recollect_items
  where id = p_item_id and user_id = p_owner_id and state = 'active'
  for update;
  if not found then
    raise exception 'reminder not found' using errcode = 'P0002';
  end if;

  if v_item.focus_point_id is not null and exists (
    select 1 from public.focus_points
    where id = v_item.focus_point_id and user_id = p_owner_id
      and retired_at is null
  ) then
    return jsonb_build_object('result', 'duplicate');
  end if;

  select * into v_focus
  from public.focus_points
  where user_id = p_owner_id
    and retired_at is null
    and lower(btrim(label)) = lower(btrim(v_item.cue))
  limit 1;
  if found then
    update public.recollect_items
    set focus_point_id = v_focus.id, updated_at = now()
    where id = v_item.id;
    return jsonb_build_object('result', 'duplicate', 'focus_point', to_jsonb(v_focus));
  end if;

  select count(*) into v_active
  from public.focus_points
  where user_id = p_owner_id and retired_at is null;
  if v_active >= 5 then
    return jsonb_build_object('result', 'full');
  end if;

  insert into public.focus_points (user_id, label)
  values (p_owner_id, left(v_item.cue, 120))
  returning * into v_focus;
  update public.recollect_items
  set focus_point_id = v_focus.id, updated_at = now()
  where id = v_item.id;
  return jsonb_build_object('result', 'added', 'focus_point', to_jsonb(v_focus));
end;
$$;

create or replace function public.resume_recollect_after_focus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.recollect_items
    set focus_point_id = null,
        next_due_at = greatest(next_due_at, now() + interval '7 days'),
        updated_at = now()
    where focus_point_id = old.id and user_id = old.user_id;
    return old;
  end if;
  if old.retired_at is null and new.retired_at is not null then
    update public.recollect_items
    set focus_point_id = null,
        next_due_at = greatest(next_due_at, new.retired_at + interval '7 days'),
        updated_at = now()
    where focus_point_id = new.id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger focus_points_resume_recollect_update
after update of retired_at on public.focus_points
for each row execute function public.resume_recollect_after_focus();

create trigger focus_points_resume_recollect_delete
before delete on public.focus_points
for each row execute function public.resume_recollect_after_focus();

create or replace function public.delete_orphan_recollect_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.recollect_items i
  where i.id = old.item_id
    and not exists (
      select 1 from public.recollect_item_sources s where s.item_id = i.id
    );
  return old;
end;
$$;

create trigger recollect_source_delete_orphan
after delete on public.recollect_item_sources
for each row execute function public.delete_orphan_recollect_item();

revoke execute on function public.enqueue_recollect_source(
  uuid, uuid, timestamptz, text
) from public;
revoke execute on function public.claim_recollect_job(uuid) from public;
revoke execute on function public.complete_recollect_job(
  uuid, uuid, text, jsonb
) from public;
revoke execute on function public.reveal_recollect_item(
  uuid, uuid, uuid, timestamptz
) from public;
revoke execute on function public.set_recollect_enabled(uuid, boolean)
  from public;
revoke execute on function public.add_recollect_to_working_on(uuid, uuid)
  from public;

grant execute on function public.enqueue_recollect_source(
  uuid, uuid, timestamptz, text
) to service_role;
grant execute on function public.claim_recollect_job(uuid) to service_role;
grant execute on function public.complete_recollect_job(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.reveal_recollect_item(
  uuid, uuid, uuid, timestamptz
) to service_role;
grant execute on function public.set_recollect_enabled(uuid, boolean)
  to service_role;
grant execute on function public.add_recollect_to_working_on(uuid, uuid)
  to service_role;
