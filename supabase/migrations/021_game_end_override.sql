-- 021: user-overridable game boundaries.
-- Applied via direct Postgres connection (worker pooler URL); keep in sync
-- with the Supabase project.
--
-- The 11-with-2-clear heuristic (gameScore.ts / serving.ts) closes games
-- automatically, but one mis-scored point (a missed net ball, a rally the
-- detector split wrong) makes the auto boundary fire somewhere REALITY
-- didn't — the visible side-switch in the video is the truth. The owner
-- can now pin a boundary per point:
--
--   'end'      — a game ends after this point, regardless of the score.
--   'continue' — the game does NOT end here: the auto rule is suppressed
--                from this point on (no re-firing at 12-7, 13-7, ...)
--                until a later explicit 'end' closes the game. With no
--                later 'end', the game simply runs on as the current one.
--   null       — automatic (the 11+2-clear heuristic).
--
-- The walk only reads overrides on SCORED points (confirmed_winner set,
-- not skipped) — an override left behind on a point that later becomes
-- skipped/unscored is ignored, same as its score contribution.

alter table public.points
  add column if not exists game_end_override text
  check (game_end_override in ('end', 'continue'));

-- Column-restricted client grant (003/005/007 pattern; grants are
-- additive): owners flip boundaries from the scorecard and Keep score.
grant update (game_end_override) on public.points to authenticated;

comment on column public.points.game_end_override is
  'Owner override of the auto game boundary after this point: end = game ends here regardless of score; continue = suppress the auto 11+2-clear rule from here until an explicit end; null = automatic. Only read on scored points (confirmed_winner set, not skipped).';
