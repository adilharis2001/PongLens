-- 097: the content gate moves to upload time.
--
-- With uploading and processing separated (096), the sampled-frames
-- table-tennis check only ran when processing started — so a video never
-- processed was never checked, and could sit in paid storage forever.
-- Now every registered upload enqueues a lightweight 'content_check' job:
-- the worker samples the same 12 frames, asks the same model, and a
-- confident non-table-tennis verdict deletes the raw and the library row
-- and tells the uploader, exactly like the old flow did at processing
-- time. A pass stamps matches.content_checked_at, and the processing-time
-- gate skips already-cleared videos. The check fails open — an API
-- hiccup never blocks a legitimate upload, and the processing gate
-- remains the backstop.
--
-- Check jobs are housekeeping: they never count against the user's job
-- queue, never appear as upload cards, and spend no minutes.

alter table public.matches
  add column content_checked_at timestamptz;

-- ---------------------------------------------------------------------------
-- register_upload — as in 096, plus the check job. The jobs trigger
-- enqueues it on pgmq like any other kind.
-- ---------------------------------------------------------------------------
create or replace function public.register_upload(
  p_key           text,
  p_bytes         bigint,
  p_duration_s    double precision default null,
  p_original_name text default null,
  p_opponent      text default null,
  p_venue         text default null,
  p_match_type    text default null,
  p_user_side     text default null,
  p_order_id      uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 8589934592 then
    raise exception 'invalid byte count' using errcode = '23514';
  end if;
  if p_key not like 'r2://ponglens-raw/' || v_me || '/%' then
    raise exception 'invalid key' using errcode = '23514';
  end if;
  if p_order_id is not null and not exists (
    select 1 from public.review_orders o
    where o.id = p_order_id and o.student_id = v_me
      and o.status in ('awaiting_submission', 'submitted',
                       'in_review', 'clarification')
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.matches
    (user_id, status, raw_path, duration_s, original_name,
     opponent_name, venue, match_type, user_side)
  values
    (v_me, 'uploaded', p_key,
     case when p_duration_s > 0 then p_duration_s end,
     nullif(trim(coalesce(p_original_name, '')), ''),
     nullif(trim(coalesce(p_opponent, '')), ''),
     nullif(trim(coalesce(p_venue, '')), ''),
     case when p_match_type in ('drills', 'practice', 'match',
                                'league', 'tournament')
          then p_match_type end,
     case when p_user_side in ('near', 'far') then p_user_side end)
  returning id into v_id;

  insert into public.storage_ledger
    (user_id, match_id, kind, bytes, r2_key, order_id)
  values (v_me, v_id, 'other', p_bytes, p_key, p_order_id);

  -- The content gate, moved to the moment of storage (097).
  insert into public.jobs
    (user_id, kind, status, input_path, original_name, options)
  values
    (v_me, 'content_check', 'queued', p_key,
     nullif(trim(coalesce(p_original_name, '')), ''),
     jsonb_build_object('match_id', v_id));

  return v_id;
end;
$$;

revoke all on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.register_upload(
  text, bigint, double precision, text, text, text, text, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- my_storage_state — as in 096, with content checks kept out of the
-- queue count so a pending check never blocks a claim or an upload.
-- ---------------------------------------------------------------------------
drop function if exists public.my_storage_state();

create function public.my_storage_state()
returns table (
  storage_limit_bytes bigint,
  daily_upload_limit  int,
  used_bytes          bigint,
  uploads_today       int,
  active_jobs         int,
  pending_request     boolean,
  base_limit_bytes    bigint,
  entitlement_bytes   bigint,
  entitlement_expires_at timestamptz,
  held_bytes          bigint
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  perform public._ensure_quota(v_me);
  return query
  with ent as (
    select coalesce(sum(e.bytes), 0)::bigint as bytes,
           min(e.expires_at) as next_expiry
    from public.storage_entitlements e
    where e.user_id = v_me and e.expires_at > now()
  ),
  led as (
    select coalesce(sum(l.bytes), 0)::bigint as counted
    from public.storage_ledger l
    where l.user_id = v_me
      and (l.r2_key like 'r2://ponglens-raw/%' or l.kind = 'cut')
  ),
  held_rows as (
    select coalesce(sum(l.bytes), 0)::bigint as held
    from public.storage_ledger l
    join public.review_orders o on o.id = l.order_id
    where l.user_id = v_me
      and (l.r2_key like 'r2://ponglens-raw/%' or l.kind = 'cut')
      and o.status in ('awaiting_submission', 'submitted',
                       'in_review', 'clarification', 'delivered')
  )
  select
    q.storage_limit_bytes + ent.bytes,
    q.daily_upload_limit,
    greatest(led.counted - held_rows.held, 0),
    ((select count(*) from public.matches m
      where m.user_id = v_me and m.raw_path is not null
        and m.created_at >= date_trunc('day', now()))
     + (select count(*) from public.jobs j
        where j.user_id = v_me
          and ((j.kind = 'deadspace_cut' and j.options ->> 'match_id' is null)
               or j.kind = 'youtube_import')
          and j.created_at >= date_trunc('day', now())))::int,
    (select count(*) from public.jobs j
     where j.user_id = v_me
       and j.status in ('queued', 'processing')
       and j.kind not in ('reclip', 'content_check'))::int,
    exists (select 1 from public.quota_requests r
            where r.user_id = v_me and r.status = 'pending'),
    q.storage_limit_bytes,
    ent.bytes,
    ent.next_expiry,
    held_rows.held
  from public.user_quotas q, ent, led, held_rows
  where q.user_id = v_me;
end;
$$;

revoke execute on function public.my_storage_state() from public, anon;
grant execute on function public.my_storage_state() to authenticated;

-- ---------------------------------------------------------------------------
-- claim_processing — as last patched (already_processing guard, points
-- always on), with the same queue-count exclusion.
-- ---------------------------------------------------------------------------
create or replace function public.claim_processing(
  p_match_id     uuid,
  p_trim_start_s double precision default null,
  p_trim_end_s   double precision default null,
  p_points       boolean default true,
  p_placement    boolean default false,
  p_strictness   text default 'normal',
  p_order_id     uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_mode    text;
  v_match   public.matches%rowtype;
  v_order   public.review_orders%rowtype;
  v_start   double precision;
  v_end     double precision;
  v_charge  integer;
  v_funding text := 'personal';
  v_active  integer;
  v_job     uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public._commerce_on() then
    raise exception 'commerce_disabled' using errcode = 'P0001';
  end if;
  if p_strictness not in ('tight', 'normal', 'loose') then
    raise exception 'invalid_input' using errcode = '23514';
  end if;

  select * into v_match from public.matches
   where id = p_match_id and user_id = v_me
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_match.status not in ('uploaded', 'failed') then
    raise exception 'bad_state' using errcode = 'P0001';
  end if;
  if v_match.raw_path is null
     or v_match.raw_path not like 'r2://ponglens-raw/' || v_me || '/%' then
    raise exception 'no_source' using errcode = 'P0001';
  end if;
  if v_match.duration_s is null or v_match.duration_s <= 0 then
    raise exception 'duration_unknown' using errcode = 'P0001';
  end if;

  v_start := greatest(coalesce(p_trim_start_s, 0), 0);
  v_end   := least(coalesce(p_trim_end_s, v_match.duration_s),
                   v_match.duration_s);
  if v_end - v_start < 5 then
    raise exception 'trim_too_short' using errcode = 'P0001';
  end if;
  v_charge := greatest(1, ceil((v_end - v_start) / 60.0))::integer;

  -- A video with a job already in flight must not be claimable again —
  -- the status only flips at the worker's points stage, so without this
  -- a double tap across two devices would double-spend. Content checks
  -- don't block a claim: they are housekeeping, not processing.
  if exists (
    select 1 from public.jobs j
    where (j.options ->> 'match_id')::uuid = p_match_id
      and j.kind <> 'content_check'
      and j.status in ('queued', 'processing')
  ) then
    raise exception 'already_processing' using errcode = 'P0001';
  end if;

  -- One processing at a time per user keeps the queue fair; same rule the
  -- upload gate applied when uploads were the enqueue point.
  select count(*) into v_active from public.jobs j
   where j.user_id = v_me
     and j.status in ('queued', 'processing')
     and j.kind not in ('reclip', 'content_check');
  if v_active >= 4 then
    raise exception 'queue_full' using errcode = 'P0001';
  end if;

  if p_order_id is not null then
    select * into v_order from public.review_orders
     where id = p_order_id and student_id = v_me
     for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if v_order.status not in ('awaiting_submission', 'submitted',
                              'in_review', 'clarification') then
      raise exception 'bad_state' using errcode = 'P0001';
    end if;
    if v_charge > public._commerce_int('review_included_minutes', 45) then
      raise exception 'over_review_limit' using errcode = 'P0001';
    end if;
    v_funding := 'order';
    v_mode := v_order.billing_mode;
  else
    v_mode := public.current_billing_mode();
    perform public._ensure_processing_grant(v_me, v_mode);
    -- The quota row is the per-user serialization point for balance math.
    perform public._ensure_quota(v_me);
    perform 1 from public.user_quotas where user_id = v_me for update;
    if public._processing_balance(v_me, v_mode) < v_charge then
      raise exception 'insufficient_minutes' using errcode = 'P0001';
    end if;
  end if;

  insert into public.jobs
    (user_id, kind, status, input_path, original_name, options)
  values
    (v_me, 'deadspace_cut', 'queued', v_match.raw_path,
     v_match.original_name,
     jsonb_build_object(
       'match_id', p_match_id,
       'trim_start_s', v_start,
       'trim_end_s', v_end,
       -- Always true, whatever the caller sent: the match row only gets
       -- filled in by the points stage, so a no-points library job would
       -- charge minutes for a cut the app never shows.
       'points', true,
       'placement', p_placement,
       'strictness', p_strictness,
       'funding', v_funding,
       'order_id', p_order_id,
       'charged_minutes', v_charge))
  returning id into v_job;

  insert into public.processing_ledger
    (user_id, minutes, kind, funding, billing_mode,
     match_id, job_id, order_id)
  values
    (v_me, -v_charge, 'spend', v_funding, v_mode,
     p_match_id, v_job, p_order_id);

  return jsonb_build_object(
    'job_id', v_job,
    'charged_minutes', v_charge,
    'funding', v_funding);
end;
$$;

revoke all on function public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid)
  from public, anon;
grant execute on function public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid)
  to authenticated;
