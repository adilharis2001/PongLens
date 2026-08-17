# How many frames the table detector needs

660 real single frames, 20 from each of 33 matches, run through the shipping
detector unmodified (`segformer++ b0` on CPU, no TTA, fitter at
`k=5, tol_frac=0.10, beta=0.90, min_cam_height=0.35`). Nothing was retuned.
Scoring is the same metric as before, with the reflected corner order added:

```
error% = 100 * min over 4 cyclic rotations AND the reflected order of
         ( median euclidean corner distance ) / hypot(source_width, source_height)
```

## The short answer

**Sixteen frames, and yes, more frames rescues most of it — but not because
the frames agree.** They rescue it because with sixteen frames you can throw
away the bad ones and let the rest outvote what is left.

- The naive rule asked for — medoid of N quads, no filtering — **does not
  converge**. From N=6 to N=20 it stays between 3 and 5 of 29 matches above
  5%, moving up as often as down, and individual matches flip between tables
  as frames are added.
- Filter each frame first (the detector's own `weight >= 6`, no corner more
  than 5% of the diagonal outside the picture, longest/shortest edge ratio
  <= 4), then take the largest cluster of surviving quads. That takes
  P(answer more than 2% off) from 14.3% at N=1 to 1.6% at N=12, 0.2% at N=16
  and 0 at N=20, on 29 hand-marked matches.
- **Recommended N = 16.** N=16 is where the worst answer anywhere in the
  sweep stops being catastrophic: at N<=15 a bad draw can still return a quad
  25% of the diagonal off; from N=16 the worst is 3.8% and from N=18 it is
  2.4%. The decline rate has already flattened at 7% by N=8, so the extra
  frames buy accuracy, not coverage. 16 frames is 6.2 s of CPU per match.
- **Recommended gate: at least 3 frames survive the per-frame filter, and the
  largest cluster holds at least half of them.** On this corpus that gate
  declines 2 matches for too few frames (both the dark PingPod pod, which are
  the same video twice) and 1 for disagreement (the phone clip of a broadcast,
  which is genuinely not one fixed camera). It never declined a marked match
  it would have got right.
- **A disagreement threshold on its own is not safe.** Two frames that both
  land on the same wrong table agree with each other to 0.03% of the
  diagonal. 15% of frame pairs where *neither* frame is correct agree to
  better than 1%. Agreement measures stability, and this detector's failures
  are frequently stable.

## What is in the set

| | |
| --- | --- |
| matches | 33: the 21 with a non-`correct` holdout frame, plus 12 controls whose holdout frames were all graded `correct` |
| frames | 660, 20 per match, evenly spread from 6% to 94% of each video's duration |
| source | the cut videos; 640 frames 1920x1080, 20 frames 608x1080 (`3821ede7`) |
| preparation | decoded at native resolution over a presigned R2 URL, then resized the production way, longest side 1600 |
| detector refusals | 0 of 660 |
| runtime | median 0.388 s per frame on CPU, mean 0.393 s, max 0.74 s, 260 s for the whole set |
| tables competing per frame | median 7 hypothesis clusters |
| distinct scenes | **30, not 33** — see below |

### Three pairs of these match ids are the same video

This was checked rather than assumed, by comparing `cut_path` and then the
decoded pixels, and it changes how the counts should be read:

| pair | relationship | evidence |
| --- | --- | --- |
| `a0fb8f44` / `efff9208` | the same `cut_path` | frames byte-identical |
| `4da91dde` / `a38ca7c0` | the same `cut_path` | frames byte-identical |
| `431837d2` / `cff81f99` | different files, same footage re-encoded | identical duration to 0.01 s, mean absolute pixel difference 0.87 of 255 |

So the 21 flagged matches are **18 distinct scenes**, the 29 marked matches are
**27 distinct scenes**, and — this is the one that matters most — **the three
`wrong_table` matches are two distinct scenes**, not three. Counts below are
given per match because that is what production sees, but every conclusion
should be read as resting on 27 scenes.

