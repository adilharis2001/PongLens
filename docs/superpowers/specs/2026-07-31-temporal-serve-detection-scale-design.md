# Temporal Serve-Detection Scale Experiment Design

## Objective

Determine whether a learned temporal model over both players' RTMPose
sequences can materially increase automatic first-server coverage while
preserving high precision.

The experiment targets the product question, not merely exact contact time:

> From the opening point clips, identify which physical player served each
> point, then infer the match's first server from the legal ITTF rotation.

This remains a research-only, read-only experiment. It cannot change a
production match, point, score, first-server value, or user experience.

## Research Basis and Original Contribution

Published table-tennis action-recognition work supports treating a serve as a
motion sequence rather than a collection of independent thresholds. The most
direct precedent combines both players' pose coordinates with a recurrent
sequence model and classifies serve, receive, and other activity in sliding
windows. TTNet further shows that fast ball events require frames before and
after the event, while P2ANet shows that action recognition is easier than
precise temporal localization.

PongLens will use these ideas, not their implementations or datasets. The
experiment is an original paired-player temporal detector with:

- RTMPose instead of OpenPose;
- PongLens-owned or otherwise authorized production footage;
- weak point-level supervision from user-authoritative first-server values
  and an independently calculated ITTF rotation;
- table-relative pose normalization;
- current ball, legal-bounce, and audio signals as independent confirmation;
  and
- match-level first-server decoding with explicit abstention.

No BetterPlay implementation is available publicly. Its product is evidence
that large, varied training data can make rally segmentation useful, but it is
not an implementation dependency or evaluation source.

## Approaches Considered

### Selected: paired-player temporal pose model with multimodal confirmation

Learn the service-motion pattern across time from both players, then confirm
or reject the point call using the existing legal bounce chain, ball, and
audio evidence. This directly addresses the current detector's principal
failure: high precision in a known serve window but very low automatic
coverage.

### Benchmark only: scale the existing deterministic detector

Running the frozen detector on a larger cohort is retained as the control. It
can measure generalization but cannot learn the varied toss, preparation, and
occlusion patterns absent from its hand-authored rules.

### Deferred: end-to-end raw-pixel video model

A raw-video transformer or 3D CNN may eventually outperform pose-only input,
but it requires substantially more labeled data and compute, is harder to
diagnose, and creates more checkpoint and training-data licensing risk. It is
not justified before testing the smaller pose-sequence model.

## Cohort

Target 500 to 1,000 scored point clips from at least 30 eligible production
matches. Use every eligible match if production contains fewer than 30 and
classify the resulting evaluation as preliminary.

A match is eligible when:

- `matches.first_server_source` is user-authoritative;
- the user's physical near/far side can be resolved;
- point order, games, lets, explicit server overrides, and game boundaries
  are sufficient to walk the ITTF rotation;
- at least five retained, scored point clips have immutable media; and
- table calibration is usable.

Cap the contribution of any one match so a single player, venue, or camera
cannot dominate. Preserve natural hard cases including long preparation,
walking, ball retrieval, player handoffs, occlusion, neighboring tables, and
missing or dead-space-removed points.

### Split contract

Split by entire match before feature extraction or threshold selection:

- training: approximately 50% of matches;
- development: approximately 20% of matches; and
- sealed holdout: approximately 30% of matches, with at least ten matches.

When possible, keep repeated player-camera combinations in only one split.
The newest eligible Chris-labelled match uploaded on July 30, 2026 is a named
fresh holdout canary and must not be used for fitting, threshold selection, or
hard-negative mining. Resolve its immutable match ID when building the
manifest. Seal match IDs, point IDs, media hashes, and split assignment before
inference.

## Truth and Blinding

For each point, derive physical-server truth after model inference from:

1. the user-authoritative match first server;
2. the user's physical side;
3. the ITTF two-serve rotation, including deuce;
4. game alternation, lets, and explicit server overrides; and
5. any retained-point alignment required by deleted or skipped clips.

The feature builder and inference path must not receive first-server truth,
player identity, score, winner, reviewer labels, or future point calls. During
training, the rotation-derived side enters only the loss function as the
target; it is never serialized into a feature tensor. The truth walker lives
outside the model input path and is covered by leakage tests.

The existing 42 rich human annotations are timing supervision and diagnostic
truth only. They are not part of the final match-level holdout.

## Feature Extraction

For each retained point, inspect from clip start through the earliest reliable
end of the opening serve/receive sequence, falling back to at most 12 seconds
when preparation is long or ball events are missing.

Cache once per immutable media hash:

- COCO-17 RTMPose keypoints and confidence for near and far players;
- normalized joint positions relative to torso size and calibrated table
  axes;
- first- and second-order joint motion for wrists, elbows, shoulders, hips,
  and torso;
- pose visibility and occlusion indicators;
- BlurBall position, velocity, visibility, and wrist proximity when present;
- legal first/second-bounce candidates and their table halves; and
- high-frequency audio-impact candidates.

