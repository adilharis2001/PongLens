# Table detection: everything measured, 2026-08-16

The first time table calibration was measured against a trusted answer, and
what replaced it. Written so the discovery survives the conversation it came
out of.

**Shipped 2026-08-17.** The keypoint detector is the production calibrator
and the pink-rim one is out of the upload path — see §13 for what changed and
where it lives. Sections 1-10 describe the measurement as it was taken;
§11's open questions have moved to §13.

Start here, then the four sibling documents for the detail of each phase.

---

## 1. Why this happened

It began as a question about an OpenAI bill. `gpt-5.6-sol` was 66% of a
$23 month, which led to the placement vision stage, which led to asking
whether the expensive model was needed, which led to discovering that
**nobody had ever checked whether table calibration works at all.**

There was no ground truth. The deterministic pink-rim calibrator was treated
as one until two of the three matches sampled for it turned out to carry
quads spanning half the room — one stretched across the PINGPOD wall
banners, one across to a neighbouring table's base. Both were
`placement_status = 'ready'`, with 99 and 135 mapped points resting on them.

So the reference was wrong and everything measured against it looked wrong by
comparison, which is the worst possible arrangement: you cannot tell a real
defect from a broken ruler.

## 2. The ground truth

Adil hand-marked the four corners on **62 production matches** through
`/research/table-calibration`, drawing on the median-background frame each
model was shown. Stored in `table_calibration_review.corrected_corners`, in
SOURCE pixels, cyclic `A_near_left, B_near_right, C_far_right, D_far_left`.

**These are authoritative.** Later work is scored against them, not the other
way round.

### The metric used throughout

```
error% = 100 * min over 4 cyclic rotations of
         ( median euclidean corner distance ) / hypot(source_width, source_height)
gross  = error% > 5      good = error% < 1
```

**1% of a 1080p diagonal is about 22px.** Rotation-only minimisation was a
mistake that hid a real winding disagreement — see §7.

## 3. What every approach scored

| Detector | Median | Gross | Cost | Speed |
|---|---|---|---|---|
| Deterministic (pink rim, production) | 3.50% | 20/50 | free | fast |
| Luna, agreement selection | 2.40% | 8/52 | paid | ~6s |
| Sol | 0.00% | 0/7 | 25x Luna | ~7s |
| Bottom-up lines (`detect_v2`) | 21.50% | 59/62 | free | fast |
| Template fit (camera-pose search) | 0.54% | 8/62 | free | **227s/frame** |
| **Segformer++ b0 + homography fit** | **0.27%** | **0/62** | **free** | **0.39s/frame** |

Sol's 7 samples are only the matches where Luna failed, so its 0.00% is not
comparable to the others.

## 4. Why the pink detector fails where it does

It keys on a hard-coded HSV window — hue 130-179 or 0-10, saturated — at
`points_pipeline.py:1035`, then takes the convex hull of surviving
components.

| Venue | Deterministic | Luna |
|---|---|---|
| LYTTC | **0.5% median, 1/14 gross** | 4.7%, 4/15 |
| PingPod | 7.6%, 11/15 gross | **0.0%, 2/14** |
| Westchester | 6.1%, 8/13 gross | **2.1%, 0/13** |

**It is excellent at LYTTC and terrible at PingPod, and the vision models are
the other way round.** PingPod's rims *are* magenta — so are the signage, the
neon, the barriers and every neighbouring table. The hull swells across the
room. LYTTC works because the only magenta in that hall is on the table.

**The failure is not "pink does not generalise". It is that colour alone
cannot reject same-coloured things that are not tables.** Learning the colour
per venue would make PingPod worse, not better: the same blindness with a
wider net. This is the single most important thing to remember before anyone
proposes "just make the colour adaptive".

## 5. Three ideas that did not work

**The known table ratio as a gate.** An ITTF table is 2.740 x 1.525 m, ratio
1.7967, and Zhang & He (2006) recover a rectangle's aspect from its four
image corners alone, uncalibrated. Adil's marks recover a median of **1.79**,
so the physics is sound. But it is undefined when the camera sits square
behind the end line — both end lines run parallel in the image and their
vanishing point is at infinity — and roughly a third of real uploads sit near
that degeneracy. Even Adil's own marks miss a generous band 29% of the time.
Gating on it costs 8 of 25 good quads to catch 4 of 12 bad ones.

