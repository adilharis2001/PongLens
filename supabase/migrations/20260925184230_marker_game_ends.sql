-- The owner's game ends, through marking a scored match again.
--
-- Cut again (20260925124616) opens the marker prefilled from the live
-- points, but the marks carried only winner, let and star. The owner's
-- game corrections from Keep score ("Players changed ends":
-- points.game_end_override, and points.game_winner_override for a game the
-- score cannot prove) were left behind, so the marker's running score
-- walked plain eleven-clear-by-two games (match 623c09c6 read as one long
-- game where Keep score had 1-1), and a Replace built its new points from
-- marks that no longer had them.
--
-- A mark now carries them as `gameEnd` ('end' | 'continue') and
-- `gameWinner` ('user' | 'opponent'), under those names in both stored
-- shapes (the full marks a draft is saved in and the short form a claim is
-- sent), present only when set. The marker has no control for them; they
-- ride on their mark and leave with it.
--
--  1. _recut_marks_from_points copies each visible point's corrections onto
--     its mark, so start_recut prefills them.
--  2. The two claim checks (_hand_cut_claim_checks for claim_hand_cut and
--     claim_device_hand_cut, _hand_cut_validate_marks for claim_hand_recut)
--     accept them and refuse any other value, as they refuse a stray `w`.
--     The two loops stay identical.
--  3. The cut writes them onto the points it made, in the database: the
--     publication already pairs mark k with point k and checks the pairing
--     (_normalize_manual_cut_observations_for_version), and the new private
--     _apply_hand_cut_game_marks uses that same pairing right after it,
--     before the canonical score is rebuilt. publish_hand_cut_v2 does it
--     for a first hand cut (the Mac's or a checked phone cut, and the
--     "keep" copy of a match cut again); publish_hand_recut for a Replace
--     candidate, before _activate_hand_recut makes it live and projects
--     its score. So the projection is right in one step, and the hand lane
--     needs no new release: it already inserts the points and calls these
--     two functions inside one transaction, and never reads the new keys.
--
-- Every replaced function was pulled from production with
-- pg_get_functiondef on 2026-09-25 and edited from that; each change is
-- marked "Changed". CREATE OR REPLACE keeps each one's grants (the worker
-- and service_role keep EXECUTE); the revokes after each only restate that
-- no client can call them. The new function is revoked from anon and
-- authenticated explicitly.
--
-- Old drafts and old clients: marks without the keys read, validate and
-- publish exactly as before. An untouched prefill is rewritten from the
-- points on the next open (20260925133555), so it gains them. The
-- signature that decides whether a prefill was touched (_marks_signature)
-- deliberately ignores them: an older app that saves a prefill back
-- without them leaves it a prefill, and the next open restores them.
--
-- Rollback: re-apply the five definitions from 20260925124616_cut_again.sql
-- (_hand_cut_validate_marks, _recut_marks_from_points, publish_hand_recut),
-- 20260925105830_device_hand_cut_silent_handoff.sql
-- (_hand_cut_claim_checks) and 20260916120000_canonical_score_commands.sql
-- (publish_hand_cut_v2), then drop _apply_hand_cut_game_marks. Corrections
-- already written onto points stay, as the owner's own.
--
-- Tests: supabase/tests/marker_game_ends.sql (commands in
-- supabase/tests/marker_game_ends_stubs.sql) and
-- src/lib/markerGameEndsMigration.test.ts.

-- ---------------------------------------------------------------------------
-- 1. The prefill
-- ---------------------------------------------------------------------------
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
    -- Changed: the owner's two game corrections come with the point.
    select p.id, p.t0::numeric as t0, p.t1::numeric as t1,
           p.confirmed_winner, coalesce(p.is_let, false) as is_let,
           coalesce(p.starred, false) as starred,
           p.game_end_override, p.game_winner_override
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
      'rate', null)
      -- Changed: present only when set, as both apps write them.
      || case when r.game_end_override in ('end', 'continue')
              then jsonb_build_object('gameEnd', r.game_end_override)
              else '{}'::jsonb end
      || case when r.game_winner_override in ('user', 'opponent')
              then jsonb_build_object('gameWinner', r.game_winner_override)
              else '{}'::jsonb end);
    v_prev := v_t1;
    v_n := v_n + 1;
    exit when v_n >= 400;
  end loop;
  return v_out;
end;
$$;

revoke all on function public._recut_marks_from_points(public.matches)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The claims' mark checks
-- ---------------------------------------------------------------------------
-- claim_hand_recut's (the loop of _hand_cut_claim_checks below, verbatim,
-- pinned by src/lib/markerGameEndsMigration.test.ts).
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
       -- Changed: the owner's game corrections, when a mark carries them.
       or (v_mark->>'gameEnd' is not null
           and v_mark->>'gameEnd' not in ('end', 'continue'))
       or (v_mark->>'gameWinner' is not null
           and v_mark->>'gameWinner' not in ('user', 'opponent'))
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

