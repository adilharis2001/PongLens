-- Cut a match again: the database half.
--
-- Design:   docs/superpowers/specs/2026-09-25-cut-again-design.md
-- Contract: docs/superpowers/specs/2026-09-25-cut-again-contract.md (the four
--           calls below, their return shapes and their codes)
-- Research: docs/research/2026-09-25-reversible-cuts/PROPOSAL.md
-- Release:  docs/research/2026-09-25-cut-again/RELEASE.md
--
-- Phase 1 only. A player can cut a processed match again by hand and
-- either replace it (a candidate processing version, built by the hand lane
-- beside the live cut and made live in one step when it is ready) or keep
-- it and add the new cut as a new match (a copy sharing the original).
-- Automatic Replace stays off (recut_auto_replace 'off').
--
--  1. recut_auto_replace, seeded 'off', on the public read list.
--  2. cut_source on every processing version, projected onto
--     matches.cut_source when a version is made live. matches.cut_source
--     keeps its meaning for every current reader.
--  3. The three fixes that must land first (design 5a): the share page's
--     serve map reads only the live version; _hand_cut_hand_back touches
--     only the job's own version; candidate hand cuts write under
--     versions/<version>/ (worker side, hand-lane release). And the public
--     link says how the match was cut (resolve_share_link.cut_source), so
--     it plays a hand cut with hard cuts.
--  4. One open candidate per match; a client cannot create or change a
--     hand-cut job directly.
--  5. The four contract calls: recut_options, start_recut,
--     claim_hand_recut, copy_match_for_recut.
--  6. Publishing a candidate hand cut (publish_hand_recut and the two
--     calls that make one live later), with the canonical score rebuilt by
--     the activation and the replaced cut's storage uncounted.
--  7. The failure bell for a re-cut: "The new cut didn't finish." /
--     "Your marks are saved."
--  8. Support reprocessing and a player's own re-cut never run at once
--     (assumption C): admin_start_match_reprocess refuses during one.
--  9. A shared original's storage row passes to the surviving match when
--     one of the two is deleted.
--
-- Apply AFTER the hand lane runs release #4 (RELEASE.md says why).
--
-- Every replaced function was pulled from production with
-- pg_get_functiondef on 2026-09-25 and edited from that, not from older
-- migration files. CREATE OR REPLACE keeps each replaced function's ACL.
-- Every NEW function is revoked from anon/authenticated explicitly,
-- because Supabase's default privileges grant them EXECUTE otherwise.

-- ---------------------------------------------------------------------------
-- 1. The automatic Replace switch
-- ---------------------------------------------------------------------------
-- 'off' | 'admins' | 'on'. Phase 2 turns it on with the main/fast release
-- that gives candidates the body-first assembler.
insert into public.app_config (key, value)
values ('recut_auto_replace', 'off')
on conflict (key) do nothing;

-- The live list (pg_policies, 2026-09-25, identical to
-- 20260925061009_device_hand_cut.sql) plus the new key.
drop policy if exists "Public app config is readable" on public.app_config;

