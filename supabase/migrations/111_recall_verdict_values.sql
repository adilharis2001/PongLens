-- 111: let the recall review store the verdicts the page actually sends.
--
-- 110 pinned the verdict vocabulary to the five values the first version of
-- /research/recall offered. The page has since narrowed to four, renamed
-- around points rather than rallies, and nobody updated this constraint —
-- so every save was rejected by Postgres, the optimistic update rolled back,
-- and pressing 1-4 did nothing at all. It looked like a dead keyboard
-- handler and was a schema mismatch.
--
-- The old three values stay allowed so the verdicts already collected on
-- Prabhas (27 of them) are not orphaned by a name change.
--
--   point_whole    a real point, and the clip holds all of it
--   point_clipped  a real point, but it opens after the serve or ends
--                  before the outcome is visible
--   junk           no point here
--   unsure         cannot tell from the footage
alter table public.recall_review_notes
  drop constraint if exists recall_review_notes_verdict_check;

alter table public.recall_review_notes
  add constraint recall_review_notes_verdict_check
  check (verdict is null or verdict in
    ('point_whole', 'point_clipped', 'junk', 'unsure',
     'rally_whole', 'rally_clipped', 'rally_multi'));
