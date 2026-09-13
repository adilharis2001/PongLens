begin;

-- An accepted upload intent is never charged twice, even if its reply was
-- lost and the job finished (or failed) before the phone retries.
create table public.upload_processing_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  match_id uuid not null references public.matches(id) on delete cascade,
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table public.upload_processing_requests enable row level security;
revoke all on public.upload_processing_requests from public,anon,authenticated,service_role;

create function public.claim_upload_processing(
  p_request_id uuid,p_match_id uuid,p_trim_start_s double precision,
  p_trim_end_s double precision,p_points boolean,p_placement boolean,
  p_strictness text,p_order_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_me uuid:=auth.uid(); v_payload jsonb; v_saved public.upload_processing_requests%rowtype; v_result jsonb;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode='P0001'; end if;
  if p_request_id is null then raise exception 'invalid_input' using errcode='P0001'; end if;
  if not exists(select 1 from public.matches where id=p_match_id and user_id=v_me) then
    raise exception 'not_found' using errcode='P0002';
  end if;
  v_payload:=jsonb_build_object('match_id',p_match_id,'trim_start_s',p_trim_start_s,
    'trim_end_s',p_trim_end_s,'points',p_points,'placement',p_placement,
    'strictness',p_strictness,'order_id',p_order_id);
  perform pg_advisory_xact_lock(hashtextextended(v_me::text||':'||p_request_id::text,0));
  select * into v_saved from public.upload_processing_requests
    where user_id=v_me and request_id=p_request_id;
  if found then
    if v_saved.payload<>v_payload then raise exception 'invalid_input' using errcode='P0001'; end if;
    return v_saved.response;
  end if;
  -- Funding, ownership, active-job protection and queue insertion remain in
  -- the canonical claim. Its transaction also contains this receipt.
  v_result:=public.claim_processing(p_match_id,p_trim_start_s,p_trim_end_s,p_points,
    p_placement,p_strictness,p_order_id);
  if nullif(v_result->>'job_id','') is null then
    raise exception 'processing_request_failed' using errcode='P0001';
  end if;
  insert into public.upload_processing_requests values(v_me,p_request_id,p_match_id,v_payload,v_result,now());
  return v_result;
end;
$$;
revoke all on function public.claim_upload_processing(uuid,uuid,double precision,double precision,boolean,boolean,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_upload_processing(uuid,uuid,double precision,double precision,boolean,boolean,text,uuid)
  to authenticated;

-- The estimator still needs internal check/queue occupancy to project work
-- ahead. Only this read boundary decides what a player may see as "ready".
create or replace function public._fresh_processing_estimate(p_job_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select case
    when j.kind not in ('deadspace_cut','youtube_import')
      or c.estimate->>'state' not in ('range','overdue')
      or j.status not in ('queued','processing') or c.expires_at<=now() then null
    when public.processing_lane_status(c.lane)<>'available' then null
    when c.estimate->>'state'='overdue' or (c.estimate->>'ready_latest_at')::timestamptz<now()
      then c.estimate||jsonb_build_object('state','overdue','reason','estimate_overdue','ready_scope','match',
        'start_earliest_at',null,'start_latest_at',null,'ready_earliest_at',null,'ready_latest_at',null)
    else c.estimate||jsonb_build_object('ready_scope','match') end
  from public.processing_estimate_cache c join public.jobs j on j.id=c.job_id
  where c.job_id=p_job_id;
$$;
revoke all on function public._fresh_processing_estimate(uuid) from public,anon,authenticated,service_role;
commit;
