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
preserving the existing player `account` and `coach()` exports. Coach-only
flow imports no longer eagerly require `TUTORIAL_ACCOUNT`; the capture driver
still applies its established player-account fallback when that export is
absent.

The review follow-up also added web parity for lesson-entry match links. The
composer offers only the active roster student's RLS-visible shared matches,
and a saved entry persists the selected match on `lessons.match_id`. Existing
entries can change or remove that link. A user-scoped API verifies the caller
owns the coach entry, roster row, and coach lesson, and that any selected
match belongs to that roster student's player account before changing only
the lesson's match reference.

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

Review follow-up REDs were recorded before implementation:

- `coach-start` entered `/coaching` before a request guard could exist;
- importing a coach flow with only `TUTORIAL_COACH` and `TUTORIAL_STUDENT`
  failed because `TUTORIAL_ACCOUNT` was required eagerly;
- the approved `link-match` beat targeted the unrelated Matches heading;
- the scene runner rejected the new select action; and
- the web app had no entry-match persistence module or route.

The focused suite became GREEN after coach start adopted the same read-only
entry/prepare ordering as paid reviews, account loading became lazy for
coach-only imports, the runner learned the real accessible select action,
and the user-scoped entry-match implementation was added. Its behavior tests
cover create/change/unlink semantics, malformed requests, RLS-hidden rows,
cross-coach entry/roster/lesson attempts, non-coach lessons, wrong-player
matches, and failed writes.

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
- Coach lesson entry follow-up: 7/7 beats resolved live. The `link-match`
  beat selected the exact shared-match UUID through the rendered
  `Link a match` control. A guarded API audit then linked that match (200),
  read back the exact `lessons.match_id`, unlinked it (200), and received 404
  for both a foreign entry and an RLS-hidden match. The final match reference
  matched the original null snapshot.
- Coach start follow-up: 5/5 beats resolved live. Its single automatic sweep
  was intercepted before the first navigation to `/coaching` and failed
  client-side as `ERR_BLOCKED_BY_CLIENT`.

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

The follow-up read-only audit was also clean: zero review-order updates,
payout references, Stripe events, Stripe/Resend/email/payout usage events,
pending submit-email flags, old delivered sweep candidates, or review
notifications appeared in the preceding two hours. The demo order remained
`in_review` with null payment-intent, charge, and payout IDs. No staging was
active and the demo lesson's `match_id` was restored to null.

## Verification

- `node --test --experimental-strip-types scripts/demos/tutorial/coach-flows.test.mjs`:
  PASS, 15/15.
- `node --test --experimental-strip-types src/lib/coach/entryView.test.ts src/lib/coach/entryMatch.test.ts`:
  PASS, 11/11.
- `npm run test:learn`: PASS, 36/36.
- Shared working tree `npm run test:tutorial`: PASS, 40/40, including the
  concurrent player-flow additions.
- `node --test scripts/demos/landing/flows/coach.test.mjs`: PASS, 1/1.
- `npm run build`: PASS. It printed existing lint warnings only.
- `git diff --check`: PASS.
- Original isolated Task 4 tree
  `72cbd6627a315ebe825452122fb8c5563d308df0`: tutorial PASS 29/29 (correcting
  the earlier report's mistaken 28/28 count), coach landing PASS 1/1, and
  full production build PASS.
- Review-fix isolated tree `b8d77bc09756bce77b85f09fa3f3e62299c56238`:
  tutorial PASS 35/35, coach entry/view PASS 11/11, Learn PASS 36/36, coach
  landing PASS 1/1, and full production build PASS. It was created from the
  exact Task 4 index and excludes the concurrent player-flow working files.

Node printed the repository's existing `MODULE_TYPELESS_PACKAGE_JSON`
warning during tutorial tests; there were no test failures.

## Cross-task contract

Task 5 should import `playerGuard`, `stageOriginal`, `tutorialApi`,
`STAGED_POINTS`, `stagedPlacement`, and `stagePlayerMatch` from
`scripts/demos/tutorial/fixtures/player-match.mjs`. This keeps player and
coach captures on the same vetted fixture and cleanup contract.
