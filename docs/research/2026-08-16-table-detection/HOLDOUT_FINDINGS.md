# A holdout set for the table detector

105 frames from 84 matches are in `table_calibration_holdout`, with the
detector's answer on each. **There is no ground truth here, so nothing below is
an accuracy number.** Everything reported is what the detector did and how
confident it said it was. The accuracy reading is yours to supply.

Two things it did surface without ground truth, both covered in their own
sections: the corner *order* disagrees with your hand-marked corners on a
recognisable class of camera angle, and five frames are grossly wrong in a way
the confidence gate only partly catches but a one-line geometry check does.

## What is in the set

| | |
| --- | --- |
| frames | 105 |
| matches | 84, every match in `matches` with a `cut_path` |
| users | 6 (81 frames from a2e61027, 24 from the other five) |
| venues | 6 named, counting `Pingpod` and `PingPod` separately as the data does, plus 13 frames with no venue set |
| declined by the detector | 0 |
| frames per match | 63 matches gave 1, 21 gave 2 |

| venue | frames | matches |
| --- | --- | --- |
| PingPod | 28 | 26 |
| LYTTC | 26 | 22 |
| Westchester TTC | 16 | 16 |
| (no venue set) | 13 | 8 |
| PingPod Dobro | 10 | 5 |
| Pingpod | 8 | 5 |
| Matchpoint | 4 | 2 |

Second frames went to the matches whose user and venue were rarest, so the
smaller venues and the other five accounts are over-sampled relative to their
share of the corpus. That is deliberate: breadth is the point.

Every frame is a **single decoded frame**, not a median composite. Players are
in shot in nearly all of them, mid-rally, with bats, arms and bodies across the
table — which is the honest test and is not what the development corpus was.
Timestamps are spread from 12% to 89% of each video's duration and vary per
frame. Source videos are the cut videos; 102 frames are 1920x1080, one is
1280x720 and two are 608x1080 vertical social clips. Frames were resized the way
`_resize_bounded` does, longest side capped at 1600, before inference and before
upload, so 102 are stored at 1600x900 and the other three unchanged.

Frames are in R2 under `research/table-calibration/v1/holdout/<uuid>.jpg`, 32 MB
in total, JPEG quality 95. Nothing failed to open: all 84 matches produced
frames on the first attempt.

### One thing to know before you read the numbers

**These are new frames, but mostly not new scenes.** 77 of the 105 frames come
from a match that already has a hand-marked row in `table_calibration_review`,
because that corpus was drawn from the same 84 matches. Only 9 frames, from 5
matches, are from a match with no labelled frame at all. The camera does not
move within a match, so a lot of this set is the same room and the same angle at
a different second, with different players and different bodies in front of the
table.

What is genuinely new is the *frame*: a single sharp frame with players in it,
against composites that ghosted the moving players and left background tables
crisp. `detail.dev_corpus_labelled_match` marks which is which if you want to
score the 9 truly unseen frames separately.

## What the detector did

It produced a quad on all 105 frames and declined none. Runtime on CPU was a
median of 0.430 s per frame, mean 0.439 s, max 0.820 s, 46 s for the whole set.
That is the same as the development measurement. It ran on CPU throughout; MPS
was not attempted.

Inlier weight, its own confidence, runs 0 to about 11:

| | |
| --- | --- |
| min | 2.26 |
| 10th percentile | 5.29 |
| median | 7.72 |
| mean | 7.44 |
| max | 10.88 |

| gate | frames accepted |
| --- | --- |
| weight >= 5 | 95 (90%) |
| weight >= 6 | 93 (89%) |
| weight >= 7 | 68 (65%) |
| weight >= 8 | 43 (41%) |

The shipping recommendation of `weight >= 6` accepts 89% here against 95% on the
development corpus. Inlier counts: 11 channels on 23 frames, 10 on 36, 9 on 19,
8 on 13, and 5 to 7 on 14. Median residual is 2.53 px on the 1920x1080 canvas.
95 of the 105 frames had five or more competing table hypotheses in the picture,
which is the multi-table situation the fitter was built for.

Median weight by venue is even: Pingpod 8.9, LYTTC 8.2, PingPod Dobro 7.7, no
venue 7.7, PingPod 7.6, Westchester 7.4, Matchpoint 7.0. No venue collapses,
though the lowest single weights sit at PingPod (2.26) and Westchester (3.63).

## The corner order, and where it disagrees with your hand-marks

This is the finding that matters most, and it is a convention collision rather
than a detection failure.

The detector emits a fixed winding but takes the near end from the network's own
close/far channels, and **on 29 of 105 frames that came out rotated end for
end** — A and B on the far pair. This is not new to these frames: the same
detector does it on 30% of the development corpus, and the scorer there took the
minimum over four cyclic rotations, so it could not see it.

