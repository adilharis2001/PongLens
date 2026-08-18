-- 122: how the point ended, physically — where the ball was last seen.
--
-- Adil's addition to the scoring bench, with his own merge: "in the end
-- we're saying the ball was last seen on the far side in the point."
-- Who won is already captured on the end mark; this adds the ball's
-- final whereabouts, which is the axis that validates tracking:
--
--   far    last seen past the far side (long, or a winner)
--   near   last seen toward the camera
--   net    died at the net and rolled back — never exits the prism
--   table  died on the table (double bounce / no return) — ditto
--
-- The last two are precisely the endings the prism-exit signal cannot
-- see (54% of endings have no final exit), so these labels teach the
-- end-detector its blind spots per class.

alter table public.fullmatch_labels
  add column if not exists end_kind text
    check (end_kind is null
           or end_kind in ('far', 'near', 'net', 'table'));