A useful side effect: `4da91dde` has no mark of its own, but it is the same
video as `a38ca7c0`, which has one. Its numbers are `a38ca7c0`'s.

The 12 controls are there for one reason: a catch rate without a false alarm
rate is not a measurement. They were picked deterministically, spread over
venues, from the 45 all-`correct` matches that also carry a hand mark.

## Ground truth

`table_calibration_review.corrected_corners` supplies the mark for **17 of the
21 flagged matches and all 12 controls — 29 matches, 580 frames.** These are
authoritative and are used exactly as stored, in source pixels.

**Four flagged matches have no mark and are excluded from every accuracy
number**: `3821ede7` (the `unusable` phone clip), `4da91dde`, `71930254` and
`abcdd301`. They appear only in the agreement statistics, in their own section
below. `4da91dde` is the exception noted above: it is the same video as
`a38ca7c0` and therefore does have a mark by proxy.

`efff9208`'s review row is marked `duplicate_of` `a0fb8f44`, which the pixel
check confirms: they are the same file. They behave identically throughout.

### The first thing the marks say

Scored per frame, before any pooling:

| | frames | median error | within 1% | more than 5% off |
| --- | --- | --- | --- | --- |
| the 17 flagged matches | 340 | 0.95% | 51% | 39% |
| the 12 control matches | 240 | 0.34% | 77% | 13% |

**13% of single frames from matches the owner graded `correct` are more than
5% of the diagonal off.** The holdout graded one frame per match, so that
81-of-105 `correct` rate was in part a lottery on which second of the video was
sampled. This is the strongest argument in the whole study for not shipping a
single-frame answer, and it comes from the matches that passed.

## Curve 1: the rule as specified — medoid of N quads, no filtering

First N frames in time order, medoid = the quad with the smallest total
distance to the others, scored against the mark. 29 marked matches.

| N | median error | within 1% | within 2% | above 5% |
| --- | --- | --- | --- | --- |
| 1 | 1.90% | 14 | 15 | 11 |
| 2 | 1.90% | 14 | 15 | 11 |
| 3 | 0.43% | 18 | 19 | 8 |
| 4 | 0.36% | 19 | 19 | 9 |
| 5 | 0.40% | 17 | 18 | 9 |
| 6 | 0.36% | 23 | 24 | 3 |
| 8 | 0.36% | 21 | 23 | 4 |
| 10 | 0.36% | 22 | 23 | 4 |
| 12 | 0.37% | 22 | 25 | 4 |
| 16 | 0.41% | 22 | 24 | 4 |
| 20 | 0.41% | 22 | 25 | 3 |

**It plateaus at N=6 and then stops improving.** Between N=6 and N=20 the
median moves by 0.05% and the number of gross failures moves between 3 and 5,
up as often as down. Individual matches flip back and forth: `98be5eb5` reads
0.14% at N=12, 21.70% at N=16 and 0.19% at N=20.

Two things are wrong with this rule, and they are worth naming because they
are not obvious.

**The medoid is decided by the failures, not by the successes.** When eleven
quads sit on the right table within 0.3% of each other and seven sit on a table
25% away, every one of the eleven has almost the same total distance, and the
tie between them is broken by which is marginally nearer the seven. That is how
`cff81f99` returns 2.11% when the tightest member of its own good cluster is
0.13%.

**Adding a frame can move the answer to a different table.** The medoid is not
monotone in N, so "we looked at more frames" is not by itself "we are more
sure".

## Curve 2: largest cluster, then medoid inside it

Cluster the N quads by overlap — the same IoU >= 0.5 test the fitter already
uses to decide two hypotheses are the same physical table — keep the biggest
cluster, and take the medoid within it. One line of code more than curve 1.

