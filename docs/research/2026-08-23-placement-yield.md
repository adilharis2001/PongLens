# Why 12 of 98 points get a placement map

2026-08-23. Match `ec6490f4` (Chris, PingPod, 22 Aug, 21 min, fully scored).
Page: `docs/research/placement-review.html` (8 MB, self-contained: all 98
point clips inline, plus the app's own trajectory map per point).

The app reports 13 of 98 mapped. Running the app's own
`collectTrustedPlacementObservations` over the real `match.json` and the real
scored points reproduces **12** — the last point is almost certainly one
detected game-end override shifting a boundary, which moves which hypothesis
a point is judged against. Close enough that the model below is trustworthy.

## The finding

**The tracking is not the bottleneck.** The table was found by the keypoint
detector with 14 of 14 frames agreeing at 0.9 px spread. The ball was found on
every point: 1124 bounce candidates, median 10 per point, none at zero.

Median **raw** confidence, the sigmoid of the evidence score, is **0.871**.
Eighty-seven of 98 points clear the 0.72 bar on evidence alone. Twelve are
drawn. The difference is entirely veto rules.

## The confidence number is a cap

In `placement_reconstruction.py`:

```python
if finished["hard_reasons"]:      confidence = min(confidence, 0.69)
elif blocked_from_ready:          confidence = min(confidence, 0.71)
```

and in `placementAggregate.ts`, `PLACEMENT_AGGREGATE_TRUST_THRESHOLD = 0.7`.

So the worker caps to 0.69 precisely so it falls under a UI constant of 0.70.
A point whose evidence scored 0.93 is stored as 0.71 or 0.69 because a rule
fired. **The stored number is a verdict wearing a percentage**, and the two
files are coupled through a magic constant neither names.

Median stored confidence is 0.690 against a raw median of 0.871.

## Three locks in series

| lock | where | survivors |
| --- | --- | --- |
| evidence ≥ 0.72 | worker | 87 |
| none of 11 veto rules fired | worker | 18 |
| hypothesis matches the *scored* server | app | 12 |

The middle lock does the damage. The third is worth noting on its own: 23
hypotheses reach `ready`, but only the one matching the scored server counts,
so six good maps are discarded because the reconstruction and the scoring
disagree about who served.

## What the rules are actually testing

Counted on the hypothesis the app would use (they overlap, so they do not sum):

| reason | points | about | moves a landing? |
| --- | --- | --- | --- |
| `contact_too_close_after_landing` | 41 | racket contact timing | no |
| `unexpected_hitter` | 33 | who hit it | no |
| `contact_missing_before_landing` | 33 | racket contact missing | no |
| `terminal_observation_missing` | 28 | how the point ended | no |
| `landing_missing_before_contact` | 25 | rally ordering | no |
| `later_evidence_after_terminal` | 22 | events after the end | no |
| `landing_on_hitter_half` | 19 | geometry of a landing | **yes** |
| `terminal_inferred_from_suggestion` | 11 | how the point ended | no |
| `non_alternating_contacts` | 6 | rally ordering | no |

**Eight of nine are about the rally story, not about where the ball hit the
table.** The map draws bounce landings and deliberately never draws racket
contacts — `build_placement` says so, because contacts happen above the table
plane and projecting them is meaningless. A missing contact still discards
every landing in the point.

## What each relaxation is worth

Statuses recomputed from the stored `score` and `reasons`, then fed through the
app's own filter. The recomputation reproduces **all 212 stored hypotheses
exactly** before anything is varied.

| change | points | landings |
| --- | --- | --- |
| today | 12 | 29 |
| stop vetoing on contact detection | 23 | 75 |
| stop vetoing on how the point ended | 18 | 38 |
| both | 38 | 114 |
| … and serve-order soft | 40 | 117 |
| **judge on evidence only** | **76** | **235** |

76 of 98 is 78%, with no new tracking, no new model and no re-processing.

## Are the recovered landings good?

| | landings | on the table | median conf | serves on table |
| --- | --- | --- | --- | --- |
| drawn today | 29 | 100% | 0.82 | 10/10 |
| recovered | 206 | 100% | 0.82 | 59/59 |

Every recovered landing projects inside the physical table at the same
confidence as the ones already trusted, and every recovered serve lands on the
table. Noise would scatter; this does not.

**This is a plausibility check, not an accuracy check.** On-table does not mean
in the right place. The per-point page exists so the geometry can be judged by
eye, and that should happen before any of this ships.

## Recommendation

The checklist itself is worth keeping. Who hit each ball, when the bat touched
it and how the point ended is exactly what a point-winner detector needs, and
it is already computed on every point. The mistake is letting it decide whether
a **placement map** is drawn, when the map only needs to know where the ball
landed.

1. **Keep the checklist; stop letting it gate the map.** Run it, store its
   verdict, build the point-winner work on it. The map asks a shorter
   question of its own.
2. **The map's question is per landing, not per point.** A rally of eight
   bounces with one ambiguous contact loses all eight. The aggregate map is a
   distribution and tolerates a gap far better than absence.
3. **Stop encoding a verdict as a probability.** Keep the evidence confidence
   honest and carry the veto in its own field, so the worker stops being
   coupled to a UI constant it cannot see. A point-winner detector would want
   to read that field too.
4. **Use the better hypothesis when the scored server disagrees**, or find out
   which of the two is wrong. Six ready maps are lost to this alone.

Items 1 and 2 are worth about 76 of 98 on this match by themselves, and they
leave every input a point-winner detector needs exactly where it is.

## Not done

No production code was changed. Coverage against accuracy on a feature people
pay for is Adil's call, and the per-point review is the input to it.

## The page

Every point plays. Beneath each clip is the trajectory the app itself would
draw, produced by calling the production `buildPlacementRenderModel` with only
`status` and `hard_reasons` overridden, so a blocked point renders instead of
returning nothing — every coordinate, colour and carry line is the app's.
Beside it is the camera view with the detected quad and every bounce found,
green where it projected onto the table and red where it did not.

Clips are re-encoded to 480 px / 15 fps / CRF 30, no audio, which puts 98 of
them in 5.6 MB.

## Reproducing

`scratchpad` scripts are copied beside the page. The probe loads the real
`computeServing`, `computeMatchScore` and `collectTrustedPlacementObservations`
through a resolver hook rather than re-implementing them, so the counts are the
app's own.
