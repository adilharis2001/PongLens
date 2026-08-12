-- 099: who won a game the score can't prove.
--
-- A pinned 'end' (points.game_end_override) can close a game at a score
-- the 11-clear-by-2 rule has nothing to say about — a cut ate points, the
-- recorded score reads 10-7, and the game genuinely ended there. gameWinner
-- returns null for that segment, so the games tally counted it for nobody
-- and the match header under-reported games won.
--
-- The owner names the winner when they pin the end (Keep score asks the
-- moment the pinned score proves nothing). Stored on the SAME point the
-- 'end' override sits on; cleared alongside it when the end is unpinned.
-- Where the score does prove a winner the override is redundant and the
-- app never asks — but if one is set it wins, human answer over heuristic.
alter table points
  add column game_winner_override text
  check (game_winner_override in ('user', 'opponent'));

comment on column points.game_winner_override is
  'Owner-named winner of the game that ends at this point, for game ends the 11-clear-by-2 rule cannot prove (points lost to a cut). Read with game_end_override; user = the uploader.';

-- The authenticated role's UPDATE grant on points is column-scoped, so the
-- new column needs its own grant or every owner write to it is a 403 —
-- silently rolled back by the optimistic writer, which is how it was found.
grant update (game_winner_override) on points to authenticated;
