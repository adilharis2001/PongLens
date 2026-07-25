-- Point DIRECTION: where the deciding ball was placed on the opponent's
-- side — forehand / backhand / middle. The single most-requested tactical
-- dimension (serve placement, winner placement, forced-error placement).
--
-- Orthogonal to confirmed_how (which now carries QUALITY: winner / forced /
-- unforced error — no schema change needed, just new confirmed_how values).
--
-- Nullable: optional per point, may be pre-filled from the vision's final
-- bounce and confirmed/corrected by the player. 'mid' = the crossover/elbow.
alter table public.points
  add column if not exists direction text
    check (direction in ('fh', 'bh', 'mid'));

-- `authenticated` holds COLUMN-level UPDATE grants on points (there is no
-- table-wide UPDATE for that role), so a newly-added column is NOT writable
-- by the owner until granted explicitly — the owner could read direction but
-- every save silently failed with a permission error. Grant it here.
grant update (direction) on public.points to authenticated;
