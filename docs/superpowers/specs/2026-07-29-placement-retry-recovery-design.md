# Placement Retry and Failure Recovery Design

**Date:** 2026-07-29

## Goal

> Superseded on 2026-07-29: raw-source and placement-action retention is
> 30 days under the late-placement-generation design.

Make placement-generation failures visible and recoverable without treating
the whole match as failed. When a user requested placement maps but PongLens
could not generate any reliable maps, PongLens must:

1. say so in the initial match-ready email;
2. show a clear match and point UI state;
3. offer exactly one owner-initiated retry while the raw recording remains
   available;
4. use a stronger, vision-assisted calibration fallback on that retry; and
5. send a success or friendly final-failure email when the retry finishes.

The retry must reuse the existing match and point boundaries. It must not
create a duplicate match or regenerate unrelated artifacts.

## Existing Failure

The upload form correctly persists `options.placement = true`, and the worker
passes `--placement` to `points_pipeline.py`. Placement reconstruction depends
on a valid table homography. When automatic table calibration returns `None`,
the points pipeline deliberately degrades:

- the match and point clips are still created;
- each point's `placement` remains `null`;
- the overall match is marked `ready`;
- the ordinary ready email is sent; and
- the per-point UI omits the placement section because it has no placement
  payload to render.

The detailed warning currently exists only in `match.json.notes`, so neither
the email nor the application has a reliable placement-level state to display.

## Scope

This feature covers:

- explicit placement lifecycle state on `public.matches`;
- an atomic, owner-checked, one-time retry enqueue function;
- a focused `placement_retry` worker job;
- deterministic calibration followed by an OpenAI vision-assisted fallback;
- placement-specific completion emails;
- match-level and point-level status messaging; and
- tests for state transitions, retry limits, worker safety, email copy, and UI
  behavior.

This feature does not:

- rerun dead-space cutting;
- change point segmentation or point identity;
- regenerate point clips or thumbnails;
- change scores, notes, tags, edits, suggestions, metadata, or reels;
- allow more than one user-requested retry;
- promise a map when calibration or trajectory evidence is unreliable; or
- create an administrator/manual-review queue.

## Placement Lifecycle

`public.matches` gains the following columns:

```text
placement_status
  not_requested
  processing
  ready
  retry_available
  retrying
  final_failed

placement_retry_count       smallint, constrained to 0 or 1
placement_mapped_points     integer, non-negative
placement_failure_code      nullable text
placement_retry_expires_at  nullable timestamptz
placement_retry_job_id      nullable uuid referencing public.jobs(id)
```

### State meanings

- `not_requested`: placement was not selected for the original upload.
- `processing`: the original points pipeline is currently attempting
  placement.
- `ready`: at least one point has a drawable landing or terminal trajectory.
  Individual points may still be `review` or `unavailable`.
- `retry_available`: placement was requested, but zero points were drawable;
  the raw source is still within the retry window and no user retry has been
  consumed.
- `retrying`: the one authorized retry job is queued or running.
- `final_failed`: the retry was exhausted, the raw source expired, or the
  retry ended without a validated drawable map.

`placement_failure_code` is machine-readable and is mapped to friendly copy by
the application and worker. Initial codes include:

- `calibration_failed`
- `no_mappable_points`
- `vision_calibration_rejected`
- `source_expired`
- `retry_processing_failed`

Internal error details stay in worker logs and `jobs.error`; they are not shown
directly to users.

### What counts as success

A point is drawable when the selected placement payload contains at least one
shot with a non-null landing or terminal event. A match becomes `ready` when
at least one point is drawable. `placement_mapped_points` stores the number of
drawable points using the same rule as the match aggregate UI.

### Initial processing transitions

When the worker creates a match:

- placement not requested -> `not_requested`;
- placement requested -> `processing`.

When the original points stage finishes:

- one or more drawable points -> `ready`;
- zero drawable points with retryable source -> `retry_available`;
- zero drawable points without retryable source -> `final_failed`.

The initial failure sets `placement_retry_expires_at` to the original job's
creation time plus seven days, matching the raw-upload retention window.

