# Table-aware reseed in build_track — measured dead

**Verdict: do not build.** Zero serves and zero anchored cards moved, on
seven real matches, under five different tolerances. Production
(`worker/points_v2.py`) is unchanged.

## The idea

`build_track` in `worker/points_v2.py` resolves BlurBall's four candidates
per frame into one ball track by continuity: it extrapolates a constant
velocity from the last two positions and takes the nearest candidate to
that prediction. After `RESEED_GAP` (8) frames with no plausible
successor the chain gives up and restarts on the strongest candidate
anywhere in the frame, with no geometric constraint at all:

    best = max(cs, key=lambda c: c[2])

In a club with several tables in view that is exactly when the track can
be captured by somebody else's ball. The table is already available in the
same function — `Evidence.__init__` builds the homography two lines after
it calls `build_track` — so the proposal was to prefer a candidate near
the table at reseed only.

## How it was measured

`worker/eval/reseed_table_regression.py`. It re-runs the real
`build_track` over the raw candidate files, then the real `bounces`,
`crossings` and `serve_motifs` on top, so a change *inside* `build_track`
is measured end to end. Production functions are imported, never restated.

Corpus: the 7 matches with cached BlurBall candidates and a table quad.
`ae5400d5` excluded as broadcast footage.

Two baseline checks, both passed before anything changed:

- the rebuilt track equals the track stored in each evidence bundle
  **frame for frame**, all 7 matches;
- the anchored counts equal what `serve_slack_regression.py` already
  prints for those matches (18/29/96/57/36/77/97 = 410 of 586 cards),
  inside the 11-match total of 602 of 914.

The scaffold was proved to bite before its null result was believed: a
counter showed the reseed pick changing at 24 moments, and an inverted
predicate (prefer candidates *away* from the table) moved track on 6 of 7
matches.

## The result

Five predicates: the table-plane flight corridor (`in_corridor`), and
pixel distance to the quad at 0.25, 0.5, 1.0 and 2.0 times the near-end
width.

| tolerance | frames moved | serves | anchored | gained | lost |
| --- | --- | --- | --- | --- | --- |
| baseline | — | 451 | 410 / 586 | — | — |
| corridor | 56 | 451 | 410 / 586 | 0 | 0 |
| px 0.25 | 61 | 451 | 410 / 586 | 0 | 0 |
| px 0.50 | 84 | 451 | 410 / 586 | 0 | 0 |
| px 1.00 | 53 | 451 | 410 / 586 | 0 | 0 |
| px 2.00 | 27 | 451 | 410 / 586 | 0 | 0 |

Not a count coincidence: the serve *times* are identical to the
hundredth of a second in every match under every tolerance. Nothing
gained, nothing lost, nothing moved.

## Why — the number that explains it

The premise is right and the fix still cannot reach it. Census over all
3,140 reseeds in the corpus:

| | reseeds |
| --- | --- |
| total | 3,140 |
| seed lands **off** the table today | 1,975 (63%) |
| …of those, an on-table candidate existed in the same frame | **24** |
| …no on-table candidate to switch to | 1,951 |

The reseed does land away from the table most of the time. But 84% of
reseed frames carry exactly **one** candidate, so there is no decision to
re-rank. Preferring the table can only reorder a list, and at 1,951 of the
1,975 bad seeds the list has nothing better in it. The information needed
to make a better choice is not in the candidate file.

## Ceiling

To bound the whole idea rather than one weak version of it, every
off-table candidate was dropped from every frame — far more aggressive
than the proposal, and subtractive:

**410 → 375 anchored. 20 cards gained an anchor, 55 lost one.**

Worse, and in the way CLAUDE.md's table-detection section predicts: the
ball's important moments are above and beyond the table, so proximity to
the table surface deletes real track (lobs, the serve toss). Table
awareness inside `build_track` has no headroom above it.

## What this does not close

The reseed still lands off the table 63% of the time. That is a real
observation about dead-time tracking, and nothing here says the ball
track is good — only that the candidate cloud does not contain the better
answer, so re-ranking it cannot help. Any future attempt has to change
what BlurBall *offers*, not which of its offers gets picked. Cropping or
an ROI before detection is separately ruled out (the table is unknown at
that point, and a crop deletes the toss and the lob the apex test needs).
