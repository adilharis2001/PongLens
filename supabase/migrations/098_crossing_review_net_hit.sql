-- 098: net hits, labeled alongside the crossing-review verdicts.
--
-- Orthogonal to the verdict on purpose: a kept point with zero measured
-- crossings can be "real, never crossed" BECAUSE the serve clipped the
-- net, and a mid-rally net touch explains other short tracks. Collected
-- while the owner is already watching the footage, these become the
-- ground truth for a future net-strip motion detector.
--
--   serve — the ball hit the net straight off the serve
--   rally — the ball hit the net mid rally
alter table public.crossing_review_notes
  add column if not exists net_hit text
    check (net_hit is null or net_hit in ('serve', 'rally'));
