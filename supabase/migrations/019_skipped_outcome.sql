-- Point outcomes: one per point — user | opponent | SKIPPED | unscored.
-- is_let (column name kept for its many dependents) is now the generalized
-- "skipped" flag; the optional skip reason lives in confirmed_how
-- ('let' | 'misrecorded' | 'other'). Winner-hows no longer include 'let':
-- a let was never a way to WIN a point, so rows stored as winner+how='let'
-- were miscounted in the score. Convert them to the skipped outcome
-- (constraint points_let_never_scored requires winner null + is_let true
-- in the same write).

-- 1) how='let' rows that carried a winner -> skipped, winner cleared.
update public.points
set confirmed_winner = null, is_let = true
where confirmed_how = 'let' and confirmed_winner is not null;

-- 2) any remaining how='let' rows (winner already null) -> flagged skipped
--    for consistency.
update public.points
set is_let = true
where confirmed_how = 'let' and not is_let;

comment on column public.points.is_let is
  'Skipped-outcome flag (name kept from the let-only days). A skipped point never scores and never advances the serve rotation; the optional reason is in confirmed_how (let | misrecorded | other). Never coexists with confirmed_winner (points_let_never_scored).';
