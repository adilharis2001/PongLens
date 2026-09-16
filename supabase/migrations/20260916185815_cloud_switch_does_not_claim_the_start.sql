-- The first press of Run once on 2026-09-16 started nothing for five
-- minutes. set_cloud_worker_mode() returns the dispatcher's fresh decision
-- so the page can say in words what the new setting means, and the decision
-- function, seeing run = true, stamped cloud_session_started_at as if a
-- worker were on its way up. Only the every-minute dispatcher on Modal
-- actually spawns one, and for the next five minutes it read that stamp as
-- "a session is starting" and did nothing. The worker came up on the sixth
-- tick.
--
-- Two more things the first live session showed: the container needs five
-- to six minutes from spawn to first heartbeat, longer than the five-minute
-- grace, so the grace is now twelve minutes; and the worker's own supervisor
-- polls this function too, so it asks without claiming as well.
--
-- The decision now takes a flag: p_claim. The dispatcher claims (default
-- true); the switch asks without claiming. The zero-argument form stays for
-- the dispatcher and for anyone reading the policy by hand.

create or replace function public.cloud_worker_decision(p_claim boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create or replace function public.cloud_worker_decision()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.cloud_worker_decision(true);
$$;

create or replace function public.set_cloud_worker_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_mode not in ('disabled', 'manual', 'automatic') then
    raise exception 'unknown cloud mode %', p_mode using errcode = '22023';
  end if;
  update public.processing_control
     set cloud_mode = p_mode,
         latest_dispatch_reason = 'mode_changed',
         updated_at = now()
   where singleton;
  -- Ask, do not claim: the dispatcher on Modal is the only thing that
  -- starts a worker, and it must see run = true on its own next tick.
  return public.cloud_worker_decision(false);
end;
$$;

revoke all on function public.cloud_worker_decision(boolean) from public;
grant execute on function public.cloud_worker_decision(boolean) to service_role;
