-- Point boundaries: the owner's own marks for where a point starts and ends.
--
-- Two columns already carry this. serve_start_at_cut_s (089) is the admin-only
-- head label, set by watching the video and marking where a serve begins;
-- scored_at_cut_s (067) is the moment the winner key was pressed. They sit on
-- the same row, so a row holding both bounds one point exactly.
--
-- It is the only non-circular ground truth the point-detection work has. The
-- `deleted` flag says a card was junk but never says where the point inside a
-- kept card begins or ends, so a boundary measured against it is measured
-- against the pipeline's own guess. 289 points are marked as of 2026-08-16 and
-- the number grows every time a match is scored.
--
-- This migration adds two things, and they do different jobs.
--
--   The VIEW is not more durable than what is already there. It is more
--   findable, and it does the conversion once. Cards and detectors work in
--   SOURCE seconds (the raw upload) and the taps are stored in CUT seconds
--   against each point's own cut_t0. Mixing the two is the mistake that has
--   been made repeatedly in this codebase, so it is made here and nowhere
--   else:
--
--       source = t0 - clip_pads.pre - cut_t0 + tap
--
--   The ARCHIVE is the durable part. Deleting a match cascades to its points
--   and takes the labels with it, permanently, because no detector can
--   regenerate a human's judgement about video. A row carrying either tap is
--   copied out before it goes.

create table if not exists public.point_boundary_archive (
  point_id uuid primary key,
  -- deliberately no foreign key: the whole purpose is to outlive the match
  match_id uuid not null,
  opponent_name text,
  venue text,
  played_at timestamptz,
  idx integer,
  t0 numeric,
  t1 numeric,
  cut_t0 numeric,
  clip_pads jsonb,
  serve_start_at_cut_s numeric,
  scored_at_cut_s numeric,
  serve_start_meta jsonb,
  deleted boolean,
  archived_at timestamptz not null default now()
);

comment on table public.point_boundary_archive is
  'Hand-marked point boundaries rescued from deleted points. Irreplaceable: '
  'a human watched the video to make these. Written only by the trigger '
  'below; see the point_boundaries view for the live ones.';

alter table public.point_boundary_archive enable row level security;

-- Admin only, and granted to `authenticated` alone. is_admin() has EXECUTE
-- for authenticated and not for anon, so a policy anon is subject to fails
-- the whole read with 42501 instead of returning false — the trap from 107.
drop policy if exists "Admin reads archived boundaries"
  on public.point_boundary_archive;
create policy "Admin reads archived boundaries"
  on public.point_boundary_archive for select to authenticated
  using (public.is_admin());

create or replace function public.archive_point_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.serve_start_at_cut_s is null and old.scored_at_cut_s is null then
    return old;
  end if;
  -- The match row may already be gone: a cascade from matches deletes the
  -- parent first and reaches the children through an AFTER trigger. The join
  -- is therefore a left join and its columns are a bonus, not a requirement.
  insert into public.point_boundary_archive (
    point_id, match_id, opponent_name, venue, played_at, idx, t0, t1,
    cut_t0, clip_pads, serve_start_at_cut_s, scored_at_cut_s,
    serve_start_meta, deleted)
  select old.id, old.match_id, m.opponent_name, m.venue, m.played_at,
         old.idx, old.t0, old.t1, old.cut_t0, m.clip_pads,
         old.serve_start_at_cut_s, old.scored_at_cut_s,
         old.serve_start_meta, old.deleted
  from (select 1) _
  left join public.matches m on m.id = old.match_id
  on conflict (point_id) do nothing;
  return old;
end;
$$;

-- A trigger function has no business on the REST surface. Postgres checks
-- EXECUTE when the trigger is created, not when it fires, so taking the grant
-- away costs nothing and keeps a SECURITY DEFINER function off /rpc.
revoke all on function public.archive_point_boundary() from public, anon,
  authenticated;

drop trigger if exists points_archive_boundary on public.points;
create trigger points_archive_boundary
  before delete on public.points
  for each row execute function public.archive_point_boundary();

-- And once more from the other side. A cascade from matches deletes the parent
-- first and reaches the points through an AFTER trigger, so by then the join
-- above finds nothing and the rows land without an opponent or a venue. Going
-- first, while the match is still there, fills those in; the per-row trigger
-- then finds them already archived and does nothing.
create or replace function public.archive_match_boundaries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.point_boundary_archive (
    point_id, match_id, opponent_name, venue, played_at, idx, t0, t1,
    cut_t0, clip_pads, serve_start_at_cut_s, scored_at_cut_s,
    serve_start_meta, deleted)
  select p.id, p.match_id, old.opponent_name, old.venue, old.played_at,
         p.idx, p.t0, p.t1, p.cut_t0, old.clip_pads,
         p.serve_start_at_cut_s, p.scored_at_cut_s,
         p.serve_start_meta, p.deleted
  from public.points p
  where p.match_id = old.id
    and (p.serve_start_at_cut_s is not null or p.scored_at_cut_s is not null)
  on conflict (point_id) do nothing;
  return old;
end;
$$;

revoke all on function public.archive_match_boundaries() from public, anon,
  authenticated;

drop trigger if exists matches_archive_boundaries on public.matches;
create trigger matches_archive_boundaries
  before delete on public.matches
  for each row execute function public.archive_match_boundaries();

-- The live view. security_invoker so the reader's own RLS on points applies;
-- without it a view runs as its owner and would hand every match's points to
-- anyone who could select from it.
-- A few rows have the winner tap BEFORE the serve tap — four of 295 as of
-- 2026-08-16 — which describes no point that can happen. They are mis-taps and
-- are flagged rather than hidden, because a silently shorter count is worse
-- than a visible odd row. It mattered at once: scored without the flag, both
-- pipelines appeared to lose four real points and every one was one of these.
drop view if exists public.point_boundaries;

create view public.point_boundaries
with (security_invoker = true) as
select
  p.id                                          as point_id,
  p.match_id,
  m.opponent_name,
  m.venue,
  m.played_at,
  p.idx,
  p.serve_start_at_cut_s                        as start_cut_s,
  p.scored_at_cut_s                             as end_cut_s,
  round(p.t0 - coalesce((m.clip_pads ->> 'pre')::numeric, 1.2)
        - p.cut_t0 + p.serve_start_at_cut_s, 3) as start_source_s,
  round(p.t0 - coalesce((m.clip_pads ->> 'pre')::numeric, 1.2)
        - p.cut_t0 + p.scored_at_cut_s, 3)      as end_source_s,
  round(p.scored_at_cut_s - p.serve_start_at_cut_s, 3) as length_s,
  -- a rally shorter than this is a slip of the thumb, longer than this is a
  -- forgotten keypress; both are wide enough to accuse nothing real
  (p.scored_at_cut_s - p.serve_start_at_cut_s between 0.7 and 60)
                                                as usable,
  p.t0                                          as card_t0,
  p.t1                                          as card_t1,
  p.deleted,
  p.serve_start_meta ->> 'rate'                 as tap_rate
from public.points p
join public.matches m on m.id = p.match_id
where p.cut_t0 is not null
  and p.serve_start_at_cut_s is not null
  and p.scored_at_cut_s is not null;

comment on view public.point_boundaries is
  'One row per hand-marked point: where the owner said the serve began and '
  'where he scored it, in both clocks. The ground truth for point detection '
  'work — use this rather than points.deleted for anything about boundaries, '
  'padding or recall, and filter on `usable` (a few rows have the winner tap '
  'before the serve tap). See docs/research/2026-08-16-point-ends-and-junk.md.';

grant select on public.point_boundaries to authenticated;
