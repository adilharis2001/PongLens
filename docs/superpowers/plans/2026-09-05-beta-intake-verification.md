# Beta intake verification

Local implementation and independent review are complete. This is not a production release record.

## Completed checks

- Public questionnaire: 10 focused tests passed; changed-file lint passed.
- Real landing page with intercepted submission responses: both entry points, required fields, role changes, optional feedback, retry preservation, pending-input protection, stale response handling and focus return passed.
- Confirmation focus: browser assertion failed before the accessibility fix and passed afterward.
- Layout: actual viewport captures inspected at 393×660 and 1440×900; browser overflow checks also passed at 320×660. Actions fill the mobile content width and are at least 44px high.

These browser checks used synthetic addresses and intercepted the submission API. They did not send email.

- Delivery checkpoint at commit `3843a9af`: 51 beta/route/database tests and 39 email tests passed. Real isolated PostgreSQL tests exercised migration replay, private access, concurrent leases and immutable retries.
- Controller stopped the worktree's dev server and ran the real `npm run build`, with the existing local environment loaded. Exit 0; 149 pages generated. Existing lint and workspace-root warnings remain. This is the Task2 checkpoint, not the final post-Outreach build.
- Separate unfiltered `npx tsc --noEmit` exited nonzero on six diagnostics in four unchanged pre-existing test files. This is not reported as a passing typecheck; the production build result above is a separate check.
- Delivery review fixes at `1a14f681`: 55 beta/route/database tests and 40 email tests passed. Independent scoped re-review confirmed both fixes, with no new Important findings.
- Controller reran `QA_BASE_URL=http://127.0.0.1:3024 node scripts/qa/ios-beta-form.mjs` after delivery integration: exit 0, both triggers and all desktop/mobile interactions passed.
- Outreach checkpoint `c65fa955`: controller combined beta/outreach/admin/database run passed 109 tests with no skips. Agent browser checks passed at 1440×900, 393×660 and 320×660; controller inspected actual viewport images and verified the mobile filter and sending-state refinements.
- Controller ran all 20 package `test:*` commands: 19 exited 0. `test:costs` failed one pre-existing source-text assertion expecting metering inside `reviewEmails.ts`, where delivery now delegates to the shared sender. Those source/test files are unchanged from the branch baseline; shared sender behavior tests pass. This remains an integration issue to resolve, not a passing full-suite claim.
- Full build at `c65fa955` failed because the retained QA fixture omitted the required `AppShell.avatarUrl` value. Corrected at `c2b52a1b`; a fresh actual production build exited 0, generating 150 pages.
- Outreach review fixes at `c2b52a1b`: 111 focused tests passed without skips, including local database tests. Browser checks passed at 1440×900, 393×660 and 320×660. Independent scoped review confirmed all three findings addressed: fixture build, consistent Needs attention filtering, and preservation of differing source contact status/reminders during account removal.
- Post-main integration at `48e99aaf`: controller ran the real isolated production build again. Exit 0, 151 pages generated. This includes the concurrent research changes merged into the feature branch; no shared branch was updated.
- Final integration fixes at `5edc9f86`: 117 focused tests passed with actual local PostgreSQL tests enabled and no skips; 40 email and 146 cost tests passed. The full production build exited 0 with 151 pages. Browser checks passed at 1440×900, 393×660 and 320×660, including early-send busy feedback, fair refresh across eleven pending applicants and priority for an opened request. The controller inspected the final mobile retry screen.
- Controller ran all 20 package `test:*` scripts again at `5edc9f86`: all exited 0. This supersedes the earlier 19/20 checkpoint; the stale cost test was repaired without changing existing review email behavior. Existing warnings remain; no separate unfiltered typecheck pass is claimed.
- The unshipped delivery migration is now `20260905220500_beta_intake_delivery.sql`, preserving its contents and its ordering before `20260905221000_beta_outreach.sql`. Clean replay passed using the new name. A uniqueness check covers timestamp-format migration versions; historical short-number migration naming was not rewritten.
- Final review amendment at `2e4ddf32`: confirmed provider bounce/failure/cancellation evidence now reaches the existing database state merge before the local terminal-state guard. Three new regression tests failed before the correction and passed afterward; 121 focused/local-database tests and 40 email tests passed. The real production build again exited 0 with 151 pages. Controller reran all 20 package test scripts on this final product revision: all exited 0. No UI changed in this amendment, so the three-viewport browser evidence remains applicable.
- Final controller verification on the same product revision: independently reran the combined focused command with `BETA_LOCAL_DB_TEST=1`, 121 passed, 0 failed, 0 skipped, and the complete `npm run build`, exit 0, 151 pages. No development server shared this worktree's build output.

