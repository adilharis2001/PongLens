-- 098: let the worker claim processing on a user's behalf.
--
-- "Process right away" (096 UI) works for direct uploads because the
-- browser is still there when the upload lands and can call the claim
-- itself. A YouTube import has no browser at the end: the download runs
-- for minutes on the worker, and the library row is created there. So
-- the worker needs to make the same claim.
--
-- Rather than a second copy of the money logic in Python, claim_processing
-- gains one optional argument: p_as_user. Only the service role may pass
-- it — the same auth.role() guard 086 established, and the worker sets
-- request.jwt.claims on its own connection to satisfy it. Every rule
-- (balance, capacity, trim window, double-claim, review cap) stays in the
-- one function that already owns them.

create or replace function public.claim_processing(
  p_match_id     uuid,
  p_trim_start_s double precision default null,
  p_trim_end_s   double precision default null,
  p_points       boolean default true,
  p_placement    boolean default false,
  p_strictness   text default 'normal',
  p_order_id     uuid default null,
  p_as_user      uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me      uuid;
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
  -- Acting for someone else is the service role's privilege alone.
  if p_as_user is not null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_me := p_as_user;
  else
    v_me := auth.uid();
  end if;
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

  if exists (
    select 1 from public.jobs j
    where (j.options ->> 'match_id')::uuid = p_match_id
      and j.kind <> 'content_check'
      and j.status in ('queued', 'processing')
  ) then
    raise exception 'already_processing' using errcode = 'P0001';
  end if;

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
    -- current_billing_mode() reads the caller's own JWT, which is the
    -- worker's when acting for someone else; resolve from the user.
    v_mode := case when public.is_qa(v_me) then 'test' else 'live' end;
    perform public._ensure_processing_grant(v_me, v_mode);
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

-- The 7-argument signature from 097 is replaced by this 8-argument one;
-- drop the old so no stale overload can be resolved instead.
drop function if exists public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid);

revoke all on function public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid,
  uuid) from public, anon;
grant execute on function public.claim_processing(
  uuid, double precision, double precision, boolean, boolean, text, uuid,
  uuid) to authenticated;
