-- 162 — the player's own link list carries the coach's id, so the
-- per-coach access control (161) can name the coach it is changing
-- without a second query. Return type changes, so drop and make again.
drop function if exists public.player_coach_links();
create function public.player_coach_links()
returns table (
  id uuid,
  invite_token uuid,
  coach_id uuid,
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
    cl.coach_id,
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
