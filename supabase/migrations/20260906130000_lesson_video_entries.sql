-- 20260906130000: a shared lesson video is a journal entry with a video
-- behind it, and every renderer needs to know that without fishing a URL
-- out of a bullet point.
--
-- publish_lesson_video (173) wrote the recap into the student's journal as
-- an ordinary coach entry whose whole body was "Video lesson: https://…",
-- once as the transcript and once as a takeaway, so the student saw the
-- same link twice and nothing else: no picture, no chapters, nothing that
-- said video. This adds the link the renderers were missing,
-- lessons.lesson_video_id, and back-fills it for the recaps already
-- shared. The URL stays in the row on purpose: the app versions already on
-- phones still read it, and a new renderer simply hides it.
--
-- Two more things the same function fixes:
--   * Sharing again after the coach took the entry back. The old function
--     returned early on a ready row, so an unshared recap could never be
--     shared from its own page.
--   * The notification. It said "shared a lesson note" with the URL as its
--     body and sent the student to /journal; a recap now says so and opens
--     the recap.

alter table public.lessons
  add column if not exists lesson_video_id uuid
    references public.lesson_videos (id) on delete set null;

create index if not exists lessons_lesson_video_id_idx
  on public.lessons (lesson_video_id)
  where lesson_video_id is not null;

update public.lessons l
   set lesson_video_id = v.id
  from public.lesson_videos v
 where v.lesson_id = l.id
   and l.lesson_video_id is distinct from v.id;

-- ---------------------------------------------------------------------------
-- publish_lesson_video: the same gates as 173, plus the link, plus re-share.
-- ---------------------------------------------------------------------------
create or replace function public.publish_lesson_video(p_id uuid, p_owner uuid)
returns public.lesson_videos
language plpgsql
security definer
set search_path = public
as $$
declare
  v lesson_videos;
  lid uuid;
  note text;
begin
  select * into v from lesson_videos where id = p_id and owner_id = p_owner for update;
  if v.id is null then raise exception 'Not found'; end if;

  if v.status = 'ready' then
    -- Already published. With a student this is a re-share after the coach
    -- took the entry back from the student page; a private lesson has
    -- nothing left to do.
    if v.student_id is not null and v.lesson_id is not null then
      if not exists (
        select 1 from coach_students
         where id = v.student_id and coach_id = p_owner and archived_at is null
      ) then raise exception 'This student is no longer on your roster'; end if;
      insert into coach_entries (coach_id, student_id, lesson_id, shared_at)
      values (p_owner, v.student_id, v.lesson_id, now())
      on conflict (lesson_id) do update set shared_at = now();
    end if;
    return v;
  end if;

  if v.status <> 'review' or v.summary_key is null or v.edit is null then
    raise exception 'Review the finished recap first';
  end if;
  if v.student_id is not null and not exists (
    select 1 from coach_students
     where id = v.student_id and coach_id = p_owner and archived_at is null
  ) then raise exception 'This student is no longer on your roster'; end if;

  -- Kept for the app versions that still read the link out of the text.
  note := 'Video lesson: https://ponglens.com/lesson-video/' || v.id::text;
  if not coalesce(v.edit->'themes', '[]'::jsonb) @> '[{"name":"Lesson video"}]'::jsonb then
    v.edit = jsonb_set(
      v.edit, '{themes}',
      coalesce(v.edit->'themes', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('name', 'Lesson video', 'points', jsonb_build_array(note)))
    );
  end if;

  lid = v.lesson_id;
  if lid is null then
    insert into lessons (user_id, transcript, takeaways, status, kind, lesson_video_id)
    values (
      p_owner, note,
      jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
      'ready',
      case when v.student_id is null then 'lesson' else 'coach' end,
      v.id
    )
    returning id into lid;
  else
    update lessons
       set takeaways = jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
           lesson_video_id = v.id
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
end $$;

revoke all on function public.publish_lesson_video(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_lesson_video(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- coach_shared_entries: 168's body with lesson_video_id on the end. The
-- return shape changes, so it is dropped and created rather than replaced.
-- ---------------------------------------------------------------------------
drop function if exists public.coach_shared_entries();

create function public.coach_shared_entries()
returns table (
  entry_id uuid,
  lesson_id uuid,
  coach_id uuid,
  coach_name text,
  transcript text,
  takeaways jsonb,
  entry_kind text,
  image_path text,
  match_id uuid,
  shared_at timestamptz,
  updated_at timestamptz,
  lesson_video_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ce.id,
    ce.lesson_id,
    ce.coach_id,
    coalesce((
      select public._name_or(u.*, 'Your coach')
      from auth.users u where u.id = ce.coach_id), 'Your coach'),
    l.transcript,
    l.takeaways,
    l.kind,
    case
      when l.image_path like
             'r2://ponglens-media/entry/' || l.user_id || '/%'
        and position('..' in l.image_path) = 0
      then l.image_path
    end,
    l.match_id,
    ce.shared_at,
    ce.updated_at,
    l.lesson_video_id
  from public.coach_entries ce
  join public.coach_students cs on cs.id = ce.student_id
  join public.lessons l on l.id = ce.lesson_id
  where cs.player_id = auth.uid()
    and cs.archived_at is null
    and ce.shared_at is not null
  order by ce.shared_at desc;
$$;

revoke execute on function public.coach_shared_entries() from public, anon;
grant execute on function public.coach_shared_entries() to authenticated;

-- ---------------------------------------------------------------------------
-- coach_entries_notify: a recap says it is one, and opens as one.
-- ---------------------------------------------------------------------------
create or replace function public.coach_entries_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student  public.coach_students%rowtype;
  v_actor    text;
  v_snippet  text;
  v_title    text;
  v_video    uuid;
begin
  if new.shared_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.shared_at is not null then
    return new;
  end if;

  select * into v_student
    from public.coach_students where id = new.student_id;
  if not found or v_student.player_id is null then
    return new;
  end if;

  select public._name_or(u.*, 'Your coach') into v_actor
    from auth.users u where u.id = new.coach_id;
  v_actor := coalesce(v_actor, 'Your coach');

  select l.lesson_video_id,
         nullif(btrim(l.takeaways->>'title'), ''),
         nullif(btrim(regexp_replace(coalesce(l.transcript, ''), '\s+', ' ', 'g')), '')
    into v_video, v_title, v_snippet
    from public.lessons l where l.id = new.lesson_id;

  if v_video is not null then
    insert into public.notifications
      (user_id, kind, actor_id, title, body, href)
    values (v_student.player_id, 'coach_entry', new.coach_id,
            v_actor || ' shared a lesson recap',
            coalesce(left(v_title, 140), 'Lesson recap'),
            '/lesson-video/' || v_video::text);
  else
    insert into public.notifications
      (user_id, kind, actor_id, title, body, href)
    values (v_student.player_id, 'coach_entry', new.coach_id,
            v_actor || ' shared a lesson note',
            coalesce(left(v_snippet, 140), 'Lesson note'),
            '/journal');
  end if;

  return new;
end;
$$;
