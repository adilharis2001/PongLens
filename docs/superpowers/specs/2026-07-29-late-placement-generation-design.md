# Late Placement Generation and 30-Day Raw Retention

## Summary

PongLens will let a match owner request placement maps after uploading a
match without selecting placement processing. A late opt-in behaves like the
upload-time flow: PongLens runs the normal deterministic method first, and
offers exactly one stronger vision-assisted retry only if the normal method
cannot produce reliable maps.

The primary placement action lives in the existing Tools menu. The
match-analysis and point-detail surfaces remain informational. Raw-upload
retention and placement eligibility both increase from seven to 30 days
after the original job was created.

## Goals

1. Make `not_requested` placement discoverable and actionable for 30 days.
2. Preserve a true two-stage product model:
   - normal deterministic generation; then
   - at most one stronger vision-assisted retry.
3. Keep placement work isolated from clips, point identity, timing, scoring,
   notes, tags, and all other match data.
4. Replace the misleading generic empty-map state with lifecycle-specific
   information.
5. Keep the visual language consistent with the current Tools rows, sheets,
   status cards, and emails.
6. Make every expected inability to generate maps visible and friendly.

## Non-Goals

- Rerunning the full points pipeline.
- Regenerating clips or changing point boundaries.
- Letting coaches or shared viewers request placement processing.
- More than one normal late-generation request or more than one stronger
  retry.
- Restoring raw recordings already deleted under the former seven-day
  policy.
- Retaining raw uploads beyond 30 days.

## Lifecycle

The existing match-level placement lifecycle remains:

```text
not_requested
processing
ready
retry_available
retrying
final_failed
```

The new late-opt-in path is:

```text
not_requested
  -> processing
  -> ready

or:

not_requested
  -> processing
  -> retry_available
  -> retrying
  -> ready | final_failed
```

Semantics:

- `not_requested`: placement was not selected during upload. While the raw
  source is retained, the owner may request normal generation once.
- `processing`: either upload-time normal placement generation or an
  owner-requested late normal generation is running.
- `ready`: at least one point contains a drawable placement event.
- `retry_available`: a normal generation attempt produced zero reliable
  drawable maps and the stronger retry is still available.
- `retrying`: the one stronger vision-assisted retry is running.
- `final_failed`: the stronger retry failed, the source expired, or a
  terminal processing failure left no valid next attempt.

`placement_retry_count` remains `0` through the normal generation attempt.
Only the stronger retry changes it from `0` to `1`.

`placement_retry_expires_at` becomes the authoritative raw-source and
placement-action deadline for both late normal generation and stronger
retry. The existing column name remains to avoid a disruptive production
rename, but code and documentation refer to it as the placement source
deadline.

Normal match completion writes the source job's creation time plus 30 days
to this deadline for both `not_requested` and `retry_available`. A match that
reaches `ready` clears the deadline because it needs no further placement
action.

## Database and Queue Design

Migration `055_late_placement_generation.sql` will:

1. Add `matches.placement_generation_job_id uuid`, referencing
   `public.jobs(id)` with `on delete set null`.
2. Replace the placement source deadline for eligible rows with the source
   job's `created_at + interval '30 days'`.
3. Backfill pre-rollout `not_requested` matches only when their source job is
   no more than seven days old. Those raw objects are guaranteed to fall
   within the former retention policy and include the latest Vaibhav upload.
   Older `not_requested` rows remain unavailable because their raw objects
   may already have been deleted.
4. Extend an existing `retry_available` row to 30 days only when its source
   job is still within the former seven-day window.
5. Create `public.request_placement_generation(p_match_id uuid)`.

The new RPC is `security definer`, owner-only, and atomic. It:

- requires `auth.uid()`;
- locks the match row;
- requires `matches.status = 'ready'`;
- requires `placement_status = 'not_requested'`;
- requires `placement_retry_count = 0`;
- requires `placement_generation_job_id is null`;
- requires a live `placement_retry_expires_at`;
- rejects a duplicate or concurrent generation request;
- inserts exactly one queued `placement_generate` job whose options contain
  the match ID;
- records the exact job ID in `placement_generation_job_id`; and
- changes placement status to `processing`.

If the source deadline has passed, the RPC returns an explicit expired
outcome without creating a job. Browser clients never create placement jobs
or update placement lifecycle columns directly.

The existing `request_placement_retry` RPC remains the only creator of
`placement_retry` jobs. Its deadline changes from seven to 30 days.

The web app exposes a separate authenticated
`POST /api/placement-generate` route accepting `{ matchId }`. It delegates
the complete authorization and queue mutation to
`request_placement_generation`; it does not perform a client-owned
read/check/write sequence. `POST /api/placement-retry` remains dedicated to
the stronger attempt.

