# Segmentation-plus-geometry table detection — 2026-08-26

Can a zero-shot segmentation model (SAM family, August 2026) plus classical
geometry find the four corners of the playing surface well enough to matter?
Measured against the same 61 hand-marked matches as everything else, with
the same metric, so the numbers sit beside the 2026-08-16 study line for
line.

**Answer: no, and the margin is not close.** The better of the two
backends lands at 1.75% median corner error against the shipped keypoint
detector's 0.27%, and that gap is the difference between a ball placed
within 6 cm and one placed within 43 cm on a table half only 137 cm long.
The other backend answers nearly every match and is wrong on nearly every
one. The approach is worth keeping for something else entirely — see §9.

Nothing in production was touched.

---

## 1. What this starts from

- Production ships a keypoint ladder at **0.27% median, 0 gross, ~90% of
  matches answered** (Segformer++ b0, 13 keypoints, homography fit, 16
  frames pooled — `worker/table_keypoints.py`). GPL-3.0 code, weights of
  no stated licence, deliberately outside this repo.
- 61 labelled matches × ~114 frames at 1920×1080 are on disk at
  `~/ponglens-data/table-corners/` (harvested 2026-08-18 days before the
  30-day retention sweep), labelled from
  `table_calibration_review.corrected_corners` after migration 118. All
  hand truth, all authoritative.
- A from-scratch 4-heatmap CNN (`run1`, 2026-08-18) already measured
  3.87% mean on held-out matches. "Train something small on our own data"
  without a pretrained backbone is a known non-starter.

Metric, unchanged: `error% = 100 × min over 4 cyclic rotations of (median
corner distance) / hypot(W, H)`; gross > 5%, good < 1%. **1% of a 1080p
diagonal is about 22 px.**

## 2. The model landscape, August 2026

| Model | Weights | Licence | Text prompts | On this Mac |
|---|---|---|---|---|
| SAM 3 / 3.1 | **gated** (Meta approval) | custom SAM Licence | yes | CPU only, ~3 s/frame |
| **SAM 3 LiteText s0** (`yonigozlan/…`) | **ungated** | community conversion | yes | CPU, ~7 s/frame |
| SAM 2.1 base-plus | ungated | Apache 2.0 | no (box/point) | CPU, ~1.1 s/frame |
| Grounding DINO base | ungated | Apache 2.0 | boxes only | CPU, ~2.2 s/frame |
| RF-DETR Keypoint (preview) | ungated | Apache 2.0 | n/a | fine-tunable |
| YOLO26-pose/seg | ungated | **AGPL-3.0** | n/a | fast |

Three things worth carrying forward:

- **SAM 3's main weights are gated.** `facebook/sam3` needs a free Hugging
  Face account plus a manual Meta approval. Verified live: `gated='manual'`.
- **There is an ungated way to run SAM 3's text prompting today.**
  `yonigozlan/sam3-litetext-s0` is a community conversion of the LiteText
  variant, needs no account, and works in transformers 5.16. It is what
  the `sam3lite` backend uses. Measured below — it is *worse* than the
  fully-open two-model path, so the gate turned out not to matter.
- **Ultralytics YOLO is an AGPL trap.** The current GPL keypoint model is
  defensible server-side precisely because GPL has no network clause;
  AGPL exists to close exactly that. Moving to YOLO would make the
  licensing position worse, not better. Separately, **OpenTTGames — the
  one public dataset with table masks — is CC BY-NC-SA, non-commercial**,
  so it cannot train a PongLens model at all.

## 3. What was built

`docs/research/2026-08-26-segmentation-table-geometry/`, running in an
isolated venv at `~/ponglens-research-work/segtable/venv` (torch 2.13 CPU,
transformers 5.16, OpenCV 5.0). Per frame:

1. **Grounding DINO** on "a table tennis table." → boxes; largest wins
   (the camera films the nearest table — production's own rule).
2. **SAM 2.1** box prompt → three granularity masks.
3. **The near/far anchor construction.** A single surface point prompt
   usually returns HALF the tabletop, because the halves are genuine
   parts — the table folds at the net. A second anchor is derived on the
   far half (silhouette minus dilated near-half, topmost region,
   distance-transform interior), and two-point prompts plus the union of
   the halves rebuild the full surface.
4. **Geometry picks the surface** among all candidates: the quad must
   contain both anchors (kills halves), hold ≥30% of the silhouette
   (kills slivers), and the highest `edge_support × √quad_iou` wins.
5. **Mask → corners**: largest component, convex hull, `approxPolyN(4)`,
   then each edge re-fitted with a Huber loss to the contour points in a
   thin band around it — occluded stretches contribute no points — and
   corners re-cut from the line intersections.
6. **Zoom pass**: re-segment inside the found quad's padded crop, accepted
   only on strict quality improvement.
7. **Gradient snap**: each edge re-found as the |∇·n| ridge in a ±9 px
   corridor with parabolic subpixel peaks.

A dead end worth recording: **the first surface test was "does the quad
reach the top of the table silhouette", and it is wrong.** The net tape,
not the far edge, is frequently the topmost part of a table silhouette, so
the test rejected every correct full-surface mask. Anchor containment
replaced it.

## 4. Per-frame accuracy

459 frames over 61 matches, 8 frames each:

| backend | median | mean | gross >5% | good <1% | outright fail |
|---|---|---|---|---|---|
| Grounding DINO + SAM 2.1 | **2.85%** | 5.23% | 140 (31%) | 37 (8%) | 29 |
| SAM 3 LiteText s0 | 3.69% | 5.88% | 105 (22%) | 45 (9%) | **0** |
| **shipped keypoint detector** | **0.27%** | 0.43% | **0** | 95% | — |

Stage ablation on the Grounded-SAM run: raw mask quad 3.75% median (162
gross) → zoom pass 2.88% (139) → gradient snap 2.85% (140). **The zoom
pass earns its keep; the gradient snap does not** — it moves the median by
0.03% and is a candidate for deletion.

By venue: PingPod 1.84%, PingPod Dobro 2.16%, LYTTC 2.36%, Westchester
3.72%, Matchpoint 4.78%. The ordering follows how many tables are in
shot, which is the same pattern the keypoint study found.

## 5. Multi-frame consensus — the assumption was right

Gate each frame (edge support, quad IoU, in-frame, sane edge ratio),
cluster survivors by cyclic-aligned corner distance, largest cluster wins
with a quorum, per-corner median.

**On the 27 matches consensus and single-frame both answer:**

| | median | gross >5% |
|---|---|---|
| any single frame (the lottery) | 2.18% | **46/209 (22%)** |
| that match's median frame | 2.28% | 3 |
| **consensus** | **1.82%** | **1** |

Consensus beat the match's own median frame on **22 of 27**. So yes —
pooling is materially better than trusting any one frame, and the reason
is the 22% per-frame gross rate, not precision.

**One correction to my own harness, worth recording.** The agreement
tolerance was first set to 1.5% of the diagonal, copied from the shipped
pooler. That pooler works on frames scattering by 0.27%; these scatter by
~2.9%, so two *correct* frames routinely disagree by more than 1.5% and
the rule refused matches it should have answered. Sweeping it properly:

| tolerance | min cluster | answered | median | gross |
|---|---|---|---|---|
| 1.5% | 3 | 28/61 | 1.81% | 1 |
| **4.0%** | **3** | **35/61** | **1.75%** | **1** |
| 4.0% | 2 | 50/61 | 1.75% | 3 (worst 41.8%) |

A threshold borrowed across detectors measures the threshold, not the
method. At the honest operating point the method **answers 35 of 61 (57%)
against production's ~90%.**

### The two backends fail in opposite ways, and the nicer-looking one is worse

Running the whole corpus through both is the most useful thing this study
did, because their headline behaviour inverts:

| backend | answered | median | worst-corner | gross | ball displacement |
|---|---|---|---|---|---|
| Grounding DINO + SAM 2.1 | 35/61 (57%) | **1.75%** | 3.26% | 1 | 43 cm |
| SAM 3 LiteText s0 | **58/61 (95%)** | 3.53% | 7.75% | 5 | **128 cm** |

SAM 3 LiteText never fails outright — 0 failures in 488 frames — and its
masks are smooth and consistent, so its frames agree with each other and
sail through any quorum rule. It answers almost every match. **And it is
wrong on almost every match**: 128 cm median displacement on a table half
137 cm long is not a degraded map, it is a fictional one.

Its own consensus barely beats its median frame (3.64% vs 3.64%), which
is the tell: pooling helps when frames are independently noisy, and does
nothing when they are consistently displaced. **The model's confidence and
consistency are not evidence about the table.** A detector that refuses
44% of the time is more useful than one that confidently answers all of
them wrongly, and this pair is a clean measured demonstration of a rule
the 2026-08-16 study had to state from a single counterexample.

This also disposes of the SAM 3 gating question from §2 on the merits:
the ungated text-prompt path is available and is the worse of the two.

### Estimate once at the start, or track throughout?

**Estimating once is correct, and the video position does not matter.**
Pooling only the first half of the sampled frames gives an answer
identical to pooling all of them (median difference **−0.00%**, worst
+0.25%) on every match where both answer. The camera genuinely does not
move. The constraint is frame *count* for quorum, not *where* the frames
come from. Continuous per-frame tracking is strictly worse: it is the
22%-gross lottery, re-rolled every frame.

## 6. Where it fails

- **Wrong table, and pooling cannot fix it — 2 matches at ~42% error.**
  `d4592913` (Tripp) and `cb0e7027`, both Westchester, both multi-table.
  Their median frame is 42% off while their *best* frame is 1.7% and 2.3%.
  The majority of frames agree on a neighbouring table, so consensus
  confidently returns the wrong one. This is precisely the trap the
  2026-08-16 study named: wrong frames agree with each other as tightly as
  right ones. `cb0e7027` is the same match that study flagged as its
  neighbouring-table counterexample, which is a good sign the corpus is
  hard in a consistent way and a bad sign for segmentation, which has no
  equivalent of the keypoint fitter's camera-height rejection.
- **26 refusals**: 22 for cluster quorum, 3 ties, 1 with no frames
  surviving the gate.
- **Gate rejections** across all frames: IoU 176, support 55, degenerate
  11, plus 29 frames where no candidate survived selection at all.
- The 4 corners are found from a mask that has no notion of *which* edge
  pair is the 1.525 m end. Segmentation alone cannot label corners; that
  came from aligning to hand truth in this study, which a production
  version would not have.

## 7. The net — the one unambiguous success

**Once the four corners are known the net needs no detector.** It crosses
the table halfway along the 2.740 m sides, and the posts stand 0.1525 m
outside each sideline: one homography from the model rectangle projects
the whole thing. Overlays across all 35 answered matches
(`out/full_v1/net_gallery/`) put the derived line on the visible net in
every venue.

Its accuracy is inherited exactly from the corners — measured at 45–51 px
median from the truth-derived net at 1.75% corner error, which is simply
that error re-expressed. **There is no separate net problem to solve;
there is only the corner problem.**

Two useful by-products:

- SAM's part-level masks split the tabletop **at the net**, so the shared
  edge of the two half-masks is a *measured* net line, free whenever the
  two-half construction runs.
- The net resolves the ambiguity §6 ends on: net endpoints lie on the
  **sides**, so a measured net line orients the table without Zhang–He
  aspect recovery, which degenerates for cameras square behind the end
  line — roughly a third of real uploads.

Post *tops* (15.25 cm above the plane) would need camera pose rather than
a plane homography. Nothing downstream needs them today.

## 8. What error is acceptable — the number that decides everything

Pixel error is the wrong unit. Placement maps, bounce interpretation and
camera guidance all consume *table* coordinates, so the question is how
far a ball's landing point moves. Measured by pushing a grid of points
through both homographies, across all 61 real cameras:

| corner error | px @1080p | ball displacement on the table |
|---|---|---|
| **0.27%** (shipped) | 6 | **5.9 cm** |
| 0.50% | 11 | 11.1 cm |
| 1.00% | 22 | 23.3 cm |
| **1.75%** (this study) | 38 | **42.5 cm** |
| 3.00% | 66 | 87.0 cm |

For scale: a ball is 4 cm across, a table half is 137 cm long, and the
"short serve" region players talk about is roughly 30 cm deep.

**So the acceptable ceiling is about 0.5% of the diagonal — 11 px at
1080p, ~11 cm on the table.** Below that, a placement dot is inside the
region a player would name. Above 1%, the map is telling a story about a
different serve. The shipped detector sits comfortably under the ceiling
at 0.27%/5.9 cm; this study's 1.75%/42.5 cm is four times over it.

On the answered matches the far half is twice as bad as the near half
(57 cm vs 30 cm median) — foreshortening magnifies far-end corner error,
and the far end is exactly where placement maps are read.

### Why a few pixels become tens of centimetres

Two multipliers, measured:

- **The table is small in the picture.** Its long side is a median of
  **386 px**, so one pixel is already 0.71 cm along the table's length
  before any perspective effect.
- **Independent corner errors shear the homography.** Sliding all four
  corners together by 38 px displaces a landing point by 19 cm; letting
  them move independently by the same median distance displaces it by
  **49 cm**. The transform is not being translated, it is being distorted.

A representative match makes the shape of the failure plain: corner
errors of 13.9, 1.4, 63.1 and 82.3 px — two corners nearly perfect, two
badly wrong. That is not noise, it is the far end being extrapolated.

### The median hides the real problem

| | median-corner err | worst-corner err | all four <1% |
|---|---|---|---|
| this study (35 answered) | 1.75% | 3.26% | **0 / 35** |
| shipped keypoint detector | 0.27% | 0.54% | **49 / 62** |

**Not one match of 35 has all four corners within 1%**, and 7 of 35 have a
corner more than 5% out. The 2026-08-16 study called this exact column the
honest read of whether a quad is usable, and by that read the
segmentation quads are not.

## 9. Verdict and recommendation

**Not production-worthy as a table detector, and not close.** It is ~6.5×
worse than what ships, answers 57% against 90%, and it fails on the
multi-table venue that is a third of the corpus.

**Use it as a labelling assistant, not a detector.** Its real value is
that it produces a plausible surface mask from a text prompt with no
training data at all, which is exactly what is wanted to bootstrap
annotation for footage where no hand mark exists — a human corrects a
proposal instead of marking from scratch.

**The long-term formulation should be a six-keypoint model, and the
labels are already free.** Four table corners plus two net posts. The
obvious objection is that nobody has ever marked a net post, so the
labels would need making from nothing — but they do not: the post feet
are an exact projective function of the four corners already marked.
`build_6kp.py` writes the whole set:

```
61 matches -> ~/ponglens-data/table-6kp/labels_6kp.json
6956 labelled frames available (the camera is static, so one label
  serves every frame)
post feet inside the picture: 61/61
```

Overlays confirm the derived feet land on the visible post bases in every
venue. Six keypoints on 6,956 labelled frames, no new hand-marking.

Why keypoints over segmentation, on this evidence:

- **Accuracy.** A mask boundary is quantised by the model's internal
  resolution and then has to be *interpreted* into corners; a keypoint
  model regresses the corner directly. The measured gap here is 2.85% vs
  0.27% for exactly that reason.
- **Determinism and speed.** One forward pass, no prompt construction, no
  candidate selection, no zoom pass. The current pipeline runs three to
  seven model calls per frame at ~3.3 s; a small keypoint model is one
  call in tens of milliseconds.
- **Corner identity comes for free.** A keypoint model is *taught* which
  corner is which; segmentation fundamentally cannot know.
- **Licensing.** Fine-tuning RF-DETR Keypoint (Apache 2.0) or ViTPose
  (Apache 2.0) on PongLens's own frames produces weights PongLens owns
  outright — retiring the GPL model with the unlicensed checkpoints,
  which is a standing liability. Not YOLO (AGPL), not OpenTTGames
  (non-commercial).
- **On-device.** Small keypoint models export to Core ML cleanly, which
  is the only route to live camera guidance in the iOS recorder.

### Recommended next step

Fine-tune **RF-DETR Keypoint (Apache 2.0)** on the 6,956-frame set, whole
matches held out by venue, scored with this study's harness against the
same 61 hand marks. The bar to beat is not this prototype — it is the
shipped 0.27% / 0 gross / ~90% answered. If it clears it, PongLens
replaces a GPL dependency with weights it owns; if it does not, nothing
changes and the ladder keeps working.

Two guardrails from the 2026-08-16 study that still apply and must be
re-implemented rather than assumed: **a rejection rule that refuses
rather than guessing** (the camera-height test is what kills quads
stitched across two tables), and **pooling over 16 frames with a
plurality rule**, because §5 confirms the per-frame lottery is real.

## 10. Files

| | |
|---|---|
| `common.py` | corpus, metric, corner conventions, net geometry, drawing |
| `segment.py` | Grounding DINO + SAM 2.1, SAM 3 LiteText, anchors, zoom |
| `corners.py` | mask → quad, edge re-fitting, surface selection |
| `snap.py` | gradient-corridor edge refinement (low value, see §4) |
| `run_seg.py` | per-frame runner, JSON + debug panels |
| `consensus.py` | per-frame gate, clustering, pooling |
| `analyse.py` | the four comparisons in §5 |
| `physical.py` | pixel error → centimetres on the table (§8) |
| `build_6kp.py` | derives the 6-keypoint dataset from corner truth |
| `stats.py` | running aggregates |

Outputs (outside the repo): `~/ponglens-research-work/segtable/out/` —
per-match JSON, debug panels, `net_gallery/`, `consensus.json`.
Dataset: `~/ponglens-data/table-6kp/`.

---

## 11. Would the full (gated) SAM 3 do better? — measured 2026-08-26

Asked directly, and answered with three measurements rather than a guess.

**The geometry is not the bottleneck.** Rasterising each hand-marked quad
into a perfect mask and running it through the whole mask→corners
pipeline recovers the corners at **0.018% median error, 0.051% worst** —
under half a pixel. So the pipeline would happily deliver a production
answer *if the mask were right*. Every bit of the observed error is the
segmenter deciding where the table's edge is.

**The small model is not handicapped where it matters.** The ungated
`sam3-litetext-s0` (2.12 GB) and the gated `facebook/sam3` (3.44 GB)
share the same vision backbone — 1024-wide, 32 layers, 1008 px input.
LiteText shrinks the *text* encoder. Since the vision tower is what draws
the boundary, the full model's advantage should be in deciding *which*
object matches the words, not in placing an edge precisely.

**The error is boundary variance, and a bias correction cannot remove
it.** Comparing predicted quads against truth:

| | linear scale vs truth | spread | error after removing the bias |
|---|---|---|---|
| Grounding DINO + SAM 2.1 | 1.064 (6% too big) | ±0.081 | 1.74% → 1.58% |
| SAM 3 LiteText | 0.826 (**17% too small**) | ±0.088 | 3.50% → 3.54% |

SAM 3 systematically under-segments the table by about a sixth, drawing
an inset region rather than the physical edge — a *concept* error, and
the one thing a larger text encoder might genuinely fix. But the
match-to-match spread (±8-9%) is nearly as large as the bias itself, so
correcting the average changes nothing. **Consistency, not centring, is
what is missing**, and a text encoder does not supply it.

**The size of the ask.** Reaching the 0.5% bar needs the mask boundary
within ~11 source px on all four edges, which at the model's 1008 px
working resolution is ~6 px on a table whose long side is only ~200 px
there. Measured performance is 38-78 px in source terms. That is a **4-7×
precision improvement**, from a model with an identical vision tower.

**Verdict: not worth blocking on, cheap enough to settle if curious.**
Two structurally different SAM pipelines landed at 2.85% and 3.69% —
clustered, not scattered, which is what a shared architectural limit
looks like rather than a tuning gap. The honest expectation for the full
model is somewhere in the same band, possibly fixing the two wrong-table
matches via better grounding, and still several times over the bar.

If access is granted the experiment is one command
(`run_seg.py --backend sam3 --frames 8`); running it on a 10-match subset
would settle it in about fifteen minutes. Nothing else in this document
changes either way.
