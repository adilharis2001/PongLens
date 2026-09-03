-- 161 — roster names follow the account, a joined student can be merged
-- into the row the coach typed, and a coach's access is a per-coach
-- setting: all matches, or only the ones the player shares.
--
-- Two findings behind the first half (Adil, 2026-09-02). A student who
-- creates their account from a coach's general invite lands on the roster
-- as "Player", because the name is copied once at the moment of joining
-- and a brand-new account has no name yet — the name step comes after the
-- join. And a general invite has no roster row to bind, so a coach who had
-- already typed "Larry Chen" ends up with two rows for one student. The
-- notification said "Player joined" for the same reason.
--
-- The second half is direction 1 of the sharing question: the player
-- chooses, per coach, between all matches (including future uploads) and
-- only the matches they share from a match page, and can switch either
-- way without removing the coach. Until now the only way down from "all"
-- was Remove coach and a fresh invite.

-- ---------------------------------------------------------------------------
-- 1. coach_links.all_matches — what a null scope_match_id grants.
--
-- A link with scope_match_id null used to mean "every match". It now means
-- "connected", and all_matches says whether that connection carries every
-- match. A match-scoped row never carries the flag; the trigger keeps it
-- false there so no reader has to remember the rule.
-- ---------------------------------------------------------------------------
alter table public.coach_links
  add column if not exists all_matches boolean not null default true;

update public.coach_links set all_matches = false where scope_match_id is not null;

create or replace function public.coach_links_normalise()
returns trigger
language plpgsql
as $$
begin
  if new.scope_match_id is not null then
    new.all_matches := false;
  end if;
  return new;
end;
$$;

drop trigger if exists coach_links_normalise on public.coach_links;
create trigger coach_links_normalise
  before insert or update on public.coach_links
  for each row execute function public.coach_links_normalise();

-- The access rule, in the one function RLS on points, notes, clips and
-- the rest reads through.
create or replace function public.has_match_access(m_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.id = m_id
      and (
        m.user_id = auth.uid()
        or exists (
          select 1
          from public.coach_links cl
          where cl.coach_id = auth.uid()
            and cl.player_id = m.user_id
            and cl.status = 'accepted'
            and (cl.scope_match_id = m.id
                 or (cl.scope_match_id is null and cl.all_matches))
        )
        or exists (
          select 1
          from public.review_orders o
          where o.match_id = m.id
            and o.coach_id = auth.uid()
            and o.status in ('submitted', 'in_review',
                             'clarification', 'delivered')
        )
      )
  );
$$;

-- matches reads its own policy inline rather than through the function.
drop policy if exists "Owner and coaches can view matches" on public.matches;
create policy "Owner and coaches can view matches" on public.matches
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.coach_links cl
      where cl.coach_id = (select auth.uid())
        and cl.player_id = matches.user_id
        and cl.status = 'accepted'
        and (cl.scope_match_id = matches.id
             or (cl.scope_match_id is null and cl.all_matches))
    )
    or exists (
      select 1 from public.review_orders o
      where o.match_id = matches.id
        and o.coach_id = (select auth.uid())
        and o.status in ('submitted', 'in_review', 'clarification', 'delivered')
    )
  );

-- Who hears about a new match: the coaches whose access covers it.
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
         and (cl.scope_match_id = new.id
              or (cl.scope_match_id is null and cl.all_matches))
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

-- Who hears about a note: the owner plus the coaches whose access covers
-- the match. Mirrors has_match_access() from the other direction.
create or replace function public.notes_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match   public.matches%rowtype;
  v_actor   text;
  v_snippet text;
  v_ctx     text;
  v_href    text;
  v_rid     uuid;
