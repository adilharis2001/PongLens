-- 168 — when a coach removes a student, the entries stop BOTH ways, and
-- a coach you no longer have stops looking like one you do.
--
-- Adil, 2026-09-04: "Colby Gordon, the coach on his side, just deleted
-- the student, but on the student side, the residual links still exist."
--
-- Two findings, one of them worse than the one he could see.
--
-- 1. THE LEAK HE COULD NOT SEE. remove_student archives the roster row
--    and revokes the links, and 165's trigger correctly stops the coach
--    reading the student's shared journal entries (verified: zero). But
--    coach_shared_entries() — the other direction, what the COACH shared
--    with the STUDENT — joins coach_students without looking at
--    archived_at. So a coach who removes a student keeps feeding them
--    their entries forever. entry_image_for_viewer had the same join and
--    the same hole, so the photos kept resolving too.
--
--    This is exactly the bug 157 fixed for leave_coach ("a plain status
--    flip left the entries flowing"), arriving on the coach's side of the
--    same door. Archiving is the coach's way of saying stop.
--
-- 2. WHAT HE COULD SEE. The player's coach list still showed Colby as an
--    ordinary coach. The row is right to survive — the lessons WERE with
--    him, and a coach tidying their own roster must not reach into
--    somebody else's journal and erase who taught them — but it should
--    not read as a live relationship either. player_coaches_list now
--    answers 'past' for a coach whose account is known and whose links
--    are all gone, so every picker can say so and none of them offer to
--    share with someone who cannot receive it.

-- ---------------------------------------------------------------------------
-- coach_shared_entries — prod's live body (2026-09-04) plus the archive
-- check. Return shape unchanged, so this is a replace.
-- ---------------------------------------------------------------------------
create or replace function public.coach_shared_entries()
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
    -- The coach removed them. Archiving is how a coach says stop, and it
    -- has to stop the entries as well as the roster row.
    and cs.archived_at is null
    and ce.shared_at is not null
  order by ce.shared_at desc;
$$;

revoke execute on function public.coach_shared_entries() from public, anon;
grant execute on function public.coach_shared_entries() to authenticated;

-- ---------------------------------------------------------------------------
-- entry_image_for_viewer — same join, same hole. Without this a removed
-- student who kept a lesson id could still have its photo signed.
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
          and cs.archived_at is null
      )
      or exists (
        select 1
        from public.player_coaches pc
        where pc.id = l.coach_ref_id
          and pc.coach_id = auth.uid()
          and pc.archived_at is null
          and l.shared_with_coach_at is not null
          and exists (
            select 1 from public.coach_links cl
            where cl.player_id = pc.player_id
              and cl.coach_id = pc.coach_id
              and cl.status = 'accepted'
          )
      )
    );
$$;

revoke execute on function public.entry_image_for_viewer(uuid) from public, anon;
grant execute on function public.entry_image_for_viewer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- player_coaches_list — 'past' for a coach you were connected to and are
-- not any more.
--
-- Deliberately NOT the same as 'offline'. Offline is a coach you typed
-- who is not on PongLens, and may be invited later; past is a
-- relationship that ended, on either side. The row survives because the
-- lessons did — a coach clearing their own roster does not get to delete
-- who taught somebody — but nothing should offer to share with them.
-- ---------------------------------------------------------------------------
create or replace function public.player_coaches_list()
returns table (
  id            uuid,
  coach_id      uuid,
  display_name  text,
  coach_email   text,
  invite_id     uuid,
  status        text,
  entry_count   bigint,
  shared_count  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pc.id,
    pc.coach_id,
    pc.display_name,
    u.email::text,
    pc.invite_id,
    case
      when exists (
        select 1 from public.coach_links cl
        where cl.player_id = pc.player_id
          and cl.coach_id = pc.coach_id
          and cl.status = 'accepted'
      ) then 'connected'
      when exists (
        select 1 from public.coach_links cl
        where cl.id = pc.invite_id
          and cl.status = 'pending'
      ) then 'invited'
      when pc.coach_id is not null then 'past'
      else 'offline'
    end,
    (select count(*) from public.lessons l where l.coach_ref_id = pc.id),
    (select count(*) from public.lessons l
      where l.coach_ref_id = pc.id and l.shared_with_coach_at is not null)
  from public.player_coaches pc
  left join auth.users u on u.id = pc.coach_id
  where pc.player_id = auth.uid()
    and pc.archived_at is null
  order by pc.created_at desc;
$$;

revoke execute on function public.player_coaches_list() from public, anon;
grant execute on function public.player_coaches_list() to authenticated;
