-- 157: coach workspace hardening, from the 2026-09-02 audit.
--
-- 1. Names. 156 read display names through _display_name(), which falls
--    back to the part of the email before the @ — the 130 leak pattern
--    that 154 explicitly refuses. On the join page that put a stranger's
--    email fragment in front of whoever held the link. Every coach-side
--    function now reads the metadata name only, with a neutral fallback,
--    and roster rows already named from an email are renamed.
-- 2. leave_coach: the student's one door out. Revoking a coach link used
--    to stop match access while shared entries kept arriving (entries are
--    the coach's grant, not the match link's). Leaving now also unbinds
--    the student from that coach's roster, so the feed stops too. The
--    coach keeps their own entries; the row reverts to an offline student.
-- 3. remove_student: the coach's mirror. Archiving a roster row used to
--    leave the coach's accepted links in place, so the coach could still
--    see the matches of someone they had "removed". Now the links are
--    revoked with the row.
--
-- Function bodies below are 156's with the name helper swapped; the live
-- definitions were re-read before writing (pg_get_functiondef).

create or replace function public._name_or(u auth.users, p_fallback text)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    p_fallback
  );
$$;

revoke execute on function public._name_or(auth.users, text) from public, anon, authenticated;

-- Roster rows the 156 backfill or sync named from an email local part.
update public.coach_students cs
   set display_name = 'Player'
  from auth.users u
 where u.id = cs.player_id
   and cs.display_name = split_part(u.email, '@', 1)
   and nullif(btrim(u.raw_user_meta_data->>'full_name'), '') is null
   and nullif(btrim(u.raw_user_meta_data->>'name'), '') is null;

create or replace function public.coach_links_roster_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  select public._name_or(u.*, 'Player') into v_name
    from auth.users u where u.id = new.player_id;

  insert into public.coach_students (coach_id, player_id, display_name)
  values (new.coach_id, new.player_id, coalesce(v_name, 'Player'))
  on conflict (coach_id, player_id)
    where player_id is not null and archived_at is null
    do nothing;

  return new;
end;
$$;

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

  select nullif(btrim(regexp_replace(
           coalesce(l.transcript, ''), '\s+', ' ', 'g')), '')
    into v_snippet
    from public.lessons l where l.id = new.lesson_id;
  v_snippet := coalesce(left(v_snippet, 140), 'Lesson note');

  insert into public.notifications
    (user_id, kind, actor_id, title, body, href)
  values (v_student.player_id, 'coach_entry', new.coach_id,
          v_actor || ' shared a lesson note', v_snippet, '/journal');

  return new;
end;
$$;

create or replace function public.matches_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vs   text := public._vs_suffix(new.opponent_name);
  v_name text;
  v_rid  uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'ready' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (new.user_id, 'match_ready', new.id,
            'Match ready',
            'Your match' || v_vs || ' is cut into points and ready to review.',
            '/match/' || new.id::text);

    select public._name_or(u.*, 'A student') into v_name
      from auth.users u where u.id = new.user_id;
    v_name := coalesce(v_name, 'A student');

    for v_rid in
      select distinct cl.coach_id
        from public.coach_links cl
       where cl.player_id = new.user_id
         and cl.coach_id is not null
         and cl.coach_id <> new.user_id
         and cl.status = 'accepted'
         and (cl.scope_match_id is null or cl.scope_match_id = new.id)
    loop
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values (v_rid, 'student_match_ready', new.id, new.user_id,
              v_name || ' has a new match',
              'Their match' || v_vs || ' is ready to review.',
              '/match/' || new.id::text);
    end loop;
  elsif new.status = 'failed' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (new.user_id, 'match_failed', new.id,
            'Match couldn''t be processed',
            'Something went wrong with your match' || v_vs || '.',
            '/dashboard');
  end if;

  return new;
end;
$$;

