-- 124: lets on the scoring bench, and the popup retired the same hour it
-- shipped. "That just became more annoying... I'll just give you start
-- point, end point, and then you can keep playing." The dialog paused
-- playback and demanded answers; the rhythm he wants is marks that never
-- interrupt, with the ball-location letters (and optionally the winner
-- arrows) tagging the LAST end retroactively while the video runs.
--
-- The one genuinely missing mark: a let — the serve is replayed, another
-- serve follows with no point end between. Boundary training needs to
-- know those serves are not new points.

alter table public.fullmatch_labels
  drop constraint if exists fullmatch_labels_kind_check;
alter table public.fullmatch_labels
  add constraint fullmatch_labels_kind_check
    check (kind in ('serve', 'end', 'let'));
