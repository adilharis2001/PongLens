-- A phone cut that stops reporting is finished on the server, silently.
--
-- Owner decision, 2026-09-25: a player is never told where a cut runs, and
-- a cut the phone cannot finish goes to the server without a word.
--
-- 20260925061009 released a phone job after 72 hours with no report: the
-- job failed with "The cut on your iPhone didn't finish. Your marks are
-- saved.", which rang the "Cut failed" bell, and the marks were handed
-- back for the player to send again. Now, 15 minutes after the phone's
-- last report (after its claim, if it never reported), the same job
-- becomes an ordinary server hand cut of the same frozen marks: exactly
-- what release_device_hand_cut(p_job, true) does, through the one
-- function both now call. No bell, no email, nothing handed back; the
-- player's pages go from "Cutting the video" to "Waiting to prepare
-- clips" and on through the hand cut's own stages.
--
-- Why 15 minutes never takes a working phone's job: the app reports on
-- every stage change and at least every 60 seconds while it works
-- (DeviceCutReportClock; contract section 3.2), and report_device_hand_cut
-- stamps options.device_reported_at on every accepted report. A phone
-- that says nothing for 15 minutes cannot be working: it is backgrounded
-- without a continued-processing task, held for Low Power Mode or a full
-- disk, out of signal, or gone. If it comes back, report_device_hand_cut
-- answers accepted=false (phase 'mac') and it stops, and the route refuses
-- anything more from it, because the job is no longer in phase 'device'.
--
-- The hand lane runs the sweep every ten minutes
-- (worker.DEVICE_STALE_SWEEP_EVERY_S), so the move lands 15 to 25 minutes
-- after the last report. Its call, public.release_stale_device_hand_cuts(),
-- keeps its name and grant so the sealed hand lane needs no new release.
--
-- The claims no longer release a quiet phone first. 20260925061009 did it
-- so that a player coming back after 72 hours was not refused with
-- already_processing: releasing handed the marks back and the claim went
-- on. Moving the job to the server hands nothing back, so the claim would
-- still refuse (something IS running on the match), and the refusal rolls
-- the move back with it. A claim over a phone job, quiet or not, is
-- refused with already_processing; the sweep moves a quiet one on.
-- _hand_cut_claim_checks is the live definition (pulled 2026-09-25) minus
-- that step, and the per-match release function goes with it.
--
-- Every replaced function was pulled from production with
-- pg_get_functiondef on 2026-09-25. Not applied.

-- ---------------------------------------------------------------------------
-- 1. The move to the server, stated once
-- ---------------------------------------------------------------------------
-- release_device_hand_cut's own to_mac branch, verbatim, with the note
-- passed in: an ordinary hand cut of the same frozen marks, queued on the
-- hand lane now. The draft stays frozen and the match stays linked.
create or replace function public._device_hand_cut_to_server(p_job uuid,
                                                             p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  update public.jobs
     set status = 'queued',
         progress = 0,
         options = options || jsonb_build_object(
           'cutter', 'mac', 'phase', 'mac',
           'device_note', p_note,
           'device_fallback_at', now())
   where id = p_job
  returning * into v_job;
  perform public._send_job_message(v_job, 0);
end;
$$;

revoke all on function public._device_hand_cut_to_server(uuid, text)
  from public, anon, authenticated;

-- The live release_device_hand_cut with its to_mac branch calling the
-- function above. Everything else is verbatim.
create or replace function public.release_device_hand_cut(p_job uuid, p_to_mac boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    perform public._device_hand_cut_to_server(
      p_job, 'switched to the Mac by the owner');
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. The sweep
-- ---------------------------------------------------------------------------
-- Every phone job whose last report (or, never having reported, whose
-- claim) is more than 15 minutes old goes to the server. A report time
-- that does not parse reads as never reported, as before. skip locked: a
-- phone reporting at this instant holds its row and is left alone.
create or replace function public._hand_over_stale_device_hand_cuts()
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
       and coalesce(public._try_timestamptz(j.options->>'device_reported_at'),
                    j.created_at) < now() - interval '15 minutes'
     for update of j skip locked
  loop
    perform public._device_hand_cut_to_server(
      r.id, 'switched to the Mac: no report from the iPhone for 15 minutes');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public._hand_over_stale_device_hand_cuts()
  from public, anon, authenticated;

-- The hand lane's call, unchanged in name, signature and grant.
create or replace function public.release_stale_device_hand_cuts()
returns integer
language sql
security definer
set search_path = public
as $$
  select public._hand_over_stale_device_hand_cuts();
$$;

revoke all on function public.release_stale_device_hand_cuts()
  from public, anon, authenticated;
grant execute on function public.release_stale_device_hand_cuts() to service_role;

-- ---------------------------------------------------------------------------
-- 3. The claims' shared checks, without the release step
-- ---------------------------------------------------------------------------
-- Live definition (pulled 2026-09-25) minus the call to
-- _release_stale_device_hand_cuts(p_match_id) and the re-read after it.
-- A phone job on this match is caught by already_processing below, like
-- any other running job.
create or replace function public._hand_cut_claim_checks(p_match_id uuid, p_marks jsonb)
 returns matches
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    then
      raise exception 'invalid_marks' using errcode = '23514';
    end if;
    v_prev_t1 := v_t1;
  end loop;

  return v_match;
end;
$function$;

-- Nothing calls it any more: the claims above no longer do, and the sweep
-- is _hand_over_stale_device_hand_cuts.
drop function if exists public._release_stale_device_hand_cuts(uuid);
