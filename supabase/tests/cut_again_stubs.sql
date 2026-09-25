-- What 20260925124616_cut_again.sql needs on top of the device hand-cut
-- stubs, for a bare Postgres (no Supabase, no pgmq). The processing-version
-- layer is production's, copied as it was on 2026-09-25 (the tables, the
-- initialize and check triggers, the score-stale triggers, request_reclip,
-- _ledger_negate_keys, match_reprocess_source, the player's processing
-- feed). The functions the migration replaces whole (the activation, the
-- sync, the two share resolvers, the storage trigger,
-- normalize_manual_cut_observations, admin_start_match_reprocess) are
-- placeholders or absent here: the migration's own definitions are what
-- the tests run. Everything else is a stand-in that
-- records what it was asked.
--
--   docker run -d --name ca-server-pg -e POSTGRES_PASSWORD=x postgres:17-alpine
--   for f in supabase/tests/device_hand_cut_stubs.sql \
--            supabase/migrations/20260925061009_device_hand_cut.sql \
--            supabase/migrations/20260925105830_device_hand_cut_silent_handoff.sql \
--            supabase/tests/cut_again_stubs.sql \
--            supabase/migrations/20260925124616_cut_again.sql \
--            supabase/tests/cut_again.sql; do
--     docker exec -i ca-server-pg psql -q -v ON_ERROR_STOP=1 -U postgres < "$f"
--   done
--   docker rm -f ca-server-pg
\set ON_ERROR_STOP on

create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
$$;

-- ------------------------------------------------------------------ tables
alter table public.matches
  add column thumb_path text,
  add column match_json_path text,
  add column story_crop jsonb,
  add column match_structure jsonb,
  add column placement_status text not null default 'not_requested',
  add column placement_mapped_points integer not null default 0,
  add column placement_failure_code text,
  add column placement_flagged boolean not null default false,
  add column placement_retry_count smallint not null default 0,
  add column placement_retry_expires_at timestamptz,
  add column placement_retry_job_id uuid,
  add column placement_generation_job_id uuid,
  add column spoken_scores jsonb,
  add column first_server text,
  add column first_server_source text,
  add column opponent_name text,
  add column venue text,
  add column match_type text,
  add column played_at timestamptz not null default now(),
  add column user_side text,
  add column player_near_name text,
  add column player_far_name text,
  add column source_fps double precision,
  add column score_revision bigint not null default 0,
  add column score_projection_revision bigint not null default 0,
  add column score_projection_status text not null default 'empty',
  add column score_projection_error text,
  add column score_projection_updated_at timestamptz,
  add column is_sample boolean not null default false,
  add column created_at timestamptz not null default now();
alter table public.matches alter column id set default gen_random_uuid();

alter table public.hand_cut_drafts add column mode text check (mode in ('cut', 'score'));
alter table public.notifications add column match_id uuid;

create table public.match_processing_feedback (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  source_job_id uuid,
  owner_id uuid,
  kind text not null,
  status text not null,
  source_version_id uuid,
  replacement_version_id uuid,
  replacement_job_id uuid,
  internal_note text,
  updated_at timestamptz not null default now()
);

