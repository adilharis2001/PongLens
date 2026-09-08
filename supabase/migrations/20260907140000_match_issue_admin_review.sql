-- Complete the issue-scoped admin review contract. All artifacts are retained.
create function public.admin_match_version_facts(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v public.match_processing_versions; totals jsonb; effects jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v from public.match_processing_versions where id=p_version_id;
  if not found then raise exception 'version not found' using errcode='P0002'; end if;
  -- Same point-clock duration used by admin_upload_detail, scoped to one version.
  select jsonb_build_object('points',count(*) filter(where not deleted),
    'retained_duration_s',max(cut_t0+(t1-t0)) filter(where cut_t0 is not null)) into totals
    from public.points where processing_version_id=v.id;
  select jsonb_build_object(
    'scores',(select count(*) from public.points where processing_version_id=v.id and confirmed_winner is not null),
    'edits',(select count(*) from public.points where processing_version_id=v.id and edited),
    'stars',(select count(*) from public.points where processing_version_id=v.id and starred),
    'notes',(select count(*) from public.notes n join public.points p on p.id=n.point_id where p.processing_version_id=v.id),
    'tags',(select count(*) from public.point_tags t join public.points p on p.id=t.point_id where p.processing_version_id=v.id),
    'share_links',(select count(*) from public.share_links s join public.points p on p.id=s.point_id where p.processing_version_id=v.id),
    'coach_findings',(select count(distinct f.finding_id) from public.review_finding_points f join public.points p on p.id=f.point_id where p.processing_version_id=v.id),
    'drawings',(select count(*) from public.review_findings f join public.points p on p.id=f.image_point_id where p.processing_version_id=v.id and f.image_path is not null),
    'reels',case when v.status='active' then (select count(*) from public.match_reels r where r.match_id=v.match_id) else (select count(*) from public.match_processing_version_reels r where r.version_id=v.id) end
  ) into effects;
  return to_jsonb(v)||jsonb_build_object('totals',totals,'effects',effects);
end $$;
revoke all on function public.admin_match_version_facts(uuid) from public,anon;
grant execute on function public.admin_match_version_facts(uuid) to authenticated;

create or replace function public.admin_match_version_detail(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v jsonb;
begin
  v:=public.admin_match_version_facts(p_version_id);
  return jsonb_build_object('version',v,'points',coalesce((select jsonb_agg(to_jsonb(p) order by p.idx) from public.points p where p.processing_version_id=p_version_id),'[]'));
end $$;

create or replace function public.admin_match_issue_detail(p_issue_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare i public.match_processing_feedback; m public.matches; minutes integer;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into i from public.match_processing_feedback where id=p_issue_id;
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  select * into m from public.matches where id=i.match_id;
  minutes:=case when i.status='resolved_refunded' then i.refundable_minutes
    when i.kind in ('refund','reprocess') and i.source_job_id is not null then public._match_issue_refundable_minutes(i.owner_id,i.match_id,i.source_job_id) else 0 end;
  return jsonb_build_object(
    'issue',to_jsonb(i)||jsonb_build_object('refundable_minutes',minutes),
    'sourceAvailable',public.match_reprocess_source(m.id) is not null,
    'sourceJob',(select jsonb_build_object('id',j.id,'status',j.status,'updatedAt',j.updated_at,
      'funding',coalesce((select l.funding from public.processing_ledger l where l.job_id=j.id and l.kind='spend' order by l.created_at desc limit 1),j.options->>'funding'),
      'chargedMinutes',(select -l.minutes from public.processing_ledger l where l.job_id=j.id and l.kind='spend' order by l.created_at desc limit 1)) from public.jobs j where j.id=i.source_job_id),
    'match',jsonb_build_object('id',m.id,'status',m.status,'ownerId',m.user_id,'jobId',m.job_id,'cutPath',m.cut_path,'rawPath',m.raw_path,'matchJsonPath',m.match_json_path,'opponentName',m.opponent_name,'playedAt',m.played_at),
    'versions',coalesce((select jsonb_agg(public.admin_match_version_facts(v.id) order by v.created_at) from public.match_processing_versions v where v.match_id=i.match_id),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.match_processing_feedback_events e where e.issue_id=i.id),'[]'));
end $$;

-- Pending queue amounts reflect a reversible source spend, including a
-- reprocessing request whose original snapshot did not request a refund.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_match_issue_list(text)'::regprocedure);
  definition:=replace(definition,'i.kind, i.status, i.message, i.refundable_minutes,',
    $s$i.kind, i.status, i.message, case when i.status='resolved_refunded' then i.refundable_minutes when i.kind in ('refund','reprocess') and i.source_job_id is not null then public._match_issue_refundable_minutes(i.owner_id,i.match_id,i.source_job_id) else 0 end,$s$);
  execute definition;
end $$;

create function public.admin_close_match_issue(p_issue_id uuid,p_player_note text,p_internal_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; job_status text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_player_note,''))) not between 1 and 1000 or length(coalesce(p_internal_note,''))>4000 then raise exception 'invalid decision notes' using errcode='23514'; end if;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if i.status='declined' then return public.admin_match_issue_detail(i.id); end if;
  if i.status not in ('pending','execution_failed') or i.kind='positive' then raise exception 'already decided' using errcode='P0001'; end if;
  perform 1 from public.matches where id=i.match_id for update;
  if i.replacement_job_id is not null then
    select status into job_status from public.jobs where id=i.replacement_job_id for update;
    if job_status in ('queued','processing') then raise exception 'already decided' using errcode='P0001'; end if;
  end if;
  update public.match_processing_feedback set status='declined',resolution='none',player_note=trim(p_player_note),internal_note=trim(coalesce(p_internal_note,'')),decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=i.id;
  perform public.record_match_version_event(i.id,'declined',trim(p_player_note),p_internal_note,'{}');
  return public.admin_match_issue_detail(i.id);
