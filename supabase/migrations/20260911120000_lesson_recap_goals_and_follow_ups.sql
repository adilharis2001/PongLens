-- A recap now opens on what the lesson was for and closes on what to take
-- away. Both lists travel with it: into the journal entry the student reads,
-- and out to anyone holding a public link.
--
-- In the journal they become two ordinary headings, first and last, because a
-- journal entry is a title and a list of headings and both editors already
-- add, correct and delete points inside one. A new shape would have meant
-- teaching every one of those surfaces a field it does not need.

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
    if p_share then
      if v.lesson_id is not null then
        if v.student_id is not null then
          insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
          values (p_owner, v.student_id, v.lesson_id, now())
          on conflict (lesson_id) do update set shared_at = now();
        else
          update lessons set shared_with_coach_at = now() where id = v.lesson_id and user_id = p_owner;
        end if;
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

  note := nullif(btrim(coalesce(v.edit->>'title', '')), '');

  if not coalesce(v.edit->'themes', '[]'::jsonb) @> '[{"name":"Lesson video"}]'::jsonb then
    update lesson_videos set edit = jsonb_set(
      v.edit, '{themes}',
      coalesce(v.edit->'themes', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'name', 'Lesson video',
             'points', jsonb_build_array('Video lesson: https://ponglens.com/lesson-video/' || v.id::text)))
    ) where id = v.id returning * into v;
  end if;

  -- Goals first, follow-ups last, the same order they bracket the video.
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
    insert into lessons (user_id, transcript, takeaways, status, kind, lesson_video_id)
    values (p_owner, note, entry_takeaways, 'ready',
      case when v.student_id is null then 'lesson' else 'coach' end, v.id)
    returning id into lid;
  else
    update lessons
       set takeaways = entry_takeaways, lesson_video_id = v.id
     where id = lid and user_id = p_owner;
  end if;

  if p_share then
    if v.student_id is not null then
      insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
      values (p_owner, v.student_id, lid, now())
      on conflict (lesson_id) do update set shared_at = now();
    else
      update lessons set shared_with_coach_at = now() where id = lid and user_id = p_owner;
    end if;
  end if;

  update lesson_videos set status = 'ready', lesson_id = lid, updated_at = now()
   where id = v.id returning * into v;
  return v;
end;
$function$;

revoke all on function public.publish_lesson_video(uuid, uuid, boolean) from public;
grant execute on function public.publish_lesson_video(uuid, uuid, boolean) to service_role;

-- The public page draws the same two cards as text above and below the
-- chapters. Still no themes: the written lesson notes are the fuller private
-- record and stay inside PongLens. The return shape changes, so the old one
-- goes first.
drop function if exists public.resolve_share_lesson_recap(text);

create function public.resolve_share_lesson_recap(p_token text)
returns table (
  lesson_video_id uuid,
  title text,
  owner_name text,
  chapters jsonb,
  goals jsonb,
  work_on jsonb,
  playback_key text,
  poster_key text,
  download_key text,
  download_bytes bigint
)
language sql stable security definer set search_path = public
as $$
  select
    v.id,
    nullif(btrim(coalesce(v.edit->>'title', '')), ''),
    (select nullif(btrim(coalesce(
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'name', '')), '')
     from auth.users u where u.id = v.owner_id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', c->>'title',
        'cues', coalesce(c->'cues', '[]'::jsonb),
        'summary_start_s', c->'summary_start_s',
        'summary_end_s', c->'summary_end_s'
      ) order by ord)
      from jsonb_array_elements(coalesce(v.edit->'chapters', '[]'::jsonb)) with ordinality as t(c, ord)
    ), '[]'::jsonb),
    coalesce(v.edit->'goals', '[]'::jsonb),
    coalesce(v.edit->'work_on', '[]'::jsonb),
    v.playback_key,
    regexp_replace(v.playback_key, '\.mp4$', '.jpg'),
    case when r.status = 'ready' and r.revision = v.revision then r.r2_key end,
    case when r.status = 'ready' and r.revision = v.revision then r.bytes end
  from public.share_links sl
  join public.lesson_videos v on v.id = sl.lesson_video_id
  left join public.lesson_share_renders r on r.lesson_video_id = v.id
  where sl.token = p_token
    and sl.kind = 'lesson_recap'
    and sl.revoked_at is null
    and v.edit is not null
    and v.playback_key is not null
    and coalesce(v.stage, '') <> 'Deleting';
$$;

revoke execute on function public.resolve_share_lesson_recap(text) from public;
grant execute on function public.resolve_share_lesson_recap(text) to anon, authenticated;
