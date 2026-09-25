-- Rollback of 20260925170000_cut_again.sql, in one transaction.
--
-- Every function below is the definition production ran on 2026-09-25
-- before the migration (pulled with pg_get_functiondef; the nine
-- checksums match production's, see RELEASE.md). Run the check in
-- RELEASE.md first: a re-cut that is running or waiting to go live is
-- discarded here and its marks handed back, the live match untouched.
begin;

-- Re-cuts in flight: their candidates are discarded, the marks handed
-- back, their jobs ended. Nothing touches a live match.
with open_recut as (
  select v.id, v.match_id, v.job_id
    from public.match_processing_versions v
   where v.issue_id is null and v.source_version_id is not null
     and v.status in ('candidate', 'ready')
)
, gone_points as (
  delete from public.points p using open_recut o
   where p.match_id = o.match_id and p.processing_version_id = o.id
  returning 1
)
, drafts as (
  update public.hand_cut_drafts d set submitted_at = null
    from open_recut o where d.match_id = o.match_id
  returning 1
)
, jobs as (
  update public.jobs j set status = 'cancelled',
         error = 'cut again rolled back before this re-cut went live'
    from open_recut o
   where j.id = o.job_id and j.status in ('queued', 'processing')
  returning 1
)
update public.match_processing_versions v set status = 'failed'
  from open_recut o where v.id = o.id;

-- The public read list as it was (20260925061009).
drop policy if exists "Public app config is readable" on public.app_config;
create policy "Public app config is readable"
  on public.app_config for select
  using (
    key = any (array[
      'support_email', 'commerce_enabled', 'coach_reviews_enabled',
      'review_included_minutes', 'review_fee_mode', 'review_fee_percent',
      'review_fee_fixed_cents', 'minute_packs', 'storage_packs',
      'sponsored_packs', 'sponsored_free_credits', 'sponsored_reviews_enabled',
      'free_processing_minutes', 'default_storage_bytes', 'placement_serves_only',
      'instagram_sharing', 'instagram_render', 'iap_enabled', 'device_reclip',
      'game_end_detection', 'tap_end_playback', 'unscored_rally_end',
      'unscored_rally_end_buffer_s', 'unscored_rally_end_tight_buffer_s',
      'keep_score_full_card', 'rally_end_respects_card', 'purchases_enabled',
      'recollect_enabled', 'terms_version', 'ai_consent_version',
      'recordings_to_photos', 'device_hand_cut'
    ])
  );
delete from public.app_config where key = 'recut_auto_replace';

drop trigger if exists jobs_guard_hand_cut_client on public.jobs;
drop index if exists public.match_processing_versions_one_open_candidate;

CREATE OR REPLACE FUNCTION public.sync_active_match_processing_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.activate_match_processing_version(p_match_id uuid, p_version_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select m.active_processing_version_id,r.scope,to_jsonb(r) from public.match_reels r
    where r.match_id=m.id and r.r2_key is not null
  on conflict(version_id,scope) do update set record=excluded.record;
  -- The public highlight resolver intentionally keeps serving a retained key
  -- during same-version refreshes. After publication that key is no longer
  -- current: keep it only in the version archive, never beside new scores.
  update public.match_reels set status='failed',error='Match version changed.',
    r2_key=null,duration_s=null,size_bytes=null where match_id=m.id;
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
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_share_placement(p_token text)
 RETURNS TABLE(id uuid, placement jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    jsonb_set(
      p.placement - 'candidates',
      '{candidates}',
      coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'id', c -> 'id', 'kind', c -> 'kind', 't', c -> 't',
                  'u', c -> 'u', 'v', c -> 'v'))
         from jsonb_array_elements(p.placement -> 'candidates') c),
        '[]'::jsonb)
    ) as placement
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  join public.points p on p.match_id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind in ('match', 'highlights')
    and sl.show_score
    and p.deleted = false
    and coalesce(p.placement_flagged, false) = false
    and coalesce(m.placement_flagged, false) = false
    and p.placement is not null
  order by coalesce(p.t0, p.idx), p.idx;