## Final review

The independent whole-branch review and its scoped fix review are complete. All reported findings are addressed, including migration numbering, both early-send handoff boundaries, fair refresh batching, the stale cost test, and preservation of stronger delivery evidence. No remaining code-review findings. The live release checks below remain required.

## Review decisions

- Historical unstamped invitations without a provider identity or exact retry payload stay in Needs attention rather than risking a duplicate. Cost: an invitation that was genuinely never sent needs manual reconciliation. Audit counts before release.
- Keep behavior and visual checks for the approved questionnaire copy rather than adding a complete copy snapshot. Package-wide module warnings and the separately recorded baseline test-type diagnostics were not expanded into unrelated configuration changes.

## Release checklist

- Apply the delivery migration, then outreach migration, in the documented rollout order.
- Audit historical request counts without exporting personal data. Old unstamped emails without a provider identity require reconciliation; do not blindly resend them.
- Confirm the production Resend key can schedule, retrieve, update and cancel messages. A read-only environment listing confirmed the key is configured, not that it has these permissions.
- Confirm signed delivery and failure webhooks reach the existing endpoint.
- Use explicitly authorized team addresses for a short scheduled delivery, early send of the same provider message and separate admin notices. No such live tests have been performed by this implementation yet.
- Confirm a normal request retains its original 23-hour schedule after a repeat submission. An accelerated test does not establish that a full 23-hour delivery was observed.
- Confirm the supplied public TestFlight link and current build remain available.
- Keep scheduled messages intact on rollback. Do not restore a legacy sweep that treats scheduled invitations as unsent.

No production database changes, deployment or real email sends have been performed during this implementation.

## Deployment preflight after authorization

The user authorized production deployment. Latest main changes were merged into this isolated branch; the real build and all 20 package test scripts passed again. Production migration prerequisites and the normal migration role's auth-table trigger permission were verified read-only. Historical request audit: two requests, both already invited, no unstamped pending invitations.

Deployment is blocked before any production write: the configured Resend key is sending-only and rejects message-management requests. The other full-access credential available locally does not belong to an account with the PongLens domain and was not used for this project. The Resend sign-in page is open in the in-app browser; the correct account needs authentication before its key permissions and webhook configuration can be completed. The production TestFlight URL value also fails the expected URL check and must be restored to the user-supplied Apple join URL during release configuration. No migrations, git push, production deploy or real mail were performed. The temporary production environment download was removed.

## Dedicated beta credential (release in progress)

Adil authorized a dedicated, ongoing full-access Resend key after being told
that sending-only cannot retrieve, reschedule or cancel provider messages.
`RESEND_BETA_API_KEY` is used only by the beta outbox, including its two admin
notices. Ordinary transactional and Supabase auth mail keep their existing
credentials. There is deliberately no fallback to `RESEND_API_KEY`.

The key is named **PongLens Beta Invitations**, stored in the local login
Keychain as `ponglens-resend-beta-key` and in Vercel's Production environment
as a sensitive server-only value. Its permission remains account-wide; the
application's choice to use it only for beta does not narrow Resend's scope.
The original `RESEND_API_KEY` may return to sending-only once the new release
has been verified. Do not downgrade the dedicated beta key.

Correction to the earlier preflight: the downloaded TestFlight value was
Vercel's literal `[SENSITIVE]` placeholder, not evidence of an invalid value
in production. Sensitive variables cannot be verified with `vercel env pull`.
The supplied Apple join URL was set again explicitly during this release.
Local builds must use the existing real local configuration, not placeholders.

The dedicated-credential tests failed before implementation and passed after
it. All 20 package test scripts passed after merging current main. The
production webhook retains its endpoint and signing secret; subscriptions
now include scheduled, sent, delivered and failed in addition to the existing
bounced and complained events. Database migrations and deployment are still
pending at this checkpoint.
