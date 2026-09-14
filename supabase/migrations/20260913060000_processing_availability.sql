-- Authenticated, privacy-safe availability for the three Mac processing lanes.
-- Raw pulse identity, job ownership, release paths and worker errors stay private.
begin;

create index match_processing_events_availability_recent_idx
  on public.match_processing_events(lane,recorded_at desc)
  where event in ('progress','ready','released');

create function public.processing_lane_status(p_lane text) returns text
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with latest as (
    select p.beat_at,p.stage
    from public.worker_pulse p
    where p.host='mac' and p.lane=p_lane
    order by p.beat_at desc
    limit 1
  )
  select case
    when p_lane not in ('main','fast','hand') then 'unknown'
    when l.beat_at >= now()-interval '90 seconds'
      and l.stage='release_invalid' then 'unavailable'
    when l.beat_at >= now()-interval '90 seconds'
      and l.stage='drained' then 'maintenance'
    when l.beat_at >= now()-interval '90 seconds' then 'available'
    -- A lane that has never reported remains unknown. A recent service-only
    -- receipt can prove a previously observed main/fast lane is still moving,
    -- but cannot identify a process on a machine that has never spoken. Hand
    -- has no receipt fallback because match_processing_events cannot store it.
    when l.beat_at is null then 'unknown'
    when p_lane in ('main','fast') and exists (
      select 1
      from public.match_processing_events e
      join public.jobs j on j.id=e.job_id
      where e.lane=p_lane
        and e.recorded_at >= now()-interval '180 seconds'
        and e.event in ('progress','ready','released')
        -- Progress zero is an observation, not evidence that work advanced.
        -- Ready and released are themselves worker-owned terminal movement.
        and case when e.event='progress' then
          jsonb_typeof(e.details->'progress')='number'
          and (e.details->>'progress')::numeric>0
        else true end
        -- These are the process_job kinds whose telemetry can name main or
        -- fast authoritatively. hand_cut is intentionally absent because the
        -- event schema cannot represent hand; a mislabelled main receipt must
        -- not make either lane look alive.
        and j.kind in ('match_reprocess','placement_generate','placement_retry',
          'reclip','reel','content_check','deadspace_cut','youtube_import')
    ) then 'available'
    else 'unavailable'
  end
  from (select 1) seed
  left join latest l on true;
$$;

create function public.processing_service_status() returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'main',public.processing_lane_status('main'),
    'fast',public.processing_lane_status('fast'),
    'hand',public.processing_lane_status('hand'),
    'clip_lane',case when (
      select c.value from public.app_config c where c.key='reclip_lane'
    )='fast' then 'fast' else 'main' end,
    'observed_at',now()
  );
$$;

create or replace function public.my_match_processing_feedback(p_match_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
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

revoke all on function public.processing_lane_status(text),
  public.processing_service_status(),
  public.my_match_processing_feedback(uuid[])
  from public,anon,authenticated,service_role;
grant execute on function public.processing_service_status(),
  public.my_match_processing_feedback(uuid[]) to authenticated;

commit;
