-- 041: note_feed carries image_path, so annotated frames (040) render in
-- the Journal feed and the tagged-points view — not just on match pages.
-- Return-type change requires drop + recreate.

drop function public.note_feed(int);

create function public.note_feed(p_limit int default 200)
returns table (
  id uuid,
  match_id uuid,
  point_id uuid,
  author_id uuid,
  body text,
  audio_path text,
  image_path text,
  created_at timestamptz,
  author_name text,
  match_owner_id uuid,
  opponent_name text,
  venue text,
  played_at timestamptz,
  user_side text,
  player_near_name text,
  player_far_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id, n.match_id, n.point_id, n.author_id, n.body, n.audio_path,
    n.image_path,
    n.created_at,
    public._display_name(u.*) as author_name,
    m.user_id as match_owner_id,
    m.opponent_name, m.venue, m.played_at,
    m.user_side, m.player_near_name, m.player_far_name
  from public.notes n
  join public.matches m on m.id = n.match_id
  join auth.users u on u.id = n.author_id
  where public.has_match_access(n.match_id)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke execute on function public.note_feed(int) from public, anon;
grant execute on function public.note_feed(int) to authenticated;
