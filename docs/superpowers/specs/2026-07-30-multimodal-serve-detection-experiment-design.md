# Multimodal Serve-Detection Experiment

**Date:** 2026-07-30

**Status:** Approved for experiment design; implementation requires a separate reviewed plan

**Branch:** `codex/openai-table-calibration-experiment`

## Decision

Build a read-only experiment that attempts to locate the real serve in every
point and identify the server's table end. The primary detector will be an
interpretable, local fusion of ball trajectory, calibrated table geometry,
audio impacts, and rally continuation. Player-region motion may strengthen a
candidate but will not be required. A commercial vision API will be evaluated
only as a fallback for locally ambiguous cases.

The experiment will not change production data, scoring, game boundaries, or
the Keep Score UI. Side-change detection remains a separate follow-up
experiment because it uses different evidence and success criteria.

## Why the Previous Detector Was Insufficient

The existing proof of concept:

- examines only the first 4.5 seconds of a point;
- depends on the tracked ball appearing close to RTMPose wrists;
- treats early activity as more likely to be the serve;
- does not recognize the legal serve sequence on the table;
- does not fuse the existing high-frequency audio-impact candidates; and
- cannot distinguish a serve from retrieving, carrying, or throwing the ball
  before play begins.

Real point clips may contain up to ten seconds of unrelated activity before
the serve. The new detector must find a serve event within the entire clip,
not assume that play starts near frame zero.

## Objectives

For every observable point:

1. Locate the serve contact time.
2. Identify whether the near-end or far-end player served.
3. Return calibrated confidence and explicit supporting evidence.
4. Abstain when the available video, audio, ball track, or table calibration
   cannot support a high-precision answer.

At match level:

1. Infer the first server from per-point calls and the expected two-serve
   rotation, switching to one serve each at deuce.
2. Detect later calls that contradict the expected rotation.
3. Measure whether high-confidence automation is reliable enough to prefill a
   choice while preserving manual correction and Undo.

## Non-Goals

- Production integration or database writes.
- Automatic game-ending or side-change detection.
- Serve-spin classification.
- Training a large video foundation model.
- Reintroducing Ultralytics, YOLO, GPL, AGPL, or research-only dependencies.
- Forcing a decision on points whose serve is cut off or unobservable.

## Approaches Considered

### A. Local multimodal serve grammar — selected

Generate candidate events from ball-track changes and audio impulses, then
validate their ordered relationship to the calibrated table and subsequent
rally. This approach is explainable, inexpensive to run, and can abstain for a
specific reason.

### B. Vision-API-first classification — rejected as the primary detector

A multimodal API could inspect a storyboard from every point. This is fast to
prototype but creates recurring cost, is less deterministic, and may make
confident spatial mistakes. It will instead be tested only on ambiguous local
candidates.

### C. Learned temporal serve classifier — deferred

A small PongLens-owned classifier may ultimately outperform hand-tuned
fusion. It should be considered only after this experiment creates reviewed
candidate windows, labels, and failure categories. Starting with it now would
make failures harder to diagnose and would require a larger labeled set.

## Commercial-Use Boundary

The first experiment uses:

- original PongLens code;
- the existing ball detections and placement-map table geometry;
- FFmpeg, NumPy, SciPy, and OpenCV already used by the worker;
- optional RTMDet player boxes from Apache-2.0 MMDetection; and
- an optional paid commercial vision API governed by the provider agreement.

The experiment must produce a dependency ledger containing the exact code
version, checkpoint hash, source URL, and license for every added component.
It must reject GPL, AGPL, non-commercial, evaluation-only, or unclear model
weights. A paper citation or informal attribution is not treated as
commercial permission.

RTMDet is optional in this experiment. It may identify which player region
contains motion around a candidate, but the detector must remain useful
without it. ByteTrack and DINOv2 are not required for serve detection and
belong to the later side-change experiment.

## Dataset and Bias Control

### Development set

Use every observable point from the previously studied Vaibhav and Tripp
matches. These matches may be used to inspect failures and choose thresholds,
but their results cannot justify shipping because prior experiments have
already exposed them.

### Locked holdout

After thresholds are frozen, evaluate at least:

- 150 observable points;
- six matches;
- three distinct camera or venue setups; and
- a meaningful collection of long pre-serve delays, ball retrieval, walking,
  ball passing, noisy rooms, short serves, long serves, and partial
  occlusions.

If retained media cannot satisfy these minimums, the report must label the
result preliminary rather than silently reducing the sample requirement.

The detector must not read user-entered first-server values, point-level
server fields, score-derived rotation, winners, or grading notes while
generating predictions. These fields may be used only by the evaluator after
prediction artifacts are sealed and hashed.

### Ground truth

The review tool will collect, for each point:

