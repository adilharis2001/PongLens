-- 031: notifications, real note attribution, reusable coach invites.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * notifications — one inbox row per RECIPIENT. Every row is written by a
--    trigger or a SECURITY DEFINER function, never by a client: the worker
--    flips matches.status / match_reels.status over its own service
--    connection and the triggers fan the news out, so the Python worker
--    needs no change at all to start notifying people.
--  * match_note_authors() — display names for the people who wrote notes on
--    a match, so the thread can say "Priya" instead of the generic "Coach".
--  * accept_coach_invite() v2 — an invite is a standing capability, not a
--    one-shot ticket. A second coach scanning the same QR now gets their own
--    link row instead of "someone already accepted this invite".

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  -- WHO SEES IT. Fan-out happens at write time (one row per recipient) so
  -- the bell is a single indexed read with no access logic at query time.
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in (
                'note', 'match_ready', 'match_failed',
                'reel_ready', 'reel_failed', 'coach_joined')),
  match_id    uuid references public.matches (id) on delete cascade,
  -- Who caused it (note author, accepting coach). null for machine events.
  actor_id    uuid references auth.users (id) on delete set null,
  -- Copy is DENORMALISED at write time. The alternative (join names and
  -- match titles at read time) means the bell re-derives four tables per
  -- row, and a note from a coach who was later revoked would lose its name.
  title       text not null,
  body        text,
  href        text not null,
  -- Burst collapsing: a coach working through ten points leaves ONE unread
  -- row that counts up, not ten.
  group_count int not null default 1,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_inbox_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "Recipient reads own notifications" on public.notifications;
create policy "Recipient reads own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

-- UPDATE is only ever "mark read" — the column grant below is what actually
-- confines it to read_at; the policy confines it to the recipient's rows.
drop policy if exists "Recipient marks own notifications read" on public.notifications;
create policy "Recipient marks own notifications read"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon;
revoke insert, update, delete on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Shared copy helper: " vs Vaibhav", or '' when the opponent is unnamed.
-- The display TITLE is derived in TS (src/lib/matchTitle.ts) from opponent +
-- venue + date; notification copy only needs the opponent, so this stays
-- deliberately dumber than the app's title logic rather than duplicating it.
-- ---------------------------------------------------------------------------
create or replace function public._vs_suffix(opponent text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(opponent), '') <> '' then ' vs ' || btrim(opponent)
    else ''
  end;
$$;

