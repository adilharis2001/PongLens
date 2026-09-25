-- Cut a match again, phase 2: Replace, processed automatically, and the
-- files of a replaced cut removed 30 days later.
--
-- Design:   docs/superpowers/specs/2026-09-25-cut-again-design.md (4, 5, 8:
--           items 6-sweep, 12, 13)
-- Contract: docs/superpowers/specs/2026-09-25-cut-again-contract.md
--           ("Phase 2": claim_auto_recut)
-- Phase 1:  20260925124616_cut_again.sql and
--           docs/research/2026-09-25-cut-again/RELEASE.md
--
-- A player's automatic Replace is a candidate processing version of the
-- match, built by the main lane with the same pipeline as a fresh upload
-- (the body-first assembler included) and made live in one step when it
-- is ready. The match stays ready and plays as before until then. Minutes
-- are charged exactly as claim_processing charges them and come back if
-- the new cut does not finish.
--
--  1. recut_auto_replace is read in one place (_recut_auto_replace_on), by
--     recut_options and by the claim. Still seeded 'off'; the release step
--     turns it on.
--  2. claim_auto_recut: the contract's call. Replace makes the candidate
--     and a match_reprocess job for it (the job kind support reprocessing
--     already uses, so /admin/processing names it "Reprocessing a match");
--     Keep is copy_match_for_recut plus claim_processing on the copy.
--  3. The player's job passes the support-only rollout guard
--     (guard_match_reprocess_job_rollout); clients still cannot write it
--     (guard_reprocess_job_client, unchanged).
--  4. publish_auto_recut / activate_auto_recut / activate_pending_auto_recuts
--     / fail_auto_recut: the main lane's publication, retry, sweep and
--     refund. Activation is phase 1's (activate_match_processing_version):
--     the canonical score rebuilt, the replaced cut's storage uncounted,
--     the ordinary "Match ready" bell.
--  5. The bell for a failed automatic re-cut: "The new cut didn't finish."
--  6. The owner's processing feed names the running re-cut, so web and iOS
--     show the ordinary progress on a match that stays ready.
--  7. The replaced cut's storage: _ledger_uncount_version_media also finds
--     a cut booked without its match (every automatic cut is), and the
--     conventional key of a candidate that never finished.
--  8. Retired versions (a cut the player replaced, or a re-cut of theirs
--     that failed): listed for the main lane's sweep and the nightly
--     storage measurement, never restored once their files are gone.
--
-- Apply AFTER main/fast (and the cloud twin) run the release that knows
-- claim_auto_recut's jobs; the flag stays 'off' either way.
--
-- Every replaced function was pulled from production with
-- pg_get_functiondef on 2026-09-25 and edited from that (activation,
-- ledger uncount, failure bell and recut_options were byte-identical to
-- 20260925124616; the rollout guard and the processing feed are
-- production's). CREATE OR REPLACE keeps each replaced function's ACL.
-- Every NEW function is revoked from anon/authenticated explicitly.

-- ---------------------------------------------------------------------------
-- 0. When a retired version's files were removed
-- ---------------------------------------------------------------------------
alter table public.match_processing_versions
  add column if not exists media_swept_at timestamptz;

comment on column public.match_processing_versions.media_swept_at is
  'Set by the main lane''s retired-version sweep just before it removes the '
  'files of a cut the player replaced (or a re-cut of theirs that failed), '
  '30 days after that happened. A version with this set can never be made '
  'live again (activate_match_processing_version refuses it).';

-- ---------------------------------------------------------------------------
-- 1. The switch, read once
-- ---------------------------------------------------------------------------
-- 'off' | 'admins' | 'on'. 'admins' is the admin accounts, as for
-- device_hand_cut. Anything else, or no row, is off.
create or replace function public._recut_auto_replace_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case (select value from public.app_config
                where key = 'recut_auto_replace')
           when 'on' then true
           when 'admins' then public.is_admin()
           else false end;
$$;

revoke all on function public._recut_auto_replace_on() from public, anon, authenticated;

-- The live definition (pulled 2026-09-25) with the switch read through
-- _recut_auto_replace_on, the same reading the claim makes.
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
  v_auto_on := public._recut_auto_replace_on();

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

-- ---------------------------------------------------------------------------
-- 2. The player's job passes the support rollout guard
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25) with one exemption first. The
-- support switch (match_reprocessing_enabled) gates the admin's reviewed
-- reprocessing; a player's own automatic Replace is gated by
-- recut_auto_replace when claim_auto_recut makes it, and the worker must be
-- able to report on it afterwards. Clients still cannot create or change
-- any match_reprocess job (guard_reprocess_job_client).
--
-- Written inline, not through a helper: this trigger runs as the caller on
-- every write to jobs, including the apps', and a helper they may not
-- execute would refuse every job write (20260925133639).
create or replace function public.guard_match_reprocess_job_rollout()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.kind = 'match_reprocess'
    and coalesce(new.options->>'recut','') = 'replace'
    and not (new.options ? 'issue_id')
    and (tg_op = 'INSERT' or (old.kind = 'match_reprocess'
      and coalesce(old.options->>'recut','') = 'replace'
      and not (old.options ? 'issue_id'))) then
    return new;
  end if;
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

