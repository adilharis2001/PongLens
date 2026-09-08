# Beta Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Expand beta signup, schedule invitations, and integrate applicants with admin outreach.

**Architecture:** One private request per normalized email, with immutable invitation delivery state and Resend scheduling at 23 hours. Shared questionnaire catalog feeds the public form and admin views. Existing outreach identity/history is preserved when beta applicants register.

**Tech Stack:** Next.js, React, TypeScript, Supabase Postgres, Resend HTTP API, Node test runner, Playwright.

**Spec:** docs/superpowers/specs/2026-09-05-beta-intake-and-outreach-design.md

## Global Constraints

- Read CLAUDE.md. Plain, natural English. No heading subtitles, hype or em dashes in product copy.
- The user's latest instruction is to use words sparingly. Keep approved feature options; cut redundant explanatory text.
- Exact interest question: What features are you excited to try?
- Do not append a serves-only qualifier to the approved placement option.
- Use existing dark surfaces, type, borders, inputs, checkboxes and cyan primary/outlined secondary buttons. Left-aligned content, no nested bordered cards.
- Mobile action buttons are full-width, stacked and at least 44px high. Check 393×660 and 1440×900.
- One invitation per request, scheduled at first request plus 23 hours unless an admin brings the same message forward. Duplicate submissions cannot change consent or delay delivery.
- Feedback contact is optional and does not affect access. Unknown/declined applicants do not enter feedback queues automatically.
- No production changes or real email without a controlled authorized test. Do not push or deploy during implementation.
- Every task uses TDD, focused tests, self-review and an explicit file-scoped commit. Full production build is mandatory at integration.

### Task 1: Questionnaire and public form

**Files:** Create src/lib/iosBeta/questionnaire.ts and questionnaire.test.ts; modify src/lib/iosBeta/client.ts and client.test.ts, src/components/marketing/IosBetaSignup.tsx, src/app/privacy/page.tsx; add scripts/qa/ios-beta-form.mjs.

**Interfaces:** Export BetaRole = 'player' | 'coach' | 'both'; BetaAnswers = { formVersion: 2; role: BetaRole; interests: string[]; feedback: string[] }; parseBetaAnswers(value: unknown): BetaAnswers | null; optionsForRole(role): readonly {value:string; label:string}[]; PLAYER_INTERESTS, COACH_INTERESTS and FEEDBACK_OPTIONS. Feedback [] means unanswered; ['not_now'] means declined; otherwise allowed channels email/audio_call/video_call. parseBetaAnswers rejects hidden-role interests, unknowns, duplicates, empty interests, invalid role/version or exclusive-choice violations. Keep submitBetaSignup(email, company, request = fetch, answers?: BetaAnswers) backward-compatible for existing callers, sending answers nested in the JSON payload. Add invalid_answers result.

- [x] Write questionnaire behavior tests and extend client payload/result tests. Example:
  ```ts
  assert.equal(parseBetaAnswers({formVersion:2,role:'player',interests:['coach_profile'],feedback:[]}), null);
  assert.deepEqual(parseBetaAnswers({formVersion:2,role:'player',interests:['iphone_recording'],feedback:['email']}), {formVersion:2,role:'player',interests:['iphone_recording'],feedback:['email']});
  ```
- [x] Run `node --test --experimental-strip-types src/lib/iosBeta/questionnaire.test.ts src/lib/iosBeta/client.test.ts`, record expected missing-feature failure.
- [x] Implement catalog with exact approved labels from spec §2, pure parser and payload adapter. Build the form per spec §§2–3; retain both existing triggers and native dialog. Concise success: Request received. / We’ll email your TestFlight link within 24 hours. / email. One short repeat-safe line only if needed, no extra heading decoration. Email, role, interests and optional feedback only; no essay. Request beta access / Cancel. Preserve answers through errors and discard stale async results after closing. Validation must focus or scroll to the actual error. Form must not submit hidden role choices.
  ```ts
  const allowed = new Set(optionsForRole(role).map(option => option.value));
  const visibleInterests = interests.filter(value => allowed.has(value));
  ```
