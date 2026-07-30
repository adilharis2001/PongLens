# OpenAI Table Calibration Experiment Design

**Date:** 2026-07-29

**Status:** Approved in conversation for a read-only experiment

## Objective

Determine whether PongLens can use its existing OpenAI multi-frame vision path
to recover table calibration when color-based calibration fails, without
requiring a colored or magenta table rim.

The experiment must answer two separate questions:

1. Can OpenAI locate the table consistently and accurately?
2. Does the accepted calibration unlock useful RTMPose first-server and
   persistent side-swap detection?

A plausible-looking table outline alone is not a successful result.

## Existing Behavior and Failure

PongLens already has a vision-assisted calibration path in
`worker/placement_retry_calibration.py`. It runs only during the one-time
placement retry flow. It sends a median/background image and up to two
representative frames to the OpenAI Responses API and requests structured
table-corner coordinates.

The returned coordinates are proposals. Current local validation then snaps
the proposed quadrilateral to a magenta table-rim mask and requires at least
three supported edges.

That final requirement recreates the weakness of the original deterministic
calibrator. The Tripp retry reached the OpenAI stage, but the proposal was
rejected as `vision_calibration_rejected`. Both the recent Vaibhav and Tripp
matches consequently reached RTMPose structure processing without a valid
calibration and produced no first-server or side-swap evidence.

## Approaches Considered

### 1. Improve the existing OpenAI path

Use the existing bounded multi-frame request, replace the mandatory magenta
rim check with generic local evidence, and evaluate it on two failures plus a
known-good control.

This is the chosen approach. It reuses working infrastructure and isolates the
specific validation defect with the least new code, cost, and credential
surface.

### 2. Compare several AI providers immediately

Send the same images to OpenAI, Gemini, and Claude and compare or combine
their corner proposals.

This may improve resilience later, but it adds provider integrations,
credentials, metering, and more possible causes of failure before the
existing OpenAI path has received a fair test.

### 3. Ask the user to confirm or tap table corners

Use AI as a proposal and fall back to a lightweight manual correction.

This is the strongest ultimate recovery mechanism, but it does not establish
whether automatic calibration can solve the common path without user work.

## Experiment Scope

The first evaluation uses:

- production match `5721edd0-a80e-4eb8-a605-a6d3c8dbe41f` (Vaibhav), whose
  automatic calibration and RTMPose structure processing failed;
- production match `cb0e7027-c41d-41d3-8984-7e15fddbeb88` (Tripp), whose
  OpenAI placement retry proposal was rejected; and
- one existing match with a visually correct, accepted calibration and useful
  RTMPose evidence as a regression control.

The experiment is read-only:

- no production database rows are updated;
- no R2 match artifacts are replaced;
- no placement retry is consumed;
- no score or game boundary is changed; and
- no production feature flag is enabled.

All generated diagnostics stay in a local, disposable experiment directory.

## Inputs

For each match, the experiment retrieves the retained source recording and
existing non-sensitive processing metadata using the worker's normal
authenticated paths.

It generates a bounded image set:

1. one median/background image from evenly distributed samples;
2. one low-occlusion frame with strong generic table-edge evidence; and
3. one additional frame selected from a different part of the match.

All frames use the same decoded dimensions and orientation. The source video
is not uploaded to the AI provider.

If the retained source is unavailable, the experiment records
`source_unavailable` for that match rather than changing the sample silently.

## OpenAI Proposal

The existing OpenAI Responses API integration remains the only provider in
this experiment. The API key is supplied through the current worker secret
path and is never included in subprocess arguments or diagnostics.
Requests use `store: false`. Only the three extracted still images are sent;
the source video, match identity, player names, scores, and account data are
not included.

One request contains the three representative images and asks for strict
structured output containing:

- source width and height;
- four named table corners in normalized and pixel coordinates;
- a confidence class; and
- a short machine-readable ambiguity reason when confidence is insufficient.

The prompt explains that:

- the visible playing surface, not a particular paint color, defines the
  table;
- corners may be partly occluded by players, the net, or motion;
- coordinates must refer to the shared camera frame; and
- the model must withhold rather than invent a corner when the table cannot
  be located.

The model output remains an untrusted proposal.

