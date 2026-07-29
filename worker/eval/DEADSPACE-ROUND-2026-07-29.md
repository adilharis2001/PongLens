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
