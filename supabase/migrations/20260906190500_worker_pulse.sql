-- 20260906190500 — the workers say what they are doing.
--
-- Adil, 2026-09-06: "I would love to see what jobs or tasks the macOS
-- worker is working on, even right now... make sure that one is running,
-- it's healthy, it is processing, and when it's busy and when it's not."
--
-- WHY A NEW TABLE AND NOT jobs. The obvious page reads jobs.progress and
-- jobs.updated_at. Both freeze for hours on a perfectly healthy worker:
-- placement_generate writes progress 5, then 20, then 100, and
-- updated_at only moves when a column does. The job running while this
-- was written read 20% for three hours. A crashed worker looks exactly
-- the same. The queue cannot tell busy from dead, so the worker has to
-- say so itself.
--
-- WHY NOT report_worker_heartbeat(). That one is not a liveness signal,
-- it is the gate on the Mac/Modal parity contract: a worker reporting
-- itself must name the ACTIVE pipeline release and match its manifest,
-- platform profile, calibration strategy and model checksums. No release
-- is active today, so the Mac worker calling it would be stored as
-- identity_rejected, and it would set processing_control.cloud_mode to
-- 'disabled' with reason 'release_mismatch'. Satisfying it properly means
-- shipping the whole release-manifest machinery, which is the Modal
-- project's job. This table touches none of that; the two sit side by
-- side, parity there and operations here.
--
-- MONITORING MUST NEVER FAIL A JOB. Same rule as the storage ledger and
-- the cost meter. record_worker_pulse never raises, the worker wraps it
-- anyway, and there is no foreign key to jobs — a pulse write must not be
-- able to block on, or fail because of, the row it is describing.

create table if not exists public.worker_pulse (
  -- 'mac:main', 'mac:fast', 'modal:<container>'. One row per process,
  -- upserted. No history: job history already lives in jobs, and a pulse
  -- log would be a large table nobody reads.
  worker_id      text primary key,
  lane           text not null,        -- main | fast | lesson | <new lane>
  host           text not null,        -- mac | modal
  pid            integer,
  code_version   text,                 -- the commit the daemon actually loaded
  -- The PROCESS's own start, sent by the worker, so "up since" survives a
  -- beat and a restart on the same commit still reads as a restart. A
  -- KeepAlive restart loop is a real failure mode (ThrottleInterval 30).
  started_at     timestamptz not null default now(),
  beat_at        timestamptz not null default now(),
  job_id         uuid,
  job_kind       text,
  match_id       uuid,
  stage          text,                 -- download | ball | points | cut | ...
  stage_note     text,                 -- 'frame 57000 of 65807, 6.1 fps'
  stage_pct      integer,
  -- Why a job is slow, which is the question a stuck queue actually
  -- raises. The Mac Studio is a shared machine: on the day this was
  -- written three research scripts from another session held 1700% CPU
  -- at load 50, and ball detection was running at a fifth of its usual
  -- speed. Nothing anywhere said so.
  host_load_1m   real,
  host_cpu_count integer
);

alter table public.worker_pulse enable row level security;

-- Admin only. It names jobs, and a job is one join from a person.
drop policy if exists "Admin reads worker pulse" on public.worker_pulse;
create policy "Admin reads worker pulse"
  on public.worker_pulse for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- The write. Called every 15 seconds by each worker process.