create policy "Public app config is readable"
  on public.app_config for select
  using (
    key = any (array[
      'support_email',
      'commerce_enabled',
      'coach_reviews_enabled',
      'review_included_minutes',
      'review_fee_mode',
      'review_fee_percent',
      'review_fee_fixed_cents',
      'minute_packs',
      'storage_packs',
      'sponsored_packs',
      'sponsored_free_credits',
      'sponsored_reviews_enabled',
      'free_processing_minutes',
      'default_storage_bytes',
      'placement_serves_only',
      'instagram_sharing',
      'instagram_render',
      'iap_enabled',
      'device_reclip',
      'game_end_detection',
      'tap_end_playback',
      'unscored_rally_end',
      'unscored_rally_end_buffer_s',
      'unscored_rally_end_tight_buffer_s',
      'keep_score_full_card',
      'rally_end_respects_card',
      'purchases_enabled',
      'recollect_enabled',
      'terms_version',
      'ai_consent_version',
      'recordings_to_photos',
      'device_hand_cut',
      'recut_auto_replace'
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. How each version was cut
-- ---------------------------------------------------------------------------
alter table public.match_processing_versions
  add column if not exists cut_source text not null default 'auto';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'match_processing_versions_cut_source_check') then
    alter table public.match_processing_versions
      add constraint match_processing_versions_cut_source_check
      check (cut_source in ('auto', 'manual'));
  end if;
end $$;

comment on column public.match_processing_versions.cut_source is
  'How this version was cut: manual when its owner marked the points. The '
  'live version''s value is projected onto matches.cut_source by '
  'activate_match_processing_version, so every reader of the match column '
  'keeps working.';

-- Backfill. The live version is the match column; any other version
-- recorded the match row it was built for in match_state.
update public.match_processing_versions v
   set cut_source = m.cut_source
  from public.matches m
 where m.id = v.match_id
   and v.status = 'active'
   and v.cut_source is distinct from m.cut_source;

update public.match_processing_versions v
   set cut_source = 'manual'
 where v.status <> 'active'
   and v.match_state->>'cut_source' = 'manual'
   and v.cut_source <> 'manual';

-- The live sync (pulled 2026-09-25) with one addition: the live version
-- follows matches.cut_source the way it follows the paths, so a version
-- records how it was cut from the moment claim_hand_cut sets the column.
create or replace function public.sync_active_match_processing_version()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    cut_source=new.cut_source,
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

-- The live activation (pulled 2026-09-25) with two additions: the version
-- leaving records the match's cut_source, and the version arriving
-- projects its own onto the match, like cut_path.
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

-- ---------------------------------------------------------------------------
-- 3a. The share page's serve map reads the live cut only
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25, identical to
-- 20260915160000_share_placement_table_coords.sql) plus the version filter
-- it lost. It bypasses RLS, so without it a public match link's serve map
-- mixed the dots of every cut the match ever had.
create or replace function public.resolve_share_placement(p_token text)
 returns table(id uuid, placement jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    and p.processing_version_id = m.active_processing_version_id
    and p.deleted = false
    and coalesce(p.placement_flagged, false) = false
    and coalesce(m.placement_flagged, false) = false
    and p.placement is not null
  order by coalesce(p.t0, p.idx), p.idx;
$function$;

-- ---------------------------------------------------------------------------
-- 3a'. The public link says how the match was cut
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25) with one column added at the
-- end: cut_source, the match's for a match link and the point's own
-- version's for a point link (which keeps playing its own cut). A new
-- result column changes the return type, so the function is dropped and
-- made again with the grants it had (anon, authenticated, service_role).
-- Nothing in the database calls it.
drop function if exists public.resolve_share_link(text);

create function public.resolve_share_link(p_token text)
 returns table(kind text, match_id uuid, point_id uuid, title text, tag_label text, show_score boolean, opponent_name text, player_near_name text, player_far_name text, owner_name text, user_side text, first_server text, venue text, placement_status text, placement_flagged boolean, played_at timestamp with time zone, cut_path text, original_name text, point_number integer, point_t0 numeric, point_t1 numeric, point_clip_path text, point_starred boolean, point_confirmed_winner text, point_confirmed_how text, raw_path text, cut_source text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    case when p.id is not null then pv.raw_path else m.raw_path end,
    case when p.id is not null then pv.cut_source else m.cut_source end
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

-- ---------------------------------------------------------------------------
-- 3b. Handing marks back touches only the job's own version
-- ---------------------------------------------------------------------------
-- The live definition deleted every point on the match. A re-cut is built
-- beside the live cut (a candidate version), so handing its marks back
-- discards the candidate and nothing else: the match row, its live points
-- and its live cut are not touched. An ordinary hand cut (the match's own
-- job, the match not yet published) is handed back as before, deleting
-- only the points of the version it was cutting. A published match is
-- never undone here.
create or replace function public._hand_cut_hand_back(p_job uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_candidate public.match_processing_versions%rowtype;
  v_match     public.matches%rowtype;
begin
  select * into v_candidate
    from public.match_processing_versions
   where job_id = p_job
     and issue_id is null
     and source_version_id is not null
     and status in ('candidate', 'ready')
   for update;
  if found then
    delete from public.points
     where match_id = v_candidate.match_id
       and processing_version_id = v_candidate.id;
    update public.match_processing_versions
       set status = 'failed'
     where id = v_candidate.id;
    update public.hand_cut_drafts set submitted_at = null
     where match_id = v_candidate.match_id;
    return true;
  end if;

  select * into v_match from public.matches where job_id = p_job for update;
  if not found or v_match.status = 'ready' then
    return false;
  end if;
  delete from public.points
   where match_id = v_match.id
     and processing_version_id = v_match.active_processing_version_id;
  update public.matches
     set status = 'uploaded', cut_path = null,
         cut_source = 'auto', job_id = null
   where id = v_match.id;
  update public.hand_cut_drafts set submitted_at = null where match_id = v_match.id;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. One open candidate per match; hand-cut jobs are the database's
-- ---------------------------------------------------------------------------
-- The support index covers one candidate per request. A player's re-cut
-- has no request, and a support candidate and a re-cut must never exist
-- side by side (assumption C), so: at most one open candidate per match,
-- whoever asked for it. Checked against production on 2026-09-25: no match
-- has two.
create unique index if not exists match_processing_versions_one_open_candidate
  on public.match_processing_versions (match_id)
  where status in ('candidate', 'ready');

-- The owner holds INSERT on jobs and UPDATE on jobs.options, so without
-- this a client could create a hand_cut job by hand, or point one at a
-- version it chose. Every hand-cut job is created and changed by the
-- SECURITY DEFINER claims (current_user is their owner there) and by the
-- worker. Deliberately not SECURITY DEFINER, so current_user is the caller.
create or replace function public.guard_hand_cut_job_client()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.kind = 'hand_cut'
          or (tg_op = 'UPDATE' and old.kind = 'hand_cut')) then
    raise exception 'hand cut jobs are database-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_hand_cut_job_client() from public, anon, authenticated;

drop trigger if exists jobs_guard_hand_cut_client on public.jobs;
create trigger jobs_guard_hand_cut_client
  before insert or update on public.jobs
  for each row execute function public.guard_hand_cut_job_client();

-- ---------------------------------------------------------------------------
-- Small private helpers
-- ---------------------------------------------------------------------------
create or replace function public._try_numeric(p_value text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
begin
  return p_value::numeric;
exception when others then
  return null;
end;
$$;

revoke all on function public._try_numeric(text) from public, anon, authenticated;

-- A support request that has built, or may build, a candidate of this
-- match: the predicate of match_processing_feedback_active_remedy_idx.
create or replace function public._recut_support_request_open(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_processing_feedback f
     where f.match_id = p_match_id
       and f.kind in ('reprocess', 'refund')
       and f.status in ('pending', 'reprocess_queued', 'reprocessing',
                        'candidate_ready'));
$$;

revoke all on function public._recut_support_request_open(uuid)
  from public, anon, authenticated;

-- Something is already cutting this match: a cut job (or the content
-- check, whose rejection removes the original) queued or running, or a
-- player's re-cut that has not been made live yet. One open cut per match.
create or replace function public._recut_busy(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.jobs j
            where j.options->>'match_id' = p_match_id::text
              and j.kind in ('deadspace_cut', 'youtube_import', 'hand_cut',
                             'match_reprocess', 'content_check')
              and j.status in ('queued', 'processing'))
      or exists (
           select 1 from public.match_processing_versions v
            where v.match_id = p_match_id
              and v.issue_id is null
              and v.status in ('candidate', 'ready'));
$$;

revoke all on function public._recut_busy(uuid) from public, anon, authenticated;

-- Assumption A: a coach review is attached to the points of this cut, so
-- the cut may not be replaced. Every order except one that never became a
-- review (declined, cancelled).
create or replace function public._recut_has_coach_review(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.review_orders o
     where o.match_id = p_match_id
       and o.status not in ('declined', 'cancelled'));
$$;

revoke all on function public._recut_has_coach_review(uuid)
  from public, anon, authenticated;

-- Why More options cannot start anything on this match, or null.
create or replace function public._recut_reason(p_match public.matches)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public._recut_busy(p_match.id) then 'processing'
    when p_match.status <> 'ready' or p_match.cut_path is null then 'not_ready'
    when public._recut_support_request_open(p_match.id) then 'support_request'
    when p_match.raw_path is null
      or p_match.raw_path not like 'r2://ponglens-raw/' || p_match.user_id::text || '/%'
      then 'no_source'
    else null end;
$$;

revoke all on function public._recut_reason(public.matches)
  from public, anon, authenticated;

-- 'score' when any mark carries a winner or a let, in either stored form.
create or replace function public._marks_mode(p_marks jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case when exists (
    select 1 from jsonb_array_elements(
             case when jsonb_typeof(p_marks) = 'array' then p_marks
                  else '[]'::jsonb end) e(mark)
     where coalesce(e.mark->>'winner', e.mark->>'w') in ('user', 'opponent')
        or coalesce(e.mark->'isLet', e.mark->'let') = 'true'::jsonb)
  then 'score' else 'cut' end;
$$;

revoke all on function public._marks_mode(jsonb) from public, anon, authenticated;

-- claim_hand_cut's mark checks (the loop of _hand_cut_claim_checks,
-- verbatim, pinned by src/lib/cutAgainMigration.test.ts), for a claim on a
-- match that already has a cut.
create or replace function public._hand_cut_validate_marks(p_marks jsonb,
                                                           p_duration_s double precision)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_n        int;
  v_mark     jsonb;
  v_prev_t1  numeric := -1;
  v_t0       numeric;
  v_t1       numeric;
begin
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' then
    raise exception 'invalid_marks' using errcode = '23514';
  end if;
  v_n := jsonb_array_length(p_marks);
  if v_n < 1 or v_n > 400 then
    raise exception 'invalid_marks' using errcode = '23514';
  end if;

  for v_mark in select * from jsonb_array_elements(p_marks) loop
    v_t0 := (v_mark->>'t0')::numeric;
    v_t1 := (v_mark->>'t1')::numeric;
    if v_t0 is null or v_t1 is null
       or v_t0 < 0
       or v_t1 - v_t0 < 0.7
       or v_t1 - v_t0 > 180
       or v_t1 > p_duration_s + 1
       or v_t0 < v_prev_t1
       or (v_mark->>'w' is not null and v_mark->>'w' not in ('user', 'opponent'))
       or ((v_mark->>'let')::boolean and v_mark->>'w' is not null)
    then
      raise exception 'invalid_marks' using errcode = '23514';
    end if;
    v_prev_t1 := v_t1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public._hand_cut_validate_marks(jsonb, double precision)
  from public, anon, authenticated;

-- Every visible point of the live cut as a mark, in the full form the
-- marker saves: source seconds, winner, let, star, tap and rate null.
--
-- An automatic match processed inside a trim window stores its points on
-- the trimmed clock. The worker's own rule for whether the trim was
-- applied (apply_source_trim: a start past 0.5 s or an end short of the
-- video) decides whether the trim start is added back, and the worker
-- treats that start as the offset (camera_offset_s). The copy is
-- keyframe-snapped, so such a mark can sit up to one keyframe interval
-- late; the player edits the marks before cutting.
--
-- Clamped to the claim's rules so the prefill is always sendable: no
-- start before zero or inside the previous mark, no end past the video,
-- nothing longer than 180 s, anything shorter than 0.7 s dropped, at most
-- 400 marks.
create or replace function public._recut_marks_from_points(p_match public.matches)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_start    numeric;
  v_end      numeric;
  v_off      numeric := 0;
  v_prev     numeric := 0;
  v_t0       numeric;
  v_t1       numeric;
  v_n        int := 0;
  v_out      jsonb := '[]'::jsonb;
  r          record;
begin
  select v.settings into v_settings
    from public.match_processing_versions v
   where v.id = p_match.active_processing_version_id;
  v_start := coalesce(public._try_numeric(v_settings->>'trim_start_s'), 0);
  v_end := public._try_numeric(v_settings->>'trim_end_s');
  if v_start > 0.5
     or (v_end is not null and p_match.duration_s is not null
         and v_end < p_match.duration_s - 0.5) then
    v_off := greatest(v_start, 0);
  end if;

  for r in
    select p.id, p.t0::numeric as t0, p.t1::numeric as t1,
           p.confirmed_winner, coalesce(p.is_let, false) as is_let,
           coalesce(p.starred, false) as starred
      from public.points p
     where p.match_id = p_match.id
       and p.processing_version_id = p_match.active_processing_version_id
       and not p.deleted
       and p.t0 is not null and p.t1 is not null
     order by p.t0, p.idx, p.id
  loop
    v_t0 := round(greatest(r.t0 + v_off, 0, v_prev), 3);
    v_t1 := r.t1 + v_off;
    if p_match.duration_s is not null then
      v_t1 := least(v_t1, p_match.duration_s::numeric);
    end if;
    v_t1 := round(least(v_t1, v_t0 + 180), 3);
    if v_t1 - v_t0 < 0.7 then
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id::text,
      't0', v_t0,
      't1', v_t1,
      'winner', case when r.is_let then null
                     when r.confirmed_winner in ('user', 'opponent')
                       then r.confirmed_winner end,
      'isLet', r.is_let,
      'starred', r.starred,
      'tap', null,
      'rate', null));
    v_prev := v_t1;
    v_n := v_n + 1;
    exit when v_n >= 400;
  end loop;
  return v_out;
end;
$$;

revoke all on function public._recut_marks_from_points(public.matches)
  from public, anon, authenticated;

-- A new 'uploaded' match on the same original: the details, side, first
-- server, spoken scores and duration, and the content check already
-- recorded, so the gate never runs on a shared original (a processed
-- match proved its content; 79 legacy ones predate the stamp). No points,
-- no notes, no storage row: the original is counted once, on the match it
-- was uploaded to (see ledger_on_match_delete).
create or replace function public._copy_match_for_recut(p_match public.matches)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.matches
    (user_id, status, raw_path, duration_s, original_name,
     content_checked_at, opponent_name, venue, match_type, played_at,
     user_side, player_near_name, player_far_name, first_server,
     first_server_source, spoken_scores, source_fps)
  values
    (p_match.user_id, 'uploaded', p_match.raw_path, p_match.duration_s,
     p_match.original_name, coalesce(p_match.content_checked_at, now()),
     p_match.opponent_name, p_match.venue, p_match.match_type,
     p_match.played_at, p_match.user_side, p_match.player_near_name,
     p_match.player_far_name, p_match.first_server,
     p_match.first_server_source, p_match.spoken_scores, p_match.source_fps)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public._copy_match_for_recut(public.matches)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The contract calls
-- ---------------------------------------------------------------------------
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

revoke all on function public.recut_options(uuid) from public, anon;
grant execute on function public.recut_options(uuid) to authenticated;

-- Prepares the hand-cut draft for marking again. An unsubmitted draft
-- started for re-marking THIS cut is resumed unless p_fresh: one saved
-- after the live cut came to be (the latest of its version's creation,
-- completion and activation). Anything older (marks left unsent on the
-- raw page before the match was processed automatically, or marks of a
-- cut since replaced) is stale, and like a frozen draft it is written
-- again from the live cut's points and unfrozen. Never changes the match.
create or replace function public.start_recut(p_match_id uuid,
                                              p_fresh boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_match  public.matches%rowtype;
  v_reason text;
  v_draft  public.hand_cut_drafts%rowtype;
  v_marks  jsonb;
  v_mode   text;
  v_now    timestamptz := now();
  v_cut_since timestamptz;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.hand_cut_enabled(v_me) then
    raise exception 'not_enabled' using errcode = '42501';
  end if;
  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_reason := public._recut_reason(v_match);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  select greatest(v.created_at, v.completed_at, v.activated_at)
    into v_cut_since
    from public.match_processing_versions v
   where v.id = v_match.active_processing_version_id;

  select * into v_draft from public.hand_cut_drafts
   where match_id = p_match_id
     for update;
  if found and v_draft.submitted_at is null and not coalesce(p_fresh, false)
     and v_draft.updated_at >= coalesce(v_cut_since, '-infinity'::timestamptz) then
    return jsonb_build_object(
      'marks', v_draft.marks,
      'mode', coalesce(v_draft.mode, public._marks_mode(v_draft.marks)),
      'updated_at', v_draft.updated_at);
  end if;

  v_marks := public._recut_marks_from_points(v_match);
  v_mode := public._marks_mode(v_marks);
  insert into public.hand_cut_drafts
    (match_id, user_id, marks, mode, updated_at, submitted_at)
  values (p_match_id, v_me, v_marks, v_mode, v_now, null)
  on conflict (match_id) do update
    set marks = excluded.marks,
        mode = excluded.mode,
        updated_at = excluded.updated_at,
        submitted_at = null;
  return jsonb_build_object('marks', v_marks, 'mode', v_mode,
                            'updated_at', v_now);
end;
$$;

revoke all on function public.start_recut(uuid, boolean) from public, anon;
grant execute on function public.start_recut(uuid, boolean) to authenticated;

-- The hand-cut claim for a processed match.
--   p_replace true   a candidate version on this match, cut by the hand
--                    lane; the match stays ready and playable until the
--                    candidate is made live. match_id is this match.
--   p_replace false  the copy (copy_match_for_recut) with an ordinary
--                    hand cut claimed on it. match_id is the new match.
-- Replace always runs on the hand lane, never on the phone.
create or replace function public.claim_hand_recut(p_match_id uuid,
                                                   p_marks jsonb,
                                                   p_replace boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := (select auth.uid());
  v_match   public.matches%rowtype;
  v_job     uuid := gen_random_uuid();
  v_version uuid;
  v_new     uuid;
  v_claim   jsonb;
  v_active  int;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_replace is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not public.hand_cut_enabled(v_me) then
    raise exception 'not_enabled' using errcode = '42501';
  end if;

  -- The row lock is the serialization point, before every other check:
  -- two taps must not be able to start two cuts.
  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if public._recut_busy(v_match.id) then
    raise exception 'already_processing' using errcode = 'P0001';
  end if;
  if v_match.status <> 'ready' or v_match.cut_path is null then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if public._recut_support_request_open(v_match.id) then
    raise exception 'support_request' using errcode = 'P0001';
  end if;
  if v_match.raw_path is null
     or v_match.raw_path not like 'r2://ponglens-raw/' || v_me::text || '/%' then
    raise exception 'no_source' using errcode = 'P0001';
  end if;
  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;

  if not p_replace then
    v_new := public._copy_match_for_recut(v_match);
    -- claim_hand_cut on the copy: its own checks (the fairness cap and the
    -- marks among them), its draft, its job. A refusal rolls the copy back.
    v_claim := public.claim_hand_cut(v_new, p_marks);
    update public.jobs
       set options = options || jsonb_build_object(
             'recut', 'keep', 'recut_from_match_id', p_match_id)
     where id = (v_claim->>'job_id')::uuid;
    -- The prefilled marks moved to the new match with the claim.
    delete from public.hand_cut_drafts
     where match_id = p_match_id and submitted_at is null;
    return jsonb_build_object('job_id', (v_claim->>'job_id')::uuid,
                              'match_id', v_new);
  end if;

  if public._recut_has_coach_review(v_match.id) then
    raise exception 'coach_review' using errcode = 'P0001';
  end if;

  -- The same fairness cap claim_processing applies.
  select count(*) into v_active
    from public.jobs
   where user_id = v_me
     and status in ('queued', 'processing')
     and kind not in ('reclip', 'content_check');
  if v_active >= 4 then
    raise exception 'queue_full' using errcode = 'P0001';
  end if;

  perform public._hand_cut_validate_marks(p_marks, v_match.duration_s);

  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set marks = excluded.marks,
        submitted_at = now(),
        updated_at = now();

  insert into public.match_processing_versions
    (match_id, source_version_id, source_job_id, status, raw_path,
     settings, cut_source)
  values
    (v_match.id, v_match.active_processing_version_id, v_match.job_id,
     'candidate', v_match.raw_path,
     jsonb_build_object('source', 'manual', 'recut', 'replace'), 'manual')
  returning id into v_version;

  -- The job names the candidate; the worker reads the candidate from the
  -- version row (job_id), never from these options. matches.job_id and
  -- matches.status do not move: the live match is untouched until the
  -- candidate is made live, and the pages find the running job by
  -- options.match_id, as they find any other.
  insert into public.jobs (id, user_id, kind, status, input_path,
                           original_name, options)
  values (v_job, v_me, 'hand_cut', 'queued', v_match.raw_path,
          v_match.original_name,
          jsonb_build_object(
            'match_id', p_match_id,
            'source', 'manual',
            'recut', 'replace',
            'processing_version_id', v_version,
            'source_version_id', v_match.active_processing_version_id,
            'originating_match_job_id', v_job));

  update public.match_processing_versions set job_id = v_job where id = v_version;

  return jsonb_build_object('job_id', v_job, 'match_id', p_match_id);
end;
$$;

revoke all on function public.claim_hand_recut(uuid, jsonb, boolean) from public, anon;
grant execute on function public.claim_hand_recut(uuid, jsonb, boolean) to authenticated;

-- For automatic "Keep": a new uploaded match on the same original. The
-- client then calls /api/process for it (claim_processing: charging, trim
-- and strictness unchanged).
create or replace function public.copy_match_for_recut(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_match  public.matches%rowtype;
  v_reason text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_reason := public._recut_reason(v_match);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;
  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;
  return public._copy_match_for_recut(v_match);
end;
$$;

revoke all on function public.copy_match_for_recut(uuid) from public, anon;
grant execute on function public.copy_match_for_recut(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Publishing a candidate hand cut
-- ---------------------------------------------------------------------------
-- The live normalize_manual_cut_observations (pulled 2026-09-25) read the
-- ACTIVE version's points. Its body now lives here, for a named version,
-- so the candidate is checked against its marks before it can be made
-- live; normalize_manual_cut_observations calls it for the active version
-- and behaves exactly as before.
create or replace function public._normalize_manual_cut_observations_for_version(
  p_match_id uuid, p_version_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pair record;
  v_match record;
  v_mark_count integer;
  v_point_count integer;
  v_written integer := 0;
begin
  select m.id, m.user_id, d.marks
    into v_match
    from public.matches m
    join public.hand_cut_drafts d on d.match_id = m.id
   where m.id = p_match_id
   for update of m;
  if not found then
    raise exception 'manual cut source not found' using errcode = 'P0002';
  end if;

  select count(*) into v_mark_count
    from jsonb_array_elements(v_match.marks) as entries(mark)
   where mark->>'t0' is not null and mark->>'t1' is not null;
  select count(*) into v_point_count
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = p_version_id
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
         and p.processing_version_id = p_version_id
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
      p_version_id, (v_pair.mark->>'t0')::numeric,
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
      p_version_id, (v_pair.mark->>'t1')::numeric,
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

revoke all on function public._normalize_manual_cut_observations_for_version(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.normalize_manual_cut_observations(p_match_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_match record;
begin
  select m.id, m.cut_source, m.active_processing_version_id
    into v_match
    from public.matches m
    join public.hand_cut_drafts d on d.match_id = m.id
   where m.id = p_match_id
   for update of m;
  if not found or v_match.cut_source <> 'manual' then
    raise exception 'manual cut source not found' using errcode = 'P0002';
  end if;
  return public._normalize_manual_cut_observations_for_version(
    p_match_id, v_match.active_processing_version_id);
end;
$function$;

-- The replaced cut stops counting in storage the moment the new one is
-- live (its files stay 30 days for support; the sweep is phase 2). Its cut
-- by key, its clips by their folder: the match's root clip folder when it
-- was an ordinary cut, versions/<version>/ always (reclips of any version
-- land there). The negative rows carry the match, so a later deletion of
-- the match nets them instead of negating the same bytes twice.
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

revoke all on function public._ledger_uncount_version_media(uuid, uuid)
  from public, anon, authenticated;

-- Make a ready candidate hand cut live. The activation refuses while a
-- reclip, placement or reel job runs on the match; that refusal is caught
-- and answered activated=false, leaving the candidate ready for a retry
-- (the worker's, then the hand lane's sweep). Anything else raises.
--
-- On success, in the same transaction: the replaced cut's storage is
-- uncounted, clips that failed to encode are queued for a reclip (the
-- reclip trigger ignores an inactive version, so it never fired for
-- them), the canonical score is rebuilt from the new points (the
-- activation's own trigger rebuilds it; this confirms it is current), the
-- ordinary "Match ready" bell rings (the match was already ready, so
-- matches_notify does not), and the receipt is recorded once, keyed by the
-- job, as publish_hand_cut_v2 records an ordinary hand cut's.
create or replace function public._activate_hand_recut(p_match_id uuid,
                                                       p_version_id uuid,
                                                       p_job_id uuid,
                                                       p_observations integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m            public.matches%rowtype;
  d            public.hand_cut_drafts%rowtype;
  v_old        uuid;
  v_points     integer;
  v_missing    integer;
  v_point_ids  uuid[];
  v_activated  boolean := false;
  v_revision   bigint;
  v_status     text;
  v_receipt    jsonb;
begin
  select * into m from public.matches where id = p_match_id for update;
  v_old := m.active_processing_version_id;
  select count(*),
         count(*) filter (where p.clip_path is null),
         coalesce(array_agg(p.id order by p.t0, p.idx, p.id), '{}'::uuid[])
    into v_points, v_missing, v_point_ids
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = p_version_id
     and not p.deleted;

  begin
    -- What belongs to the match rather than to a cut is read from the
    -- match as it is now, not as it was when the candidate was published:
    -- a first server or spoken scores set while the candidate waited.
    update public.match_processing_versions
       set match_state = match_state || jsonb_build_object(
             'first_server', m.first_server,
             'first_server_source', m.first_server_source,
             'spoken_scores', m.spoken_scores,
             'story_crop', m.story_crop)
     where id = p_version_id;
    perform public.activate_match_processing_version(p_match_id, p_version_id);
    v_activated := true;
  exception when raise_exception then
    if sqlerrm <> 'match has unfinished derived work' then
      raise;
    end if;
  end;

  if not v_activated then
    return jsonb_build_object(
      'ok', true, 'contractVersion', 1,
      'matchId', p_match_id, 'jobId', p_job_id,
      'processingVersionId', p_version_id,
      'pointCount', v_points, 'observationCount', p_observations,
      'missingClipCount', v_missing,
      'activated', false,
      'scoreRevision', null, 'scoreProjectionStatus', null);
  end if;

  perform public._ledger_uncount_version_media(p_match_id, v_old);
  if v_missing > 0 then
    perform public.request_reclip(p_match_id);
  end if;

  perform public.refresh_match_score_state(p_match_id);
  select score_revision, score_projection_status
    into v_revision, v_status
    from public.matches where id = p_match_id;
  if v_status not in ('current', 'empty') then
    raise exception 'manual cut score projection is not current'
      using errcode = '23514';
  end if;

  insert into public.notifications (user_id, kind, match_id, title, body, href)
  values (m.user_id, 'match_ready', m.id, 'Match ready',
          'Your match' || public._vs_suffix(m.opponent_name)
            || ' is cut into points and ready to review.',
          '/match/' || m.id::text);

  v_receipt := jsonb_build_object(
    'ok', true, 'contractVersion', 1,
    'matchId', p_match_id, 'jobId', p_job_id,
    'processingVersionId', p_version_id,
    'previousVersionId', v_old,
    'pointCount', v_points, 'observationCount', p_observations,
    'missingClipCount', v_missing,
    'activated', true,
    'scoreRevision', v_revision, 'scoreProjectionStatus', v_status);

  select * into d from public.hand_cut_drafts where match_id = p_match_id;
  insert into public.match_score_mutations(
    request_id, match_id, actor_id, authority_scope, action,
    affected_point_ids, before_state, after_state, base_revision, result_revision
  ) values (
    p_job_id, p_match_id, m.user_id, 'owner_score', 'publish_hand_cut',
    v_point_ids,
    jsonb_build_object(
      'draftSubmittedAt', d.submitted_at,
      'processingVersionId', p_version_id,
      'previousVersionId', v_old),
    v_receipt,
    greatest(0, v_revision - 1), v_revision);
  return v_receipt;
end;
$$;

revoke all on function public._activate_hand_recut(uuid, uuid, uuid, integer)
  from public, anon, authenticated;

-- The hand lane's publication of a candidate hand cut. Called once the
-- candidate's points are inserted (processing_version_id = the candidate)
-- in the worker's transaction: checks them against the frozen marks,
-- writes the owner-manual observations, makes the candidate ready (its
-- cut, match.json, thumb, and a match state taken from the live match with
-- the hand cut's pads, no placement and no detector structure), finishes
-- the job, and tries to make it live. A ready candidate called again only
-- tries to make it live; one already live returns its receipt.
create or replace function public.publish_hand_recut(p_match_id uuid,
                                                     p_job_id uuid,
                                                     p_cut_path text,
                                                     p_thumb_path text,
                                                     p_match_json_path text,
                                                     p_clip_pads jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior        public.match_score_mutations%rowtype;
  m              public.matches%rowtype;
  j              public.jobs%rowtype;
  v              public.match_processing_versions%rowtype;
  d              public.hand_cut_drafts%rowtype;
  v_points       integer;
  v_unrecoverable integer;
  v_observations integer;
begin
  if p_match_id is null or p_job_id is null then
    raise exception 'manual cut publication identity is missing'
      using errcode = '23514';
  end if;

  select * into v_prior from public.match_score_mutations
   where request_id = p_job_id;
  if found then
    if v_prior.match_id <> p_match_id or v_prior.action <> 'publish_hand_cut' then
      raise exception 'manual cut publication id was reused'
        using errcode = '23514';
    end if;
    return v_prior.after_state;
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'manual cut match not found' using errcode = 'P0002';
  end if;
  select * into j from public.jobs where id = p_job_id for update;
  select * into v from public.match_processing_versions
   where job_id = p_job_id and match_id = p_match_id
     for update;
  if j.id is null or v.id is null
     or j.kind <> 'hand_cut'
     or j.user_id is distinct from m.user_id
     or j.options->>'match_id' is distinct from p_match_id::text
     or j.options->>'processing_version_id' is distinct from v.id::text
     or v.issue_id is not null
     or v.source_version_id is distinct from m.active_processing_version_id
     or v.status not in ('candidate', 'ready') then
    raise exception 'hand recut publication changed' using errcode = '23514';
  end if;

  if v.status = 'ready' then
    -- A redelivered queue message claims the job again ('processing');
    -- the activation needs it finished, as it was.
    if j.status not in ('done', 'processing') then
      raise exception 'hand recut publication changed' using errcode = '23514';
    end if;
    if j.status = 'processing' then
      update public.jobs set status = 'done', progress = 100 where id = p_job_id;
    end if;
    select count(*)::int into v_observations
      from public.point_timing_observations o
     where o.match_id = p_match_id and o.media_revision = v.id
       and o.origin = 'manual_cutter';
    return public._activate_hand_recut(p_match_id, v.id, p_job_id, v_observations);
  end if;

  if j.status <> 'processing' then
    raise exception 'hand recut publication changed' using errcode = '23514';
  end if;
  if p_cut_path is null or p_match_json_path is null
     or p_clip_pads is null or jsonb_typeof(p_clip_pads) <> 'object' then
    raise exception 'hand recut media is missing' using errcode = '23514';
  end if;
  select * into d from public.hand_cut_drafts
   where match_id = p_match_id for update;
  if not found or d.user_id is distinct from m.user_id
     or d.submitted_at is null then
    raise exception 'manual cut draft is not frozen' using errcode = '23514';
  end if;

  select count(*),
         count(*) filter (where p.clip_path is null and not p.edited)
    into v_points, v_unrecoverable
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = v.id
     and not p.deleted;
  if v_points = 0 then
    raise exception 'manual cut mark/point count mismatch' using errcode = '23514';
  end if;
  if v_unrecoverable > 0 then
    raise exception 'manual cut point clip is neither ready nor queued for reclip'
      using errcode = '23514';
  end if;

  v_observations := public._normalize_manual_cut_observations_for_version(
    p_match_id, v.id);

  update public.match_processing_versions
     set cut_path = p_cut_path,
         thumb_path = coalesce(p_thumb_path, m.thumb_path),
         match_json_path = p_match_json_path,
         cut_source = 'manual',
         match_state = to_jsonb(m) || jsonb_build_object(
           'status', 'ready',
           'job_id', p_job_id,
           'active_processing_version_id', v.id,
           'cut_path', p_cut_path,
           'thumb_path', coalesce(p_thumb_path, m.thumb_path),
           'match_json_path', p_match_json_path,
           'cut_source', 'manual',
           'clip_pads', p_clip_pads,
           'match_structure', null,
           'placement_status', 'not_requested',
           'placement_mapped_points', 0,
           'placement_failure_code', null,
           'placement_flagged', false),
         completed_at = now(),
         status = 'ready'
   where id = v.id;

  update public.jobs
     set status = 'done', progress = 100, result_path = p_cut_path,
         error = null
   where id = p_job_id;

  return public._activate_hand_recut(p_match_id, v.id, p_job_id, v_observations);
end;
$$;

revoke all on function public.publish_hand_recut(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_hand_recut(uuid, uuid, text, text, text, jsonb)
  to service_role;

-- The worker's retry of a candidate that was ready but could not be made
-- live yet.
create or replace function public.activate_hand_recut(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
begin
  select v.match_id into v_match
    from public.match_processing_versions v
   where v.job_id = p_job_id
     and v.issue_id is null
     and v.source_version_id is not null
   order by v.created_at desc
   limit 1;
  if v_match is null then
    raise exception 'hand recut not found' using errcode = 'P0002';
  end if;
  return public.publish_hand_recut(v_match, p_job_id, null, null, null, null);
end;
$$;

revoke all on function public.activate_hand_recut(uuid) from public, anon, authenticated;
grant execute on function public.activate_hand_recut(uuid) to service_role;

-- The hand lane's sweep: every ready candidate hand cut whose job is done
-- is tried again. Returns the ones made live now, so the worker can send
-- the ready email and queue their analysis. A candidate whose match moved
-- to another version while it waited can never be made live: it is
-- discarded and its marks handed back, with the re-cut failure bell.
create or replace function public.activate_pending_hand_recuts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_receipt jsonb;
  v_out     jsonb := '[]'::jsonb;
begin
  for r in
    select v.id, v.match_id, v.job_id, m.user_id,
           m.active_processing_version_id = v.source_version_id as current
      from public.match_processing_versions v
      join public.matches m on m.id = v.match_id
      join public.jobs j on j.id = v.job_id
     where v.status = 'ready'
       and v.issue_id is null
       and v.source_version_id is not null
       and j.kind = 'hand_cut'
       and j.status = 'done'
     order by v.completed_at
       for update of v skip locked
  loop
    if not r.current then
      update public.match_processing_versions set status = 'failed' where id = r.id;
      update public.hand_cut_drafts set submitted_at = null where match_id = r.match_id;
      insert into public.notifications (user_id, kind, title, body, href)
      values (r.user_id, 'upload_failed', 'The new cut didn''t finish.',
              'Your marks are saved.', '/match/' || r.match_id::text);
      continue;
    end if;
    begin
      v_receipt := public.publish_hand_recut(r.match_id, r.job_id,
                                             null, null, null, null);
      if coalesce((v_receipt->>'activated')::boolean, false) then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'job_id', r.job_id, 'user_id', r.user_id, 'match_id', r.match_id));
      end if;
    exception when others then
      raise warning 'hand recut % could not be made live: %', r.job_id, sqlerrm;
    end;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.activate_pending_hand_recuts() from public, anon, authenticated;
grant execute on function public.activate_pending_hand_recuts() to service_role;

-- ---------------------------------------------------------------------------
-- 7. The bell for a re-cut that did not finish
-- ---------------------------------------------------------------------------
-- The live definition with one branch before the insert: a Replace names
-- no place and no reason, only that the new cut did not finish and the
-- marks are kept. The match itself is unchanged, so nothing else is said.
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

-- ---------------------------------------------------------------------------
-- 8. Support reprocessing waits for a player's own re-cut
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25) with one refusal after the match
-- lock. The reverse direction is claim_hand_recut's support_request.
create or replace function public.admin_start_match_reprocess(p_issue_id uuid, p_options jsonb, p_internal_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- A player's own re-cut builds a candidate of the same live cut. It
  -- finishes (or is discarded) first; then this request can start.
  if public._recut_busy(m.id) then raise exception 'player re-cut running' using errcode='P0001'; end if;
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

-- ---------------------------------------------------------------------------
-- 9. A shared original is counted once, on a match that still exists
-- ---------------------------------------------------------------------------
-- The live trigger (pulled 2026-09-25) with one step first. A match copied
-- to be cut again shares its original (the copy has no storage row of its
-- own). Deleting either must leave the original counted for the other:
-- the deleted match's row for that key moves to the oldest surviving match
-- of the same owner that points at it, unless that match already counts
-- it. Moved rows are no longer recorded against the deleted match, so
-- step 1 leaves them alone.
create or replace function public.ledger_on_match_delete()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  keys text[];
  v_survivor uuid;
begin
  -- 0. an original another match still uses stays counted, on that match
  if old.raw_path is not null then
    select m.id into v_survivor
      from public.matches m
     where m.raw_path = old.raw_path
       and m.user_id = old.user_id
       and m.id <> old.id
     order by m.created_at, m.id
     limit 1;
    -- Unless that match already counts it (two rows for one object, as
    -- older copies between matches have): then this one is negated below.
    if v_survivor is not null
       and coalesce((select sum(l.bytes) from public.storage_ledger l
                      where l.match_id = v_survivor
                        and l.r2_key = old.raw_path), 0) <= 0 then
      update public.storage_ledger
         set match_id = v_survivor
       where match_id = old.id
         and r2_key = old.raw_path;
    end if;
  end if;

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

-- ---------------------------------------------------------------------------
-- Postconditions: fail the migration if a guard this depends on is missing
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  definition text;
begin
  for r in
    select * from (values
      ('resolve_share_placement(text)', 'p.processing_version_id = m.active_processing_version_id'),
      ('resolve_share_link(text)', 'match_processing_versions pv'),
      ('resolve_share_link(text)', 'pv.cut_source else m.cut_source'),
      ('_hand_cut_hand_back(uuid)', 'processing_version_id = v_candidate.id'),
      ('_hand_cut_hand_back(uuid)', 'processing_version_id = v_match.active_processing_version_id'),
      ('activate_match_processing_version(uuid,uuid)', 'cut_source=v.cut_source'),
      ('activate_match_processing_version(uuid,uuid)', 'r2_key=null'),
      ('activate_match_processing_version(uuid,uuid)', 'match has unfinished derived work'),
      ('sync_active_match_processing_version()', 'v_sync_provenance'),
      ('sync_active_match_processing_version()', 'cut_source=new.cut_source'),
      ('normalize_manual_cut_observations(uuid)', '_normalize_manual_cut_observations_for_version'),
      ('admin_start_match_reprocess(uuid,jsonb,text)', '_recut_busy'),
      ('admin_start_match_reprocess(uuid,jsonb,text)', 'previous run has not failed'),
      ('admin_start_match_reprocess(uuid,jsonb,text)', 'unsupported option'),
      ('ledger_on_match_delete()', 'v_survivor'),
      ('jobs_notify_failed()', 'The new cut didn''''t finish.')
    ) expected(signature, marker)
  loop
    if to_regprocedure('public.' || r.signature) is null then
      raise exception 'cut again postcondition failed: missing %', r.signature;
    end if;
    definition := pg_get_functiondef(to_regprocedure('public.' || r.signature));
    if position(r.marker in definition) = 0 then
      raise exception 'cut again postcondition failed: % lacks %', r.signature, r.marker;
    end if;
  end loop;
end $$;
