-- 099: the verdicts the reviewer's own notes asked for.
--
-- After labeling 47 crossing-review cards, 14 carried a free-text note
-- and no verdict — the taxonomy was missing their classes. The notes
-- cluster cleanly (five describe switching sides after a game, four
-- describe pre-serve preparation with no toss, two describe a real point
-- chopped across card boundaries), so those become one-tap options:
--
--   switching_sides — game over, players walk their sides, ball carried
--   serve_prep      — retrieval, bouncing, walking to position, table
--                     wiping; no toss to the other player, no play
--   cut_apart       — the card contains fragments of real point(s)
--                     split across boundaries (a cutting defect, not a
--                     junk-detection one)
alter table public.crossing_review_notes
  drop constraint if exists crossing_review_notes_verdict_check;

alter table public.crossing_review_notes
  add constraint crossing_review_notes_verdict_check
  check (verdict is null or verdict in
    ('measurement_miss', 'label_wrong_junk', 'no_cross_real',
     'handover', 'label_wrong_real', 'ghost',
     'switching_sides', 'serve_prep', 'cut_apart'));
