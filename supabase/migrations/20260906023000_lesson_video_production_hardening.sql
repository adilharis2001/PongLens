-- Lesson-only operational state. It cannot expose a coach's source, edit or transcript.
alter table public.lesson_videos add column lease_reclaim_count integer not null default 0
  check(lease_reclaim_count>=0 and lease_reclaim_count<=3);

create table public.lesson_video_worker_heartbeats (
 worker_id text primary key check(length(worker_id)>0 and length(worker_id)<=200),
 release_id text not null check(length(release_id)>0 and length(release_id)<=200),
 is_cloud boolean not null,
 started_at timestamptz not null default now(),
 heartbeat_at timestamptz not null default now()
);
alter table public.lesson_video_worker_heartbeats enable row level security;
revoke all on public.lesson_video_worker_heartbeats from public,anon,authenticated;
grant all on public.lesson_video_worker_heartbeats to service_role;

create function public.record_lesson_video_worker_heartbeat(p_release text,p_worker text,p_cloud boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if length(coalesce(p_release,''))=0 or length(coalesce(p_worker,''))=0 then
  raise exception 'invalid_lesson_worker_identity';
 end if;
 insert into lesson_video_worker_heartbeats(worker_id,release_id,is_cloud)
 values(p_worker,p_release,p_cloud)
 on conflict(worker_id) do update set
  started_at=case when lesson_video_worker_heartbeats.release_id is distinct from excluded.release_id or lesson_video_worker_heartbeats.is_cloud is distinct from excluded.is_cloud then now() else lesson_video_worker_heartbeats.started_at end,
  release_id=excluded.release_id,is_cloud=excluded.is_cloud,heartbeat_at=now();
end $$;

-- Admin readers get aggregate operational health only. The function deliberately
-- has no lesson identifier, owner, transcript, edit, object key or error output.
create function public.admin_lesson_video_health()
returns table(enabled boolean,cloud_enabled boolean,mac_worker_active boolean,mac_heartbeat_at timestamptz,queued_count bigint,oldest_queued_at timestamptz,oldest_queue_age_seconds bigint)
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 return query
 select r.enabled,r.cloud_enabled,h.active,h.latest,q.count,q.oldest,
   coalesce(floor(extract(epoch from now()-q.oldest))::bigint,0)
 from lesson_video_release r
 cross join lateral (
  select coalesce(bool_or(heartbeat_at>=now()-interval '2 minutes'),false) as active,max(heartbeat_at) as latest
  from lesson_video_worker_heartbeats where release_id=r.release_id and not is_cloud
 ) h
 cross join lateral (
  select count(*)::bigint as count,min(updated_at) as oldest
  from lesson_videos where status='queued' and stage is distinct from 'Deleting'
 ) q;
end $$;

-- An expired lease can be reclaimed three times. A fourth expiry is a stopped
-- process, not new work: retain original/transcript/edit and wait for Retry.
create or replace function public.claim_lesson_video(p_release text,p_worker text,p_cloud boolean default false)
returns setof public.lesson_videos language plpgsql security definer set search_path=public as $$
declare chosen uuid; chosen_owner uuid;
begin
 if not exists(select 1 from lesson_video_release where enabled and release_id=p_release and (not p_cloud or cloud_enabled)) then return; end if;
 update lesson_videos set status='failed',stage=null,lease_token=null,lease_until=null,
  error='The recap paused too many times. Your original and completed work are kept. Choose Retry to continue.',updated_at=now()
 where status='processing' and lease_until<now() and lease_reclaim_count>=3
  and stage is distinct from 'Deleting'
  and not exists(select 1 from lesson_video_deletions d where d.owner_id=lesson_videos.owner_id);
 select v.id,v.owner_id into chosen,chosen_owner from lesson_videos v
 where (v.status='queued' or (v.status='processing' and v.lease_until<now() and v.lease_reclaim_count<3))
 and not exists(select 1 from lesson_video_deletions d where d.owner_id=v.owner_id)
 order by v.created_at limit 1;
 if chosen is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('lesson-video-delete:'||chosen_owner::text,0));
 if exists(select 1 from lesson_video_deletions where owner_id=chosen_owner) then return; end if;
 perform 1 from lesson_videos where id=chosen
 and (status='queued' or (status='processing' and lease_until<now() and lease_reclaim_count<3))
 for update skip locked;
 if not found then return; end if;
 return query update lesson_videos set status='processing',stage='Preparing lesson',
 lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',worker_id=p_worker,
 release_id=p_release,error=null,lease_reclaim_count=case when lesson_videos.status='processing' then lesson_videos.lease_reclaim_count+1 else lesson_videos.lease_reclaim_count end,
 updated_at=now() where id=chosen returning *;
end $$;

revoke all on function public.record_lesson_video_worker_heartbeat(text,text,boolean) from public,anon,authenticated;
revoke all on function public.admin_lesson_video_health() from public,anon;
grant execute on function public.record_lesson_video_worker_heartbeat(text,text,boolean) to service_role;
grant execute on function public.admin_lesson_video_health() to authenticated,service_role;
