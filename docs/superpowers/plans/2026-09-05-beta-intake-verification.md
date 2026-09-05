# Beta intake verification

Implementation is in progress. This is not a production release record.

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

## Remaining implementation checks

- Final whole-branch review and integration checks against the latest main branch.
- Resolve the existing stale cost-metering test and the migration timestamp collision introduced by concurrent work on main.

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