The `quad` column is corrected for this. The rule is geometric and uses no
ground truth: a camera above the table projects the near end lower in the
picture, so if A and B sit higher than C and D the labels are rotated by two.
All 62 hand-marked quads in `table_calibration_review` satisfy that test, and
applying the rule to the detector's output on those same 62 frames lands 55 of
them at the identity rotation. The untouched detector output is in
`detail.quad_source_raw`, the flag is `detail.orientation_rotated_180`, and the
margin the decision turned on is `detail.near_far_margin_px` (median 115 px;
four frames decided on under 40 px and should be treated as coin flips).

**The remaining 7 of those 62 are a real disagreement, and every one is a camera
at the *side* of the table rather than behind an end.** On those the detector
finds the table outline correctly — 0.24% to 0.40% error on six of them, 3.70%
on `becf0e21` — but its labels sit one position round from yours. One position
means A-B lands on the pair of edges you called the long sides, so the two
orders disagree about which pair is the 1.525 m width. Only one of them can be
building a correct metric homography.

I tried to settle which by projecting the model's net line through each quad's
homography and seeing whether it lands on the real net. What that shows:

- **Your hand-marked order implies a net running along the table's length** on
  the four of the seven I drew, which cannot be right. That is unambiguous in
  `gtnet.jpg` for `19a1efc7` and `74d2b8db`, where the table is large and clearly
  resolved.
- **I could not confirm the detector's order directly.** On these same side-on
  views the table projects nearly square and the picture does not resolve the
  net position well enough to call it. `nettest3.jpg` draws both orders on
  `b1c26326` and I would not swear to either from it.

So the deduction, not the observation, is that the detector is the one with the
correct metric labelling here, since the two differ by exactly one rotation and
yours implies an impossible table. **Worth settling with your own eye before you
score corner identity, or the score will measure the disagreement rather than
the detector.** For an overlay that only needs the outline none of this matters.
For anything that builds a homography from the quad — placement — it is length
and width swapped, which is a much worse failure than a few pixels of corner
error.

Nothing the detector reports predicts this class, and I tried three things:

- **Inlier weight.** Median 8.8 on the seven against 7.7 on the rest. *Higher*,
  so a confidence gate makes it worse, not better.
- **The net channels.** All three net-foot channels are inliers in all seven, so
  the fit believes it has explained the net either way.
- **Camera plausibility.** Recovering the focal length and pose from the
  homography for both labellings gives a believable camera for both, on the
  seven and on the fifty-five alike. Median residual is 3.46 px against 2.29,
  which overlaps far too much to gate on.

So corner identity cannot be checked without a label.
`detail.dev_corner_identity_mismatch` is true on the 10 holdout frames that come
from those seven camera setups; the true count in this set is unknown, since a
side-on match with no hand-marked frame carries no flag.

## Frames I expect to be hard

**Five are already visibly wrong** and are the ones to look at first. Their
quads are long thin slivers with corners hundreds to thousands of pixels outside
the frame:

| frame | venue | weight | worst corner outside the frame |
| --- | --- | --- | --- |
| efff9208_1 | PingPod | 2.3 | 3498 px |
| 51625364_1 | Matchpoint | 6.0 | 2080 px |
| 51625364_0 | Matchpoint | 6.8 | 1537 px |
| ad26c307_0 | LYTTC | 4.6 | 1351 px |
| 9a8555e1_0 | LYTTC | 4.4 | 1184 px |

**Two of those pass `weight >= 6`.** Both Matchpoint frames do, and so does
`becf0e21_0` at 6.3 with an edge ratio of 4.8. So on this set the confidence gate
alone would have shipped three quads that a glance rejects. A plain sanity check
— any corner more than 5% of the diagonal outside the frame, or a longest to
shortest edge ratio above 4 — flags 11 frames including all five above, and
`weight >= 6` combined with it declines 15 of 105 (14%). That check costs
nothing and is worth wiring in beside the weight gate.

**The dark backlit PingPod pod is still the worst scene**, exactly as on the
development corpus. Its three frames are the three lowest weights in the whole
set (2.26, 3.14, 3.19) and all three are wrong in the montage. Same room, same
bright window behind a dark table. It reproduced on single frames, so composites
were not the cause.

**Other frames I would look at:**

- The two vertical 608x1080 frames, both from `3821ede7`, a phone clip of a
  tournament broadcast with burned-in captions and a table filling a third of
  the picture. Weights 9.84 and 9.72, and the one I drew was correct, but this
  is the shape the fitter has seen least.