create table public.match_processing_versions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade deferrable initially deferred,
  source_version_id uuid,
  source_job_id uuid references public.jobs(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  issue_id uuid references public.match_processing_feedback(id) on delete set null,
  status text not null check(status in ('candidate','ready','active','superseded','failed')),
  raw_path text,
  cut_path text,
  thumb_path text,
  match_json_path text,
  release_id text,
  settings jsonb not null default '{}' check(jsonb_typeof(settings)='object'),
  match_state jsonb not null default '{}' check(jsonb_typeof(match_state)='object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  unique(match_id,id),
  foreign key(match_id,source_version_id) references public.match_processing_versions(match_id,id) deferrable initially deferred
);
create unique index match_processing_versions_one_active on public.match_processing_versions(match_id) where status='active';
create unique index match_processing_versions_one_candidate on public.match_processing_versions(issue_id) where status in ('candidate','ready');

create table public.match_processing_version_reels (
  version_id uuid not null references public.match_processing_versions(id) on delete cascade,
  scope text not null,
  record jsonb not null,
  primary key(version_id,scope)
);

drop table public.points;
create table public.points (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  processing_version_id uuid not null,
  idx integer not null,
  t0 numeric,
  t1 numeric,
  cut_t0 numeric,
  clip_path text,
  deleted boolean not null default false,
  edited boolean not null default false,
  is_let boolean not null default false,
  confirmed_winner text check (confirmed_winner in ('user', 'opponent')),
  confirmed_how text,
  starred boolean not null default false,
  server_override text,
  game_end_override text,
  game_winner_override text,
  timing_revision bigint not null default 0,
  placement jsonb,
  placement_flagged boolean,
  constraint points_let_never_scored check (not (is_let and confirmed_winner is not null)),
  constraint points_version_idx_key unique (processing_version_id, idx),
  constraint points_version_match_fk foreign key (match_id, processing_version_id)
    references public.match_processing_versions(match_id, id) deferrable initially deferred
);

create table public.storage_ledger (
  id bigserial primary key,
  user_id uuid not null,
  match_id uuid references public.matches(id) on delete set null,
  kind text not null check (kind in ('clip', 'cut', 'voice', 'reel', 'other')),
  bytes bigint not null,
  r2_key text,
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  point_id uuid references public.points(id) on delete cascade,
  body text,
  audio_path text
);

create table public.review_orders (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete set null,
  status text not null
);

create table public.tags (id uuid primary key default gen_random_uuid(),
                          label text);

create table public.share_links (
  token text primary key,
  match_id uuid references public.matches(id) on delete cascade,
  point_id uuid references public.points(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  title text,
  kind text not null,
  revoked_at timestamptz,
  show_score boolean not null default true
);

create table public.match_reels (
  match_id uuid not null references public.matches(id) on delete cascade,
  scope text not null,
  status text not null,
  error text,
  r2_key text,
  duration_s double precision,
  size_bytes bigint,
  primary key (match_id, scope)
);

create table public.match_score_mutations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique not null,
  match_id uuid not null references public.matches(id) on delete cascade,
  actor_id uuid,
  authority_scope text not null,
  action text not null,
  affected_point_ids uuid[],
  before_state jsonb not null,
  after_state jsonb not null,
  base_revision bigint not null check (base_revision >= 0),
  result_revision bigint not null,
  check (result_revision > base_revision)
);

create table public.point_timing_observations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  point_id uuid references public.points(id) on delete set null,
  kind text not null,
  source_s numeric not null,
  origin text not null,
  authority_scope text not null,
  timing_revision bigint not null,
  media_kind text not null,
  media_revision uuid,
  media_local_s numeric,
  reaction_meta jsonb not null,
  eligible_for_training boolean,
  eligible_for_playback boolean,
  created_by uuid,
  invalidated_at timestamptz,
  invalidated_reason text,
  unique (point_id, kind, origin, timing_revision)
);

-- ------------------------------------------------ the version layer (prod)
create function public.initialize_match_processing_version()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if new.active_processing_version_id is not null then
    raise exception 'active version is database-owned' using errcode='42501';
  end if;
  insert into public.match_processing_versions(match_id,source_job_id,job_id,status,raw_path,cut_path,thumb_path,match_json_path,settings,release_id,match_state,activated_at)
  values(new.id,new.job_id,new.job_id,'active',coalesce(new.raw_path,(select input_path from public.jobs where id=new.job_id)),coalesce(new.cut_path,(select result_path from public.jobs where id=new.job_id and status='done')),new.thumb_path,new.match_json_path,
    coalesce((select options from public.jobs where id=new.job_id),'{}'),
    (select coalesce(options->>'release_id',options->>'processing_release') from public.jobs where id=new.job_id),to_jsonb(new),now()) returning id into v_id;
  new.active_processing_version_id:=v_id;
  return new;
end $function$;
create trigger matches_initialize_processing_version before insert on public.matches
  for each row execute function public.initialize_match_processing_version();

create function public.check_active_match_processing_version()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_match uuid;
begin
  v_match:=case when tg_table_name='matches' then (to_jsonb(new)->>'id')::uuid else coalesce(to_jsonb(new)->>'match_id',to_jsonb(old)->>'match_id')::uuid end;
  if exists(select 1 from public.matches m where m.id=v_match and not exists(
    select 1 from public.match_processing_versions v where v.id=m.active_processing_version_id and v.match_id=m.id and v.status='active')) then
    raise exception 'match must have its own active version' using errcode='23514';
  end if;
  return null;
end $function$;
create constraint trigger matches_check_active_version after insert or update on public.matches
  deferrable initially deferred for each row execute function public.check_active_match_processing_version();
create constraint trigger versions_check_active_match after insert or delete or update on public.match_processing_versions
  deferrable initially deferred for each row execute function public.check_active_match_processing_version();

-- Replaced by the migration; the trigger is production's.
create function public.sync_active_match_processing_version() returns trigger
language plpgsql as $$ begin return new; end $$;
create trigger matches_sync_processing_version after update on public.matches
  for each row execute function public.sync_active_match_processing_version();

create function public.require_active_match_points(p_match_id uuid)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  select active_processing_version_id into v_id from public.matches where id=p_match_id for share;
  if v_id is null then raise exception 'match not found' using errcode='P0002'; end if;
  return v_id;
