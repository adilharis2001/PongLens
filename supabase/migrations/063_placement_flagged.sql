-- 063: "this map is wrong" — one tap, from the map itself.
--
-- Placement maps are computer vision on top of a table calibration that is
-- not always right. The app already says "beta"; this is the other half —
-- a way for the person looking at a wrong map to say so, where they are
-- looking at it, without composing a sentence about it.
--
-- Two scopes, because there are two failure modes:
--   points.placement_flagged  — this one point's trajectory is wrong
--                               (usually a bad ball track in one rally);
--   matches.placement_flagged — the whole map is wrong (usually the table
--                               calibration, which poisons every point).
--
-- Both are OWNER-WRITABLE and act on what is shown: a flagged point stops
-- feeding the match-level maps, and a flagged match hides its placement
-- section outright. That is the point — an override the user can actually
-- exercise beats a caveat they can only read. Undo is the same tap again.
--
-- They are also the feedback channel. A boolean the owner set while
-- looking at a specific map is a cleaner signal than prose, and it joins
-- straight to the placement rows that produced it:
--
--   select p.id, p.match_id, p.placement
--     from points p where p.placement_flagged;
--
-- Nothing here deletes or rewrites placement data; the vision's output
-- stays exactly as generated, and unflagging restores the map as it was.
alter table public.points
  add column if not exists placement_flagged boolean not null default false;

alter table public.matches
  add column if not exists placement_flagged boolean not null default false;

-- `authenticated` holds COLUMN-level UPDATE grants on both tables, so a new
-- column is readable and silently unwritable until granted. This is what
-- broke points.direction in 030 and the reason 032 says to grant every new
-- column in the same migration that adds it.
grant update (placement_flagged) on public.points to authenticated;
grant update (placement_flagged) on public.matches to authenticated;

-- Row security is unchanged: the existing owner policies on points and
-- matches already scope every update to the row's owner, and coaches hold
-- read-only access, so a shared viewer cannot flag someone else's map.

-- Partial index: the flagged rows are the ones anybody ever queries for,
-- and they are a tiny minority of both tables.
create index if not exists points_placement_flagged_idx
  on public.points (match_id)
  where placement_flagged;