create or replace function public._hand_cut_claim_checks(p_match_id uuid, p_marks jsonb)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_n        int;
  v_mark     jsonb;
  v_prev_t1  numeric := -1;
  v_t0       numeric;
  v_t1       numeric;
  v_active   int;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.hand_cut_enabled(v_me) then
    raise exception 'not_enabled' using errcode = '42501';
  end if;

  -- The row lock is the serialization point and comes before every other
  -- check, the same shape claim_processing uses: two taps must not be able
  -- to queue two jobs.
  select * into v_match
    from public.matches
   where id = p_match_id and user_id = v_me
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_match.status not in ('uploaded', 'failed') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  -- A cut already exists: this is a processed match, whatever its status.
  if v_match.cut_path is not null then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  if v_match.raw_path is null
     or v_match.raw_path not like 'r2://ponglens-raw/' || v_me::text || '/%' then
    raise exception 'no_source' using errcode = 'P0001';
  end if;

  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;

  -- The content gate deletes the raw object and nulls raw_path with no
  -- status guard, so marking must not start while it is still queued.
  if v_match.content_checked_at is null then
    raise exception 'check_pending' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.points where match_id = p_match_id) then
    raise exception 'already_cut' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.jobs
     where (options->>'match_id')::uuid = p_match_id
       and status in ('queued', 'processing')
  ) then
    raise exception 'already_processing' using errcode = 'P0001';
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

  if jsonb_typeof(p_marks) <> 'array' then
    raise exception 'invalid_marks' using errcode = '23514';
  end if;
  v_n := jsonb_array_length(p_marks);
  if v_n < 1 or v_n > 400 then
    raise exception 'invalid_marks' using errcode = '23514';
  end if;

  -- The client refuses the same bounds at the tap, so this is a backstop
  -- rather than a path a player can reach. Nothing is silently dropped:
  -- an invalid set is refused whole.
  for v_mark in select * from jsonb_array_elements(p_marks) loop
    v_t0 := (v_mark->>'t0')::numeric;
    v_t1 := (v_mark->>'t1')::numeric;
    if v_t0 is null or v_t1 is null
       or v_t0 < 0
       or v_t1 - v_t0 < 0.7
       or v_t1 - v_t0 > 180
       or v_t1 > v_match.duration_s + 1
       or v_t0 < v_prev_t1
       or (v_mark->>'w' is not null and v_mark->>'w' not in ('user', 'opponent'))
       or ((v_mark->>'let')::boolean and v_mark->>'w' is not null)
       -- Changed: the owner's game corrections, when a mark carries them.
       or (v_mark->>'gameEnd' is not null
           and v_mark->>'gameEnd' not in ('end', 'continue'))
       or (v_mark->>'gameWinner' is not null
           and v_mark->>'gameWinner' not in ('user', 'opponent'))
    then
      raise exception 'invalid_marks' using errcode = '23514';
    end if;
    v_prev_t1 := v_t1;
  end loop;

  return v_match;
end;
$$;