$function$;

CREATE OR REPLACE FUNCTION public._hand_cut_hand_back(p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_match uuid;
begin
  select id into v_match from public.matches where job_id = p_job for update;
  if v_match is null then
    return false;
  end if;
  delete from public.points where match_id = v_match;
  update public.matches
     set status = 'uploaded', cut_path = null,
         cut_source = 'auto', job_id = null
   where id = v_match;
  update public.hand_cut_drafts set submitted_at = null where match_id = v_match;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_manual_cut_observations(p_match_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pair record;
  v_match record;
  v_mark_count integer;
  v_point_count integer;
  v_written integer := 0;
begin
  select m.id, m.user_id, m.cut_source, m.active_processing_version_id,
         d.marks
    into v_match
    from public.matches m
    join public.hand_cut_drafts d on d.match_id = m.id
   where m.id = p_match_id
   for update of m;
  if not found or v_match.cut_source <> 'manual' then
    raise exception 'manual cut source not found' using errcode = 'P0002';
  end if;

  select count(*) into v_mark_count
    from jsonb_array_elements(v_match.marks) as entries(mark)
   where mark->>'t0' is not null and mark->>'t1' is not null;
  select count(*) into v_point_count
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = v_match.active_processing_version_id
     and not p.deleted;
  if v_mark_count = 0 or v_mark_count <> v_point_count then
    raise exception 'manual cut mark/point count mismatch' using errcode = '23514';
  end if;

  for v_pair in
    with marks as (
      select row_number() over (order by (mark->>'t0')::numeric) as ordinal,
             mark
        from jsonb_array_elements(v_match.marks) as entries(mark)
       where mark->>'t0' is not null and mark->>'t1' is not null
    ), active_points as (
      select row_number() over (order by p.t0, p.idx, p.id) as ordinal,
             p.*
        from public.points p
       where p.match_id = p_match_id
         and p.processing_version_id = v_match.active_processing_version_id
         and not p.deleted
    )
    select p.id as point_id, p.t0, p.t1, p.timing_revision,
           m.mark
      from marks m join active_points p using (ordinal)
     order by m.ordinal
  loop
    if abs(v_pair.t0 - (v_pair.mark->>'t0')::numeric) > 0.06
       or abs(v_pair.t1 - (v_pair.mark->>'t1')::numeric) > 0.06 then
      raise exception 'manual cut mark/point timing mismatch' using errcode = '23514';
    end if;

    insert into public.point_timing_observations (
      match_id, point_id, kind, source_s, origin, authority_scope,
      timing_revision, media_kind, media_revision, media_local_s,
      reaction_meta, eligible_for_training, eligible_for_playback, created_by
    ) values (
      p_match_id, v_pair.point_id, 'serve_start',
      (v_pair.mark->>'t0')::numeric, 'manual_cutter',
      'owner_manual_boundary', v_pair.timing_revision, 'source',
      v_match.active_processing_version_id, (v_pair.mark->>'t0')::numeric,
      jsonb_build_object(
        'raw_start_tap_s', (v_pair.mark->>'tap')::numeric,
        'playback_rate', (v_pair.mark->>'rate')::numeric,
        'applied_lead_s', (v_pair.mark->>'tap')::numeric -
                          (v_pair.mark->>'t0')::numeric
      ), true, true, v_match.user_id
    ) on conflict (point_id, kind, origin, timing_revision) do update set
      source_s = excluded.source_s,
      media_revision = excluded.media_revision,
      media_local_s = excluded.media_local_s,
      reaction_meta = excluded.reaction_meta,
      invalidated_at = null,
      invalidated_reason = null;
    v_written := v_written + 1;

    insert into public.point_timing_observations (
      match_id, point_id, kind, source_s, origin, authority_scope,
      timing_revision, media_kind, media_revision, media_local_s,
      reaction_meta, eligible_for_training, eligible_for_playback, created_by
    ) values (
      p_match_id, v_pair.point_id, 'point_end',
      (v_pair.mark->>'t1')::numeric, 'manual_cutter',
      'owner_manual_boundary', v_pair.timing_revision, 'source',
      v_match.active_processing_version_id, (v_pair.mark->>'t1')::numeric,
      jsonb_build_object(
        'raw_end_tap_s', (v_pair.mark->>'t1')::numeric,
        'playback_rate', (v_pair.mark->>'rate')::numeric,
        'post_padding_policy', 'structural_manual'
      ), true, true, v_match.user_id
    ) on conflict (point_id, kind, origin, timing_revision) do update set
      source_s = excluded.source_s,
      media_revision = excluded.media_revision,
      media_local_s = excluded.media_local_s,
      reaction_meta = excluded.reaction_meta,
      invalidated_at = null,
      invalidated_reason = null;
    v_written := v_written + 1;
  end loop;
  return v_written;
end;
$function$;

CREATE OR REPLACE FUNCTION public.jobs_notify_failed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status is not distinct from old.status or new.status <> 'failed' then
    return new;
  end if;
  -- ONLY the jobs a person is waiting on. reclip, placement and reel
  -- renders fail behind their own surfaces, which report themselves; a
  -- bell for each would be noise about work nobody asked about directly.
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

CREATE OR REPLACE FUNCTION public.admin_start_match_reprocess(p_issue_id uuid, p_options jsonb, p_internal_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i public.match_processing_feedback; m public.matches; v public.match_processing_versions; v_candidate uuid; v_job uuid:=gen_random_uuid(); v_raw text; v_options jsonb; k text;
begin
  if not public.is_admin() then raise exception 'not authorized' using errcode='42501'; end if;
  if jsonb_typeof(p_options) is distinct from 'object' or length(coalesce(p_internal_note,''))>4000 then raise exception 'invalid input' using errcode='23514'; end if;
  for k in select jsonb_object_keys(p_options) loop if k not in ('strictness','placement') then raise exception 'unsupported option' using errcode='23514'; end if; end loop;
  select * into i from public.match_processing_feedback where id=p_issue_id for update;
  if not found then raise exception 'request not found' using errcode='P0002'; end if;
  if i.replacement_job_id is not null and i.status<>'execution_failed' then return public.admin_match_issue_detail(i.id); end if;
    if i.status='execution_failed' then
      perform 1 from public.jobs where id=i.replacement_job_id and status='failed' for update;
      if not found then raise exception 'previous run has not failed' using errcode='P0001'; end if;
      perform 1 from public.match_processing_versions where id=i.replacement_version_id and issue_id=i.id and status='failed' for update;
      if not found then raise exception 'previous version has not failed' using errcode='P0001'; end if;
    end if;
  if i.status not in ('pending','execution_failed') or i.kind not in ('reprocess','refund') then raise exception 'already decided' using errcode='P0001'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.ledger_on_match_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  keys text[];
begin
  -- 1. rows recorded against the match (point clips, match.json, reclips)
  insert into public.storage_ledger (user_id, kind, bytes, r2_key)
  select user_id, kind, -sum(bytes), r2_key
  from public.storage_ledger
  where match_id = old.id
  group by user_id, kind, r2_key
  having sum(bytes) > 0;

  -- 2. cut video + voice audio of its notes: negate by key. Runs after (1),
  -- so anything already negated there nets to zero and is skipped.
  keys := array[]::text[];
  if old.cut_path like 'r2://%' then
    keys := keys || old.cut_path;
  end if;
  keys := keys || coalesce(
    array(select n.audio_path from public.notes n
          where n.match_id = old.id and n.audio_path is not null),
    array[]::text[]);
  if coalesce(array_length(keys, 1), 0) > 0 then
    perform public._ledger_negate_keys(keys);
  end if;
  return old;
end;
$function$;

-- The public link as it was: the same columns without cut_source (the
-- return type changes, so it is dropped and made again with its grants).
drop function if exists public.resolve_share_link(text);
CREATE FUNCTION public.resolve_share_link(p_token text)
 RETURNS TABLE(kind text, match_id uuid, point_id uuid, title text, tag_label text, show_score boolean, opponent_name text, player_near_name text, player_far_name text, owner_name text, user_side text, first_server text, venue text, placement_status text, placement_flagged boolean, played_at timestamp with time zone, cut_path text, original_name text, point_number integer, point_t0 numeric, point_t1 numeric, point_clip_path text, point_starred boolean, point_confirmed_winner text, point_confirmed_how text, raw_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    sl.kind,
    sl.match_id,
    sl.point_id,
    sl.title,
    t.label as tag_label,
    sl.show_score,
    m.opponent_name,
    m.player_near_name,
    m.player_far_name,
    (select nullif(btrim(coalesce(
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'name',
       '')), '')
     from auth.users u where u.id = m.user_id) as owner_name,
    m.user_side,
    m.first_server,
    m.venue,
    m.placement_status,
    coalesce(m.placement_flagged, false) as placement_flagged,
    m.played_at,
    case when p.id is not null then pv.cut_path else coalesce(
      m.cut_path,
      (select j.result_path from public.jobs j
        where j.id = m.job_id and j.status = 'done')
    ) end as cut_path,
    (select j.original_name from public.jobs j where j.id = m.job_id)
      as original_name,
    case when p.id is null then null else (
      select count(*)::int from public.points q
      where q.match_id = p.match_id and q.processing_version_id = p.processing_version_id
        and q.deleted = false
        and (coalesce(q.t0, q.idx), q.idx) <= (coalesce(p.t0, p.idx), p.idx)
    ) end as point_number,
    p.t0,
    p.t1,
    p.clip_path,
    p.starred,
    p.confirmed_winner,
    p.confirmed_how,
    case when p.id is not null then pv.raw_path else m.raw_path end
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  left join public.points p on p.id = sl.point_id left join public.match_processing_versions pv on pv.id=p.processing_version_id
  left join public.tags t on t.id = sl.tag_id
  where sl.token = p_token
    and sl.revoked_at is null
    and (sl.point_id is null or (p.id is not null and p.deleted = false));
$function$;
revoke all on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text)
  to anon, authenticated, service_role;

-- The new calls and helpers. Clients that still call them get "function
-- does not exist" and show their generic failure.
drop function if exists public.recut_options(uuid);
drop function if exists public.start_recut(uuid, boolean);
drop function if exists public.claim_hand_recut(uuid, jsonb, boolean);
drop function if exists public.copy_match_for_recut(uuid);
drop function if exists public.activate_pending_hand_recuts();
drop function if exists public.activate_hand_recut(uuid);
drop function if exists public.publish_hand_recut(uuid, uuid, text, text, text, jsonb);
drop function if exists public._activate_hand_recut(uuid, uuid, uuid, integer);
drop function if exists public._ledger_uncount_version_media(uuid, uuid);
drop function if exists public._normalize_manual_cut_observations_for_version(uuid, uuid);
drop function if exists public._copy_match_for_recut(public.matches);
drop function if exists public._recut_marks_from_points(public.matches);
drop function if exists public._hand_cut_validate_marks(jsonb, double precision);
drop function if exists public._marks_mode(jsonb);
drop function if exists public._recut_reason(public.matches);
drop function if exists public._recut_has_coach_review(uuid);
drop function if exists public._recut_busy(uuid);
drop function if exists public._recut_support_request_open(uuid);
drop function if exists public._try_numeric(text);
drop function if exists public.guard_hand_cut_job_client();

-- The column stays: nothing reads it after this, and the values are true.
-- A later re-apply of the migration keeps them.

commit;