- Broadcast footage rather than club video also turns up as `ce04d42f`, a Czech
  ITTF stream, which took the highest weight in the set at 10.88 and is textbook
  correct.
- The four frames whose near/far margin was under 40 px: `a38ca7c0_0` at 21 px,
  `98be5eb5_0` at 24, `431837d2_0` at 37, `cff81f99_0` at 38. The end-for-end
  correction was close to a coin flip on those, so if one reads backwards that
  is why.
- Weakest after the pod frames: `6a3777db_0` (Westchester, 3.63), `4da91dde_0`
  (LYTTC, 3.75), `a38ca7c0_0` and `cb0e7027_0` (4.36), `9a8555e1_0` (4.39).

## The visual check

`montage.jpg` is 12 frames with their stored quads drawn, corners lettered A to
D, chosen as the three weakest, a known side-on scene, one mid-confidence frame
per venue, then the most confident. Reading it honestly:

- **Nine of the twelve put a clean quad on the table being played on**, picking
  it out of rooms with four to ten tables in shot: 9e15ed10, 58482541, 0ab28972,
  2b268d26, aa42d3b9, e009b852, 16ed0458 and both b1c26326 frames. On the five
  where the camera sits behind an end, the corners are visibly on the corners
  and the projected net falls on the real net.
- **The three PingPod pod frames in the top row are wrong.** efff9208_1 is a
  sliver across the whole room. a0fb8f44_0 and efff9208_0 sit roughly on the
  table but with the far corners thrown out to the right, off the surface
  entirely.
- **b1c26326, 16ed0458 and e009b852 are the side-on case and I cannot call them
  from the picture.** The quad is on the right table and looks like the right
  shape, but A and C land near the midpoints of the long edges rather than
  unambiguously on corners, which is what the one-position rotation looks like.
  b1c26326 and e009b852 are two of the seven the hand-marks disagree with;
  16ed0458 has no hand-marked frame and no way for me to check it. These need
  your eye.

Other sheets in the working directory: `verify_source.jpg` draws the stored
source-pixel quads on frames re-decoded at native resolution from the video,
which is what proves the coordinate scaling rather than assuming it;
`verify_db.jpg` reads four rows back out of the table, pulls their frames from
R2 by `frame_key`, and draws the `quad` column, so it is what a consumer sees;
`overshoot.jpg` shows four of the gross failures against a padded canvas;
`nettest.jpg`, `nettest2.jpg`, `nettest3.jpg` and `gtnet.jpg` are the
net-projection test, the last of them on your own hand-marks; `zoom.jpg` and
`zoom2.jpg` are close reads of individual frames.

## Coordinates

`quad` is in **source pixels** — the video's own resolution, not the stored
frame's — in the cyclic order A near-left, B near-right, C far-right, D far-left,
wound the same way as all 62 hand-marked quads. Frames are stored at the resized
size, so both geometries are on every row: `frame_width`/`frame_height` for the
JPEG and `source_width`/`source_height` for the video. To draw on the stored
frame, multiply by `frame_width / source_width`.

This was verified two ways rather than assumed. The frame was re-pulled from the
video at native resolution and the source quad drawn straight onto it, at three
different source sizes including the 608x1080 vertical and the 1280x720
broadcast; and four seeded rows were read back from the table, their frames
fetched from R2 by key, and the `quad` column scaled down and drawn. Both land on
the table. `detail.quad_frame` carries the same quad in stored-frame pixels and
`detail.scale_source_over_frame` the ratio, so a mistake in either direction is
recoverable.

## What is on each row

`detector` is `segformer-b0-homography` on every row: segformer++ b0 on CPU, no
TTA, fitter at `k=5, tol_frac=0.10, beta=0.90, min_cam_height=0.35`. `detail`
carries `weight`, `inliers`, `inlier_channels`, `median_resid_canvas_px`,
`n_tables`, `cam_height_m`, `runtime_s`, the raw and frame-space quads and the
scale, the rotation flag and its margin, the image aspect, the video duration and
the timestamp as a fraction, the user id, and the two review-corpus facts.
`verdict`, `notes`, `reviewed_by` and `reviewed_at` are untouched and waiting.

## Files

`pull_frames.py` pulls the frames, `run_detect.py` runs the detector,
`seed.py` uploads and inserts, `annotate.py` adds the review-corpus facts,
`montage.py`, `verify_source.py`, `verify_db.py` and `devcheck.py` are the
checks. `pulled.json` is what came out of the videos, `detected.json` the raw
detector output, `detected_norm.json` the same with the end-for-end correction
applied, `devcheck.json` the re-run over the labelled corpus, and `seeded.json`
maps each row id to its frame key. `frames/` holds the 105 JPEGs exactly as
uploaded. Nothing here touched the repository.
