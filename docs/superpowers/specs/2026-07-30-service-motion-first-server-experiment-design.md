# Service-Motion First-Server Experiment Design

## Objective

Determine whether PongLens can reliably infer the first server by detecting
the beginning of a genuine service motion, identifying which physical player
initiated it, and confirming that the motion led to a legal table-tennis
serve.

This experiment is not primarily a bounce-timestamp experiment. Bounce,
audio, and ball-trajectory evidence exist to confirm or reject a proposed
service motion. Its required semantic output is:

> A genuine service motion began at time X, was initiated by the near or far
> player, and was followed by a serve; therefore that player served this
> point.

Point-level calls are then decoded across the beginning of a match to infer
the first server. The experiment remains read-only and cannot alter production
matches, points, scores, or first-server choices.

## Starting Evidence

The owner completed follow-up labels for 42 deliberately challenging points
across the Faye, Vaibhav, Patrick, Chris, and Gui matches. The cohort includes
23 occluded contacts, 10 known high-confidence wrong-server calls, and 10
controls, with one point belonging to two categories.

The labels establish:

- exact paddle contact on 19 points;
- a narrow plausible contact window on all 23 occluded contacts;
- exact first bounce on 39 points;
- exact second bounce on 39 points;
- exact receiver contact on 39 points; and
- one labeled net contact.

Observed timing is useful as a constraint, not a fixed template:

- visible contact to first bounce: median 0.084 seconds, 10th–90th percentile
  0.035–0.182 seconds;
- first to second bounce: median 0.401 seconds, 10th–90th percentile
  0.385–0.511 seconds; and
- second bounce to receiver contact: median 0.200 seconds, 10th–90th
  percentile 0.100–0.267 seconds.

The existing detector finds many bounce timestamps accurately but attributes
some correct bounce sequences to the wrong player. Across the full 100-point
research batch, its high-confidence physical-server call is correct on 26 of
36 calls, or 72.2% precision at 36% coverage. That is useful experimental
evidence but is not safe for automatic production use.

## Design Decision

Use a **bounce-confirmed, pose-backtracked service-motion detector**.

The worker first proposes a physically plausible serve chain. It then examines
a short interval before the first bounce to determine whether one player
performed a coherent service motion. The detector may use future bounce
evidence to validate earlier motion because this is offline match processing,
not a live prediction requirement.

The current RTMPose logic scans as much as 4.5 seconds beginning at the first
ball detection. That window allows ball retrieval, handoffs, walking, and
casual tosses to accumulate evidence before the real serve. The experiment
replaces that unanchored accumulation with a bounded interval tied to a
candidate serve chain.

## Alternatives Rejected for This Round

### Motion-first full-clip scanning

Scanning the entire pre-point interval is the closest literal implementation
of “find motion onset,” but it repeats the current confound: retrieval and
casual tosses can resemble a service toss. It also poses more frames and makes
errors harder to diagnose. It may become a later proposal generator after the
anchored experiment establishes useful pose features.

### Learned multimodal classifier

A trained sequence model could eventually fuse pose, ball, geometry, and
audio. Forty-two richly labeled cases are insufficient to justify training a
new model, and an opaque classifier would hide whether failures come from
serve-chain selection or player attribution. Deterministic features and
explicit ablations come first.

## Experimental Cohorts

The experiment uses three related cohorts:

1. **Anchor-rich cohort:** the 42 completed follow-up points. These evaluate
   contact-window recovery, bounce-chain timing, pose attribution, and service
   motion onset proposals.
2. **First-server cohort:** the original 100 cross-match assignments plus
   match score/rotation truth. These evaluate physical-server coverage,
   precision, and match-level first-server decoding.
3. **Onset-review subset:** 20 points selected only after detector thresholds
   are frozen: eight visible-contact cases, eight occluded-contact cases, and
   four prior wrong-server cases, balanced across matches where possible.
   The reviewer marks the earliest frame at which the genuine service motion
   becomes continuous, or marks onset not observable. This is the only cohort
   used to claim service-motion onset timing accuracy.

The 42-point cohort is intentionally biased toward difficult and previously
wrong examples. Results from it must be reported as challenge-set results, not
as expected production prevalence.

Except for the explicitly named first-bounce oracle that bounds Stage A,
no reviewer label, scored-server value, point winner, or first-server choice
may enter detector features or candidate ranking. The Stage A oracle supplies
only a timestamp boundary, never a player identity or score. All other labeled
fields are evaluation truth only.

