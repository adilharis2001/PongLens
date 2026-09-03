-- 153: share links learn the original video.
--
-- A match link minted on an UNPROCESSED match used to resolve with no
-- playable path at all: resolve_share_link only knew the cut video, so
-- the public page mounted a player that could never load ("Couldn't load
-- the video. Try again shortly.", forever). Nothing stops the owner from
-- minting that link — the share route deliberately has no status check,
-- and the iOS library grid offers Share on every owned match.
--
-- The resolver now also returns the match's raw_path, and
-- /api/share/media serves the original upload when no cut exists. The
-- ordering is the useful part: cut first, raw as fallback, so a link
-- shared before processing plays the original today and silently
-- upgrades to the cut video (and score, stats, maps) the moment the
-- match is processed. Same URL, nothing to reshare.
--
-- Retention note (checked 2026-09-01): since commerce (096) the raw of a
-- live library match never ages out — the sweep skips any object a
-- matches.raw_path row references — so this is not a link with a shelf
-- life. Only legacy matches whose raws were swept before 096 resolve
-- with neither path; the page shows an honest "no longer available" for
-- those.
--
-- Adding an OUT column requires drop + recreate; grants restated below
-- (they do not survive the drop).

drop function if exists public.resolve_share_link(text);

create function public.resolve_share_link(p_token text)
returns table(
  kind text,
  match_id uuid,
  point_id uuid,
  title text,
  tag_label text,
  show_score boolean,
  opponent_name text,
  player_near_name text,
  player_far_name text,
  owner_name text,
  user_side text,
  first_server text,
  venue text,
  placement_status text,
  placement_flagged boolean,
  played_at timestamptz,
  cut_path text,
  original_name text,
  point_number integer,
  point_t0 numeric,
  point_t1 numeric,
  point_clip_path text,
  point_starred boolean,
  point_confirmed_winner text,
  point_confirmed_how text,
  raw_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sl.kind,
    sl.match_id,
    sl.point_id,
    sl.title,
    t.label as tag_label,
    sl.show_score,
    m.opponent_name,
    m.player_near_name,
    m.player_far_name,
    (select nullif(btrim(coalesce(
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'name',
       '')), '')
     from auth.users u where u.id = m.user_id) as owner_name,
    m.user_side,
    m.first_server,
    m.venue,
    m.placement_status,
    coalesce(m.placement_flagged, false) as placement_flagged,
    m.played_at,
    coalesce(
      m.cut_path,
      (select j.result_path from public.jobs j
        where j.id = m.job_id and j.status = 'done')
    ) as cut_path,
    (select j.original_name from public.jobs j where j.id = m.job_id)
      as original_name,
    case when p.id is null then null else (
      select count(*)::int from public.points q
      where q.match_id = p.match_id
        and q.deleted = false
        and (coalesce(q.t0, q.idx), q.idx) <= (coalesce(p.t0, p.idx), p.idx)
    ) end as point_number,
    p.t0,
    p.t1,
    p.clip_path,
    p.starred,
    p.confirmed_winner,
    p.confirmed_how,
    m.raw_path
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  left join public.points p on p.id = sl.point_id
  left join public.tags t on t.id = sl.tag_id
  where sl.token = p_token
    and sl.revoked_at is null
    and (sl.point_id is null or (p.id is not null and p.deleted = false));
$$;

revoke execute on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text) to anon, authenticated;
