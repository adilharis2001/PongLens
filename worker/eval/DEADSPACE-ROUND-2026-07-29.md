# Dead-space round 3 — 2026-07-29 (Vaibhav six-game match)

Ground truth: the owner's curation of four matches, exported with
`export_labels.py`. Every offline split below was verified to reproduce the
production emission exactly on the target match (150 points, same 21 FP
segments) before any experiment ran.

| match    | id       | camera            | kept | deleted | notes |
|----------|----------|-------------------|-----:|--------:|-------|
| vaibhav  | 2ffe54c7 | behind-table      | 129  | 21      | target match, six games 4-2, match-typed |
| faye     | 1466e3c3 | behind, multi-table club | 53 | 65  | tracker time-shares with neighbor ball |
| vaibhav1 | 9a81e575 | behind-table      | 24   | 3       | drills-style, balls everywhere |
| gui      | a0fb8f44 | SIDE-ON           | 60   | 0       | different angle; baseline itself only re-emits 56/60 (4 pts were manual splits) |

## What the 21 target-match FPs are

Frame-verified classes: pre-match warm-up rally (1, at t=3s, 11.1s long),
mid-match ball retrieval / tossing the ball back across the table (~15),
a between-games break, and post-match handshake blips (TV shows "Thanks
for Playing!"). The toss/retrieval class is the mass.

## Signals measured per play (labels window, production calibration)

detections density, 95p per-frame step, in-gate fast count (and /s),
axis-reversal hits, fitted-track hits/bounces/segments, max segment axis
speed, net-line crossings of the tracked ball (homography), longest
consecutive fast-run (strict and gap-tolerant), audio impact candidates
(hf10k_ema_v1, worker/research_audio_candidates.py) at several confidence
floors, placement candidate counts.

## Findings — why each candidate veto died

* **Audio impacts do NOT separate.** Toss-overs bounce loudly (conf up to
  27); soft real touches produce zero impacts (kept 89/143 on the target
  match have audio_max 0 at real rally frames). Dead as any hard veto.
* **No single kinematic feature separates.** Kept-min vs deleted-max
  overlap on every axis (in-gate: kept min 27 vs deleted max 57 on the
  target match; Faye kept min is ~20 — the margin does not transfer).
* **Longest fast-run was the best feature and still died.** On the target
  match it is clean: every kept point sustains >= 18 consecutive fast
  frames (the serve flight), every toss/retrieval FP <= 10. But on Faye
  the tracker time-shares with the neighbor table's ball and real rallies
  fragment to runs of 10-13 (gap-tolerance helps only partly), and on the
  side-camera Gui match REAL points measure runs as low as 6 (frame-
  verified real play). The only recall-safe threshold (< 6 frames) keeps
  ~nothing. End-to-end matrix with a 0.45s veto: target 21 FP -> 10 at
  100% recall, but Faye 96.2%, vaibhav1 95.8%, Gui -4 further points.
  Hard constraint (>= 99% kept recall per match) violated -> rejected.
* **net_cross==0 AND tr_bounces<=3** (kills 15/21 on the target match,
  0 casualties on Faye) kills 7 real Gui points — the side camera breaks
  net-crossing attribution. Rejected.
* **The sub-threshold zone is intrinsically ambiguous**: a kept netted
  serve (real point, server faults) is feature-identical to a deleted
  toss-over in every measured signal — e.g. Faye kept 41 vs Faye deleted
  46 match on run/bounces/audio almost exactly. No corroborating rule
  exists in ball-track space.

## Round 2 (same day): two more hypotheses tested, both NEGATIVE

### Serve-motion evidence does NOT separate points from dead space

Ran the production `match_structure.detect_server_side()` (RTMPose-m, body7
ONNX — research use only, MPII forbids commercial use) over the first 2.5s
of all 150 labeled Vaibhav points, 4,238 posed frames.

  serve score  AUC 0.626   (ball-track fast-run on the same match: 0.823)
  toss score   AUC 0.750
  "high_confidence serve" fires on 125/129 kept AND 13/21 deleted (62%)
  NO threshold removes a single FP without losing a real point.

A 2-feature grid search over serve/toss score CROSSED WITH every ball
feature returned 8 recall-safe rules — and not one of them uses a serve
feature. It contributes nothing.

Cause, and why no tuning fixes it: the score measures wrist-to-ball
proximity plus "ball rose above the shoulder". Someone picking up a stray
ball and tossing it back over the table satisfies both — their hand IS on
the ball and the ball DOES go up. It is mechanically the same event as a
serve toss. Caveat: production player boxes are huge (52% frame width,
85% height) and RTMPose is top-down/one-person-per-box, so on a busy venue
it may pose a bystander; a tighter box might score better but cannot
resolve the confound above.

Pose serve detection remains valuable for its actual purpose (who served,
so Keep Score need not ask). It is not a dead-space signal.

### Cropping to the table before inference does NOT work on this angle

Hypothesis: BlurBall resizes every frame 1920x1080 -> 512x288, so the ball
is a few px; cropping to the gate bbox would (a) exclude neighbour-table
balls and (b) enlarge the ball. Implemented properly — gate bbox expanded
to exactly 16:9 (blurball's inverse affine assumes 16:9), ffmpeg crop,
inference on the crop, coordinates shifted back to full-frame, then the
UNCHANGED pipeline on the original video.

  match     zoom   recall            FPs        in-rally detection
  faye      2.39x  100% -> 50.9%     23 -> 27   93.0% -> 66.3%
  vaibhav   1.59x  100% -> 72.1%     21 -> 11   80.2% -> 86.4%
  gui       2.51x  93.3% -> 73.3%     0 ->  0   72.4% -> 72.8%
  vaibhav1  2.51x  100% -> 50.0%      3 ->  2   88.4% -> 59.8%

Recall collapses everywhere. The decisive measurement is geometric: the
1st-99th percentile box of ball positions DURING KEPT POINTS spans

  faye 1725x564 px (47% of frame)  -> max safe zoom 1.11x
  vaibhav 1685x881 (72%)           -> 1.14x
  vaibhav1 1666x762 (61%)          -> 1.15x
  gui 884x541 (23%)                -> 2.17x   (side camera, tight framing)

On a behind-the-table camera the ball legitimately uses ~90% of the frame
WIDTH during real play — players stand back and wide, and balls fly off the
table. Any crop tight enough to zoom meaningfully cuts real rallies. This
also corrects an earlier misreading: the "52% of faye detections fall
outside the table gate during real play" figure was NOT mostly the
neighbour's ball, as assumed — removing that region lost 26 real points, so
most of it was the real ball outside the padded table box.

The zoom benefit itself is real but small: vaibhav's gentler 1.59x crop
raised in-rally detection 80.2% -> 86.4%. The only way to capture it
without discarding pixels is higher effective input resolution — TILING the
frame into overlapping halves at native scale (~1.8x, full coverage) is the
untested variant. It needs a merge rule for per-frame detections across
tiles (the tracker is global, one ball per frame), so it is a real build,
not a config change. Do NOT simply raise the model input size: the detector
was trained at 512x288 and CNNs are scale-sensitive.

## Conclusion

The dead-space split is at its practical limit on ball-track evidence.
The remaining FP class (ball handling at the user's own table, plus
warm-up rallies) is separable only by understanding WHO does WHAT with
the ball — i.e. serve-motion / player-pose evidence. That is exactly the
deferred RTMPose serve-detection design
(docs/superpowers/specs/2026-07-29-rtmpose-production-serve-detection-design.md)
and the EPT match-structure experiment
(~/Desktop/PongLens-Reports/vaibhav-match-structure-20260729/), which
already calls serve side with high confidence on sampled points. When that
stage lands, a "no serve motion near the play start" veto is the natural
next experiment — gated on competitive match types (in drills, isolated
serve reps and ball handling ARE content; the drills-style vaibhav1
labels prove users keep them).

## What DID ship from this round

Clip context pads were decoupled from the span pads (CLIP_PADS here,
matches.clip_pads migration 048): t1 already sits at the last ball motion
(median 0.13s gap over 129 kept points), so the old 1.6s tail pad was
pure dead air, and the head opened ~1.8s before serve contact. New
normal-strictness clips open ~0.4s later and end ~0.7s earlier with zero
information loss. Head-anchoring clips on the detected serve flight was
ALSO rejected: in 13/129 kept points the first sustained run starts after
the first bounce (fragmented serve tracking), which would have cut real
serves.

Reproduction kit: labels + blurball detections + per-point features for
all four matches lived in the session scratchpad (deadspace/); regenerate
with export_labels.py + blurball_infer.py + this round's method above.
score_split.py is unchanged and remains the referee.