| N | median error | within 1% | within 2% | above 5% | P(above 2%) over random subsets |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.90% | 14 | 15 | 11 | 34% |
| 2 | 0.40% | 20 | 21 | 5 | 24% |
| 3 | 0.42% | 20 | 21 | 7 | 22% |
| 4 | 0.40% | 21 | 22 | 6 | 19% |
| 6 | 0.30% | 24 | 25 | 3 | 17% |
| 8 | 0.31% | 23 | 24 | 5 | 15% |
| 10 | 0.29% | 23 | 23 | 5 | 14% |
| 12 | 0.29% | 25 | 25 | 4 | 12% |
| 16 | 0.29% | 26 | 26 | 3 | 11% |
| 20 | 0.31% | 26 | 26 | 3 | 10% |

Better and much steadier, but **still 3 matches above 5% at N=20 and a 10%
chance of a bad answer.** Voting alone is not enough, and the reason is
`cb0e7027`, below.

## Curve 3: filter each frame, then vote — the recommendation

The filter is the two checks already recommended in `KEYPOINT_FINDINGS.md` and
`HOLDOUT_FINDINGS.md`, applied per frame before pooling rather than after:

```
keep the frame if  weight >= 6
               and no corner more than 5% of the diagonal outside the picture
               and longest edge / shortest edge <= 4
```

First N frames in time order, 29 marked matches:

| N | matches answering | declined | median error | within 1% | within 2% | above 5% | worst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 19 | 10 | 0.40% | 14 | 15 | 3 | 8.05% |
| 2 | 24 | 5 | 0.38% | 20 | 21 | 2 | 8.05% |
| 3 | 25 | 4 | 0.30% | 22 | 23 | 1 | 8.05% |
| 4 | 25 | 4 | 0.33% | 21 | 22 | 2 | 8.05% |
| 6 | 26 | 3 | 0.29% | 24 | 25 | 0 | 2.11% |
| 8 | 27 | 2 | 0.29% | 25 | 26 | 1 | 25.22% |
| 10 | 27 | 2 | 0.29% | 26 | 26 | 0 | 2.11% |
| 12 | 27 | 2 | 0.29% | 27 | 27 | 0 | 0.99% |
| 14 | 27 | 2 | 0.29% | 27 | 27 | 0 | 0.56% |
| 16 | 27 | 2 | 0.29% | 27 | 27 | 0 | 0.56% |
| 20 | 27 | 2 | 0.31% | 27 | 27 | 0 | 0.54% |

Taking the first N frames of a video is one draw out of many, so the same sweep
averaged over 300 random subsets per match — which is what removes the
ordering artefact and is the number to quote:

| N | P(declines) | median error | P(error > 1%) | P(error > 2%) | P(error > 5%) |
| --- | --- | --- | --- | --- | --- |
| 1 | 32% | 0.33% | 17.6% | 14.3% | 10.8% |
| 2 | 17% | 0.33% | 12.7% | 9.2% | 5.7% |
| 3 | 12% | 0.32% | 12.6% | 9.7% | 6.5% |
| 4 | 10% | 0.31% | 10.0% | 7.4% | 4.2% |
| 5 | 8% | 0.31% | 9.6% | 7.4% | 4.9% |
| 6 | 8% | 0.31% | 7.6% | 5.3% | 3.3% |
| 8 | 7% | 0.30% | 5.7% | 3.7% | 2.3% |
| 10 | 7% | 0.29% | 4.4% | 2.2% | 1.4% |
| 12 | 7% | 0.29% | 3.3% | 1.6% | 1.0% |
| 14 | 7% | 0.29% | 2.4% | 0.9% | 0.4% |
| 15 | 7% | 0.29% | 2.4% | 0.8% | 0.5% |
| **16** | **7%** | **0.29%** | **1.7%** | **0.2%** | **0.0%** |
| 18 | 7% | 0.29% | 1.4% | 0.0% | 0.0% |
| 20 | 7% | 0.29% | 0.0% | 0.0% | 0.0% |

