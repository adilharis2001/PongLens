-- 164 — the coach a journal entry belongs to.
--
-- Design doc: docs/superpowers/specs/2026-09-04-coach-relationship-and-
-- journal-link-design.md. Adil's ask, 2026-09-04.
--
-- lessons.coach_name has been free text since 085, and that was right: a
-- coach is often not a PongLens user and the journal should not require
-- them to be one. What it cannot do is survive a keyboard. Adil's own
-- journal holds "Jonathan" and "Jonotan" for one person, so Ask sees two
-- coaches and neither is the account that is actually on the app.
--
-- The obvious fix — point the lesson at auth.users — fails the half of the
-- ask that matters most: a coach who has been INVITED but has not accepted
-- has coach_id null on their coach_links row, because nobody has claimed
-- it yet. There is no user id to point at.
--
-- So the player gets the mirror of what the coach already has.
-- coach_students lists students, some on PongLens and some not, with a name
-- the coach typed and a player_id that fills in later. player_coaches is
-- that table from the other side, and lessons point at it.
--
-- Function bodies below were written from prod's live definitions
-- (pg_get_functiondef, 2026-09-04), not from the migration files — the
-- live-drift rule. leave_coach and entry_image_for_viewer are both edited
-- here rather than rewritten.

-- ---------------------------------------------------------------------------
-- player_coaches — the player's own list of coaches.
--
-- coach_id null = not on PongLens, or invited and not yet accepted. That
-- nullability IS the feature; everything else follows from it.
-- ---------------------------------------------------------------------------
create table if not exists public.player_coaches (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references auth.users (id) on delete cascade,
  coach_id          uuid references auth.users (id) on delete set null,
  display_name      text not null
                    check (char_length(btrim(display_name)) between 1 and 80),
  -- The invite this row is waiting on, when the player named a coach while
  -- creating one. It is what makes binding on accept exact rather than a
  -- guess at a name.
  invite_id         uuid references public.coach_links (id) on delete set null,
  -- True when the app named the row (the sync trigger below), false the
  -- moment the player types their own. Same rule as coach_students (161).
  name_from_account boolean not null default false,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz,
  constraint player_coaches_not_self check (coach_id is distinct from player_id)
);

create index if not exists player_coaches_player_idx
  on public.player_coaches (player_id, created_at desc);

-- One live row per bound coach. Offline rows are free-form: a player may
-- reasonably have two coaches called Dave.
create unique index if not exists player_coaches_linked_uniq
  on public.player_coaches (player_id, coach_id)
  where (coach_id is not null and archived_at is null);

alter table public.player_coaches enable row level security;

-- The player owns their list outright. The coach never selects from this
-- table; what they may read comes through student_shared_lessons() below,
-- which is SECURITY DEFINER and applies its own rule.
drop policy if exists "Players manage own coaches" on public.player_coaches;
create policy "Players manage own coaches"
  on public.player_coaches for all
  to authenticated
  using (player_id = (select auth.uid()))
  with check (player_id = (select auth.uid()));

revoke all on public.player_coaches from anon;
grant select, insert, update, delete on public.player_coaches to authenticated;

-- ---------------------------------------------------------------------------
-- lessons: which coach, and whether they may read it.
--
-- shared_with_coach_at sits on the ENTRY, not on the coach, because it is a
-- decision about one entry (Adil, 2026-09-04). Null means attributed but
-- private, which is the default and the common case.
--
-- lessons grants to authenticated are table-level (checked in prod), so
-- these columns are writable by their author with no further grant. Do not
-- assume that of every table: points is column-scoped and silently 403s.
-- ---------------------------------------------------------------------------
alter table public.lessons
  add column if not exists coach_ref_id uuid
    references public.player_coaches (id) on delete set null,
  add column if not exists shared_with_coach_at timestamptz;

comment on column public.lessons.coach_ref_id is
  'The player_coaches row this entry is attributed to. coach_name is kept '
  'alongside it as the display fallback for entries with no row, and is '
  'copied from the row by lessons_coach_normalise so every existing reader '
  '(Ask, iOS, the share page) keeps working untouched.';

create index if not exists lessons_coach_ref_idx
  on public.lessons (coach_ref_id, created_at desc)
  where coach_ref_id is not null;

-- ---------------------------------------------------------------------------
-- lessons_coach_normalise — the whole rule, in one place, so that web, iOS
-- and any future writer cannot each get it half right.
--
--   1. A lesson may only point at ITS OWN author's coach row. Without this
--      a player could aim an entry at a stranger's coach and have
--      student_shared_lessons() hand it over. Checked against user_id
--      rather than through RLS, because a SECURITY DEFINER caller would
--      bypass RLS and skip the check.
--   2. Setting the row copies its name into coach_name, so the text column
--      that everything already reads stays true.
--   3. No coach means no grant. This also catches the FK's on-delete-set-
--      null, which arrives here as a plain UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.lessons_coach_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.coach_ref_id is null then
    new.shared_with_coach_at := null;
    return new;
  end if;

  select pc.display_name into v_name
    from public.player_coaches pc
   where pc.id = new.coach_ref_id
     and pc.player_id = new.user_id;

  if v_name is null then
    raise exception 'coach_ref_id must be one of your own coaches';
  end if;

  new.coach_name := v_name;
  return new;