revoke all on function public._hand_cut_claim_checks(uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The cut keeps them
-- ---------------------------------------------------------------------------
-- The owner's game corrections, from the frozen marks onto the points a
-- cut just made on one version: mark k onto point k, in the pairing
-- _normalize_manual_cut_observations_for_version uses and checks (marks
-- by start, points by (t0, idx, id), the same count, each within 0.06 s).
-- Called straight after that check, inside the same publication. The
-- points end up with exactly their marks' corrections; a mark without one
-- leaves its point with none. Returns how many points it changed.
create or replace function public._apply_hand_cut_game_marks(p_match_id uuid,
                                                             p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marks   jsonb;
  v_written integer;
begin
  select d.marks into v_marks
    from public.hand_cut_drafts d
   where d.match_id = p_match_id;
  if v_marks is null or jsonb_typeof(v_marks) <> 'array' then
    return 0;
  end if;

  with marks as (
    select row_number() over (order by (mark->>'t0')::numeric) as ordinal,
           case when mark->>'gameEnd' in ('end', 'continue')
                then mark->>'gameEnd' end as game_end,
           case when mark->>'gameWinner' in ('user', 'opponent')
                then mark->>'gameWinner' end as game_winner
      from jsonb_array_elements(v_marks) as entries(mark)
     where mark->>'t0' is not null and mark->>'t1' is not null
  ), version_points as (
    select row_number() over (order by p.t0, p.idx, p.id) as ordinal,
           p.id
      from public.points p
     where p.match_id = p_match_id
       and p.processing_version_id = p_version_id
       and not p.deleted
  ), pairs as (
    select vp.id, m.game_end, m.game_winner
      from marks m
      join version_points vp using (ordinal)
  )
  update public.points p
     set game_end_override = pairs.game_end,
         game_winner_override = pairs.game_winner
    from pairs
   where p.id = pairs.id
     and (p.game_end_override is distinct from pairs.game_end
          or p.game_winner_override is distinct from pairs.game_winner);
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public._apply_hand_cut_game_marks(uuid, uuid)
  from public, anon, authenticated;

-- A first hand cut (and the "keep" copy of a match cut again).
create or replace function public.publish_hand_cut_v2(p_match_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior public.match_score_mutations%rowtype;
  v_match public.matches%rowtype;
  v_job public.jobs%rowtype;
  v_draft public.hand_cut_drafts%rowtype;
  v_point_count integer;
  v_missing_clip_count integer;
  v_unrecoverable_clip_count integer;
  v_observation_count integer;
  v_point_ids uuid[];
  v_result_revision bigint;
  v_projection_status text;
  v_receipt jsonb;
begin
  if p_match_id is null or p_job_id is null then
    raise exception 'manual cut publication identity is missing'
      using errcode = '23514';
  end if;

  select * into v_prior
    from public.match_score_mutations
   where request_id = p_job_id;
  if found then
    if v_prior.match_id <> p_match_id or v_prior.action <> 'publish_hand_cut' then
      raise exception 'manual cut publication id was reused'
        using errcode = '23514';
    end if;
    return v_prior.after_state;
  end if;

  select * into v_match from public.matches
   where id = p_match_id for update;
  if not found then
    raise exception 'manual cut match not found' using errcode = 'P0002';
  end if;
  select * into v_job from public.jobs
   where id = p_job_id for update;
  if not found
     or v_match.job_id is distinct from p_job_id
     or v_job.user_id is distinct from v_match.user_id
     or v_job.kind <> 'hand_cut'
     or v_job.status <> 'processing'
     or v_job.options->>'match_id' is distinct from p_match_id::text then
    raise exception 'manual cut publication job changed'
      using errcode = '23514';
  end if;
  if v_match.cut_source <> 'manual' or v_match.status <> 'processing' then
    raise exception 'manual cut publication state changed'
      using errcode = '23514';
  end if;
  if v_match.active_processing_version_id is null
     or v_job.options->>'processing_version_id' is distinct from
        v_match.active_processing_version_id::text then
    raise exception 'manual cut processing version changed'
      using errcode = '23514';
  end if;

  select * into v_draft from public.hand_cut_drafts
   where match_id = p_match_id for update;
  if not found or v_draft.user_id is distinct from v_match.user_id
     or v_draft.submitted_at is null then
    raise exception 'manual cut draft is not frozen'
      using errcode = '23514';
  end if;

  select count(*),
         count(*) filter (where p.clip_path is null),
         count(*) filter (where p.clip_path is null and not p.edited),
         coalesce(array_agg(p.id order by p.t0,p.idx,p.id),'{}'::uuid[])
    into v_point_count, v_missing_clip_count,
         v_unrecoverable_clip_count, v_point_ids
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = v_match.active_processing_version_id
     and not p.deleted;
  if v_point_count = 0 then
    raise exception 'manual cut mark/point count mismatch'
      using errcode = '23514';
  end if;
  if v_unrecoverable_clip_count > 0 then
    raise exception 'manual cut point clip is neither ready nor queued for reclip'
      using errcode = '23514';
  end if;

  -- This validates exact mark count/order/timing before writing idempotent
  -- owner-manual observations. Any exception escapes so the caller's point
  -- transaction cannot commit partially.
  v_observation_count := public.normalize_manual_cut_observations(p_match_id);
  -- Changed: the owner's game corrections onto the points, in the pairing
  -- just checked, before the score is projected.
  perform public._apply_hand_cut_game_marks(
    p_match_id, v_match.active_processing_version_id);
  perform public.refresh_match_score_state(p_match_id);
  select score_revision, score_projection_status
    into v_result_revision, v_projection_status
    from public.matches where id = p_match_id;
  if v_projection_status not in ('current','empty') then
    raise exception 'manual cut score projection is not current'
      using errcode = '23514';
  end if;

  v_receipt := jsonb_build_object(
    'ok', true,
    'contractVersion', 1,
    'matchId', p_match_id,
    'jobId', p_job_id,
    'processingVersionId', v_match.active_processing_version_id,
    'pointCount', v_point_count,
    'observationCount', v_observation_count,
    'missingClipCount', v_missing_clip_count,
    'scoreRevision', v_result_revision,
    'scoreProjectionStatus', v_projection_status
  );

  insert into public.match_score_mutations(
    request_id,match_id,actor_id,authority_scope,action,
    affected_point_ids,before_state,after_state,base_revision,result_revision
  ) values (
    p_job_id,p_match_id,v_match.user_id,'owner_score','publish_hand_cut',
    v_point_ids,
    jsonb_build_object(
      'draftSubmittedAt',v_draft.submitted_at,
      'processingVersionId',v_match.active_processing_version_id
    ),
    v_receipt,
    greatest(0,v_result_revision-1),v_result_revision
  );
  return v_receipt;
end;
$$;

revoke all on function public.publish_hand_cut_v2(uuid, uuid)
  from public, anon, authenticated;

-- A Replace candidate. Its points are on the candidate version, which no
-- reader projects; _activate_hand_recut rebuilds the score when it makes
-- the candidate live, now or from the sweep, so the corrections are
-- written here, once, at the first publication.
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
  -- Changed: the owner's game corrections onto the candidate's points, in
  -- the pairing just checked, before the activation projects the score.
  perform public._apply_hand_cut_game_marks(p_match_id, v.id);

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
