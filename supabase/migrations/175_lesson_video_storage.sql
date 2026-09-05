-- Complete upload and account for retained original exactly once, even when
-- several clients retry the last request after losing its response.
create function public.complete_lesson_video(p_id uuid,p_owner uuid,p_bytes bigint)
returns public.lesson_videos language plpgsql security definer set search_path=public as $$
declare v lesson_videos;
begin
 select * into v from lesson_videos where id=p_id and owner_id=p_owner for update;
 if v.id is null then raise exception 'Not found'; end if;
 if v.file_size<>p_bytes then raise exception 'Video size mismatch'; end if;
 if v.status<>'uploading' then return v; end if;
 insert into storage_ledger(user_id,kind,bytes,r2_key) values(p_owner,'other',p_bytes,'r2://ponglens-media/'||v.source_key);
 update lesson_videos set status='queued',stage='Waiting to process',upload_id=null,updated_at=now() where id=p_id returning * into v;
 return v;
end $$;
revoke all on function public.complete_lesson_video(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.complete_lesson_video(uuid,uuid,bigint) to service_role;