end;
$$;

drop trigger if exists lessons_coach_normalise on public.lessons;
create trigger lessons_coach_normalise
  before insert or update on public.lessons
  for each row execute function public.lessons_coach_normalise();

-- A rename reaches every entry attributed to that coach. The player typed
-- one name for one person; the journal should not keep the old spelling on
-- the entries that predate the correction.
create or replace function public.player_coaches_rename_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_name is distinct from old.display_name then
    update public.lessons
       set coach_name = new.display_name
     where coach_ref_id = new.id
       and coach_name is distinct from new.display_name;
  end if;

  -- Archiving a coach ends what they may read. Attribution stays: you
  -- stopped working with them, you did not stop having had the lessons.
  if new.archived_at is not null and old.archived_at is null then
    update public.lessons
       set shared_with_coach_at = null
     where coach_ref_id = new.id
       and shared_with_coach_at is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists player_coaches_rename_sync on public.player_coaches;
create trigger player_coaches_rename_sync
  after update on public.player_coaches
  for each row execute function public.player_coaches_rename_sync();

-- ---------------------------------------------------------------------------
-- player_coaches_sync — an accepted link binds the player's coach row, the
-- mirror of what coach_links_roster_sync does for the coach's roster.
--
-- Binding order is exact first, then a name, then a new row:
--   1. already bound for this pair — nothing to do;
--   2. the row that named this very invite — the main path, and the only
--      one that is certain;
--   3. an unbound row whose name matches the account's, case-insensitively
--      — covers the player who wrote "Jonathan" in their journal before
--      sending him anything, and is safe because both names are inside one
--      player's own list;
--   4. otherwise a fresh row named from the account.
--
-- Duplicates are still possible (a row called "Jonathan" and an account
-- called "Jonatan Mcdonald"), which is what merge_player_coaches is for.
-- ---------------------------------------------------------------------------
create or replace function public.player_coaches_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_id   uuid;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  if exists (
    select 1 from public.player_coaches
    where player_id = new.player_id
      and coach_id = new.coach_id
      and archived_at is null
  ) then
    return new;
  end if;

  select id into v_id
    from public.player_coaches
   where player_id = new.player_id
     and coach_id is null
     and archived_at is null
     and invite_id = new.id
   limit 1;

  select public._name_or(u.*, 'Coach') into v_name
    from auth.users u where u.id = new.coach_id;
  v_name := coalesce(nullif(btrim(v_name), ''), 'Coach');

  if v_id is null then
    select id into v_id
      from public.player_coaches
     where player_id = new.player_id
       and coach_id is null
       and archived_at is null
       and lower(btrim(display_name)) = lower(btrim(v_name))
     limit 1;
  end if;

  if v_id is not null then
    update public.player_coaches
       set coach_id = new.coach_id,
           invite_id = coalesce(invite_id, new.id)
     where id = v_id;
    return new;
  end if;

  insert into public.player_coaches
    (player_id, coach_id, display_name, invite_id, name_from_account)
  values (new.player_id, new.coach_id, v_name, new.id, true)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists player_coaches_sync on public.coach_links;
create trigger player_coaches_sync
  after insert or update of status, coach_id on public.coach_links
  for each row execute function public.player_coaches_sync();

