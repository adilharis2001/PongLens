-- Restore how a published recap is shared.
--
-- 20260909120000 rebuilt publish_lesson_video from an older copy of the
-- function than the one live at the time, and 20260911120000 carried that
-- copy forward. Two rules from 20260907133605 were lost with it:
--
-- 1. A player's recap names who taught it (lesson_videos.coach_ref_id), and
--    the journal entry it creates has to name them too. The insert stopped
--    copying coach_ref_id, and lessons_coach_normalise clears
--    shared_with_coach_at on any row without one, so the share switch
--    wrote, was wiped, and snapped back off with no error.
-- 2. A coach's recap goes to the student the moment it is published.
--    Publishing IS the share there, and neither app sends p_share for it,
--    so gating coach_entries on p_share meant coach recaps never reached
--    the student page.
--
-- Kept from the later versions: the clean playback file is what must exist
-- (20260909120000), and the entry carries the lesson goals and things to
-- work on around the themes (20260911120000).

create or replace function public.publish_lesson_video(
  p_id uuid, p_owner uuid, p_share boolean default false
)
 returns lesson_videos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v lesson_videos;
  lid uuid;
  note text;
  entry_takeaways jsonb;
begin
  select * into v from lesson_videos where id = p_id and owner_id = p_owner for update;
  if v.id is null then raise exception 'Lesson video not found'; end if;

  if v.status = 'ready' then
    -- Already published. With a student this is a re-share after the coach
    -- took the entry back from the student page; with a coach it is the
    -- player changing their mind. A private lesson has nothing to do.
    if v.lesson_id is not null then
      if v.student_id is not null then
        if not exists (
          select 1 from coach_students
           where id = v.student_id and coach_id = p_owner and archived_at is null
        ) then raise exception 'This student is no longer on your roster'; end if;
        insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
        values (p_owner, v.student_id, v.lesson_id, now())
        on conflict (lesson_id) do update set shared_at = now();
      elsif v.coach_ref_id is not null and p_share then
        if not exists (
          select 1 from player_coaches
           where id = v.coach_ref_id and player_id = p_owner and archived_at is null
        ) then raise exception 'This coach is no longer on your list'; end if;
        -- An entry saved before this fix may not name the coach yet.
        update lessons
           set coach_ref_id = v.coach_ref_id,
               shared_with_coach_at = coalesce(shared_with_coach_at, now())
         where id = v.lesson_id and user_id = p_owner;
      end if;
    end if;
    return v;
  end if;

  if v.status <> 'review' or v.playback_key is null or v.edit is null then
    raise exception 'Review the finished recap first';
  end if;
  if v.student_id is not null and not exists (
    select 1 from coach_students
     where id = v.student_id and coach_id = p_owner and archived_at is null
  ) then raise exception 'This student is no longer on your roster'; end if;
  if v.coach_ref_id is not null and not exists (
    select 1 from player_coaches
     where id = v.coach_ref_id and player_id = p_owner and archived_at is null
  ) then raise exception 'This coach is no longer on your list'; end if;

  -- Kept for the app versions that still read the link out of the text.
  note := 'Video lesson: https://ponglens.com/lesson-video/' || v.id::text;
  if not coalesce(v.edit->'themes', '[]'::jsonb) @> '[{"name":"Lesson video"}]'::jsonb then
    v.edit = jsonb_set(
      v.edit, '{themes}',
      coalesce(v.edit->'themes', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('name', 'Lesson video', 'points', jsonb_build_array(note)))
    );
  end if;

  entry_takeaways := jsonb_build_object(
    'title', v.edit->>'title',
    'themes',
      case when jsonb_array_length(coalesce(v.edit->'goals', '[]'::jsonb)) > 0
        then jsonb_build_array(jsonb_build_object('name', 'Lesson goals', 'points', v.edit->'goals'))
        else '[]'::jsonb end
      || coalesce(v.edit->'themes', '[]'::jsonb)
      || case when jsonb_array_length(coalesce(v.edit->'work_on', '[]'::jsonb)) > 0
        then jsonb_build_array(jsonb_build_object('name', 'Things to work on', 'points', v.edit->'work_on'))
        else '[]'::jsonb end
  );

  lid := v.lesson_id;
  if lid is null then
    insert into lessons (
      user_id, transcript, takeaways, status, kind,
      coach_ref_id, lesson_video_id, shared_with_coach_at
    )
    values (
      p_owner, note, entry_takeaways, 'ready',
      case when v.student_id is null then 'lesson' else 'coach' end,
      v.coach_ref_id,
      v.id,
      case when v.coach_ref_id is not null and p_share then now() end
    )
    returning id into lid;
  else
    update lessons
       set takeaways = entry_takeaways,
           lesson_video_id = v.id,
           coach_ref_id = coalesce(coach_ref_id, v.coach_ref_id),
           shared_with_coach_at = case
             when v.coach_ref_id is null then shared_with_coach_at
             when p_share then coalesce(shared_with_coach_at, now())
             else null
           end
     where id = lid and user_id = p_owner;
  end if;

  if v.student_id is not null then
    insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
    values (p_owner, v.student_id, lid, now())
    on conflict (lesson_id) do update set shared_at = now();
  end if;

  update lesson_videos
     set status = 'ready', stage = null, lesson_id = lid, edit = v.edit, updated_at = now()
   where id = p_id
  returning * into v;
  return v;
end $function$;

revoke all on function public.publish_lesson_video(uuid, uuid, boolean) from public;
grant execute on function public.publish_lesson_video(uuid, uuid, boolean) to service_role;