begin
  select * into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;

  select public._display_name(u.*) into v_actor
    from auth.users u where u.id = new.author_id;
  v_actor := coalesce(nullif(btrim(v_actor), ''), 'Someone');

  v_snippet := nullif(btrim(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g')), '');
  v_snippet := coalesce(left(v_snippet, 140), 'Voice note');

  v_ctx := btrim(public._vs_suffix(v_match.opponent_name));
  v_ctx := case when v_ctx <> '' then v_ctx || ' · ' else '' end;

  v_href := '/match/' || v_match.id::text
    || case when new.point_id is not null
            then '?p=' || new.point_id::text else '' end;

  for v_rid in
    select v_match.user_id
    union
    select cl.coach_id
      from public.coach_links cl
     where cl.player_id = v_match.user_id
       and cl.coach_id is not null
       and cl.status = 'accepted'
       and (cl.scope_match_id = v_match.id
            or (cl.scope_match_id is null and cl.all_matches))
  loop
    if v_rid = new.author_id then
      continue;
    end if;

    update public.notifications
       set group_count = group_count + 1,
           title = v_actor || ' left ' || (group_count + 1)::text || ' notes',
           body = v_ctx || v_snippet,
           href = v_href,
           created_at = now()
     where user_id = v_rid
       and kind = 'note'
       and match_id = v_match.id
       and actor_id = new.author_id
       and read_at is null
       and created_at > now() - interval '6 hours';

    if not found then
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values (v_rid, 'note', v_match.id, new.author_id,
              v_actor || ' left a note', v_ctx || v_snippet, v_href);
    end if;
  end loop;

  return new;
end;
$$;

-- What the /coach-invite page shows: the scope is now one of three.
create or replace function public.coach_invite_info(token uuid)
returns table (
  player_name text,
  is_own_invite boolean,
  accepted_by_me boolean,
  scope text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    public._display_name(u.*),
    cl.player_id = auth.uid(),
    exists (
      select 1 from public.coach_links mine
      where mine.player_id = cl.player_id
        and mine.coach_id = auth.uid()
        and mine.scope_match_id is not distinct from cl.scope_match_id
        and mine.status = 'accepted'
    ),
    case
      when cl.scope_match_id is not null then 'match'
      when cl.all_matches then 'all'
      else 'selected'
    end,
    case when cl.status = 'revoked' then 'revoked' else 'pending' end
  from public.coach_links cl
  join auth.users u on u.id = cl.player_id
  where cl.invite_token = token
    and auth.uid() is not null;
$$;

-- Accepting a player's invite: the row keeps the access it was minted
-- with, and the player's notification says which of the three it was.
create or replace function public.accept_coach_invite(token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.coach_links%rowtype;
  v_me    uuid := auth.uid();
  v_id    uuid;
  v_name  text;
  v_scope text;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.coach_links where invite_token = token;
  if not found then
    raise exception 'invite not found';
  end if;
  if v_row.player_id = v_me then
    raise exception 'cannot accept your own invite';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'invite revoked';
  end if;

  select id into v_id
    from public.coach_links
   where player_id = v_row.player_id
     and coach_id = v_me
     and scope_match_id is not distinct from v_row.scope_match_id
     and status = 'accepted'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if v_row.status = 'pending' and v_row.coach_id is null then
    update public.coach_links
       set coach_id = v_me, status = 'accepted'
     where id = v_row.id
    returning id into v_id;
  else
    insert into public.coach_links
      (player_id, coach_id, scope_match_id, status, all_matches)
    values (v_row.player_id, v_me, v_row.scope_match_id, 'accepted',
            v_row.all_matches)
    returning id into v_id;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(nullif(btrim(v_name), ''), 'A coach');

  v_scope := case
    when v_row.scope_match_id is not null then 'They can see one match and leave notes.'
    when v_row.all_matches then 'They can see all your matches and leave notes.'
    else 'They can see the matches you share with them and leave notes.'
  end;

  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_row.player_id, 'coach_joined', v_row.scope_match_id, v_me,
          v_name || ' accepted your coach invite', v_scope,
          coalesce('/match/' || v_row.scope_match_id::text, '/coaching'));

  return v_id;
end;
$$;

-- The player's own links, now carrying the flag. The return type changes,
-- so the function is dropped and made again.
drop function if exists public.player_coach_links();
create function public.player_coach_links()
returns table (
  id uuid,
  invite_token uuid,
  scope_match_id uuid,
  all_matches boolean,
  status text,
  coach_name text,
  coach_email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cl.id,
    cl.invite_token,
    cl.scope_match_id,
    cl.all_matches,
    cl.status,
    public._display_name(u.*),
    u.email::text,
    cl.created_at
  from public.coach_links cl
  left join auth.users u on u.id = cl.coach_id
  where cl.player_id = auth.uid()
  order by cl.created_at desc;
$$;
revoke execute on function public.player_coach_links() from public, anon;
grant execute on function public.player_coach_links() to authenticated;

-- The per-coach setting, from the player's side. One accepted connection
-- row per pair carries it; a pair that only ever had match-scoped rows
-- gets its connection row here, so a coach can be moved up to all
-- matches, and later back down, without ever being removed.
create or replace function public.set_coach_access(p_coach_id uuid, p_all_matches boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_coach_id = v_me then
    raise exception 'cannot coach yourself';
  end if;

  select id into v_id
    from public.coach_links
   where player_id = v_me
     and coach_id = p_coach_id
     and scope_match_id is null
     and status = 'accepted'
   limit 1;

  if v_id is not null then
    update public.coach_links set all_matches = p_all_matches where id = v_id;
    return v_id;
  end if;

  if not exists (
    select 1 from public.coach_links
    where player_id = v_me and coach_id = p_coach_id and status = 'accepted'
  ) then
    raise exception 'coach not connected';
  end if;

  insert into public.coach_links (player_id, coach_id, status, all_matches)
  values (v_me, p_coach_id, 'accepted', p_all_matches)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.set_coach_access(uuid, boolean) from public, anon;
grant execute on function public.set_coach_access(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Roster names follow the account when the app chose them.
--
-- name_from_account marks a row whose name came from the account rather
-- than from the coach's keyboard. Those rows follow the account's name
-- from then on; a coach renaming one takes it back.
-- ---------------------------------------------------------------------------
alter table public.coach_students
  add column if not exists name_from_account boolean not null default false;

-- The connection made from a player's invite. Same as before, but the row
-- it creates says its name came from the account.
create or replace function public.coach_links_roster_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_match public.matches%rowtype;
begin
  if new.status <> 'accepted'
     or new.coach_id is null
     or new.player_id = new.coach_id then
    return new;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = new.player_id;
  v_name := coalesce(nullif(btrim(v_name), ''), 'Player');

  insert into public.coach_students (coach_id, player_id, display_name, name_from_account)
  values (new.coach_id, new.player_id, v_name, true)
  on conflict (coach_id, player_id)
    where player_id is not null and archived_at is null
    do nothing;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || '{"is_coach": true}'::jsonb
   where id = new.coach_id
     and coalesce(raw_user_meta_data->>'is_coach', '') <> 'true';

  if tg_op = 'INSERT' and new.scope_match_id is not null then
    select * into v_match from public.matches where id = new.scope_match_id;
    if found then
      insert into public.notifications
        (user_id, kind, match_id, actor_id, title, body, href)
      values (new.coach_id, 'student_match_ready', v_match.id, new.player_id,
              v_name || ' shared a match with you',
              'Their match' || public._vs_suffix(v_match.opponent_name)
                || ' is ready to review.',
              '/match/' || v_match.id::text);
    end if;
  end if;

  return new;
end;
$$;

-- Joining from a coach's invite. The student now chooses what the coach
-- may see, and the coach's notification names them: the row the coach
-- typed when the invite was theirs, else the account, never "Player"
-- while the account has an email to fall back on.
drop function if exists public.accept_student_invite(uuid);
create function public.accept_student_invite(p_token uuid, p_all_matches boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite  public.coach_student_invites%rowtype;
  v_me      uuid := auth.uid();
  v_link    uuid;
  v_student uuid;
  v_name    text;
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

  -- Roster BEFORE link: creating the link fires coach_links_roster_sync
  -- inside this very statement, and if that trigger runs first it makes a
  -- fresh generic row while the coach's named offline row stays orphaned.
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
    insert into public.coach_links (player_id, coach_id, status, all_matches)
    values (v_me, v_invite.coach_id, 'accepted', p_all_matches)
    returning id into v_link;
  end if;

  if not exists (
    select 1 from public.coach_students
    where coach_id = v_invite.coach_id
      and player_id = v_me
      and archived_at is null
  ) then
    select public._display_name(u.*) into v_name
      from auth.users u where u.id = v_me;
    insert into public.coach_students (coach_id, player_id, display_name, name_from_account)
    values (v_invite.coach_id, v_me,
            coalesce(nullif(btrim(v_name), ''), 'Player'), true)
    on conflict (coach_id, player_id)
      where player_id is not null and archived_at is null
      do nothing;
  end if;

  select id, display_name into v_student, v_name
    from public.coach_students
   where coach_id = v_invite.coach_id
     and player_id = v_me
     and archived_at is null
   limit 1;

  insert into public.notifications
    (user_id, kind, actor_id, title, body, href)
  values (v_invite.coach_id, 'student_joined', v_me,
          coalesce(v_name, 'A player') || ' joined as your student',
          case when p_all_matches
               then 'Their matches and your lesson notes now connect.'
               else 'They will share matches with you one at a time. Your lesson notes now connect.'
          end,
          coalesce('/coaching/students/' || v_student::text, '/coaching/students'));

  return v_link;
end;
$$;
revoke execute on function public.accept_student_invite(uuid, boolean) from public, anon;
grant execute on function public.accept_student_invite(uuid, boolean) to authenticated;

-- A name change on the account reaches every roster row that follows it.
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
  return new;
end;
$$;

drop trigger if exists roster_name_sync on auth.users;
create trigger roster_name_sync
  after update of raw_user_meta_data, email on auth.users
  for each row execute function public.roster_name_sync();

-- A coach typing a different name takes the row back from the account.
create or replace function public.coach_students_name_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live text;
begin
  if new.name_from_account
     and new.display_name is distinct from old.display_name
     and new.player_id is not null then
    select coalesce(nullif(btrim(public._display_name(u.*)), ''), 'Player')
      into v_live
      from auth.users u where u.id = new.player_id;
    if v_live is distinct from new.display_name then
      new.name_from_account := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists coach_students_name_edit on public.coach_students;
create trigger coach_students_name_edit
  before update of display_name on public.coach_students
  for each row execute function public.coach_students_name_edit();

-- A student who joined from a general invite, folded into the row the
-- coach had already typed: the entries move, the typed name stays, the
-- account binds to it, and the joined row goes.
create or replace function public.merge_students(p_into uuid, p_from uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_into public.coach_students%rowtype;
  v_from public.coach_students%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if p_into = p_from then
    raise exception 'same student';
  end if;

  select * into v_into from public.coach_students
   where id = p_into and coach_id = v_me and archived_at is null;
  if not found then
    raise exception 'student not found';
  end if;
  select * into v_from from public.coach_students
   where id = p_from and coach_id = v_me and archived_at is null;
  if not found then
    raise exception 'student not found';
  end if;
  if v_into.player_id is not null then
    raise exception 'already on PongLens';
  end if;
  if v_from.player_id is null then
    raise exception 'not on PongLens';
  end if;

  update public.coach_entries set student_id = p_into where student_id = p_from;
  delete from public.coach_students where id = p_from;
  update public.coach_students
     set player_id = v_from.player_id,
         name_from_account = false
   where id = p_into;

  return p_into;
end;
$$;
revoke execute on function public.merge_students(uuid, uuid) from public, anon;
grant execute on function public.merge_students(uuid, uuid) to authenticated;

-- Rows the app named so far: the generic "Player" ones, and the ones that
-- still read exactly as the account does, follow the account from now on.
update public.coach_students cs
   set display_name = coalesce(nullif(btrim(public._display_name(u.*)), ''), 'Player'),
       name_from_account = true
  from auth.users u
 where u.id = cs.player_id
   and cs.archived_at is null
   and (cs.display_name = 'Player'
        or cs.display_name = public._display_name(u.*));