**Two different things plateau at two different places.** Coverage — the
chance that any frame survives the filter — is done by N=7 and sits at 7%,
which is the two dark-pod matches and nothing else. Accuracy keeps improving
all the way to 20, because the vote is a majority over a genuinely bimodal
per-frame distribution and majorities get more reliable with more votes.

The median never moves. From N=1 onwards it is 0.29% to 0.33%. **More frames
does nothing for a match that was going to be right; it only converts the
matches that were a coin flip.**

### The whole rule, swept

Filter, cluster, decline unless at least 3 frames survived and the largest
cluster holds at least half of them, answer with the medoid of that cluster:

| N | declines | median error | P(error > 1%) | P(error > 2%) | worst |
| --- | --- | --- | --- | --- | --- |
| 3 | 55% | 0.31% | 13.5% | 11.7% | 28.4% |
| 4 | 36% | 0.30% | 8.9% | 7.4% | 28.4% |
| 6 | 19% | 0.30% | 6.4% | 4.6% | 28.4% |
| 8 | 12% | 0.29% | 6.1% | 3.7% | 27.0% |
| 10 | 10% | 0.29% | 4.5% | 2.5% | 28.4% |
| 12 | 9% | 0.29% | 3.4% | 1.7% | 25.2% |
| 14 | 8% | 0.29% | 2.3% | 0.8% | 24.9% |
| **16** | **7%** | **0.29%** | **1.7%** | **0.2%** | **3.8%** |
| 18 | 7% | 0.29% | 1.4% | 0.1% | 2.4% |
| 20 | 7% | 0.29% | 0.0% | 0.0% | 0.5% |

The `worst` column is why the answer is 16 rather than 12. Up to N=15 there
exists a draw of frames that returns a quad a quarter of the picture away from
the table. At N=16 the worst draw anywhere in 8,700 simulated runs is 3.8%.

It is not knife-edge. Every variation tried at N=16 — `min_keep` 1/2/3,
agreement 0.4/0.5/0.6, weight gate 5/6/7 — lands between 0.0% and 0.6% for
P(error > 2%), at a decline rate between 7% and 16%.

At N=20 the rule answers on 31 of 33 matches, every marked answer is within
0.54%, and the declines are `a0fb8f44`, `efff9208` (no frame survives) and
`3821ede7` (frames disagree).

## Does disagreement predict error?

The earlier read — 0.27% between frames graded `correct`, 4.15% between
non-`correct` — reproduces, and on 5,510 frame pairs it is sharper:

| frame pair | pairs | median disagreement | 90th percentile | agree to better than 1% |
| --- | --- | --- | --- | --- |
| both frames within 1% of the mark | 2,423 | 0.14% | 0.52% | 96% |
| one correct, one not | 1,937 | 7.06% | 26.83% | 3% |
| **neither correct** | **1,150** | **10.57%** | **25.60%** | **15%** |

The third row is the finding. **15% of pairs where both frames are wrong agree
with each other to better than 1% of the diagonal** — as tightly as two correct
frames do. The wrong-table clusters inside `98be5eb5` and `431837d2` have
internal spreads of 0.03% and 1.42%. Disagreement is evidence of instability,
and instability is only one of the two failure modes.

As a gate on the pooled answer, over all 29 marked matches:

| signal | N | AUC | threshold | catch (answer > 2% off) | false alarm | accepted |
| --- | --- | --- | --- | --- | --- | --- |
| median pairwise disagreement | 2 | 0.89 | 1.18% | 93% | 7% | 52% |
| median pairwise disagreement | 8 | 0.91 | 6.41% | 100% | 17% | 66% |
| median pairwise disagreement | 16 | 0.97 | 12.95% | 100% | 4% | 79% |
| median pairwise disagreement | 20 | 0.94 | 8.58% | 100% | 12% | 76% |
| largest cluster below X of N | 12 | 1.00 | 0.42 | 100% | 0% | 86% |
| largest cluster below X of N | 16 | 1.00 | 0.62 | 100% | 0% | 90% |
| **largest cluster below 9 of 20** | **20** | **1.00** | **0.45** | **100%** | **0%** | **90%** |

