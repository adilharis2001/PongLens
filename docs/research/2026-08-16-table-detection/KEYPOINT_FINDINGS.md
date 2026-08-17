# Table corner detection with the Uplifting Table Tennis keypoint network

Corpus: 79 frames, 62 with hand-marked corners in `detector/rows.json`. Metric
unchanged from the earlier runs: `error% = 100 * min over 4 cyclic rotations of
(median corner distance) / hypot(source_width, source_height)`, gross above 5%,
good below 1%. Every number below was produced by the same scorer, and the
old argmax numbers reproduce exactly, so the two are comparable.

Target: median under 0.5% and gross under 5 of 62.

## Result

| detector | n | median | gross >5% | good <1% | worst corner (median) | all four <1% |
| --- | --- | --- | --- | --- | --- | --- |
| segformer++ b0, argmax per channel (previous best) | 62 | 0.38% | 22 | 36 | 23.82% | 14 |
| segformer++ b2, argmax per channel | 62 | 6.21% | 38 | 21 | 16.94% | 9 |
| hrnet, argmax per channel | 62 | 3.43% | 24 | 27 | 23.60% | 2 |
| **segformer++ b0, homography fit** | **62** | **0.27%** | **0** | **59** | **0.54%** | **49** |
| segformer++ b0, homography fit, mirror TTA | 62 | 0.24% | 2 | 60 | 0.54% | 52 |
| segformer++ b2, homography fit | 62 | 0.26% | 6 | 56 | 0.58% | 49 |
| hrnet, homography fit | 62 | 0.28% | 9 | 47 | 0.64% | 41 |
| Luna (paid vision model) | 52 | 2.40% | 8 | - | - | - |
| deterministic (production today) | 50 | 3.50% | 20 | - | - | - |

The target is met with room to spare: median 0.27% against a 0.5% ceiling,
zero gross failures against a budget of five. Mean error is 0.43%, and the
worst single frame is 3.70%.

The "worst corner" column is the same alignment scored on the largest of the
four corner distances instead of the median. It is the honest read of whether
a quad is usable, and it is where the old pipeline looked worst: a median of
0.38% next to a worst corner of 23.82% means three corners were often right
and one was somewhere else entirely.

## What the bimodality actually was

It was not a reflection, and it was not accuracy. **The frames contain more
than one table, and a heatmap network with one channel per keypoint picks each
channel's strongest response independently, so the thirteen keypoints can come
from three different tables.**

Evidence, in the order it was gathered.

1. **Reflection was ruled out.** Scoring the old predictions against the
   reversed corner order as well as the four rotations rescued 3 of the 22
   gross frames on b0 and 0 of 38 on b2. If a mirrored labelling were the
   cause, nearly all of them would have collapsed.

2. **The per-corner distance profile is not a drift.** Sorting the four corner
   distances per frame gives two shapes and almost nothing else. Either three
   corners land within 0.2% and the fourth is 20 to 45% away, or two corners
   land within 0.2% and the other two are 15 to 30% away. A model that was
   merely imprecise would not produce that.

3. **The pictures say it plainly.** In `vis_b0/cb0e7027…jpg` the model puts
   `close_left`, `centre_left` and `close_centre` on the table being played on
   and `far_right`, `far_centre` and all three net feet on the table to the
   left of it. In `vis_b0/6b7bd78d…jpg` the near corners are correct and
   `close_right` and `far_right` sit on two different neighbouring tables.

4. **Measured over the corpus.** Taking the eleven keypoints that lie in the
   table plane, 56 of the 62 frames have at least one whose argmax lands off
   the table that was marked. The frames that scored gross average 5.0 stray
   keypoints out of 11; the rest average 1.9. Twenty of the 22 gross frames
   have at least two tables competing within 30% of the winner's support.

The venue split follows from this rather than from viewpoint. Westchester TTC
and the LYTTC hall have four to ten tables in shot; a PingPod pod usually has
one. That is why b2 read 6.81% at LYTTC and 0.18% at PingPod. Camera height
and angle explain nothing once the multi-table effect is removed: after the
fix, the two venues with the most tables in frame are the two most accurate
(Westchester 0.18%, LYTTC 0.27%).

## The fix

`fit.py`. Two changes, both applied identically to every image.

**Several peaks per channel, not one.** Every local maximum above 0.12, or
above a quarter of that channel's own maximum, up to five per channel, with a
DARK-style subpixel offset from the 3x3 log heatmap.

**Fit the whole metric table, not four corner peaks.** Eleven of the thirteen
keypoints lie in the table plane (the two net-top points sit 0.1525 m above it
and are dropped). A homography from the real 2.740 x 1.525 m model to the
image therefore explains all eleven at once, so "these peaks are one table" is
a checkable statement. Thirteen four-point seed sets are tried against every
combination of their candidate peaks; each surviving homography is scored by
the activation-weighted count of channels whose peak sits where it says. The
hypotheses are clustered by quad overlap so that one cluster is one physical
table, each cluster is refined by least squares over its own inliers, and then
one rule picks between the tables.

