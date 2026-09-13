-- Independent private estimate cache. No legacy ETA, job clocks, queue claims,
-- processing_control or admin_processing_overview definition is changed.
begin;

create index match_processing_events_estimate_attempt_idx
  on public.match_processing_events(job_id,attempt desc,event,recorded_at desc);
create index jobs_estimate_content_check_idx on public.jobs((options->>'match_id'),created_at desc)
  where kind='content_check' and status='done';

create table public.processing_estimate_cache (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  lane text not null check(lane in ('main','fast','hand')),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  estimate jsonb not null check(jsonb_typeof(estimate)='object')
);
alter table public.processing_estimate_cache enable row level security;
revoke all on public.processing_estimate_cache from public,anon,authenticated,service_role;

-- Optional source metadata is accessed as JSON because it belongs to the
-- divergent legacy migration, which must not be replayed here.
create function public._processing_estimate_job(p_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp set timezone='UTC' as $$
  with job as (select j.* from public.jobs j where j.id=p_id),
  latest as (
    select e.attempt from public.match_processing_events e where e.job_id=p_id
    order by e.attempt desc limit 1
  ), receipts as (
    select k.event,e.recorded_at,e.details,e.lane from latest a
    cross join (values('claimed'),('profile'),('ready'),('released'),('failed')) k(event)
    left join lateral (
      select e.recorded_at,e.details,e.lane from public.match_processing_events e
      where e.job_id=p_id and e.attempt=a.attempt and e.event=k.event
      order by e.recorded_at desc limit 1
    ) e on true
  ), linked as (
    select m.id,m.job_id from job j join public.matches m
      on m.id=case when j.options->>'match_id' ~ '^[0-9a-fA-F-]{36}$'
        then (j.options->>'match_id')::uuid end and m.user_id=j.user_id
  ), source as (
    select to_jsonb(s) as data from linked m join public.jobs s on s.id=m.job_id
    join job j on j.user_id=s.user_id
    where to_jsonb(s)->>'source_metadata_verified_at' is not null
    union all
    select jsonb_build_object('source_duration_s',e.details->'duration_s',
      'source_fps',e.details->'fps','source_metadata_verified_at',e.recorded_at)
    from linked m cross join lateral (
      select c.id from public.jobs c join job j on c.user_id=j.user_id
      where c.options->>'match_id'=m.id::text and c.kind='content_check' and c.status='done'
      order by c.created_at desc limit 1
    ) c cross join lateral (
      select x.recorded_at,x.details from public.match_processing_events x
      where x.job_id=c.id and x.event='profile' and x.details->>'route'='content_check'
        and x.attempt=(select a.attempt from public.match_processing_events a
          where a.job_id=c.id order by a.attempt desc limit 1)
      order by x.recorded_at desc limit 1
    ) e
  )
  select jsonb_build_object('id',j.id,'kind',j.kind,'status',j.status,'options',j.options,
    'source_duration_s',to_jsonb(j)->'source_duration_s','source_fps',to_jsonb(j)->'source_fps',
    'source_metadata_verified_at',to_jsonb(j)->'source_metadata_verified_at',
    'source',(select jsonb_build_object('source_duration_s',s.data->'source_duration_s',
      'source_fps',s.data->'source_fps','source_metadata_verified_at',s.data->'source_metadata_verified_at') from source s limit 1),
    'events',coalesce((select jsonb_object_agg(r.event,r.recorded_at) from receipts r
      where r.event<>'profile' and r.recorded_at is not null),'{}'),
    'profile',(select r.details from receipts r where r.event='profile'),
    'receipt_lane',(select r.lane from receipts r where r.event='claimed'),
    'terminal',j.kind in ('deadspace_cut','youtube_import') and (j.user_message is not null
      or exists(select 1 from public.processing_ledger l where l.job_id=j.id and l.kind='refund')
      or exists(select 1 from public.matches m where m.job_id=j.id and m.status='ready')))
  from job j;
$$;

create function public.processing_estimate_snapshot() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare v_lanes jsonb:='[]'; v_lane text; v_queue text; v_messages jsonb;
  v_pulse jsonb; v_count integer; v_overflow boolean;
begin
  foreach v_lane in array array['main','fast','hand'] loop
    v_queue:=case v_lane when 'main' then 'q_jobs' else 'q_jobs_'||v_lane end;
    -- Only 257 indexed message IDs are examined: the extra row is an overflow
    -- sentinel, not an omitted workload silently treated as zero.
    execute format($q$
      with bounded as materialized (select * from pgmq.%I order by msg_id limit 257),
      page as (select * from bounded order by msg_id limit 256)
      select (select count(*)>256 from bounded),coalesce(jsonb_agg(jsonb_build_object(
        'msg_id',q.msg_id,'read_ct',q.read_ct,'enqueued_at',q.enqueued_at,'vt',q.vt,
        'job',public._processing_estimate_job(case when q.message->>'job_id' ~ '^[0-9a-fA-F-]{36}$'
          then (q.message->>'job_id')::uuid end)) order by q.msg_id),'[]') from page q
    $q$,v_queue) into v_overflow,v_messages;
    select jsonb_build_object('job_id',p.job_id,'beat_at',p.beat_at,'stage',p.stage)
      into v_pulse from public.worker_pulse p where p.host='mac' and p.lane=v_lane
      order by p.beat_at desc limit 1;
    select count(*) into v_count from public.worker_pulse p where p.host='mac' and p.lane=v_lane
      and p.beat_at>=now()-interval '90 seconds';
    v_lanes:=v_lanes||jsonb_build_array(jsonb_build_object('lane',v_lane,
      'availability',public.processing_lane_status(v_lane),'overflow',v_overflow,
      'contradictory',v_count>1,'pulse',v_pulse,
      'active',public._processing_estimate_job((v_pulse->>'job_id')::uuid),'messages',v_messages));
  end loop;
  return jsonb_build_object('observed_at',now(),'points_pipeline',
    (select value from public.app_config where key='points_pipeline'),'lanes',v_lanes);
end;
$$;

create function public.store_processing_estimates(p_rows jsonb,p_observed_at timestamptz) returns void
language plpgsql security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare r record; e jsonb; v_lane text;
begin
  if jsonb_typeof(p_rows) is distinct from 'object' or octet_length(p_rows::text)>1048576
    or p_observed_at is null or p_observed_at>now() or p_observed_at<now()-interval '90 seconds'
    then raise exception 'invalid estimate batch' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_rows))>771 then
    raise exception 'estimate batch too large' using errcode='22023'; end if;
  -- The same advisory lock is used by the producer, including manual overlap.
  perform pg_advisory_xact_lock(9171306200);
  delete from public.processing_estimate_cache;
  for r in select key,value from jsonb_each(p_rows) loop
    e:=r.value->'estimate'; v_lane:=r.value->>'lane';
    if v_lane not in ('main','fast','hand') or coalesce(e->>'state','') not in ('range','queue_only','unknown','overdue')
      or coalesce(e->>'basis','') not in ('recent_baseline_20260913','recent_baseline_extrapolated') then
      raise exception 'invalid estimate' using errcode='22023'; end if;
    -- Only explicitly safe keys survive even a buggy producer. Never store
    -- arbitrary service records, source details or another owner's identity.
    insert into public.processing_estimate_cache(job_id,lane,observed_at,expires_at,estimate)
    select j.id,v_lane,p_observed_at,p_observed_at+interval '90 seconds',jsonb_build_object(
      'state',e->>'state','basis',e->>'basis',
      'reason',case when e->>'reason' ~ '^[a-z_]{1,60}$' then e->>'reason' end,
      'observed_at',p_observed_at,'expires_at',p_observed_at+interval '90 seconds',
      'start_earliest_at',(e->>'start_earliest_at')::timestamptz,'start_latest_at',(e->>'start_latest_at')::timestamptz,
      'ready_earliest_at',(e->>'ready_earliest_at')::timestamptz,'ready_latest_at',(e->>'ready_latest_at')::timestamptz)
    from public.jobs j where j.id=r.key::uuid;
  end loop;