- actual serve-contact timestamp;
- near or far server;
- whether the first visible bounce is on the server half;
- whether the next visible bounce is on the receiver half;
- `observable`, `ambiguous`, or `serve_missing`;
- hard-negative flags such as walking, retrieval, passing the ball, dropped
  ball, background-table impacts, or multiple plausible candidates; and
- an optional note.

Ground-truth review must hide model predictions until the label is submitted.
The finalized reference file is immutable and content-hashed.

## Input Contract

Each experimental point provides:

- the full point clip and its frame rate;
- decoded mono audio with an exact audio-to-video time mapping;
- existing ball detections with frame timestamps;
- a validated table quadrilateral and homography when available;
- existing placement-map bounce candidates when available; and
- optional person boxes or player-region motion features.

Missing inputs produce explicit evidence states. They do not become zero
scores that can accidentally look like negative evidence.

## Detection Pipeline

### 1. Search the full clip

Analyze the entire point rather than a fixed opening window. The materializer
preserves up to ten seconds of pre-serve activity when present and records
whether the source appears cut before the serve.

### 2. Generate candidate contact events

Candidate timestamps come from the union of:

- high-frequency audio impulses;
- abrupt ball acceleration or direction changes;
- the first usable section of a newly appearing ball track; and
- optional concentrated motion within a player's arm-and-torso region.

Nearby timestamps are clustered into one candidate. Candidate generation is
intentionally high recall; validation removes retrievals, drops, and passes.
Player-region motion uses ordinary frame-to-frame motion or optical flow
inside an RTMDet person box; it does not require a pose checkpoint.

### 3. Evaluate the serve grammar

For each candidate, seek the following ordered sequence:

1. optional toss or concentrated player-region motion;
2. racket-contact evidence;
3. a projected ball impact inside one table half;
4. movement across the calibrated net axis;
5. a projected impact inside the opposite table half; and
6. continued rally evidence after the second bounce.

A projected bounce combines:

- a ball-motion reversal or placement-map bounce candidate;
- proximity to the calibrated table surface in image space;
- a location inside the table polygon; and
- an audio impulse close to the predicted impact time when usable audio
  exists.

The two table impacts and net crossing are the central geometry. Arm motion
and audio increase confidence but do not independently create a valid serve.
This prevents a thrown or dropped ball from winning solely because it was
near a player or made a loud sound.

### 4. Choose the candidate

Candidates receive an evidence vector rather than only one opaque score:

- table calibration validity;
- track continuity;
- contact evidence;
- first-bounce support;
- net-crossing support;
- opposite-half bounce support;
- audio alignment;
- player-region motion;
- rally continuation; and
- contradictions.

High confidence requires the ordered table sequence with no hard
contradiction. Supporting features determine separation between multiple
valid candidates. If two candidates remain close or the required geometry is
missing, the local detector abstains.

The selected server end is the end containing the player responsible for the
first table-half bounce. Player identity is not needed at this stage; near
versus far is sufficient.

### 5. Aggregate match evidence

Every point remains an independent call. After those calls are sealed, the
evaluation-only match aggregator uses the reviewed game and point positions
to:

- convert each call into an expected first-server vote using two serves per
  player before deuce and one serve per player at deuce;
- account for the first server alternating between games;
- requires at least two consistent high-confidence votes;
- reports rotation contradictions without rewriting any point; and
- withholds the first server if the vote margin or coverage is insufficient.

The evaluation will report both raw independent accuracy and
rotation-constrained match accuracy so that score rules cannot conceal a weak
detector. Reviewed game positions are evaluation metadata, not an input to the
independent point detector.

### 6. Optional vision-API arbitration

Only locally ambiguous points are eligible. The request contains:

- eight to twelve frames around the top one or two candidates;
- a compact storyboard with chronological labels;
- a table-focused crop and, when useful, player crops;
- no names, match IDs, scores, account information, or filenames; and
- no more media than necessary to compare the candidates.

The API answers which candidate, if any, is the serve and which table end
served. It cannot override a hard geometric contradiction. Its incremental
precision, coverage, latency, token usage, and cost are measured separately.
Provider storage is disabled when supported.

## Ablation Matrix

Run every point through the same frozen cases:

| Arm | Evidence |
| --- | --- |
| A | Existing early wrist-proximity detector |
| B | Ball trajectory plus calibrated serve grammar |
| C | B plus audio alignment |
| D | C plus player-region motion |
| E | D plus vision-API arbitration for ambiguous cases |

This isolates whether table geometry, audio, motion, and the API each add
useful information. The final recommendation cannot rely on a combined score
without showing these incremental results.

## Metrics and Acceptance Gates

### Point-level metrics

- **Serve localization accuracy:** selected contact is within 400 ms of the
  reviewed timestamp.
