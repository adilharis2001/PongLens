-- Mark the points: cutting a match by hand.
--
-- A second way for points to exist. Until now every points row was made by
-- the worker from a tracked ball; after this some are made by a person
-- watching their own upload and tapping twice per rally. The marks live
-- here as the player's scratch work until they submit, and the worker turns
-- them into a normal cut match.
--
-- Design: docs/superpowers/specs/2026-09-07-hand-cut-design.md
-- How it fits the rest: docs/research/2026-09-08-hand-cut-integration.md
--
-- Numbered above the live head (20260908120318) so `db push` orders it
-- last; the checkout it was written in was behind the database.

-- ---------------------------------------------------------------- matches

alter table public.matches
  add column if not exists cut_source text not null default 'auto'
  check (cut_source in ('auto', 'manual'));

comment on column public.matches.cut_source is
  'manual means the points on this match were marked by its owner rather '
  'than found by the detector. The worker refuses to delete points on such '
  'a match, match_reprocess_source answers null for it, and the placement '
  'and highlights surfaces do not offer themselves. No client grant: only '
  'claim_hand_cut and the worker write it.';

-- No grant. matches update grants are column-scoped and this is not in one.

-- ----------------------------------------------------------- rollout gate
--
-- Same grammar as automatic_highlights: 'on', 'user:<id>' or
-- 'users:<id>,<id>'. Admins always pass, the way match_reprocessing_enabled
-- treats them, so the feature can be tried on production before anyone
-- else sees it. Read through the function below, never from the client:
-- the key is not on the public allow-list and does not need to be.

insert into public.app_config (key, value) values ('hand_cut', 'off')
on conflict (key) do nothing;

create or replace function public.hand_cut_enabled(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
      from public.app_config c
     where c.key = 'hand_cut'
       and (c.value = 'on'
            or c.value = 'user:' || p_user::text
            or (c.value like 'users:%'
                and p_user::text = any (string_to_array(
                      replace(substr(c.value, 7), ' ', ''), ','))))
  );
$$;

revoke all on function public.hand_cut_enabled(uuid) from public, anon;
grant execute on function public.hand_cut_enabled(uuid) to authenticated;

-- ------------------------------------------------------------ the drafts

-- One row per match, holding the whole marks array. A row per mark would
-- turn undo into a delete and create a merge problem across devices for no
-- benefit: 400 marks is about 16KB.
create table if not exists public.hand_cut_drafts (
  match_id     uuid primary key references public.matches (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  marks        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now(),
  -- Set by claim_hand_cut only. Once set, the update policy below freezes
  -- the row: the worker must read the same set the player agreed to, not
  -- one they kept editing while it ran. The worker clears it again when a
  -- cut fails for good, which is what hands the marks back.
  submitted_at timestamptz
);

alter table public.hand_cut_drafts enable row level security;

create policy "own hand cut drafts readable" on public.hand_cut_drafts
  for select using (user_id = (select auth.uid()));

create policy "own hand cut drafts insertable" on public.hand_cut_drafts
  for insert with check (user_id = (select auth.uid()));

create policy "own unsubmitted hand cut drafts updatable" on public.hand_cut_drafts
  for update using (user_id = (select auth.uid()) and submitted_at is null)
             with check (user_id = (select auth.uid()));

create policy "own unsubmitted hand cut drafts deletable" on public.hand_cut_drafts
  for delete using (user_id = (select auth.uid()) and submitted_at is null);

grant select, insert, delete on public.hand_cut_drafts to authenticated;
-- submitted_at is deliberately absent, so only the definer function sets it.
grant update (marks, updated_at) on public.hand_cut_drafts to authenticated;

-- The Mac worker signs in as postgres and owns this table. The Modal
-- backup lane signs in as ponglens_worker, which has explicit grants per
-- table and nothing else; give it the same two operations the worker
-- performs here. The role is created out of band, so this must not fail
-- where it does not exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'ponglens_worker') then
    grant select on public.hand_cut_drafts to ponglens_worker;
    grant update (submitted_at) on public.hand_cut_drafts to ponglens_worker;
  end if;
end $$;

comment on table public.hand_cut_drafts is
  'Marks a player has made while cutting a match by hand, in SOURCE '
  'seconds. Scratch work until claim_hand_cut freezes the row and queues '
  'the hand_cut job.';

-- ------------------------------------------------------------- the claim

