-- Rollback of 20260925200000_cut_again_auto_replace.sql, in one transaction.
--
-- Every function restored below is the definition production ran on
-- 2026-09-25 before the migration (pulled with pg_get_functiondef). Checked
-- on a throwaway Postgres: migration, then this file, gives these checksums,
-- which are production's:
--   _ledger_uncount_version_media                    bfec8702b88bd72d0ad76f0df2592379
--   _my_match_processing_feedback_before_estimates   3abfb7973987d6255ba4b3c385a2ea30
--   activate_match_processing_version                824c204ec4f5c0a68aa60608d05f3dbf
--   guard_match_reprocess_job_rollout                2709cc8031352c67be374a43c3f71ab6
--   jobs_notify_failed                               c5dca54546fcb2662383b9400a461f3e
--   recut_options                                    4ebcb812e002b9856057df1085c17a31
--
-- An automatic Replace that is running or waiting to go live is ended here:
-- its candidate failed, its points deleted, its storage uncounted, its
-- minutes refunded, its job cancelled. The live match is not touched. Turn
-- recut_auto_replace off first so nothing new starts.
begin;

update public.app_config set value = 'off' where key = 'recut_auto_replace';

with open_auto as (
  select v.id, v.match_id, v.job_id
    from public.match_processing_versions v
    join public.jobs j on j.id = v.job_id
   where v.issue_id is null and v.source_version_id is not null
     and v.status in ('candidate', 'ready')
     and j.kind = 'match_reprocess'
     and coalesce(j.options->>'recut', '') = 'replace'
)
, gone_points as (
  delete from public.points p using open_auto o
   where p.match_id = o.match_id and p.processing_version_id = o.id
  returning 1
)
, refunds as (
  insert into public.processing_ledger (
    user_id, minutes, kind, funding, billing_mode,
    match_id, job_id, order_id, note, reverses_id
  )
  select spend.user_id, -spend.minutes, 'refund', spend.funding,
    spend.billing_mode, spend.match_id, spend.job_id, spend.order_id,
    'processing failed', spend.id
    from public.processing_ledger spend join open_auto o on o.job_id = spend.job_id
   where spend.kind = 'spend' and spend.funding = 'personal'
  on conflict (reverses_id) where kind = 'refund' do nothing
  returning 1
)
, jobs as (
  update public.jobs j set status = 'cancelled',
         error = 'automatic Replace rolled back before this re-cut went live'
    from open_auto o
   where j.id = o.job_id and j.status in ('queued', 'processing', 'done')
  returning 1
)
update public.match_processing_versions v set status = 'failed'
  from open_auto o where v.id = o.id;

-- Its storage, while the new helper still exists.
select public._ledger_uncount_version_media(v.match_id, v.id)
  from public.match_processing_versions v
  join public.jobs j on j.id = v.job_id
 where v.status = 'failed' and v.issue_id is null and v.source_version_id is not null
   and j.kind = 'match_reprocess' and j.status = 'cancelled'
   and j.error = 'automatic Replace rolled back before this re-cut went live';

-- The functions as production had them.
create or replace function public.guard_match_reprocess_job_rollout()
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