## Worker Design

### Separate job meanings

- `placement_generate`: the first late normal attempt.
- `placement_retry`: the one stronger attempt after a normal failure.

Both jobs use the same placement-only reconstruction and consistency
machinery. They differ in authorization, calibration strategy, and terminal
failure transition.

### Calibration strategies

The placement calibration subprocess receives an explicit strategy:

- `deterministic`: run normal local table calibration only; never call
  OpenAI.
- `stronger`: run deterministic calibration first and invoke the existing
  vision proposal only if deterministic calibration fails.

Vision model output remains a temporary corner proposal. The worker still
snaps it to locally detected rim evidence and validates geometry, bounce
evidence, and the homography locally before accepting it.

### Normal late generation

The worker authorizes the job against:

- `placement_generation_job_id`;
- the match owner;
- `placement_status = 'processing'`;
- `placement_retry_count = 0`; and
- a ready match with retained raw and match JSON inputs.

It downloads the original recording, runs fresh BlurBall inference, performs
deterministic calibration, and reconstructs placement against authoritative
database point ranges.

Outcomes:

- one or more drawable points: commit placement-only changes and set
  `ready`;
- no reliable calibration or zero drawable points: leave every point
  unchanged and set `retry_available`;
- expired or missing source: set `final_failed` with a structured source
  failure;
- unexpected transient error: retry through the queue;
- poison limit reached while the source remains live: set
  `retry_available`, allowing the independent stronger method;
- poison limit reached after source expiry: set `final_failed`.

### Stronger retry

The existing stronger retry keeps its exact-job authorization and
`placement_retry_count = 1` requirement. It uses the `stronger` calibration
strategy.

Outcomes remain:

- one or more drawable points: `ready`;
- expected inability to create reliable maps: `final_failed`;
- poison limit: `final_failed` with `retry_processing_failed`.

### Data integrity

Both job types compute before mutation. A successful commit may update only:

- `points.placement`;
- the placement section of the stored `match.json`; and
- match placement lifecycle fields.

The worker verifies database placement, stored `match.json`, mapped-point
count, terminal lifecycle, and exact job ownership. Upload or verification
failure restores the original placement payloads, lifecycle fields, and
stored document. Existing point IDs, ranges, clips, scores, notes, tags,
match metadata, and non-placement JSON must remain byte-for-byte or
value-for-value unchanged.

## UI Design

### Shared client lifecycle

Placement lifecycle state, polling, API submission, and stable friendly
errors move into one client controller shared by the Tools row and the
bottom informational surface. This prevents the two surfaces from drifting.
It polls every ten seconds while status is `processing` or `retrying` and
refreshes server data on terminal transitions.

The pure placement view model exposes:

- Tools-row label;
- Tools-row trailing status;
- sheet title and body;
- informational notice title and body;
- tone;
- action kind (`generate`, `retry`, or none);
- whether polling is required; and
- whether the aggregate map should render.

### Tools menu

An owner-only `Placement maps` row uses the existing `TOOL_ROW_CLASS`,
typography, right-aligned compact status, and chevron.

Trailing states:

| Lifecycle | Tools status |
| --- | --- |
| `not_requested`, live source | `Generate` |
| `not_requested`, expired source | `Unavailable` |
| `processing` | `Generating…` |
| `retry_available` | `Try again` |
| `retrying` | `Retrying…` |
| `ready` | `Ready` |
| `final_failed` | `Unavailable` |

For `Generate`, `Try again`, progress, and unavailable states, tapping the
row opens a compact sheet built from the existing match-sheet conventions.
The sheet explains the current state and contains the only placement CTA.
Confirmation prevents accidental compute.

For `ready`, tapping the row scrolls directly to `#ball-map`.

The Tools row receives `id="placement-tools"` so failure emails can link
directly to it.

### Bottom match analysis

The bottom placement area contains no action:

- `ready`: render the placement aggregate.
- `processing` or `retrying`: render progress information.
- `retry_available`: explain that a stronger attempt is available in Tools.
- `final_failed`: render the permanent friendly explanation.
- live `not_requested`: render a short note that maps have not been
  generated and can be requested from Tools.
- expired `not_requested`: explain that maps were not requested before the
  original recording expired.

The lifecycle-specific notice suppresses the old generic “couldn't be
mapped” empty state. If drawable placement exists, the aggregate still wins.

Point details remain informational. A point without drawable placement
receives the same lifecycle body but never an action.

Coaches and shared viewers may see placement results and informational
status according to existing match-access rules, but never see the owner
Tools menu or a placement action.

## Email Design

Late normal generation sends one terminal email:

