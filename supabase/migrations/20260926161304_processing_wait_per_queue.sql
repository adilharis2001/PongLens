-- /admin/processing: how long a waiting job may wait depends on its queue.
--
-- The page turns a waiting job amber at 30 minutes, the cloud dispatcher's
-- own overflow trigger, and at 2 hours on the hand lane, which one process
-- drains and a long hand cut holds for an hour or more. The overview never
-- said which queue a job waits in, so the page could only guess from the
-- kind: a hand cut got two hours, but a hand-cut match's detailed analysis
-- or highlights, which job_queue_name also routes to jobs_hand, still went
-- amber at 30 minutes, a number that never applies to hand-lane work (the
-- dispatcher leaves jobs_hand out). The /admin hub card had one 30-minute
-- threshold across every lane for the same reason.
--
--   * admin_processing_overview(): waiting, running and recent rows carry
--     queue_name, from public.job_queue_name(kind, options), the one
--     statement of where a job is routed.
--   * admin_processing_counts(): adds oldest_wait_by_queue, the oldest
--     queued job's wait per queue, so the hub can apply the same rule.
--     oldest_wait_s stays for anything still reading it.
--
-- Both functions were pulled from production with pg_get_functiondef on
-- 2026-09-26 and are changed only where a comment says "Changed:".

-- The queue a job row routes to; null when there is no such job.
create or replace function public._queue_name_of_job(p_job_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_queue text;
begin
  if coalesce(p_job_id, '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  select public.job_queue_name(j.kind, j.options) into v_queue
    from public.jobs j
   where j.id = p_job_id::uuid;
  return v_queue;
end;
$$;
revoke all on function public._queue_name_of_job(text) from public, anon, authenticated;

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

  -- Every job row says whether it is a player's own Replace
  -- (player_replace), and every worker row whether the job it is on is one
  -- (job_player_replace), so the page can tell it from support's re-runs.
  -- Changed: waiting, running and recent rows also say which queue the
  -- job is routed to (queue_name), so the page can hold hand-lane work to
  -- the hand lane's wait rather than the cloud trigger's.
  select coalesce(jsonb_agg(
           r.value || jsonb_build_object(
             'player_replace', public._is_player_replace_job(r.value->>'id'),
             'queue_name', public._queue_name_of_job(r.value->>'id'))
           order by r.ordinality), '[]'::jsonb)
    into v_running
    from jsonb_array_elements(coalesce(overview->'running', '[]'::jsonb))
         with ordinality as r(value, ordinality)
   where not ((r.value->>'id') = any (v_ids));

  select coalesce(jsonb_agg(
           case when j.id is not null
                then r.value || jsonb_build_object('on_device', true)
                else r.value end
           || jsonb_build_object(
                'player_replace', public._is_player_replace_job(r.value->>'id'),
                'queue_name', public._queue_name_of_job(r.value->>'id'))
           order by r.ordinality), '[]'::jsonb)
    into v_recent
    from jsonb_array_elements(coalesce(overview->'recent', '[]'::jsonb))
         with ordinality as r(value, ordinality)
    left join public.jobs j
      on j.id = (r.value->>'id')::uuid
     and j.kind = 'hand_cut'
     and coalesce(j.options->>'phase', '') in ('device', 'released');

  select coalesce(jsonb_agg(
           r.value || jsonb_build_object(
             'player_replace', public._is_player_replace_job(r.value->>'id'),
             'queue_name', public._queue_name_of_job(r.value->>'id'))
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

CREATE OR REPLACE FUNCTION public.admin_processing_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Changed: the oldest queued job's wait in each queue it is routed to,
    -- so the hub holds the hand lane to its own threshold. Its own
    -- subquery because it groups by queue.
    'oldest_wait_by_queue', coalesce((
      select jsonb_object_agg(q.queue_name, q.oldest_wait_s)
        from (
          select public.job_queue_name(j3.kind, j3.options) as queue_name,
                 extract(epoch from now() - min(j3.created_at))::int as oldest_wait_s
            from public.jobs j3
           where j3.status = 'queued'
           group by 1
        ) q
    ), '{}'::jsonb),
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