**The best disagreement signal is not the spread, it is what share of the
frames voted for the winning table.** At N>=12 it separates perfectly on this
corpus. Be careful with that "perfectly": the worst accepted match sits at 9
of 20 and the best declined at 8 of 20, so the margin is one frame. Treat it
as a sanity backstop, not as the thing carrying the safety.

The threshold on the raw spread is much less stable — the best value moves
between 1.18% and 14.06% depending on N — because it is trying to separate two
distributions that overlap by construction.

## The three wrong-table matches, individually

This was the crux question: does the medoid converge on the right table, or do
the frames agree with each other on the wrong one? Montages are saved beside
this file, one panel per frame, quads coloured by which physical table they
belong to and the owner's mark drawn in white on every panel.

### `431837d2` — no venue set, `montage_431837d2.jpg`

| cluster | frames | error of its medoid | internal spread | median weight |
| --- | --- | --- | --- | --- |
| 1 | 12 | **0.50%** | 1.12% | 8.39 |
| 2 | 7 | 24.75% | 1.42% | 7.33 |
| 3 | 1 | 14.78% | - | 6.12 |

Three distinct tables over 20 frames. The plurality is the correct one, the
runner-up is a table two rows further back in the hall, and the frames inside
each cluster agree tightly. **Unstable, not consistently wrong.** Voting
rescues it: at N=20 the answer is 0.50%. The per-frame filter does not help
here — 19 of 20 frames pass it, including **all seven** of the wrong-table
frames, at weights of 6.4 to 8.7. The one frame it drops is the single-frame
cluster, on edge ratio.

### `98be5eb5` — Westchester TTC, `montage_98be5eb5.jpg`

| cluster | frames | error of its medoid | internal spread | median weight |
| --- | --- | --- | --- | --- |
| 1 | 10 | **0.14%** | 0.15% | 7.84 |
| 2 | 6 | 21.72% | **0.03%** | 5.73 |
| 3 | 3 | 28.41% | 1.84% | 6.20 |
| 4 | 1 | 38.25% | - | 5.82 |

Half the frames are right and half are spread over three wrong tables. The
correct cluster is still the plurality, 10 against 6. **Note cluster 2's
internal spread: 0.03%.** Six frames pick the same wrong table and agree with
each other about twenty times more tightly than the correct cluster does. This
is the exact case an agreement gate cannot see. What separates them is the
weight — 5.4 to 5.9 for cluster 2, 6.2 to 8.6 for cluster 1 — so the
`weight >= 6` filter removes all six before the vote runs.

### `cff81f99` — Westchester TTC, `montage_cff81f99.jpg`

| cluster | frames | error of its medoid | internal spread | median weight |
| --- | --- | --- | --- | --- |
| 1 | 11 | **0.13%** | 0.34% | 8.99 |
| 2 | 7 | 24.92% | 1.41% | 7.38 |
| 3 | 1 | 18.56% | - | 6.79 |
| 4 | 1 | 15.81% | - | 6.03 |

**This is the same footage as `431837d2`, re-encoded under a second match id**
— identical duration, mean pixel difference under 1 of 255. The two rows are
one scene, and the near-identical cluster structure (11/7 against 12/7, the
same frames in the wrong cluster: 2, 3, 5, 7, 12, 16, 18) is what a
reproducibility check looks like rather than independent evidence. Plurality
correct, and the wrong cluster carries weights of 6.4 to 8.8, so the filter
cannot touch it. Voting alone gets this one.

### The verdict on the three

**The detector is not consistently wrong on any of them. It is unstable, and
the correct table is the plurality in all of them.** A multi-frame rule does
rescue these cases, which is the good news the study was looking for. Read it
as two scenes rescued, not three.

