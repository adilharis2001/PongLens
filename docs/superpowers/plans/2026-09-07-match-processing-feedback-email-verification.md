# Match processing feedback: event notifications and email receipts

Date: 2026-09-07. Worktree: `match-processing-feedback`.

The sender selects the email from the immutable event, never a later issue
status. Publication, failure, restoration and closure describe the saved
event without claiming that a delayed message describes the currently active
version. Candidate readiness creates an administrator notification, not an
owner resolution email. Failure alerts the administrator and queues the
owner's failure email in the saved transaction.

The outbox freezes provider request bytes before sending, with a short claim,
first-attempt timestamp and stored idempotency key. A provider receipt is
preserved even if metering fails. Failed receipt bookkeeping never downgrades
confirmed acceptance. Signed delivery tags allow the existing webhook to
recover a receipt before that bookkeeping write. Provider-confirmed messages
are never eligible for sending again. Unknown attempts stop within the
provider key lifetime or retry budget and require review. The migration also
quarantines legacy ambiguous sends and suppresses unsent intermediate emails.

## Verification

- RED: delayed failure email incorrectly announced a published cut;
  intermediate events sent owner email; candidate completion lacked an admin
  alert; receipt-returning sender/SQL claim did not exist; bookkeeping failure
  caused a second failed write. The new tests failed before implementation.
- A later RED check caught missing-context errors occupying the queue without
  consuming their retry budget; another caught a malformed refund event
  interrupting the remaining batch. Both now pass.
- `MATCH_ISSUES_LOCAL_DB_TEST=1 node --test --test-concurrency=1 --experimental-strip-types src/lib/email/*.test.ts src/lib/matchIssues/delivery.test.ts src/lib/matchIssues/email.test.ts src/lib/matchIssues/emailDatabase.test.ts`: **66 passed, 0 failed, 0 skipped**.
- `node --experimental-strip-types 'src/app/api/match-issues/[matchId]/route.test.ts'`: **7 passed, 0 failed, 0 skipped**. The bracketed route was run directly because Node's test-glob handling did not include it in the combined command.
- Database tests use the isolated `supabase_db_match-processing-feedback`
  database and rollback their fixtures. Seven tests cover event recipients,
  claim exclusion, early webhook recovery, late-result precedence, frozen
  retries, provider-confirmed failure, permanent-bounce suppression,
  permissions, retry exhaustion, and full additive-migration replay.
- Focused ESLint and `git diff --check`: exit 0. The existing Node
  `MODULE_TYPELESS_PACKAGE_JSON` warning remains visible.
- Real `npm run build`: exit 1 at the existing
  `CardTimeline.tsx:7` missing `inferredBounceMarkerTitle` export from
  `serveMiss`. No filtered build or typecheck success is claimed.
- Full `npx tsc --noEmit --incremental false`: exit 2. It found an
  optional `RequestInit` test mismatch in the touched sender test, which was
  corrected. The final unfiltered run still reports the existing serve-miss,
  research, marketing/test-fixture and placement regex-target diagnostics.

No external provider calls or messages, production writes, real staging
delivery, native playback/UI captures, or worker inference/encoding were run.
Deploy the additive migration before the sender/webhook code that consumes
its new service-only RPCs. Native administrator-notification routing was
reported to the coordinator and is outside this email-only correction.