## Local Validation

The validator no longer requires magenta pixels or color-specific rim support.
It evaluates four independent evidence families.

### Geometry

- four finite, in-frame corners;
- consistent corner ordering;
- convex, non-self-intersecting quadrilateral;
- minimum edge lengths and sane image-area bounds;
- plausible opposite-edge and perspective ratios; and
- stable forward and inverse homographies.

### Generic visual support

- nearby intensity or color discontinuities along table boundaries;
- local line/edge support for a useful portion of the proposed perimeter; and
- tolerance for player, net, and motion occlusion.

Generic support contributes a score. It is not an absolute three-of-four-edge
requirement.

### Match evidence

- overlap with the existing ball-activity or bounce core;
- plausible near/far relationship to the two player regions; and
- a minimum number of ball detections that project into plausible table
  coordinates.

No single activity signal is sufficient by itself.

### Repeatability

The evaluation runs three independent proposal trials per match using the
same bounded image set. A candidate is stable when at least two trials agree
within:

- median corresponding-corner distance of 2% of the frame diagonal; and
- maximum corresponding-corner distance of 4% of the frame diagonal.

The accepted experimental quadrilateral is the coordinate-wise median of the
agreeing proposals and must pass the geometry, generic support, and match
evidence checks again.

Invalid JSON, provider errors, incompatible image dimensions, unstable
proposals, or inadequate local evidence fail closed.

## Reference and Measurements

Each match receives one visually reviewed reference quadrilateral on a clear
frame. Existing manual calibration may be reused only when its frame
dimensions and orientation exactly match the experiment input.

The reference is recorded before inspecting the new OpenAI proposals. This
keeps the accuracy check from being unconsciously fitted to the model output.

Calibration results report:

- normalized per-corner error against the reference;
- median and maximum inter-trial corner drift;
- geometry, edge, activity, and projection subscores;
- accepted or withheld outcome with reason;
- provider request latency and estimated cost; and
- local frame-selection and validation time.

Provider cost uses returned usage metadata and a recorded pricing snapshot,
not a hard-coded estimate alone.

Downstream evaluation then runs the current RTMPose structure pipeline against
the accepted experimental calibration without persisting its output. It
reports:

- first-server result, confidence, and coverage;
- persistent side-swap candidates and their point intervals;
- pose processing time and peak local resource measurements already exposed
  by the benchmark tooling; and
- agreement with known scoring and reviewed game boundaries where ground
  truth is available.

Calibration accuracy and downstream feature accuracy are shown separately.

## Review Artifact

The experiment produces a local HTML report with one section per match:

- the three input images;
- the reference quadrilateral;
- each raw OpenAI proposal;
- the accepted median quadrilateral, if any;
- validation subscores and rejection reasons;
- first-server and side-swap outputs; and
- latency and estimated API cost.

Overlays use distinct colors and a legend so reference, proposal, and accepted
corners cannot be confused.

The report also includes a compact cross-match summary. It must not describe
three matches as a statistically representative accuracy study.

Extracted frames and other temporary provider inputs are deleted with the
experiment work directory after the review artifact is accepted or discarded.

## Success Criteria

The experiment supports a production implementation plan only if:

1. both previously failed matches receive a stable, locally valid
   quadrilateral;
2. the known-good control remains valid and does not materially regress;
3. accepted corners have median reference error no greater than 2% and
   maximum reference error no greater than 4% of the frame diagonal, and the
   projected table coordinates pass the existing plausibility checks;
4. downstream RTMPose runs instead of failing at its calibration prerequisite;
5. first-server and side-swap results are reported against available truth;
   and
6. provider and local compute costs are captured.

If table calibration succeeds but a downstream feature remains inaccurate,
the report attributes the failure to that downstream stage rather than to
calibration.

## Production Decision After the Experiment

No production merge is automatic.

If the focused test succeeds, the next design should move the generalized
vision-assisted calibration ahead of placement and RTMPose structure
processing so both features share one stored calibration. Production would
normally make one bounded request per match, not three; repeat trials are an
evaluation-only stability measurement.

If results are unstable, the next options are a second provider, a
provider-consensus path, or a one-time user corner-confirmation fallback.
