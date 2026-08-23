-- 130: the public share page gets the score RIGHT, and earns a page.
--
-- Three defects, one migration. All three are the same shape: the page was
-- handed a subset of the match and had to guess the rest.
--
-- 1. THE WRONG CLOCK. resolve_share_points has always returned t0, which is
--    in the SOURCE timebase, and /s/[token] walked it against the CUT
--    video's playhead. On a real match those are tens of seconds apart and
--    drifting — one link paused at 1:13 drew 0-3 where the true score
--    entering that rally was 2-4. cut_t0 is the column the app itself
--    walks (playhead.ts), so it travels with the points now.
--
-- 2. THE WRONG PLAYER NAMED. The page read `you` off player_near_name with
--    no regard for user_side, so a match the owner played at the FAR end
--    labelled the opponent as the owner. matches.user_side settles it, the
--    same way MatchView does.
--
-- 3. NOBODY'S NAME AT ALL. match_owner_name() is gated on
--    has_match_access(), which anon fails by design, so the headline could
--    only ever say "vs Julian". owner_name comes back here instead.
--
-- Nothing here widens what a share link publishes beyond the score it was
-- already allowed to draw (129) and the placement the vision derived from
-- footage the link already plays. Self-reported loss reasons and serve
-- tagging are deliberately NOT exposed: they are the owner's own notes on
-- themselves, they are not in the video, and no viewer needs them.

-- resolve_share_link(token) — pulled from pg_get_functiondef in production
-- first, so the columns 129 added are carried rather than reverted.
--
-- owner_name does NOT use public._display_name(): that falls back to
-- split_part(u.email, '@', 1), and an email prefix on a logged-out page is
-- exactly the kind of leak this project has had to close once already. No
-- name in the metadata means no name on the page.
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
  owner_name             text,
  user_side              text,
  first_server           text,
  venue                  text,
  placement_status       text,
  placement_flagged      boolean,
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

-- resolve_share_points(token) — plus cut_t0 (defect 1), idx, and the two
-- server columns.
--
-- server/server_override are what computeServing needs to run the ITTF
-- rotation. Without them the page cannot say who served a rally, which
-- costs it the serve/receive split AND every placement map: a landing is
-- only attributable once you know which end put the ball there.
drop function if exists public.resolve_share_points(text);

create function public.resolve_share_points(p_token text)
returns table (
  id                   uuid,
  idx                  integer,
  t0                   numeric,
  t1                   numeric,
  cut_t0               numeric,
  clip_path            text,
  starred              boolean,
  is_let               boolean,
  confirmed_winner     text,
  game_end_override    text,
  game_winner_override text,
  server               text,
  server_override      text,
  placement_flagged    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.idx, p.t0, p.t1, p.cut_t0, p.clip_path, p.starred, p.is_let,
         p.confirmed_winner, p.game_end_override, p.game_winner_override,
         p.server, p.server_override,
         coalesce(p.placement_flagged, false) as placement_flagged
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

-- resolve_share_placement(token) — the vision's per-point placement, for a
-- MATCH link only.
--
-- This is the one heavy payload on the page, and it must never reach a
-- browser: on a 77-point match the raw column is ~596 kB of JSON. The /s
-- page is a server component, so it calls this, runs
-- collectTrustedPlacementObservations server-side, and ships only the
-- surviving landings — a few hundred rows of seven small fields.
--
-- 'candidates' is stripped here rather than in TypeScript. It is the raw
-- detection soup the hypotheses were built FROM, nothing outside the
-- worker and its tests reads it, and it is 246 kB of the 596. Dropping one
-- key that no consumer touches halves the wire cost; trimming further
-- would mean re-implementing the hypothesis-trust rules in SQL, where they
-- would drift away from the TypeScript that actually decides them.
--
-- Points the owner flagged as mis-mapped are excluded here, not filtered
-- later, so a rally the vision plainly botched never leaves the database.
create or replace function public.resolve_share_placement(p_token text)
returns table (
  id        uuid,
  placement jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, (p.placement - 'candidates') as placement
  from public.share_links sl
  join public.matches m on m.id = sl.match_id
  join public.points p on p.match_id = sl.match_id
  where sl.token = p_token
    and sl.revoked_at is null
    and sl.kind = 'match'
    and sl.show_score            -- same owner switch the score rides on
    and p.deleted = false
    and coalesce(p.placement_flagged, false) = false
    and coalesce(m.placement_flagged, false) = false
    and p.placement is not null
  order by coalesce(p.t0, p.idx), p.idx;
$$;

revoke execute on function public.resolve_share_placement(text) from public;
grant execute on function public.resolve_share_placement(text) to anon, authenticated;

comment on function public.resolve_share_placement(text) is
  'Per-point placement for a match share link, minus the raw candidate '
  'soup. Server-side only: the /s page reduces it to trusted landings '
  'before anything is sent to a browser.';
