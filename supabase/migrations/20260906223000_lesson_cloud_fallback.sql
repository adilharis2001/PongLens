-- Modal is a lesson-recap backup, never a peer that races a healthy Mac.
-- A cheap dispatcher may ask this aggregate question, but the claim below
-- repeats the decision so bypassing the dispatcher cannot bypass the policy.
create or replace function public.lesson_video_cloud_dispatch_ready(
  p_release text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.lesson_video_release r
     where r.id = true
       and r.enabled
       and r.cloud_enabled
       and r.release_id = p_release
       and not exists (
         select 1
           from public.lesson_videos active
           join public.lesson_video_worker_heartbeats worker
             on worker.worker_id = active.worker_id
          where active.status = 'processing'
            and active.lease_until >= now()
            and worker.is_cloud
       )
       and (
         -- Three queued hours is explicit overload, even while the Mac reports.
         exists (
           select 1
             from public.lesson_videos queued
            where (
              queued.status = 'queued'
              or (
                queued.status = 'processing'
                and queued.lease_until < now()
                and queued.lease_reclaim_count < 3
              )
            )
              and queued.stage is distinct from 'Deleting'
              and queued.created_at <= now() - interval '3 hours'
              and not exists (
                select 1
                  from public.lesson_video_deletions deleting
                 where deleting.owner_id = queued.owner_id
              )
         )
         or (
           -- An outage must be sustained for fifteen minutes, and a lesson
           -- must have waited thirty minutes before cloud work starts.
           not exists (
             select 1
               from public.lesson_video_worker_heartbeats mac
              where not mac.is_cloud
                and mac.release_id = p_release
                and mac.heartbeat_at >= now() - interval '15 minutes'
           )
           and exists (
             select 1
               from public.lesson_videos queued
              where (
                queued.status = 'queued'
                or (
                  queued.status = 'processing'
                  and queued.lease_until < now()
                  and queued.lease_reclaim_count < 3
                )
              )
                and queued.stage is distinct from 'Deleting'
                and queued.created_at <= now() - interval '30 minutes'
                and not exists (
                  select 1
                    from public.lesson_video_deletions deleting
                   where deleting.owner_id = queued.owner_id
                )
           )
         )
       )
  );
$$;

create or replace function public.claim_lesson_video(
  p_release text,
  p_worker text,
  p_cloud boolean default false
)
returns setof public.lesson_videos
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen uuid;
  chosen_owner uuid;
begin
  if not exists (
    select 1
      from public.lesson_video_release
     where enabled
       and release_id = p_release
       and (not p_cloud or cloud_enabled)
  ) then
    return;
  end if;

  if p_cloud and not public.lesson_video_cloud_dispatch_ready(p_release) then
    return;
  end if;

  update public.lesson_videos
     set status = 'failed',
         stage = null,
         lease_token = null,
         lease_until = null,
         error = 'The recap paused too many times. Your original and completed work are kept. Choose Retry to continue.',
         updated_at = now()
   where status = 'processing'
     and lease_until < now()
     and lease_reclaim_count >= 3
     and stage is distinct from 'Deleting'
     and not exists (
       select 1
         from public.lesson_video_deletions d
        where d.owner_id = lesson_videos.owner_id
     );

  select v.id, v.owner_id
    into chosen, chosen_owner
    from public.lesson_videos v
   where (
     v.status = 'queued'
     or (
       v.status = 'processing'
       and v.lease_until < now()
       and v.lease_reclaim_count < 3
     )
   )
     and not exists (
       select 1
         from public.lesson_video_deletions d
        where d.owner_id = v.owner_id
     )
   order by v.created_at
   limit 1;

  if chosen is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('lesson-video-delete:' || chosen_owner::text, 0)
  );
  if exists (
    select 1
      from public.lesson_video_deletions
     where owner_id = chosen_owner
  ) then
    return;
  end if;

  perform 1
    from public.lesson_videos
   where id = chosen
     and (
       status = 'queued'
       or (
         status = 'processing'
         and lease_until < now()
         and lease_reclaim_count < 3
       )
     )
   for update skip locked;
  if not found then
    return;
  end if;

  return query
  update public.lesson_videos
     set status = 'processing',
         stage = 'Preparing lesson',
         lease_token = gen_random_uuid(),
         lease_until = now() + interval '5 minutes',
         worker_id = p_worker,
         release_id = p_release,
         error = null,
         lease_reclaim_count = case
           when lesson_videos.status = 'processing'
             then lesson_videos.lease_reclaim_count + 1
           else lesson_videos.lease_reclaim_count
         end,
         updated_at = now()
   where id = chosen
   returning *;
end;
$$;

revoke all on function public.lesson_video_cloud_dispatch_ready(text)
  from public, anon, authenticated;
grant execute on function public.lesson_video_cloud_dispatch_ready(text)
  to service_role;

-- Keep the existing overview intact and add the release switch to its lesson
-- object. The old implementation stays private behind this small wrapper so
-- this migration does not duplicate the rest of the processing dashboard.
alter function public.admin_processing_overview()
  rename to admin_processing_overview_pre_lesson_fallback_20260906;
revoke all on function public.admin_processing_overview_pre_lesson_fallback_20260906()
  from public, anon, authenticated;

create function public.admin_processing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  overview jsonb;
  lesson jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  overview := public.admin_processing_overview_pre_lesson_fallback_20260906();
  lesson := coalesce(overview->'lesson', '{}'::jsonb) || jsonb_build_object(
    'cloud_enabled', coalesce((
      select cloud_enabled
        from public.lesson_video_release
       where id = true
    ), false)
  );
  return jsonb_set(overview, '{lesson}', lesson, true);
end;
$$;

revoke all on function public.admin_processing_overview()
  from public, anon;
grant execute on function public.admin_processing_overview()
  to authenticated;
