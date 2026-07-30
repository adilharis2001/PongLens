# Cross-Venue Placement Calibration Labeling Design

## Purpose

Build an authenticated PongLens research experience that lets a human mark the
true table landing for clearly identified serve and rally events. Use those
blind labels to compare the deterministic table calibration with the
OpenAI-assisted calibration across multiple venues, camera angles, and player
positions.

This replaces visual judgment of two unlabeled maps with measurable ground
truth. It also corrects the deterministic calibration's horizontal mirror bug
at the source rather than compensating in the review renderer.

## Existing Foundations

PongLens already has an authenticated research system at
`/research/fused-labeling` for the sound-analysis pilot. It provides:

- authenticated reviewer assignments;
- row-level security;
- protected point video delivery;
- autosaving and resumable queues;
- an interactive top-down table placement editor;
- JSON export;
- immutable source proposals separated from human answers.

The placement experiment will add a separate
`/research/placement-calibration` page and batch while reusing those
foundations. It must not add placement questions to the sound-labeling page.

Production discovery on 2026-07-30 found 28 ready matches with retained source
video and match JSON. Twenty-six already have placement payloads. Available
named samples include Tripp, Faye, multiple Vaibhav matches at PingPod and
Westchester TTC, and the side-on Gui match. No separate production opponent
named `Gi` was present, so the experiment must not invent one.

## Scope

The first batch will contain 42 primary landing events from 42 distinct points
across six visually distinct matches, plus six blind repeat assignments for
intra-reviewer consistency.
The target matches are:

1. Tripp at Westchester TTC;
2. Faye at Westchester TTC;
3. Vaibhav at PingPod;
4. Vaibhav at Westchester TTC;
5. Gui at PingPod with the side-on camera;
6. one additional PingPod match selected for a camera profile distinct from
   the Vaibhav and Gui samples.

The materializer may replace a listed match only when its retained video,
point clips, scoring context, or reconstruction inputs are unavailable. A
replacement must preserve venue and camera-profile diversity and be disclosed
in the frozen batch manifest.

The primary phase quota across the 42 events is:

- at least 12 serve second bounces;
- at least 12 returns;
- the remaining events from later rally shots;
- at least 15 events with the user physically near;
- at least 15 events with the user physically far.

Within each match, selection should include calibration disagreements, close
agreement controls, and one-arm abstentions when available. Selection must
happen before human labels exist. Select at most one target event from a point,
so each assignment has one unambiguous question.

## Event Semantics

Every review item names one observable event. It never asks a reviewer to
validate a hypothetical server.

- **Serve:** the serve's second table bounce on the receiver's half.
- **Return:** the first table bounce after the receiver contacts the serve.
- **Later rally shot:** the first table bounce after that shot's contact.

Only the physical-server reconstruction matching PongLens's scored server is
eligible. Server overrides take precedence over rotation. Events with an
unresolved or contradictory server are excluded from primary calibration
scoring and reported as server-context exclusions.

The stored event identity contains:

- anonymous batch event ID;
- anonymous source ID;
- point index within the research batch;
- shot sequence;
- phase;
- scored server;
- hitter's physical side;
- receiver's physical side;
- target event time;
- target event description.

The authenticated client must not receive the production match ID, production
point ID, raw R2 path, or hidden scoring targets.

## Reviewer Experience

### Queue

The page shows one assigned point at a time with:

- progress and autosave state;
- match label and venue;
- actual near and far player names for that point;
- scored server;
- previous and next controls.

Player positions must be resolved per point, including detected or scored
end-swaps between games. The top-down table is always a physical view:
far player at the top and near player at the bottom. It is not silently
normalized to keep the user at the bottom.

### Event Review

For each selected event, the page shows:

- the point rally video;
- a loop centered on the target event;
- play, slow-motion, frame-step, and replay controls;
- plain-language copy such as `Chris's serve — mark the second bounce on your
  side` or `Your return — mark the first table bounce on Chris's side`;
- a top-down table labeled with the actual near and far players.

The reviewer chooses exactly one result:

1. `Landed on table`, followed by a table click;
2. `Not visible`;
3. `Wrong event selected`;
4. `No table bounce`.

