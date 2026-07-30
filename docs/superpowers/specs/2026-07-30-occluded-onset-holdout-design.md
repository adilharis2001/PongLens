# Occluded Service-Onset Holdout Experiment Design

## Objective

Improve the bounce-anchored RTMPose detector specifically where the paddle
contact is occluded, then measure the actual product outcome: whether the
first server can be recovered from the opening points of previously unseen
matches.

The experiment remains read-only. It cannot update scores, point records, or
`matches.first_server`.

## Evidence and Scope

The completed onset review supplies 17 exact human onset labels:

- 5/17 frozen proposals were accepted exactly;
- 10/17 were within 0.20 seconds;
- 13/17 were within 0.50 seconds;
- all four visible-contact proposals were exact; and
- the twelve occluded cases had 0.368-second mean absolute error.

Nine proposals were materially late and three were early. The detector
therefore recognizes the later racket/contact phase more reliably than the
earliest continuous preparation or toss phase.

These 17 labels are a development set. They may guide deterministic feature
thresholds, but they cannot provide the final accuracy claim.

## Detector Change

Keep the existing high-precision player-attribution score and legal
bounce-chain gate. Change onset estimation only:

1. locate the contact-approach frame using the existing racket, ball, and
   optional audio evidence;
2. inspect at most 1.20 seconds before the confirmed first bounce;
3. compute normalized wrist, elbow, shoulder, torso, and visible-ball motion;
4. walk backward from the contact-approach sequence through a continuous
   preparation sequence;
5. tolerate at most one sampled-frame gap;
6. require motion to remain attributable to the already-selected player; and
7. retain the prior onset when no earlier coherent preparation exists.

An isolated arm movement, walking motion, ball retrieval, or casual toss that
does not connect continuously to the confirmed service chain cannot move the
onset earlier.

The output records both `contact_approach_t` and the backtracked `onset_t` so
the two phases can be evaluated separately.

## Signals and Ablations

The experiment reports these onset variants:

1. frozen v1 proposal;
2. wrist and ball only;
3. wrist, elbow, shoulder, and torso;
4. pose plus visible ball toss; and
5. pose, ball, and audio-confirmed contact.

RTMPose remains the only pose package. BlurBall, table calibration, and the
existing audio peak extractor remain unchanged. No YOLO or AGPL component is
permitted.

## Held-Out Match Cohort

Select ten production matches that:

- are not any of the five prior research matches;
- have a user-authoritative first-server value;
- have a valid user-side mapping and table calibration;
- contain at least five retained point clips; and
- have immutable downloadable media.

Selection is deterministic: newest eligible matches first, with match ID as
the tie-breaker. Seal match IDs, opening point IDs, clip paths, and media
SHA-256 values before inference.

Run the detector on the first five retained points of every selected match.
The expected physical server for each point is derived after inference from
the user-authoritative first server and the ITTF `A,A,B,B,A` rotation. No
score, server truth, or winner enters detector input.

## Metrics and Decision

Development metrics:

- onset mean and median absolute error;
- percentage within 0.10, 0.20, and 0.50 seconds;
- signed error; and
- visible versus occluded results.

Held-out metrics:

- point-level physical-server precision and coverage;
- match-level first-server precision and coverage;
- points required for a decision;
- one-skipped-point robustness;
- per-match outcomes; and
- compute time, posed frames, and peak memory.

Production gates remain:

- at least 95% held-out match-level precision for automatic application;
- at least 90% for a confirmation-required prefill;
- otherwise research-only with the current explicit first-server question.

A result must contain at least five decided held-out matches to support either
user-facing recommendation. Fewer decisions are reported as insufficient
coverage regardless of observed precision.

## Outputs

- versioned detector output containing both onset phases and feature
  ablations;
- reproducible analysis of the 17 development labels;
- sealed ten-match held-out manifest;
- held-out first-server and compute report; and
- a recommendation of `automatic`, `prefill_only`, or `research_only`.

No new reviewer UI is needed unless the held-out run exposes a failure that
cannot be diagnosed from the stored point calls and existing video clips.

