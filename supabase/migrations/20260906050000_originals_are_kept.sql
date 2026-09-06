-- Originals are kept. Close the 30-day clock for good.
--
-- Since commerce (096, flipped on in 2026-08) the raw upload and the cut
-- video of every live match are the player's stored video: the worker's
-- sweep skips anything a match row references, and the Privacy Policy and
-- Terms both promise "kept while your account is active and the video is in
-- your library". One product rule still ran on the old clock: the
-- placement retry deadline (049, 055) was stamped as source job + 30 days
-- for EVERY match, so on a match whose original is kept the retry button
-- would turn into "the original video is no longer available" a month
-- after processing, which is false. Nineteen protected matches carried such
-- a deadline on 2026-09-06; none had crossed it yet.
--
-- The rule now: a match with raw_path set never expires its placement
-- retry or generation. The deadline column only means something for a
-- legacy row (raw_path null) whose raw was on the old clock. The worker
-- (expire_placement_retries, the placement record read, the lifecycle
-- stamp) and the web availability helper apply the same rule.
--
-- Data: clear the meaningless deadlines on protected rows so the web
-- expiry timer stops counting toward nothing. No row is moved out of
-- final_failed here: no protected match was ever wrongly expired (checked
-- 2026-09-06), and a legacy row that was expired had really lost its raw.

update public.matches
set placement_retry_expires_at = null
where raw_path is not null
  and placement_retry_count = 0
  and placement_status in ('not_requested', 'retry_available');

create or replace function public.request_placement_retry(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.user_id <> auth.uid() then
    raise exception 'not owner' using errcode = '42501';
  end if;
  if v_match.placement_status = 'retrying' then
    raise exception 'placement retry already queued' using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'retry_available' then
    raise exception 'placement retry unavailable' using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement retry already used' using errcode = '23514';
  end if;
  -- A kept original (raw_path set) never expires. The deadline is only a
  -- legacy row's memory of the old 30-day clock.
  if v_match.raw_path is null
     and (v_match.placement_retry_expires_at is null
          or v_match.placement_retry_expires_at <= now()) then
    update public.matches
    set placement_status = 'final_failed',
        placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  -- The existing jobs_enqueue trigger sends this row to pgmq in the same
  -- transaction. If either write fails, neither the job nor lifecycle change
  -- is committed.
  insert into public.jobs (user_id, kind, status, input_path,
                           original_name, options)
  values (auth.uid(), 'placement_retry', 'queued', null,
          'Placement retry',
          jsonb_build_object('match_id', p_match_id))
  returning id into v_job_id;

  update public.matches
  set placement_status = 'retrying',
      placement_retry_count = 1,
      placement_retry_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_retry(uuid) from public, anon;
grant execute on function public.request_placement_retry(uuid)
  to authenticated;

create or replace function public.request_placement_generation(
  p_match_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if v_match.user_id <> auth.uid() then
    raise exception 'not owner' using errcode = '42501';
  end if;
  if v_match.status <> 'ready' then
    raise exception 'match is not ready' using errcode = 'P0001';
  end if;
  if v_match.placement_status = 'processing'
     or v_match.placement_generation_job_id is not null then
    raise exception 'placement generation already queued'
      using errcode = 'P0001';
  end if;
  if v_match.placement_status <> 'not_requested' then
    raise exception 'placement generation unavailable'
      using errcode = 'P0001';
  end if;
  if v_match.placement_retry_count <> 0 then
    raise exception 'placement generation already used'
      using errcode = '23514';
  end if;
  -- Same rule as request_placement_retry: a kept original never expires.
  if v_match.raw_path is null
     and (v_match.placement_retry_expires_at is null
          or v_match.placement_retry_expires_at <= now()) then
    update public.matches
    set placement_failure_code = 'source_expired'
    where id = p_match_id;
    return null;
  end if;

  insert into public.jobs (
    user_id, kind, status, input_path, original_name, options
  )
  values (auth.uid(), 'placement_generate', 'queued', null,
    'Placement generation', jsonb_build_object('match_id', p_match_id)
  )
  returning id into v_job_id;

  update public.matches
  set placement_status = 'processing',
      placement_generation_job_id = v_job_id,
      placement_failure_code = null
  where id = p_match_id;

  return v_job_id;
end;
$$;

revoke all on function public.request_placement_generation(uuid)
  from public, anon;
grant execute on function public.request_placement_generation(uuid)
  to authenticated;
