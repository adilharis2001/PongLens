-- Capture is deliberately off until old workers have drained and the new
-- package is selected. No historical jobs are scanned or backfilled.
create table if not exists public.match_ready_delivery_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.match_ready_delivery_control(singleton) values(true)
  on conflict do nothing;

create table if not exists public.match_ready_deliveries (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  state text not null default 'pending'
    check(state in ('pending','sent','suppressed','unaddressed','expired')),
  payload jsonb,
  first_attempt_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  provider_id text,
  last_error text
);
create index if not exists match_ready_pending_idx
  on public.match_ready_deliveries(next_attempt_at) where state='pending';

alter table public.match_ready_delivery_control enable row level security;
alter table public.match_ready_deliveries enable row level security;
revoke all on public.match_ready_deliveries,public.match_ready_delivery_control
  from public,anon,authenticated;
grant select on public.match_ready_deliveries,public.match_ready_delivery_control to authenticated;
drop policy if exists match_ready_admin_read on public.match_ready_deliveries;
create policy match_ready_admin_read on public.match_ready_deliveries
  for select to authenticated using(public.is_admin());
drop policy if exists match_ready_control_admin_read on public.match_ready_delivery_control;
create policy match_ready_control_admin_read on public.match_ready_delivery_control
  for select to authenticated using(public.is_admin());
grant select,update on public.match_ready_deliveries to service_role;
grant select on public.match_ready_delivery_control to service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='ponglens_worker') then
    grant select,update on public.match_ready_deliveries to ponglens_worker;
    grant select on public.match_ready_delivery_control to ponglens_worker;
    drop policy if exists match_ready_worker on public.match_ready_deliveries;
    create policy match_ready_worker on public.match_ready_deliveries
      for all to ponglens_worker using(true) with check(true);
    drop policy if exists match_ready_control_worker on public.match_ready_delivery_control;
    create policy match_ready_control_worker on public.match_ready_delivery_control
      for select to ponglens_worker using(true);
  end if;
end $$;

create or replace function public.capture_match_ready_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kind='deadspace_cut' and new.status='done'
     and old.status is distinct from 'done'
     and exists(select 1 from public.match_ready_delivery_control where singleton and enabled) then
    insert into public.match_ready_deliveries(job_id,user_id)
      values(new.id,new.user_id) on conflict(job_id) do nothing;
  end if;
  return new;
exception when others then
  -- Notification storage must not turn a finished video into a failed job.
  raise warning 'Match-ready capture unavailable (%)', SQLSTATE;
  return new;
end $$;
revoke all on function public.capture_match_ready_delivery() from public,anon,authenticated;
drop trigger if exists capture_match_ready_delivery on public.jobs;
create trigger capture_match_ready_delivery after update of status on public.jobs
  for each row execute function public.capture_match_ready_delivery();
