-- What 20260925170532_cut_again_auto_replace.sql needs on top of the phase 1
-- test database (cut_again_stubs.sql and the migrations after it), for a
-- bare Postgres. The charging layer (claim_processing and what it reads),
-- the processing ledger and the two match_reprocess guards are production's,
-- copied as they were on 2026-09-25; the reel tables carry the columns the
-- sweep reads.
--
--   docker run -d --name recut-auto-pg -e POSTGRES_PASSWORD=x postgres:17-alpine
--   for f in supabase/tests/device_hand_cut_stubs.sql \
--            supabase/migrations/20260925061009_device_hand_cut.sql \
--            supabase/migrations/20260925105830_device_hand_cut_silent_handoff.sql \
--            supabase/tests/cut_again_stubs.sql \
--            supabase/migrations/20260925124616_cut_again.sql \
--            supabase/migrations/20260925133555_recut_prefill_is_not_a_draft.sql \
--            supabase/migrations/20260925133639_recut_prefill_guard_definer.sql \
--            supabase/tests/cut_again_auto_stubs.sql \
--            supabase/migrations/20260925170532_cut_again_auto_replace.sql \
--            supabase/tests/cut_again.sql \
--            supabase/tests/cut_again_auto.sql; do
--     docker exec -i recut-auto-pg psql -q -v ON_ERROR_STOP=1 -U postgres < "$f"
--   done
--   docker rm -f recut-auto-pg
\set ON_ERROR_STOP on

-- ------------------------------------------------------------------ tables
alter table public.jobs
  add column source_duration_s double precision,
  add column source_size_bytes bigint;
alter table public.match_reels add column manifest jsonb;

create table public.tag_reels (
  tag_id uuid primary key, user_id uuid, status text, manifest jsonb,
  r2_key text);
create table public.selection_reels (
  user_id uuid primary key, status text, manifest jsonb, r2_key text);

create table public.app_roles (user_id uuid, role text);
create table public.user_quotas (
  user_id uuid primary key,
  storage_limit_bytes bigint not null default 26843545600,
  daily_upload_limit integer not null default 3);

create table public.processing_ledger (
  id bigserial primary key,
  user_id uuid not null,
  minutes integer not null,
  kind text not null check (kind in ('grant', 'purchase', 'spend', 'refund', 'adjust')),
  funding text not null default 'personal'
    check (funding in ('personal', 'order', 'sponsored')),
  billing_mode text not null default 'live' check (billing_mode in ('live', 'test')),
  match_id uuid references public.matches(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  order_id uuid references public.review_orders(id) on delete set null,
  purchase_id uuid,
  note text,
  created_at timestamptz not null default now(),
  reverses_id bigint references public.processing_ledger(id) on delete restrict
);
create unique index processing_ledger_one_reversal_idx
  on public.processing_ledger (reverses_id) where kind = 'refund';

-- Support reprocessing is open here so cut_again.sql (written before this
-- guard was stubbed) runs unchanged after the migration; cut_again_auto.sql
-- closes it, as production has it, inside its own transaction.
insert into public.app_config (key, value) values
  ('commerce_enabled', 'true'),
  ('free_processing_minutes', '250'),
  ('match_reprocessing_enabled', 'true')
on conflict (key) do update set value = excluded.value;

-- ----------------------------------------------- charging (production's)
create function public._commerce_on()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select value from public.app_config
                   where key = 'commerce_enabled'), 'false') = 'true';
$function$;

create function public._commerce_int(p_key text, p_fallback integer)
 returns integer language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    nullif(regexp_replace(coalesce(
      (select value from public.app_config where key = p_key), ''),
      '[^0-9-]', '', 'g'), '')::integer,
    p_fallback);
$function$;

create function public.is_qa(p_user uuid default auth.uid())
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.app_roles
    where user_id = p_user and role = 'qa'
  );
$function$;

create function public.default_storage_bytes_for(p_user uuid)
returns bigint language sql stable as $$ select 26843545600::bigint $$;