### Existing-row migration

Existing matches are migrated conservatively:

- a match with at least one drawable placement becomes `ready`;
- a match whose originating job did not request placement becomes
  `not_requested`;
- an existing requested match with no placement data becomes `final_failed`.

The migration does not unexpectedly expose retry controls for historical
matches whose source object may already be gone.

## Atomic One-Time Retry

The client cannot create a placement retry by inserting a job directly. It
calls a new security-definer database function:

```sql
request_placement_retry(p_match_id uuid) returns uuid
```

In one transaction the function:

1. requires an authenticated caller;
2. locks the match row;
3. verifies `matches.user_id = auth.uid()`;
4. requires `placement_status = 'retry_available'`;
5. requires `placement_retry_count = 0`;
6. if the retry window expired, updates the match to `final_failed` with
   `source_expired` and returns `null` without creating a job;
7. otherwise inserts one `public.jobs` row with:
   - `kind = 'placement_retry'`
   - `user_id = auth.uid()`
   - `options = {"match_id": "<uuid>"}`
8. updates the match to:
   - `placement_status = 'retrying'`
   - `placement_retry_count = 1`
   - `placement_retry_job_id = <new job id>`
   - `placement_failure_code = null`; and
9. returns the job ID.

The existing jobs trigger enqueues the new row in pgmq. Row locking and the
`placement_retry_count` constraint make double clicks and concurrent requests
safe.

The worker accepts a retry only when all of these match:

- retry job owner;
- match owner;
- `placement_status = 'retrying'`;
- `placement_retry_count = 1`; and
- `placement_retry_job_id = current job id`.

This prevents a direct client job insert or duplicate queue message from
bypassing the one-retry invariant.

## Retry API

The match UI calls `POST /api/placement-retry` with `{matchId}`. The route
validates the UUID, invokes `request_placement_retry`, and translates database
outcomes into stable responses:

- `202 queued`
- `409 already_retrying`
- `409 retry_already_used`
- `410 source_expired`
- `404 match_not_found`
- `403 not_owner`
- `500 queue_failed`

The route never accepts a user ID or retry count from the client.

The UI polls the owner-readable match row while it is `retrying`. A terminal
state triggers a refresh of the placement data so the map appears without the
user manually reloading the page.

## Worker Retry Flow

`worker.process_job()` gains a focused `placement_retry` branch. It does not
enter the normal upload, content-check, cut, or points-segmentation path.

### Inputs

The worker loads:

- the exact retry job and its owner;
- the existing match and originating job;
- the originating job's retained `input_path`;
- the existing R2 `match.json`; and
- all existing Postgres points, using their IDs, indices, `t0`, and `t1` as
  authoritative.

If the raw source is absent or expired, the job ends as `final_failed` with
`source_expired`.

### Detection

The retry downloads the retained raw video and runs fresh BlurBall inference.
BlurBall detections are temporary local inputs and are deleted with the retry
work directory.

### Calibration cascade

The retry uses two calibration stages in order.

#### Stage 1: deterministic calibration

Run the existing pink-frequency, bounce-seeded table calibrator. A valid
stored calibration may be reused only if it already passes the current local
geometry validation. A failed calibration or a calibration that reconstructs
zero drawable points advances to Stage 2.

#### Stage 2: vision-assisted calibration

The worker builds a bounded set of representative images:

- one median/background image from evenly sampled frames; and
- up to two low-occlusion frames selected for strong table-rim evidence.

The images are sent in one request to a configurable OpenAI vision-capable
model. The prompt requests strict JSON containing:

- source image width and height;
- `A_near_1`, `B_near_2`, `C_far_2`, and `D_far_1`;
- normalized and pixel coordinates; and
- model confidence.

The model output is a proposal, not an accepted calibration.

Local code then:

1. parses and bounds-checks the JSON;
2. normalizes corner ordering;
3. snaps proposed corners and edges to nearby table-rim evidence;
4. builds candidate homographies; and
5. scores candidates against deterministic evidence.

Every accepted candidate must pass:

