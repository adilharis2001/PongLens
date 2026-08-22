# Camera guidance: everything measured, and the road that remains

2026-08-18, evening session. Goal: from a user-value standpoint, help a
player position the camera correctly before a match — or at least tell
them clearly when their spot won't work — given real rooms and real
constraints. Everything below is measured against our own corpus unless
marked otherwise.

## The one-paragraph conclusion

Nothing in Apple's built-in vision stack can find a table tennis table
from our camera angles today; that was measured, not assumed. The two
things that genuinely deliver the user value are (1) telling the player
*after processing* when the camera position was the problem — the
calibration ladder already computes the answer and the app currently
swallows it — and (2) a small corner-detection model trained on our own
footage, for which the data pipeline now exists, a first baseline is
training, and the labeled-data window nearly closed this week without
anyone noticing.

## What Apple's stack offers, measured on 61 hand-marked corpus frames

- `VNDetectRectanglesRequest`: **0/61**, every parameter configuration,
  every venue. It returns TVs, mats and shelves; oblique table quads with
  a net splitting the top edge sit outside its model. Closed.
- Edge-energy locking (corridor and neighborhood variants, full Swift
  implementation): no shippable operating point — 38 false locks open-
  field; 5 true vs 44 false fires at the workable threshold seeded. The
  basin at the true corners is real and razor sharp, but nothing
  classical finds the corners. Closed (see
  2026-08-18-live-table-lock-measurements.md).
- `VNDetectContoursRequest`: sees the boundary far better than the
  rectangle detector — on 50/61 frames contour points trace near the true
  outline (4 within 2% of the diagonal, 46 within 5%). But contours are
  soup: assembling and *discriminating* the table quad from them is the
  same problem that killed edge energy. Verdict: a possible input feature
  for the model, not a solution.
- ARKit plane detection: not measurable offline, and structurally wrong
  for the tripod workflow — plane discovery needs parallax (a moving
  phone) and texture (uniform dark tabletops have little), owns the
  camera (forcing a setup-phase handoff), and goes blind exactly when
  drift-watching matters (after handoff). RoomPlan shares the machinery
  and its table extents are coarse boxes. Revisit only for a handheld
  walk-around flow, never as the backbone.
- iOS 26 Vision additions (document reader, aesthetics scoring, the
  Swift-only API): nothing applicable to metric quad detection. The
  supported path for a custom detector is unchanged: Core ML model behind
  `VNCoreMLRequest`, fed by the recorder's own frames — no session
  conflict, licence-clean.

## The quick win nobody has to wait for: post-hoc position feedback

Two facts make this cheap and honest:

- When the ladder calibrates a match, `pose_from_homography` turns the
  quad into the camera's position in metres — worker code that already
  runs. Comparing it against the mined envelope gives axis-specific
  observations ("very close to the end line", "side-on", "low").
- When the ladder REFUSES — about one match in ten — that refusal is
  itself the strongest position verdict we own, and today the user just
  silently gets no placement map. Nothing tells them why, or that moving
  the camera next time would fix it.

One caution the corpus insists on: among matches that *calibrated*,
being outside the envelope barely predicts worse placement outcomes
(15/18 ready inside vs 12/14 outside). The envelope describes where
good cameras stood, not a cliff. So the feature's voice should be:
calibration refusal → a clear "we couldn't find the table from this
camera position" with the guidance; calibrated-but-unusual → at most a
gentle note tied to documented harms (side-on hurts point detection —
the Westchester program exists because of it; very close hides the far
court). Never a scolding for a match that processed fine.

Build shape (roughly two days, all server + app copy, no new CV): the
worker records pose + verdict beside the calibration in match.json and a
column; the match page and the ready email carry one plain sentence when
it matters; the Record tab's ghost is the "what to do instead".

## The model: data secured, pipeline built, baseline training

The unlock is that our cameras never move: one trusted quad labels every
frame of that match's video. `worker/build_table_corner_dataset.py` now
harvests frames straight out of the cut videos over presigned HTTPS (no
full downloads) into `~/ponglens-data/table-corners/` with per-match
labels — 61 labeled matches, ~2,400 frames on first run, extendable to
every future calibrated match.

**The retention deadline mattered more than expected:** cut objects die
at 30 days, and the 2026-07-22 cohort — including every hand-marked
Westchester match — had roughly three days left when the harvest ran.
The dataset now exists on disk regardless of retention. Future matches
should be harvested as they calibrate (a small worker step).

`worker/train_table_corners.py` trains a ~1.5M-parameter from-scratch
heatmap CNN (four corner channels, 320×180 input, mirror augmentation
that swaps corner identities, whole-match holdout stratified by venue).
From-scratch sidesteps every licence question; Core ML conversion via
coremltools is the standard exit. Precedent says this works: tennis
court keypoint detectors train 14-point models on ~9k frames; ours is 4
points in more constrained scenes.

**Baseline results, same evening** (18 epochs, ~25 minutes on the Mac
Studio's MPS; 1,871 training frames from 49 matches; 444 eval frames
from 12 fully held-out matches):

    mean corner error 5.5% of the diagonal
    57% of held-out frames within 2%  ·  62% within 4%

For calibration: every classical approach measured today produced
effectively zero true locks. This first, untuned network localizes the
majority of frames from matches it has never seen — including the
LYTTC overlay where it picks the correct table's four corners in a room
with four other tables in view and a player occluding the near edge.
The error distribution is bimodal, and the tail is exactly where
predicted: venues with too few matches to both train and hold out
(PingPod Dobro's held-out frames throw corner C at an EXIT sign).
Look at run1/overlays/ before believing any number.

Known headroom, none of it exotic: sub-pixel heatmap decoding, more
frames per match (40 now, hundreds available), longer training, a
pretrained permissive backbone, geometric consistency filtering at
inference (the pose gate already written), and above all more venues as
they arrive. Core ML conversion needs one `pip install coremltools`
when the model earns it.

## The staged product path

1. **Now (shipped, build 8+):** the eye-aligned ghost from the mined
   golden pose — corridor pinch, flip, level line.
2. **Days:** post-hoc position feedback (refusal → clear explanation +
   pointer at the ghost; unusual-but-fine → gentle note or nothing).
   Also: harvest-on-calibrate so the dataset grows itself.
3. **Weeks:** the corner model to ship-quality, evaluated on the same
   harness and thresholds that killed the classical approaches (true
   locks vs false fires on held-out matches), then the live lock UX
   already designed and archived — green moment, auto side and
   distance, drift watch, corners riding uploads as calibration priors.
4. **The judge for step 3** is telemetry from step 1-2: if ghost-guided
   recordings keypoint-calibrate at high rates, the model is a luxury;
   if refusals persist, the model has its mandate and its training set
   is already waiting.