- success:
  - subject: `Your placement maps are ready`;
  - CTA: `Review placement maps`;
  - link: `/match/<id>#ball-map`.
- normal attempt produced no reliable maps:
  - subject: `Placement maps need another try`;
  - body explains that the normal attempt finished and one stronger attempt
    remains;
  - CTA: `Try the stronger method`;
  - link: `/match/<id>#placement-tools`.

The stronger retry keeps distinct success and friendly final-failure emails.
Terminal redelivery does not send duplicate email.

Missing email addresses continue to notify the administrator without
failing the job. Email failure remains non-fatal and logged.

## Retention and Public Policy

`R2_RAW_RETENTION_DAYS` changes from `7` to `30`. Raw uploads remain private
and are deleted by the daily worker sweep after 30 days. Existing raw objects
that have not yet been deleted inherit the new deadline; already deleted
objects cannot be recovered.

Every public and operator statement must use the same 30-day promise:

- Privacy Policy;
- Terms;
- homepage privacy FAQ;
- Learn/export guidance;
- raw-download API and UI copy;
- R2 source comments;
- worker README and retention table;
- Supabase setup documentation; and
- placement emails and status copy.

The deployment must update the public Privacy Policy and Terms no later than
the retention behavior change. Raw downloads naturally remain available for
the same 30-day period.

Cloudflare R2 Standard storage remains the storage class. At steady upload
volume, the raw-storage footprint is approximately `30 / 7` times the former
seven-day footprint. The existing daily R2 storage snapshots and cost
dashboard measure the increase. The new worker path records
`placement_generate_compute` separately from
`placement_retry_compute`.

## Error Model

Stable API/UI outcomes include:

- unauthenticated;
- not owner;
- match not found;
- generation already queued;
- generation unavailable;
- retry already queued;
- retry already used;
- source expired; and
- queue write failed.

Expected calibration failure and zero drawable maps are successful queue-job
outcomes, not poison failures. They advance the lifecycle and send the
appropriate user email.

Polling failure leaves the current state visible and retries on the next
interval. Submission failure keeps the confirmation sheet open and exposes
a concise error in an `aria-live` region.

## Security and Privacy

- Only the authenticated owner can enqueue either placement job.
- RPC row locks and status predicates prevent duplicate jobs.
- The worker rejects any job not recorded on the target match.
- API keys remain child-process environment variables and never enter
  command arguments, logs, job options, database rows, or model output.
- Model inputs are limited to representative frames from a user-requested
  stronger retry.
- OpenAI storage remains disabled for the vision request.
- No additional user content is persisted for calibration.

## Testing

### Database and API

- migration defines the generation job reference and 30-day deadline;
- only recent, reliably retained pre-rollout `not_requested` matches are
  backfilled;
- the owner RPC creates one exact `placement_generate` job atomically;
- duplicate, coach, expired, and non-ready requests create no job;
- the existing stronger retry remains independent and one-time; and
- transaction-rolled-back production smoke verifies both job transitions.

### Worker

- normal late generation never invokes the vision request;
- normal success changes only placement data and lifecycle fields;
- normal calibration exhaustion leaves points untouched and exposes retry;
- stronger retry still invokes vision only after deterministic failure;
- missing source, transient failure, poison handling, redelivery, email
  idempotency, stored-document compensation, and cost-stage metering are
  covered;
- all existing placement reconstruction and worker tests remain green.

### UI

- every lifecycle maps to the approved Tools-row status;
- live `not_requested` exposes `Generate`;
- expired `not_requested` exposes no action;
- normal failure exposes `Try again`;
- only the sheet contains actions;
- bottom and point surfaces remain informational;
- polling reaches `ready`, `retry_available`, or `final_failed`; and
- owner/non-owner action visibility is enforced.

### Full verification

- all Node test suites;
- complete Python worker suite;
- full ESLint;
- production Next.js build;
- SQL migration inspection;
- worker startup at the merged commit;
- Vercel production deployment readiness; and
- authenticated production verification on an owner-controlled match.

## Deployment Order

1. Apply migration `055_late_placement_generation.sql`.
2. Deploy and restart the worker with `placement_generate` support and
   30-day retention.
3. Deploy the web app, policy copy, Tools row, sheet, and API route.
4. Verify the latest Vaibhav match shows `Placement maps — Generate`.
5. Request normal generation and confirm:
   - exactly one generation job;
   - `not_requested -> processing`;
   - `processing -> ready | retry_available`;
   - correct email;
   - no non-placement data changes.
6. If it becomes `retry_available`, request the stronger method and confirm
   the existing one-time retry behavior.

The migration is additive and backward-compatible with the old app. The web
app deploys last so it cannot enqueue a job before the worker understands the
new kind.
