# Height-Aware Ball Trajectory Design

## Goal

Replace the admin portal's table-plane projection of every BlurBall sample with a continuous, solid, match-calibrated best estimate of the ball's top-down path. The result must preserve measured bounce positions, correct airborne parallax, survive a missed serve bounce, and work across camera height, distance, and lateral placement without per-match hand tuning.

## Observed failure

The current `projectTrackToTable` applies the table homography to every ball observation. That homography is valid only at table height. A ball above the surface lies on the same image ray as a much farther point on the table plane, so an airborne serve is drawn beyond the end or side of the table. The worker already documents this limitation by excluding racket contacts from placement maps.

The two supplied examples are consecutive Young 2 cards:

- Card 24 (`323.40s–339.83s`) has no accepted serve. The first serve bounce is missing and the active BlurBall run also contains a large identity jump to another visible ball.
- Card 25 (`341.03s–346.61s`) has a serve contact at `342.63s`. Its useful bounce sequence begins at `(u=0.661, v=1.920)` and continues to `(u=1.246, v=0.914)`. Flattening the airborne contact produces approximately `(u=1.79, v=5.84)`; using the recovered camera and a plausible contact height moves the same observation to approximately `(u=0.50, v=3.24)`.

This establishes two independent requirements: correct height-induced parallax and reject implausible track identity jumps.

## Chosen approach

Use deterministic, height-aware ray reconstruction initialized from the existing table calibration. It is preferable to cosmetically compressing the raw map because it can correct the lateral source, and preferable to a learned monocular-depth system for the first version because it is explainable, fast, and testable against existing bounce coordinates.

For every upload:

1. Build the metric table-to-image homography from the four calibrated corners.
2. Recover the physically plausible camera-centre candidates using the existing Zhang single-plane focal constraints and pinhole decomposition.
3. Convert each observed pixel to its table-plane intersection.
4. Estimate the ball height at that time from ordered contacts, bounces, net crossings, and a soft ballistic prior.
5. Move the plane intersection toward the camera centre by `z / cameraHeight`, which gives the ray's horizontal position at height `z`.
6. Select the camera/height candidate with the lowest match-path cost: bounce preservation, horizontal smoothness, plausible speed, net traversal, and playing-corridor containment.
7. Reject isolated samples whose implied speed is impossible from both neighbours, then bridge the retained point sequence into one continuous best-estimate path.

The camera is assumed stationary within one upload. Camera height, distance, and side are estimated once from that upload's table quad. If a later recording moves the camera during play, table-corner drift detection belongs in a later iteration.

## Evidence and height anchors

The reconstruction consumes data already available on the admin page:

- full-rate measured BlurBall `(time, x, y, confidence)` observations from `tracks.json`;
- table corners and source dimensions from `match.json`;
- detected bounce pixels/table coordinates and net crossings from `serves.json`;
- serve contact time from `serve_s`;
- placement-v3 contact/bounce events and ready physical-side hypotheses from `match.json` when present;
- detector `seen` spans for continuity and loss awareness.

Anchor precedence is:

1. Ready placement-v3 shot events, because they already choose an internally consistent physical-side hypothesis.
2. The card's accepted serve pair plus other surface bounces.
3. Surface bounces alone when placement is unavailable.

Bounce anchors have `z=0`. Racket contacts use a soft `0.28m` height prior, bounded to a plausible range during candidate scoring. Between two bounces, height follows the positive constant-gravity arc with a capped peak. Between a contact and bounce, it blends the contact-height prior into the landing while preserving a positive arc.

When the first serve bounce is missing, a latent `z=0` anchor may be inserted between serve contact and the detected receiver-side landing. Its time and horizontal location are selected by path smoothness, net order, and reprojection evidence rather than by connecting the two visible bounce dots.

## Track identity protection

A crowded venue can cause BlurBall to switch to a neighbouring ball without recording a detector gap. Reconstruction must not draw that teleport.

After height correction, a sample is rejected when both adjacent legs require implausible horizontal speed and removing the sample restores a plausible local path. Confidence contributes to the decision but cannot rescue physically impossible motion. Short rejected intervals are interpolated in time so the requested display remains a continuous solid best estimate.

## Data contract and compatibility

`hydrateServeMissData` will attach an optional `trajectory` array to each card:

```ts
interface EstimatedTrajectoryPoint {
  t: number;
  u: number;
  v: number;
  z: number;
}
```

The calculation is server-side while hydrating the admin payload. It therefore applies immediately to prior uploads that already have `serves.json`, `tracks.json`, and a calibrated `match.json`; no database migration or destructive artifact rewrite is required. Future uploads use the same path automatically.

If camera recovery or evidence validation fails, `trajectory` is absent. The UI falls back to bounce markers without drawing the known-misleading raw plane path.

## Admin presentation

The right-hand visualization becomes a metric top-down court view:

- preserve the table's true `1.525:2.74` aspect ratio;
- show a narrow court margin around all four sides so a real racket contact behind an end line and a genuine long/wide exit remain visible;
- draw the entire estimated path as one faint solid yellow line;
- draw the recent `0.8s` portion brighter with the current ball marker;
- preserve detected bounce rings and their existing colors;
- label the path `Best estimate path` so it is not confused with a direct 3D measurement.

The requested first version does not encode uncertainty in line style. Every accepted path is continuous and solid.

## Validation

Automated tests must prove:

- all four table corners remain exact at `z=0`;
- raising a sample moves its top-down position toward the recovered camera rather than farther away;
- bounce coordinates are unchanged by reconstruction;
- a contact-to-two-bounce serve stays in the playing corridor and crosses the net in order;
- a missing-first-bounce fixture yields a continuous path with a latent own-side touch;
- an isolated neighbouring-ball jump is removed;
- invalid/degenerate calibration returns no trajectory rather than the old misleading raw path;
- hydration prefers measured full-rate rows and attaches placement evidence by card time.

Manual production validation covers Young 2 cards 24 and 25 plus representative Kyle 2 cards. The successful Young 2 serve must lose the large outer loop while retaining its two useful bounce positions. The missed-bounce example must start on the serving side, traverse the table through the net, and avoid the neighbouring-table jump.

## Release

Ship the application code through the existing `codex/admin-ball-trail` branch, merge it to `main`, and deploy the production site. Because reconstruction is computed during page hydration, Young 2 and Kyle 2 become reviewable immediately after deployment without an R2 backfill.
