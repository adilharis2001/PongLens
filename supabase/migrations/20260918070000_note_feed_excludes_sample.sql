-- The sample match is readable by every signed-in account, so anything
-- scoped by has_match_access() started answering with our match as well as
-- the viewer's own. note_feed() is the only cross-match feed of that kind,
-- and it backs Home's "Latest activity", the Journal feed, the coaching
-- page and the Journal's Ask. A brand new account was reading our notes
-- there, under our names, as if they were their own work.
--
-- Matches a coach shares stay in the feed; only the sample is filtered, and
-- only for people who do not own it. The match page reads public.notes
-- directly, so the sample's own notes still show where they belong.
create or replace function public.note_feed(p_limit integer default 200)
returns table(
  id uuid, match_id uuid, point_id uuid, author_id uuid, body text,
  audio_path text, image_path text, created_at timestamptz,
  author_name text, match_owner_id uuid, opponent_name text, venue text,
  played_at timestamptz, user_side text, player_near_name text,
  player_far_name text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    and (m.is_sample is not true or m.user_id = auth.uid())
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$function$;