end $function$;

create function public.active_point_version(p_point_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists(select 1 from public.points p join public.matches m on m.id=p.match_id where p.id=p_point_id and p.processing_version_id=m.active_processing_version_id)
$function$;

create function public.request_reclip(p_match_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_user uuid; v_version uuid;
begin
  select user_id,active_processing_version_id into v_user,v_version from public.matches where id=p_match_id for share;
  if v_user is null then return; end if;
  if auth.role()='authenticated' and v_user<>auth.uid() then raise exception 'not authorized' using errcode='42501'; end if;
  insert into public.jobs(user_id,kind,status,input_path,original_name,options)
  values(v_user,'reclip','queued',null,'Clip update',jsonb_build_object('match_id',p_match_id,'processing_version_id',v_version));
end $function$;

create function public.request_reclip_for_point()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.edited and not new.deleted and new.t0 is not null and new.t1 is not null
    and public.active_point_version(new.id) then perform public.request_reclip(new.match_id); end if;
  return null;
end $function$;
create trigger points_request_reclip after insert or update of t0, t1, edited, deleted on public.points
  for each row when (new.edited and not new.deleted) execute function public.request_reclip_for_point();

-- The canonical score: production's stale markers, and a stand-in rebuild
-- that says 'current' when the live version has points and 'empty' when
-- it has none.
create function public.refresh_match_score_state(p_match_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_rev bigint;
begin
  update public.matches m
     set score_projection_revision = m.score_revision,
         score_projection_status = case when exists (
               select 1 from public.points p
                where p.match_id = m.id
                  and p.processing_version_id = m.active_processing_version_id
                  and not p.deleted) then 'current' else 'empty' end,
         score_projection_updated_at = clock_timestamp()
   where m.id = p_match_id
  returning score_revision into v_rev;
  return v_rev;
end $$;

create function public.mark_match_score_stale_from_match()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.first_server is not distinct from old.first_server
     and new.first_server_source is not distinct from old.first_server_source
     and new.active_processing_version_id is not distinct from old.active_processing_version_id then
    return new;
  end if;
  update public.matches
     set score_revision = score_revision + 1,
         score_projection_status = 'stale',
         score_projection_error = null
   where id = new.id;
  return new;
end;
$function$;
create trigger match_score_input_revision after update of first_server, first_server_source, active_processing_version_id on public.matches
  for each row execute function public.mark_match_score_stale_from_match();

create function public.refresh_match_score_shadow_now()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if current_setting('ponglens.atomic_score_command', true) = 'on' then
    return null;
  end if;
  begin
    perform public.refresh_match_score_state(new.id);
  exception when others then
    update public.matches
       set score_projection_status = 'error',
           score_projection_error = left(sqlerrm, 500),
           score_projection_updated_at = clock_timestamp()
     where id = new.id;
  end;
  return null;
end;
$function$;
create trigger match_score_shadow_refresh after update of first_server, first_server_source, active_processing_version_id on public.matches
  for each row execute function public.refresh_match_score_shadow_now();

create function public.mark_match_score_stale_from_point()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_match_id uuid := case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  v_version_id uuid := case when tg_op = 'DELETE' then old.processing_version_id
                            else new.processing_version_id end;
begin
  if not exists (
    select 1 from public.matches m
     where m.id = v_match_id
       and m.active_processing_version_id = v_version_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  update public.matches
     set score_revision = score_revision + 1,
         score_projection_status = 'stale',
         score_projection_error = null
   where id = v_match_id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;
create trigger point_score_input_insert_delete_revision after insert or delete on public.points
  for each row execute function public.mark_match_score_stale_from_point();

-- Production's, simplified to the owner's bell (no coach fan-out).
create function public._vs_suffix(opponent text)
 returns text language sql immutable
as $function$
  select case
    when coalesce(btrim(opponent), '') <> '' then ' vs ' || btrim(opponent)
    else ''
  end;
$function$;
create function public.matches_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'ready' then
    insert into public.notifications (user_id, kind, match_id, title, body, href)
    values (new.user_id, 'match_ready', new.id, 'Match ready',
            'Your match' || public._vs_suffix(new.opponent_name)
              || ' is cut into points and ready to review.',
            '/match/' || new.id::text);
  end if;
  return new;
end $$;
create trigger matches_notify_status after update of status on public.matches
  for each row execute function public.matches_notify();

-- Replaced by the migration.
create function public.activate_match_processing_version(p_match_id uuid, p_version_id uuid)
returns void language plpgsql as $$ begin raise exception 'stub'; end $$;

-- --------------------------------------------------------- storage (prod)
create function public._ledger_negate_keys(p_keys text[])
 returns integer language sql security definer set search_path to 'public'
as $function$
  with bal as (
    select user_id, kind, r2_key, sum(bytes) as net
    from public.storage_ledger
    where r2_key = any (p_keys)
    group by user_id, kind, r2_key
    having sum(bytes) > 0
  ),
  ins as (
    insert into public.storage_ledger (user_id, kind, bytes, r2_key)
    select user_id, kind, -net, r2_key from bal
    returning 1
  )
  select count(*)::int from ins;
$function$;

-- Replaced by the migration; the trigger is production's.
create function public.ledger_on_match_delete() returns trigger
language plpgsql as $$ begin return old; end $$;
create trigger matches_ledger_on_delete before delete on public.matches
  for each row execute function public.ledger_on_match_delete();

-- ------------------------------------------------ support reprocessing
create function public.admin_match_issue_detail(p_issue_id uuid)
returns jsonb language sql stable as $$ select jsonb_build_object('id', p_issue_id) $$;
create function public.record_match_version_event(p_issue_id uuid, p_kind text,
  p_player_note text, p_internal_note text, p_metadata jsonb)
returns void language sql as $$ select $$;
create function public.match_reprocess_source(p_match_id uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select case
    when m.cut_source = 'manual' then null
    when m.raw_path ~ ('^r2://[^/]+/'||m.user_id::text||'/.+') then m.raw_path
    when j.user_id=m.user_id and j.input_path ~ ('^r2://[^/]+/'||m.user_id::text||'/.+') then j.input_path
    else null end
  from public.matches m left join public.jobs j on j.id=m.job_id where m.id=p_match_id
$function$;

-- ------------------------------------------- the player's processing feed
-- Production's (pulled 2026-09-25) in place of the device stubs' stand-in,
-- so the test proves which job a running re-cut reports.
alter table public.worker_pulse add column stage text;
create table public.match_video_checks (
  match_id uuid, job_id uuid, checked_at timestamptz,
  window_start_s numeric, window_end_s numeric, result jsonb);
create function public.processing_lane_status(p_lane text)
returns text language sql stable as $$ select 'running'::text $$;
create or replace function public._my_match_processing_feedback_before_estimates(p_match_ids uuid[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with lane_states as (
    select public.processing_lane_status('main') as main,
      public.processing_lane_status('hand') as hand
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'match_id',m.id,'job_id',j.id,'job_status',j.status,'job_kind',j.kind,
    'stage',case when j.status in ('queued','processing') and p.beat_at >= now()-interval '90 seconds' then p.stage end,
    'worker_state',case when j.id is null then null when p.worker_id is null then 'missing'
      when p.beat_at < now()-interval '90 seconds' then 'silent' else 'fresh' end,
    'checked_at',c.checked_at,'window_start_s',c.window_start_s,'window_end_s',c.window_end_s,'camera_check',c.result,
    'service_state',case when j.id is null then null when j.kind='hand_cut' then s.hand else s.main end,
    'lane',case when j.id is null then null when j.kind='hand_cut' then 'hand' else 'main' end
  )),'[]'::jsonb)
  from public.matches m
  cross join lane_states s
  left join lateral (
    select x.* from public.jobs x where x.user_id=m.user_id
      and (x.options->>'match_id'=m.id::text or x.id=m.job_id)
      and x.kind in ('deadspace_cut','youtube_import','hand_cut','content_check')
    order by case when x.status in ('queued','processing') and x.kind <> 'content_check' then 0
      when x.kind <> 'content_check' then 1 else 2 end,x.created_at desc,x.id desc limit 1
  ) j on true
  left join lateral (
    select x.* from public.worker_pulse x where x.job_id=j.id order by x.beat_at desc limit 1
  ) p on true
  left join lateral (
    select x.* from public.match_video_checks x where x.match_id=m.id
    order by (x.job_id=j.id) desc,x.checked_at desc limit 1
  ) c on true
  where m.user_id=auth.uid() and m.id=any(p_match_ids[1:100]);
$function$;

-- ------------------------------------------------ rows for the backfill
-- They exist before the migration adds the column: one hand-cut match,
-- one automatic, and a superseded version whose snapshot says manual.
insert into auth.users (id, email)
values ('dddddddd-0000-4000-8000-000000000004', 'backfill@example.com');
insert into public.matches (id, user_id, status, cut_source) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000004', 'uploaded', 'manual'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000004', 'uploaded', 'auto');
insert into public.match_processing_versions (match_id, status, match_state, completed_at)
values ('eeeeeeee-0000-4000-8000-000000000002', 'superseded',
        '{"cut_source": "manual"}', now());
