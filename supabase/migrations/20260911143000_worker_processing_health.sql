-- Additive Mac execution provenance. Does not change scoring, queue claims,
-- pipeline_releases, processing_control, or the disabled match cloud worker.
begin;

create table public.worker_processing_runs (
  attempt_key text primary key check (length(attempt_key) between 1 and 200),
  job_id uuid not null,
  match_id uuid,
  release_id text check (length(release_id) <= 100),
  body_model text check (length(body_model) <= 80),
  requested_pipeline text not null check (requested_pipeline in ('v1','v2','bodies','unknown')),
  delivered_pipeline text check (length(delivered_pipeline) <= 80),
  status text not null check (status in ('running','used','refused','degraded','unknown','not_requested','failed')),
  reason_code text check (reason_code ~ '^[a-z0-9_]{1,80}$'),
  details jsonb not null default '{}' check (octet_length(details::text) <= 16384),
  started_at timestamptz not null,
  finished_at timestamptz,
  received_at timestamptz not null default now(),
  check ((status = 'running') = (finished_at is null))
);
create index worker_processing_runs_job on public.worker_processing_runs(job_id, started_at desc);
create index worker_processing_runs_time on public.worker_processing_runs(started_at desc);

create table public.worker_processing_health_control (
  singleton boolean primary key default true check (singleton),
  -- Set only at actual activation: historical jobs are not new outages.
  expected_after timestamptz,
  monitor_at timestamptz,
  email_enabled boolean not null default false
);
insert into public.worker_processing_health_control(singleton) values (true);

create table public.worker_processing_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('processing_degraded','telemetry_missing')),
  release_id text not null,
  opened_at timestamptz not null default now(),
  last_fault_at timestamptz not null,
  recovered_at timestamptz,
  details jsonb not null default '{}',
  notified_at timestamptz,
  notification_attempts integer not null default 0,
  notification_error text,
  notification_lease_until timestamptz,
  check (octet_length(details::text) <= 16384)
);
create unique index worker_processing_one_incident on public.worker_processing_incidents(kind,release_id)
  where recovered_at is null;

alter table public.worker_processing_runs enable row level security;
alter table public.worker_processing_incidents enable row level security;
alter table public.worker_processing_health_control enable row level security;
create policy "Admin reads processing runs" on public.worker_processing_runs
  for select to authenticated using (public.is_admin());
create policy "Admin reads processing incidents" on public.worker_processing_incidents
  for select to authenticated using (public.is_admin());
create policy "Admin reads processing health control" on public.worker_processing_health_control
  for select to authenticated using (public.is_admin());
revoke all on public.worker_processing_runs, public.worker_processing_incidents,
  public.worker_processing_health_control from public, anon, authenticated;
grant select on public.worker_processing_runs, public.worker_processing_incidents,
  public.worker_processing_health_control to authenticated;
grant all on public.worker_processing_runs, public.worker_processing_incidents,
  public.worker_processing_health_control to service_role;

create function public.record_worker_processing_run(p_record jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_record->>'schema' is distinct from '1' or jsonb_typeof(p_record) is distinct from 'object'
     or octet_length(p_record::text) > 18000 then
    raise exception 'invalid processing record';
  end if;
  if exists (select 1 from public.worker_processing_runs r
    where r.attempt_key = p_record->>'attempt_key'
      and (r.job_id <> (p_record->>'job_id')::uuid
        or r.release_id is distinct from p_record->>'release_id'
        or r.requested_pipeline <> p_record->>'requested_pipeline')) then
    raise exception 'processing attempt identity mismatch';
  end if;
  insert into public.worker_processing_runs as r (
    attempt_key,job_id,match_id,release_id,body_model,requested_pipeline,
    delivered_pipeline,status,reason_code,details,started_at,finished_at)
  values (p_record->>'attempt_key',(p_record->>'job_id')::uuid,
    (p_record->>'match_id')::uuid,p_record->>'release_id',p_record->>'body_model',
    p_record->>'requested_pipeline',p_record->>'delivered_pipeline',
    p_record->>'status',p_record->>'reason_code',coalesce(p_record->'details','{}'),
    (p_record->>'started_at')::timestamptz,(p_record->>'finished_at')::timestamptz)
  on conflict (attempt_key) do update set
    match_id=excluded.match_id,body_model=excluded.body_model,
    delivered_pipeline=excluded.delivered_pipeline,status=excluded.status,
    reason_code=excluded.reason_code,details=excluded.details,
    finished_at=excluded.finished_at,received_at=now()
  -- A delayed start or duplicate completion cannot regress final facts.
  where r.finished_at is null and r.job_id=excluded.job_id
    and r.release_id is not distinct from excluded.release_id
    and r.requested_pipeline=excluded.requested_pipeline;
end;
$$;
revoke all on function public.record_worker_processing_run(jsonb) from public,anon,authenticated;
grant execute on function public.record_worker_processing_run(jsonb) to service_role;

-- Missing records remain unknown, never labelled as a successful body pass.
create function public.worker_processing_missing() returns table(job_id uuid, finished_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select j.id,j.updated_at from public.jobs j
  cross join public.worker_processing_health_control c
  where c.expected_after is not null and j.created_at >= c.expected_after
    and j.status in ('done','failed') and j.updated_at < now() - interval '10 minutes'
    and j.options->>'points' = 'true' and j.kind in ('deadspace_cut','youtube_import')
    and not exists (select 1 from public.worker_processing_runs r
      where r.job_id=j.id and r.finished_at is not null)
    -- Rejected inputs / library-only downloads never reach point processing.
    and exists (select 1 from public.matches m where m.job_id=j.id
      and m.match_json_path is not null)
  order by j.updated_at desc limit 100;
$$;
revoke all on function public.worker_processing_missing() from public,anon,authenticated;
grant execute on function public.worker_processing_missing() to service_role;

create function public.admin_processing_health() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'as_of',now(),
    'control',(select to_jsonb(c) from public.worker_processing_health_control c),
    'runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from
      (select * from public.worker_processing_runs order by started_at desc limit 30) r),'[]'),
    'incidents',coalesce((select jsonb_agg(to_jsonb(i) order by i.opened_at desc) from
      (select id,kind,release_id,opened_at,last_fault_at,recovered_at,details,notified_at
       from public.worker_processing_incidents order by opened_at desc limit 20) i),'[]'),
    'missing',coalesce((select jsonb_agg(to_jsonb(m)) from public.worker_processing_missing() m),'[]'));
end;
$$;
revoke all on function public.admin_processing_health() from public,anon;
grant execute on function public.admin_processing_health() to authenticated,service_role;

-- Some installations use the restricted direct worker role rather than the
-- service key. Keep any grant explicit and confined to operational data.
do $$ begin
  if exists(select 1 from pg_roles where rolname='ponglens_worker') then
    grant execute on function public.record_worker_processing_run(jsonb) to ponglens_worker;
    grant execute on function public.worker_processing_missing() to ponglens_worker;
    grant select on public.worker_processing_runs to ponglens_worker;
    grant select,insert,update on public.worker_processing_incidents to ponglens_worker;
    grant select,update on public.worker_processing_health_control to ponglens_worker;
    create policy "Worker reads processing runs" on public.worker_processing_runs
      for select to ponglens_worker using (true);
    create policy "Worker manages processing incidents" on public.worker_processing_incidents
      for all to ponglens_worker using (true) with check (true);
    create policy "Worker updates processing health" on public.worker_processing_health_control
      for all to ponglens_worker using (true) with check (true);
  end if;
end $$;
commit;