Three details earn their place:

- **The tolerance scales with the table's apparent size** (10% of the square
  root of the quad's area, clamped to 8 to 40 px on the 1920x1080 canvas). A
  fixed pixel budget lets a small background table collect inliers it has not
  earned.
- **The camera has to be above the table.** Recovering the focal length from
  the homography by Zhang's two single-plane constraints and then the pose
  gives a camera height in metres. Anything under 0.35 m is set aside. This is
  what kills quads stitched out of the near half of one table and the far half
  of its neighbour: they imply a camera 10 cm above the playing surface.
- **Among tables that are well supported, the largest wins.** The camera was
  set up to film one table, so that table is the nearest one. Well supported
  means within 10% of the best inlier weight.

The corner order is emitted with a single fixed winding, because
close-left, close-right, far-right, far-left runs the same way round the
picture for any camera above the table, and all 62 ground-truth quads are
wound that way. Nothing in the pipeline reads the ground truth.

Because this repairs a bad channel rather than trusting it, it also fixes
precision, not just catastrophes: frames with all four corners inside 1% went
from 14 to 49.

## Per venue, before and after (segformer++ b0)

| venue | n | argmax median | argmax gross | fit median | fit gross | fit good |
| --- | --- | --- | --- | --- | --- | --- |
| LYTTC | 20 | 0.33% | 4 | 0.27% | 0 | 20 |
| Westchester TTC | 14 | 7.32% | 9 | 0.18% | 0 | 14 |
| PingPod | 13 | 0.28% | 3 | 0.27% | 0 | 11 |
| unknown | 7 | 0.42% | 2 | 0.31% | 0 | 6 |
| Pingpod | 4 | 8.61% | 2 | 0.29% | 0 | 4 |
| PingPod Dobro | 2 | 5.69% | 1 | 0.27% | 0 | 2 |
| Matchpoint | 2 | 11.40% | 1 | 0.60% | 0 | 2 |

## How much of this is tuning

Three things argue it is not.

**The fitter's settings barely matter.** Over 72 combinations of the four
knobs (peaks per channel 4/5/6, tolerance fraction 0.08/0.10/0.13, support
threshold 0.85/0.90/0.95/1.00, camera-height floor on and off) the median
error stays between 0.27% and 0.28% and gross stays between 0 and 3. **Every
one of the 72 settings meets the target.** The shipping setting reaches 0 by
sitting at a good point on that curve; the claim that does not depend on luck
is "at most 3 gross for any reasonable setting".

**It works on all three checkpoints.** The same fitter takes b2 from 38 gross
to 6 and hrnet from 24 to 9, without touching a parameter. A fix that only
worked on b0 would be a b0 quirk.

**It works on the unlabelled rows too.** All 17 frames without ground truth
produce a fit, and the only one with weak support (weight 2.77, four inliers)
is a vertical social clip of a screen recording with heavy smear, which is
exactly what should be refused.

The one genuinely fitted parameter is the 0.90 support threshold. At 0.85 the
gross count is 2 and at 0.95 it is 1, so the difference between those choices
is two frames out of 62, one distinct scene each.

## Confidence, and a gate worth shipping

The inlier weight separates the failures cleanly. It runs from 0 to about 11,
one unit per in-plane keypoint that agrees with the fit.

| gate | frames accepted | median | gross | worst error |
| --- | --- | --- | --- | --- |
| none | 62 | 0.27% | 0 | 3.70% |
| weight >= 5 | 60 | 0.27% | 0 | 3.70% |
| weight >= 6 | 59 | 0.27% | 0 | 1.00% |
| weight >= 7 | 43 | 0.28% | 0 | 1.00% |

At `weight >= 6` the detector accepts 95% of the corpus and the worst accepted
frame is off by 1.00% of the diagonal, about 22 px on 1920x1080. The three it
declines are the three worst frames. That is a good place to hand over to
manual placement.

## Speed and device

Measured end to end (read frame, network, fit) on an Apple M1 Ultra, 237
inferences over three passes of the 79 frames:

| configuration | median | mean | max | crashes |
| --- | --- | --- | --- | --- |
| segformer++ b0, CPU | 0.379 s | 0.383 s | 0.722 s | 0 |
| segformer++ b0 + mirror TTA, CPU | 0.758 s | 0.760 s | 1.116 s | 0 |
| segformer++ b2, CPU | 0.51 s network only | | | 0 |
| hrnet, CPU | 1.25 s network only | | | 0 |

The fit stage itself is 30 ms of that. It is deterministic and has no
randomness, so the same frame always gives the same answer.

**MPS is not usable and this is reproducible.** On `mps` the process aborts
with SIGABRT (exit 134) on the very first inference:

