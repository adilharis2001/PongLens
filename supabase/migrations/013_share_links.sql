-- 013: public share links (Share mode v1 — links only).
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * share_links — owner-created public links to one point or a whole
--    match. token is a 32+ char base64url string minted from 128+ random
--    bits in the API route (crypto.randomBytes), never in SQL. Revocation
--    is a timestamp so a revoked link can never resolve again while the
--    row keeps its audit trail.
--  * RLS: the OWNER has full CRUD on their own links. Coaches get nothing:
--    share links are the owner's decision alone (unlike has_match_access,
--    which admits accepted coaches).
--  * Public resolution goes through SECURITY DEFINER functions only —
--    anon never gets table grants. resolve_share_link() returns the join
--    the /s/[token] page needs; resolve_share_points() returns the visible
--    point list for match links (no notes, suggestions, or placement:
--    those never leave the private app).

create table public.share_links (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references auth.users (id) on delete cascade,
  match_id   uuid not null references public.matches (id) on delete cascade,
  point_id   uuid references public.points (id) on delete cascade,
  kind       text not null check (kind in ('point', 'match')),
  token      text not null unique check (length(token) >= 32),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- a point link names its point; a match link never does
  check (
    (kind = 'point' and point_id is not null)
    or (kind = 'match' and point_id is null)
  )
);

create index share_links_owner_idx on public.share_links (owner, created_at desc);
create index share_links_match_id_idx on public.share_links (match_id);

-- One ACTIVE link per target; revoked rows don't block a fresh link.
create unique index share_links_active_match_uniq
  on public.share_links (match_id)
  where kind = 'match' and revoked_at is null;
create unique index share_links_active_point_uniq
  on public.share_links (point_id)
  where kind = 'point' and revoked_at is null;

alter table public.share_links enable row level security;

-- Owner-only CRUD. The with-check also pins the row to a match (and point)
-- the caller actually owns, so a forged insert can't point at someone
-- else's media.
create policy "Owners manage own share links"
  on public.share_links for all
  to authenticated
  using (owner = (select auth.uid()))
  with check (
    owner = (select auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = share_links.match_id
        and m.user_id = (select auth.uid())
    )
    and (
      point_id is null
      or exists (
        select 1 from public.points p
        where p.id = share_links.point_id
          and p.match_id = share_links.match_id
      )
    )
  );

-- anon never touches the table; resolution is function-only.
revoke all on public.share_links from anon;

-- ---------------------------------------------------------------------------
-- resolve_share_link(token) — everything the public /s/[token] page and the
-- share media route need, for non-revoked tokens only. Returns zero rows for
-- unknown/revoked tokens and for point links whose point was soft-deleted.
-- point_number is the DISPLAY number (position among non-deleted points in
-- timeline order), matching the numbers the match page shows.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_share_link(p_token text)
returns table (
  kind                   text,
  match_id               uuid,
  point_id               uuid,
  opponent_name          text,
  player_near_name       text,
  player_far_name        text,
  played_at              timestamptz,
  cut_path               text,
  original_name          text,
  point_number           int,
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
  where sl.token = p_token
    and sl.revoked_at is null
    and (sl.point_id is null or (p.id is not null and p.deleted = false));
$$;

revoke execute on function public.resolve_share_link(text) from public;
grant execute on function public.resolve_share_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_share_points(token) — the visible point list for a MATCH link, in
-- timeline order. Only what the public page shows: number comes from row
-- order, duration from t0/t1, game score from is_let + confirmed_winner.
-- clip_path stays server-side (the page never sends it to the browser; the
-- media route signs it).
-- ---------------------------------------------------------------------------
create or replace function public.resolve_share_points(p_token text)
returns table (
  id               uuid,
  t0               numeric,
  t1               numeric,
  clip_path        text,
  starred          boolean,
  is_let           boolean,
  confirmed_winner text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.t0, p.t1, p.clip_path, p.starred, p.is_let, p.confirmed_winner
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
