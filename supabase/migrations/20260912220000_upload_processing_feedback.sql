-- Measured upload feedback. No numerical ETA is enabled by this migration.
begin;

create table public.match_processing_events (
  id bigint generated always as identity primary key,
  attempt_key text not null check (length(attempt_key) <= 100),
  -- Like worker_processing_runs, timing evidence outlives queue-row cleanup.
  -- No owner, filename, video path or other identifying data is stored here.
  job_id uuid not null,
  attempt integer not null check (attempt between 1 and 10000),
  lane text not null check (lane in ('main','fast')),
  release_id text check (length(release_id) <= 100),
  event text not null check (event in ('claimed','profile','stage','progress','ready','released','failed')),
  recorded_at timestamptz not null,
  details jsonb not null default '{}',
  unique (attempt_key,event,recorded_at)
);
create index match_processing_events_job on public.match_processing_events(job_id,recorded_at);
create index match_processing_events_release on public.match_processing_events(release_id,recorded_at);

create table public.match_video_checks (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  checked_at timestamptz not null default now(),
  window_start_s double precision not null check (window_start_s >= 0),
  window_end_s double precision not null check (window_end_s > window_start_s),
  result jsonb not null
);
create index match_video_checks_match on public.match_video_checks(match_id,checked_at desc);
alter table public.match_processing_events enable row level security;
alter table public.match_video_checks enable row level security;
revoke all on public.match_processing_events,public.match_video_checks from public,anon,authenticated,service_role;
grant select on public.match_processing_events,public.match_video_checks to service_role;