-- ---------------------------------------------------------------------------
-- merge_player_coaches — fold a row the player typed into the row an accept
-- created, or the other way round. The mirror of merge_students (161), and
-- needed for the same reason: a name typed before an account arrives will
-- not match the name on it.
--
-- The entries move, the surviving row keeps whichever name the player is
-- keeping, and the sharing state of each entry is preserved as it was.
-- ---------------------------------------------------------------------------
create or replace function public.merge_player_coaches(p_into uuid, p_from uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  -- Two bound rows are two different people; merging them would silently
  -- hand one coach the other's entries.
  if v_into.coach_id is not null and v_from.coach_id is not null then
    raise exception 'both are connected accounts';
  end if;

  update public.lessons set coach_ref_id = p_into where coach_ref_id = p_from;

  update public.player_coaches
     set coach_id  = coalesce(v_into.coach_id, v_from.coach_id),
         invite_id = coalesce(v_into.invite_id, v_from.invite_id)
   where id = p_into;

  delete from public.player_coaches where id = p_from;
  return p_into;
end;
$$;

revoke execute on function public.merge_player_coaches(uuid, uuid) from public, anon;
grant execute on function public.merge_player_coaches(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- player_coaches_list — what the journal's picker and the Coaches section
-- read. Needs auth.users for the name and the email, so it is definer.
--
-- status is derived from coach_links, never from coach_id alone: a player
-- who left their coach still has the row and the attribution, and the
-- picker must not call that "connected".
-- ---------------------------------------------------------------------------
create or replace function public.player_coaches_list()
returns table (
  id            uuid,
  coach_id      uuid,
  display_name  text,
  coach_email   text,
  -- The invite this row is waiting on, so the Coaches section can put the
  -- player's own name on a waiting invite instead of "Invite link".
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

-- ---------------------------------------------------------------------------
-- student_shared_lessons — the coach's read of what their students shared.
--
-- TWO conditions, not one. The student shared the entry, AND the coaching
-- relationship is still live. Sharing alone is not enough: a coach who
-- removes a student, or a student whose link is revoked from the other
-- side, would otherwise keep receiving journal entries. That is exactly the
-- bug 157 fixed for coach entries, arriving in a new place.
--
-- kind is pinned to the player's own two: a dual-role user's 'coach'
-- entries are about their own students and must never travel this way.
-- The photo repeats the 155 pin rather than referencing it (see 163):
-- image_path is client-written on a row its author owns, so a path outside
-- the author's own folder, or one carrying '..', resolves as no photo.
-- ---------------------------------------------------------------------------
create or replace function public.student_shared_lessons()
returns table (
  lesson_id    uuid,
  student_id   uuid,
  student_name text,
  transcript   text,
  takeaways    jsonb,
  image_path   text,
  match_id     uuid,
  shared_at    timestamptz,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
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
    l.created_at
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
$$;

revoke execute on function public.student_shared_lessons() from public, anon;
grant execute on function public.student_shared_lessons() to authenticated;

-- ---------------------------------------------------------------------------
-- entry_image_for_viewer — 163's function, with the student-to-coach
-- direction added. Body is prod's live one plus one branch; the return
-- shape is unchanged, so this is a replace.
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
      -- 164: a coach whose student shared this journal entry with them.
      -- Same two conditions as student_shared_lessons(): shared, and the
      -- relationship still live.
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
-- leave_coach — prod's live body plus one statement. Leaving a coach has to
-- stop the journal too, for the same reason 157 made it unbind the roster:
-- a revoked link that leaves a feed running is not a door out.
--
-- The attribution is deliberately kept. You stopped working with them; the
-- lessons still happened.
-- ---------------------------------------------------------------------------
create or replace function public.leave_coach(p_coach_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  update public.coach_links
     set status = 'revoked'
   where player_id = v_me
     and coach_id = p_coach_id
     and status <> 'revoked';

  update public.coach_students
     set player_id = null
   where coach_id = p_coach_id
     and player_id = v_me;

  update public.lessons
     set shared_with_coach_at = null
   where user_id = v_me
     and shared_with_coach_at is not null
     and coach_ref_id in (
       select id from public.player_coaches
        where player_id = v_me and coach_id = p_coach_id
     );
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: every coach a player is already connected to gets a row, named
-- from the account.
--
-- Accepted links only. A pending invite has nobody behind it, so there is
-- no name to write and nothing to bind; those rows appear when the player
-- names one, or when the coach accepts. No lesson is touched: matching
-- coach_name text to an account would be exactly the guessing this
-- migration exists to end, and the attribution is the player's to make.
-- ---------------------------------------------------------------------------
insert into public.player_coaches
  (player_id, coach_id, display_name, name_from_account)
select distinct on (cl.player_id, cl.coach_id)
  cl.player_id,
  cl.coach_id,
  coalesce(nullif(btrim(public._name_or(u.*, 'Coach')), ''), 'Coach'),
  true
from public.coach_links cl
join auth.users u on u.id = cl.coach_id
where cl.status = 'accepted'
  and cl.coach_id is not null
  and cl.coach_id <> cl.player_id
  and not exists (
    select 1 from public.player_coaches pc
    where pc.player_id = cl.player_id
      and pc.coach_id = cl.coach_id
      and pc.archived_at is null
  )
order by cl.player_id, cl.coach_id, cl.created_at;

-- A name change on the account reaches the rows the app named, the same way
-- 161 does it for the coach's roster. Prod's roster_name_sync body plus the
-- player_coaches half; it already fires on the right trigger.
create or replace function public.roster_name_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.raw_user_meta_data is not distinct from old.raw_user_meta_data
     and new.email is not distinct from old.email then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(public._display_name(new)), ''), 'Player');
  update public.coach_students
     set display_name = v_name
   where player_id = new.id
     and name_from_account
     and archived_at is null
     and display_name is distinct from v_name;

  -- The player's own list of coaches, from the other direction. 'Coach'
  -- rather than 'Player' as the fallback, and _name_or rather than
  -- _display_name: this name is shown to the player who invited them, and
  -- _display_name falls back to the email local part.
  v_name := coalesce(nullif(btrim(public._name_or(new, 'Coach')), ''), 'Coach');
  update public.player_coaches
     set display_name = v_name
   where coach_id = new.id
     and name_from_account
     and archived_at is null
     and display_name is distinct from v_name;

  return new;
end;
$$;