- [x] Write/run Playwright QA against actual rendered component with intercepted API responses (no real mail). Cover both triggers, required answers, Coach/Both, feedback exclusivity, network failure keeping values, retry/success and full-width mobile actions. Capture screenshots to a temporary output directory.
- [x] Update privacy beta paragraph for answers and voluntary feedback contact. Run focused tests, lint changed files, self-review and commit only Task 1 files. Report RED/GREEN evidence and any unexecuted browser checks.

### Task 2: Durable delayed invitations and admin delivery action

**Files:** New additive supabase/migrations/20260905220500_beta_intake_delivery.sql; modify src/lib/iosBeta/{claim,request,delivery}.ts and corresponding tests, src/lib/email/iosBetaEmails.ts and tests, catalog.ts and tests, resendWebhook.ts and tests, src/app/api/ios-beta/route.ts, reviews-sweep integration. Add focused provider/state/storage modules under src/lib/iosBeta/ and authenticated src/app/api/admin/ios-beta/[id]/send/route.ts. Do not change generic non-beta email behavior. Migration namespace must be checked for conflicts before writing.

**Interfaces:** Consume BetaAnswers parser from Task 1. Public request accepts {email, company, answers?}; missing answers is legacy client compatibility, malformed supplied answers rejected. Keep existing BetaClaim result compatibility. Export scheduleIosBetaRequest(id): Promise<boolean> (true only scheduled/sent/already completed or suppressed with generic privacy-safe handling), sendIosBetaInviteNow(id, actor), reconcileIosBetaRequest(id), sendPendingIosBetaEmails(). Admin send accepts only authenticated admin POST and request ID, uses server-held email/URL, returns safe status without provider secrets. New beta state fields are readable through later admin-only outreach RPC. Coordinate schema names with controller before completing.

- [x] Write failing tests for route rejection before claim, original deadlines, scheduling and early-send states, immutable retries, both admin recipient jobs, suppression, unknown provider acceptance and concurrency. Run focused tests to record RED.
  ```ts
  // Given first request at 2026-09-05T12:00:00Z, assert scheduled_at is
  // the literal 2026-09-06T11:00:00.000Z, even on a later repeat claim.
  // Race two early-send operations: one provider message ID, never a second POST.
  ```
- [x] Implement additive private schema and service-only claim/lease/finish functions. Store immutable payload and first provider-attempt time before network I/O. First answers only; public re-submission cannot overwrite consent. Per-admin notification rows preserve old Adil stamps and do not notify Anton about historical requests. Never infer historical answers/consent. Sent/suppressed historical invites remain terminal; legacy pending retain original age.
  ```sql
  -- Each provider operation is guarded by a row lock and bounded lease.
  -- A lease expiry releases the worker, not the uncertain provider result.
  -- Finish must match lease token; unique request/email-kind prevents duplicates.
  ```
- [x] Implement Resend scheduling adapter using shared renderEmail, sender/reply-to, suppression and metering. Verify current official API docs for scheduling/retrieve/update/events. Create with scheduled_at and stable Idempotency-Key; save ID; update same ID to near-immediate time for early-send. Exact same key/payload on retry within 24h; expired ambiguous attempt requires attention. Provider retrieval/events reconcile state without regression. Suppression after scheduling attempts cancellation. Definitive cancellation/failure recovery must never duplicate a still-sendable provider message.
- [x] Integrate signed webhook updates with transactional dedupe/error handling, keeping current bounce/complaint rules. Modify legacy sweep so scheduled rows are never sent immediately. Ensure provider event arriving before local ID stamp can be reconciled safely. Admin action must enforce requireAdmin-equivalent server checks and same-origin protection.
- [x] Test migration and security/locking behavior against isolated local Postgres if available; never mutate production to test. Run focused delivery/route tests and full email suite. Self-review and commit only Task 2 files. Report deployment prerequisites (provider key scopes/event configuration), no false live-delivery claims.

