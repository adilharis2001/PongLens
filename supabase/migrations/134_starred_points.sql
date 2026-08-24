-- 134 — the starred set, across every match, in one query.
--
-- Starring a point has always worked; seeing what you starred meant
-- walking back through the matches one at a time. The new Starred points
-- page (Account -> Your game) is the shelf those points live on, and this
-- is the query behind it.
--
-- Why a function rather than a PostgREST select. Everything the page
-- draws is on the row except the one field that names a point to a
-- human: its DISPLAY number. That is not points.idx — it is the position
-- among the match's VISIBLE points in timeline order, which is what the
-- match page prints. Computing it in the client means downloading every
-- visible point of every match holding a star: 1,493 rows to render 67
-- tiles on the heaviest account today. row_number() does it here for
-- nothing and the client is handed exactly the rows it draws.
--
-- The ordering inside a match is `t0` then `idx`, which is sortPoints()
-- in gameScore.ts key for key. If one of them ever changes, change both,
-- or this page and the match page start printing different numbers for
-- the same rally.
--
-- What is deliberately absent: the score at the point, and who served.
-- Both need the game-boundary walk folded over every point in the match,
-- and gameScore.ts says outright that stepBoundaryWalk is the single
-- boundary authority. It already exists twice (TypeScript and Swift).
-- A third copy in PL/pgSQL, written to decorate a tile, is three
-- implementations that must agree forever. They wouldn't.
--
-- Owner-scoped: this is the player's own shelf. A coach with match access
-- does not get one, so the join is on matches.user_id, not
-- has_match_access().

-- Partial: the starred set is a rounding error against the table, and
-- every read of it is "this user's stars", never "is this one starred".
create index if not exists points_starred_idx
  on public.points (match_id)
  where starred and not deleted;

create or replace function public.starred_points()
returns table (
  id uuid,
  match_id uuid,
  display_no int,
  t0 numeric,
  t1 numeric,
  has_clip boolean,
  confirmed_winner text,
  confirmed_how text,
  direction text,
  loss_reasons text[],
  is_let boolean,
  edited boolean,
  opponent_name text,
  venue text,
  played_at timestamptz,
  match_type text,
  has_thumb boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select m.id, m.opponent_name, m.venue, m.played_at, m.match_type,
           (m.thumb_path is not null) as has_thumb
    from public.matches m
    where m.user_id = (select auth.uid())
  ),
  numbered as (
    select p.id, p.match_id, p.t0, p.t1, p.clip_path, p.confirmed_winner,
           p.confirmed_how, p.direction, p.loss_reasons, p.is_let,
           p.edited, p.starred,
           row_number() over (
             partition by p.match_id order by p.t0, p.idx
           ) as display_no
    from public.points p
    where not p.deleted
      and exists (select 1 from mine where mine.id = p.match_id)
  )
  select n.id, n.match_id, n.display_no::int, n.t0, n.t1,
         (n.clip_path is not null),
         n.confirmed_winner, n.confirmed_how, n.direction, n.loss_reasons,
         n.is_let, n.edited,
         mi.opponent_name, mi.venue, mi.played_at, mi.match_type,
         mi.has_thumb
  from numbered n
  join mine mi on mi.id = n.match_id
  where n.starred
  order by mi.played_at desc, n.display_no
$function$;

-- A definer function is granted to public by default, and this one reads
-- matches and points with RLS off. Signed-in callers only; an anon caller
-- would get an empty set anyway (auth.uid() is null), but the grant
-- should say what is intended rather than rely on that.
revoke all on function public.starred_points() from public;
grant execute on function public.starred_points() to authenticated;
