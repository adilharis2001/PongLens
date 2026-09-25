-- Cutting a hand-marked match on the iPhone.
--
-- Design: docs/superpowers/specs/2026-09-24-ios-hand-cut-design.md, section 7.
-- Contract (every call, key and error below, and the manifest):
--   docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md
--
-- When the phone holds the video it cuts the match itself, uploads the cut,
-- the clips and a manifest, and the Mac's hand lane only checks and
-- publishes. This migration is the database half:
--
--  1. app_config.device_hand_cut 'off' | 'admins' | 'on', seeded 'admins',
--     on the public read list; device_hand_cut_enabled(uuid).
--  2. _hand_cut_claim_checks: every check claim_hand_cut makes, factored out
--     so the phone's claim cannot drift from the Mac's. claim_hand_cut is
--     the live definition (pulled 2026-09-25) calling it, otherwise verbatim.
--  3. claim_device_hand_cut / report_device_hand_cut /
--     submit_device_hand_cut / release_device_hand_cut.
--  4. A phone cut is NOT queued: enqueue_job skips a hand cut whose
--     options.phase is 'device'. job_queue_name is unchanged (a hand cut
--     still belongs to 'jobs_hand', which is also why cloud_worker_decision
--     never counts one); submit and a switch to the Mac send the message
--     themselves through _send_job_message, the one statement of the
--     payload, which enqueue_job now also uses.
--  5. release_stale_device_hand_cuts(): a phone job with no report for 72
--     hours is failed with "The cut on your iPhone didn't finish. Your marks
--     are saved." (the existing "Cut failed" bell, jobs_notify_failed) and
--     its marks handed back exactly as a terminal hand-cut failure hands
--     them back. The hand lane calls it every ten minutes, and both claims
--     call it for the match being claimed. No main or fast release needed.
--  6. /admin/processing: admin_processing_overview gains `devices` (phone
--     jobs, with the phone's stage) and drops them from `running`, and
--     admin_processing_counts stops counting them, so a phone's progress
--     can never read as a Mac worker being alive, and a quiet phone can
--     never read as a Mac worker being stuck.
--  7. my_match_processing_feedback carries the cutter, phase and the
--     phone's stage, so the player's pages can say "Cutting on your iPhone".
--
-- Safe before the hand lane's new release: a submitted phone job reaches
-- the old hand worker as an ordinary hand cut (it ignores cutter/phase) and
-- is cut on the Mac, writing the same keys the phone wrote. Main and fast
-- never see any of it.
--
-- Every replaced function was pulled from production with pg_get_functiondef
-- on 2026-09-25 and edited from that, not from older migration files.
-- CREATE OR REPLACE keeps each replaced function's ACL. Every NEW function
-- is revoked from anon/authenticated explicitly, because Supabase's default
-- privileges grant them EXECUTE otherwise.

-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value)
values ('device_hand_cut', 'admins')
on conflict (key) do nothing;

-- The live list (pg_policies, 2026-09-25, identical to
-- 20260925025508_recordings_to_photos.sql) plus the new key.
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
      'device_hand_cut'
    ])
  );

-- 'admins' is the admin accounts; 'on' is every account that can hand cut
-- at all. While hand_cut is 'off' those are the same two accounts, which
-- is what the seed means; the values part company when hand cutting opens
-- to players and the phone cut should not follow straight away.
create or replace function public.device_hand_cut_enabled(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case c.value
             when 'on' then public.hand_cut_enabled(p_user)
             when 'admins' then public.is_admin()
             else false
           end
      from public.app_config c
     where c.key = 'device_hand_cut'), false);
$$;

revoke all on function public.device_hand_cut_enabled(uuid) from public, anon;
grant execute on function public.device_hand_cut_enabled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Small private helpers
-- ---------------------------------------------------------------------------
-- options is client-writable JSON (the owner holds an UPDATE grant on it),
-- so nothing that reads a timestamp out of it may be able to fail on one.
create or replace function public._try_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

revoke all on function public._try_timestamptz(text) from public, anon, authenticated;