create or replace function public.student_invite_info(p_token uuid)
returns table (
  coach_name text,
  is_own_invite boolean,
  already_linked boolean,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public._name_or(u.*, 'Your coach'),
    i.coach_id = auth.uid(),
    exists (
      select 1 from public.coach_links cl
      where cl.player_id = auth.uid()
        and cl.coach_id = i.coach_id
        and cl.scope_match_id is null
        and cl.status = 'accepted'
    ),
    case when i.revoked_at is not null then 'revoked' else 'open' end
  from public.coach_student_invites i
  join auth.users u on u.id = i.coach_id
  where i.token = p_token
    and auth.uid() is not null;
$$;

create or replace function public.accept_student_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.coach_student_invites%rowtype;
  v_me     uuid := auth.uid();
  v_link   uuid;
  v_name   text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
    from public.coach_student_invites where token = p_token;
  if not found then
    raise exception 'invite not found';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked';
  end if;
  if v_invite.coach_id = v_me then
    raise exception 'cannot accept your own invite';
  end if;

  -- Roster BEFORE link (see 156): the link's sync trigger would otherwise
  -- make a generic row while the coach's named offline row stays orphaned.
  if v_invite.student_id is not null and not exists (
    select 1 from public.coach_students
    where coach_id = v_invite.coach_id
      and player_id = v_me
      and archived_at is null
  ) then
    update public.coach_students
       set player_id = v_me
     where id = v_invite.student_id
       and coach_id = v_invite.coach_id
       and player_id is null
       and archived_at is null;
  end if;

  select id into v_link
    from public.coach_links
   where player_id = v_me
     and coach_id = v_invite.coach_id
     and scope_match_id is null
     and status = 'accepted'
   limit 1;
  if v_link is null then
    insert into public.coach_links (player_id, coach_id, status)
    values (v_me, v_invite.coach_id, 'accepted')
    returning id into v_link;
  end if;

  if not exists (
    select 1 from public.coach_students
    where coach_id = v_invite.coach_id
      and player_id = v_me
      and archived_at is null
  ) then
    select public._name_or(u.*, 'Player') into v_name
      from auth.users u where u.id = v_me;
    insert into public.coach_students (coach_id, player_id, display_name)
    values (v_invite.coach_id, v_me, coalesce(v_name, 'Player'))
    on conflict (coach_id, player_id)
      where player_id is not null and archived_at is null
      do nothing;
  end if;

  select public._name_or(u.*, 'A player') into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(v_name, 'A player');

  insert into public.notifications
    (user_id, kind, actor_id, title, body, href)
  values (v_invite.coach_id, 'student_joined', v_me,
          v_name || ' joined as your student',
          'Their matches and your lesson notes now connect.',
          '/coaching/students');

  return v_link;
end;
$$;

create or replace function public.coach_shared_entries()
returns table (
  entry_id uuid,
  coach_id uuid,
  coach_name text,
  transcript text,
  takeaways jsonb,
  entry_kind text,
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
    ce.coach_id,
    coalesce((
      select public._name_or(u.*, 'Your coach')
      from auth.users u where u.id = ce.coach_id), 'Your coach'),
    l.transcript,
    l.takeaways,
    l.kind,
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

-- ---------------------------------------------------------------------------
-- leave_coach — the student severs everything with one coach: every link
-- (any scope, any status) revoked, and their roster binding cleared so
-- shared entries stop. Idempotent; a coach the caller never had is a
-- no-op. Paid review orders are untouched — they end on their own terms.
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
end;
$$;

revoke execute on function public.leave_coach(uuid) from public, anon;
grant execute on function public.leave_coach(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_student — the coach's mirror. Archives the roster row and revokes
-- the coach's own links to that player, so "removed" means the matches go
-- too. Entries stay under the archived row as the coach's record.
-- ---------------------------------------------------------------------------
create or replace function public.remove_student(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.coach_students%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row
    from public.coach_students
   where id = p_student_id and coach_id = v_me;
  if not found then
    raise exception 'student not found';
  end if;

  update public.coach_students
     set archived_at = coalesce(archived_at, now())
   where id = v_row.id;

  if v_row.player_id is not null then
    update public.coach_links
       set status = 'revoked'
     where coach_id = v_me
       and player_id = v_row.player_id
       and status <> 'revoked';
  end if;
end;
$$;

revoke execute on function public.remove_student(uuid) from public, anon;
grant execute on function public.remove_student(uuid) to authenticated;
