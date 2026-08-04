# Dead-space round 5c — clip floors (2026-08-04)

## What the labels said

77 human labels on Thanakorn match 2 (cut_labels, admin players portal),
graded from the per-point clips: 25 perfect, 22 start_cut, 7 end_cut,
2 both_cut, 11 warmup, 2 dead_space, 8 split/join verdicts. A third of
the gradable points had a clipped edge, and a clip missing its end
doesn't even show who won the point.

## The diagnosis that mattered

The assembled cut video was NOT the problem: for the flagged start-cut
points its segments began a median 8.9s before t0 (round 5b's walks did
their job). What every viewer actually watches per point — the clip
files, cut_t0 seeks, reel windows — was anchored at the fixed pads
t0-0.6 / t1+0.9 around MOTION boundaries.

Frame-by-frame review of flagged points: serves start ~2-2.5s before t0
(settle, toss — slow toss motion reads as stillness to the tracker, so
the walk-back stops dead: p54 walked back 0.00s past a serve that
visibly started 2s earlier), and the ball's dying flight plus the
point's visible resolution runs ~2s past t1.

## Why floors beat walks for clips

Swept against all 77 labels:

| rule                          | starts fixed | ends fixed | bloat/clip | m2 retention |
|-------------------------------|--------------|------------|------------|--------------|
| today (0.6/0.9)               | 0/24         | 0/9        | —          | 70.8%        |
| floors 2.5/2.0                | 24/24        | 9/9        | +3.0s      | 73.8%        |
| floors + walks (variants)     | 24/24        | 9/9        | +6.2-7.9s  | 77.7-78.9%   |
| walks only                    | 17/24        | 4/9        | +6.6s      | 77.2%        |

Walks either stop dead in a detection hole at the serve or saturate on
between-point retrieval. Flat floors cover everything the labels flagged
at half the bloat.

## What shipped (725ef382)

- CLIP_PADS -> (2.5, 2.0) (loose keeps its 2.4 post).
- play_edge_windows folds the clip floor into every segment window
  before pads apply — clips exist inside the cut structurally, at any
  strictness, replacing the pads-comparison invariant test.
- SEGMENT_PADS -> 0.15 whisker: with floors carrying the context, the
  old 0.6/0.9 on top was double padding (+3-4pt retention for margin
  nobody sees).

Referee (m2): parity IDENTICAL, 72.3% vs 70.0% shipped — all 33 flagged
edges covered for ~2pt. Ryuchi dry-run: parity IDENTICAL, 87.9%.

## The honest shape of retention now

Edge context is ~4.5s per point, so retention scales with point density:

- Thanakorn m2, sparse (71 pts / 17min): 72.3% — real savings survive.
- Ryuchi, dense (66 pts / 14.5min, 13s/point cycle): 87.9%, vs 73.9%
  under r5b construction. That +14pt is NOT regression fat — a 13s cycle
  holds serve (2.5s) + rally + ending (2s) nearly back to back; the r5b
  numbers looked better by cutting serves and endings out of points,
  which is what the labels caught. Dense matches sit near their floor
  (spans mode kept 88.3% on Ryuchi — same footage, worse boundaries).

Deeper cuts now require moving t0/t1 themselves (serve-contact/rally-end
anchoring — scored_at_cut_s labels and cut_labels are the training
corpus), not tighter pads. The multi_2/3/4 and half_point labels point
at split_plays quality, untouched this round.

## Swap

m2 swapped to -r5d (guarded: t0/t1 parity re-verified in-transaction,
new key, atomic cut_path/result_path/clip_pads/cut_t0 flip, old object
deleted, ledger reconciled). The 71 clip files and match.json were
re-cut and replaced IN PLACE under points/{user}/{match}/ — first round
where clips changed, since the labels graded the clips themselves.