**It works as a RANKER, and that shipped.** See §6.

**Bottom-up line assembly.** Canny, Hough, vanishing points, quads from line
intersections, scored on shape and uniformity. 21.5% median, 59/62 gross. The
oracle test explains it: taking the *best* candidate in each frame's set
rather than the top-scored still only gets 14 of 62 right. **The correct quad
is usually not in the candidate set at all** — a generation failure, not a
ranking one, so better scoring could never have rescued it.

**Ball-bounce evidence as an arbiter.** Proposed, then withdrawn: the
deterministic detector already seeds components from nearby bounces
specifically to kill signs and banners, and PingPod is still 11/15 gross.
The mechanism is shipped and already failing.

## 6. What shipped: shape-ranked selection (commit `1428a8e5`)

The vision stage chose between its trials by agreement — closest pair wins,
give up if none agree. Replaced by ranking on `shape_error`, how close each
quad is to being a real table.

| | Old rule | New rule |
|---|---|---|
| Matches answered | 52/62 | **62/62** |
| On the 52 it answered | 2.36% median, 20 good | **1.72%, 24 good** |
| On the 10 it abandoned | nothing, paid Sol call | **1.17% median, 9 of 10 usable** |

Same five trials, chosen better, no new requests. Agreement is weak evidence:
two trials can agree on the same wrong table, and at PingPod they often do.
Agreement with the laws of perspective cannot happen by accident.

Lives in `worker/vision_table_calibration.py` as `shape_error` and
`select_by_shape`, with `worker/tests/test_shape_selection.py` building
fixtures by projecting a known table through a real camera model.

## 7. The keypoint detector