end $$;

-- Keep the established refund notification and ledger write, widening only
-- reviewed states and adding live spend/candidate checks under the issue lock.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_refund_match_issue(uuid,text,text)'::regprocedure);
  definition:=replace(definition, $s$if v_issue.kind <> 'refund' or v_issue.status <> 'pending' then$s$,
    $s$if v_issue.kind not in ('refund','reprocess') or v_issue.status not in ('pending','candidate_ready','execution_failed') then$s$);
  definition:=replace(definition, $s$  select spend.* into v_spend$s$, $s$
  perform 1 from public.matches where id=v_issue.match_id for update;
  if v_issue.source_job_id is null then raise exception 'nothing to refund' using errcode='P0001'; end if;
  if v_issue.replacement_version_id is not null then
    perform 1 from public.match_processing_versions where id=v_issue.replacement_version_id and match_id=v_issue.match_id and issue_id=v_issue.id and status in ('ready','failed') for update;
    if not found then raise exception 'already decided' using errcode='P0001'; end if;
    perform 1 from public.jobs where id=v_issue.replacement_job_id and status in ('done','failed') for update;
    if not found then raise exception 'already decided' using errcode='P0001'; end if;
  end if;
  select spend.* into v_spend$s$);
  definition:=replace(definition, $s$  insert into public.processing_ledger ($s$, $s$
  if exists(select 1 from public.processing_ledger where kind='refund' and reverses_id=v_spend.id) then raise exception 'nothing to refund' using errcode='P0001'; end if;
  update public.match_processing_versions set status='superseded',superseded_at=now() where id=v_issue.replacement_version_id and status='ready';
  insert into public.processing_ledger ($s$);
  definition:=replace(definition, $s$set status = 'resolved_refunded', resolution = 'refund',$s$, $s$set status = 'resolved_refunded', resolution = 'refund', refundable_minutes = -v_spend.minutes,$s$);
  execute definition;
end $$;

create function public.admin_restore_match_issue_version(p_issue_id uuid,p_player_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.match_processing_feedback; active_id uuid;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if length(trim(coalesce(p_player_note,''))) not between 1 and 1000 then raise exception 'player explanation required' using errcode='23514'; end if;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  select active_processing_version_id into active_id from public.matches where id=i.match_id for update;
  if i.status<>'resolved_reprocessed' or not exists(select 1 from public.match_processing_feedback_events where issue_id=i.id and kind='published') then raise exception 'replacement is not published' using errcode='P0001'; end if;
  if active_id=i.source_version_id and exists(select 1 from public.match_processing_feedback_events where issue_id=i.id and kind='restored') then return public.admin_match_issue_detail(i.id); end if;
  if active_id is distinct from i.replacement_version_id then raise exception 'active version changed' using errcode='P0001'; end if;
  perform 1 from public.match_processing_versions where id=i.replacement_version_id and issue_id=i.id and source_version_id=i.source_version_id and match_id=i.match_id for update;
  if not found then raise exception 'replacement does not belong to request' using errcode='P0001'; end if;
  perform 1 from public.match_processing_versions where id=i.source_version_id and match_id=i.match_id and status='superseded' for update;
  if not found then raise exception 'previous version is not retained' using errcode='P0001'; end if;
  perform public.activate_match_processing_version(i.match_id,i.source_version_id);
  update public.match_processing_feedback set player_note=trim(p_player_note),decided_by=auth.uid(),decided_at=now(),updated_at=now() where id=i.id;
  perform public.record_match_version_event(i.id,'restored',trim(p_player_note),'',jsonb_build_object('versionId',i.source_version_id,'previousVersionId',active_id));
  return public.admin_match_issue_detail(i.id);
end $$;
revoke all on function public.admin_close_match_issue(uuid,text,text),public.admin_restore_match_issue_version(uuid,text) from public,anon;
grant execute on function public.admin_close_match_issue(uuid,text,text),public.admin_restore_match_issue_version(uuid,text) to authenticated;

-- Retain the previous signature for existing callers, but never choose the
-- latest related request or activate an unpublished candidate through restore.
create or replace function public.admin_restore_match_version(p_match_id uuid,p_version_id uuid,p_player_note text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare ids uuid[];
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  select array_agg(i.id) into ids from public.match_processing_feedback i
    where i.match_id=p_match_id and i.source_version_id=p_version_id and i.status='resolved_reprocessed'
    and exists(select 1 from public.match_processing_feedback_events e where e.issue_id=i.id and e.kind='published');
  if coalesce(array_length(ids,1),0)<>1 then raise exception 'candidate not ready: use the published request to restore' using errcode='P0001'; end if;
  return public.admin_restore_match_issue_version(ids[1],p_player_note);
end $$;

-- A terminal failed run can be retried without erasing the failed version.
-- A repeated start while queued/running still returns its one canonical job.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_start_match_reprocess(uuid,jsonb,text)'::regprocedure);
  definition:=replace(definition,$s$if i.replacement_job_id is not null then return public.admin_match_issue_detail(i.id); end if;$s$,
    $s$if i.replacement_job_id is not null and i.status<>'execution_failed' then return public.admin_match_issue_detail(i.id); end if;
    if i.status='execution_failed' then
      perform 1 from public.jobs where id=i.replacement_job_id and status='failed' for update;
      if not found then raise exception 'previous run has not failed' using errcode='P0001'; end if;
      perform 1 from public.match_processing_versions where id=i.replacement_version_id and issue_id=i.id and status='failed' for update;
      if not found then raise exception 'previous version has not failed' using errcode='P0001'; end if;
    end if;$s$);
  definition:=replace(definition,$s$if i.status<>'pending' or i.kind$s$,$s$if i.status not in ('pending','execution_failed') or i.kind$s$);
  -- Trim always comes from the existing source; this admin surface changes
  -- only the two supported processing settings.
  definition:=replace(definition,$s$('strictness','placement','trim_start_s','trim_end_s')$s$,$s$('strictness','placement')$s$);
  execute definition;
end $$;