create function public._ensure_quota(uid uuid)
 returns void language sql security definer set search_path to 'public'
as $function$
  insert into public.user_quotas (user_id, storage_limit_bytes)
  values (uid, public.default_storage_bytes_for(uid))
  on conflict (user_id) do nothing;
$function$;

create function public._ensure_processing_grant(p_user uuid, p_mode text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.processing_ledger
    where user_id = p_user and billing_mode = p_mode and kind = 'grant'
  ) then
    insert into public.processing_ledger
      (user_id, minutes, kind, funding, billing_mode, note)
    values
      (p_user, public._commerce_int('free_processing_minutes', 250),
       'grant', 'personal', p_mode, 'free allowance');
  end if;
end;
$function$;

create function public._processing_balance(p_user uuid, p_mode text)
 returns integer language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(sum(minutes), 0)::integer
  from public.processing_ledger
  where user_id = p_user
    and billing_mode = p_mode
    and funding = 'personal';
$function$;

create function public.claim_processing(p_match_id uuid, p_trim_start_s double precision DEFAULT NULL::double precision, p_trim_end_s double precision DEFAULT NULL::double precision, p_points boolean DEFAULT true, p_placement boolean DEFAULT false, p_strictness text DEFAULT 'normal'::text, p_order_id uuid DEFAULT NULL::uuid, p_as_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me      uuid;
  v_mode    text;
  v_match   public.matches%rowtype;
  v_order   public.review_orders%rowtype;
  v_start   double precision;
  v_end     double precision;
  v_charge  integer;
  v_funding text := 'personal';
  v_active  integer;
  v_job     uuid;
  v_source_size bigint;
begin
  if p_as_user is not null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_me := p_as_user;
  else
    v_me := auth.uid();
  end if;
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;
  if p_strictness not in ('tight', 'normal', 'loose') then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_match.status not in ('uploaded', 'failed') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if v_match.raw_path is null
     or v_match.raw_path not like 'r2://ponglens-raw/' || v_me || '/%' then
    raise exception 'no_source' using errcode = 'P0001';
  end if;
  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;

  v_start := greatest(coalesce(p_trim_start_s, 0), 0);
  v_end := least(coalesce(p_trim_end_s, v_match.duration_s),
                 v_match.duration_s);
  if v_end - v_start < 5 then
    raise exception 'trim_too_short' using errcode = 'P0001';
  end if;
  v_charge := greatest(1, ceil((v_end - v_start) / 60.0))::integer;

  if exists (
    select 1 from public.jobs j
    where (j.options ->> 'match_id')::uuid = p_match_id
      and j.kind <> 'content_check'
      and j.status in ('queued', 'processing')
  ) then
    raise exception 'already_processing' using errcode = 'P0001';
  end if;

  select count(*) into v_active from public.jobs j
   where j.user_id = v_me
     and j.status in ('queued', 'processing')
     and j.kind not in ('reclip', 'content_check');
  if v_active >= 4 then
    raise exception 'queue_full' using errcode = 'P0001';
  end if;

  if p_order_id is not null then
    select * into v_order from public.review_orders
     where id = p_order_id and student_id = v_me
     for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if v_order.status not in ('awaiting_submission', 'submitted',
                              'in_review', 'clarification') then
      raise exception 'bad_state' using errcode = 'P0001';
    end if;
    if v_charge > public._commerce_int('review_included_minutes', 45) then
      raise exception 'over_review_limit' using errcode = 'P0001';
    end if;
    v_funding := 'order';
    v_mode := v_order.billing_mode;
  else
    v_mode := case when public.is_qa(v_me) then 'test' else 'live' end;
    perform public._ensure_processing_grant(v_me, v_mode);
    perform public._ensure_quota(v_me);
    perform 1 from public.user_quotas where user_id = v_me for update;
    if public._processing_balance(v_me, v_mode) < v_charge then
      raise exception 'insufficient_minutes' using errcode = 'P0001';
    end if;
  end if;

  select sum(l.bytes)::bigint into v_source_size
    from public.storage_ledger l
   where l.user_id = v_me
     and l.match_id = p_match_id
     and l.r2_key = v_match.raw_path
     and l.kind = 'other';
  if v_source_size is not null and v_source_size <= 0 then
    v_source_size := null;
  end if;

  insert into public.jobs
    (user_id, kind, status, input_path, original_name, options,
     source_duration_s, source_size_bytes)
  values
    (v_me, 'deadspace_cut', 'queued', v_match.raw_path,
     v_match.original_name,
     jsonb_build_object(
       'match_id', p_match_id,
       'trim_start_s', v_start,
       'trim_end_s', v_end,
       'points', true,
       'placement', p_placement,
       'strictness', p_strictness,
       'funding', v_funding,
       'order_id', p_order_id,
       'charged_minutes', v_charge),
     v_end - v_start, v_source_size)
  returning id into v_job;

  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode,
     match_id, job_id, order_id)
  values
    (v_me, -v_charge, 'spend', v_funding, v_mode,
     p_match_id, v_job, p_order_id);

  return jsonb_build_object(
    'job_id', v_job,
    'charged_minutes', v_charge,
    'funding', v_funding);
