-- 129: a share link can carry the score.
--
-- resolve_share_points() has returned is_let and confirmed_winner since 013
-- — its own comment says "game score from is_let + confirmed_winner" — but
-- nothing on /s/[token] ever drew one. The data was already public; only the
-- rendering was missing. This adds the owner's CHOICE about it.
--
-- Defaults true, and the page still shows nothing when a match has no
-- confirmed winners, so an unscored match is unaffected either way. That
-- mirrors the export toggle, which also defaults on and forces itself off
-- when there is no score to burn in.
--
-- Not the same thing as match_reels.show_score. That one renders the score
-- into the pixels of an exported file. This one is an overlay the share
-- page draws over the cut video, so it costs no render and applies to every
-- link that already exists.

alter table public.share_links
  add column if not exists show_score boolean not null default true;

comment on column public.share_links.show_score is
  'Owner''s choice: draw the running score over the shared video. The page '
  'still shows nothing when the match has no confirmed winners.';

-- resolve_share_link(token) — same as the live definition, plus show_score.
-- The return type changes, so this is a drop and recreate rather than a
-- replace. Pulled from pg_get_functiondef in production first: the version
-- in 013 predates the title and tag_label columns and would have silently
-- reverted both.
drop function if exists public.resolve_share_link(text);

create function public.resolve_share_link(p_token text)
returns table (
  kind                   text,
  match_id               uuid,
  point_id               uuid,
  title                  text,
  tag_label              text,
  show_score             boolean,
  opponent_name          text,
  player_near_name       text,
  player_far_name        text,
  played_at              timestamptz,
  cut_path               text,
  original_name          text,
  point_number           integer,
  point_t0               numeric,
  point_t1               numeric,
  point_clip_path        text,
  point_starred          boolean,
  point_confirmed_winner text,
  point_confirmed_how    text
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
    p.confirmed_how
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

-- resolve_share_points(token) — plus the owner's game-boundary overrides.
--
-- computeMatchScore reads game_end_override and game_winner_override, and
-- without them the share page would walk a DIFFERENT set of game boundaries
-- from the one the owner sees in their own player: same rallies, games
-- closing in the wrong places. A score that disagrees with the owner's is
-- worse than no score, so the overrides travel with the points.
--
-- Nothing new is exposed by this. Both columns are the owner's own scoring
-- decisions about points this link already publishes.
drop function if exists public.resolve_share_points(text);

create function public.resolve_share_points(p_token text)
returns table (
  id                   uuid,
  t0                   numeric,
  t1                   numeric,
  clip_path            text,
  starred              boolean,
  is_let               boolean,
  confirmed_winner     text,
  game_end_override    text,
  game_winner_override text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.t0, p.t1, p.clip_path, p.starred, p.is_let,
         p.confirmed_winner, p.game_end_override, p.game_winner_override
  from public.share_links sl
  join public.points p on p.match_id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind = 'match'
    and p.deleted = false
  order by coalesce(p.t0, p.idx), p.idx;
$$;

revoke execute on function public.resolve_share_points(text) from public;
grant execute on function public.resolve_share_points(text) to anon, authenticated;
