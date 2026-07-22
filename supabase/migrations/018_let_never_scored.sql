-- A let is never a scored point: forbid is_let + confirmed_winner coexisting.
-- (Applied to prod 2026-07-22 alongside the app-layer mutual exclusion:
-- setWinner clears is_let, setLet clears confirmed_winner.)
alter table public.points
  add constraint points_let_never_scored
  check (not (is_let and confirmed_winner is not null));
