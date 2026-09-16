-- 20260916141355 — the cloud twin's switch, and the one question it asks.
--
-- Adil, 2026-09-16: "a toggle in my admin portal that I can turn on ...
-- cloud workers running, which would automatically start picking up jobs
-- that the Mac Studio is failing to do because I'm away."
--
-- The Modal branch of 2026-09-05 (migrations 20260906003500..3700) built a
-- large control plane around processing_control: leases, attempts, budget
-- reservations, rollout gates and a promotion process. None of it ever ran,
-- and the worker it was written for no longer exists. This migration keeps
-- the row and its cloud_mode column, because the admin page already reads
-- them, and replaces the decision with one function the cloud dispatcher
-- calls every minute. The older RPCs (set_cloud_dispatch_mode,
-- claim_cloud_candidate, request_cloud_canary) are left in place and unused.
--
-- What the modes mean now:
--   disabled   off. Nothing in the cloud ever starts.
--   automatic  standby. A cloud container starts when the Mac Studio has
--              been silent for mac_stale_s (15 minutes) and something has
--              waited oldest_wait_s (30 minutes), and stops when the Mac
--              reports again or the queue is empty.
--   manual     start one session now, whatever the Mac is doing. When that
--              session ends the mode returns to disabled by itself, so a
--              forgotten switch cannot keep paying for idle containers.
--
-- The cloud container runs the very same sealed release as the Mac. Until
-- the Mac reports a pipeline identity of its own, the gate is the Mac
-- release ID the cloud twin was built from: the dispatcher compares it with
-- the Mac's own pulse and refuses to start on a mismatch.

alter table public.processing_control
  add column if not exists cloud_release_id text,
  add column if not exists cloud_pipeline_id text,
  add column if not exists cloud_mac_release_id text,
  add column if not exists cloud_source_commit text,
  add column if not exists cloud_registered_at timestamptz,
  add column if not exists cloud_session_started_at timestamptz,
  add column if not exists cloud_session_ended_at timestamptz,
  add column if not exists cloud_session_note text,
  add column if not exists cloud_decided_at timestamptz,
  add column if not exists cloud_decision jsonb;

-- ---------------------------------------------------------------------------
-- The deployment says which release it runs.
-- ---------------------------------------------------------------------------
create or replace function public.cloud_worker_register(
  p_release_id text,
  p_pipeline_id text,
  p_mac_release_id text,
  p_source_commit text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_release_id, '') = '' or coalesce(p_mac_release_id, '') = '' then
    raise exception 'cloud release identity required' using errcode = '22023';
  end if;
  update public.processing_control
     set cloud_release_id = p_release_id,
         cloud_pipeline_id = p_pipeline_id,
         cloud_mac_release_id = p_mac_release_id,
         cloud_source_commit = p_source_commit,
         cloud_registered_at = now(),
         updated_at = now()
   where singleton;
  return jsonb_build_object(
    'cloud_release_id', p_release_id,
    'cloud_pipeline_id', p_pipeline_id,
    'cloud_mac_release_id', p_mac_release_id,
    'registered_at', now());
end;
$$;

revoke execute on function public.cloud_worker_register(text, text, text, text) from public, anon, authenticated;
grant execute on function public.cloud_worker_register(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The question, asked once a minute by the dispatcher and once more by the
-- container when it starts. Writes its own answer to the control row so the
-- admin page can show the reason in words.
-- ---------------------------------------------------------------------------
create or replace function public.cloud_worker_decision()
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
  v_session_recent := c.cloud_session_started_at is not null
    and c.cloud_session_started_at > now() - interval '5 minutes'
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
         -- Marks the start so the next minute's check sees a session on
         -- its way up rather than starting a second one.
         cloud_session_started_at = case when v_run then now() else cloud_session_started_at end,
         cloud_session_note = case when v_run then 'starting: ' || v_reason else cloud_session_note end,
         updated_at = now()
   where singleton;
  return result;
end;
$$;

revoke execute on function public.cloud_worker_decision() from public, anon, authenticated;
grant execute on function public.cloud_worker_decision() to service_role;

-- ---------------------------------------------------------------------------
-- The container reports its own start and end.
-- ---------------------------------------------------------------------------
create or replace function public.cloud_worker_session(p_event text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event = 'started' then
    update public.processing_control
       set cloud_session_started_at = now(),
           cloud_session_note = left(p_note, 200),
           updated_at = now()
     where singleton;
  elsif p_event = 'ended' then
    update public.processing_control
       set cloud_session_ended_at = now(),
           cloud_session_note = left(p_note, 200),
           -- A manual session is one session. Standby stays standby.
           cloud_mode = case when cloud_mode = 'manual' then 'disabled' else cloud_mode end,
           latest_dispatch_reason = case when cloud_mode = 'manual' then 'manual_session_ended' else latest_dispatch_reason end,
           updated_at = now()
     where singleton;
  else
    raise exception 'unknown cloud session event %', p_event using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.cloud_worker_session(text, text) from public, anon, authenticated;
grant execute on function public.cloud_worker_session(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The switch. Admin only; re-checked here, not only in the page.
-- ---------------------------------------------------------------------------
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
  return public.cloud_worker_decision();
end;
$$;

revoke execute on function public.set_cloud_worker_mode(text) from public, anon;
grant execute on function public.set_cloud_worker_mode(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The page reads the answer. The overview is wrapped once more rather than
-- rewritten, the way the share-render fields were added on 2026-09-09.
-- ---------------------------------------------------------------------------
create or replace function public.admin_processing_overview_pre_cloud_twin_20260916()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  overview jsonb;
  lesson jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  overview := public.admin_processing_overview_pre_share_render_20260909();
  lesson := coalesce(overview->'lesson', '{}'::jsonb) || jsonb_build_object(
    'share_queued', (
      select count(*) from public.lesson_share_renders where status = 'queued'
    ),
    'share_failed', (
      select count(*) from public.lesson_share_renders where status = 'failed'
    ),
    'share_stage', (
      select stage from public.lesson_share_renders
       where status = 'processing'
       order by updated_at desc
       limit 1
    ),
    'share_oldest_queued_at', (
      select min(created_at) from public.lesson_share_renders where status = 'queued'
    )
  );
  return jsonb_set(overview, '{lesson}', lesson, true);
end;
$$;

revoke execute on function public.admin_processing_overview_pre_cloud_twin_20260916() from public;
grant execute on function public.admin_processing_overview_pre_cloud_twin_20260916() to authenticated;

create or replace function public.admin_processing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  overview jsonb;
  cloud jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  overview := public.admin_processing_overview_pre_cloud_twin_20260916();
  select coalesce(overview->'cloud', '{}'::jsonb) || jsonb_build_object(
      'cloud_release_id', c.cloud_release_id,
      'cloud_pipeline_id', c.cloud_pipeline_id,
      'cloud_mac_release_id', c.cloud_mac_release_id,
      'cloud_source_commit', c.cloud_source_commit,
      'cloud_registered_at', c.cloud_registered_at,
      'cloud_session_started_at', c.cloud_session_started_at,
      'cloud_session_ended_at', c.cloud_session_ended_at,
      'cloud_session_note', c.cloud_session_note,
      'cloud_decided_at', c.cloud_decided_at,
      'cloud_decision', c.cloud_decision,
      'mac_stale_s', c.mac_stale_s)
    into cloud
    from public.processing_control c
   where c.singleton;
  return jsonb_set(overview, '{cloud}', coalesce(cloud, overview->'cloud', '{}'::jsonb), true);
end;
$$;

revoke execute on function public.admin_processing_overview() from public;
grant execute on function public.admin_processing_overview() to authenticated;
