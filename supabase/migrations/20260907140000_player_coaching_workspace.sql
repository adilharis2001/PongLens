-- Player coaching workspace.
--
-- A player now records lessons of their own — written, spoken or filmed —
-- and shares them with a coach. Everything here follows from that:
--
--   * a lesson video names EITHER the student it was made for (a coach
--     importing) or the coach it was made with (a player importing);
--   * one function answers who may read a recap, in both directions;
--   * publishing a player's recap writes their own journal entry and
--     shares it only when they said so;
--   * the coach gets a bell when a student shares any lesson;
--   * a lesson video's original counts against the player's storage,
--     which it never did, so an import could not be refused;
--   * and `kind` stops being derived from whether a coach is attached.

-- 1. Which side of the relationship a lesson video belongs to.
--
-- Nullable both ways: a private lesson names neither, exactly as a coach's
-- private import does today. Never both, which the check enforces.
alter table public.lesson_videos
  add column if not exists coach_ref_id uuid
    references public.player_coaches (id) on delete set null;

alter table public.lesson_videos
  drop constraint if exists lesson_videos_one_direction;
alter table public.lesson_videos
  add constraint lesson_videos_one_direction
    check (student_id is null or coach_ref_id is null);

create index if not exists lesson_videos_coach_ref_id_idx
  on public.lesson_videos (coach_ref_id)
  where coach_ref_id is not null;