## Experiment Stages

### Stage A: Oracle-anchored pose attribution

Use each human-labeled first bounce only to define the analysis interval. This
stage isolates whether pose and ball motion can identify the initiating player
when serve-chain selection is known to be correct.

For each point:

1. open a lookback interval from 1.0 seconds before the first bounce through
   0.1 seconds after it;
2. sample pose at 15 frames per second inside fixed near/far player regions
   derived from table calibration;
3. align BlurBall detections and audio-impact candidates to the sampled frames;
4. compute service-motion features for each player;
5. select near, far, or abstain; and
6. propose the earliest frame at which the selected player begins a sustained
   service-motion sequence.

This stage must not read the human contact timestamp or contact window while
scoring. Those labels are used only after inference to measure whether the
proposed motion plausibly leads to contact.

After thresholds are frozen, the 20-point onset-review subset receives the
proposed onset as a blinded jump target. The reviewer may accept that frame,
move to the actual onset frame, or mark onset not observable. The proposal is
not revealed as a model score and cannot be changed by later threshold tuning.

If oracle-anchored initiating-player precision is below 90%, the end-to-end
stage does not proceed. The report instead identifies which pose features
failed and retains the existing first-server question.

### Stage B: End-to-end serve-chain selection

Replace the human first-bounce anchor with automatically generated candidates.

Candidate chains begin with BlurBall/placement bounce proposals. A chain is
eligible when:

- the first and second bounce occur in chronological order;
- calibrated table coordinates place them on opposite table halves;
- their separation is between 0.30 and 0.62 seconds, a deliberately wider
  interval than the labeled 10th–90th percentile;
- the chain is not contradicted by a stronger intervening candidate; and
- available audio or trajectory evidence supports, but is not required to
  create, the chain.

Each eligible chain receives the same pose-backtracking analysis as Stage A.
The final score combines service-motion coherence, ball-to-hand relationship,
legal bounce geometry, trajectory continuity, and audio proximity. The
detector abstains when the two player scores are close or the best chain lacks
coherent service motion.

### Stage C: Match-level first-server decoding

Run the point-level detector over the first five eligible point clips rather
than trusting one point.

Decode near/far calls against the ITTF two-serve sequence:

`A, A, B, B, A`

The decoder evaluates:

- the normal no-missing-point alignment;
- alignments containing at most one skipped source point; and
- only high-confidence point calls, with abstentions contributing no vote.

The decoder returns near, far, or withheld. It may return a first server only
when:

- at least three point calls contribute;
- one legal rotation alignment is clearly better than the alternative; and
- calibrated confidence is at least 0.95.

The missing-point allowance exists for accidental removal or failed point
segmentation. It is not permission to force a result from contradictory
evidence.

## Service-Motion Features

All pose features are normalized by torso or shoulder scale so thresholds
transfer across cameras.

For each physical player, the experiment records:

- upward displacement and velocity of each wrist;
- racket-side wrist acceleration toward the inferred contact region;
- elbow-angle extension and rate of change;
- shoulder-relative wrist height;
- torso lean and recovery;
- distance between BlurBall and each wrist when the ball is visible;
- upward ball movement near the toss hand;
- ball departure from the player toward the first table bounce;
- duration and continuity of the motion; and
- whether the motion is followed by the selected legal bounce chain.

The service-motion onset is the earliest frame in a sustained sequence that
contains at least two independent motion signals and ultimately connects to
the selected bounce chain. A single raised wrist, one close ball frame, or an
isolated audio peak cannot establish onset.

RTMPose does not need to see the paddle or ball. BlurBall supplies ball
position; pose supplies player joints. Occluded paddle contact can therefore
still produce a valid player attribution when toss/arm motion and the later
bounce chain agree.

## Signal Responsibilities

- **RTMPose:** identifies the player and characterizes arm, wrist, elbow, and
  torso motion.
- **BlurBall:** supplies ball emergence, motion, and table-bounce candidates.
- **Table calibration:** maps bounce candidates to legal near/far table halves
  and defines stable player regions.
- **Audio:** supplies high-recall impact candidates near contact and bounces.
  It corroborates a chain but cannot select one by itself.
- **ITTF rotation decoder:** converts several point-level physical-server
  calls into one first-server decision and tolerates one missing point.