create or replace function public.claim_hand_cut(
  p_match_id uuid,
  p_marks    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_job      uuid := gen_random_uuid();
  v_n        int;
  v_mark     jsonb;
  v_prev_t1  numeric := -1;
  v_t0       numeric;
  v_t1       numeric;
  v_active   int;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.hand_cut_enabled(v_me) then
    raise exception 'not_enabled' using errcode = '42501';
  end if;

  -- The row lock is the serialization point and comes before every other
  -- check, the same shape claim_processing uses: two taps must not be able
  -- to queue two jobs.
  select * into v_match
    from public.matches
   where id = p_match_id and user_id = v_me
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_match.status not in ('uploaded', 'failed') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  -- A cut already exists: this is a processed match, whatever its status.
  if v_match.cut_path is not null then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  if v_match.raw_path is null
     or v_match.raw_path not like 'r2://ponglens-raw/' || v_me::text || '/%' then
    raise exception 'no_source' using errcode = 'P0001';
  end if;

  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;

  -- The content gate deletes the raw object and nulls raw_path with no
  -- status guard, so marking must not start while it is still queued.
  if v_match.content_checked_at is null then
    raise exception 'check_pending' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.points where match_id = p_match_id) then
    raise exception 'already_cut' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.jobs
     where (options->>'match_id')::uuid = p_match_id
       and status in ('queued', 'processing')
  ) then
    raise exception 'already_processing' using errcode = 'P0001';
  end if;

  -- The same fairness cap claim_processing applies.
  select count(*) into v_active
    from public.jobs
   where user_id = v_me
     and status in ('queued', 'processing')
     and kind not in ('reclip', 'content_check');
  if v_active >= 4 then
    raise exception 'queue_full' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_marks) <> 'array' then
    raise exception 'invalid_marks' using errcode = '23514';
  end if;
  v_n := jsonb_array_length(p_marks);
  if v_n < 1 or v_n > 400 then
    raise exception 'invalid_marks' using errcode = '23514';
  end if;

  -- The client refuses the same bounds at the tap, so this is a backstop
  -- rather than a path a player can reach. Nothing is silently dropped:
  -- an invalid set is refused whole.
  for v_mark in select * from jsonb_array_elements(p_marks) loop
    v_t0 := (v_mark->>'t0')::numeric;
    v_t1 := (v_mark->>'t1')::numeric;
    if v_t0 is null or v_t1 is null
       or v_t0 < 0
       or v_t1 - v_t0 < 0.7
       or v_t1 - v_t0 > 180
       or v_t1 > v_match.duration_s + 1
       or v_t0 < v_prev_t1
       or (v_mark->>'w' is not null and v_mark->>'w' not in ('user', 'opponent'))
       or ((v_mark->>'let')::boolean and v_mark->>'w' is not null)
    then
      raise exception 'invalid_marks' using errcode = '23514';
    end if;
    v_prev_t1 := v_t1;
  end loop;

  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set marks = excluded.marks,
        submitted_at = now(),
        updated_at = now();

  -- The job carries what the worker's publish lock asks of every ordinary
  -- processing job: which processing version it belongs to and which job
  -- originated it (itself). An ordinary job gets these stamped when it is
  -- claimed; a hand cut has no claim step, so they are written here.
  -- matches.status is deliberately NOT moved: a job that dies leaves the
  -- match 'uploaded' and fully recoverable, and the raw page reads the
  -- job, not the status, to say that something is running.
  insert into public.jobs (id, user_id, kind, status, input_path,
                           original_name, options)
  values (v_job, v_me, 'hand_cut', 'queued', v_match.raw_path,
          v_match.original_name,
          jsonb_build_object(
            'match_id', p_match_id,
            'source', 'manual',
            'processing_version_id', v_match.active_processing_version_id,
            'originating_match_job_id', v_job));

  -- clip_pads is stamped here rather than left to a job lookup, because a
  -- hand-cut match has no strictness on a job to fall back to and
  -- match_pre_pad would otherwise guess. job_id links the match to its
  -- job the way an upload is linked to its processing job, which is what
  -- the publish lock checks and what the library's "processing" chip
  -- reads. The worker clears it again if the cut fails for good.
  update public.matches
     set cut_source = 'manual',
         clip_pads = '{"pre": 1.2, "post": 1.3}'::jsonb,
         job_id = v_job
   where id = p_match_id;

  return jsonb_build_object('job_id', v_job, 'points', v_n);
end;
$$;

revoke all on function public.claim_hand_cut(uuid, jsonb) from public, anon;
grant execute on function public.claim_hand_cut(uuid, jsonb) to authenticated;

-- ------------------------------------------- a failed cut rings the bell
--
-- Recreated from 066 (its only definition) with the hand_cut kind added.
-- The player is waiting on this job exactly as they wait on an upload, and
-- the email half lives in the worker beside the upload one.