create or replace function public._ledger_uncount_version_media(p_match_id uuid,
                                                                p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v      public.match_processing_versions%rowtype;
  v_user uuid;
  v_n    integer;
begin
  select * into v from public.match_processing_versions
   where id = p_version_id and match_id = p_match_id;
  if not found then
    return 0;
  end if;
  select user_id into v_user from public.matches where id = p_match_id;
  with keys as (
    select distinct l.r2_key
      from public.storage_ledger l
     where l.match_id = p_match_id
       and l.r2_key is not null
       and (l.r2_key = v.cut_path
            or l.r2_key like 'r2://%/points/' || v_user::text || '/'
                             || p_match_id::text || '/versions/'
                             || p_version_id::text || '/%'
            or (coalesce(v.cut_path, '') not like '%/versions/%'
                and l.r2_key like 'r2://%/points/' || v_user::text || '/'
                                  || p_match_id::text || '/'))
  ), bal as (
    select l.user_id, l.kind, l.r2_key, sum(l.bytes) as net
      from public.storage_ledger l
      join keys k on k.r2_key = l.r2_key
     group by l.user_id, l.kind, l.r2_key
    having sum(l.bytes) > 0
  ), ins as (
    insert into public.storage_ledger (user_id, match_id, kind, bytes, r2_key)
    select user_id, p_match_id, kind, -net, r2_key from bal
    returning 1
  )
  select count(*)::int into v_n from ins;
  return v_n;
end;
$$;

create or replace function public.activate_match_processing_version(p_match_id uuid, p_version_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  update public.match_processing_versions set status='superseded',superseded_at=now(),cut_source=m.cut_source where id=m.active_processing_version_id;
  update public.match_processing_versions set status='active',activated_at=now(),superseded_at=null where id=v.id;
  s:=v.match_state;
  update public.matches set active_processing_version_id=v.id,job_id=v.job_id,raw_path=v.raw_path,cut_path=v.cut_path,thumb_path=v.thumb_path,match_json_path=v.match_json_path,
    status='ready',cut_source=v.cut_source,clip_pads=s->'clip_pads',story_crop=s->'story_crop',match_structure=s->'match_structure',
    placement_status=coalesce(s->>'placement_status','not_requested'),placement_mapped_points=coalesce((s->>'placement_mapped_points')::integer,0),
    placement_failure_code=s->>'placement_failure_code',placement_flagged=coalesce((s->>'placement_flagged')::boolean,false),
    placement_retry_count=0,placement_retry_expires_at=null,placement_retry_job_id=null,placement_generation_job_id=null,
    spoken_scores=s->'spoken_scores',first_server=s->>'first_server',first_server_source=s->>'first_server_source'
  where id=m.id;
end $function$;

create or replace function public.jobs_notify_failed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if new.kind = 'hand_cut' and coalesce(new.options->>'recut', '') = 'replace' then
    insert into public.notifications
      (user_id, kind, title, body, href)
    values (
      new.user_id,
      'upload_failed',
      'The new cut didn''t finish.',
      'Your marks are saved.',
      '/match/' || (new.options->>'match_id')
    );
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

create or replace function public.recut_options(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_match  public.matches%rowtype;
  v_reason text;
  v_hand   boolean;
  v_review boolean;
  v_auto   text;
  v_auto_on boolean;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_reason := public._recut_reason(v_match);
  v_hand := public.hand_cut_enabled(v_me);
  v_review := public._recut_has_coach_review(v_match.id);
  select value into v_auto from public.app_config where key = 'recut_auto_replace';
  v_auto_on := case v_auto when 'on' then true
                           when 'admins' then public.is_admin()
                           else false end;

  return jsonb_build_object(
    'available', v_reason is null,
    'reason', v_reason,
    'replace_by_hand', v_reason is null and v_hand and not v_review,
    'replace_automatic', v_reason is null and v_auto_on and not v_review,
    'has_coach_review', v_review,
    'has_match_notes', exists (
      select 1 from public.notes n
       where n.match_id = v_match.id and n.point_id is null),
    'cut_source', v_match.cut_source);
end;
$$;

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

-- The new calls and helpers. A client that still calls claim_auto_recut
-- gets "function does not exist" and shows its generic failure (Replace
-- is greyed anyway with the switch off).
drop function if exists public.claim_auto_recut(uuid, boolean, numeric, numeric, text);
drop function if exists public.activate_pending_auto_recuts();
drop function if exists public.activate_auto_recut(uuid);
drop function if exists public.publish_auto_recut(uuid, text, text, text, jsonb, jsonb, text);
drop function if exists public.fail_auto_recut(uuid, text);
drop function if exists public._activate_auto_recut(uuid, uuid, uuid);
drop function if exists public._refund_auto_recut(uuid);
drop function if exists public._auto_recut_version(uuid);
drop function if exists public._recut_auto_replace_on();
drop function if exists public.claim_retired_version_sweep(uuid, interval);
drop function if exists public.media_keys_in_use(text[], uuid[]);
drop function if exists public.retired_processing_versions(interval);

-- The column stays: a version the sweep already emptied keeps saying so.
-- Without the activation's refusal nothing stops support restoring one, so
-- check media_swept_at by hand before any restore after this rollback.

commit;
