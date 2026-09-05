-- Durable cleanup survives auth.users deletion and a worker finishing an upload
-- after the account's first R2 sweep. No FK: the marker must outlive the owner.
create table public.lesson_video_deletions (
 owner_id uuid primary key,
 created_at timestamptz not null default now(),
 account_gone_at timestamptz,
 last_swept_at timestamptz,
 sweep_count integer not null default 0
);
alter table public.lesson_video_deletions enable row level security;
revoke all on public.lesson_video_deletions from public,anon,authenticated;
grant all on public.lesson_video_deletions to service_role;

create function public.begin_lesson_video_account_deletion(p_owner uuid)
returns table(source_key text,upload_id text)
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('lesson-video-delete:'||p_owner::text,0));
 insert into lesson_video_deletions(owner_id) values(p_owner) on conflict(owner_id) do nothing;
 update lesson_videos set status='failed',stage='Deleting',lease_token=null,
   lease_until=null,revision=revision+1,updated_at=now()
 where owner_id=p_owner and stage is distinct from 'Deleting';
 return query select v.source_key,v.upload_id from lesson_videos v
 where v.owner_id=p_owner and v.upload_id is not null;
end $$;

-- A create that began before deletion must either finish before the marker or
-- fail its INSERT (the API then aborts its newly created multipart upload).
create function public.guard_lesson_video_account_deletion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('lesson-video-delete:'||new.owner_id::text,0));
 if exists(select 1 from lesson_video_deletions where owner_id=new.owner_id) then
  raise exception 'This account is being deleted' using errcode='55000';
 end if;
 return new;
end $$;
create trigger lesson_video_owner_not_deleting before insert on public.lesson_videos
for each row execute function public.guard_lesson_video_account_deletion();

-- Use the same owner lock BEFORE locking a job row, avoiding a lock-order
-- inversion with account cancellation. Recheck after waiting for that lock.
create or replace function public.claim_lesson_video(p_release text,p_worker text,p_cloud boolean default false)
returns setof public.lesson_videos language plpgsql security definer set search_path=public as $$
declare chosen uuid; chosen_owner uuid;
begin
 if not exists(select 1 from lesson_video_release where enabled and release_id=p_release and (not p_cloud or cloud_enabled)) then return; end if;
 select v.id,v.owner_id into chosen,chosen_owner from lesson_videos v
 where (v.status='queued' or (v.status='processing' and v.lease_until<now()))
 and not exists(select 1 from lesson_video_deletions d where d.owner_id=v.owner_id)
 order by v.created_at limit 1;
 if chosen is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('lesson-video-delete:'||chosen_owner::text,0));
 if exists(select 1 from lesson_video_deletions where owner_id=chosen_owner) then return; end if;
 perform 1 from lesson_videos where id=chosen
 and (status='queued' or (status='processing' and lease_until<now()))
 for update skip locked;
 if not found then return; end if;
 return query update lesson_videos set status='processing',stage='Preparing lesson',
 lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',worker_id=p_worker,
 release_id=p_release,error=null,updated_at=now() where id=chosen returning *;
end $$;

-- True is affirmative deletion evidence. A failed network request is never
-- interpreted by the worker as permission to delete a possibly published clip.
create function public.lesson_video_attempt_cancelled(p_owner uuid,p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from lesson_video_deletions where owner_id=p_owner)
 or not exists(select 1 from auth.users where id=p_owner)
 or not exists(select 1 from lesson_videos where id=p_id and owner_id=p_owner)
 or exists(select 1 from lesson_videos where id=p_id and owner_id=p_owner and stage='Deleting');
$$;

create function public.lesson_video_deletion_targets()
returns setof public.lesson_video_deletions language sql stable security definer set search_path=public as $$
 select * from lesson_video_deletions
 where last_swept_at is null or last_swept_at<now()-interval '5 minutes'
 order by last_swept_at nulls first,created_at limit 20;
$$;

-- A marker is retired only AFTER a successful final sweep, at least 24 hours
-- after the account was confirmed absent. Failed account deletion keeps it.
create function public.ack_lesson_video_deletion_sweep(p_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
declare marker lesson_video_deletions; gone boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('lesson-video-delete:'||p_owner::text,0));
 select * into marker from lesson_video_deletions where owner_id=p_owner for update;
 if not found then return; end if;
 gone := not exists(select 1 from auth.users where id=p_owner);
 if gone and marker.account_gone_at is not null and marker.account_gone_at<=now()-interval '24 hours' and marker.sweep_count>=1 then
  delete from lesson_video_deletions where owner_id=p_owner;
 else
  update lesson_video_deletions set last_swept_at=now(),sweep_count=sweep_count+1,
    account_gone_at=case when gone then coalesce(account_gone_at,now()) else null end
  where owner_id=p_owner;
 end if;
end $$;

revoke all on function public.begin_lesson_video_account_deletion(uuid) from public,anon,authenticated;
revoke all on function public.guard_lesson_video_account_deletion() from public,anon,authenticated;
revoke all on function public.claim_lesson_video(text,text,boolean) from public,anon,authenticated;
revoke all on function public.lesson_video_attempt_cancelled(uuid,uuid) from public,anon,authenticated;
revoke all on function public.lesson_video_deletion_targets() from public,anon,authenticated;
revoke all on function public.ack_lesson_video_deletion_sweep(uuid) from public,anon,authenticated;
grant execute on function public.begin_lesson_video_account_deletion(uuid) to service_role;
grant execute on function public.claim_lesson_video(text,text,boolean) to service_role;
grant execute on function public.lesson_video_attempt_cancelled(uuid,uuid) to service_role;
grant execute on function public.lesson_video_deletion_targets() to service_role;
grant execute on function public.ack_lesson_video_deletion_sweep(uuid) to service_role;