### Task 3: Outreach integration, identity and permissions

**Files:** Add supabase/migrations/20260905221000_beta_outreach.sql; modify src/app/admin/outreach/{OutreachSection,outreachView}.tsx/ts, tests and relevant admin count integration. Add focused BetaOutreach components/view helpers and an authenticated bounded reconciliation POST route as needed; use a private admin-only beta roster RPC. Extend touch channel constraints for audio_call/video_call and add beta-only touch subject with exactly-one-subject constraint. Do not delete manual contacts to merge history.

**Interfaces:** Consume Task 1 catalog, Task 2 beta request delivery fields and POST /api/admin/ios-beta/[id]/send. Unified identities are matched by normalized email for display/outreach only; not auth. Admin row exposes request ID, role/interests/feedback, invitation state/deadline plus existing history/status/follow-up. Add iPhone beta filter and integrate counts/queues without duplicates.

- [x] Write failing pure roster/queue tests with literal account/manual/beta fixtures. Declined/unanswered beta applicants must not enter research-contact queues merely by signing up; linked existing accounts must respect their beta preference. Historic applicants show Not provided.
  ```ts
  // One account and one beta request with the same normalized email
  // produce one visible person and retain both touch histories.
  // A declined beta applicant is visible under iPhone beta, never To contact.
  ```
- [x] Add private outreach state and beta touch subjects/RPCs, normalized identity resolution and shared chronology. Preserve author/time/body, established non-new state and earliest outstanding follow-up. New account joins carry previous beta contact state, not New. Ambiguous duplicate manual contacts stay visible for explicit resolution. Add feedback withdrawal and admin-verified correction support with audit note; beta access remains unchanged.
- [x] Add concise beta detail UI within existing outreach page: role, interests, preferred contact methods, request/deadline/status, Send invite now. Reuse current row expansion/notes/follow-up patterns; no disconnected CRM or verbose helper copy. Operational pending invite list is distinct from feedback-contact queue. Admin refresh reconciles visible pending requests through the existing server operation, with bounded work and truthful loading/errors. Add contact channels Audio call and Video call. Invitation sends do not log research contact.
- [x] Add tests for unauthorized RPC access, touch subject constraints, unified counts, future registration/history, withdrawal and early-send feedback. Run existing outreach/admin tests plus new tests. Self-review and commit only Task 3 files.

### Task 4: Integration and verification

**Files:** Extend scripts/qa/ios-beta-form.mjs for integration and admin fixtures; add docs/superpowers/plans/2026-09-05-beta-intake-verification.md with commands/results and release checklist. Amend implementation files only in response to reproducible failures.

- [x] Exercise all locally authorized spec §9 cases across actual implementation. Run `node --test --experimental-strip-types src/lib/iosBeta/*.test.ts src/app/api/ios-beta/route.test.ts src/app/admin/outreach/*.test.ts` and `npm run test:email`. Run local migration tests and verify private access denial.
- [x] Run real `npm run build` using this worktree's own .next; stop dev server in THIS worktree if needed without affecting other checkouts. Record exit code, no filtered typecheck claims.
- [x] Run actual browser QA desktop/mobile/narrow, capture form and admin detail screenshots, inspect screenshots and open useful preview in right-hand browser. Verify no unwanted email sends during UI QA.
- [x] Perform independent task/final review, fix reproducible issues and rerun affected tests. Do not mutate production or send external emails without explicit controlled-test authorization. Record which live checks remain (real provider scheduled send/early-send, 23h observation) rather than equating mocks with live success.
- [x] Commit verification notes. Hand off implementation with preview and remaining release prerequisites; no production deployment claimed.
