-- Minimal dependencies in the dedicated network-disabled test database only.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='ponglens_worker') then create role ponglens_worker; end if;
end $$;
create function public.is_admin() returns boolean language sql stable as
  $$ select coalesce(current_setting('test.is_admin',true),'false')='true' $$;
create table public.jobs(id uuid primary key,kind text,status text,options jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.matches(id uuid primary key, job_id uuid,match_json_path text);