create function public.record_match_processing_event(p_record jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_job uuid; v_attempt integer; v_details jsonb := '{}'; v_key text; v_value jsonb;
begin
  if jsonb_typeof(p_record) <> 'object' or octet_length(p_record::text) > 8192 then return; end if;
  v_job := (p_record->>'job_id')::uuid;
  v_attempt := (p_record->>'attempt')::integer;
  if v_job is null or v_attempt not between 1 and 10000
     or p_record->>'attempt_key' is distinct from v_job::text||':'||v_attempt::text
     or coalesce(p_record->>'lane','') not in ('main','fast')
     or coalesce(p_record->>'event','') not in ('claimed','profile','stage','progress','ready','released','failed')
     or length(coalesce(p_record->>'release_id','')) > 100
     or (p_record->>'release_id' is not null and p_record->>'release_id' !~ '^[A-Za-z0-9_:-]+$')
     or p_record->>'recorded_at' is null then return; end if;
  if jsonb_typeof(p_record->'details') = 'object' then
    for v_key,v_value in select key,value from jsonb_each(p_record->'details') loop
      if v_key in ('stage','reason_code','route') and jsonb_typeof(v_value)='string'
         and v_value #>> '{}' ~ '^[A-Za-z0-9_:-]+$' then
        v_details := v_details || jsonb_build_object(v_key,left(v_value #>> '{}',case when v_key='route' then 120 else 60 end));
      elsif jsonb_typeof(v_value)='number' and (
        (v_key='progress' and (v_value::text)::numeric between 0 and 100 and trunc((v_value::text)::numeric)=(v_value::text)::numeric)
        or (v_key in ('duration_s','fps') and (v_value::text)::numeric > 0 and (v_value::text)::numeric <= 86400)
        or (v_key in ('width','height') and (v_value::text)::numeric between 1 and 32768 and trunc((v_value::text)::numeric)=(v_value::text)::numeric)
        or (v_key='trim_start_s' and (v_value::text)::numeric between 0 and 86400)) then
        v_details := v_details || jsonb_build_object(v_key,v_value);
      end if;
    end loop;
  end if;
  insert into public.match_processing_events(attempt_key,job_id,attempt,lane,release_id,event,recorded_at,details)
  values(p_record->>'attempt_key',v_job,v_attempt,p_record->>'lane',p_record->>'release_id',
    p_record->>'event',(p_record->>'recorded_at')::timestamptz,v_details)
  on conflict (attempt_key,event,recorded_at) do nothing;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format
  or foreign_key_violation or check_violation or not_null_violation then return;
end;
$$;

create function public.record_match_video_check(p_match_id uuid,p_job_id uuid,
  p_window_start_s double precision,p_window_end_s double precision,p_result jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_changes jsonb := '[]'; v_item jsonb; v_before double precision; v_after double precision; v_result jsonb;
begin
  if p_window_start_s is null or p_window_end_s is null
     or not (p_window_start_s between 0 and 86400 and p_window_end_s > p_window_start_s and p_window_end_s <= 86400)
     or jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 16384
     or coalesce(p_result->>'status','') not in ('changed','stable','unknown') then return; end if;
  -- A reporter cannot attach one player's check to another player's match.
  if not exists (select 1 from public.jobs j join public.matches m on m.id=p_match_id and m.user_id=j.user_id
      where j.id=p_job_id and (j.options->>'match_id'=m.id::text or m.job_id=j.id)) then return; end if;
  if jsonb_typeof(p_result->'changes')='array' then
    for v_item in select value from jsonb_array_elements(p_result->'changes') limit 16 loop
      if jsonb_typeof(v_item->'before_s')='number' and jsonb_typeof(v_item->'after_s')='number' then
        v_before := (v_item->>'before_s')::double precision; v_after := (v_item->>'after_s')::double precision;
        if v_before >= p_window_start_s and v_after > v_before and v_after <= p_window_end_s then
          v_changes := v_changes || jsonb_build_array(jsonb_build_object('before_s',v_before,'after_s',v_after,'kind','shift'));
        end if;
      end if;
    end loop;
  end if;
  v_result := jsonb_build_object('schema',1,'status',p_result->>'status','changes',v_changes);
  if p_result->>'reason_code' ~ '^[a-z_]{1,60}$' then
    v_result := v_result || jsonb_build_object('reason_code',p_result->>'reason_code');
  end if;
  if jsonb_typeof(p_result->'sample_count')='number' and (p_result->>'sample_count')::numeric between 0 and 16 then
    v_result := v_result || jsonb_build_object('sample_count',p_result->'sample_count');
  end if;
  -- A changed result without a valid bracket cannot support player wording.
  if v_result->>'status'='changed' and jsonb_array_length(v_changes)=0 then
    v_result := v_result || '{"status":"unknown"}'::jsonb;
  end if;
  insert into public.match_video_checks(job_id,match_id,window_start_s,window_end_s,result)
  values(p_job_id,p_match_id,p_window_start_s,p_window_end_s,v_result)
  on conflict(job_id) do update set checked_at=now(),window_start_s=excluded.window_start_s,
    window_end_s=excluded.window_end_s,result=excluded.result where match_video_checks.match_id=excluded.match_id;
exception when invalid_text_representation or numeric_value_out_of_range or foreign_key_violation then return;
end;
$$;

create function public.my_match_processing_feedback(p_match_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'match_id',m.id,'job_id',j.id,'job_status',j.status,'job_kind',j.kind,
    'stage',case when j.status in ('queued','processing') and p.beat_at >= now()-interval '90 seconds' then p.stage end,
    'worker_state',case when j.id is null then null when p.worker_id is null then 'missing'
      when p.beat_at < now()-interval '90 seconds' then 'silent' else 'fresh' end,
    'checked_at',c.checked_at,'window_start_s',c.window_start_s,'window_end_s',c.window_end_s,'camera_check',c.result
  )),'[]'::jsonb)
  from public.matches m
  left join lateral (
    select x.* from public.jobs x where x.user_id=m.user_id
      and (x.options->>'match_id'=m.id::text or x.id=m.job_id)
      and x.kind in ('deadspace_cut','youtube_import','hand_cut','content_check')
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
$$;

revoke all on function public.record_match_processing_event(jsonb),
  public.record_match_video_check(uuid,uuid,double precision,double precision,jsonb),
  public.my_match_processing_feedback(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.record_match_processing_event(jsonb),
  public.record_match_video_check(uuid,uuid,double precision,double precision,jsonb) to service_role;
grant execute on function public.my_match_processing_feedback(uuid[]) to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='ponglens_worker') then
    grant execute on function public.record_match_processing_event(jsonb),
      public.record_match_video_check(uuid,uuid,double precision,double precision,jsonb) to ponglens_worker;
  end if;
end $$;
commit;
