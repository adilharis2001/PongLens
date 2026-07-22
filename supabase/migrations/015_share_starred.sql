-- 015: starred share links (Share mode refinements).
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
--  * share_links.kind gains 'starred' — a public link to the CURRENTLY
--    starred visible points of a match. point_id stays null (like 'match');
--    the starred set is resolved AT VIEW TIME, so starring/unstarring after
--    the link exists changes what viewers see. That is the point: the link
--    is a living highlight reel, not a snapshot.
--  * One ACTIVE 'starred' link per match, alongside (not instead of) the
--    one active 'match' link — each kind gets its own partial unique index.
--  * resolve_share_link() needs no change: a 'starred' row already resolves
--    to the match context with null point columns.
--  * resolve_share_starred() — new SECURITY DEFINER resolver returning the
--    currently starred visible points (display number, timing, clip path)
--    for a non-revoked 'starred' token. Same anon-grant-via-definer pattern
--    as 013: anon never gets table grants; clip_path never leaves the
--    server (the media route signs it).

-- kind check: recreate with 'starred'.
alter table public.share_links
  drop constraint share_links_kind_check;
alter table public.share_links
  add constraint share_links_kind_check
  check (kind in ('point', 'match', 'starred'));

-- point/match shape check: 'starred' behaves like 'match' (no point_id).
alter table public.share_links
  drop constraint share_links_check;
alter table public.share_links
  add constraint share_links_check
  check (
    (kind = 'point' and point_id is not null)
    or (kind in ('match', 'starred') and point_id is null)
  );

-- One ACTIVE starred link per match; revoked rows don't block a fresh one.
-- The existing share_links_active_match_uniq only covers kind = 'match',
-- so a match link and a starred link coexist for the same match.
create unique index share_links_active_starred_uniq
  on public.share_links (match_id)
  where kind = 'starred' and revoked_at is null;

-- ---------------------------------------------------------------------------
-- resolve_share_starred(token) — the CURRENTLY starred visible points for a
-- 'starred' link, in timeline order. number is the DISPLAY number (position
-- among all non-deleted points), matching what the match page shows.
-- Live by design: this is evaluated on every call.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_share_starred(p_token text)
returns table (
  id        uuid,
  number    int,
  t0        numeric,
  t1        numeric,
  clip_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.number, q.t0, q.t1, q.clip_path
  from (
    select
      p.id, p.t0, p.t1, p.clip_path, p.starred,
      row_number() over (order by coalesce(p.t0, p.idx), p.idx)::int
        as number
    from public.share_links sl
    join public.points p on p.match_id = sl.match_id
    where sl.token = p_token
      and sl.revoked_at is null
      and sl.kind = 'starred'
      and p.deleted = false
  ) q
  where q.starred
  order by q.number;
$$;

revoke execute on function public.resolve_share_starred(text) from public;
grant execute on function public.resolve_share_starred(text) to anon, authenticated;