- four finite in-frame corners;
- a convex, non-self-intersecting quadrilateral;
- minimum edge lengths and sane frame-area bounds;
- plausible opposite-edge and perspective ratios;
- local table-rim support around the proposed edges;
- overlap with the ball-activity/bounce region;
- stable forward and inverse homography transforms; and
- a minimum number of plausible on-table projected detections.

Invalid JSON, timeouts, low confidence, missing edge support, or failed
geometry validation are fail-closed. PongLens writes no fabricated placement
map.

### Reconstruction and writes

Once calibration succeeds, the worker reconstructs v3 placement payloads
against the existing Postgres point ranges. It must produce exactly one valid
v3 payload for every existing point index before mutation.

The existing placement backfill safety model is reused:

1. compute and validate every placement locally;
2. snapshot all non-placement match and point fields;
3. update only `public.points.placement` and placement lifecycle fields in a
   short transaction;
4. merge only placement and calibration data into the existing `match.json`;
5. upload it to the existing R2 key;
6. redownload and compare the full document;
7. verify Postgres placements equal R2 placements; and
8. restore the prior database placements and `match.json` if cross-store
   verification fails.

No new match, point, clip, backup object, temporary R2 object, or
storage-ledger entry is created.

### Retry completion

If one or more points are drawable:

- match -> `ready`
- `placement_mapped_points` -> drawable count
- `placement_failure_code` -> null
- retry job -> `done`
- queue message -> archived
- success email -> sent best-effort

If both calibration stages are exhausted or reconstruction yields zero
drawable points:

- match -> `final_failed`
- `placement_mapped_points` -> 0
- `placement_failure_code` -> the terminal reason
- retry job -> `done`
- queue message -> archived
- final-failure email -> sent best-effort

Expected inability to calibrate is a completed retry outcome, not a poison
queue failure.

Transient infrastructure errors continue using the worker's existing queue
redelivery policy. They do not increment `placement_retry_count` again. After
the final internal delivery attempt, the worker sets `final_failed` with
`retry_processing_failed` and sends the final-failure email once.

Redelivery after a terminal match state is an idempotent no-op that marks or
leaves the retry job done and archives the message.

## Email Experience

All email sending remains best-effort and cannot change match or job state.
Every CTA points directly to the affected match rather than the generic
dashboard.

### Normal initial success

Keep the current subject:

> Your match is ready to review

The existing ready copy remains unchanged.

### Initial partial success

Subject:

> Your match is ready — placement needs another try

The body says:

- the match and point clips are ready;
- reliable placement maps could not be generated this time;
- one stronger retry is available;
- the retry must be requested within seven days; and
- the user can open the match to request it.

### Retry success

Subject:

> Your placement maps are ready

The body says the retry succeeded and links directly to “Where the ball
landed” for that match.

### Retry final failure

Subject:

> We still couldn't generate reliable placement maps

The body says:

- PongLens tried both calibration methods;
- the recording could not be mapped reliably;
- the rest of the match remains available; and
- there is nothing wrong with the user's account or upload.

It does not expose model output, internal error strings, or suggest repeated
uploads as a guaranteed fix.

## Match UI

The match-level “Where the ball landed” area becomes the primary placement
status surface.

### `retry_available`

Show a visible callout:

> Your match is ready, but we couldn't map the table reliably enough to
> generate placement maps.

Show one primary button:

> Try placement again

Supporting text explains that the stronger retry may take several minutes and
is available once within the displayed expiry window.

### `retrying`

Replace the button with a disabled progress state:

> Generating placement maps…

The client polls placement status. Reopening the match on another tab or
device shows the same server-owned state.

### `ready`

Hide the callout and render the current aggregate and per-point placement
experience. Existing point-level `review` and `unavailable` notices continue
to describe confidence.

### `final_failed`

Show a permanent friendly state:

> We tried again, but couldn't generate reliable placement maps from this
> recording. Your points, score, clips, and notes are still available.

No retry button remains.

### Expired source

If the retry window expires before use, the UI compares
`placement_retry_expires_at` with the current time and presents the match as
final unavailable:

> Placement retry is no longer available because the original recording has
> passed its processing-retention window.