A landed label also records:

- canonical physical `u` and `v`;
- `clear` or `estimated` visibility;
- `certain`, `likely`, or `unsure` confidence.

The table click target must be large enough for touch input and support moving
the marker by clicking again. It must show a concise confirmation such as
`Marked on Chris's side, deep right` without using that zone label as the
stored ground truth.

### Blind Reveal

Current and OpenAI markers remain hidden until the reviewer saves the human
answer and chooses `Reveal comparison`.

After reveal, the page overlays:

- human label in white;
- canonical deterministic calibration in cyan;
- OpenAI-assisted calibration in orange;
- legacy deterministic calibration as an optional dashed diagnostic;
- centimeter error for each available prediction;
- nine-zone agreement or disagreement.

The first saved answer is the blind primary label. Editing after reveal is
allowed, but the assignment is marked `post_reveal_edited` and excluded from
primary blind metrics. The UI must explain this before enabling the edit.

### Unavailable Predictions

An arm that abstains is displayed as `No prediction`, never as a dot at a
default location. Human labeling remains possible so coverage can be measured
separately from accuracy.

## Canonical Table Coordinates

Human labels and all calibration arms use one physical table coordinate:

- `u = 0` is the camera-left endpoint of the camera-facing near end;
- `u = 1.525` is the camera-right endpoint of that near end;
- `v = 0` is the camera-facing near end;
- `v = 2.74` is the far end.

The names are therefore unambiguous:

- `A_near_left`;
- `B_near_right`;
- `C_far_right`;
- `D_far_left`.

Legacy names may remain in stored production JSON for compatibility, but every
calibration must pass through a canonicalization boundary before homography
construction. The canonicalizer accepts a convex quadrilateral plus its
identified near end and returns the fixed winding above.

If near/far or left/right cannot be determined reliably, calibration must
abstain with an orientation-specific reason. It must never choose a winding
from the arbitrary direction returned by `cv2.convexHull`.

## Deterministic Mirror Root Cause and Correction

The deterministic pink-rim calibrator currently receives a cyclic hull from
OpenCV and rotates that sequence to choose a near end. It does not normalize
clockwise versus counter-clockwise winding. Consequently, the same visible
quadrilateral can be stored as:

`A, B, C, D`

or:

`A, D, C, B`.

Both are convex and produce finite homographies, so the existing geometry
checks accept both. Their horizontal coordinates are mirrors. In the Chris
calibration sample, the stored deterministic corners and accepted OpenAI
corners demonstrate this reversed winding.

The correction must:

1. define the camera-left and camera-right endpoints of the near end;
2. pair each with the corresponding far endpoint;
3. update the OpenAI request to use the explicit canonical corner names;
4. canonicalize deterministic and OpenAI quads before constructing either
   homography;
5. recompute the length axis from the canonical quad;
6. preserve explicit provenance indicating whether a legacy quad was
   reordered;
7. reject ambiguous orientation rather than guessing.

The report renderer must not contain an independent horizontal flip. Rendering
uses canonical physical `u` directly. Receiver-relative or handedness-relative
labels are derived later and never mutate the physical coordinate.

For the experiment, freeze three arms before labels:

- `legacy_current`: existing corner order, diagnostic only;
- `canonical_current`: deterministic calibration after canonicalization;
- `openai`: OpenAI-assisted calibration after the same canonicalization.

The primary comparison is `canonical_current` versus `openai`. The legacy arm
quantifies how much of the previous error came from mirrored orientation.

## Data and Storage

Use a new research batch slug:

`placement-calibration-cross-venue-v1`

Reuse `research_batches`, `research_sources`, `research_assignments`, and the
existing reviewer model. Store placement-specific proposal and human-label
JSON under a schema version dedicated to this page.

Protected clips use:

`research/placement-calibration/v1/sources/<anonymous-source-id>.mp4`

Update the explicit storage-key constraint and media-route validator to allow
this namespace without weakening them to arbitrary `research/` paths.