The bad news sits beside it. In both scenes the runner-up cluster is 6 or 7
frames — 30-35% of the video — landing on one specific wrong table with high
internal agreement. Nothing about those frames looks uncertain from the
inside: `431837d2` frame 5 puts the quad on a table 25% away with an inlier
weight of 8.73, higher than the median weight of that same match's correct
cluster. **If you
draw three frames and two land in the runner-up, the vote confidently returns
the wrong table and the disagreement between them is 1.4%.** That is why the
answer to "how many frames" is sixteen rather than three.

## `cb0e7027` — the counterexample to voting

The most important match in the study, and the reason voting alone is not the
recommendation. `montage_cb0e7027.jpg`.

| cluster | frames | error of its medoid | internal spread | median weight | what it is |
| --- | --- | --- | --- | --- | --- |
| 1 | 8 | 40.02% | 0.16% | 6.32 | the neighbouring table to the left |
| 2 | 6 | 18.17% | 11.64% | 5.47 | slivers stitched across two tables |
| 3 | **5** | **0.25%** | 0.15% | 7.66 | the table being played on |
| 4 | 1 | 5.75% | - | 5.78 | |

**The plurality is a wrong table.** Eight frames agree on the table to the
left, five on the correct one. Largest-cluster voting over all 20 frames
returns 40% error — worse than the median single frame.

The per-frame filter is what saves it, and specifically the geometry check:
every frame in cluster 1 puts a corner 21% to 29% of the diagonal outside the
picture, because that neighbouring table runs off the left edge of frame.
Cluster 2 fails on edge ratio (4.2 to 5.6). Four frames survive the filter, all
four are from cluster 3, and the answer becomes 0.28%.

So the two mechanisms are not redundant — each covers a case the other cannot:

| match | what fixes it | what does not |
| --- | --- | --- |
| `431837d2`, `cff81f99` | the vote (plurality is correct) | the filter — the wrong frames have weights of 6.4 to 8.8 |
| `cb0e7027` | the filter (geometry) | the vote — the plurality is a wrong table |
| `98be5eb5` | either, and both | |
| `a0fb8f44`, `efff9208` | nothing — refuse | both; there is no correct frame to find |

## Per-match or per-frame?

Both, and they need different answers.

**Per-frame (transient), and more frames fixes it.** Fifteen of the 17 flagged
matches have at least one frame within 1% of the mark; eight of them have more
than half their frames within 1%. `51625364` runs from 0.41% to 39.63% across its
own 20 frames of a fixed camera. `15be004a`, graded `correct` on one holdout
frame and `loose` on the other, has 11 of 20 within 1% and 4 above 5%. This is
the dominant mode.

**Per-match (the scene), and more frames does not fix it.** `a0fb8f44` and
`efff9208` are one video — the dark PingPod pod with a bright window behind a
dark table:
**0 of 20 frames within 2%**, best frame 2.66%, 11 distinct clusters over 20
frames with no cluster bigger than 3. There is nothing to vote for. Every
frame's weight is between 2.1 and 3.6, so the existing `weight >= 6` gate
refuses the match outright, which is the right outcome. This scene was already
the known worst case on both the development corpus and the holdout; three
independent samplings now agree it is a class, not a fluke.

`cb0e7027` is the third kind: a scene where the detector has a systematic
preference for the wrong neighbour. Its correct frames are the minority, but
they are cleanly separable by geometry, so it is recoverable — with a filter,
not with more votes.

## Cheap per-frame signals

Over all 580 marked frames, against "this frame is more than 2% off":

| signal | flag when | AUC | best threshold | catch | false alarm |
| --- | --- | --- | --- | --- | --- |
| **edge ratio (longest/shortest)** | high | **0.94** | 2.41 | 83% | 1% |
| inliers | low | 0.89 | 8 | 91% | 24% |
| inlier weight | low | 0.87 | 6.56 | 86% | 20% |
| camera height from the homography | low | 0.68 | 0.52 m | 54% | 2% |
| number of table hypotheses | high | 0.64 | 8 | 59% | 36% |
| worst corner outside the frame | high | 0.60 | any | 20% | 1% |
| median residual | high | 0.56 | 3.34 px | 43% | 24% |
| area fraction | low | 0.29 | - | - | - |