revoke execute on function public._vs_suffix(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- notes -> notify everyone with access to the match except the author
-- ---------------------------------------------------------------------------
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

  -- Preview text: collapse whitespace so a multi-line note stays one line.
  v_snippet := nullif(btrim(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g')), '');
  v_snippet := coalesce(left(v_snippet, 140), 'Voice note');

  v_ctx := btrim(public._vs_suffix(v_match.opponent_name));
  v_ctx := case when v_ctx <> '' then v_ctx || ' · ' else '' end;

  -- MatchView's ?p= accepts a point id directly, which survives splits,
  -- merges and deletions in a way a display number would not.
  v_href := '/match/' || v_match.id::text
    || case when new.point_id is not null
            then '?p=' || new.point_id::text else '' end;

  -- Recipients: the owner plus every coach whose accepted link covers this
  -- match. Mirrors has_match_access() from the other direction.
  for v_rid in
    select v_match.user_id
    union
    select cl.coach_id
      from public.coach_links cl
     where cl.player_id = v_match.user_id
       and cl.coach_id is not null
       and cl.status = 'accepted'
       and (cl.scope_match_id is null or cl.scope_match_id = v_match.id)
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

drop trigger if exists notes_notify_insert on public.notes;
create trigger notes_notify_insert
  after insert on public.notes
  for each row execute function public.notes_notify();

-- ---------------------------------------------------------------------------
-- matches.status -> "your match is ready" / "we couldn't process it"
-- ---------------------------------------------------------------------------
create or replace function public.matches_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vs text := public._vs_suffix(new.opponent_name);
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

drop trigger if exists matches_notify_status on public.matches;
create trigger matches_notify_status
  after update of status on public.matches
  for each row execute function public.matches_notify();

-- ---------------------------------------------------------------------------
-- match_reels.status -> "your reel is ready"
-- ---------------------------------------------------------------------------
create or replace function public.match_reels_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_vs    text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('ready', 'failed') then
    return new;
  end if;

  select * into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;
  v_vs := public._vs_suffix(v_match.opponent_name);

  if new.status = 'ready' then
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_ready', v_match.id,
            'Reel ready',
            'Your highlight reel' || v_vs || ' is rendered and ready to share.',
            '/match/' || v_match.id::text);
  else
    insert into public.notifications
      (user_id, kind, match_id, title, body, href)
    values (v_match.user_id, 'reel_failed', v_match.id,
            'Reel couldn''t be rendered',
            'Something went wrong rendering your reel' || v_vs || '.',
            '/match/' || v_match.id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists match_reels_notify_status on public.match_reels;
create trigger match_reels_notify_status
  after update of status on public.match_reels
  for each row execute function public.match_reels_notify();

-- ---------------------------------------------------------------------------
-- match_note_authors — display names for the authors of a match's notes.
--
-- auth.users is never exposed to clients, and the notes thread previously
-- had to label every non-owner note "Coach" — indistinguishable once a
-- player has two coaches. Returns authors only (not the full coach roster),
-- so a coach whose link was later revoked still keeps their name on the
-- notes they left.
-- ---------------------------------------------------------------------------
create or replace function public.match_note_authors(p_match_id uuid)
returns table (author_id uuid, name text, is_owner boolean)
language sql
stable
security definer
set search_path = public
as $$
  select distinct
    n.author_id,
    public._display_name(u.*),
    n.author_id = m.user_id
  from public.notes n
  join public.matches m on m.id = n.match_id
  join auth.users u on u.id = n.author_id
  where n.match_id = p_match_id
    and public.has_match_access(p_match_id);
$$;

revoke execute on function public.match_note_authors(uuid) from public, anon;
grant execute on function public.match_note_authors(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_coach_invite v2 — reusable invites + a notification to the player.
--
-- v1 claimed the single coach_links row and flipped it to 'accepted', so the
-- token burned on first use: a second coach scanning the same QR was told
-- the invite was already used. An invite is really a standing capability, so
-- later coaches now get a CLONED link row of their own (its own token, so
-- the player can revoke each coach independently from the Sharing list).
-- ---------------------------------------------------------------------------
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

  -- Idempotent: re-scanning after acceptance hands back the existing link
  -- rather than piling up duplicate rows in the player's Sharing list.
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
      (player_id, coach_id, scope_match_id, status)
    values (v_row.player_id, v_me, v_row.scope_match_id, 'accepted')
    returning id into v_id;
  end if;

  select public._display_name(u.*) into v_name
    from auth.users u where u.id = v_me;
  v_name := coalesce(nullif(btrim(v_name), ''), 'A coach');

  v_scope := case
    when v_row.scope_match_id is null then 'They can see all your matches and leave notes.'
    else 'They can see one match and leave notes.'
  end;

  insert into public.notifications
    (user_id, kind, match_id, actor_id, title, body, href)
  values (v_row.player_id, 'coach_joined', v_row.scope_match_id, v_me,
          v_name || ' accepted your coach invite', v_scope,
          coalesce('/match/' || v_row.scope_match_id::text, '/account'));

  return v_id;
end;
$$;

revoke execute on function public.accept_coach_invite(uuid) from public, anon;
grant execute on function public.accept_coach_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- coach_invite_info v2 — status is now VIEWER-RELATIVE.
--
-- Since invites are reusable, "someone else already accepted this" is no
-- longer a dead end, so it must not report 'accepted' to a fresh coach. The
-- returned status answers "what does THIS viewer see": 'revoked' when the
-- link is dead, otherwise 'pending' (i.e. acceptable). accepted_by_me now
-- matches on the player + scope rather than the exact row, since a second
-- coach's link is a clone with a different token.
-- ---------------------------------------------------------------------------
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
    case when cl.scope_match_id is null then 'all' else 'match' end,
    case when cl.status = 'revoked' then 'revoked' else 'pending' end
  from public.coach_links cl
  join auth.users u on u.id = cl.player_id
  where cl.invite_token = token
    and auth.uid() is not null;
$$;

revoke execute on function public.coach_invite_info(uuid) from public, anon;
grant execute on function public.coach_invite_info(uuid) to authenticated;
