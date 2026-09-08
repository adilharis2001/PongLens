-- Processing artifacts have a recoverable identity. The matches row remains
-- the active projection for old web/iOS clients. No point IDs are replaced.
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
alter table public.match_processing_versions enable row level security;
revoke all on public.match_processing_versions from public,anon,authenticated;
grant all on public.match_processing_versions to service_role;

alter table public.matches add column active_processing_version_id uuid;
alter table public.matches add constraint matches_active_version_match_fk foreign key(id,active_processing_version_id)
  references public.match_processing_versions(match_id,id) deferrable initially deferred;
alter table public.points add column processing_version_id uuid;
alter table public.points add constraint points_version_match_fk foreign key(match_id,processing_version_id)
  references public.match_processing_versions(match_id,id) deferrable initially deferred;

-- Include raw/processing matches too, so old workers can keep inserting points
-- without a new required parameter. Historical completion time stays unknown.
insert into public.match_processing_versions(match_id,source_job_id,job_id,status,raw_path,cut_path,thumb_path,match_json_path,settings,release_id,match_state,created_at,activated_at)
select m.id,m.job_id,m.job_id,'active',coalesce(m.raw_path,j.input_path),coalesce(m.cut_path,case when j.status='done' then j.result_path end),m.thumb_path,m.match_json_path,
  coalesce(j.options,'{}'),coalesce(j.options->>'release_id',j.options->>'processing_release'),to_jsonb(m),m.created_at,now()
from public.matches m left join public.jobs j on j.id=m.job_id;
update public.matches m set active_processing_version_id=v.id from public.match_processing_versions v where v.match_id=m.id and v.status='active';
update public.points p set processing_version_id=m.active_processing_version_id from public.matches m where m.id=p.match_id;
-- Flush deferred FK work before ALTER TABLE on a populated installation.
set constraints all immediate;
set constraints all deferred;
alter table public.points alter column processing_version_id set not null;
alter table public.points drop constraint points_match_id_idx_key;
alter table public.points add constraint points_version_idx_key unique(processing_version_id,idx);
create index points_version_match_idx on public.points(match_id,processing_version_id);

alter table public.match_processing_feedback add column source_version_id uuid;
alter table public.match_processing_feedback add column replacement_version_id uuid;
alter table public.match_processing_feedback add column replacement_job_id uuid references public.jobs(id) on delete set null;
alter table public.match_processing_feedback add constraint issue_source_version_match_fk foreign key(match_id,source_version_id)
  references public.match_processing_versions(match_id,id) deferrable initially deferred;
alter table public.match_processing_feedback add constraint issue_replacement_version_match_fk foreign key(match_id,replacement_version_id)
  references public.match_processing_versions(match_id,id) deferrable initially deferred;
update public.match_processing_feedback i set source_version_id=m.active_processing_version_id from public.matches m where m.id=i.match_id;
set constraints all immediate;
set constraints all deferred;

-- Archive derived renders before the active projection is invalidated. Their
-- object references remain reachable even when the current cache is rebuilt.
create table public.match_processing_version_reels (
  version_id uuid not null references public.match_processing_versions(id) on delete cascade,
  scope text not null,
  record jsonb not null,
  primary key(version_id,scope)
);
alter table public.match_processing_version_reels enable row level security;
revoke all on public.match_processing_version_reels from public,anon,authenticated;
grant all on public.match_processing_version_reels to service_role;

create function public.initialize_match_processing_version() returns trigger
language plpgsql security definer set search_path=public as $$
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
end $$;
create trigger matches_initialize_processing_version before insert on public.matches for each row execute function public.initialize_match_processing_version();

create function public.sync_active_match_processing_version() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_same_version boolean := old.active_processing_version_id is not distinct from new.active_processing_version_id;
  v_new_execution boolean := v_same_version and new.job_id is not null and old.job_id is distinct from new.job_id;
  v_sync_provenance boolean := v_same_version and (v_new_execution or old.status is distinct from 'ready');