-- ---------------------------------------------------------------------------
create or replace function public.record_worker_pulse(
  p_worker_id      text,
  p_lane           text,
  p_host           text,
  p_pid            integer default null,
  p_code_version   text default null,
  p_started_at     timestamptz default null,
  p_job_id         uuid default null,
  p_job_kind       text default null,
  p_match_id       uuid default null,
  p_stage          text default null,
  p_stage_note     text default null,
  p_stage_pct      integer default null,
  p_host_load_1m   real default null,
  p_host_cpu_count integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Returns rather than raises, on purpose. This is called from a daemon
  -- thread beside a running job; there is no failure here worth costing
  -- someone their upload. The identity is built from module constants, so
  -- an empty one is a bug in the caller, not a runtime condition.
  if coalesce(p_worker_id, '') = ''
     or coalesce(p_lane, '') = ''
     or coalesce(p_host, '') = '' then
    return;
  end if;

  -- The stage is stored exactly as given. There is no allow-list, and
  -- there must not be one: a stage the page has not been taught about has
  -- to show up as itself so somebody notices, rather than being mapped to
  -- 'unknown' and disappearing. See the standing rule in CLAUDE.md.
  insert into public.worker_pulse as w (
    worker_id, lane, host, pid, code_version, started_at, beat_at,
    job_id, job_kind, match_id, stage, stage_note, stage_pct,
    host_load_1m, host_cpu_count
  ) values (
    p_worker_id, p_lane, p_host, p_pid, left(p_code_version, 200),
    coalesce(p_started_at, now()), now(),
    p_job_id, p_job_kind, p_match_id, left(p_stage, 60),
    left(p_stage_note, 200), p_stage_pct,
    p_host_load_1m, p_host_cpu_count
  )
  on conflict (worker_id) do update set
    lane           = excluded.lane,
    host           = excluded.host,
    pid            = excluded.pid,
    code_version   = excluded.code_version,
    started_at     = excluded.started_at,
    beat_at        = now(),
    job_id         = excluded.job_id,
    job_kind       = excluded.job_kind,
    match_id       = excluded.match_id,
    stage          = excluded.stage,
    stage_note     = excluded.stage_note,
    stage_pct      = excluded.stage_pct,
    host_load_1m   = excluded.host_load_1m,
    host_cpu_count = excluded.host_cpu_count;
end;
$$;

revoke execute on function public.record_worker_pulse(
  text, text, text, integer, text, timestamptz, uuid, text, uuid,
  text, text, integer, real, integer) from public;
grant execute on function public.record_worker_pulse(
  text, text, text, integer, text, timestamptz, uuid, text, uuid,
  text, text, integer, real, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The read. One JSON document, because four round trips on a page that
-- refreshes is four chances for one to fail and blank the rest.
-- ---------------------------------------------------------------------------
create or replace function public.admin_processing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_workers  jsonb;
  v_lesson   jsonb;
  v_waiting  jsonb;
  v_running  jsonb;
  v_recent   jsonb;
  v_day      jsonb;
  v_queue    jsonb := '[]'::jsonb;
  v_cloud    jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  -- What each process last said about itself.
  select coalesce(jsonb_agg(x order by x->>'worker_id'), '[]'::jsonb)
    into v_workers
  from (
    select jsonb_build_object(
      'worker_id', p.worker_id,
      'lane', p.lane,
      'host', p.host,
      'pid', p.pid,
      'code_version', p.code_version,
      'started_at', p.started_at,
      'beat_at', p.beat_at,
      'job_id', p.job_id,
      'job_kind', p.job_kind,
      -- The worker need not track this: the job row already carries it,
      -- and one place to be wrong is better than two.
      'match_id', coalesce(p.match_id::text, j.options->>'match_id'),
      'stage', p.stage,
      'stage_note', p.stage_note,
      'stage_pct', p.stage_pct,
      'host_load_1m', p.host_load_1m,
      'host_cpu_count', p.host_cpu_count,
      'player', public._display_name(u.*),
      'job_created_at', j.created_at
    ) as x
    from public.worker_pulse p
    left join public.jobs j on j.id = p.job_id
    left join auth.users u on u.id = j.user_id
  ) s;

  -- The lesson recap workers report through their own release-gated
  -- heartbeat (20260906033000) and are left exactly where they are. Only
  -- the ones beating recently are worth a row: cloud containers are
  -- ephemeral and the table keeps every id one has ever used.
  select jsonb_build_object(
      'mac_beat_at', max(h.heartbeat_at) filter (where not h.is_cloud),
      'mac_started_at', max(h.started_at) filter (where not h.is_cloud),
      'mac_worker_id', (array_agg(h.worker_id order by h.heartbeat_at desc)
                        filter (where not h.is_cloud))[1],
      'cloud_beat_at', max(h.heartbeat_at) filter (where h.is_cloud),
      'cloud_worker_id', (array_agg(h.worker_id order by h.heartbeat_at desc)
                          filter (where h.is_cloud))[1],
      'cloud_reporting_today', count(distinct h.worker_id)
        filter (where h.is_cloud and h.heartbeat_at > now() - interval '24 hours'),
      'release_id', (array_agg(h.release_id order by h.heartbeat_at desc))[1]
    )
    into v_lesson
  from public.lesson_video_worker_heartbeats h;

  -- Waiting. Oldest first, because the oldest is the complaint.
  select coalesce(jsonb_agg(x order by (x->>'created_at')), '[]'::jsonb)
    into v_waiting
  from (
    select jsonb_build_object(
      'id', j.id,
      'kind', j.kind,
      'created_at', j.created_at,
      'original_name', j.original_name,
      'match_id', j.options->>'match_id',
      'player', public._display_name(u.*),
      'estimated_work_seconds', j.estimated_work_seconds,
      'eta_latest_at', j.eta_latest_at
    ) as x
    from public.jobs j
    left join auth.users u on u.id = j.user_id
    where j.status = 'queued'
    order by j.created_at
    limit 100
  ) s;

  -- In flight according to the ROW. Cross-checked against the pulse by
  -- the page: a job marked processing with no pulse behind it is the one
  -- genuinely ambiguous state, and it has to be named rather than guessed.
  select coalesce(jsonb_agg(x order by (x->>'created_at')), '[]'::jsonb)
    into v_running
  from (
    select jsonb_build_object(
      'id', j.id,
      'kind', j.kind,
      'created_at', j.created_at,
      'updated_at', j.updated_at,
      'progress', j.progress,
      'original_name', j.original_name,
      'match_id', j.options->>'match_id',
      'player', public._display_name(u.*)
    ) as x
    from public.jobs j
    left join auth.users u on u.id = j.user_id
    where j.status = 'processing'
    order by j.created_at
    limit 50
  ) s;

  -- Recently finished. A failure is the thing most worth seeing and the
  -- portal shows it nowhere today.
  select coalesce(jsonb_agg(x order by (x->>'updated_at') desc), '[]'::jsonb)
    into v_recent
  from (
    select jsonb_build_object(
      'id', j.id,
      'kind', j.kind,
      'status', j.status,
      'created_at', j.created_at,
      'updated_at', j.updated_at,
      'error', left(j.error, 300),
      'user_message', left(j.user_message, 300),
      'original_name', j.original_name,
      'match_id', j.options->>'match_id',
      'player', public._display_name(u.*)
    ) as x
    from public.jobs j
    left join auth.users u on u.id = j.user_id
    where j.status in ('done', 'failed', 'cancelled')
    order by j.updated_at desc
    limit 20
  ) s;

  select jsonb_build_object(
      'done', count(*) filter (where status = 'done'),
      'failed', count(*) filter (where status = 'failed'),
      'cancelled', count(*) filter (where status = 'cancelled')
    )
    into v_day
  from public.jobs
  where updated_at > now() - interval '24 hours'
    and status in ('done', 'failed', 'cancelled');

  -- pgmq's own view, as a cross-check on the job rows. Guarded: this
  -- reads another schema's function, and a page must not go dark because
  -- an extension moved.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'queue_name', m.queue_name,
             'queue_length', m.queue_length,
             'oldest_msg_age_sec', m.oldest_msg_age_sec)), '[]'::jsonb)
      into v_queue
    from pgmq.metrics_all() m
    where m.queue_name in ('jobs', 'jobs_fast');
  exception when others then
    v_queue := '[]'::jsonb;
  end;

  -- The cloud twin's control plane, read and never written. When the
  -- Modal branch lands this section starts showing numbers with no
  -- further change here.
  select jsonb_build_object(
      'cloud_mode', c.cloud_mode,
      'active_release_id', c.active_release_id,
      'latest_dispatch_reason', c.latest_dispatch_reason,
      'privacy_gate_passed', c.privacy_gate_passed,
      'license_gate_passed', c.license_gate_passed,
      'parity_gate_passed', c.parity_gate_passed,
      'successful_cloud_canaries', c.successful_cloud_canaries,
      'daily_cap_usd', c.daily_cap_usd,
      'monthly_cap_usd', c.monthly_cap_usd,
      'oldest_wait_s', c.oldest_wait_s,
      'mac_stale_s', c.mac_stale_s,
      'projected_backlog_seconds', c.projected_backlog_seconds,
      'candidate_releases', (select count(*) from public.pipeline_releases),
      'heartbeats', (select count(*) from public.worker_heartbeats),
      'attempts_24h', (select count(*) from public.job_attempts
                        where claimed_at > now() - interval '24 hours')
    )
    into v_cloud
  from public.processing_control c
  where c.singleton;

  return jsonb_build_object(
    'now', now(),
    'workers', v_workers,
    'lesson', coalesce(v_lesson, '{}'::jsonb),
    'waiting', v_waiting,
    'running', v_running,
    'recent', v_recent,
    'day', coalesce(v_day, '{}'::jsonb),
    'queue', v_queue,
    'reclip_lane', (select value from public.app_config
                     where key = 'reclip_lane'),
    'cloud', coalesce(v_cloud, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_processing_overview() from public;
grant execute on function public.admin_processing_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- The hub's one line. Its own function rather than the overview above,
-- because the hub loads on every visit to /admin and has no use for a
-- hundred queued rows and twenty finished ones.
-- ---------------------------------------------------------------------------
create or replace function public.admin_processing_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object(
    'queued', count(*) filter (where j.status = 'queued'),
    'running', count(*) filter (where j.status = 'processing'),
    'oldest_wait_s', coalesce(
      extract(epoch from now() - min(j.created_at)
              filter (where j.status = 'queued')), 0)::int,
    -- Whether anything on the Mac is beating at all. A silent worker with
    -- an empty queue is still the thing worth putting on the hub.
    'reporting', exists (
      select 1 from public.worker_pulse p
       where p.host = 'mac' and p.beat_at > now() - interval '90 seconds')
  ) into v
  from public.jobs j
  where j.status in ('queued', 'processing');
  return v;
end;
$$;

revoke execute on function public.admin_processing_counts() from public;
grant execute on function public.admin_processing_counts() to authenticated;