No retry button is shown.

The daily worker retention sweep normalizes expired `retry_available` rows to
`final_failed` with `source_expired`. The retry RPC performs the same
transition under its row lock when an expired request reaches it before the
daily sweep.

### Point detail

When placement was requested but no map exists, the point detail shows a
compact placement-status notice instead of silently omitting the section.
The retry action itself remains match-level so users do not mistake the retry
for a single-point operation.

## Privacy and Cost Boundaries

- Vision fallback runs only after an authenticated owner explicitly requests
  the one retry.
- At most three bounded-resolution images are sent in one model request.
- Frames and model output remain temporary worker files and are removed after
  processing.
- No new video or frame objects are uploaded to R2.
- The model name is configurable through worker configuration; the retry
  contract and validation do not depend on a specific model.
- Model or network failure is fail-closed and produces no placement writes.

## Observability

Calibration helpers return structured outcomes instead of an undifferentiated
`None`. Logs record stage and machine-readable reason, for example:

```text
placement calibration deterministic_failed reason=no_seed_components
placement calibration vision_rejected reason=insufficient_edge_support
placement retry final_failed match=<id> code=vision_calibration_rejected
```

Logs must not contain presigned URLs, raw model image payloads, user email
addresses beyond existing notification logging, or full model responses.

The stored match lifecycle and failure code let support answer whether:

- placement was requested;
- the original attempt failed;
- a retry remains available;
- a retry is running;
- the retry succeeded; or
- failure is final.

## Testing Strategy

### Database and queue contract

Tests cover:

- only the owner can request a retry;
- a retry is allowed only from `retry_available`;
- retry count cannot exceed one;
- concurrent requests produce one job;
- expired requests create no job;
- the function records the exact retry job ID;
- a directly inserted or mismatched retry job cannot run; and
- terminal states cannot be requeued.

### Worker

Unit and boundary tests cover:

- deterministic calibration is attempted first;
- vision fallback runs only for `placement_retry`;
- valid vision JSON is parsed and normalized;
- invalid, out-of-frame, low-confidence, or malformed model output is
  rejected;
- corner snapping cannot move a proposal outside its bounded search area;
- geometry, edge-support, bounce-overlap, and homography guards reject bad
  candidates;
- a validated candidate produces placements using existing point ranges;
- success updates only placement-related fields;
- zero drawable points becomes `final_failed`;
- Postgres/R2 mismatch restores prior placements and `match.json`;
- transient queue redelivery does not consume another user retry; and
- terminal redelivery is idempotent.

### Email

Pure email-rendering tests cover:

- normal initial ready;
- initial ready with retry available;
- retry success;
- retry final failure;
- escaped original filenames;
- direct match links; and
- absence of internal error details.

### UI and API

Tests cover:

- stable API error mapping;
- one enabled retry button in `retry_available`;
- disabled progress state in `retrying`;
- normal rendering in `ready`;
- no button and friendly copy in `final_failed`;
- expired-source messaging;
- compact point-detail status instead of silent omission; and
- polling refresh when retry reaches a terminal state.

### Regression verification

Run the existing worker placement/backfill tests, placement model tests, auth
tests, lint, and production build. Verify that ordinary uploads, YouTube
imports, point clips, maintenance backfills, and existing placement maps keep
their current behavior.

## Acceptance Criteria

The feature is complete when:

1. A new requested-placement calibration failure leaves the match ready while
   setting placement to `retry_available`.
2. The initial email and match UI clearly disclose the missing maps.
3. The owner can enqueue exactly one retry before raw-source expiry.
4. The retry never changes match segmentation or non-placement data.
5. The retry attempts deterministic calibration before vision assistance.
6. Vision output is locally snapped and validated before use.
7. Success renders maps and sends the success email.
8. A second inability to calibrate becomes `final_failed`, shows no retry
   control, and sends the friendly final email.
9. Duplicate clicks, direct job inserts, queue redelivery, and cross-store
   write failures cannot create extra attempts or corrupt the match.
10. Existing placement rendering and normal match processing regressions are
    covered by automated verification.
