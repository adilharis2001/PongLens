-- The smallest schema 20260925061009_device_hand_cut.sql needs, for a bare
-- Postgres (no Supabase, no pgmq). The functions it replaces or calls that
-- matter to behaviour are copied from production as they were on
-- 2026-09-25 (hand_cut_enabled, job_queue_name, jobs_notify_failed,
-- claim_hand_cut's tables); everything else is a stand-in that records
-- what it was asked.
--
--   docker run -d --name hc-device-pg -e POSTGRES_PASSWORD=x postgres:17-alpine
--   for f in supabase/tests/device_hand_cut_stubs.sql \
--            supabase/migrations/20260925061009_device_hand_cut.sql \
--            supabase/tests/device_hand_cut.sql; do
--     docker exec -i hc-device-pg psql -q -v ON_ERROR_STOP=1 -U postgres < "$f"
--   done
--   docker rm -f hc-device-pg
\set ON_ERROR_STOP on

do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text,
                         raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;

-- pgmq: send records the message; the rest is never called here.
create schema pgmq;
create table pgmq.sent (id bigserial primary key, queue text, message jsonb,
                        delay integer);
create function pgmq.send(p_queue text, p_message jsonb, p_delay integer)
returns setof bigint language sql as $$
  insert into pgmq.sent (queue, message, delay)
  values (p_queue, p_message, p_delay) returning id
$$;

create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;

create function public.is_admin() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'admin', '') = 'true'
$$;

create function public._display_name(u auth.users) returns text
language sql stable as $$ select u.email $$;

create table public.matches (
  id uuid primary key,
  user_id uuid not null,
  status text not null default 'uploaded',
  cut_path text,
  raw_path text,
  duration_s double precision,
  content_checked_at timestamptz,
  original_name text,
  active_processing_version_id uuid,
  cut_source text not null default 'auto',
  clip_pads jsonb,
  job_id uuid
);

create table public.points (id uuid primary key default gen_random_uuid(),
                            match_id uuid not null);

create table public.hand_cut_drafts (
  match_id uuid primary key references public.matches (id) on delete cascade,
  user_id uuid not null,
  marks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'failed', 'cancelled')),
  kind text not null default 'deadspace_cut',
  input_path text,
  result_path text,
  error text,
  progress integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  original_name text,
  options jsonb not null default '{}'::jsonb,
  user_message text check (user_message is null or char_length(user_message) <= 300)
);

create table public.notifications (user_id uuid, kind text, title text,
                                   body text, href text);

create table public.worker_pulse (worker_id text primary key, lane text,
                                  host text, beat_at timestamptz, job_id uuid);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- Production, 2026-09-25.
create function public.hand_cut_enabled(p_user uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
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
$function$;

create function public.job_queue_name(p_kind text, p_options jsonb)
 returns text language plpgsql stable security definer set search_path to 'public'
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

create function public.jobs_notify_failed()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status is not distinct from old.status or new.status <> 'failed' then
    return new;
  end if;
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
$function$;
create trigger jobs_notify_failed_status after update of status on public.jobs
  for each row execute function public.jobs_notify_failed();

-- The enqueue trigger's function is replaced by the migration; the
-- trigger itself is production's.
create function public.enqueue_job() returns trigger language plpgsql as $$
begin return new; end $$;
create trigger jobs_enqueue after insert on public.jobs
  for each row execute function public.enqueue_job();

-- Stand-ins for the layers the migration wraps.
create function public.admin_processing_overview_pre_cloud_twin_20260916()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'running', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind)
                                          order by created_at)
                           from public.jobs where status = 'processing'), '[]'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status)
                                         order by updated_at desc)
                          from public.jobs where status in ('done', 'failed', 'cancelled')), '[]'),
    'cloud', '{}'::jsonb)
$$;
create table public.processing_control (singleton boolean primary key default true,
  cloud_release_id text, cloud_pipeline_id text, cloud_mac_release_id text,
  cloud_source_commit text, cloud_registered_at timestamptz,
  cloud_session_started_at timestamptz, cloud_session_ended_at timestamptz,
  cloud_session_note text, cloud_decided_at timestamptz, cloud_decision jsonb,
  mac_stale_s integer);

create function public._fresh_processing_estimate(p_job_id uuid)
returns jsonb language sql stable as $$ select null::jsonb $$;
create function public._my_match_processing_feedback_before_estimates(p_match_ids uuid[])
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('match_id', m.id, 'job_id', m.job_id,
                                               'worker_state', 'missing')), '[]')
    from public.matches m where m.id = any (p_match_ids)
$$;