**The edge ratio is the best per-frame signal there is and it is free.** A real
table seen from a real camera position never projects to a quad whose longest
edge is more than about 2.4 times its shortest; the fitter's own limit of 12 is
far too generous. At a threshold of 4 it declines 91 of 580 frames and 88 of
those 91 are genuinely bad.

The gates as combinations:

| gate | frames declined | bad frames caught | good frames lost | median error of what it keeps |
| --- | --- | --- | --- | --- |
| `weight < 6` | 158/580 | 129/208 | 29/372 | 0.35% |
| corner more than 5% of the diagonal outside | 42/580 | 39/208 | 3/372 | 0.43% |
| edge ratio > 4 | 91/580 | 88/208 | 3/372 | 0.40% |
| geometry, either check | 102/580 | 99/208 | 3/372 | 0.39% |
| **weight < 6 or geometry** | **181/580** | **152/208** | **29/372** | **0.33%** |

The median residual is close to useless (AUC 0.56) and the number of competing
hypotheses barely better (0.64). Do not gate on either.

## The four matches with no hand mark

Reported without any accuracy claim, since there is nothing to score against.

| match | holdout verdict | source | clusters over 20 frames | largest share | survive the filter | largest share of survivors |
| --- | --- | --- | --- | --- | --- | --- |
| `3821ede7` | unusable | 608x1080 | 4 (8, 8, 3, 1) | 0.40 | 20/20 | 0.40 |
| `4da91dde` (= `a38ca7c0`) | loose | 1920x1080 | 6 (10, 4, 3, 1, 1, 1) | 0.50 | 9/20 | 1.00 |
| `71930254` | correct, loose | 1920x1080 | 5 (16, 1, 1, 1, 1) | 0.80 | 14/20 | 1.00 |
| `abcdd301` | loose | 1920x1080 | 1 (20) | 1.00 | 19/20 | 1.00 |

`3821ede7` is worth its own note. It is the vertical phone clip of a broadcast,
and **it is the only match in the whole set that the agreement gate declines
while every per-frame signal says it is fine** — 20 of 20 frames pass the
filter at weights of 9.4 to 10.2. Looking at the montage
(`montage_3821ede7.jpg`), the detector is right on every frame; the *broadcast*
cuts between camera framings, so the two clusters of 8 are two different shots
of the same table. Declining it is correct — one table calibration cannot
describe footage whose camera moves — and no single-frame check could have
found it. That is the clearest thing the multi-frame gate adds that nothing
else does.

The other three look healthy: `abcdd301` puts all 20 frames on one table.

## Corner identity and the reflected order

The reflected corner order was added to the scorer as instructed. **It changes
nothing here.** On every one of the 29 matches, rotation-only and
rotation-plus-reflection give the identical error, to two decimals. Of 580
frames, 44 aligned best under the reflected order; **the least wrong of those
44 is already 2.53% off and their median is 23.52%**, so every one is a frame
on some other table, where the alignment is meaningless anyway. **No frame
whose quad is on the correct table is wound the opposite way from the mark.**
The winding disagreement reported earlier is not present in this data.

The *rotation* is a different matter and is worth recording, because this
metric is deliberately blind to it and placement is not:

Of the 27 matches that have at least one good frame:

- 18 align at rotation 0 on every good frame.
- 2 align at rotation 2 throughout — near and far ends swapped against the
  mark: `22859ef1`, `4c138aa1`.
- 3 align at rotation 3 — one position round, the side-on camera class from
  `HOLDOUT_FINDINGS.md`: `19a1efc7`, `b1c26326`, `becf0e21`.
