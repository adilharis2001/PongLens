-- Post-rollout audit, database half (owner-approved 2026-09-26).
--
-- The plan and the reasoning per item are in
-- docs/research/2026-09-26-audit/FIX-PLAN.md. Every function replaced here
-- was pulled from production with pg_get_functiondef on 2026-09-26 and
-- changed only where a comment says "Changed:". Behaviour is checked on a
-- throwaway Postgres by supabase/tests/audit_db_fixes.sql (commands in
-- supabase/tests/audit_db_fixes_stubs.sql).
--
--   M1  cloud_worker_decision(boolean) is no longer callable by anon or
--       signed-in accounts. Modal's dispatcher and supervisor connect as
--       postgres over DATABASE_URL; set_cloud_worker_mode calls it as its
--       definer.
--   M2  A hand-cut draft can only be written by the owner of its match, a
--       client cannot insert submitted_at or prefilled, and every claim
--       (and start_recut) takes over the row's user_id when it overwrites.
--   C   Deleting a match cancels its waiting cuts (hand cuts, re-cuts,
--       support re-runs) and a cut its owner's iPhone holds, and refunds
--       an automatic Replace that never went live. A failed job about a
--       match that no longer exists rings no bell. Still never allowed to
--       stop a delete.
--   G   A failure bell carries match_id when its match exists.
--   E   Highlights reels ring no bell; the other exports say what they are.
--   F   A point note leaves the note feeds when its point leaves the live cut.
--   H   A phone cut that went quiet while uploading gets 60 minutes before
--       the Mac takes over; 15 otherwise.
--   J   Publishing a cut moves single-point share links to the new point
--       covering at least half the shared rally; a link that cannot move
--       keeps its clip and cut out of the retired-version sweep.
--   Q   start_recut resumes an unsent draft only when it has marks.
--   L   A coach review cannot be sent while the match is being replaced.
--   S2  /admin/processing rows say which job is a player's own Replace:
--       player_replace on waiting, running, recent and phone rows, and
--       job_player_replace on worker rows.

-- ===================================================================== M1
revoke execute on function public.cloud_worker_decision(boolean)
  from public, anon, authenticated;
grant execute on function public.cloud_worker_decision(boolean) to service_role;

-- ===================================================================== M2
-- Insert and update also require the caller to own the match. The subquery
-- reads matches under the caller's own RLS, where an owner always sees
-- their match.
drop policy if exists "own hand cut drafts insertable" on public.hand_cut_drafts;
create policy "own hand cut drafts insertable" on public.hand_cut_drafts
  for insert
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.matches m
                 where m.id = hand_cut_drafts.match_id
                   and m.user_id = (select auth.uid()))
  );

drop policy if exists "own unsubmitted hand cut drafts updatable" on public.hand_cut_drafts;
create policy "own unsubmitted hand cut drafts updatable" on public.hand_cut_drafts
  for update
  using (
    user_id = (select auth.uid())
    and submitted_at is null
    and exists (select 1 from public.matches m
                 where m.id = hand_cut_drafts.match_id
                   and m.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.matches m
                 where m.id = hand_cut_drafts.match_id
                   and m.user_id = (select auth.uid()))
  );

-- The web (useHandCutDraft.ts) and iOS (HandCutDraftInsert) insert exactly
-- these five columns. submitted_at and prefilled are the database's.
revoke insert on public.hand_cut_drafts from anon, authenticated;
revoke insert (submitted_at, prefilled) on public.hand_cut_drafts from anon, authenticated;
grant insert (match_id, user_id, marks, mode, updated_at)
  on public.hand_cut_drafts to authenticated;