begin
  -- Publishing/restoring projects an already executed version onto matches;
  -- it must never replace worker provenance with the queued request. Completed
  -- and historical ready versions also retain those facts on metadata edits.
  -- Ordinary in-flight processing still follows editable job options, while
  -- a genuinely new job starts fresh (job deletion is not a new execution).
  update public.match_processing_versions set job_id=new.job_id,raw_path=coalesce(new.raw_path,(select input_path from public.jobs where id=new.job_id)),cut_path=coalesce(new.cut_path,(select result_path from public.jobs where id=new.job_id and status='done')),
    thumb_path=new.thumb_path,match_json_path=new.match_json_path,match_state=to_jsonb(new),
    settings=case when v_sync_provenance and (v_new_execution or completed_at is null)
      then coalesce((select options from public.jobs where id=new.job_id),case when v_new_execution then '{}'::jsonb else settings end)
      else settings end,
    release_id=case when v_sync_provenance and (v_new_execution or completed_at is null)
      then coalesce((select coalesce(options->>'release_id',options->>'processing_release') from public.jobs where id=new.job_id),case when not v_new_execution then release_id end)
      else release_id end,
    completed_at=case
      when v_new_execution then case when new.status='ready' then now() end
      when v_same_version and completed_at is null and old.status is distinct from 'ready' and new.status='ready' then now()
      else completed_at end
  where id=new.active_processing_version_id and status='active';
  return new;
end $$;
create trigger matches_sync_processing_version after update on public.matches for each row execute function public.sync_active_match_processing_version();

create function public.check_active_match_processing_version() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_match uuid;
begin
  v_match:=case when tg_table_name='matches' then (to_jsonb(new)->>'id')::uuid else coalesce(to_jsonb(new)->>'match_id',to_jsonb(old)->>'match_id')::uuid end;
  if exists(select 1 from public.matches m where m.id=v_match and not exists(
    select 1 from public.match_processing_versions v where v.id=m.active_processing_version_id and v.match_id=m.id and v.status='active')) then
    raise exception 'match must have its own active version' using errcode='23514';
  end if;
  return null;
end $$;
create constraint trigger matches_check_active_version after insert or update on public.matches deferrable initially deferred for each row execute function public.check_active_match_processing_version();
create constraint trigger versions_check_active_match after insert or update or delete on public.match_processing_versions deferrable initially deferred for each row execute function public.check_active_match_processing_version();

create function public.active_point_version(p_point_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.points p join public.matches m on m.id=p.match_id where p.id=p_point_id and p.processing_version_id=m.active_processing_version_id)
$$;
revoke all on function public.active_point_version(uuid) from public,anon;
grant execute on function public.active_point_version(uuid) to authenticated,service_role;