- **4 are not even self-consistent**: `2ffe54c7` (15 good frames at rotation 2,
  4 at rotation 0), `3e7ead39`, `842dac39`, `98be5eb5`. The outline is right on
  every one of those frames; only the labelling flips, between frames of a
  fixed camera.

For an overlay this does not matter. For anything that builds a metric
homography, the labelling has to be settled separately, and pooling over
frames does not settle it — it can be voted on the same way the table is, but
that was not measured here.

## What this does not prove

- **29 marked matches — 27 distinct scenes — of which 3 fail.** Zero failures
  at N=20 is zero out of 25 distinct answering scenes; the honest upper bound
  on the true rate is around 11%, not 0%. The claim that survives is the shape
  of the curve, not the last row of it.
- **The three `wrong_table` cases are two scenes.** `431837d2` and `cff81f99`
  are the same footage, so "voting rescues all three" is really "voting
  rescues both", and one of those two is a re-run of the other.
- **The 21 flagged matches are a deliberately adversarial sample** and the 12
  controls are a small counterweight, not a representative corpus. The overall
  numbers here are much worse than production would see, which is the point.
- **The agreement gate's separation is one frame wide** on this data — 9 of 20
  accepted, 8 of 20 declined. It should not be the only thing standing between
  a wrong table and a customer.
- **The frames are from the cut videos**, so they are already rally footage
  with players in shot. Nothing here says anything about the raw uploads.
- **The per-frame filter thresholds were not fitted here** — weight 6, 5% of
  the diagonal and edge ratio 4 all come from the earlier documents — but the
  edge-ratio threshold in particular is now measured on this corpus, and its
  optimum here is 2.41 rather than 4. Tightening it would be a decision made on
  this data and should be checked elsewhere first.

## Recommendation

**Run the detector on 16 frames spread through the match, filter, vote, and
gate.** In full:

1. Sample 16 frames evenly between 6% and 94% of the cut video. 6.2 s of CPU,
   once per match.
2. Drop any frame whose inlier weight is below 6, or that puts a corner more
   than 5% of the diagonal outside the picture, or whose fitted quad has a
   longest/shortest edge ratio above 4.
3. Cluster the survivors at IoU 0.5. The largest cluster is the table.
4. Decline to fewer than 3 survivors, or to a largest cluster holding under
   half of them. Hand those to manual placement.
5. Answer with the medoid of the winning cluster.

On the hardest 21 matches in the corpus plus 12 controls that measures: 7%
declined, median error 0.29% of the diagonal, P(error > 2%) of 0.2%, and no
answer worse than 3.8%.

**Is a multi-frame gate enough to make this safe to ship? Yes, with one
correction to the premise.** The gate that does the work is not agreement — it
is the per-frame filter, and agreement is the backstop that catches what the
filter cannot see. Agreement alone would have shipped `cb0e7027` 40% wrong with
8 frames agreeing to within a fraction of a percent. Filtering alone would have
shipped `431837d2` and `cff81f99` on the wrong table roughly a third of the
time. Ship both, or neither.

And the honest headline for the original question: **more frames does rescue
the wrong-table cases — the right table is the plurality in both scenes — but
the detector also agrees with itself, confidently and tightly, on a wrong table
for 30-35% of the frames in those same matches, and on `cb0e7027` the majority
it agrees on is the wrong one.** Both halves of the worry were true. The reason
sixteen frames works is that a 60/40 majority is reliable at sixteen votes and
a coin flip at three.

## Files

`pull_frames.py` pulls the frames, `run_detect.py` runs the detector unmodified
and caches to `detected.json` / `detected_control.json`, `metric.py` is the
scorer, `analyse.py` builds the per-N simulations into `analysis.json`,
`report.py` prints curves 1 and 2, `curve2.py` prints curve 3, `signals.py` the
per-frame signals, `proposal.py` the whole rule swept over N, `clusters.py` the
per-match table clustering and `montage.py` the sheets. `rep_*.txt` are the
captured outputs. `frames/` holds the 660 JPEGs. Nothing here touched the
repository or the database.