CREATE OR REPLACE FUNCTION public.claim_hand_cut(p_match_id uuid, p_marks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me       uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_job      uuid := gen_random_uuid();
  v_n        int;
begin
  v_match := public._hand_cut_claim_checks(p_match_id, p_marks);
  v_n := jsonb_array_length(p_marks);

  -- Changed: the owner's claim takes the row over, whoever wrote it.
  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set user_id = excluded.user_id,
        marks = excluded.marks,
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
revoke all on function public.claim_hand_cut(uuid, jsonb) from public, anon;
grant execute on function public.claim_hand_cut(uuid, jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_device_hand_cut(p_match_id uuid, p_marks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Changed: the owner's claim takes the row over, whoever wrote it.
  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set user_id = excluded.user_id,
        marks = excluded.marks,
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
$function$;
revoke all on function public.claim_device_hand_cut(uuid, jsonb) from public, anon;
grant execute on function public.claim_device_hand_cut(uuid, jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_hand_recut(p_match_id uuid, p_marks jsonb, p_replace boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Changed: the owner's claim takes the row over, whoever wrote it.
  insert into public.hand_cut_drafts (match_id, user_id, marks, submitted_at)
  values (p_match_id, v_me, p_marks, now())
  on conflict (match_id) do update
    set user_id = excluded.user_id,
        marks = excluded.marks,
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
$function$;
revoke all on function public.claim_hand_recut(uuid, jsonb, boolean) from public, anon;
grant execute on function public.claim_hand_recut(uuid, jsonb, boolean) to authenticated, service_role;

-- ================================================================ M2 + Q
CREATE OR REPLACE FUNCTION public.start_recut(p_match_id uuid, p_fresh boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me     uuid := (select auth.uid());
  v_match  public.matches%rowtype;
  v_reason text;
  v_draft  public.hand_cut_drafts%rowtype;
  v_marks  jsonb;
  v_mode   text;
  v_now    timestamptz := now();
  v_cut_since timestamptz;
  v_have   boolean;
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
  v_have := found;
  -- An untouched prefill is not resumed; it is written again from the
  -- points below, keeping the pass the player chose.
  -- Changed: nor is a draft with no marks in it ("Start again", then
  -- closed), which would reopen the match empty, nor one somebody else
  -- wrote.
  if v_have and v_draft.submitted_at is null and not coalesce(p_fresh, false)
     and not v_draft.prefilled
     and v_draft.user_id = v_me
     and jsonb_typeof(v_draft.marks) = 'array'
     and jsonb_array_length(v_draft.marks) > 0
     and v_draft.updated_at >= coalesce(v_cut_since, '-infinity'::timestamptz) then
    return jsonb_build_object(
      'marks', v_draft.marks,
      'mode', coalesce(v_draft.mode, public._marks_mode(v_draft.marks)),
      'updated_at', v_draft.updated_at);
  end if;

  v_marks := public._recut_marks_from_points(v_match);
  v_mode := public._marks_mode(v_marks);
  -- A refreshed prefill keeps a pass the player switched to.
  if v_have and v_draft.submitted_at is null and v_draft.prefilled
     and not coalesce(p_fresh, false)
     and v_draft.mode in ('cut', 'score') then
    v_mode := v_draft.mode;
  end if;
  -- The write is marked as the prefill.
  -- Changed: and takes the row over, whoever wrote it.
  perform set_config('ponglens.recut_prefill', 'on', true);
  insert into public.hand_cut_drafts
    (match_id, user_id, marks, mode, updated_at, submitted_at, prefilled)
  values (p_match_id, v_me, v_marks, v_mode, v_now, null, true)
  on conflict (match_id) do update
    set user_id = excluded.user_id,
        marks = excluded.marks,
        mode = excluded.mode,
        updated_at = excluded.updated_at,
        submitted_at = null,
        prefilled = true;
  perform set_config('ponglens.recut_prefill', '', true);
  return jsonb_build_object('marks', v_marks, 'mode', v_mode,
                            'updated_at', v_now);
end;
$function$;
revoke all on function public.start_recut(uuid, boolean) from public, anon;
grant execute on function public.start_recut(uuid, boolean) to authenticated, service_role;

-- ====================================================================== C
-- A deleted match takes its waiting work with it (20260925184052), now
-- including the cuts a player is waiting on. The worker skips a cancelled
-- job and archives its message silently. Each job is cancelled in its own
-- block, so one refusal (a support re-run's rollout guard) cannot keep the
-- others alive, and nothing here can stop the delete.
create or replace function public._cancel_followups_of_deleted_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  begin
    update public.jobs
       set status = 'cancelled',
           progress = 100
     where status = 'queued'
       and kind in ('placement_generate', 'placement_retry', 'reel', 'reclip')
       and options->>'match_id' = old.id::text;
  exception when others then
    raise warning 'cancel follow-ups of deleted match % failed: %', old.id, sqlerrm;
  end;

  -- Changed: an automatic Replace the player paid for and never got. Its
  -- candidate version goes with the match, so fail_auto_recut cannot find
  -- it later; the refund is read from the job's own spend row instead.
  -- Idempotent (one refund per spend), so a failure refund already booked
  -- is not repeated. Read before the cancellations below, which move the
  -- waiting ones out of 'queued'.
  begin
    for r in
      select j.id
        from public.jobs j
       where j.options->>'match_id' = old.id::text
         and j.kind = 'match_reprocess'
         and coalesce(j.options->>'recut', '') = 'replace'
         and not (j.options ? 'issue_id')
         and (j.status in ('queued', 'processing')
              or exists (select 1 from public.match_processing_versions v
                          where v.job_id = j.id
                            and v.match_id = old.id
                            and v.status in ('candidate', 'ready')))
    loop
      begin
        perform public._refund_auto_recut(r.id);
      exception when others then
        raise warning 'refund of job % of deleted match % failed: %', r.id, old.id, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'refunds of deleted match % failed: %', old.id, sqlerrm;
  end;
  -- Changed: waiting hand cuts and re-cuts (automatic Replace, support
  -- re-runs), and a hand cut the owner's iPhone holds. A cut already on
  -- the Mac is left to the worker, which fails it when the match is gone.
  begin
    for r in
      select j.id, j.kind, j.status, j.options
        from public.jobs j
       where j.options->>'match_id' = old.id::text
         and j.kind in ('hand_cut', 'match_reprocess')
         and (j.status = 'queued'
              or (j.status = 'processing' and j.kind = 'hand_cut'
                  and j.options->>'phase' = 'device'))
    loop
      begin
        update public.jobs
           set status = 'cancelled',
               progress = 100
         where id = r.id
           and status = r.status;
      exception when others then
        raise warning 'cancel job % of deleted match % failed: %', r.id, old.id, sqlerrm;
      end;
    end loop;
  exception when others then
    raise warning 'cancel cuts of deleted match % failed: %', old.id, sqlerrm;
  end;

  return old;
end;
$$;
revoke all on function public._cancel_followups_of_deleted_match() from public, anon, authenticated;

-- ================================================================= C + G
CREATE OR REPLACE FUNCTION public.jobs_notify_failed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_match_id uuid;
begin
  if new.status is not distinct from old.status or new.status <> 'failed' then
    return new;
  end if;
  -- Changed: a job about a match that no longer exists tells nobody (its
  -- owner deleted it); one about a match that does links the bell to it,
  -- so the phone can open it and the bell goes when the match goes.
  if coalesce(new.options->>'match_id', '')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select m.id into v_match_id
      from public.matches m
     where m.id = (new.options->>'match_id')::uuid;
    if v_match_id is null then
      return new;
    end if;
  end if;
  if new.kind = 'match_reprocess'
     and coalesce(new.options->>'recut', '') = 'replace'
     and not (new.options ? 'issue_id')
     and new.user_id is not null then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (
      new.user_id,
      'upload_failed',
      v_match_id,
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
      (user_id, kind, match_id, title, body, href)
    values (
      new.user_id,
      'upload_failed',
      v_match_id,
      'The new cut didn''t finish.',
      'Your marks are saved.',
      '/match/' || (new.options->>'match_id')
    );
    return new;
  end if;

  insert into public.notifications
    (user_id, kind, match_id, title, body, href)
  values (
    new.user_id,
    'upload_failed',
    v_match_id,
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
-- A trigger function: fired by the table, never called by a client.
revoke all on function public.jobs_notify_failed() from public, anon, authenticated;

-- ====================================================================== E
CREATE OR REPLACE FUNCTION public.match_reels_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_match public.matches%rowtype;
  v_vs    text;
  v_what  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('ready', 'failed') then
    return new;
  end if;

  if new.scope like 'v:%' then
    return new;
  end if;
  -- Changed: highlights are rendered on their own after every cut. Nobody
  -- asked for them, so neither their arrival nor a failure is news.
  if new.scope = 'highlights' then
    return new;
  end if;

  select * into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;
  v_vs := public._vs_suffix(v_match.opponent_name);
  -- Changed: each export says what it is.
  v_what := case when new.scope = 'full' then 'Full match'
                 when new.scope = 'starred' then 'Starred points'
                 when new.scope like 'tag:%' then 'Tagged points'
                 else 'Export' end;

  if new.status = 'ready' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_ready', v_match.id,
            v_what || ' ready',
            'Your export' || v_vs || ' is rendered. Tap to download it.',
            '/match/' || v_match.id::text || '?export=' || new.scope);
  else
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_failed', v_match.id,
            v_what || ' couldn''t be rendered',
            'Something went wrong rendering your export' || v_vs || '.',
            '/match/' || v_match.id::text);
  end if;

  return new;
end;
$function$;
revoke all on function public.match_reels_notify() from public, anon, authenticated;

-- ====================================================================== F
CREATE OR REPLACE FUNCTION public.note_feed(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, match_id uuid, point_id uuid, author_id uuid, body text, audio_path text, image_path text, created_at timestamp with time zone, author_name text, match_owner_id uuid, opponent_name text, venue text, played_at timestamp with time zone, user_side text, player_near_name text, player_far_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    n.id, n.match_id, n.point_id, n.author_id, n.body, n.audio_path,
    n.image_path,
    n.created_at,
    public._display_name(u.*) as author_name,
    m.user_id as match_owner_id,
    m.opponent_name, m.venue, m.played_at,
    m.user_side, m.player_near_name, m.player_far_name
  from public.notes n
  join public.matches m on m.id = n.match_id
  join auth.users u on u.id = n.author_id
  where public.has_match_access(n.match_id)
    and (m.is_sample is not true or m.user_id = auth.uid())
    -- Changed: a note on a point shows while that point is on the live
    -- cut. A replaced cut's notes stay with it, out of the feeds.
    and (n.point_id is null
         or exists (select 1 from public.points p
                     where p.id = n.point_id
                       and p.processing_version_id = m.active_processing_version_id))
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$function$;
revoke all on function public.note_feed(integer) from public, anon;
grant execute on function public.note_feed(integer) to authenticated, service_role;

-- ====================================================================== H
CREATE OR REPLACE FUNCTION public._hand_over_stale_device_hand_cuts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_n integer := 0;
begin
  -- Changed: a phone that last said it was uploading gets an hour. iOS
  -- goes quiet while the screen is locked mid-upload, and handing over at
  -- 15 minutes threw away an upload that was still landing.
  for r in
    select j.id, j.options->>'device_stage' as stage
      from public.jobs j
     where j.kind = 'hand_cut'
       and j.status = 'processing'
       and j.options->>'phase' = 'device'
       and coalesce(public._try_timestamptz(j.options->>'device_reported_at'),
                    j.created_at)
           < now() - case when j.options->>'device_stage' = 'device_upload'
                          then interval '60 minutes'
                          else interval '15 minutes' end
     for update of j skip locked
  loop
    perform public._device_hand_cut_to_server(
      r.id,
      case when r.stage = 'device_upload'
           then 'switched to the Mac: no report from the iPhone for 60 minutes while uploading'
           else 'switched to the Mac: no report from the iPhone for 15 minutes' end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public._hand_over_stale_device_hand_cuts() from public, anon, authenticated;

-- ====================================================================== J
-- Single-point share links follow the rally to the new cut. Times are
-- compared on the original video's clock: an automatic cut of a trimmed
-- window keeps its points relative to the window's start, exactly as
-- _recut_marks_from_points reads them. A link moves to the new point
-- holding the most of its rally, when that is at least half of it and the
-- point has no live link of its own (one live link per point). Anything
-- that cannot move stays where it was and media_keys_in_use keeps its
-- files.
create or replace function public._version_source_offset(p_version_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(public._try_numeric(v.settings->>'trim_start_s'), 0) > 0.5
      or (public._try_numeric(v.settings->>'trim_end_s') is not null
          and m.duration_s is not null
          and public._try_numeric(v.settings->>'trim_end_s') < m.duration_s - 0.5)
    then greatest(coalesce(public._try_numeric(v.settings->>'trim_start_s'), 0), 0)
    else 0 end
    from public.match_processing_versions v
    join public.matches m on m.id = v.match_id
   where v.id = p_version_id;
$$;
revoke all on function public._version_source_offset(uuid) from public, anon, authenticated;

create or replace function public._repoint_point_share_links(
  p_match_id uuid, p_from_version uuid, p_to_version uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_off numeric;
  v_to_off   numeric;
  v_n        integer := 0;
  r          record;
begin
  if p_from_version is null or p_to_version is null
     or p_from_version = p_to_version then
    return 0;
  end if;
  v_from_off := coalesce(public._version_source_offset(p_from_version), 0);
  v_to_off := coalesce(public._version_source_offset(p_to_version), 0);
  for r in
    select s.id as link_id, best.id as point_id
      from public.share_links s
      join public.points p on p.id = s.point_id
      cross join lateral (
        select q.id,
               least(q.t1 + v_to_off, p.t1 + v_from_off)
                 - greatest(q.t0 + v_to_off, p.t0 + v_from_off) as shared
          from public.points q
         where q.match_id = p_match_id
           and q.processing_version_id = p_to_version
           and not q.deleted
           and q.t0 is not null and q.t1 is not null
         order by 2 desc, q.t0, q.idx, q.id
         limit 1
      ) best
     where s.match_id = p_match_id
       and s.kind = 'point'
       and s.revoked_at is null
       and p.processing_version_id = p_from_version
       and p.t0 is not null and p.t1 is not null and p.t1 > p.t0
       and best.shared >= 0.5 * (p.t1 - p.t0)
     order by best.shared desc, s.id
  loop
    if not exists (select 1 from public.share_links x
                    where x.kind = 'point' and x.revoked_at is null
                      and x.point_id = r.point_id) then
      update public.share_links set point_id = r.point_id where id = r.link_id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public._repoint_point_share_links(uuid, uuid, uuid) from public, anon, authenticated;

-- Every publication goes through here: a hand Replace, an automatic
-- Replace, support's publish and support's restore.
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
  -- Changed: single-point share links follow their rally to this cut. A
  -- link that cannot move keeps playing the old clip; it never stops a
  -- publication.
  begin
    perform public._repoint_point_share_links(m.id, m.active_processing_version_id, v.id);
  exception when others then
    raise warning 'share links of match % did not follow the new cut: %', m.id, sqlerrm;
  end;
end $function$;
revoke all on function public.activate_match_processing_version(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.media_keys_in_use(p_keys text[], p_retiring uuid[])
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Changed: a live single-point share link still on a retired cut keeps
    -- the clip it plays and the cut it was taken from, retiring or not.
    select unnest(array[p.clip_path, v.cut_path])
      from public.share_links s
      join public.points p on p.id = s.point_id
      join public.match_processing_versions v on v.id = p.processing_version_id
     where s.kind = 'point'
       and s.revoked_at is null
       and (p.clip_path = any(p_keys) or v.cut_path = any(p_keys))
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
$function$;
revoke all on function public.media_keys_in_use(text[], uuid[]) from public, anon, authenticated;
grant execute on function public.media_keys_in_use(text[], uuid[]) to service_role;

-- ====================================================================== L
CREATE OR REPLACE FUNCTION public.submit_review_order(p_order_id uuid, p_match_id uuid, p_answers jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me    uuid := auth.uid();
  v_o     public.review_orders%rowtype;
  v_match public.matches%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_answers, 'null'::jsonb)) <> 'array' then
    raise exception 'bad_answers' using errcode = '23514';
  end if;

  select * into v_o from public.review_orders
   where id = p_order_id for update;
  if not found or v_o.student_id <> v_me then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_o.status <> 'awaiting_submission' then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found or v_match.user_id <> v_me then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.status = 'failed' then
    raise exception 'match_failed' using errcode = 'P0001';
  end if;
  -- Changed: not while a Replace is cutting this match again, or its new
  -- cut is waiting to go live. The coach would review a cut about to
  -- disappear; claim_hand_recut and claim_auto_recut refuse the other way
  -- round (coach_review).
  if exists (select 1 from public.jobs j
              where j.options->>'match_id' = p_match_id::text
                and j.kind in ('hand_cut', 'match_reprocess')
                and coalesce(j.options->>'recut', '') = 'replace'
                and not (j.options ? 'issue_id')
                and j.status in ('queued', 'processing'))
     or exists (select 1 from public.match_processing_versions v
                 where v.match_id = p_match_id
                   and v.issue_id is null
                   and v.status in ('candidate', 'ready')) then
    raise exception 'recut_in_progress' using errcode = 'P0001';
  end if;

  update public.review_orders
     set match_id = p_match_id,
         intake_answers = p_answers,
         status = case when v_match.status = 'ready'
                       then 'submitted' else status end,
         submitted_at = case when v_match.status = 'ready'
                             then now() else submitted_at end,
         updated_at = now()
   where id = p_order_id;
end;
$function$;
revoke all on function public.submit_review_order(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_review_order(uuid, uuid, jsonb) to authenticated, service_role;

-- ===================================================================== S2
-- True for a player's own Replace, by hand or automatic; false for
-- everything else, support re-runs included (they carry issue_id).
create or replace function public._is_player_replace_job(p_job_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(p_job_id, '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.jobs j
     where j.id = p_job_id::uuid
       and j.kind in ('hand_cut', 'match_reprocess')
       and coalesce(j.options->>'recut', '') = 'replace'
       and not (j.options ? 'issue_id'));
end;
$$;
revoke all on function public._is_player_replace_job(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_processing_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  overview  jsonb;
  v_devices jsonb;
  v_ids     text[];
  v_running jsonb;
  v_recent  jsonb;
  v_waiting jsonb;
  v_workers jsonb;
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
      'reported_at', public._try_timestamptz(j.options->>'device_reported_at'),
      -- Changed: see S2 below.
      'player_replace', public._is_player_replace_job(j.id::text)
    ) as x
    from public.jobs j
    left join auth.users u on u.id = j.user_id
    where j.kind = 'hand_cut'
      and j.status = 'processing'
      and j.options->>'phase' = 'device'
    order by j.created_at
    limit 50
  ) s;

  -- Changed (S2): every job row says whether it is a player's own Replace
  -- (player_replace), and every worker row whether the job it is on is one
  -- (job_player_replace), so the page can tell it from support's re-runs.
  select coalesce(jsonb_agg(
           r.value || jsonb_build_object('player_replace',
             public._is_player_replace_job(r.value->>'id'))
           order by r.ordinality), '[]'::jsonb)
    into v_running
    from jsonb_array_elements(coalesce(overview->'running', '[]'::jsonb))
         with ordinality as r(value, ordinality)
   where not ((r.value->>'id') = any (v_ids));

  select coalesce(jsonb_agg(
           case when j.id is not null
                then r.value || jsonb_build_object('on_device', true)
                else r.value end
           || jsonb_build_object('player_replace',
                public._is_player_replace_job(r.value->>'id'))
           order by r.ordinality), '[]'::jsonb)
    into v_recent
    from jsonb_array_elements(coalesce(overview->'recent', '[]'::jsonb))
         with ordinality as r(value, ordinality)
    left join public.jobs j
      on j.id = (r.value->>'id')::uuid
     and j.kind = 'hand_cut'
     and coalesce(j.options->>'phase', '') in ('device', 'released');

  select coalesce(jsonb_agg(
           r.value || jsonb_build_object('player_replace',
             public._is_player_replace_job(r.value->>'id'))
           order by r.ordinality), '[]'::jsonb)
    into v_waiting
    from jsonb_array_elements(coalesce(overview->'waiting', '[]'::jsonb))
         with ordinality as r(value, ordinality);

  select coalesce(jsonb_agg(
           r.value || jsonb_build_object('job_player_replace',
             public._is_player_replace_job(r.value->>'job_id'))
           order by r.ordinality), '[]'::jsonb)
    into v_workers
    from jsonb_array_elements(coalesce(overview->'workers', '[]'::jsonb))
         with ordinality as r(value, ordinality);

  return overview || jsonb_build_object(
    'devices', v_devices,
    'running', v_running,
    'recent', v_recent,
    'waiting', v_waiting,
    'workers', v_workers);
end;
$function$;
revoke all on function public.admin_processing_overview() from public, anon;
grant execute on function public.admin_processing_overview() to authenticated, service_role;