create or replace function public.jobs_notify_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status or new.status <> 'failed' then
    return new;
  end if;
  -- ONLY the jobs a person is waiting on. reclip, placement and reel
  -- renders fail behind their own surfaces, which report themselves; a
  -- bell for each would be noise about work nobody asked about directly.
  if coalesce(new.kind, 'deadspace_cut')
     not in ('deadspace_cut', 'youtube_import', 'hand_cut') then
    return new;
  end if;
  if new.user_id is null then
    return new;
  end if;

  insert into public.notifications
    (user_id, kind, title, body, href)
  values (
    new.user_id,
    'upload_failed',
    case when new.kind = 'youtube_import' then 'Import failed'
         when new.kind = 'hand_cut' then 'Cut failed'
         else 'Upload failed' end,
    coalesce(nullif(btrim(new.user_message), ''),
             case when new.kind = 'hand_cut'
                  then 'We couldn''t finish cutting this match. Your marks are saved.'
                  else 'We couldn''t process this video.' end),
    case when new.kind = 'hand_cut' and (new.options ? 'match_id')
         then '/match/' || (new.options->>'match_id')
         else '/upload' end
  );
  return new;
end;
$$;

-- ---------------------------------------- reprocessing refuses a hand cut
--
-- One function answers "where is the original this match could be run
-- from again?" for the feedback sheet (canReprocess), the request trigger
-- and the admin's start button. Answering null for a hand-cut match closes
-- all three at once: an automatic run would replace every point the
-- player marked. Body otherwise verbatim from 20260907212000.

create or replace function public.match_reprocess_source(p_match_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.cut_source = 'manual' then null
    when m.raw_path ~ ('^r2://[^/]+/'||m.user_id::text||'/.+') then m.raw_path
    when j.user_id=m.user_id and j.input_path ~ ('^r2://[^/]+/'||m.user_id::text||'/.+') then j.input_path
    else null end
  from public.matches m left join public.jobs j on j.id=m.job_id where m.id=p_match_id
$$;

-- --------------------------------------------------- placement refusals
--
-- Both functions are recreated from their current definitions
-- (20260906174049_originals_are_kept.sql) with one condition added, so
-- the bodies cannot drift from what is live today.

create or replace function public.request_placement_retry(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.user_id <> auth.uid() then
    raise exception 'not owner' using errcode = '42501';
  end if;
  -- A hand-cut match has no ball track and no calibrated table, so there
  -- are no landings to draw. Refused here rather than only in the UI: the
  -- anon key is in the client bundle. A wrong map is worse than no map.
  if v_match.cut_source = 'manual' then
    raise exception 'placement unavailable for a hand-cut match'
      using errcode = 'P0001';
  end if;
  if v_match.placement_status = 'retrying' then
    raise exception 'placement retry already queued' using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'retry_available' then
    raise exception 'placement retry unavailable' using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement retry already used' using errcode = '23514';
  end if;
  -- A kept original (raw_path set) never expires. The deadline is only a
  -- legacy row's memory of the old 30-day clock.
  if v_match.raw_path is null
     and (v_match.placement_retry_expires_at is null
          or v_match.placement_retry_expires_at <= now()) then
    update public.matches
    set placement_status = 'final_failed',
        placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  -- The existing jobs_enqueue trigger sends this row to pgmq in the same
  -- transaction. If either write fails, neither the job nor lifecycle change
  -- is committed.
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'placement_retry', 'queued', null,
          'Placement retry',
          jsonb_build_object('match_id', p_match_id))
  returning id into v_job_id;

  update public.matches
  set placement_status = 'retrying',
      placement_retry_count = 1,
      placement_retry_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_retry(uuid) from public, anon;
grant execute on function public.request_placement_retry(uuid)
  to authenticated;

create or replace function public.request_placement_generation(
  p_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.user_id <> auth.uid() then
    raise exception 'not owner' using errcode = '42501';
  end if;
  -- A hand-cut match has no ball track and no calibrated table, so there
  -- are no landings to draw. Refused here rather than only in the UI: the
  -- anon key is in the client bundle. A wrong map is worse than no map.
  if v_match.cut_source = 'manual' then
    raise exception 'placement unavailable for a hand-cut match'
      using errcode = 'P0001';
  end if;
  if v_match.status <> 'ready' then
    raise exception 'match is not ready' using errcode = 'P0001';
  end if;
  if v_match.placement_status = 'processing'
     or v_match.placement_generation_job_id is not null then
    raise exception 'placement generation already queued'
      using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'not_requested' then
    raise exception 'placement generation unavailable'
      using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement generation already used'
      using errcode = '23514';
  end if;
  -- Same rule as request_placement_retry: a kept original never expires.
  if v_match.raw_path is null
     and (v_match.placement_retry_expires_at is null
          or v_match.placement_retry_expires_at <= now()) then
    update public.matches
    set placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  insert into public.jobs (
    user_id, kind, status, input_path, original_name, options
  )
  values (auth.uid(), 'placement_generate', 'queued', null,
    'Placement generation', jsonb_build_object('match_id', p_match_id)
  )
  returning id into v_job_id;

  update public.matches
  set placement_status = 'processing',
      placement_generation_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_generation(uuid)
  from public, anon;
grant execute on function public.request_placement_generation(uuid)
  to authenticated;