-- The one statement of a job's queue message. enqueue_job sends every new
-- job through it; submit and the switch to the Mac send a phone job
-- through it, to the same queue job_queue_name names.
create or replace function public._send_job_message(p_job public.jobs,
                                                    p_delay integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pgmq'
as $$
begin
  perform pgmq.send(
    public.job_queue_name(p_job.kind, p_job.options),
    jsonb_build_object(
      'job_id', p_job.id,
      'user_id', p_job.user_id,
      'kind', p_job.kind,
      'input_path', p_job.input_path,
      'options', p_job.options
    ),
    p_delay
  );
end;
$$;

revoke all on function public._send_job_message(public.jobs, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. enqueue_job: a phone cut waits for the phone
-- ---------------------------------------------------------------------------
-- Live definition (20260925025504) with one early return, and the send
-- moved into _send_job_message with the delays unchanged.
create or replace function public.enqueue_job()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pgmq'
as $function$
begin
  -- A hand cut the owner's iPhone is cutting has nothing for a worker to
  -- do until the phone submits it (submit_device_hand_cut) or it is
  -- switched to the Mac (release_device_hand_cut); both send it then.
  if new.kind = 'hand_cut' and coalesce(new.options->>'phase', '') = 'device' then
    return new;
  end if;
  perform public._send_job_message(
    new,
    case when new.kind in ('deadspace_cut', 'youtube_import') then 60
         when new.kind = 'reclip' then 5
         else 0 end
  );
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Handing marks back
-- ---------------------------------------------------------------------------
-- Exactly what worker._hand_cut_rollback(release=True) does for a terminal
-- hand-cut failure, and only if the match still points at this job: the
-- match back to 'uploaded' with no cut and no points, cut_source 'auto' so
-- nothing protects points that no longer exist, no job link, and the draft
-- unfrozen so the owner can edit and send it again. The match is found by
-- its own job link, never by the client-writable options.
create or replace function public._hand_cut_hand_back(p_job uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public._hand_cut_hand_back(uuid) from public, anon, authenticated;

-- A phone job whose last report (or, never having reported, whose claim)
-- is more than 72 hours old. p_match_id narrows it to one match, for the
-- claims; null sweeps them all, for the hand lane.
create or replace function public._release_stale_device_hand_cuts(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select j.id
      from public.jobs j
     where j.kind = 'hand_cut'
       and j.status = 'processing'
       and j.options->>'phase' = 'device'
       and (p_match_id is null
            or exists (select 1 from public.matches m
                        where m.id = p_match_id and m.job_id = j.id))
       and coalesce(public._try_timestamptz(j.options->>'device_reported_at'),
                    j.created_at) < now() - interval '72 hours'
     for update of j skip locked
  loop
    -- status 'failed' with this user_message is the "Cut failed" bell,
    -- linking the match (jobs_notify_failed). No email: the worker sends
    -- that only for a failure it met itself.
    update public.jobs
       set status = 'failed',
           user_message = 'The cut on your iPhone didn''t finish. Your marks are saved.',
           error = 'device hand cut: no report from the iPhone for 72 hours',
           options = options || jsonb_build_object(
             'phase', 'released', 'released_reason', 'stale',
             'released_at', now())
     where id = r.id;
    perform public._hand_cut_hand_back(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public._release_stale_device_hand_cuts(uuid)
  from public, anon, authenticated;

create or replace function public.release_stale_device_hand_cuts()
returns integer
language sql
security definer
set search_path = public
as $$
  select public._release_stale_device_hand_cuts(null);
$$;

revoke all on function public.release_stale_device_hand_cuts()
  from public, anon, authenticated;
grant execute on function public.release_stale_device_hand_cuts() to service_role;

-- ---------------------------------------------------------------------------
-- 2. The checks both claims make
-- ---------------------------------------------------------------------------
-- The body of the live claim_hand_cut from its first line to the end of the
-- marks loop, verbatim, plus one step: before anything reads the match's
-- jobs, a phone cut on it that went quiet 72 hours ago is handed back, so a
-- player who comes back is not refused with already_processing. Returns
-- the match row, locked for the rest of the caller's transaction.
create or replace function public._hand_cut_claim_checks(p_match_id uuid,
                                                         p_marks jsonb)
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

  if public._release_stale_device_hand_cuts(p_match_id) > 0 then
    select * into v_match from public.matches where id = p_match_id;
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

-- The live claim_hand_cut (pulled 2026-09-25, identical to
-- 20260908143746_hand_cut.sql) with its checks replaced by the shared
-- function. Everything after the checks is verbatim.
create or replace function public.claim_hand_cut(p_match_id uuid, p_marks jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me       uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_job      uuid := gen_random_uuid();
  v_n        int;
begin
  v_match := public._hand_cut_claim_checks(p_match_id, p_marks);
  v_n := jsonb_array_length(p_marks);

  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set marks = excluded.marks,
        submitted_at = now(),
        updated_at = now();

  -- The job carries what the worker's publish lock asks of every ordinary
  -- processing job: which processing version it belongs to and which job
  -- originated it (itself). An ordinary job gets these stamped when it is
  -- claimed; a hand cut has no claim step, so they are written here.
  -- matches.status is deliberately NOT moved: a job that dies leaves the
  -- match 'uploaded' and fully recoverable, and the raw page reads the
  -- job, not the status, to say that something is running.
  insert into public.jobs (id, user_id, kind, status, input_path,
                           original_name, options)
  values (v_job, v_me, 'hand_cut', 'queued', v_match.raw_path,
          v_match.original_name,
          jsonb_build_object(
            'match_id', p_match_id,
            'source', 'manual',
            'processing_version_id', v_match.active_processing_version_id,
            'originating_match_job_id', v_job));

  -- clip_pads is stamped here rather than left to a job lookup, because a
  -- hand-cut match has no strictness on a job to fall back to and
  -- match_pre_pad would otherwise guess. job_id links the match to its
  -- job the way an upload is linked to its processing job, which is what
  -- the publish lock checks and what the library's "processing" chip
  -- reads. The worker clears it again if the cut fails for good.
  update public.matches
     set cut_source = 'manual',
         clip_pads = '{"pre": 1.2, "post": 1.3}'::jsonb,
         job_id = v_job
   where id = p_match_id;

  return jsonb_build_object('job_id', v_job, 'points', v_n);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The phone's four calls
-- ---------------------------------------------------------------------------
-- claim_device_hand_cut: claim_hand_cut's checks, draft and match writes,
-- with a job the phone holds (status 'processing', phase 'device', never
-- queued) and the exact object keys the phone may write.
create or replace function public.claim_device_hand_cut(p_match_id uuid,
                                                        p_marks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_match  public.matches%rowtype;
  v_job    uuid := gen_random_uuid();
  v_n      int;
  v_clips  jsonb;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.device_hand_cut_enabled(v_me) then
    raise exception 'not_enabled' using errcode = '42501';
  end if;
  v_match := public._hand_cut_claim_checks(p_match_id, p_marks);
  v_n := jsonb_array_length(p_marks);

  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set marks = excluded.marks,
        submitted_at = now(),
        updated_at = now();

  -- 'processing' because the owner's phone is working on it; enqueue_job
  -- sends nothing for phase 'device'.
  insert into public.jobs (id, user_id, kind, status, progress, input_path,
                           original_name, options)
  values (v_job, v_me, 'hand_cut', 'processing', 0, v_match.raw_path,
          v_match.original_name,
          jsonb_build_object(
            'match_id', p_match_id,
            'source', 'manual',
            'processing_version_id', v_match.active_processing_version_id,
            'originating_match_job_id', v_job,
            'cutter', 'device',
            'phase', 'device',
            'device_points', v_n));

  update public.matches
     set cut_source = 'manual',
         clip_pads = '{"pre": 1.2, "post": 1.3}'::jsonb,
         job_id = v_job
   where id = p_match_id;

  -- The Mac's own clip names: 01.mp4 ... 99.mp4, 100.mp4.
  select jsonb_agg(
           'points/' || v_me::text || '/' || p_match_id::text || '/'
           || case when i < 10 then '0' || i::text else i::text end
           || '.mp4'
           order by i)
    into v_clips
    from generate_series(1, v_n) as i;

  return jsonb_build_object(
    'job_id', v_job,
    'points', v_n,
    'bucket', 'ponglens-media',
    'keys', jsonb_build_object(
      'cut', 'results/' || v_me::text || '/' || v_job::text || '.mp4',
      'manifest', 'results/' || v_me::text || '/' || v_job::text
                  || '.manifest.json',
      'clips', v_clips),
    'clip_pads', jsonb_build_object('pre', 1.2, 'post', 1.3));
end;
$$;

revoke all on function public.claim_device_hand_cut(uuid, jsonb) from public, anon;
grant execute on function public.claim_device_hand_cut(uuid, jsonb) to authenticated;

-- report_device_hand_cut: the phone's stage and progress. A job that is no
-- longer the phone's answers accepted=false, which tells the phone to stop.
create or replace function public.report_device_hand_cut(p_job uuid,
                                                         p_stage text,
                                                         p_progress integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := (select auth.uid());
  v_job public.jobs%rowtype;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in
       ('device_cut', 'device_clips', 'device_upload', 'device_paused') then
    raise exception 'invalid_stage' using errcode = '22023';
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'invalid_progress' using errcode = '22023';
  end if;
  select * into v_job
    from public.jobs
   where id = p_job and user_id = v_me and kind = 'hand_cut'
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'processing'
     or coalesce(v_job.options->>'cutter', '') <> 'device'
     or coalesce(v_job.options->>'phase', '') <> 'device' then
    return jsonb_build_object('accepted', false,
                              'phase', v_job.options->>'phase',
                              'status', v_job.status);
  end if;
  update public.jobs
     set progress = p_progress,
         options = options || jsonb_build_object(
           'device_stage', p_stage, 'device_reported_at', now())
   where id = p_job;
  return jsonb_build_object('accepted', true, 'phase', 'device');
end;
$$;

revoke all on function public.report_device_hand_cut(uuid, text, integer) from public, anon;
grant execute on function public.report_device_hand_cut(uuid, text, integer) to authenticated;

-- submit_device_hand_cut: the phone is done. Called by
-- POST /api/hand-cut/device after it has HEADed every object; p_manifest
-- is that route's receipt. The job goes to the hand lane as phase
-- 'verify'. A repeated submit is answered, not refused.
create or replace function public.submit_device_hand_cut(p_job uuid,
                                                         p_manifest jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := (select auth.uid());
  v_job public.jobs%rowtype;
  v_key text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_job
    from public.jobs
   where id = p_job and user_id = v_me and kind = 'hand_cut'
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if coalesce(v_job.options->>'cutter', '') <> 'device' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if v_job.options->>'phase' = 'verify'
     and v_job.status in ('queued', 'processing') then
    return jsonb_build_object('job_id', p_job, 'phase', 'verify',
                              'already', true);
  end if;
  if v_job.status <> 'processing'
     or coalesce(v_job.options->>'phase', '') <> 'device' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  v_key := 'results/' || v_me::text || '/' || p_job::text || '.manifest.json';
  if p_manifest is null
     or jsonb_typeof(p_manifest) <> 'object'
     or length(p_manifest::text) > 16384
     or p_manifest->>'key' is distinct from v_key then
    raise exception 'invalid_manifest' using errcode = '22023';
  end if;

  update public.jobs
     set status = 'queued',
         options = options || jsonb_build_object(
           'phase', 'verify',
           'device_submitted_at', now(),
           'device_upload', p_manifest)
   where id = p_job
  returning * into v_job;
  perform public._send_job_message(v_job, 0);
  return jsonb_build_object('job_id', p_job, 'phase', 'verify');
end;
$$;

revoke all on function public.submit_device_hand_cut(uuid, jsonb) from public, anon;
grant execute on function public.submit_device_hand_cut(uuid, jsonb) to authenticated;

-- release_device_hand_cut: the phone gives up before submitting.
--   to_mac true   the same job becomes an ordinary Mac hand cut of the
--                 same frozen marks, queued on the hand lane now.
--   to_mac false  the marks are handed back (job 'cancelled': no bell, no
--                 email; the owner chose this).
create or replace function public.release_device_hand_cut(p_job uuid,
                                                          p_to_mac boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := (select auth.uid());
  v_job   public.jobs%rowtype;
  v_phase text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_to_mac is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into v_job
    from public.jobs
   where id = p_job and user_id = v_me and kind = 'hand_cut'
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_phase := coalesce(v_job.options->>'phase', '');

  -- The same release twice answers the same way.
  if p_to_mac and v_phase = 'mac' then
    return jsonb_build_object('job_id', p_job, 'phase', 'mac');
  end if;
  if not p_to_mac and v_phase = 'released' then
    return jsonb_build_object('job_id', p_job, 'phase', 'released');
  end if;
  if v_job.status <> 'processing'
     or coalesce(v_job.options->>'cutter', '') <> 'device'
     or v_phase <> 'device' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  if p_to_mac then
    update public.jobs
       set status = 'queued',
           progress = 0,
           options = options || jsonb_build_object(
             'cutter', 'mac', 'phase', 'mac',
             'device_note', 'switched to the Mac by the owner',
             'device_fallback_at', now())
     where id = p_job
    returning * into v_job;
    perform public._send_job_message(v_job, 0);
    return jsonb_build_object('job_id', p_job, 'phase', 'mac');
  end if;

  update public.jobs
     set status = 'cancelled',
         error = 'device hand cut handed back by the owner',
         options = options || jsonb_build_object(
           'phase', 'released', 'released_reason', 'owner',
           'released_at', now())
   where id = p_job;
  perform public._hand_cut_hand_back(p_job);
  return jsonb_build_object('job_id', p_job, 'phase', 'released');
end;
$$;

revoke all on function public.release_device_hand_cut(uuid, boolean) from public, anon;
grant execute on function public.release_device_hand_cut(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. /admin/processing
-- ---------------------------------------------------------------------------
-- The live admin_processing_overview (20260916141355), verbatim under a new
-- name, so the wrapper below adds one thing on top of it the way the
-- earlier layers do.
create or replace function public.admin_processing_overview_pre_device_hand_cut_20260925()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  overview jsonb;
  cloud jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  overview := public.admin_processing_overview_pre_cloud_twin_20260916();
  select coalesce(overview->'cloud', '{}'::jsonb) || jsonb_build_object(
      'cloud_release_id', c.cloud_release_id,
      'cloud_pipeline_id', c.cloud_pipeline_id,
      'cloud_mac_release_id', c.cloud_mac_release_id,
      'cloud_source_commit', c.cloud_source_commit,
      'cloud_registered_at', c.cloud_registered_at,
      'cloud_session_started_at', c.cloud_session_started_at,
      'cloud_session_ended_at', c.cloud_session_ended_at,
      'cloud_session_note', c.cloud_session_note,
      'cloud_decided_at', c.cloud_decided_at,
      'cloud_decision', c.cloud_decision,
      'mac_stale_s', c.mac_stale_s)
    into cloud
    from public.processing_control c
   where c.singleton;
  return jsonb_set(overview, '{cloud}', coalesce(cloud, overview->'cloud', '{}'::jsonb), true);
end;
$function$;

revoke all on function public.admin_processing_overview_pre_device_hand_cut_20260925()
  from public, anon;
grant execute on function public.admin_processing_overview_pre_device_hand_cut_20260925()
  to authenticated;

-- Phone jobs get their own list with the phone's stage, and leave
-- `running`, which the page reads as Mac work: a moving phone job would
-- otherwise read as the main lane alive, and a quiet one as a Mac job
-- stalled. Recently finished phone jobs are flagged so the page does not
-- take a release by the sweep or by the owner as a worker finishing work.
create or replace function public.admin_processing_overview()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  overview  jsonb;
  v_devices jsonb;
  v_ids     text[];
  v_running jsonb;
  v_recent  jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  overview := public.admin_processing_overview_pre_device_hand_cut_20260925();

  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb),
         coalesce(array_agg(x->>'id'), '{}'::text[])
    into v_devices, v_ids
  from (
    select jsonb_build_object(
      'id', j.id,
      'created_at', j.created_at,
      'updated_at', j.updated_at,
      'progress', j.progress,
      'original_name', j.original_name,
      'match_id', j.options->>'match_id',
      'player', public._display_name(u.*),
      'stage', j.options->>'device_stage',
      'reported_at', public._try_timestamptz(j.options->>'device_reported_at')
    ) as x
    from public.jobs j
    left join auth.users u on u.id = j.user_id
    where j.kind = 'hand_cut'
      and j.status = 'processing'
      and j.options->>'phase' = 'device'
    order by j.created_at
    limit 50
  ) s;

  select coalesce(jsonb_agg(r.value order by r.ordinality), '[]'::jsonb)
    into v_running
    from jsonb_array_elements(coalesce(overview->'running', '[]'::jsonb))
         with ordinality as r(value, ordinality)
   where not ((r.value->>'id') = any (v_ids));

  select coalesce(jsonb_agg(
           case when j.id is not null
                then r.value || jsonb_build_object('on_device', true)
                else r.value end
           order by r.ordinality), '[]'::jsonb)
    into v_recent
    from jsonb_array_elements(coalesce(overview->'recent', '[]'::jsonb))
         with ordinality as r(value, ordinality)
    left join public.jobs j
      on j.id = (r.value->>'id')::uuid
     and j.kind = 'hand_cut'
     and coalesce(j.options->>'phase', '') in ('device', 'released');

  return overview || jsonb_build_object(
    'devices', v_devices,
    'running', v_running,
    'recent', v_recent);
end;
$function$;

-- The hub card's counts, live definition with phone jobs taken out of
-- 'running' and 'moving' for the same reason.
create or replace function public.admin_processing_counts()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object(
    'queued', count(*) filter (where j.status = 'queued'),
    'running', count(*) filter (
      where j.status = 'processing'
        and not (j.kind = 'hand_cut'
                 and coalesce(j.options->>'phase', '') = 'device')),
    'oldest_wait_s', coalesce(
      extract(epoch from now() - min(j.created_at)
              filter (where j.status = 'queued')), 0)::int,
    -- Whether anything on the Mac is beating at all. A silent worker with
    -- an empty queue is still the thing worth putting on the hub.
    'reporting', exists (
      select 1 from public.worker_pulse p
       where p.host = 'mac' and p.beat_at > now() - interval '90 seconds'),
    -- Proof of life that does not need the worker to report anything.
    -- Kept in step with JOB_MOVED_S in processingView.ts. Its own EXISTS
    -- rather than a filter on the outer query, which sees only queued and
    -- processing rows and so could never see a job just finished. A job
    -- the owner's phone writes (or a phone job released) proves nothing
    -- about the Mac.
    'moving', exists (
      select 1 from public.jobs j2
       where j2.status in ('processing', 'done', 'failed')
         and j2.updated_at > now() - interval '180 seconds'
         and not (j2.kind = 'hand_cut'
                  and coalesce(j2.options->>'phase', '') in ('device', 'released'))),
    -- Has a Mac worker ever spoken here at all?
    'ever_reported', exists (
      select 1 from public.worker_pulse p where p.host = 'mac')
  ) into v
  from public.jobs j
  where j.status in ('queued', 'processing');
  return v;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. The player's processing feedback
-- ---------------------------------------------------------------------------
-- Live definition plus the hand cut's cutter and phase, and, while the
-- phone holds the job, its stage and when it last reported (its claim if
-- it never has). The web raw page offers "Cut on the Mac instead" from
-- device_seen_at.
create or replace function public.my_match_processing_feedback(p_match_ids uuid[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(f.value||jsonb_build_object('estimate',
    public._fresh_processing_estimate((f.value->>'job_id')::uuid))
    || coalesce((
      select jsonb_build_object(
        'cutter', j.options->>'cutter',
        'phase', j.options->>'phase',
        'device_stage', case when j.options->>'phase' = 'device'
                             then j.options->>'device_stage' end,
        'device_seen_at', case when j.options->>'phase' = 'device'
                               then coalesce(
                                 public._try_timestamptz(j.options->>'device_reported_at'),
                                 j.created_at) end)
        from public.jobs j
       where j.id = (f.value->>'job_id')::uuid
         and j.kind = 'hand_cut'
         and j.options ? 'cutter'), '{}'::jsonb)),'[]')
  from jsonb_array_elements(public._my_match_processing_feedback_before_estimates(p_match_ids[1:100])) f;
$function$;
