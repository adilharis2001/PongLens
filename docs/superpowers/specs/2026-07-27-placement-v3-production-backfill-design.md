# Placement v3 Production Backfill Design

## Objective

Deploy the placement v3 reconstruction engine already merged into PongLens and
regenerate placement maps for every existing production match whose original
video is available. Production currently contains 20 ready matches, 1,109
points, and retained source video plus `match.json` for all 20 matches.

The backfill must not create duplicate matches, re-segment points, replace point
clips, change scores, or leave permanent backup/job artifacts.

## Chosen Approach

Extract a reusable `backfill_placement_for_match` operation in the worker and
add an administrator-only command-line runner that invokes it sequentially.
The runner connects with the same macOS Keychain credentials as the production
worker but does not insert rows into `public.jobs` or send queue messages.

This is preferable to:

- Full pipeline reprocessing, which would create duplicate matches and could
  change point boundaries.
- One-off SQL or ad hoc JSON rewriting, which cannot rerun BlurBall inference
  or exercise the production reconstruction code.
- Twenty public queue jobs, which would create unnecessary permanent job rows
  for a one-time prelaunch migration.

## Components

### Match backfill operation

The worker-side operation accepts an existing match ID and:

1. Loads the match, its source job, and its ordered points.
2. Verifies the match is ready, has points, and still has an original video and
   `match.json`.
3. Downloads both inputs into a temporary working directory.
4. Runs BlurBall inference on the original video.
5. Uses Postgres as the authority for every point index and `t0`/`t1`
   boundary. This preserves the 14 point rows created by later split edits
   that are not present in the original stored JSON.
6. Reuses valid saved calibration. For the four matches whose saved
   calibration failed, it reruns table calibration from the retained video
   and fresh detections. If calibration still fails, it emits a valid v3
   `unavailable` payload for each affected point instead of inventing a map.
7. Reconstructs placement v3 using match side metadata and the production
   placement reconstruction code.
8. Validates that the result has exactly one placement payload for every
   existing point index and that every payload has `placement["v"] == 3`.
9. Rewrites only `public.points.placement` for that match and synchronizes the
   existing `match.json` point list to the authoritative Postgres rows while
   retaining existing JSON-only fields when their point index still exists.
10. Removes the temporary working directory regardless of success or failure.

The operation never changes point IDs, indices, times, clips, servers, scores,
edits, notes, suggestions, match metadata, or storage-ledger rows.

### Administrative runner

The runner supports a single match ID or all eligible production matches. For
the rollout it will:

1. Resolve the Vaibhab match from production metadata and require exactly one
   unambiguous result.
2. Snapshot non-placement invariants for that match.
3. Run the match backfill.
4. Re-read production and require all invariants to be unchanged while every
   placement has `placement["v"] == 3`.
5. Process the remaining 19 matches sequentially only after the canary passes.
6. Print a concise final count of succeeded, skipped, and failed matches.

The runner is idempotent: rerunning a completed match replaces version 3
placement with a newly validated version 3 result without duplicating rows or
objects.

## Consistency and Failure Handling

All placement payloads are computed and validated before production mutation.
Database placement updates for a match occur in one transaction. The existing
`match.json` object is overwritten only with a fully validated document; no
backup or temporary R2 objects are retained.

If source media, calibration, point boundaries, or reconstruction output is
invalid, that match fails before mutation. A failure on any non-canary match is
reported and does not roll back already completed matches or block other
independent matches. A canary failure stops the rollout immediately.

Because Postgres and R2 cannot share a transaction, the operation verifies both
stores after writing. If the final verification finds a mismatch, it reports a
hard failure and does not continue the rollout. The database remains the
authoritative source rendered by the app.

## Tests and Verification

Automated tests cover:

- Exact point-index mapping into existing rows, including split rows absent
  from the original `match.json`.
- Calibration reuse, recalibration fallback, and valid `unavailable` output
  when calibration cannot be recovered.
- Preservation of all non-placement point fields.
- Rejection of missing or duplicate point outputs.
- Rejection of payloads whose `v` field is not `3`.
- Transaction rollback when a database update fails.
- No production mutation when inference or validation fails.
- Idempotent reruns.
- Canary gating before the all-match phase.

Before production rollout, run Python placement tests, worker backfill tests,
Node placement tests, TypeScript checks, lint, and the production Next.js build.

After each production match, verify:

- Match and point row counts are unchanged.
- Point identity, timing, clips, server, scores, edits, suggestions, and match
  metadata are unchanged.
- Every point placement payload has `placement["v"] == 3`.
- The stored `match.json` and database placements agree by point index.

## Deployment

Push the merged PongLens `main` branch after all checks pass so Vercel deploys
the placement v3 UI. Restart the local production worker so future uploads use
the merged engine. Run the Vaibhab canary, inspect invariant verification, and
then run the remaining production matches. Finish by confirming that all 20
matches and all 1,109 points were processed or report exact failures.
