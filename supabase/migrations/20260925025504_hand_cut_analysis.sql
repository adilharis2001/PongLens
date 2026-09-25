-- Detailed analysis and highlights for hand-marked matches.
-- Spec: docs/superpowers/specs/2026-09-24-ios-hand-cut-design.md, section 5.
--
-- DEPLOY ORDER MATTERS. Apply this only after the hand lane runs a sealed
-- release that carries the hand-cut placement and highlight code
-- (docs/research/2026-09-24-hand-cut-analysis/RELEASE-PLAN.md). The lane
-- live on 2026-09-24 (762ea2c0) would take these jobs and finish every
-- hand-cut placement as final_failed, spending the owner's one attempt.
--
-- 1. request_placement_generation / request_placement_retry: the hand-cut
--    refusal is gone. Everything else is the live definition (pulled with
--    pg_get_functiondef on 2026-09-24), unchanged.
-- 2. public.job_queue_name(kind, options): the one statement of which pgmq
--    queue a job goes to. enqueue_job sends by it, and cloud_worker_decision
--    asks it, so the two cannot drift. New: placement_generate,
--    placement_retry and the 'highlights' reel of a hand-cut match go to
--    'jobs_hand'. Every other job routes exactly as before.
-- 3. cloud_worker_decision(boolean): a job routed to 'jobs_hand' is never
--    work waiting. Before this only kind = 'hand_cut' was excluded, and a
--    queued hand-cut placement would have started a Modal run that finds
--    nothing it can read and still costs money.
--
-- Kept exactly: match_reprocess_source still answers null for a manual
-- match (reprocessing would delete the owner's own points), claim_hand_cut,
-- publish_hand_cut_v2 and normalize_manual_cut_observations are untouched.
--
-- Grants: CREATE OR REPLACE keeps each existing function's ACL, so the three
-- rewritten functions keep exactly their live grants:
--   request_placement_generation(uuid), request_placement_retry(uuid):
--     postgres, authenticated, service_role
--   enqueue_job(): postgres, service_role
--   cloud_worker_decision(boolean): postgres, anon, authenticated,
--     service_role (as live; not widened or narrowed here)
-- The new helper is private: service_role only.

-- ---------------------------------------------------------------------------
-- 1. Placement requests
-- ---------------------------------------------------------------------------
create or replace function public.request_placement_generation(p_match_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- A hand-cut match is analysed like any other since 20260924210000: the
  -- hand lane tracks the ball inside the marked points and finds the table
  -- with the same ladder. enqueue_job sends its job to 'jobs_hand'.
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
$function$;

create or replace function public.request_placement_retry(p_match_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- A hand-cut match may retry like any other since 20260924210000; its
  -- job goes to 'jobs_hand' (enqueue_job).
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. Which queue a job goes to
-- ---------------------------------------------------------------------------
-- Reclips and vertical share renders: 'jobs_fast' when app_config routes
-- them there. Hand cuts: 'jobs_hand'. Detailed analysis (generation and
-- retry) and the automatic highlights reel of a hand-cut match: 'jobs_hand',
-- so players' uploads never queue behind them and only the hand lane's
-- release, which carries the hand-cut rules, ever runs them. Everything
-- else: 'jobs'. The 'v:hl:*' variants of a highlights reel are vertical
-- re-renders of the finished reel and stay with the fast-lane rule.
create or replace function public.job_queue_name(p_kind text, p_options jsonb)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_lane text;
  v_match_id uuid;
begin
  if p_kind = 'reclip'
     or (p_kind = 'reel' and coalesce(p_options->>'scope', '') like 'v:%')
  then
    select value into v_lane from public.app_config where key = 'reclip_lane';
    if v_lane = 'fast' then
      return 'jobs_fast';
    end if;
    return 'jobs';
  end if;
  if p_kind = 'hand_cut' then
    return 'jobs_hand';
  end if;
  if p_kind in ('placement_generate', 'placement_retry')
     or (p_kind = 'reel' and p_options->>'scope' = 'highlights')
  then
    if coalesce(p_options->>'match_id', '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_match_id := (p_options->>'match_id')::uuid;
      if exists (
        select 1 from public.matches m
         where m.id = v_match_id and m.cut_source = 'manual'
      ) then
        return 'jobs_hand';
      end if;
    end if;
  end if;
  return 'jobs';
end;
$function$;

revoke all on function public.job_queue_name(text, jsonb) from public;
revoke all on function public.job_queue_name(text, jsonb) from anon, authenticated;
grant execute on function public.job_queue_name(text, jsonb) to service_role;

create or replace function public.enqueue_job()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pgmq'
as $function$
begin
  perform pgmq.send(
    public.job_queue_name(new.kind, new.options),
    jsonb_build_object(
      'job_id', new.id,
      'user_id', new.user_id,
      'kind', new.kind,
      'input_path', new.input_path,
      'options', new.options
    ),
    case when new.kind in ('deadspace_cut', 'youtube_import') then 60
         when new.kind = 'reclip' then 5
         else 0 end
  );
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The cloud backup never counts hand-lane work
-- ---------------------------------------------------------------------------
create or replace function public.cloud_worker_decision(p_claim boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c public.processing_control%rowtype;
  v_mac_beat timestamptz;
  v_mac_release text;
  v_cloud_beat timestamptz;
  v_oldest timestamptz;
  v_waiting integer := 0;
  v_stuck integer := 0;
  v_wait_s integer := 0;
  v_run boolean := false;
  v_reason text;
  v_mac_alive boolean;
  v_mac_silent boolean;
  v_cloud_alive boolean;
  v_session_recent boolean;
  v_release_match boolean;
  result jsonb;
begin
  select * into c from public.processing_control where singleton for update;
  if not found then
    return jsonb_build_object('mode', 'disabled', 'run', false, 'reason', 'no_control_row');
  end if;

  -- The Mac's match lanes. The hand lane and the lesson worker keep their
  -- own schedules and say nothing about whether uploads are being processed.
  select max(beat_at) into v_mac_beat
    from public.worker_pulse where host = 'mac' and lane in ('main', 'fast');
  select split_part(coalesce(code_version, ''), ' ', 2) into v_mac_release
    from public.worker_pulse where worker_id = 'mac:main';
  select max(beat_at) into v_cloud_beat
    from public.worker_pulse where host = 'modal';

  -- Work the cloud can do. Anything routed to the hand lane is the hand
  -- lane's alone (hand cuts, and since 20260924210000 a hand-cut match's
  -- detailed analysis and highlights): the cloud twin never reads that
  -- queue, so counting it would start a paid run with nothing to take.
  select count(*), min(created_at) into v_waiting, v_oldest
    from public.jobs
   where status = 'queued'
     and public.job_queue_name(kind, options) <> 'jobs_hand';
  -- A job the Mac was in the middle of when it went quiet. Nothing is
  -- pulsing for it and it has not moved; it will come back to the queue
  -- when its message reappears, and it counts as waiting from the moment
  -- the Mac stopped.
  select count(*) into v_stuck
    from public.jobs j
   where j.status = 'processing'
     and public.job_queue_name(j.kind, j.options) <> 'jobs_hand'
     and j.updated_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.worker_pulse p
        where p.job_id = j.id and p.beat_at > now() - interval '120 seconds');

  v_mac_alive := v_mac_beat is not null and v_mac_beat > now() - interval '120 seconds';
  v_mac_silent := v_mac_beat is null
    or v_mac_beat < now() - make_interval(secs => c.mac_stale_s);
  v_cloud_alive := v_cloud_beat is not null and v_cloud_beat > now() - interval '120 seconds';
  -- A cold start is slow: the container verifies and copies the sealed
  -- release for each lane before a worker can beat, five and a half
  -- minutes on 2026-09-16. The grace has to outlast that, or the dispatcher
  -- starts a second worker behind the first.
  v_session_recent := c.cloud_session_started_at is not null
    and c.cloud_session_started_at > now() - interval '12 minutes'
    and (c.cloud_session_ended_at is null or c.cloud_session_ended_at < c.cloud_session_started_at);
  v_release_match := c.cloud_mac_release_id is not null and v_mac_release = c.cloud_mac_release_id;
  v_wait_s := coalesce(extract(epoch from now() - v_oldest)::integer, 0);
  if v_stuck > 0 and v_mac_beat is not null then
    v_wait_s := greatest(v_wait_s, extract(epoch from now() - v_mac_beat)::integer);
  end if;

  if c.cloud_mode = 'disabled' then
    v_reason := 'disabled';
  elsif c.cloud_mac_release_id is null then
    v_reason := 'no_cloud_release';
  elsif v_cloud_alive or v_session_recent then
    v_reason := 'cloud_running';
  elsif c.cloud_mode = 'manual' then
    v_run := true;
    v_reason := 'manual';
  elsif not v_release_match then
    v_reason := 'release_mismatch';
  elsif not v_mac_silent then
    v_reason := 'mac_reporting';
  elsif v_waiting + v_stuck = 0 then
    v_reason := 'nothing_waiting';
  elsif v_wait_s < c.oldest_wait_s then
    v_reason := 'waiting_not_long_enough';
  else
    v_run := true;
    v_reason := 'mac_silent_work_waiting';
  end if;

  result := jsonb_build_object(
    'mode', c.cloud_mode,
    'run', v_run,
    'reason', v_reason,
    'claimed', v_run and p_claim,
    'checked_at', now(),
    'mac_last_beat_at', v_mac_beat,
    'mac_alive', v_mac_alive,
    'mac_silent', v_mac_silent,
    'mac_stale_s', c.mac_stale_s,
    'mac_release_id', nullif(v_mac_release, ''),
    'cloud_mac_release_id', c.cloud_mac_release_id,
    'release_match', v_release_match,
    'cloud_last_beat_at', v_cloud_beat,
    'cloud_alive', v_cloud_alive,
    'session_recent', v_session_recent,
    'waiting', v_waiting,
    'stuck', v_stuck,
    'oldest_wait_s', v_wait_s,
    'oldest_wait_trigger_s', c.oldest_wait_s);

  update public.processing_control
     set cloud_decision = result,
         cloud_decided_at = now(),
         latest_dispatch_reason = v_reason,
         -- Only the caller that is about to spawn a worker marks the start,
         -- so the next minute's check sees a session on its way up rather
         -- than starting a second one. A caller that is only asking (the
         -- switch on the processing page) leaves the stamp alone; the
         -- dispatcher then starts the worker on its next tick, within a
         -- minute.
         cloud_session_started_at = case when v_run and p_claim then now() else cloud_session_started_at end,
         cloud_session_note = case when v_run and p_claim then 'starting: ' || v_reason else cloud_session_note end,
         updated_at = now()
   where singleton;
  return result;
end;
$function$;
