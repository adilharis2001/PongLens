-- PongLens SPEC.md phases 4-5 — voice notes + coach sharing helpers.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- coach_links rows are invisible to the invited coach until acceptance
-- (RLS), and auth.users is never exposed to clients. These SECURITY DEFINER
-- functions surface exactly the display fields the UI needs:
--   coach_invite_info(token)  what the invite landing page shows
--   player_coach_links()      the player's "Sharing" management list
--   coach_players()           names for the coach's "Shared with me" section

-- ---------------------------------------------------------------------------
-- Display name helper (internal): full name -> name -> email local part.
-- ---------------------------------------------------------------------------
create or replace function public._display_name(u auth.users)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    split_part(u.email, '@', 1)
  );
$$;

revoke execute on function public._display_name(auth.users) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- coach_invite_info — what the /coach-invite/<token> page shows before
-- acceptance. Any signed-in user holding the token may look it up (the token
-- itself is the capability); it exposes only the player's display name and
-- the invite's scope/status.
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
    cl.coach_id = auth.uid() and cl.status = 'accepted',
    case when cl.scope_match_id is null then 'all' else 'match' end,
    cl.status
  from public.coach_links cl
  join auth.users u on u.id = cl.player_id
  where cl.invite_token = token
    and auth.uid() is not null;
$$;

revoke execute on function public.coach_invite_info(uuid) from public, anon;
grant execute on function public.coach_invite_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- player_coach_links — the player's own links with the coach's display
-- fields joined in (players may see who accepted their invites).
-- ---------------------------------------------------------------------------
create or replace function public.player_coach_links()
returns table (
  id uuid,
  invite_token uuid,
  scope_match_id uuid,
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

-- ---------------------------------------------------------------------------
-- coach_players — players who currently share with auth.uid() (accepted
-- links only). Used to group the coach's "Shared with me" match list.
-- ---------------------------------------------------------------------------
create or replace function public.coach_players()
returns table (player_id uuid, player_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct cl.player_id, public._display_name(u.*)
  from public.coach_links cl
  join auth.users u on u.id = cl.player_id
  where cl.coach_id = auth.uid()
    and cl.status = 'accepted';
$$;

revoke execute on function public.coach_players() from public, anon;
grant execute on function public.coach_players() to authenticated;