-- ---------------------------------------------------------------------------
-- 3. The replaced cut's storage, found however it was booked
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25) found the cut only among rows
-- recorded against the match. An automatic cut is booked before its match
-- row can exist, without the match (worker.py: "its deletion trigger frees
-- this ledger balance by matches.cut_path"), so replacing an automatic cut
-- left its video counted: 427 of the 443 cut rows in production have no
-- match. Now the cut is found by its key, and a candidate that never
-- finished (no cut_path recorded) by the key the worker gives it. Clips,
-- match.json and the rest are unchanged: by their folder, on the match,
-- except that the match's own folder is uncounted only for the match's
-- first cut (no source version). Before, a candidate with no cut_path read
-- as a first cut there, and uncounting it would have uncounted the live
-- cut's clips.
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
     where l.r2_key is not null
       and l.user_id = v_user
       and (l.r2_key = v.cut_path
            or l.r2_key like 'r2://%/results/' || v_user::text || '/'
                             || p_match_id::text || '/versions/'
                             || p_version_id::text || '.mp4'
            or (l.match_id = p_match_id
                and (l.r2_key like 'r2://%/points/' || v_user::text || '/'
                                   || p_match_id::text || '/versions/'
                                   || p_version_id::text || '/%'
                     or (coalesce(v.cut_path, '') not like '%/versions/%'
                         and v.source_version_id is null
                         and l.r2_key like 'r2://%/points/' || v_user::text || '/'
                                           || p_match_id::text || '/'))))
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

-- ---------------------------------------------------------------------------
-- 4. A version whose files are gone is never made live again
-- ---------------------------------------------------------------------------
-- The live activation (pulled 2026-09-25) with one refusal: restoring a
-- retired version after the sweep removed its files would publish a match
-- with no video. Everything else unchanged.
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
  if v.media_swept_at is not null then raise exception 'version files were removed' using errcode='P0001'; end if;
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
-- 5. The claim
-- ---------------------------------------------------------------------------
-- claim_auto_recut(match, replace, trim, strictness), owner only.
--
--   p_replace true   a candidate version on this match and a
--                    match_reprocess job for it, on the main lane; the
--                    match stays ready and playable until the candidate is
--                    made live. match_id is this match. Charged exactly as
--                    claim_processing charges (the kept window rounded up
--                    to whole minutes, never under one; the same balance,
--                    grant, quota and fairness cap; one spend row on the
--                    processing ledger), refunded by fail_auto_recut.
--   p_replace false  copy_match_for_recut, then claim_processing on the
--                    copy with the apps' own arguments (points and the
--                    detailed analysis, as every processed upload asks).
--                    match_id is the new match. The apps reach the same
--                    thing through copy_match_for_recut and /api/process;
--                    both stay.
--
-- The refusals are claim_hand_recut's, in its order (already_processing,
-- bad_state, support_request, no_source, duration_unknown; coach_review
-- for Replace), then claim_processing's (commerce_disabled, invalid_input,
-- trim_too_short, queue_full, insufficient_minutes), and not_enabled while
-- recut_auto_replace does not allow this account a Replace.
create or replace function public.claim_auto_recut(p_match_id uuid,
                                                   p_replace boolean,
                                                   p_trim_start_s numeric,
                                                   p_trim_end_s numeric,
                                                   p_strictness text)
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
  v_mode    text;
  v_start   double precision;
  v_end     double precision;
  v_charge  integer;
  v_active  integer;
  v_size    bigint;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_replace is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_strictness is null or p_strictness not in ('tight', 'normal', 'loose') then
    raise exception 'invalid_input' using errcode = '23514';
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
    -- claim_processing on the copy: its own checks, charge and job. A
    -- refusal rolls the copy back with it.
    v_claim := public.claim_processing(
      v_new, p_trim_start_s::double precision, p_trim_end_s::double precision,
      true, true, p_strictness, null, null);
    update public.jobs
       set options = options || jsonb_build_object(
             'recut', 'keep', 'recut_from_match_id', p_match_id)
     where id = (v_claim->>'job_id')::uuid;
    return jsonb_build_object('job_id', (v_claim->>'job_id')::uuid,
                              'match_id', v_new);
  end if;

  if public._recut_has_coach_review(v_match.id) then
    raise exception 'coach_review' using errcode = 'P0001';
  end if;
  if not public._recut_auto_replace_on() then
    raise exception 'not_enabled' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;

  -- claim_processing's window and charge, to the line.
  v_start := greatest(coalesce(p_trim_start_s::double precision, 0), 0);
  v_end := least(coalesce(p_trim_end_s::double precision, v_match.duration_s),
                 v_match.duration_s);
  if v_end - v_start < 5 then
    raise exception 'trim_too_short' using errcode = 'P0001';
  end if;
  v_charge := greatest(1, ceil((v_end - v_start) / 60.0))::integer;

  select count(*) into v_active from public.jobs j
   where j.user_id = v_me
     and j.status in ('queued', 'processing')
     and j.kind not in ('reclip', 'content_check');
  if v_active >= 4 then
    raise exception 'queue_full' using errcode = 'P0001';
  end if;

  v_mode := case when public.is_qa(v_me) then 'test' else 'live' end;
  perform public._ensure_processing_grant(v_me, v_mode);
  perform public._ensure_quota(v_me);
  perform 1 from public.user_quotas where user_id = v_me for update;
  if public._processing_balance(v_me, v_mode) < v_charge then
    raise exception 'insufficient_minutes' using errcode = 'P0001';
  end if;

  select sum(l.bytes)::bigint into v_size
    from public.storage_ledger l
   where l.user_id = v_me
     and l.match_id = p_match_id
     and l.r2_key = v_match.raw_path
     and l.kind = 'other';
  if v_size is not null and v_size <= 0 then
    v_size := null;
  end if;

  insert into public.match_processing_versions
    (match_id, source_version_id, source_job_id, status, raw_path,
     settings, cut_source)
  values
    (v_match.id, v_match.active_processing_version_id, v_match.job_id,
     'candidate', v_match.raw_path,
     jsonb_build_object('source', 'auto', 'recut', 'replace',
                        'strictness', p_strictness, 'placement', true,
                        'trim_start_s', v_start, 'trim_end_s', v_end),
     'auto')
  returning id into v_version;

  -- The job names the candidate; the worker reads the candidate from the
  -- version row (job_id), never from these options. matches.job_id and
  -- matches.status do not move: the live match is untouched until the
  -- candidate is made live, and the pages find the running job by
  -- options.match_id, as they find any other. The options are
  -- claim_processing's, so reclips, detailed analysis and highlights read
  -- the trim window from this job once the candidate is live.
  insert into public.jobs (id, user_id, kind, status, input_path,
                           original_name, options,
                           source_duration_s, source_size_bytes)
  values (v_job, v_me, 'match_reprocess', 'queued', v_match.raw_path,
          v_match.original_name,
          jsonb_build_object(
            'match_id', p_match_id,
            'trim_start_s', v_start,
            'trim_end_s', v_end,
            'points', true,
            'placement', true,
            'strictness', p_strictness,
            'funding', 'personal',
            'order_id', null,
            'charged_minutes', v_charge,
            'recut', 'replace',
            'processing_version_id', v_version,
            'source_version_id', v_match.active_processing_version_id),
          v_end - v_start, v_size);

  update public.match_processing_versions set job_id = v_job where id = v_version;

  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode, match_id, job_id, order_id)
  values
    (v_me, -v_charge, 'spend', 'personal', v_mode, p_match_id, v_job, null);

  return jsonb_build_object('job_id', v_job, 'match_id', p_match_id);