One research source represents one target event and its point clip. Because the
batch selects at most one event per point, the video is copied once. Blind
repeat assignments reference the same immutable source with a separate
assignment identity and do not copy media.

The batch builder:

1. reads production records without mutating matches or points;
2. downloads retained source inputs into a temporary local workspace;
3. runs BlurBall and all three frozen calibration arms;
4. filters to the scored-server reconstruction;
5. selects the frozen stratified sample;
6. copies only selected point clips into the research namespace;
7. records hashes for the media, manifest, calibration inputs, and predictions;
8. upserts idempotently under stable anonymous IDs;
9. assigns the batch to the existing admin reviewer;
10. deletes temporary local material after verification.

The builder must fail closed if the same event has inconsistent video hashes,
prediction hashes, server context, or event semantics across reruns.

## Scoring

Primary scoring includes first blind labels where:

- result is `Landed on table`;
- visibility is `clear` or `estimated`;
- confidence is `certain` or `likely`;
- the event was not edited after reveal.

Report separately:

- median and 90th-percentile physical error in centimeters;
- nine-zone accuracy;
- left/right third accuracy;
- short/medium/deep accuracy;
- horizontal mirror rate;
- arm coverage and abstention rate;
- win, loss, and tie counts between canonical current and OpenAI;
- metrics by venue, camera profile, event phase, and user physical side;
- legacy-to-canonical improvement;
- wrong-event and no-bounce rates as detector errors;
- not-visible rate as observability;
- repeat-label median distance and zone agreement.

`Wrong event selected` and `No table bounce` never count as calibration
distance errors. They measure event-selection quality. `Not visible` measures
reviewability. An abstaining arm affects coverage, not its accuracy
denominator.

The report must include raw counts beside percentages and state that this
small, deliberately stratified batch is an engineering holdout, not a
population estimate.

## Security and Privacy

- The page requires an active research reviewer and an assignment.
- Existing RLS ownership rules remain in force.
- Immutable sources and predictions remain read-only to authenticated
  reviewers.
- The protected media endpoint verifies assignment access before serving a
  clip.
- Service-role credentials never reach the client.
- Production source identifiers and storage paths never appear in page data or
  exports available to ordinary reviewers.
- The batch builder performs no writes to `matches`, `points`, or production
  match JSON.

## Testing

### Coordinate and Calibration Tests

- Reproduce the known deterministic `B/D` winding reversal and prove
  canonicalization yields identical projected `u/v` for both windings.
- Prove canonicalization is idempotent.
- Prove ambiguous near/far or left/right inputs abstain.
- Prove OpenAI and deterministic quads pass through the same canonicalizer.
- Prove renderer coordinates contain no extra horizontal inversion.
- Preserve existing far/near and receiver-relative regression tests.

### Selection and Materialization Tests

- Frozen match and phase quotas are enforced.
- Only scored-server events are selectable.
- Human labels cannot influence sample selection.
- Repeats reuse media but have independent assignments.
- Reruns are idempotent and reject changed hashes.
- No production identity or secret is written to public research payloads.

### UI Tests

- Predictions are absent before reveal.
- A valid table click can be moved and autosaved.
- All four result choices round-trip.
- Near/far player labels change with point context.
- Abstentions render without phantom dots.
- Editing after reveal records contamination and excludes the blind label.
- Mobile input has no horizontal overflow and meets touch-target sizes.

### Database and Media Tests

- Placement media keys are allowed and arbitrary research keys remain rejected.
- Assigned reviewers can read their sources and update only assignment labels.
- Unassigned users cannot read sources or media.
- The batch does not change match or point rows.

## Rollout

1. Add and verify canonical orientation handling locally.
2. Add the placement research route and schema-specific label model.
3. Deploy the app and migration.
4. Materialize the frozen cross-venue batch read-only from production.
5. Verify media, prediction hashes, event semantics, and assignments.
6. Complete human labeling while predictions remain blind.
7. Export and score the frozen batch.
8. Decide whether canonical deterministic, OpenAI-assisted, or an abstaining
   cascade should become the production calibration strategy.

No production placement maps are regenerated as part of this experiment.
Regeneration requires a separate reviewed rollout after the holdout results.
