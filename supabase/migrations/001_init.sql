-- PongLens initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgmq;

-- ---------------------------------------------------------------------------
-- jobs table
-- ---------------------------------------------------------------------------
create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued', 'processing', 'done', 'failed')),
  -- 'kind' is the future paid-tier hook: deadspace_cut today; placement_map,
  -- spin_report, full_report later — gate premium kinds on the user's plan.
  kind        text not null default 'deadspace_cut',
  input_path  text,          -- object path in the 'uploads' bucket
  result_path text,          -- object path in the 'results' bucket
  error       text,
  progress    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index jobs_user_id_created_at_idx on public.jobs (user_id, created_at desc);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: users see and create only their own jobs.
-- No UPDATE/DELETE policies — only the worker (service role, which bypasses
-- RLS) may mutate job state.
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;

create policy "Users can view own jobs"
  on public.jobs for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can create own jobs"
  on public.jobs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Storage buckets (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads', 'uploads', false, 2147483648, array['video/mp4', 'video/quicktime']),
  ('results', 'results', false, null, null)
on conflict (id) do nothing;

-- Users may upload into their own folder: uploads/<uid>/...
create policy "Users can upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Needed so tus resumable uploads can resume/inspect their own objects.
create policy "Users can update own uploads"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can read own uploads"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- Users may read (download via signed URL) their own results.
create policy "Users can read own results"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'results'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ---------------------------------------------------------------------------
-- pgmq job queue + enqueue trigger
-- The Mac Studio worker reads from this queue over a direct Postgres
-- connection: pgmq.read('jobs', vt => 1800, qty => 1).
-- ---------------------------------------------------------------------------
select pgmq.create('jobs');

create or replace function public.enqueue_job()
returns trigger
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.send(
    'jobs',
    jsonb_build_object(
      'job_id', new.id,
      'user_id', new.user_id,
      'kind', new.kind,
      'input_path', new.input_path
    )
  );
  return new;
end;
$$;

create trigger jobs_enqueue
  after insert on public.jobs
  for each row execute function public.enqueue_job();

-- ---------------------------------------------------------------------------
-- FUTURE: paid tiers (do not run yet — kept as a design stub)
-- ---------------------------------------------------------------------------
-- create table public.plans (
--   id            text primary key,            -- 'free', 'pro'
--   name          text not null,
--   monthly_quota int,                         -- null = unlimited
--   allowed_kinds text[] not null default array['deadspace_cut'],
--   created_at    timestamptz not null default now()
-- );
--
-- create table public.subscriptions (
--   user_id            uuid primary key references auth.users (id) on delete cascade,
--   plan_id            text not null references public.plans (id) default 'free',
--   stripe_customer_id text,
--   status             text not null default 'active',
--   created_at         timestamptz not null default now()
-- );
--
-- Then: replace the jobs INSERT policy with one that checks the user's plan
-- quota and whether jobs.kind is in plan.allowed_kinds.