## Ablations

Every point receives the following blinded variants:

1. existing unanchored pose baseline;
2. bounce geometry only;
3. oracle bounce plus pose;
4. detected bounce plus pose;
5. detected bounce plus pose and audio; and
6. complete chain plus five-point first-server decoding.

The report must show whether pose improves initiating-player attribution,
whether audio improves precision or merely coverage, and how much accuracy is
lost when the oracle anchor is removed.

## Metrics and Decision Gates

Point-level metrics:

- initiating-player precision, recall, coverage, and abstention rate;
- onset temporal error and observable-onset coverage on the 20-point
  onset-review subset;
- contact or contact-window temporal error;
- first- and second-bounce temporal error;
- service-chain selection precision;
- per-match precision and worst-match precision; and
- confusion by visible contact, occluded contact, and prior wrong-server case.

Match-level metrics:

- first-server precision and coverage;
- number of points needed before a decision;
- behavior with one synthetically skipped early point; and
- leave-one-match-out results so thresholds are never fitted and scored on the
  same camera.

Production recommendation gates:

- **automatic first server:** at least 95% leave-one-match-out precision with
  useful coverage and no match below 90% precision;
- **prefilled suggestion requiring confirmation:** at least 90% precision;
- **below 90%:** research-only, retain the explicit question.

The 42-point set can justify another prototype but cannot alone authorize
production deployment. Any positive result must be confirmed on additional
held-out matches after thresholds are frozen.

## Compute Measurement

The experiment records:

- decoded frames;
- posed frames;
- pose inference seconds;
- total wall time;
- peak resident memory;
- CPU utilization when available;
- seconds of pose processing per source-video minute; and
- projected cost per match using the existing platform-cost methodology.

The target profile is at most a 1.1-second interval sampled at 15 FPS for each
candidate chain, with no more than the three strongest chains posed per point.
The first-server pass processes no more than the first five eligible points.
The report compares this with the existing unanchored 4.5-second pose pass.

## Commercial Provenance Gate

The experiment may use MMPose/RTMPose and `rtmlib`, both published under
Apache 2.0. OpenMMLab has also publicly stated that RTMPose is permitted for
commercial use.

The experiment must not use the earlier mixed Body7 checkpoint. It uses the
official RTMPose-M 256x192 checkpoint from the MMPose COCO model catalogue:

`https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/rtmpose-m_simcc-coco_pt-aic-coco_420e-256x192-d8dd5ca4_20230127.pth`

Before inference, the runner downloads or resolves the exact asset, records
its SHA-256 digest, records the model catalogue URL and upstream license URLs,
and refuses a digest change after the first accepted run. Production adoption
still requires a final checkpoint-provenance review; the experiment cannot
silently promote weights.

The first experiment run uses the official MMPose PyTorch inference path with
the fixed near/far player bounding boxes already produced by PongLens table
geometry. It does not silently substitute the existing Body7 ONNX asset. An
ONNX conversion may be measured only after the PyTorch result is reproduced,
using OpenMMLab's export path and a numerical parity check on the experiment
frames.

No YOLO or AGPL component may be installed, imported, invoked, or bundled.
Player regions continue to come from table geometry, not a person detector.

## Outputs

The experiment produces:

- a versioned JSON result containing per-feature evidence and all ablations;
- a compact analysis report with aggregate, per-match, and challenge-subset
  metrics;
- compute and model-provenance records;
- review clips or links that jump exactly to proposed service-motion onset,
  contact, first bounce, and second bounce; and
- a clear conclusion of automatic, prefill-only, or research-only.

Raw pose arrays and full video frames remain ephemeral. Production data is
read-only, and no experimental inference result changes application behavior.

## Explicit Non-Goals

- deploying automatic first-server behavior in this round;
- detecting spin;
- replacing placement reconstruction;
- training a new neural network;
- detecting game boundaries or side swaps;
- running pose inference in the browser; or
- changing the existing research labels.

## Success Definition

The experiment succeeds scientifically even if it rejects RTMPose. It must
answer, without conflating stages:

1. Can pose identify the initiating player when the correct serve window is
   known?
2. Can PongLens find that window automatically from ball, table, and audio
   evidence?
3. Can several point-level calls recover the first server despite abstention
   or one missing point?
4. What compute and commercial-provenance burden does the approach add?

Only a positive answer to all four supports a later production design.
