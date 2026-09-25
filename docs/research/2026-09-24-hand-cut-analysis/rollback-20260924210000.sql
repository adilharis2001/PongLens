-- Rollback for supabase/migrations/20260924210000_hand_cut_analysis.sql.
-- NOT a migration: kept out of supabase/migrations so nothing applies it by
-- accident. Every body below is the live definition pulled with
-- pg_get_functiondef on 2026-09-24, before the migration; CREATE OR REPLACE
-- keeps each function's existing grants. Run as one transaction, then roll
-- the hand lane back (RELEASE-PLAN.md, "Rollback").

begin;

CREATE OR REPLACE FUNCTION public.request_placement_generation(p_match_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.request_placement_retry(p_match_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
declare
  v_queue text := 'jobs';
  v_lane text;
begin
  if new.kind = 'reclip'
     or (new.kind = 'reel' and coalesce(new.options->>'scope', '') like 'v:%')
  then
    select value into v_lane from public.app_config where key = 'reclip_lane';
    if v_lane = 'fast' then
      v_queue := 'jobs_fast';
    end if;
  elsif new.kind = 'hand_cut' then
    v_queue := 'jobs_hand';
  end if;
  perform pgmq.send(
    v_queue,
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

CREATE OR REPLACE FUNCTION public.cloud_worker_decision(p_claim boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select count(*), min(created_at) into v_waiting, v_oldest
    from public.jobs where status = 'queued' and kind <> 'hand_cut';
  -- A job the Mac was in the middle of when it went quiet. Nothing is
  -- pulsing for it and it has not moved; it will come back to the queue
  -- when its message reappears, and it counts as waiting from the moment
  -- the Mac stopped.
  select count(*) into v_stuck
    from public.jobs j
   where j.status = 'processing'
     and j.kind <> 'hand_cut'
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

-- Nothing references the helper once the two functions above are restored.
drop function if exists public.job_queue_name(text, jsonb);

commit;
