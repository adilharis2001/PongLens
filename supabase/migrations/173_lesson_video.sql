-- Independent long lesson imports. Media lives under lesson-video/ permanently.
create table public.lesson_videos (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid references public.coach_students(id) on delete set null,
 lesson_id uuid references public.lessons(id) on delete set null,
 original_name text not null,
 file_size bigint not null check(file_size>0 and file_size<=21474836480),
 duration_s double precision not null check(duration_s>0 and duration_s<=10800),
 source_key text not null unique,
 upload_id text,
 summary_key text,
 playback_key text,
 status text not null default 'uploading' check(status in ('uploading','queued','processing','review','ready','failed')),
 stage text,
 error text,
 transcript jsonb,
 edit jsonb,
 revision integer not null default 1,
 lease_token uuid,
 lease_until timestamptz,
 worker_id text,
 release_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index lesson_videos_owner on public.lesson_videos(owner_id,created_at desc);
create index lesson_videos_queue on public.lesson_videos(status,created_at);
alter table public.lesson_videos enable row level security;
create policy "Owners read lesson videos" on public.lesson_videos for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.lesson_videos from anon,authenticated;
grant select on public.lesson_videos to authenticated;
grant all on public.lesson_videos to service_role;

create table public.lesson_video_release (
 id boolean primary key default true check(id),
 release_id text not null,
 enabled boolean not null default false,
 cloud_enabled boolean not null default false
);
alter table public.lesson_video_release enable row level security;
revoke all on public.lesson_video_release from anon,authenticated;
grant all on public.lesson_video_release to service_role;

create function public.claim_lesson_video(p_release text,p_worker text,p_cloud boolean default false)
returns setof public.lesson_videos language plpgsql security definer set search_path=public as $$
declare chosen uuid;
begin
 if not exists(select 1 from lesson_video_release where enabled and release_id=p_release and (not p_cloud or cloud_enabled)) then return; end if;
 select id into chosen from lesson_videos where status='queued' or (status='processing' and lease_until<now()) order by created_at for update skip locked limit 1;
 if chosen is null then return; end if;
 return query update lesson_videos set status='processing',stage='Preparing lesson',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',worker_id=p_worker,release_id=p_release,error=null,updated_at=now() where id=chosen returning *;
end $$;
revoke all on function public.claim_lesson_video(text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_lesson_video(text,text,boolean) to service_role;

-- Atomic publication into the established coaching journal. Only the API service
-- may call this after authenticating the owner. Review status is a hard gate.
create function public.publish_lesson_video(p_id uuid,p_owner uuid)
returns public.lesson_videos language plpgsql security definer set search_path=public as $$
declare v lesson_videos; lid uuid; note text; shared_time timestamptz;
begin
 select * into v from lesson_videos where id=p_id and owner_id=p_owner for update;
 if v.id is null then raise exception 'Not found'; end if;
 if v.status='ready' then return v; end if;
 if v.status<>'review' or v.summary_key is null or v.edit is null then raise exception 'Review the finished recap first'; end if;
 if v.student_id is not null and not exists(select 1 from coach_students where id=v.student_id and coach_id=p_owner and archived_at is null) then raise exception 'This student is no longer on your roster'; end if;
 note := 'Video lesson: https://ponglens.com/lesson-video/' || v.id::text;
 -- Include the link in a takeaway so all current journal renderers expose it.
 if not coalesce(v.edit->'themes','[]'::jsonb) @> '[{"name":"Lesson video"}]'::jsonb then
  v.edit=jsonb_set(v.edit,'{themes}',coalesce(v.edit->'themes','[]'::jsonb)||jsonb_build_array(jsonb_build_object('name','Lesson video','points',jsonb_build_array(note))));
 end if;
 lid=v.lesson_id;
 if lid is null then
  insert into lessons(user_id,transcript,takeaways,status,kind) values(p_owner,note,jsonb_build_object('title',v.edit->>'title','themes',v.edit->'themes'),'ready',case when v.student_id is null then 'lesson' else 'coach' end) returning id into lid;
 else
  update lessons set takeaways=jsonb_build_object('title',v.edit->>'title','themes',v.edit->'themes') where id=lid and user_id=p_owner;
 end if;
 if v.student_id is not null then
  insert into coach_entries(coach_id,student_id,lesson_id,shared_at) values(p_owner,v.student_id,lid,now()) on conflict(lesson_id) do update set shared_at=now();
 end if;
 update lesson_videos set status='ready',stage=null,lesson_id=lid,edit=v.edit,updated_at=now() where id=p_id returning * into v;
 return v;
end $$;
revoke all on function public.publish_lesson_video(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_lesson_video(uuid,uuid) to service_role;
