-- ---------------------------------------------------------------------------
-- 034 — match_owner_name(): who the match belongs to, by name.
--
-- A coach opening a shared match saw the scoreboard read "Player 3 · Chris 4".
-- The label comes from the match's tagged side names, and those are only set
-- when the owner has been through the side-tagging UI; the owner's own view
-- papers over the gap with their account name, which a coach cannot see
-- (auth.users is never exposed to clients, and accountName is the VIEWER's).
--
-- So: one SECURITY DEFINER lookup, gated on has_match_access, returning the
-- owner's display name — the same _display_name() the notes thread already
-- uses to say "Priya" instead of "Coach". Same trust boundary as
-- match_note_authors: anyone who can already read the match's points and
-- notes can read whose match it is.
-- ---------------------------------------------------------------------------
create or replace function public.match_owner_name(p_match_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public._display_name(u.*)
  from public.matches m
  join auth.users u on u.id = m.user_id
  where m.id = p_match_id
    and public.has_match_access(p_match_id);
$$;

revoke execute on function public.match_owner_name(uuid) from public, anon;
grant execute on function public.match_owner_name(uuid) to authenticated;
