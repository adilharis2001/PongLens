-- 163: let a student see the photo on an entry their coach shared.
--
-- Two separate reasons it was invisible, both deliberate when 156 shipped
-- text-first. coach_shared_entries() did not return the image at all, and
-- /api/media-url signs a journal photo only for the row's own author, so
-- even holding the path a student got "Image not found".
--
-- Both are opened here, and only for an entry that is actually shared with
-- the caller. The pin from 155 is repeated rather than referenced: a path
-- outside its author's own folder, or one carrying '..', resolves as no
-- photo. image_path is a client-written column on a row the author owns,
-- so the value can never be trusted to point where it claims.
--
-- The lesson id joins the two: the student's feed reads it from the RPC
-- and hands it back to the media route, which asks entry_image_for_viewer
-- whether this caller may see that entry's photo.

-- ---------------------------------------------------------------------------
-- entry_image_for_viewer — the author, or a student the entry is shared
-- with. Returns the author's id alongside the path so the media route can
-- repeat the folder check for itself instead of trusting this function.
-- ---------------------------------------------------------------------------
create or replace function public.entry_image_for_viewer(p_lesson_id uuid)
returns table (author_id uuid, image_path text)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.user_id,
    case
      when l.image_path like
             'r2://ponglens-media/entry/' || l.user_id || '/%'
        and position('..' in l.image_path) = 0
      then l.image_path
    end
  from public.lessons l
  where l.id = p_lesson_id
    and auth.uid() is not null
    and (
      l.user_id = auth.uid()
      or exists (
        select 1
        from public.coach_entries ce
        join public.coach_students cs on cs.id = ce.student_id
        where ce.lesson_id = l.id
          and ce.shared_at is not null
          and cs.player_id = auth.uid()
      )
    );
$$;

revoke execute on function public.entry_image_for_viewer(uuid) from public, anon;
grant execute on function public.entry_image_for_viewer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- coach_shared_entries — same read as 156, now carrying the lesson id and
-- the pinned photo path. The return type changes, so this is a drop and
-- create rather than a replace; the grant is re-issued below.
--
-- Body copied from prod's own pg_get_functiondef (2026-09-03), not from
-- 156: the live one had already moved to _name_or, and rewriting from the
-- migration file would have quietly put _display_name back.
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
  updated_at timestamptz
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
    ce.updated_at
  from public.coach_entries ce
  join public.coach_students cs on cs.id = ce.student_id
  join public.lessons l on l.id = ce.lesson_id
  where cs.player_id = auth.uid()
    and ce.shared_at is not null
  order by ce.shared_at desc;
$$;

revoke execute on function public.coach_shared_entries() from public, anon;
grant execute on function public.coach_shared_entries() to authenticated;
