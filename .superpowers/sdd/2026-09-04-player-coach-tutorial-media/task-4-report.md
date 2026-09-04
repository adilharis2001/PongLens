# Task 4 report: guarded coach browser flows

## Result

Added all eight web coach capture flows, in approved course order, with one
scene per narration beat and selectors tied to current accessible names or
scoped product elements. The flows cover the coach Home and roster, adding
and connecting students, lesson entries, sharing, match review, feedback, and
the web-only paid-review workspace. They use the staged coach and student
identities from `TUTORIAL_COACH` and `TUTORIAL_STUDENT`.

Coach match review now uses a shared, guarded player-match fixture. It stages
the approved demo cut as a disposable Original and three production-valid
serve placements. The combined analysis beat visibly cues Match analysis and
then Serve placement. The shipping placement collector accepts all three
fixture serves in the test, and the live coach page showed Original, Match
analysis, and Serve placement.

The coach guard verifies the exact auth identity before reading or writing,
snapshots every table each flow may touch, restores changed or deleted rows
in foreign-key order, and removes only new rows carrying the `Tutorial
fixture` marker. The shared player guard additionally restores `raw_path`,
the placement lifecycle/job fields, `placement_mapped_points`, and selected
points' `placement` and `deleted` values. Its `finally` cleanup removes only
an owner-prefixed disposable `ponglens-raw` object that was absent at
snapshot time.

`stage_coach.sql` now asserts the fixed coach/player auth identities before
writes, stages a connected and an offline roster, shared-match access, a
public lesson-entry link, point and overall feedback, and checks the accepted
review/match state. Trigger execution is transaction-locally suppressed so
staging cannot create coach-entry, match-share, or note notifications. It
does not create charges, payouts, exports, jobs, or notifications.

The pre-existing `flows/account.mjs` change is required by the Task 4
interface: it adds lazy `coachAccount()` and `student()` accessors while
preserving the existing player `account` and `coach()` exports.

## TDD evidence

Initial structural RED: `npm run test:tutorial` listed all eight missing
coach flow modules. After the flows were added, the focused structural suite
passed.

Guard REDs were recorded in sequence:

- missing `snapshotCoach`, `restoreCoach`, and `withCoachGuard` exports;
- a deleted pre-existing coach row was not reinserted after an injected
  mid-beat failure;
- the generic capture guard sent a coach scope to the legacy match path;
- `withPlayerGuard is not a function` for the cross-task placement guard;
- the player interruption test showed `deleted: false` was not restored to
  its original `true` value.

Each became GREEN after the smallest corresponding adapter/restore change.
The final focused suite passes 11 of 11, including successful and interrupted
coach cleanup, interrupted player placement/raw-object cleanup, and the real
serve-placement collector.

Live selector REDs found stale or incorrectly ordered behavior: async Recent
entries needed an explicit target wait, post-click waits ran before their
actions, the shared-entry update sentence did not start with the old text,
and the current paid order status is `New order`, not `Ready to accept`.
Those selectors/orderings were corrected and re-audited.

A final safety RED showed that opening Orders itself posts the housekeeping
`action: sweep`. That endpoint can complete old deliveries, attempt payouts,
and claim queued review email even when the capture clicks nothing. The paid
review flow now signs in through the read-only Students route, installs a
narrow Playwright route guard in `prepare`, and only then opens Orders. The
guard blocks only POSTed sweep actions and continues every other request. Its
focused test failed on the old direct Orders entry, then passed after this
change.

## Staging and cleanup evidence

Before the first live write, Supabase admin checks proved the fixed UUIDs map
to `miguel-demo@example.com` and `uploader-test@example.com`. The SQL
transaction committed, and read-only verification returned:

- roster: 3 total, 2 connected, 1 offline;
- accepted all-match access: 1;
- public fixture entry link: 1;
- fixture feedback notes: 2;
- ready scored match with placement: 1;
- accepted in-review order: 1;
- new fixture notifications: 0.

The three fixture groups absent at preflight were immediately removed:
2 notes, 1 entry link, and 1 access link. Repeated live audits used the same
short stage/cleanup bracket. Final counts for all three are zero and new
fixture notifications remain zero.

The guarded live Original/placement audit restored five items (three points,
one match, one raw object). An exact post-restore snapshot matched the initial
DB snapshot and a fresh guard snapshot proved the raw object absent. No Task
4 staging is active at handoff.

## Live product audit

- Coach start through share-entry: all scenes resolved against the running
  product after correcting the proven REDs.
- Coach feedback: 6/6 beats resolved live.
- Coach paid review: 8/8 beats resolved live, including the order workspace,
  findings, write-up, delivery control, and payout status. The guarded audit
  observed both automatic sweep requests fail client-side as
  `ERR_BLOCKED_BY_CLIENT`; no transition request reached the server.
- Coach match fixture: Original, Match analysis, and Serve placement all
  resolved live under the exact player guard, followed by exact cleanup.

No deliver, accept, payout, export, share, note-send, or student-create
control was clicked during the live audit.

The earlier selector audit had opened Orders before this automatic behavior
was noticed. A read-only production audit then proved that no review order
globally had been updated in the preceding two hours, no recent payout ref
or Stripe event existed, no Stripe/Resend/email/payout usage event existed,
and there were no pending submit-email flags or old delivered sweep
candidates. Miguel's completed fixture order has no payment intent or charge,
so the payout implementation returns before calling Stripe. A second audit
after the guarded 8/8 run returned the same zero counts. The two recent
review-text notifications belonged to a different user and predated this
audit; neither was created by a review transition.

## Verification

- `node --test --experimental-strip-types scripts/demos/tutorial/coach-flows.test.mjs`:
  PASS, 12/12.
- `npm run test:tutorial`: PASS, 32/32.
- `node --test scripts/demos/landing/flows/coach.test.mjs`: PASS, 1/1.
- `npm run build`: PASS. It printed existing lint warnings only.
- `git diff --check`: PASS.
- Isolated Task 4 tree `72cbd6627a315ebe825452122fb8c5563d308df0`:
  tutorial PASS 28/28, coach landing PASS 1/1, and full production build
  PASS. It excludes every concurrent Task 5 and iOS working-tree file.

Node printed the repository's existing `MODULE_TYPELESS_PACKAGE_JSON`
warning during tutorial tests; there were no test failures.

## Cross-task contract

Task 5 should import `playerGuard`, `stageOriginal`, `tutorialApi`,
`STAGED_POINTS`, `stagedPlacement`, and `stagePlayerMatch` from
`scripts/demos/tutorial/fixtures/player-match.mjs`. This keeps player and
coach captures on the same vetted fixture and cleanup contract.