-- Merging two coaches already moved the player's entries. It has to move
-- their recordings too, or the `on delete set null` above quietly drops
-- the attribution when the duplicate row goes.
create or replace function public.merge_player_coaches(p_into uuid, p_from uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me   uuid := auth.uid();
  v_into public.player_coaches%rowtype;
  v_from public.player_coaches%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_into = p_from then
    raise exception 'same coach';
  end if;

  select * into v_into from public.player_coaches
   where id = p_into and player_id = v_me and archived_at is null;
  if not found then
    raise exception 'coach not found';
  end if;
  select * into v_from from public.player_coaches
   where id = p_from and player_id = v_me and archived_at is null;
  if not found then
    raise exception 'coach not found';
  end if;
  if v_into.coach_id is not null and v_from.coach_id is not null then
    raise exception 'both are connected accounts';
  end if;

  update public.lessons set coach_ref_id = p_into where coach_ref_id = p_from;
  update public.lesson_videos set coach_ref_id = p_into where coach_ref_id = p_from;

  update public.player_coaches
     set coach_id  = coalesce(v_into.coach_id, v_from.coach_id),
         invite_id = coalesce(v_into.invite_id, v_from.invite_id)
   where id = p_into;

  delete from public.player_coaches where id = p_from;
  return p_into;
end;
$function$;

-- 2. Who may read a recap: owner, the coach a player shared it with, or
-- the student a coach shared it with. One place, both directions, so the
-- API stops asking the question two different ways.
--
-- The coach's claim needs BOTH the entry shared AND the link still
-- accepted — the two conditions `student_shared_lessons()` applies, and
-- the reason leaving a coach cuts them off from what was already shared.
create or replace function public.lesson_video_access(p_video_id uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select case
    when v.owner_id = auth.uid() then 'owner'
    when exists (
      select 1
        from public.lessons l
        join public.player_coaches pc on pc.id = l.coach_ref_id
       where l.lesson_video_id = v.id
         and l.user_id = v.owner_id
         and l.shared_with_coach_at is not null
         and pc.coach_id = auth.uid()
         and pc.archived_at is null
         and exists (
           select 1 from public.coach_links cl
            where cl.player_id = pc.player_id
              and cl.coach_id = pc.coach_id
              and cl.status = 'accepted')
    ) then 'coach'
    when v.lesson_id is not null and exists (
      select 1
        from public.coach_entries ce
        join public.coach_students cs on cs.id = ce.student_id
       where ce.lesson_id = v.lesson_id
         and ce.shared_at is not null
         and cs.player_id = auth.uid()
         and cs.archived_at is null
    ) then 'student'
  end
  from public.lesson_videos v
  where v.id = p_video_id;
$function$;

grant execute on function public.lesson_video_access(uuid) to authenticated, service_role;

-- 3. Publishing, for both directions.
--
-- The extra argument is the player's answer to "share this with them?",
-- asked every time and off by default. A coach's import ignores it: the
-- coach's act of publishing IS the share, as it always was.
drop function if exists public.publish_lesson_video(uuid, uuid);

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
begin
  select * into v from lesson_videos where id = p_id and owner_id = p_owner for update;
  if v.id is null then raise exception 'Not found'; end if;

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
        update lessons
           set shared_with_coach_at = coalesce(shared_with_coach_at, now())
         where id = v.lesson_id and user_id = p_owner;
      end if;
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
  if v.coach_ref_id is not null and not exists (
    select 1 from player_coaches
     where id = v.coach_ref_id and player_id = p_owner and archived_at is null
  ) then raise exception 'That coach is no longer on your list'; end if;

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
    insert into lessons (
      user_id, transcript, takeaways, status, kind,
      coach_ref_id, lesson_video_id, shared_with_coach_at
    )
    values (
      p_owner, note,
      jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
      'ready',
      case when v.student_id is null then 'lesson' else 'coach' end,
      v.coach_ref_id,
      v.id,
      case when v.coach_ref_id is not null and p_share then now() end
    )
    returning id into lid;
  else
    update lessons
       set takeaways = jsonb_build_object('title', v.edit->>'title', 'themes', v.edit->'themes'),
           lesson_video_id = v.id,
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

grant execute on function public.publish_lesson_video(uuid, uuid, boolean) to service_role;

-- 4. The coach's view of what a student shared now carries the recap, so
-- their student page can show it as a recap rather than as a link.
drop function if exists public.student_shared_lessons();

create or replace function public.student_shared_lessons()
 returns table(
   lesson_id uuid, student_id uuid, student_name text, transcript text,
   takeaways jsonb, image_path text, match_id uuid,
   shared_at timestamp with time zone, created_at timestamp with time zone,
   lesson_video_id uuid
 )
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select
    l.id,
    l.user_id,
    coalesce((
      select public._name_or(u.*, 'Your student')
      from auth.users u where u.id = l.user_id), 'Your student'),
    l.transcript,
    l.takeaways,
    case
      when l.image_path like
             'r2://ponglens-media/entry/' || l.user_id || '/%'
        and position('..' in l.image_path) = 0
      then l.image_path
    end,
    l.match_id,
    l.shared_with_coach_at,
    l.created_at,
    l.lesson_video_id
  from public.lessons l
  join public.player_coaches pc on pc.id = l.coach_ref_id
  where pc.coach_id = auth.uid()
    and pc.archived_at is null
    and l.shared_with_coach_at is not null
    and l.kind in ('lesson', 'practice')
    and exists (
      select 1 from public.coach_links cl
      where cl.player_id = pc.player_id
        and cl.coach_id = pc.coach_id
        and cl.status = 'accepted'
    )
  order by l.shared_with_coach_at desc;
$function$;

grant execute on function public.student_shared_lessons() to authenticated, service_role;

-- 5. A shared note now opens the coaching workspace, which is where a
-- player reads their coaches. A recap still opens the recap.
create or replace function public.coach_entries_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
            '/coaching?entry=' || new.id::text);
  end if;

  return new;
end;
$function$;

-- 6. Storage. The original of an imported lesson is the player's biggest
-- file by far and was never counted, so no import could ever be refused.
-- It is counted the way a match's raw upload is; the recap, playback and
-- poster stay uncounted, the way a match's clips do. Deleting a lesson
-- already writes the reversing rows under the same keys.
create or replace function public.my_storage_state()
 returns table(
   storage_limit_bytes bigint, daily_upload_limit integer, used_bytes bigint,
   uploads_today integer, active_jobs integer, pending_request boolean,
   base_limit_bytes bigint, entitlement_bytes bigint,
   entitlement_expires_at timestamp with time zone, held_bytes bigint
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  perform public._ensure_quota(v_me);
  return query
  with ent as (
    select coalesce(sum(e.bytes), 0)::bigint as bytes,
           min(e.expires_at) as next_expiry
    from public.storage_entitlements e
    where e.user_id = v_me and e.expires_at > now()
  ),
  led as (
    select coalesce(sum(l.bytes), 0)::bigint as counted
    from public.storage_ledger l
    where l.user_id = v_me
      and (l.r2_key like 'r2://ponglens-raw/%'
           or l.kind = 'cut'
           or l.r2_key like 'r2://ponglens-media/lesson-video/%/original.%')
  ),
  held_rows as (
    select coalesce(sum(l.bytes), 0)::bigint as held
    from public.storage_ledger l
    join public.review_orders o on o.id = l.order_id
    where l.user_id = v_me
      and (l.r2_key like 'r2://ponglens-raw/%'
           or l.kind = 'cut'
           or l.r2_key like 'r2://ponglens-media/lesson-video/%/original.%')
      and o.status in ('awaiting_submission', 'submitted',
                       'in_review', 'clarification', 'delivered')
  )
  select
    q.storage_limit_bytes + ent.bytes,
    q.daily_upload_limit,
    greatest(led.counted - held_rows.held, 0),
    ((select count(*) from public.matches m
      where m.user_id = v_me and m.raw_path is not null
        and m.created_at >= date_trunc('day', now()))
     + (select count(*) from public.jobs j
        where j.user_id = v_me
          and ((j.kind = 'deadspace_cut' and j.options ->> 'match_id' is null)
               or j.kind = 'youtube_import')
          and j.created_at >= date_trunc('day', now())))::int,
    (select count(*) from public.jobs j
     where j.user_id = v_me
       and j.status in ('queued', 'processing')
       and j.kind not in ('reclip', 'content_check'))::int,
    exists (select 1 from public.quota_requests r
            where r.user_id = v_me and r.status = 'pending'),
    q.storage_limit_bytes,
    ent.bytes,
    ent.next_expiry,
    held_rows.held
  from public.user_quotas q, ent, led, held_rows
  where q.user_id = v_me;
end;
$function$;

-- 7. `kind` is where the entry was made, not whether a coach is named.
--
-- Coaching writes 'lesson', the Journal writes 'practice', a coach writes
-- 'coach'. The labels a reader sees still come from `coach_name`. This
-- fixes up the few entries that gained a coach after the rule changed on
-- 2026-09-04, so they read as lessons in the Coaches tab.
--
-- Runs before the notification trigger below is created: it is a naming
-- correction, not somebody sharing something.
update public.lessons
   set kind = 'lesson'
 where kind = 'practice'
   and (coach_ref_id is not null or coalesce(btrim(coach_name), '') <> '');

-- 8. The bell, when a student shares a lesson with their coach.
--
-- Fires for a written note, a recorded one and a recap alike, because all
-- three are one `lessons` row and sharing is one column on it.
create or replace function public.lessons_share_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_coach   uuid;
  v_player  uuid;
  v_actor   text;
  v_student uuid;
  v_href    text;
  v_title   text;
  v_body    text;
begin
  if new.shared_with_coach_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.shared_with_coach_at is not null then
    return new;
  end if;
  if new.coach_ref_id is null or new.kind = 'coach' then
    return new;
  end if;

  select pc.coach_id, pc.player_id into v_coach, v_player
    from public.player_coaches pc
   where pc.id = new.coach_ref_id and pc.archived_at is null;
  if v_coach is null then
    return new;
  end if;

  -- A coach who has not accepted, or who was revoked, cannot read it, so
  -- telling them about it would be a link to nothing.
  if not exists (
    select 1 from public.coach_links cl
     where cl.player_id = v_player
       and cl.coach_id = v_coach
       and cl.status = 'accepted'
  ) then
    return new;
  end if;

  select public._name_or(u.*, 'Your student') into v_actor
    from auth.users u where u.id = new.user_id;
  v_actor := coalesce(v_actor, 'Your student');

  select cs.id into v_student
    from public.coach_students cs
   where cs.coach_id = v_coach
     and cs.player_id = new.user_id
     and cs.archived_at is null
   limit 1;
  v_href := case
    when v_student is null then '/coaching/students'
    else '/coaching/students/' || v_student::text
  end;

  if new.lesson_video_id is not null then
    v_title := v_actor || ' shared a lesson recap';
    v_body  := coalesce(
      left(nullif(btrim(new.takeaways->>'title'), ''), 140), 'Lesson recap');
  else
    v_title := v_actor || ' shared a lesson';
    v_body  := coalesce(
      left(nullif(btrim(regexp_replace(coalesce(new.transcript, ''), '\s+', ' ', 'g')), ''), 140),
      'Lesson note');
  end if;

  insert into public.notifications
    (user_id, kind, actor_id, title, body, href)
  values (v_coach, 'student_lesson', new.user_id, v_title, v_body, v_href);

  return new;
end;
$function$;

drop trigger if exists lessons_share_notify on public.lessons;
create trigger lessons_share_notify
  after insert or update of shared_with_coach_at on public.lessons
  for each row execute function public.lessons_share_notify();