- **Server precision:** correct near/far call among points the detector
  chooses to automate.
- **Coverage:** fraction of observable points automated.
- **False-event rate:** non-serve activity incorrectly selected as the serve.
- **Abstention quality:** accuracy and failure reasons among withheld points.

### Match-level metrics

- Correct first server among automatically decided matches.
- Fraction of matches receiving an automatic decision.
- Number and accuracy of rotation-contradiction warnings.
- Accuracy broken down by venue, camera, audio quality, serve length, and
  pre-serve delay.

### High-precision acceptance gate

The frozen holdout must achieve:

- at least 98% server precision;
- at least 60% observable-point coverage;
- 100% first-server accuracy among at least five automatically decided
  holdout matches;
- no confidently selected walking, retrieval, dropped-ball, or ball-passing
  event; and
- no material subgroup below 95% precision when it has at least 20 examples.

If the sample is too small to test a gate, the gate remains unproven.

### Operational measurements

Record:

- decode, audio, ball-evidence, optional RTMDet, API, and total wall time;
- p50 and p95 processing time per point;
- peak memory and available CPU/GPU utilization;
- API requests, tokens, and dollars per match; and
- the fraction of points that trigger API fallback.

The API arm is operationally acceptable only if it improves coverage by at
least ten percentage points without reducing precision and remains below
$0.10 per processed match on the holdout. Local compute is reported before a
production budget is selected; the experiment must not hide model load time
or amortize across unrelated matches.

## Failure Taxonomy

Every miss or abstention receives one primary reason:

- serve cut from clip;
- unusable or missing audio;
- missing or fragmented ball track;
- invalid table calibration;
- first bounce not observable;
- second bounce not observable;
- ambiguous multiple candidates;
- background-table audio collision;
- player or ball occlusion;
- unusual or illegal serve sequence;
- rally did not continue; or
- unexplained model error.

This distinction determines whether to improve cutting, ball tracking, table
calibration, audio fusion, candidate scoring, or the review experience.

## Review Report

Generate a local static report with:

- match and aggregate acceptance metrics;
- side-by-side ablation results;
- precision-versus-coverage curves;
- compute and API-cost summaries;
- failure-category counts;
- per-point video, synchronized waveform, audio candidates, ball track,
  table polygon, inferred bounces, and selected event;
- the frozen prediction and reference values; and
- Correct, Wrong, Unobservable, and note controls with local persistence and
  JSON export.

The report must make false confident decisions visually prominent. Coverage
alone must never be presented as accuracy.

## Components

Keep the experiment isolated into:

1. **Case materializer:** read-only media download, synchronization metadata,
   and privacy-safe manifests.
2. **Reference tool:** blind ground-truth capture and content locking.
3. **Candidate extractor:** audio, ball, and optional motion candidates.
4. **Serve-grammar evaluator:** table sequence validation and evidence vector.
5. **Match aggregator:** first-server voting and rotation diagnostics.
6. **API arbiter:** bounded ambiguous-case requests and usage accounting.
7. **Evaluator:** ablations, metrics, thresholds, and failure taxonomy.
8. **Report renderer:** static review UI and exports.

No component may import production write paths.

## Validation

### Unit tests

- audio/video timestamp alignment;
- candidate clustering;
- table-half and net-axis classification;
- valid and invalid bounce order;
- duplicate audio impulses;
- multiple candidate ranking;
- rotation voting;
- abstention behavior;
- API schema and request-size limits; and
- dependency-license rejection.

### Integration tests

- synthetic points containing retrievals and dropped balls;
- reviewed golden clips for short and long serves;
- missing-audio and missing-ball cases;
- malformed calibration;
- deterministic reruns from identical manifests; and
- proof that production database and object-storage write functions are never
  invoked.

### Experiment integrity

- Append-only run IDs and artifacts.
- Content hashes for cases, references, thresholds, code revision, and model
  weights.
- Thresholds frozen before holdout labels are revealed.
- No post-hoc holdout tuning; a change requires a new holdout run.

## Decision Outcomes

### Green

All acceptance gates pass. Recommend an evidence-only production phase,
followed by automatic server prefilling with one-tap correction and Undo.

### Amber

Precision passes but coverage does not. Retain manual first-server input while
showing high-confidence suggestions, or use the detector only as a rotation
sanity check.

### Red

Precision fails. Do not ship automation. Use the labeled candidate windows to
decide whether a small PongLens-owned temporal classifier is justified or
whether the upstream cutter, ball tracker, or calibration must improve first.

## Follow-Up Boundary

The later game-boundary experiment may reuse:

- table calibration;
- synchronized full-timeline media;
- RTMDet player boxes;
- the review/report framework; and
- compute/license accounting.

It must independently test player identity and persistent side changes across
dead space. Serve-detection success does not imply side-change accuracy.