end;
$$;

revoke all on function public.claim_auto_recut(uuid, boolean, numeric, numeric, text)
  from public, anon;
grant execute on function public.claim_auto_recut(uuid, boolean, numeric, numeric, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Publishing a candidate automatic cut
-- ---------------------------------------------------------------------------
-- The candidate this job builds: a player's re-cut (no support request,
-- a source version), read from the version row, never from job options.
create or replace function public._auto_recut_version(p_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id
    from public.match_processing_versions v
    join public.jobs j on j.id = v.job_id
   where v.job_id = p_job_id
     and v.issue_id is null
     and v.source_version_id is not null
     and j.kind = 'match_reprocess'
     and coalesce(j.options->>'recut', '') = 'replace'
     and not (j.options ? 'issue_id')
   order by v.created_at desc
   limit 1;
$$;

revoke all on function public._auto_recut_version(uuid) from public, anon, authenticated;

-- Make a ready candidate automatic cut live. The activation refuses while a
-- reclip, detailed analysis or share video runs on the match; that refusal
-- is answered activated=false, leaving the candidate ready for a retry (the
-- worker's, then the main lane's sweep). Anything else raises.
--
-- On success, in the same transaction: the replaced cut's storage is
-- uncounted, the canonical score is rebuilt from the new (unscored) points
-- and must read current, the ordinary "Match ready" bell rings (the match
-- was already ready, so matches_notify does not), and the ordinary worker
-- publication receipt is recorded (replace_worker_points, keyed by the
-- version, as finalize_worker_points_v2 records a fresh upload's).
--
-- 'activated' says THIS call made it live, so a retry that finds it live
-- already (the sweep got there first) sends nothing twice; 'live' says it
-- is live now.
create or replace function public._activate_auto_recut(p_match_id uuid,
                                                       p_version_id uuid,
                                                       p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m            public.matches%rowtype;
  v_old        uuid;
  v_points     integer;
  v_point_ids  uuid[];
  v_activated  boolean := false;
  v_revision   bigint;
  v_status     text;
  v_receipt    jsonb;
begin
  select * into m from public.matches where id = p_match_id for update;
  v_old := m.active_processing_version_id;
  select count(*),
         coalesce(array_agg(p.id order by p.t0, p.idx, p.id), '{}'::uuid[])
    into v_points, v_point_ids
    from public.points p
   where p.match_id = p_match_id
     and p.processing_version_id = p_version_id
     and not p.deleted;

  begin
    -- What belongs to the match rather than to a cut is read from the
    -- match as it is now: who served first and the spoken scores stay
    -- with the match (design 3), whatever the new cut read.
    update public.match_processing_versions
       set match_state = match_state || jsonb_build_object(
             'first_server', m.first_server,
             'first_server_source', m.first_server_source,
             'spoken_scores', m.spoken_scores)
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
      'pointCount', v_points,
      'activated', false, 'live', false,
      'scoreRevision', null, 'scoreProjectionStatus', null);
  end if;

  perform public._ledger_uncount_version_media(p_match_id, v_old);

  perform public.refresh_match_score_state(p_match_id);
  select score_revision, score_projection_status
    into v_revision, v_status
    from public.matches where id = p_match_id;
  if v_status not in ('current', 'empty') then
    raise exception 'automatic re-cut score projection is not current'
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
    'pointCount', v_points,
    'activated', true, 'live', true,
    'scoreRevision', v_revision, 'scoreProjectionStatus', v_status);

  insert into public.match_score_mutations(
    request_id, match_id, actor_id, authority_scope, action,
    affected_point_ids, before_state, after_state, base_revision, result_revision
  ) values (
    p_version_id, p_match_id, null, 'worker_publication', 'replace_worker_points',
    v_point_ids,
    jsonb_build_object('processingVersionId', p_version_id,
                       'previousVersionId', v_old),
    v_receipt, greatest(0, v_revision - 1), v_revision)
  on conflict (request_id) do nothing;
  return v_receipt;
end;
$$;

revoke all on function public._activate_auto_recut(uuid, uuid, uuid)
  from public, anon, authenticated;

-- The main lane's publication of a candidate automatic cut, called once its
-- points are inserted (processing_version_id = the candidate): checks them,
-- makes the candidate ready (its cut, thumb, match.json, the settings the
-- run used and the match state it built), finishes the job and tries to
-- make it live. A ready candidate called again (p_cut_path null) only tries
-- to make it live; one already live answers live=true, activated=false.
--
-- Lock order is the activation's: the match, then the version, then the
-- job.
create or replace function public.publish_auto_recut(p_job_id uuid,
                                                     p_cut_path text,
                                                     p_thumb_path text,
                                                     p_match_json_path text,
                                                     p_match_state jsonb,
                                                     p_settings jsonb,
                                                     p_release_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  m          public.matches%rowtype;
  v          public.match_processing_versions%rowtype;
  j          public.jobs%rowtype;
  v_points   integer;
  v_missing  integer;
  v_thumb    text;
begin
  if p_job_id is null then
    raise exception 'automatic re-cut publication identity is missing'
      using errcode = '23514';
  end if;
  v_id := public._auto_recut_version(p_job_id);
  if v_id is null then
    raise exception 'automatic re-cut not found' using errcode = 'P0002';
  end if;
  select * into m from public.matches
   where id = (select match_id from public.match_processing_versions where id = v_id)
     for update;
  select * into v from public.match_processing_versions where id = v_id for update;
  select * into j from public.jobs where id = p_job_id for update;
  if m.id is null or j.id is null
     or j.user_id is distinct from m.user_id
     or j.options->>'match_id' is distinct from m.id::text
     or j.options->>'processing_version_id' is distinct from v.id::text then
    raise exception 'automatic re-cut publication changed' using errcode = '23514';
  end if;

  if v.status = 'active' then
    return jsonb_build_object(
      'ok', true, 'contractVersion', 1,
      'matchId', m.id, 'jobId', p_job_id, 'processingVersionId', v.id,
      'pointCount', (select count(*)::int from public.points p
                      where p.match_id = m.id and p.processing_version_id = v.id
                        and not p.deleted),
      'activated', false, 'live', true,
      'scoreRevision', m.score_revision,
      'scoreProjectionStatus', m.score_projection_status);
  end if;
  if v.status not in ('candidate', 'ready')
     or v.source_version_id is distinct from m.active_processing_version_id then
    raise exception 'automatic re-cut publication changed' using errcode = '23514';
  end if;

  if v.status = 'ready' then
    -- A redelivered queue message claims the job again ('processing');
    -- the activation needs it finished, as it was.
    if j.status not in ('done', 'processing') then
      raise exception 'automatic re-cut publication changed' using errcode = '23514';
    end if;
    if j.status = 'processing' then
      update public.jobs set status = 'done', progress = 100 where id = p_job_id;
    end if;
    return public._activate_auto_recut(m.id, v.id, p_job_id);
  end if;

  if j.status <> 'processing' then
    raise exception 'automatic re-cut publication changed' using errcode = '23514';
  end if;
  if p_cut_path is null or p_match_json_path is null
     or p_match_state is null or jsonb_typeof(p_match_state) <> 'object' then
    raise exception 'automatic re-cut media is missing' using errcode = '23514';
  end if;

  select count(*), count(*) filter (where p.clip_path is null)
    into v_points, v_missing
    from public.points p
   where p.match_id = m.id
     and p.processing_version_id = v.id
     and not p.deleted;
  if v_points = 0 then
    raise exception 'automatic re-cut found no points' using errcode = '23514';
  end if;
  if v_missing > 0 then
    raise exception 'automatic re-cut has missing point clips' using errcode = '23514';
  end if;

  v_thumb := coalesce(p_thumb_path, m.thumb_path);
  update public.match_processing_versions
     set cut_path = p_cut_path,
         thumb_path = v_thumb,
         match_json_path = p_match_json_path,
         cut_source = 'auto',
         settings = settings || coalesce(p_settings, '{}'::jsonb),
         release_id = coalesce(p_release_id, release_id),
         match_state = p_match_state || jsonb_build_object(
           'status', 'ready',
           'job_id', p_job_id,
           'active_processing_version_id', v.id,
           'cut_path', p_cut_path,
           'thumb_path', v_thumb,
           'match_json_path', p_match_json_path,
           'cut_source', 'auto'),
         completed_at = now(),
         status = 'ready'
   where id = v.id;

  update public.jobs
     set status = 'done', progress = 100, result_path = p_cut_path,
         error = null
   where id = p_job_id;

  return public._activate_auto_recut(m.id, v.id, p_job_id);
end;
$$;

revoke all on function public.publish_auto_recut(uuid, text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.publish_auto_recut(uuid, text, text, text, jsonb, jsonb, text)
  to service_role;

-- The worker's retry of a candidate that was ready but could not be made
-- live yet.
create or replace function public.activate_auto_recut(p_job_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.publish_auto_recut(p_job_id, null, null, null, null, null, null);
$$;

revoke all on function public.activate_auto_recut(uuid) from public, anon, authenticated;
grant execute on function public.activate_auto_recut(uuid) to service_role;

-- Give back what an automatic re-cut charged: every personal spend on the
-- job, once (the one-reversal index), as claim_processing's refunds do.
create or replace function public._refund_auto_recut(p_job_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with ins as (
    insert into public.processing_ledger (
      user_id, minutes, kind, funding, billing_mode,
      match_id, job_id, order_id, note, reverses_id
    )
    select spend.user_id, -spend.minutes, 'refund', spend.funding,
      spend.billing_mode, spend.match_id, spend.job_id, spend.order_id,
      'processing failed', spend.id
    from public.processing_ledger spend
    where spend.job_id = p_job_id
      and spend.kind = 'spend'
      and spend.funding = 'personal'
    on conflict (reverses_id) where kind = 'refund' do nothing
    returning 1
  )
  select count(*)::int from ins;
$$;

revoke all on function public._refund_auto_recut(uuid) from public, anon, authenticated;

-- A candidate automatic cut that did not finish: its points deleted, the
-- version failed, its storage uncounted, the job failed (the bell rides
-- jobs_notify_failed), the minutes refunded. The live match, its points and
-- its files are never touched. Only a candidate that was not published is
-- failed here: a published one only waits for the swap. True when this
-- call failed it.
create or replace function public.fail_auto_recut(p_job_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v    public.match_processing_versions%rowtype;
begin
  v_id := public._auto_recut_version(p_job_id);
  if v_id is null then
    return false;
  end if;
  perform 1 from public.matches
   where id = (select match_id from public.match_processing_versions where id = v_id)
     for update;
  select * into v from public.match_processing_versions where id = v_id for update;
  if v.status <> 'candidate' then
    return false;
  end if;
  delete from public.points
   where match_id = v.match_id and processing_version_id = v.id;
  update public.match_processing_versions set status = 'failed' where id = v.id;
  perform public._ledger_uncount_version_media(v.match_id, v.id);
  update public.jobs
     set status = 'failed', progress = 100, user_message = null,
         error = left(coalesce(nullif(btrim(p_error), ''),
                               'The new cut did not finish.'), 500)
   where id = p_job_id;
  perform public._refund_auto_recut(p_job_id);
  return true;
end;
$$;

revoke all on function public.fail_auto_recut(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_auto_recut(uuid, text) to service_role;

-- The main lane's sweep: every ready candidate automatic cut whose job is
-- done is tried again. Returns the ones made live now, so the worker can
-- send the ready email. A candidate whose match moved to another cut while
-- it waited (an admin restore) can never be made live: it is failed, its
-- storage uncounted, its minutes refunded, with the re-cut failure bell.
-- The match row is locked first, as publication locks it, so two lanes
-- sweeping at once make each candidate live exactly once.
create or replace function public.activate_pending_auto_recuts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v         public.match_processing_versions%rowtype;
  m         public.matches%rowtype;
  v_receipt jsonb;
  v_out     jsonb := '[]'::jsonb;
begin
  for r in
    select v2.id, v2.match_id, v2.job_id
      from public.match_processing_versions v2
      join public.jobs j on j.id = v2.job_id
     where v2.status = 'ready'
       and v2.issue_id is null
       and v2.source_version_id is not null
       and j.kind = 'match_reprocess'
       and coalesce(j.options->>'recut', '') = 'replace'
       and j.status = 'done'
     order by v2.completed_at
  loop
    select * into m from public.matches where id = r.match_id
       for update skip locked;
    if not found then
      continue;
    end if;
    select * into v from public.match_processing_versions
     where id = r.id and status = 'ready' for update;
    if not found then
      continue;
    end if;
    if m.active_processing_version_id is distinct from v.source_version_id then
      update public.match_processing_versions set status = 'failed' where id = v.id;
      perform public._ledger_uncount_version_media(v.match_id, v.id);
      perform public._refund_auto_recut(v.job_id);
      insert into public.notifications (user_id, kind, match_id, title, body, href)
      values (m.user_id, 'upload_failed', m.id, 'The new cut didn''t finish.',
              null, '/match/' || m.id::text);
      continue;
    end if;
    begin
      v_receipt := public.publish_auto_recut(v.job_id, null, null, null,
                                             null, null, null);
      if coalesce((v_receipt->>'activated')::boolean, false) then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'job_id', v.job_id, 'user_id', m.user_id, 'match_id', m.id));
      end if;
    exception when others then
      raise warning 'automatic re-cut % could not be made live: %', v.job_id, sqlerrm;
    end;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.activate_pending_auto_recuts() from public, anon, authenticated;
grant execute on function public.activate_pending_auto_recuts() to service_role;

-- ---------------------------------------------------------------------------
-- 7. The bell for an automatic re-cut that did not finish
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25) with one branch first: a player's
-- automatic Replace (a match_reprocess job, which otherwise rings nothing)
-- says only that the new cut did not finish. The match is unchanged and the
-- minutes are back; there are no marks to mention.
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
  if new.kind = 'match_reprocess'
     and coalesce(new.options->>'recut', '') = 'replace'
     and not (new.options ? 'issue_id')
     and new.user_id is not null then
    insert into public.notifications
      (user_id, kind, title, body, href)
    values (
      new.user_id,
      'upload_failed',
      'The new cut didn''t finish.',
      null,
      '/match/' || (new.options->>'match_id')
    );
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
-- 8. The owner's processing feed names the running automatic re-cut
-- ---------------------------------------------------------------------------
-- The live definition (pulled 2026-09-25) with one kind admitted to the
-- job pick: a player's own automatic Replace (match_reprocess with recut
-- 'replace' and no support request). Support reprocessing stays out; it
-- reports through the request page. A running re-cut sorts first, as a
-- running hand-cut Replace already does, so More options, Home and Matches
-- show the ordinary progress while the match stays ready. It reports on
-- the main lane.
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
      and (x.kind in ('deadspace_cut','youtube_import','hand_cut','content_check')
        or (x.kind='match_reprocess' and coalesce(x.options->>'recut','')='replace'
            and not (x.options ? 'issue_id')))
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

-- ---------------------------------------------------------------------------
-- 9. Retired versions: what the sweep removes and the measurement skips
-- ---------------------------------------------------------------------------
-- A retired version is a cut no player can reach again:
--   * one the player's own re-cut replaced (superseded, and a player's
--     re-cut made from it went live: no support request, activated), or
--   * a player's re-cut that failed (hand or automatic).
-- A cut superseded by support reprocessing is NOT retired: support may
-- restore it, and its storage was never uncounted.
--
-- Files: the cut video (or, for a re-cut that never finished, the key the
-- worker gives a candidate's cut), everything under
-- points/<owner>/<match>/versions/<version>/, and, for a match's first cut
-- (no source version), the files directly under points/<owner>/<match>/.
-- Callers check every key against media_keys_in_use before removing or
-- uncounting it. retired_at is when it stopped being playable (or was
-- made); p_min_age selects the ones due.
create or replace function public.retired_processing_versions(p_min_age interval default interval '0')
returns table (version_id uuid, match_id uuid, user_id uuid, status text,
               cut_path text, first_cut boolean, retired_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.match_id, m.user_id, v.status,
         coalesce(v.cut_path,
                  case when v.source_version_id is not null then
                    'r2://ponglens-media/results/' || m.user_id::text || '/'
                      || v.match_id::text || '/versions/' || v.id::text || '.mp4'
                  end),
         v.source_version_id is null,
         coalesce(v.superseded_at, v.completed_at, v.created_at)
    from public.match_processing_versions v
    join public.matches m on m.id = v.match_id
   where v.media_swept_at is null
     and ((v.status = 'superseded'
           and exists (select 1 from public.match_processing_versions w
                        where w.match_id = v.match_id
                          and w.source_version_id = v.id
                          and w.issue_id is null
                          and w.activated_at is not null))
          or (v.status = 'failed'
              and v.issue_id is null
              and v.source_version_id is not null))
     and coalesce(v.superseded_at, v.completed_at, v.created_at)
         <= now() - coalesce(p_min_age, interval '0')
   order by 7;
$$;

revoke all on function public.retired_processing_versions(interval)
  from public, anon, authenticated;
grant execute on function public.retired_processing_versions(interval) to service_role;

-- The keys (r2:// URIs) among p_keys that something other than the
-- versions in p_retiring still uses: any match's cut, thumb, match.json or
-- original; any other version's cut, thumb or match.json; any other
-- version's point clip (a phone's reclip of a live point lands directly
-- under the match's folder); any reel or selection that is rendered or
-- rendering from a clip; another version's archived reel; the result of a
-- live match's job.
create or replace function public.media_keys_in_use(p_keys text[], p_retiring uuid[])
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with k as (select distinct unnest(p_keys) as key),
  used as (
    select unnest(array[m.cut_path, m.thumb_path, m.match_json_path, m.raw_path]) as key
      from public.matches m
     where m.cut_path = any(p_keys) or m.thumb_path = any(p_keys)
        or m.match_json_path = any(p_keys) or m.raw_path = any(p_keys)
    union all
    select unnest(array[v.cut_path, v.thumb_path, v.match_json_path, v.raw_path])
      from public.match_processing_versions v
     where not (v.id = any(coalesce(p_retiring, '{}'::uuid[])))
       and (v.cut_path = any(p_keys) or v.thumb_path = any(p_keys)
            or v.match_json_path = any(p_keys) or v.raw_path = any(p_keys))
    union all
    select p.clip_path from public.points p
     where p.clip_path = any(p_keys)
       and coalesce(not (p.processing_version_id = any(coalesce(p_retiring, '{}'::uuid[]))), true)
    union all
    select j.result_path from public.jobs j
      join public.matches m on m.job_id = j.id
     where j.result_path = any(p_keys)
    union all
    select r.r2_key from public.match_reels r where r.r2_key = any(p_keys)
    union all
    select r.r2_key from public.tag_reels r where r.r2_key = any(p_keys)
    union all
    select r.r2_key from public.selection_reels r where r.r2_key = any(p_keys)
    union all
    select r.record->>'r2_key' from public.match_processing_version_reels r
     where r.record->>'r2_key' = any(p_keys)
       and not (r.version_id = any(coalesce(p_retiring, '{}'::uuid[])))
  )
  select k.key from k
   where k.key in (select used.key from used where used.key is not null)
      or exists (select 1 from public.match_reels r
                  where (r.r2_key is not null or r.status in ('queued', 'processing'))
                    and r.manifest @> jsonb_build_object('points', jsonb_build_array(
                          jsonb_build_object('clip_path', k.key))))
      or exists (select 1 from public.tag_reels r
                  where r.manifest @> jsonb_build_object('points', jsonb_build_array(
                          jsonb_build_object('clip_path', k.key))))
      or exists (select 1 from public.selection_reels r
                  where r.manifest @> jsonb_build_object('points', jsonb_build_array(
                          jsonb_build_object('clip_path', k.key))))
      or exists (select 1 from public.match_processing_version_reels r
                  where not (r.version_id = any(coalesce(p_retiring, '{}'::uuid[])))
                    and r.record->'manifest' @> jsonb_build_object('points', jsonb_build_array(
                          jsonb_build_object('clip_path', k.key))));
$$;

revoke all on function public.media_keys_in_use(text[], uuid[])
  from public, anon, authenticated;
grant execute on function public.media_keys_in_use(text[], uuid[]) to service_role;

-- The sweep takes one retired version: re-checks, under the row lock, that
-- it is still retired and due, and stamps media_swept_at BEFORE any file
-- goes, so from that moment it can never be restored. Returns the version's
-- archived reel keys (its per-version share videos) with it; null when it
-- is not the sweep's to take.
create or replace function public.claim_retired_version_sweep(p_version_id uuid,
                                                              p_min_age interval)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform 1 from public.match_processing_versions
   where id = p_version_id for update;
  select * into r
    from public.retired_processing_versions(p_min_age) x
   where x.version_id = p_version_id;
  if not found then
    return null;
  end if;
  update public.match_processing_versions
     set media_swept_at = now()
   where id = p_version_id;
  return jsonb_build_object(
    'version_id', r.version_id, 'match_id', r.match_id,
    'user_id', r.user_id, 'cut_path', r.cut_path,
    'first_cut', r.first_cut,
    'reel_keys', coalesce((
      select jsonb_agg(distinct x.record->>'r2_key')
        from public.match_processing_version_reels x
       where x.version_id = p_version_id
         and x.record->>'r2_key' is not null), '[]'::jsonb));
end;
$$;

revoke all on function public.claim_retired_version_sweep(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.claim_retired_version_sweep(uuid, interval) to service_role;

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
      ('recut_options(uuid)', '_recut_auto_replace_on()'),
      ('claim_auto_recut(uuid,boolean,numeric,numeric,text)', '_recut_auto_replace_on()'),
      ('claim_auto_recut(uuid,boolean,numeric,numeric,text)', '_recut_busy'),
      ('claim_auto_recut(uuid,boolean,numeric,numeric,text)', '_recut_support_request_open'),
      ('claim_auto_recut(uuid,boolean,numeric,numeric,text)', '_recut_has_coach_review'),
      ('claim_auto_recut(uuid,boolean,numeric,numeric,text)', '_processing_balance'),
      ('guard_match_reprocess_job_rollout()', 'match reprocessing is not enabled'),
      ('guard_match_reprocess_job_rollout()', 'not (new.options ? ''issue_id'')'),
      ('_ledger_uncount_version_media(uuid,uuid)', '/versions/'''),
      ('activate_match_processing_version(uuid,uuid)', 'version files were removed'),
      ('activate_match_processing_version(uuid,uuid)', 'match has unfinished derived work'),
      ('activate_match_processing_version(uuid,uuid)', 'cut_source=v.cut_source'),
      ('_activate_auto_recut(uuid,uuid,uuid)', '_ledger_uncount_version_media'),
      ('_activate_auto_recut(uuid,uuid,uuid)', 'refresh_match_score_state'),
      ('fail_auto_recut(uuid,text)', '_refund_auto_recut'),
      ('jobs_notify_failed()', 'Your marks are saved.'),
      ('jobs_notify_failed()', 'new.kind = ''match_reprocess'''),
      ('_my_match_processing_feedback_before_estimates(uuid[])', 'match_reprocess')
    ) expected(signature, marker)
  loop
    if to_regprocedure('public.' || r.signature) is null then
      raise exception 'cut again (automatic) postcondition failed: missing %', r.signature;
    end if;
    definition := pg_get_functiondef(to_regprocedure('public.' || r.signature));
    if position(r.marker in definition) = 0 then
      raise exception 'cut again (automatic) postcondition failed: % lacks %',
        r.signature, r.marker;
    end if;
  end loop;
end $$;