Pose sampling begins at 15 frames per second. A measured sparse alternative
may be retained only if an ablation shows no material accuracy loss. The
extractor records wall time, inference time, posed frames, peak memory, cache
size, and projected per-match worker cost.

## Temporal Model

Use a small, commercially unencumbered model implemented in PongLens: a
two-layer bidirectional GRU with 64 hidden units per direction and a temporal
attention head over normalized pose features. Use overlapping 36-frame
windows at 15 frames per second. Architecture and threshold selection use
development matches only.

Each point is a bag of overlapping temporal windows. Point-level rotation
truth says which physical player served but does not reveal the precise serve
frame. Train a paired ranking/classification objective so that:

- at least one window for the true server receives a strong serve score;
- the receiver's windows score lower by a calibrated margin; and
- explicit no-serve/dead-action windows remain below the serve threshold.

Clean negative windows come only from reviewer-designated dead/skipped clips,
from time before a labeled onset, or from time after a labeled receiver
contact. Do not assume an arbitrary unlabeled early interval is negative; it
may contain a delayed or occluded serve.

Clean timing supervision from the 42 labeled points anchors the response near
the genuine service motion and penalizes peaks on retrieval, handoffs,
walking, or later rally strokes. It supplements but does not dominate the
larger weakly supervised cohort.

The model outputs a time series of near-serve and far-serve likelihoods, an
estimated onset, and a point-level near/far/withheld call. It does not need to
estimate spin or see paddle contact.

## Fusion and Match Decoding

Evaluate the temporal model alone before fusion. The fused detector then
combines independent evidence:

- temporal pose likelihood identifies the likely serving player;
- ball and legal two-bounce geometry confirm that play became a serve;
- audio supports contact or bounce timing but cannot identify a player; and
- contradictions lower confidence or force abstention.

Do not require a successfully reconstructed two-bounce chain when the temporal
model is exceptionally strong; that would preserve the current coverage
bottleneck. Conversely, pose cannot override a clearly contradictory legal
chain without a development-calibrated margin.

Run point calls through the first-server decoder over the first five retained
points using the legal `A,A,B,B,A` pattern, with at most one missing point.
Keep both point-level soft likelihoods and high-precision hard calls so the
experiment can measure whether sequence-level aggregation recovers useful
evidence currently lost to point-level abstention.

## Baselines and Ablations

On identical sealed splits, report:

1. frozen deterministic serve-chain plus RTMPose detector;
2. temporal pose model without ball or audio;
3. temporal pose plus ball visibility and wrist proximity;
4. temporal pose plus legal bounce confirmation;
5. temporal pose plus audio;
6. complete fused point detector; and
7. complete fused detector plus first-five-point ITTF decoding.

Also compare fixed-threshold hard calls with soft sequence aggregation. No
ablation may be selected using holdout results.

## Metrics and Gates

Primary metrics:

- match-level first-server precision and coverage;
- number of opening points required;
- behavior with one synthetically skipped point;
- point-level physical-server precision and coverage; and
- worst-match and per-camera outcomes.

Diagnostic metrics:

- visible versus occluded service motion;
- long-preparation and ball-handoff false positives;
- onset error on the 42 human-labeled points;
- bounce-chain availability and correctness;
- precision-recall and calibration curves; and
- compute and projected cloud cost.

Decision gates on the untouched holdout:

- automatic first server: at least 95% match-level precision, at least 60%
  coverage, at least ten decided matches, and no systematic camera failure;
- confirmation-required prefill: at least 90% precision with useful coverage;
- otherwise: research-only, retain the explicit first-server question.

If the available holdout has fewer than ten matches, report the measured
result as preliminary regardless of precision and rerun after more uploads.

## Reviewer Work

Do not ask the owner to label hundreds of points up front. First train and
score using rotation truth. Then produce an active-review subset of no more
than 60 points selected from:

- confident model/truth contradictions;
- high-confidence false positives on walking or ball handoffs;
- pose and bounce disagreement;
- occluded high-value abstentions; and
- underrepresented venues or camera orientations.

The existing hosted research UI may be extended only after this subset exists.
Reviewer labels must remain evaluation/training artifacts and cannot mutate
the original production match.

## Licensing Constraints

- RTMPose/MMPose remains the only pose dependency.
- Do not add YOLO, Ultralytics, OpenPose, AGPL components, or weights.
- Do not train on OpenTTGames or another non-commercial dataset.
- Do not use P2ANet video or weights without separately documented commercial
  permission and source-video provenance.
- Published papers may inform architecture, but all PongLens training code,
  labels, and model checkpoints in this experiment must be independently
  produced from permitted inputs.

## Outputs

- a sealed, reproducible train/development/holdout manifest;
- cached versioned pose and multimodal features;
- deterministic baseline results on the expanded cohort;
- trained temporal-model checkpoints with input and dependency provenance;
- ablation, calibration, compute, and failure-analysis reports;
- a focused active-review export if further labels are justified; and
- a final recommendation of `automatic`, `prefill_only`, or `research_only`.

No production deployment is part of this experiment.