end;
$function$;

-- ----------------------------------- the match_reprocess guards (production's)
create function public.match_reprocessing_enabled(p_owner_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select
    coalesce((
      select value = 'true'
      from public.app_config
      where key = 'match_reprocessing_enabled'
    ), false)
    or public.is_admin()
    or coalesce(auth.role(), '') = 'service_role';
$function$;

create function public.guard_reprocess_job_client()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated','anon') and (new.kind='match_reprocess' or (tg_op='UPDATE' and old.kind='match_reprocess')) then
    raise exception 'reprocessing jobs are admin-managed' using errcode='42501';
  end if;
  return new;
end $function$;
create trigger jobs_guard_reprocess_client before insert or update on public.jobs
  for each row execute function public.guard_reprocess_job_client();

-- Production's before this migration; the migration replaces it.
create function public.guard_match_reprocess_job_rollout()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if (new.kind = 'match_reprocess'
    or (tg_op='UPDATE' and old.kind='match_reprocess'))
    and not public.match_reprocessing_enabled(new.user_id) then
    -- The Mac worker uses a direct database connection, without a JWT. An
    -- already-approved QA job still has to report progress and finish while
    -- owner submission is disabled. Do not make this function SECURITY
    -- DEFINER: that would make every caller appear to be the table owner.
    if tg_op='UPDATE'
      and coalesce(auth.role(),'')=''
      and (current_user='service_role' or current_user=(
        select pg_get_userbyid(relowner) from pg_class where oid='public.jobs'::regclass
      ))
      and old.kind='match_reprocess' and old.status in ('queued','processing')
      and (to_jsonb(new)-array['status','progress','result_path','error','user_message','updated_at'])
        = (to_jsonb(old)-array['status','progress','result_path','error','user_message','updated_at'])
      and exists (
        select 1 from public.match_processing_feedback i
        join public.match_processing_versions v on v.id=i.replacement_version_id
        join public.matches m on m.id=i.match_id
        where i.replacement_job_id=old.id and v.job_id=old.id
          and v.issue_id=i.id and v.match_id=m.id and m.user_id=old.user_id and i.owner_id=old.user_id
          and v.source_version_id=i.source_version_id and m.active_processing_version_id=v.source_version_id
          and v.id::text=old.options->>'processing_version_id'
          and i.id::text=old.options->>'issue_id' and m.id::text=old.options->>'match_id'
          and v.status in ('candidate','ready','failed')
          and i.status in ('reprocess_queued','reprocessing','candidate_ready','execution_failed')
      ) then
      return new;
    end if;
    raise exception 'match reprocessing is not enabled' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;
create trigger jobs_guard_reprocess_rollout before insert or update on public.jobs
  for each row execute function public.guard_match_reprocess_job_rollout();
