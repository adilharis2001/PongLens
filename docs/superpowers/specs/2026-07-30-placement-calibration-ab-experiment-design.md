# Placement Calibration A/B Experiment Design

**Date:** 2026-07-30

**Status:** Approved for autonomous, read-only execution

## Objective

Measure whether the color-independent OpenAI table-corner calibration changes
PongLens placement reconstruction enough to improve point maps and aggregate
heat maps.

The experiment must answer four separate questions:

1. Does OpenAI produce a stable, locally valid table quadrilateral?
2. How far does that quadrilateral differ from the currently stored
   calibration?
3. When the same BlurBall detections and scored point boundaries are
   reconstructed with each calibration, how often do trusted landing
   coordinates, zones, coverage, or hypothesis validity change?
4. Are the changed points visually plausible enough to justify a larger
   manually reviewed holdout?

This is a comparison experiment, not an automatic declaration that either
calibration is ground truth.

## Authorization and Constraints

The user explicitly authorized autonomous execution without further questions
and asked for a morning-ready result.

- Production Postgres and R2 access is read-only.
- No match, point, job, cost, retry, score, calibration, or placement row is
  updated.
- No R2 object is uploaded, replaced, or deleted.
- OpenAI requests use `store: false`.
- Only three anonymous extracted JPEGs per new match are sent to OpenAI.
- Match IDs, player names, scores, filenames, account data, and source videos
  are not sent to OpenAI.
- Existing experiment results are reused rather than purchased again.
- Generated media and reports remain in a local disposable experiment folder.

## Approaches Considered

### A. Paired Chris reconstruction plus reused external context

Run three independent OpenAI proposals on each of the three Chris recordings,
select the closest valid pair, and reconstruct every scored point twice:
once with the stored calibration and once with the accepted OpenAI consensus.
Reuse the completed Vaibhav and Tripp calibration cases as external venue
context.

This is the selected approach. It directly tests the heat maps the user values
while retaining two genuinely different table/camera examples without
unnecessary new spend.

### B. One OpenAI request per Chris match

This is cheaper but cannot measure proposal repeatability. A plausible single
outline could silently be wrong, so it is insufficient for an accuracy
decision.

### C. A fresh ten-to-twenty-match holdout immediately

This gives stronger generalization evidence but requires more retained source
media, reference work, provider spend, and review time. It is the next stage
only if the paired Chris experiment shows meaningful, plausible changes.

## Sample

The new paired sample is:

- `8e17b962-e26e-454a-9fe2-8f7c0a3a61de` (Chris Match 1)
- `ebbb8f94-def1-493d-85df-f37c28afe0a7` (Chris Match 2)
- `d3c7827e-d576-427b-9b79-1e4ebeaf7ee6` (Chris Match 3)

The contextual sample reuses:

- `5721edd0-a80e-4eb8-a605-a6d3c8dbe41f` (Vaibhav)
- `cb0e7027-c41d-41d3-8984-7e15fddbeb88` (Tripp)

The accidentally duplicated control from the earlier experiment is excluded
from all distinct-match counts.

## New-Case Preparation

The existing read-only materializer downloads each retained source, point
clips, match JSON, and authoritative scored point fields. It runs BlurBall
locally and selects:

1. a median/background image;
2. a clear frame from the first half; and
3. a clear frame from the second half.

Preparation records hashes and fails closed when source media, point clips,
source dimensions, or pricing metadata are unavailable.

## OpenAI Calibration

Each Chris match receives exactly three independent Responses API requests
using the existing strict corner schema and `store: false`. The request uses
the three prepared images with original-detail coordinate fidelity.

Each proposal must pass:

- finite, in-frame, convex quadrilateral geometry;
- generic edge support;
- overlap with the ball-activity core;
- plausible projection of BlurBall detections; and
- stable forward/inverse homography behavior.

The closest two accepted proposals form a consensus only when median
corresponding-corner drift is at most 2% and maximum drift is at most 4% of
the prepared-frame diagonal. The coordinate-wise median of that pair must
pass local validation again.

## Paired Reconstruction

For every prepared Chris match, both arms consume identical:

- scored point boundaries and suggestions;
- BlurBall detections;
- source dimensions and frame rate; and
- placement-v3 reconstruction code.

The only independent variable is the calibration:

- **Current arm:** the usable calibration stored in the downloaded match JSON.
- **OpenAI arm:** the accepted color-independent consensus calibration.

If either arm has no usable calibration, the report records that condition
instead of inventing a comparison.

## Comparison Metrics

### Calibration geometry

- median and maximum corresponding-corner displacement;
- normalized frame-diagonal displacement;
- projected table-grid displacement in pixels; and
- local validation subscores for the OpenAI consensus.

### Placement coverage

- ready, review, and unavailable point counts per arm;
- trusted hypothesis counts per physical server side;
- trusted landing counts per arm; and
- points gained or lost by either arm.

### Matched landing behavior

Landings are matched only within the same match, point, physical-server
hypothesis, shot sequence, phase, and hitter side.

For matched trusted landings, report:

- table-plane displacement in centimeters;
- median, p90, and maximum displacement;
- lateral-third flips;
- depth-third flips;
- any nine-zone flip;
- movement into or out of a 5 cm zone-boundary band; and
- the exact points responsible for every zone flip.

The report must not compare unrelated shots merely because their ordinal
numbers match.

### Visual review

For every Chris match, render:

- a representative frame with the current and OpenAI table outlines;
- a full-table displacement grid;
- current-versus-OpenAI aggregate landing heat maps;
- a compact list of changed points; and
- paired point maps for every zone flip, with the point clip directly below.

The report labels connecting lines as shot order rather than reconstructed
ball paths.

## Interpretation Rules

- Stable agreement with local validation is evidence of calibration
  repeatability, not ground-truth accuracy.
- A zone flip is not automatically an improvement.
- When both outlines are visually plausible and a landing lies close to a
  third boundary, the result is classified as calibration-sensitive.
- Coverage gains matter only when the added trajectory remains physically
  valid.
- Missing paddle contacts, bounces, audio events, and net terminals remain
  event-detection problems even if calibration improves.
- Server identity and player-end errors remain separate unless independently
  resolved.

## Success Criteria

The experiment supports a larger holdout when:

1. at least two of the three Chris matches produce stable, locally valid
   OpenAI consensus calibrations;
2. paired reconstruction completes without changing point boundaries,
   scores, or source detections;
3. all reported landing matches satisfy the full identity key;
4. the report exposes every zone flip and its point video;
5. results and spend are complete and reproducible; and
6. the final recommendation distinguishes geometry, event detection, and
   server/orientation limitations.

It supports a production fallback plan only after a later frozen holdout with
independently reviewed reference corners demonstrates non-regression.

## Outputs

The local experiment root contains:

- `cases.json`
- append-only OpenAI trial results and usage sidecars
- `comparison-results.json`
- `report/report-data.json`
- `report/index.html`

The HTML report is served locally and left open for morning review.