-- Row-share lock makes a user edit and a publication mutually ordered. This
-- helper checks JWT identity even when called inside a SECURITY DEFINER RPC.
create function public.require_active_match_points(p_match_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if auth.role()='authenticated' and not public.has_match_access(p_match_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select active_processing_version_id into v_id from public.matches where id=p_match_id for share;
  if v_id is null then raise exception 'match not found' using errcode='P0002'; end if;
  return v_id;
end $$;
create function public.require_active_point(p_point_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_match uuid; v_version uuid; v_active uuid;
begin
  if p_point_id is null then return; end if;
  select match_id,processing_version_id into v_match,v_version from public.points where id=p_point_id;
  if v_match is null then raise exception 'point not found' using errcode='P0002'; end if;
  v_active:=public.require_active_match_points(v_match);
  if v_version is distinct from v_active then raise exception 'point belongs to an inactive version' using errcode='55000'; end if;
end $$;
revoke all on function public.require_active_match_points(uuid),public.require_active_point(uuid) from public,anon,authenticated;

create function public.guard_point_processing_version() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    if new.processing_version_id is null then
      new.processing_version_id:=public.require_active_match_points(new.match_id);
    end if;
    if auth.role()='authenticated' and new.processing_version_id is distinct from public.require_active_match_points(new.match_id) then
      raise exception 'point belongs to an inactive version' using errcode='55000';
    end if;
    return new;
  end if;
  if tg_op='UPDATE' and (new.processing_version_id is distinct from old.processing_version_id or new.match_id is distinct from old.match_id) then
    raise exception 'point version is immutable' using errcode='42501';
  end if;
  -- A parent match/account deletion must still cascade, including old versions.
  if auth.role()='authenticated' and exists(select 1 from public.matches where id=old.match_id) then
    perform public.require_active_point(old.id);
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger a_points_version_guard before insert or update or delete on public.points for each row execute function public.guard_point_processing_version();

drop policy "Match viewers can view points" on public.points;
create policy "Match viewers can view points" on public.points for select to authenticated
  using(public.active_point_version(id) and (public.has_match_access(match_id) or public.point_in_completed_review(id)));

create function public.guard_point_dependent_version() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_old uuid; v_new uuid;
begin
  if auth.role()<>'authenticated' or auth.role() is null then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op<>'INSERT' then v_old:=nullif(to_jsonb(old)->>tg_argv[0],'')::uuid; end if;
  if tg_op<>'DELETE' then v_new:=nullif(to_jsonb(new)->>tg_argv[0],'')::uuid; end if;
  -- Cascades after the point/match disappeared remain legal.
  if v_old is not null and exists(select 1 from public.points p join public.matches m on m.id=p.match_id where p.id=v_old) then perform public.require_active_point(v_old); end if;
  if v_new is not null then perform public.require_active_point(v_new); end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger notes_active_point_guard before insert or update or delete on public.notes for each row execute function public.guard_point_dependent_version('point_id');
create trigger tags_active_point_guard before insert or update or delete on public.point_tags for each row execute function public.guard_point_dependent_version('point_id');
create trigger drawings_active_point_guard before insert or update or delete on public.review_findings for each row execute function public.guard_point_dependent_version('image_point_id');
create trigger findings_active_point_guard before insert or update or delete on public.review_finding_points for each row execute function public.guard_point_dependent_version('point_id');
-- Existing point shares stay revocable. Only creating/repointing a link needs
-- active points; its read resolver deliberately preserves old named points.
create trigger shares_active_point_guard before insert or update of point_id,match_id on public.share_links for each row execute function public.guard_point_dependent_version('point_id');
drop policy "Match viewers can view notes" on public.notes;
create policy "Match viewers can view notes" on public.notes for select to authenticated using(public.has_match_access(match_id) and (point_id is null or public.active_point_version(point_id)));

-- Explicit mutation guards, including both Modify operations (the shipped RPC
-- names are split_point and merge_points, not modify_split/modify_join).
do $$
declare r record; definition text; guard text;
begin
  for r in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('adjust_point','split_point','unsplit_point','insert_point','merge_points','set_server_override') loop
    guard:=case r.proname
      when 'unsplit_point' then 'perform public.require_active_point(p_parent); perform public.require_active_point(p_child);'
      when 'insert_point' then 'perform public.require_active_point(p_prev_id); perform public.require_active_point(p_next_id);'
      when 'merge_points' then 'perform public.require_active_point(id) from unnest(p_ids) id;'
      else 'perform public.require_active_point(p_id);' end;
    definition:=pg_get_functiondef(r.oid);
    if position(E'\nbegin\n' in definition)=0 then raise exception 'unexpected edit definition: %',r.proname; end if;
    definition:=replace(definition,E'\nbegin\n',E'\nbegin\n  '||guard||E'\n');
    -- Match-wide idx/rotation/descendant queries must not touch retired points.
    definition:=replace(definition,'where match_id = v_match','where match_id = v_match and processing_version_id = public.require_active_match_points(v_match)');
    definition:=replace(definition,'where match_id = orig.match_id','where match_id = orig.match_id and processing_version_id = orig.processing_version_id');
    definition:=replace(definition,'where p.match_id = v_match','where p.match_id = v_match and p.processing_version_id = public.require_active_match_points(v_match)');
    definition:=replace(definition,'where p.match_id = chi.match_id','where p.match_id = chi.match_id and p.processing_version_id = chi.processing_version_id');
    execute definition;
  end loop;
end $$;

create or replace function public.request_reclip(p_match_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_version uuid;
begin
  select user_id,active_processing_version_id into v_user,v_version from public.matches where id=p_match_id for share;
  if v_user is null then return; end if;
  if auth.role()='authenticated' and v_user<>auth.uid() then raise exception 'not authorized' using errcode='42501'; end if;
  insert into public.jobs(user_id,kind,status,input_path,original_name,options)
  values(v_user,'reclip','queued',null,'Clip update',jsonb_build_object('match_id',p_match_id,'processing_version_id',v_version))
  on conflict ((options->>'match_id')) where kind='reclip' and status='queued' do nothing;
end $$;
create or replace function public.request_reclip_for_point() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.edited and not new.deleted and new.t0 is not null and new.t1 is not null
    and public.active_point_version(new.id) then perform public.request_reclip(new.match_id); end if;
  return null;
end $$;

create function public.require_active_reel_manifest(p_manifest jsonb,p_match_id uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare item jsonb; v_point uuid;
begin
  if p_match_id is not null then perform public.require_active_match_points(p_match_id); end if;
  if jsonb_typeof(p_manifest->'points') is distinct from 'array' then raise exception 'invalid manifest' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(p_manifest->'points') loop
    v_point:=nullif(item->>'point_id','')::uuid;
    if v_point is null then raise exception 'manifest needs point identities' using errcode='23514'; end if;
    perform public.require_active_point(v_point);
    if p_match_id is not null and not exists(select 1 from public.points where id=v_point and match_id=p_match_id) then raise exception 'wrong match' using errcode='23514'; end if;
  end loop;
end $$;
revoke all on function public.require_active_reel_manifest(jsonb,uuid) from public,anon,authenticated;
do $$
declare r record; definition text;
begin
  for r in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('enqueue_reel','enqueue_tag_reel') loop
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,E'\nbegin\n',E'\nbegin\n  perform public.require_active_reel_manifest(p_manifest,'||case when r.proname='enqueue_reel' then 'p_match_id' else 'null' end||E');\n');
    if r.proname='enqueue_reel' then
      definition:=replace(definition,E'\nbegin\n',$scope_guard$
begin
  if p_scope like 'v:point:%' then
    perform public.require_active_point(split_part(p_scope, ':', 3)::uuid);
    if jsonb_array_length(p_manifest->'points') is distinct from 1
      or (p_manifest->'points'->0->>'point_id')::uuid is distinct from split_part(p_scope, ':', 3)::uuid then
      raise exception 'scope must match its single-point manifest' using errcode='23514';
    end if;
  end if;
$scope_guard$);
      definition:=replace(definition,'''scope'', p_scope)', '''scope'', p_scope, ''processing_version_id'', public.require_active_match_points(p_match_id))');
    end if;
    execute definition;
  end loop;
end $$;

-- SECURITY DEFINER summary/share readers must apply the same version boundary.
do $$
declare r record; definition text;
begin
  for r in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in
    ('resolve_share_points','resolve_share_removed','resolve_share_starred','resolve_share_tagged','resolve_share_placement','starred_points') loop
    definition:=pg_get_functiondef(r.oid);
    if r.proname='starred_points' then
      definition:=replace(definition,'where not p.deleted','where public.active_point_version(p.id) and not p.deleted');
    else
      definition:=replace(definition,'where sl.token = p_token','where public.active_point_version(p.id) and sl.token = p_token');
    end if;
    execute definition;
  end loop;
  definition:=pg_get_functiondef('public.resolve_share_link(text)'::regprocedure);
  definition:=replace(definition,'where q.match_id = p.match_id','where q.match_id = p.match_id and q.processing_version_id = p.processing_version_id');
  -- Point links use their version's clocks/media, never a different active cut.
  definition:=replace(definition,E'    coalesce(\n      m.cut_path,',E'    case when p.id is not null then pv.cut_path else coalesce(\n      m.cut_path,');
  definition:=replace(definition,') as cut_path,',') end as cut_path,');
  definition:=replace(definition,E'    m.raw_path\n',E'    case when p.id is not null then pv.raw_path else m.raw_path end\n');
  definition:=replace(definition,'left join public.points p on p.id = sl.point_id','left join public.points p on p.id = sl.point_id left join public.match_processing_versions pv on pv.id=p.processing_version_id');
  execute definition;
end $$;

-- Calls from anon share resolvers execute as their owner. Do not grant anon
-- this point-existence oracle, or add is_admin() to an anon-visible policy.
create function public.match_reprocess_source(p_match_id uuid) returns text
language sql stable security definer set search_path=public as $$
  select case when m.raw_path ~ ('^r2://[^/]+/'||m.user_id::text||'/.+') then m.raw_path
    when j.user_id=m.user_id and j.input_path ~ ('^r2://[^/]+/'||m.user_id::text||'/.+') then j.input_path else null end
  from public.matches m left join public.jobs j on j.id=m.job_id where m.id=p_match_id
$$;
revoke all on function public.match_reprocess_source(uuid) from public,anon,authenticated;
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.match_issue_state(uuid)'::regprocedure);
  if position('''canReprocess'', v_is_owner and v_match.status = ''ready''' in definition)=0 then raise exception 'unexpected match issue eligibility'; end if;
  execute replace(definition,'''canReprocess'', v_is_owner and v_match.status = ''ready''', '''canReprocess'', v_is_owner and v_match.status = ''ready'' and public.match_reprocess_source(p_match_id) is not null');
end $$;
create function public.stamp_match_issue_source_version() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  select active_processing_version_id into new.source_version_id from public.matches where id=new.match_id for share;
  if new.kind='reprocess' and public.match_reprocess_source(new.match_id) is null then raise exception 'original source is not available' using errcode='P0001'; end if;
  return new;
end $$;
create trigger issue_stamp_source_version before insert on public.match_processing_feedback for each row execute function public.stamp_match_issue_source_version();

create function public.guard_reprocess_job_client() returns trigger
language plpgsql set search_path=public as $$
begin
  if current_user in ('authenticated','anon') and (new.kind='match_reprocess' or (tg_op='UPDATE' and old.kind='match_reprocess')) then
    raise exception 'reprocessing jobs are admin-managed' using errcode='42501';
  end if;
  return new;
end $$;
create trigger jobs_guard_reprocess_client before insert or update on public.jobs for each row execute function public.guard_reprocess_job_client();

create function public.admin_match_version_detail(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v public.match_processing_versions;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v from public.match_processing_versions where id=p_version_id;
  if not found then raise exception 'version not found' using errcode='P0002'; end if;
  return jsonb_build_object('version',to_jsonb(v),'points',coalesce((select jsonb_agg(to_jsonb(p) order by p.idx) from public.points p where p.processing_version_id=v.id),'[]'));
end $$;

create function public.record_match_version_event(p_issue_id uuid,p_kind text,p_player_note text,p_internal_note text,p_metadata jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; v_event uuid; v_title text;
begin
  select * into i from public.match_processing_feedback where id=p_issue_id;
  insert into public.match_processing_feedback_events(issue_id,actor_id,kind,player_note,internal_note,metadata)
  values(i.id,auth.uid(),p_kind,coalesce(p_player_note,''),coalesce(p_internal_note,''),coalesce(p_metadata,'{}')) returning id into v_event;
  v_title:=case p_kind when 'reprocess_queued' then 'Match reprocessing queued' when 'restored' then 'Previous match version restored' when 'kept_current' then 'Current match version kept' else 'Match reprocessing reviewed' end;
  insert into public.notifications(user_id,kind,match_id,actor_id,title,body,href)
  values(i.owner_id,'match_issue_updated',i.match_id,auth.uid(),v_title,nullif(p_player_note,''),'/match/'||i.match_id||'/feedback');
  if p_kind<>'reprocess_queued' then
    insert into public.match_issue_email_deliveries(issue_id,event_id,template,recipient_email)
    select i.id,v_event,'resolution',email from auth.users where id=i.owner_id and email is not null;
  end if;
end $$;
revoke all on function public.record_match_version_event(uuid,text,text,text,jsonb) from public,anon,authenticated;

create function public.admin_start_match_reprocess(p_issue_id uuid,p_options jsonb,p_internal_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; m public.matches; v public.match_processing_versions; v_candidate uuid; v_job uuid:=gen_random_uuid(); v_raw text; v_options jsonb; k text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_options) is distinct from 'object' or length(coalesce(p_internal_note,''))>4000 then raise exception 'invalid input' using errcode='23514'; end if;
  for k in select jsonb_object_keys(p_options) loop if k not in ('strictness','placement','trim_start_s','trim_end_s') then raise exception 'unsupported option' using errcode='23514'; end if; end loop;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if i.replacement_job_id is not null then return public.admin_match_issue_detail(i.id); end if;
  if i.status<>'pending' or i.kind not in ('reprocess','refund') then raise exception 'already decided' using errcode='P0001'; end if;
  select * into m from public.matches where id=i.match_id for update;
  select * into v from public.match_processing_versions where id=m.active_processing_version_id for update;
  if m.status<>'ready' or v.id is distinct from i.source_version_id or v.job_id is distinct from i.source_job_id then raise exception 'source version changed' using errcode='P0001'; end if;
  v_raw:=public.match_reprocess_source(m.id);
  if v_raw is null then raise exception 'original source is not available' using errcode='P0001'; end if;
  v_options:=jsonb_build_object('strictness',coalesce(v.settings->>'strictness','normal'),'placement',coalesce(v.settings->'placement','false'::jsonb),'trim_start_s',coalesce(v.settings->'trim_start_s','0'::jsonb),'trim_end_s',v.settings->'trim_end_s')||p_options;
  if jsonb_typeof(v_options->'strictness') is distinct from 'string' or v_options->>'strictness' not in ('tight','normal','loose') or jsonb_typeof(v_options->'placement')<>'boolean'
    or jsonb_typeof(v_options->'trim_start_s')<>'number' or (v_options->>'trim_start_s')::numeric<0
    or (v_options->'trim_end_s'<>'null'::jsonb and (jsonb_typeof(v_options->'trim_end_s')<>'number' or (v_options->>'trim_end_s')::numeric<=(v_options->>'trim_start_s')::numeric))
    or (m.duration_s is not null and ((v_options->>'trim_start_s')::numeric>=m.duration_s or (v_options->>'trim_end_s')::numeric>m.duration_s)) then
    raise exception 'invalid processing options' using errcode='23514';
  end if;
  insert into public.match_processing_versions(match_id,source_version_id,source_job_id,issue_id,status,raw_path,settings)
  values(m.id,v.id,v.job_id,i.id,'candidate',v_raw,v_options) returning id into v_candidate;
  insert into public.jobs(id,user_id,kind,status,input_path,original_name,options)
  values(v_job,m.user_id,'match_reprocess','queued',v_raw,m.original_name,v_options||jsonb_build_object('points',true,'match_id',m.id,'issue_id',i.id,'source_version_id',v.id,'processing_version_id',v_candidate,'funding','support','charged_minutes',0));
  update public.match_processing_versions set job_id=v_job where id=v_candidate;
  update public.match_processing_feedback set status='reprocess_queued',replacement_version_id=v_candidate,replacement_job_id=v_job,internal_note=trim(coalesce(p_internal_note,'')),updated_at=now() where id=i.id;
  perform public.record_match_version_event(i.id,'reprocess_queued','Your current match is still available.',p_internal_note,jsonb_build_object('versionId',v_candidate,'jobId',v_job,'settings',v_options));
  return public.admin_match_issue_detail(i.id);
end $$;

create function public.activate_match_processing_version(p_match_id uuid,p_version_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m public.matches; v public.match_processing_versions; s jsonb; v_job_status text; v_legacy boolean;
begin
  select * into m from public.matches where id=p_match_id for update;
  select * into v from public.match_processing_versions where id=p_version_id and match_id=m.id for update;
  if not found or v.status not in ('ready','superseded') or v.cut_path is null or (v.status='ready' and v.match_json_path is null) then raise exception 'version is not ready' using errcode='P0001'; end if;
  -- Both publish and restore use this completion gate. A retained original
  -- has no source version and may predate completion timestamps/job retention;
  -- its recorded ready match state is the explicit historical allowance.
  v_legacy:=v.source_version_id is null and v.status='superseded' and coalesce(v.match_state->>'status'='ready',false);
  if not v_legacy and (v.completed_at is null or v.job_id is null) then raise exception 'candidate not ready' using errcode='P0001'; end if;
  if v.job_id is not null then
    select status into v_job_status from public.jobs where id=v.job_id for update;
    if v_job_status is distinct from 'done' then raise exception 'candidate not ready' using errcode='P0001'; end if;
  end if;
  -- Old background jobs do not carry version-aware writes yet. Publication
  -- refuses an in-flight derived job rather than racing its stale write.
  if exists(select 1 from public.jobs where status in ('queued','processing') and options->>'match_id'=m.id::text and kind<>'match_reprocess') then raise exception 'match has unfinished derived work' using errcode='P0001'; end if;
  perform 1 from public.match_processing_versions where id=m.active_processing_version_id for update;
  insert into public.match_processing_version_reels(version_id,scope,record)
  select m.active_processing_version_id,r.scope,to_jsonb(r) from public.match_reels r where r.match_id=m.id
  on conflict(version_id,scope) do update set record=excluded.record;
  update public.match_reels set status='failed',error='Match version changed.' where match_id=m.id;
  update public.match_processing_versions set status='superseded',superseded_at=now() where id=m.active_processing_version_id;
  update public.match_processing_versions set status='active',activated_at=now(),superseded_at=null where id=v.id;
  s:=v.match_state;
  update public.matches set active_processing_version_id=v.id,job_id=v.job_id,raw_path=v.raw_path,cut_path=v.cut_path,thumb_path=v.thumb_path,match_json_path=v.match_json_path,
    status='ready',clip_pads=s->'clip_pads',story_crop=s->'story_crop',match_structure=s->'match_structure',
    placement_status=coalesce(s->>'placement_status','not_requested'),placement_mapped_points=coalesce((s->>'placement_mapped_points')::integer,0),
    placement_failure_code=s->>'placement_failure_code',placement_flagged=coalesce((s->>'placement_flagged')::boolean,false),
    placement_retry_count=0,placement_retry_expires_at=null,placement_retry_job_id=null,placement_generation_job_id=null,
    spoken_scores=s->'spoken_scores',first_server=s->>'first_server',first_server_source=s->>'first_server_source'
  where id=m.id;
end $$;
revoke all on function public.activate_match_processing_version(uuid,uuid) from public,anon,authenticated;

create function public.admin_publish_match_version(p_issue_id uuid,p_player_note text,p_internal_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; v_active uuid;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_player_note,''))) not between 1 and 1000 or length(coalesce(p_internal_note,''))>4000 then raise exception 'invalid decision notes' using errcode='23514'; end if;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if i.status='resolved_reprocessed' then return public.admin_match_issue_detail(i.id); end if;
  if i.status<>'candidate_ready' then raise exception 'candidate not ready' using errcode='P0001'; end if;
  select active_processing_version_id into v_active from public.matches where id=i.match_id for update;
  if v_active is distinct from i.source_version_id then raise exception 'source version changed' using errcode='P0001'; end if;
  perform 1 from public.match_processing_versions v
    where v.id=i.replacement_version_id and v.match_id=i.match_id and v.issue_id=i.id
      and v.source_version_id=i.source_version_id and v.job_id=i.replacement_job_id
      and v.status='ready' for update of v;
  if not found then raise exception 'candidate not ready' using errcode='P0001'; end if;
  perform public.activate_match_processing_version(i.match_id,i.replacement_version_id);
  update public.match_processing_feedback set status='resolved_reprocessed',resolution='reprocess',player_note=trim(p_player_note),internal_note=trim(coalesce(p_internal_note,'')),decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=i.id;
  perform public.record_match_version_event(i.id,'published',trim(p_player_note),p_internal_note,jsonb_build_object('versionId',i.replacement_version_id,'previousVersionId',v_active));
  return public.admin_match_issue_detail(i.id);
end $$;

create function public.admin_keep_current_match_version(p_issue_id uuid,p_player_note text,p_internal_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_player_note,''))) not between 1 and 1000 or length(coalesce(p_internal_note,''))>4000 then raise exception 'invalid decision notes' using errcode='23514'; end if;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if i.status='declined' then return public.admin_match_issue_detail(i.id); end if;
  if i.status<>'candidate_ready' then raise exception 'candidate not ready' using errcode='P0001'; end if;
  perform 1 from public.matches where id=i.match_id for update;
  perform 1 from public.match_processing_versions where id=i.replacement_version_id and status='ready' for update;
  if not found then raise exception 'candidate not ready' using errcode='P0001'; end if;
  -- Retained for recovery, not an open candidate any more.
  update public.match_processing_versions set status='superseded',superseded_at=now() where id=i.replacement_version_id;
  update public.match_processing_feedback set status='declined',resolution='none',player_note=trim(p_player_note),internal_note=trim(coalesce(p_internal_note,'')),decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=i.id;
  perform public.record_match_version_event(i.id,'kept_current',trim(p_player_note),p_internal_note,jsonb_build_object('versionId',i.replacement_version_id));
  return public.admin_match_issue_detail(i.id);
end $$;

create function public.admin_restore_match_version(p_match_id uuid,p_version_id uuid,p_player_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; v_active uuid;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_player_note,''))) not between 1 and 1000 then raise exception 'player explanation required' using errcode='23514'; end if;
  select * into i from public.match_processing_feedback where match_id=p_match_id and (source_version_id=p_version_id or replacement_version_id=p_version_id) order by created_at desc limit 1 for update;
  if not found then raise exception 'version has no request' using errcode='P0002'; end if;
  select active_processing_version_id into v_active from public.matches where id=p_match_id for update;
  if v_active=p_version_id then return public.admin_match_issue_detail(i.id); end if;
  perform public.activate_match_processing_version(p_match_id,p_version_id);
  update public.match_processing_feedback set status='resolved_reprocessed',resolution='reprocess',player_note=trim(p_player_note),decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=i.id;
  perform public.record_match_version_event(i.id,'restored',trim(p_player_note),'',jsonb_build_object('versionId',p_version_id,'previousVersionId',v_active));
  return public.admin_match_issue_detail(i.id);
end $$;

revoke all on function public.admin_match_version_detail(uuid),public.admin_start_match_reprocess(uuid,jsonb,text),public.admin_publish_match_version(uuid,text,text),public.admin_keep_current_match_version(uuid,text,text),public.admin_restore_match_version(uuid,uuid,text) from public,anon;
grant execute on function public.admin_match_version_detail(uuid),public.admin_start_match_reprocess(uuid,jsonb,text),public.admin_publish_match_version(uuid,text,text),public.admin_keep_current_match_version(uuid,text,text),public.admin_restore_match_version(uuid,uuid,text) to authenticated;

-- Admin gets historical source/release/settings/completion facts through the
-- already-private detail. No ordinary client receives the version records.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_match_issue_detail(uuid)'::regprocedure);
  execute replace(definition,'''issue'', to_jsonb(v_issue),', '''issue'', to_jsonb(v_issue),
    ''versions'', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.match_processing_versions v where v.match_id=v_issue.match_id), ''[]''::jsonb),');
end $$;

-- Trigger-only functions must not be exposed as direct RPCs.
revoke all on function public.initialize_match_processing_version(),public.sync_active_match_processing_version(),public.check_active_match_processing_version(),public.guard_point_processing_version(),public.guard_point_dependent_version(),public.stamp_match_issue_source_version(),public.guard_reprocess_job_client() from public,anon,authenticated;

-- Version-current diagnostics are separate from explicit admin version reads.
create view public.active_match_points as select p.* from public.points p
where p.processing_version_id=(select m.active_processing_version_id from public.matches m where m.id=p.match_id);
revoke all on public.active_match_points from public,anon,authenticated;
do $$
declare r record; definition text;
begin
  for r in select oid from pg_proc where pronamespace='public'::regnamespace and proname in
    ('admin_upload_detail','admin_match_points','admin_point_evidence','admin_recent_uploads','admin_player_detail','admin_player_overview','admin_outreach_roster') loop
    definition:=pg_get_functiondef(r.oid);
    execute regexp_replace(definition,'\m(from|join)\s+public\.points\M','\1 public.active_match_points','gi');
  end loop;
end $$;