end;
$$;

create function public._fresh_processing_estimate(p_job_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select case when j.status not in ('queued','processing') or c.expires_at<=now() then null
    when public.processing_lane_status(c.lane)<>'available' then c.estimate||jsonb_build_object(
      'state','unknown','reason','service_'||public.processing_lane_status(c.lane),
      'start_earliest_at',null,'start_latest_at',null,'ready_earliest_at',null,'ready_latest_at',null)
    when (c.estimate->>'ready_latest_at')::timestamptz<now()
      or (c.estimate->>'state'='queue_only' and (c.estimate->>'start_latest_at')::timestamptz<now())
      then c.estimate||jsonb_build_object('state','overdue','reason','estimate_overdue',
        'start_earliest_at',null,'start_latest_at',null,'ready_earliest_at',null,'ready_latest_at',null)
    else c.estimate end
  from public.processing_estimate_cache c join public.jobs j on j.id=c.job_id
  where c.job_id=p_job_id;
$$;

-- Preserve every existing field and the existing primary-job selection.
alter function public.my_match_processing_feedback(uuid[])
  rename to _my_match_processing_feedback_before_estimates;
revoke all on function public._my_match_processing_feedback_before_estimates(uuid[])
  from public,anon,authenticated,service_role;
create function public.my_match_processing_feedback(p_match_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(f.value||jsonb_build_object('estimate',
    public._fresh_processing_estimate((f.value->>'job_id')::uuid))),'[]')
  from jsonb_array_elements(public._my_match_processing_feedback_before_estimates(p_match_ids[1:100])) f;
$$;

create function public.my_processing_estimates(p_job_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'estimate',public._fresh_processing_estimate(j.id))),'[]')
  from public.jobs j where j.user_id=auth.uid() and j.id=any(p_job_ids[1:100]);
$$;

create function public.admin_processing_estimates(p_job_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(public.is_admin(),false) then raise exception 'admin only' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'estimate',public._fresh_processing_estimate(j.id))),'[]')
    from public.jobs j where j.id=any(p_job_ids[1:100]));
end;
$$;

revoke all on function public._processing_estimate_job(uuid),public.processing_estimate_snapshot(),
  public.store_processing_estimates(jsonb,timestamptz),public._fresh_processing_estimate(uuid),
  public.my_match_processing_feedback(uuid[]),public.my_processing_estimates(uuid[]),
  public.admin_processing_estimates(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.my_match_processing_feedback(uuid[]),public.my_processing_estimates(uuid[]),
  public.admin_processing_estimates(uuid[]) to authenticated;
grant execute on function public.processing_estimate_snapshot(),public.store_processing_estimates(jsonb,timestamptz) to service_role;
do $$ begin
  if exists(select 1 from pg_roles where rolname='ponglens_worker') then
    grant execute on function public.processing_estimate_snapshot(),public.store_processing_estimates(jsonb,timestamptz) to ponglens_worker;
  end if;
end $$;
commit;