```
MPSNDArray.mm:130: failed assertion `[MPSNDArrayDescriptor
sliceDimension:withSubrange:] error: the range subRange.start +
subRange.length does not fit in dimension[1] (1)'
```

torch 2.13.0, macOS 26.3, arm64. This is the same failure as the four SIGABRTs
in the earlier session, so it is the backend and not a transient. Everything
reported here was validated on **CPU**, which is stable across 237 consecutive
inferences with zero refusals and zero crashes. The cost of staying on CPU is
0.38 s per frame, which is once per match, so it does not matter.

## GPL-3.0

The repository is GPL-3.0 (`repo/LICENSE.txt`), and the paper's weights come
with it.

- **Running it server-side on the owner's own machine is fine.** The GPL's
  obligations attach to *distribution* of the software. Running a GPL program
  to process your own files, and serving the results to users over a network,
  is not distribution. GPL-3.0 has no Affero clause, so network use does not
  trigger the source-offer requirement. This is the same position as any
  GPL command line tool in a build pipeline.
- **What would trigger it:** shipping the model code inside anything handed to
  a user (a desktop app, an Electron bundle, a downloadable binary), or
  distributing a container image that contains it. At that point the whole
  combined work has to be offered under GPL-3.0.
- **The safe shape** is what the worker already does: keep it behind the
  processing job on hardware Adil controls, import it as a separate process or
  service rather than linking it into the Next.js app, and never put it in
  anything the browser downloads. Keep the licence file and the citation with
  the checkout.
- One practical note: the weights are the paper's, and their release page
  should be checked for any separate terms on the checkpoints themselves. The
  code licence does not automatically cover them.

This is a reading of the licence, not legal advice.

## What still fails

Three frames, two distinct scenes, none of them gross.

- **`a0fb8f44` and `efff9208` (PingPod), 3.07% and 3.11%.** These are the same
  byte-identical frame under two match ids. It is a dark pod with a dark table
  against a bright window. No corner channel fires above 0.41; the strongest
  responses are the net line and `close_centre`. The fit is therefore anchored
  on the near half and the far end is extrapolated. This is a detection
  failure, not a selection failure, and no amount of geometry will repair it.
  Mirror TTA makes it worse (5 to 10%), and CLAHE contrast enhancement makes
  it much worse (8.7 to 10.3%), so it is not a contrast problem either. The
  confidence gate catches it: weight 3.52.
- **`becf0e21`, 3.70%.** LYTTC, several tables, and the fit takes the far edge
  from the table behind. Weight 5.7, so a `weight >= 6` gate catches this one
  too.
- Next worst are `d4592913` at 1.00% and `ad26c307` at 0.70%, both fine.

Two things about the corpus are worth recording. It contains ten groups of
byte-identical frames covering 21 rows, so the 62 labelled rows are 56 distinct
scenes; scored per distinct scene the numbers are median 0.28%, gross 0, good
54 of 56. And the frames are median composites, which ghosts the table actually
being played on while leaving empty background tables crisp. That is part of
why the network's support for the correct table is sometimes weaker than for a
neighbour. Feeding a single sharp frame instead is the most promising untried
lever, and it was not tried here because only the composites are on disk.

## Recommendation

**Adopt it.** Run `segformer++ b0` on CPU with the homography fit, at
`k=5, tol_frac=0.10, beta=0.90, min_cam_height=0.35`, and gate on inlier
weight at 6.

It is 13 times better than the production deterministic detector on median
error (0.27% against 3.5%) and takes gross failures from 20 of 50 to 0 of 62.
It is 9 times better than Luna on median and removes its 8 gross of 52, at
0.38 s of local CPU instead of a paid API call per match. It needs no network
call, no key and no per-match cost, and it reports a confidence that is good
enough to decide when to ask a human.

Two things to be honest about when it ships. Zero gross on 62 frames is a
result on 56 distinct scenes from seven venues, and the settings sweep says the
true rate is more like 0 to 3 in 62 than exactly 0. And the one scene it cannot
do is a dark room with a dark table, which is a recognisable class rather than
a one-off, so the confidence gate should be wired up on day one rather than
added later.

Do not use mirror TTA. It buys 0.03% of median and three more all-four-good
frames, and costs a doubled runtime plus two gross failures.

## Files

- `run_hm.py` runs a checkpoint and keeps the full heatmap stack in `hm/<tag>/`.
- `fit.py` turns a heatmap stack into one table quad. This is the fix.
- `cam.py` recovers a camera from a table-plane homography.
- `detect.py` is the end to end detector: frame in, four corners out.
- `score2.py`, `sweep.py`, `eval2.py`, `final2.py` are the scoring harness.
- `vis_fit.py` draws a fit against the ground truth; output in `vis_all/`.
- `scored_final_b0.json` is the per-frame result of the shipping setting.