[Uplifting Table Tennis](https://github.com/KieDani/UpliftingTableTennis)
(WACV 2026), Segformer++ predicting 13 table keypoints. GPL-3.0. Its ball
detector is pretrained on **BlurBall**, which PongLens already runs — a
sibling of a model already in the pipeline.

### The bimodality, and what it actually was

Naive per-channel argmax gave 0.38% median but **22 gross failures** — either
superb or catastrophic, nothing between. Not reflection (that rescued 3 of
22) and not drift. The error profiles were "three corners right, one 30%
away".

**These halls contain several tables, and taking each keypoint's strongest
response independently pulls the thirteen points from two or three DIFFERENT
tables.** 56 of 62 frames have at least one keypoint off the marked table.

The fix: keep the full heatmaps, take up to five subpixel peaks per channel,
fit the real 2.740 x 1.525 m table by homography to all eleven in-plane
keypoints, cluster the hypotheses so one cluster is one physical table, and
choose between tables by one rule applied to every image — enough inlier
support, camera at least 0.35 m above the surface, then largest. **0.27%
median, 0 gross, 59/62 good.** Six pixels at 1080p.

Not a b0 quirk: the same fitter takes b2 from 38 gross to 6 and hrnet from 24
to 9, and across 72 parameter combinations the median stays 0.27-0.28%.

### The corner-order question, still open

Two agents independently found a winding disagreement that rotation-only
scoring had hidden. On **7 of the 62 marked frames, all side-on cameras**,
the detector's labels sit one position round from the hand-marks — the two
disagree about which pair of edges is the 1.525 m width. Projecting the model
net through the hand-marked quads implies a net running down the table's
length on those frames.

**Unresolved.** It matters because it determines how the table maps to
real-world coordinates. Ten holdout frames come from those same camera
setups, flagged in `detail.dev_corner_identity_mismatch`.

## 8. Holdout: 105 unseen frames

Real single frames with players mid-rally, varied timestamps, 84 matches, 6
venues, other users' uploads included. Seeded into
`table_calibration_holdout`. Adil graded all 105.

**81 correct, 19 loose, 3 wrong table, 2 not-match-footage.** On the right
table 95% of the time.

| Venue | Correct |
|---|---|
| PingPod | 89% · Pingpod 88% |
| LYTTC | 77% |
| Westchester | 75% |
| PingPod Dobro | 70% |
| Matchpoint | 50% |

Caveat: 77 of 105 came from matches that already had a hand-marked row, so
these are new frames but mostly not new scenes.

## 9. Convergence: how many frames

660 frames, 20 from each of 33 matches — the 21 with a failure plus 12
known-good controls.

| Frames | 1 | 6 | 12 | **16** | 20 |
|---|---|---|---|---|---|
| P(answer >2% off) | 13.2% | 5.3% | 1.6% | **0.2%** | 0% |

**16 frames, 6.2s CPU per match.** Sixteen is not where the curve flattens —
it is where the *worst* random draw stops being catastrophic: 25% error at
N<=15, 3.8% at N=16.

**Naive pooling never converges.** Plain medoid sits at 3-5 bad matches
regardless of N, because a medoid over a bimodal set is tie-broken toward the
failures. You must filter each frame first, then take the largest agreeing
cluster.

### The wrong-table verdict

**Unstable, not consistently wrong** — the correct table is the plurality in
all three: 12/7, 11/7, and 10/6/3/1. All resolve to within 0.5%.

**But agreement is not evidence.** In each, 30-35% of frames land on one
specific wrong table agreeing to 0.03-1.42% — as tightly as the correct
cluster, at *higher* confidence. Two wrong frames agree to better than 1%
about 15% of the time. This is why **early stopping is dangerous**: at 4
frames `cff81f99` has a 35.7% chance of a wrong answer, and in those cases
the frames agree.

### The counterexample that decides the design

`cb0e7027`: 8 frames on the neighbouring table agreeing to 0.16%, 6 slivers,
only 5 correct. **Voting returns a confident 40% error.** Only geometry saves
it — every wrong frame puts a corner 21-29% outside the picture.

Conversely on `431837d2`/`cff81f99`, geometry is useless (all seven wrong
frames pass it) and only voting saves the match.

**Neither mechanism covers the other's blind spot. Ship both or neither.**

### The one that cannot be saved

`1c268ac1` (Adil vs Daniel Feng, dark PingPod pod) is the only match still at
6% risk after 16 frames. None of its 20 frames land within 2%, confidence
2.1-3.6 across eleven scattered clusters. **Correctly refused** — it produces
obvious garbage rather than a confident wrong answer, and should fall through
to Luna.

## 10. Recommended production shape (not built)

Per frame, reject if: inlier weight < 6, any corner more than 5% of the
diagonal outside the picture, or **edge ratio > 4** (the strongest single
signal at 0.94 AUC; the fitter's own limit of 12 is far too loose).

Then pool **16 frames**, take the largest agreeing cluster, require at least
3 survivors with the winner holding half. At N>=12 this catches every failure
with no false alarms and accepts 90% of matches. Anything refused falls
through to Luna, then to no calibration — never to a wrong table.

**Do not make the frame count adaptive.** Escalate models, not frame counts.

### Operational notes

- **CPU only.** MPS aborts with SIGABRT inside Metal on the first inference,
  reproducibly. 237 consecutive CPU inferences, zero failures.
- **Cloud estimate:** ~15s serial per match (8s frame fetch, 6.2s inference),
  4-8s with concurrent fetch and batched inference. On a 4-vCPU ARM instance
  that is **under $0.001 per match** — roughly 7x cheaper than Luna, 100x
  cheaper than Sol. Cold start dominates if spawned per match (a PyTorch
  image is several GB, 30-90s), so fold it into the existing worker rather
  than standing up a separate service.
- **GPL-3.0.** Running server-side is not distribution and there is no
  Affero clause, so no obligation to publish PongLens source. It must never
  be bundled into anything a user downloads. **The weights, hosted
  separately, carry no stated licence** — worth an email to the authors
  before this becomes load-bearing.

## 11. What was still open, and what happened to it

1. **The corner-order disagreement on side-on cameras** (§7). **Resolved —
   see §13.** It was two separate things and neither needed new code.
2. **"Loose" is unquantified.** 19 of 105 holdout frames were graded loose
   and nobody has checked whether that means 20px or 200px. Still open,
   deprioritised.
3. **Thresholds want re-measuring at 16 frames per match**, not the 1-2 the
   original batch sampled. Still open, deprioritised.
4. **Duplicate uploads still inflate every count.** Three of the "21 failing
   matches" are two scenes. Dedupe on duration or content hash, never on
   opponent name or storage path.
5. The template fitter (0.54%, no model, no API) is a credible pure-classical
   fallback if the GPL weights ever become a problem, but at 227s/frame it is
   not a production path. Kept as reference, not wired in.

## 12. Where things live

| | |
|---|---|
| `KEYPOINT_FINDINGS.md` | the detector, the bimodality, the fix |
| `CONVERGENCE_FINDINGS.md` | frame count, thresholds, wrong-table verdict |
| `HOLDOUT_FINDINGS.md` | the 105-frame batch |
| `TEMPLATE_FINDINGS.md` | camera-pose template fitting |
| `detector/detect.py`, `fit.py` | the keypoint detector and homography fit |
| `detector/geom.py` | rectangle recovery, Zhang-He |
| `detector/detect_tpl.py`, `tmodel.py` | the template fitter |
| `detector/clusters.json`, `curve_filtered.json` | raw convergence data |
| `table_calibration_review` (DB) | 62 hand marks + every model's proposal |
| `table_calibration_holdout` (DB) | 105 graded holdout frames |
| `/research/table-calibration` | the review page |
| `/research/table-calibration/holdout` | the holdout grading page |

Model weights are NOT in the repo — re-download from the upstream project.
Everything under `detector/` is GPL-3.0 derived and kept for reference; treat
it accordingly if it moves into the product.

---

## 13. What shipped, 2026-08-17

### The ladder

```
keypoint detector (16 frames, pooled)   free    ~10s   0.27% median, 0 gross
  -> Luna, 5 trials, shape-ranked       paid     ~6s   2.40% median
  -> Sol, 3 trials                      25x Luna ~7s
  -> refuse
```

The pink-rim calibrator is out of the upload path. `calibrate()` stays in
`points_pipeline.py` for its own tests, with the reason in its docstring, and
nothing calls it.

### Where it lives

| | |
|---|---|
| `worker/table_keypoints.py` | frame sampling, the model, the CLI the pipeline shells out to |
| `worker/table_keypoint_fit.py` | peaks -> hypotheses -> one table; the per-frame gate and the pooling rule |
| `worker/table_keypoint_camera.py` | rectangle recovery, used to reject cameras below the table |
| `points_pipeline.keypoint_calibrate` | the production entry point |
| `worker/tests/test_table_keypoint_fit.py` | the two rules, tested against the cases that set them |
| `worker/tests/test_placement_outcome.py` | never offer a retry that cannot succeed |
| `~/ponglens-models/table-keypoints/` | GPL repo + weights, deliberately outside this repository |
| `~/Library/Caches/PongLens/table-keypoints/venv` | its interpreter, isolated from the TTVid venv |

The detector runs in its own process under its own interpreter. The shared
TTVid environment carries torch but not einops or the token-merging backbone,
and it is load-bearing for blurball and the whole cut path, so it was left
alone rather than grown.

### The corner-order question, closed

It was **two** separate disagreements wearing one costume.

**Seven frames were a labelling slip.** The review page asked for four
corners and never said which was which — my omission. On 7 of 62 the letters
started one position round, so what the pipeline calls the near end line was
drawn along a side line. Rotating them makes five read 1.52-1.77 against a
true 1.7967, and the apparent pixel ratio agrees on six of seven
independently. Migration 118 rotates those seven and keeps what was drawn in
`corrected_corners_as_marked`. The positions were always right.

**Seventeen frames were the detector's own labels.** The network calls a
particular end "close" from what it was taught, and on 17 of 62 that is the
end furthest from our camera. `_orient_near_far` settles it from image
position instead — the near end line always sits lower in the frame, 44 of 44
on the calibration corpus — which is why the keypoint quad goes through the
same `_canonical_calibration_geometry` as every other source.

With both applied, **all 62 frames agree on the winding**, and the
order-exact error equals the rotation-minimised error: 0.27% median, 0 gross,
59 of 62 under 1%.

### Failure is terminal, and costs nothing

When every calibrator declines, the match still processes — points, clips and
scoring never needed the table. The row goes to `final_failed` with
`no_table_found`, and the page says so plainly.

Not `retry_available`: a retry runs the same ladder against the same video
and reaches the same answer, so offering one spends the player's single
placement request on something that cannot work and makes them wait for it.

No money moves. `claim_processing` bills `ceil(duration / 60)` minutes and the
placement flag does not enter that sum, so placement has never carried a
charge of its own and a late generation is free. **If placement should
instead refund processing minutes, that is a policy decision nobody has
made** — this ships as "costs the player nothing extra", not as a refund.

### Reproduced before shipping

Against the study's own 660 per-frame outputs, the production rule declines
exactly the three matches the study named — `a0fb8f44`, `efff9208` (no frame
survives) and `3821ede7` (frames disagree) — answers 30 of 33, and its worst
answer is 0.54% against the study's "every marked answer within 0.54%". The
per-frame gate keeps 70% of frames against the study's 69%.

Against the 62 hand-marked frames, the shipped module scores 0.27% median, 0
gross, 59 of 62 good — the research figures line for line.

End to end on six real videos through `keypoint_calibrate`, all within 0.35%
of the hand marks, about 10s each including model load:

| match | venue | frames used/kept/sampled | error |
|---|---|---|---|
| `2f7168db` | Westchester | 8/8/16 | 0.11% |
| `a38ca7c0` | LYTTC (Gavin) | 5/5/16 | 0.15% |
| `cb0e7027` | Westchester | 4/4/16 | 0.24% |
| `1c268ac1` | dark PingPod | 11/11/16 | 0.24% |
| `a52a6612` | LYTTC | 7/8/16 | 0.25% |
| `d4592913` | Westchester (Tripp) | 3/3/16 | 0.34% |

`cb0e7027` is the neighbouring-table counterexample and `1c268ac1` is the one
the study could not save on raw-video frames; both are correct here. Note
these run on CUT videos, which is not the input production sees.

### One change the study did not measure

`pool_frames` refuses an exact tie — eight frames on each of two tables
clears the half-share bar, and picking one is then a coin toss dressed up as
a measurement. The study's three wrong-table matches all had a clear
plurality (12/7, 11/7, 10/6/3/1), so this changes no measured outcome and
closes the one case where the rule as written would have answered without
evidence.

### Watch this

The per-frame gate discards 30-40% of frames, and it is `weight < 6` doing
almost all of it. Tripp kept exactly 3 of 16 — the minimum. **One frame
worse and that match would have refused.** The study's sweep says the rule is
not knife-edge (weight gate 5/6/7 all land between 0.0% and 0.6% for
P(error > 2%), declining 7-16% of matches), but the margin on a bad recording
is one frame, and the honest expectation is that **about one match in ten
falls through to Luna.**

### What re-running two matches turned up

The keypoint detector was wired into the placement generate/retry path as
well as the upload path. Re-running Tripp (`d4592913`) and Gavin
(`a38ca7c0`) through it found that **placement generation had been broken
since 2026-07-30** — three separate faults, none of them table detection, all
the same shape: `match.json` and the `points` table have been diverging for
months and every guard between them assumed they had not.

1. `merge_match_placements` copied the whole database row over each point,
   putting 23 app-owned columns into the artifact.
2. The placement-only guard refused the document version rising 2 -> 3, so no
   older match could be given placement maps at all.
3. The artifact's point list was rebuilt from the database, so points the
   owner had merged away — Tripp has two — silently vanished from it.

Fixed in `efced502` and `e308c931`. The rule is now that the artifact owns
which points exist and the points table owns what they say.

**Worth remembering when reading the accuracy figures above:** both matches
already carried correct quads, 0.89% and 0.55%, and both came from Sol rather
than the pink rim. The keypoint detector tightens them to 0.34% and 0.15%,
but on these two the gain is that it is free, not that it is right. Whatever
makes Tripp a hard match is not the table.
