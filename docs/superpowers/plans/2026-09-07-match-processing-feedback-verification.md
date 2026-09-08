# Match processing feedback verification

Date: 2026-09-07. Branch: `codex/match-processing-feedback`. Task 9 base: `563eaf0e`.

## Release assessment

**Integration implemented; not release-ready.** Focused web, database, worker and native checks pass. The real web build still fails at the pre-existing missing `serveMiss` export. A fresh full migration replay stops at historical migration `052`. iOS 26.2 hosted-screen teardown crashes in both the feedback screen and an unchanged baseline notes/allowance fixture; both pass on iOS 26.5. These failures were not suppressed or worked around.

All writes and captures used local fixtures. No production customer data, real customer messages, provider email delivery, deployed worker, production migration or release was used. The isolated worktree had its own `.next`. The temporary web preview route and capture/replay scripts were removed before the build and commit. The unrelated `supabase/.temp/cli-latest` change remains unstaged and untouched.

The narrow native compatibility repair is separate: `46dc5c00`, `fix: restore native missing-rally seam contract`. It restores `InsertSeamPair`'s historical optional neighbors and display numbers, matching the current `PlayerTakeover` call sites. Its regression and the subsequent full native build pass. The missing web trajectory/serve-miss subsystem was not revived in this feature branch.

## Implemented cross-surface behavior

| Surface | Implemented and checked |
| --- | --- |
| Web player and coach match | The live feedback row requests a server refresh only when the loaded active processing ID differs. The match page reads points for that ID and keys `MatchView` by match/version, replacing local point/media state on publication or restoration. |
| Web private feedback | Unrelated issue refresh preserves the real video element, running playhead, selected outcome and draft. A version change remounts only the media subtree and signs the newly active media. |
| Version-bound signing | The existing media route validates `expectedVersionId` against the same authorized match row that supplies the cut path. A stale request returns 409 without signing. Web player/side picker/feedback and native snapshot/remint send their loaded version; a conflict refreshes canonical match/point state before retrying, never attaching the newer cut to the old points. |
| Native player and coach | `MatchRow` includes the active ID. Ready feedback rows watch pending/queued/running/candidate requests. An ID-change notification or foreground refresh loads a coherent version snapshot, replaces points/media, closes stale point/player presentations and replaces note/tag stores. Unrelated refresh does not fetch media/points or erase the issue draft. |
| Failed owner matches | The server returns a receipt only from an actual positive personal ledger reversal of the matching source-job spend, marked `processing failed`. Both clients display the exact amount. A zero balance is not proof of a refund. Coaches receive no receipt or amount. |
| Restored requests | The retained `restored` history event produces “Previous version restored” and “The previous version is now active.” The immutable reprocess resolution is not misrepresented as a currently active replacement. |
| Learn | The existing player match-viewer guide explains the private review, exact minute request and available current match. The coach review guide explains report-only access. Both active workspaces and the generated iOS catalog receive the same role-appropriate sections. No paid-review or new recording/roadmap wording was added. |

There is no positional copying of annotations. Old points retain their own IDs and dependents; new points start without those scores, notes or tags. Owner/coach access still uses the existing server authorization and active-version RLS.

## Automated verification

Full logs are in [the evidence directory](2026-09-07-match-processing-feedback-evidence/); trailing whitespace is normalized for the repository. Counts below are from completed commands, not filtered typechecks. Suite counts overlap where a focused test was also run separately; do not add them as unique tests.

| Check | Result | Evidence |
| --- | --- | --- |
| Match issue, route, local database, presentation and real-browser refresh | **132 passed, 0 failed, 0 skipped** | [Match tests](2026-09-07-match-processing-feedback-evidence/match-tests.log) |
| Admin detail/presentation and real-browser comparison | **11 passed, 0 failed, 0 skipped** | [Admin tests](2026-09-07-match-processing-feedback-evidence/admin-tests.log) |
| Committed web feedback player/Tools refresh and signing-race interaction tests | **3 passed, 0 failed, 0 skipped** | [Browser regressions](2026-09-07-match-processing-feedback-evidence/browser-refresh-tests.log) |
| Email | **43 passed** | [Email tests](2026-09-07-match-processing-feedback-evidence/email-tests.log) |
| Commerce | **29 passed** | [Commerce tests](2026-09-07-match-processing-feedback-evidence/commerce-tests.log) |
| Processing UI | **45 passed** | [Processing tests](2026-09-07-match-processing-feedback-evidence/processing-tests.log) |
| Learn | **37 passed** | [Learn tests](2026-09-07-match-processing-feedback-evidence/learn-tests.log) |
| Learn catalog generation and checked comparison | **Both exited 0** | Commands below; committed generated catalog and catalog equality tests |
| QA inventory and affected paths | **72 passed** | [QA tests](2026-09-07-match-processing-feedback-evidence/qa-tests.log) |
| Match structure/edit geometry | **131 passed** | [Match structure tests](2026-09-07-match-processing-feedback-evidence/match-structure-tests.log) |
| Tutorial tooling | **112 passed** | [Tutorial tests](2026-09-07-match-processing-feedback-evidence/tutorial-tests.log) |
| Worker unittest, including local DB reprocess tests | **36 passed** | [Worker unittest](2026-09-07-match-processing-feedback-evidence/worker-unittest.log) |
| Worker function-style pytest | **5 passed** | [Worker pytest](2026-09-07-match-processing-feedback-evidence/worker-pytest.log) |
| `python -m py_compile worker/worker.py` | **Exit 0** | Syntax check only, not a pipeline run |
| Native focused tests, iPhone 17 Pro, iOS 26.5 | **19 passed** | [Pro tests](2026-09-07-match-processing-feedback-evidence/ios-pro-tests.log) |
| Native focused tests, small iPhone 17e, iOS 26.5 | **19 passed** | [Small tests](2026-09-07-match-processing-feedback-evidence/ios-small-tests.log) |
| No-signing native app build | **BUILD SUCCEEDED, exit 0** | [Native build](2026-09-07-match-processing-feedback-evidence/ios-build.log) |
| Real `npm run build` | **FAILED, exit 1** | [Web build](2026-09-07-match-processing-feedback-evidence/web-build.log) |
| Full unfiltered `npx tsc --noEmit --incremental false` | **FAILED, exit 2** | [Complete diagnostics](2026-09-07-match-processing-feedback-evidence/full-tsc.log); not a passing typecheck |
| Focused ESLint on changed web media/feedback code; `git diff --check` | **Exit 0** | [ESLint](2026-09-07-match-processing-feedback-evidence/eslint.log): 0 errors, 16 existing hook warnings in the large match/player components. No rules disabled. |
| Fresh full migration chain | **FAILED after 55 successful migrations** | [Migration replay](2026-09-07-match-processing-feedback-evidence/migration-replay.log) |
| Native iPhone 16e, iOS 26.2 | **FAILED: hosted teardown crash** | [Isolated runtime finding](2026-09-07-match-processing-feedback-evidence/ios-26.2-teardown.txt) |

Commands, from the feature worktree:

```sh
MATCH_ISSUES_LOCAL_DB_TEST=1 MATCH_ISSUES_BROWSER_TEST=1 node --test --test-concurrency=1 --experimental-strip-types src/lib/matchIssues/*.test.ts 'src/app/api/match-issues/[[]matchId[]]/route.test.ts' 'src/app/match/[[]id[]]/feedback/*.test.ts'
MATCH_ISSUES_BROWSER_TEST=1 node --test --experimental-strip-types src/app/admin/issues/*.test.ts
npm run test:email
npm run test:commerce
npm run test:processing
npm run learn:ios
npm run learn:ios:check
npm run test:learn
npm run test:qa
npm run test:match-structure
npm run test:tutorial
npm run build
npx tsc --noEmit --incremental false
```

The bracket escaping is intentional: the installed Node test runner treats `[id]` as a glob. An early incorrectly escaped presentation test invocation selected zero tests; it is not counted as RED or as a pass. Correctly targeted later presentation tests, the real browser tests and the 132-test final command ran the actual files.

Native command suffix shared by the test and build runs:

```sh
-project ios/PongLens/PongLens.xcodeproj -scheme PongLens \
-destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
-derivedDataPath /tmp/ponglens-task9-derived \
-clonedSourcePackagesDirPath /tmp/ponglens-task8-review-derived/SourcePackages \
-disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO
```

Tests used `xcodebuild test` with `-only-testing:PongLensTests/MatchIssueTests`; the app build used `xcodebuild build`. Small-device tests changed the destination to `iPhone 17e,OS=26.5`. The 26.2 diagnostic used `iPhone 16e,OS=26.2`. Existing local package checkouts were used after an initial network-only package resolution attempt failed DNS. No compiler/test failure was hidden by that cache choice.

Worker commands used inert fixture values for `SUPABASE_URL`, service keys and R2 variables, never deployment credentials. The unittest interpreter was `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`, with modules `worker.tests.test_worker worker.tests.test_raw_retention worker.tests.test_match_reprocess` and `MATCH_ISSUES_LOCAL_DB_TEST=1`. Pytest used `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest worker/tests/test_worker.py -q` with `PYTHONPATH=worker`. The local DB tests use the isolated feature Postgres on port 55322.

### Regression development evidence

The active-version helper test initially failed because the helper did not exist; native refresh tests initially failed against the absent model transport/refresh contract. The receipt database test failed before the additive state migration. The failed-match row amount test and restored-state text tests failed on the old presentation in web and native, then passed after the corresponding changes. The baseline `InsertSeamPair` compiler mismatch was reproduced before its separate repair. All final focused checks above ran against the resulting implementation.

The deterministic publish-between-read-and-sign route test reproduced the late integration race: the old request received HTTP 200 and the new cut instead of the required conflict ([RED](2026-09-07-match-processing-feedback-evidence/signing-race-red.log)). With the guard, stale requests receive 409 and the signer is never called; canonical retries sign the expected new or restored path. Malformed expectations are rejected, and older clients that omit the field remain compatible. A real-browser regression publishes at its first signing boundary, then observes expected IDs `[old, new]` and only the new signed cut. The native model regression initially failed to retry after that same 409, then passed while replacing the complete point/media snapshot. Native remint uses the guarded request and notifies its owning screen on conflict; its full `PlayerTakeover` UI interaction remains unverified.

The committed real-browser tests use production React, the actual `MatchFeedback`, `MatchFeedbackLink`, `ClipPlayer` and `HTMLVideoElement`. They replace Next navigation and remote boundaries only. A locally generated five-second ffmpeg test video is a playback fixture, not a reprocessed match. Initial browser harness failures were capture navigation/playback readiness issues; resetting documents for state capture and waiting for actual running playback resolved them without relaxing the identity/playhead assertions.

### Web build blocker

The real build compiled its app bundle and reached normal validity checking, then failed at:

```text
src/app/admin/uploads/[matchId]/CardTimeline.tsx:7:3
Module '"../serveMiss"' has no exported member 'inferredBounceMarkerTitle'.
Next.js build worker exited with code: 1
```

This is the same first diagnostic reproduced at the Task 9 base. A historical restoration proved the missing exports depend on a wider missing trajectory subsystem. Per the integration ruling, that attempted restoration was fully reverted; the active unrelated subsystem work in the main checkout was not duplicated here. The full build is **not passing**, and stopping at this diagnostic does not prove the remainder of type checking would pass.

An additional unfiltered TypeScript run caught and prompted fixes to this task's shared `Match` version field and nullable Learn test snippet. Its final run still fails: the serve-miss exports, missing research audio-impact types, existing marketing/test-fixture type errors and placement test regex target errors remain in unchanged files. The complete diagnostics are retained above. No filtered “typecheck passed” claim is made.

### Fresh migration replay blocker

Created a separate disposable Supabase stack at `/tmp/ponglens-task9-replay.E3rBtx`, container `supabase_db_ponglens-task9-replay`, DB port 55432. Confirmed its `public` schema initially had zero tables. Applied the repository SQL migration files unchanged, in lexical filename order, using `psql -v ON_ERROR_STOP=1`. After 55 successful files, `052_platform_cost_rate_patch.sql` failed with:

```text
ERROR: cost rate interval overlaps an existing rate
CONTEXT: PL/pgSQL function cost_rate_reject_overlap() line 21 at RAISE
```

The earlier cost-rate seed and overlap trigger reject the historical patch's overlapping upsert. No migration was skipped, edited, silently marked applied or weakened. Task 9's migration was therefore **not reached in this fresh-chain attempt**. The additive state/receipt migration was separately applied and exercised on the existing isolated feature database; that does not substitute for a clean install. The fresh stack was stopped, retaining its local Docker volume for diagnosis. The existing feature database was not reset.

## Complete local demo lifecycle

The single `versionDatabase.test.ts` lifecycle test passed against real Postgres authorization, RLS, version RPCs and the processing ledger. One local owner/coach fixture had a confirmed winner, owner point note, coach point note, tag, point share and match share.

| Step | Asserted observation |
| --- | --- |
| Owner submits; admin approves reprocess | One support candidate job/version, with no additional personal spend. |
| Candidate work | Original active ID and `old-cut.mp4` remain on the match. |
| Compare | Source version has two notes; candidate has zero. Candidate points and completion/media fields are controlled fixture output, not real worker encoding. |
| Publish | Owner's active point read returns the new point ID only. New point has no confirmed winner, notes or tags. |
| Preserve previous work | Original retains winner `user`, two notes, one tag and one point share. The existing public point link still resolves the original ID and old cut; match links follow the active version. |
| Restore | Owner's active point read returns the original point ID. The original cut and work are available again. |
| Refund | A distinct owner refund request after restoration is approved twice. Exactly one 11-minute refund ledger row and one refund event exist. |
| Keep library/work | Owner can still read the ready match with the original active ID; the original winner, two notes, tag and point link remain. |

The resolved reprocess request is immutable. The refund step used a **separate eligible request through the authenticated submit RPC**, not an invented mutation of the resolved issue. This proves server lifecycle and idempotency, not a clicked single-account UI journey: the terminal feedback screen intentionally does not offer duplicate remedies.

Worker tests exercise candidate bookkeeping, idempotency, raw retention and failures with a controlled processing boundary. **No real model inference, full candidate encoding, R2 upload/signing or staging rollout was run.**

## Visual evidence and limits

Web captures use actual shipped feedback/back/player components with app CSS on a temporary local route, intercepted fixture API responses and the repository's public demo video. They are not authenticated full-page navigation screenshots. Desktop is 1440×900; mobile is **exactly 393×660**, not a tall-phone substitute. Native captures host the real SwiftUI feedback screen with fake transport in a simulator window: iPhone 17 Pro is 402×874pt and small iPhone 17e is 390×844pt. Physical PNG dimensions are 3× those native point sizes.

The long title wraps; form actions fill mobile card width; the existing cyan primary, outlined secondary, back control, input, fonts, colors and history divider remain in use. The web capture checks assert no horizontal overflow in every captured state. Native captures do not use web-rendered approximations.

| State | Desktop web | Mobile web | iPhone 17 Pro | Small iPhone 17e |
| --- | --- | --- | --- | --- |
| Ready owner | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-ready-owner-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-ready-owner-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-ready-owner-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-ready-owner-390x844.png) |
| Raw owner | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-raw-owner-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-raw-owner-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-raw-owner-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-raw-owner-390x844.png) |
| Coach report | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-coach-report-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-coach-report-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-coach-report-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-coach-report-390x844.png) |
| Pending | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-pending-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-pending-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-pending-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-pending-390x844.png) |
| Reprocessing | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-reprocessing-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-reprocessing-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-reprocessing-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-reprocessing-390x844.png) |
| Candidate ready | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-candidate-ready-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-candidate-ready-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-candidate-ready-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-candidate-ready-390x844.png) |
| Published | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-published-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-published-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-published-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-published-390x844.png) |
| Restored | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-restored-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-restored-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-restored-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-restored-390x844.png) |
| Refunded | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-refund-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-refund-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-refunded-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-refunded-390x844.png) |
| Automatic refund | [Image](2026-09-07-match-processing-feedback-evidence/web-desktop-automatic-refund-1440x900.png) | [Image](2026-09-07-match-processing-feedback-evidence/web-mobile-automatic-refund-393x660.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17pro-automatic-refund-402x874.png) | [Image](2026-09-07-match-processing-feedback-evidence/native-iphone17e-automatic-refund-390x844.png) |

Additional web captures: [draft at 393×660](2026-09-07-match-processing-feedback-evidence/web-mobile-ready-draft-393x660.png), [scrolled submission error with retained draft and retry](2026-09-07-match-processing-feedback-evidence/web-mobile-error-393x660.png), and [reduced keyboard-space simulation at 393×400](2026-09-07-match-processing-feedback-evidence/web-keyboard-space-simulation-393x400.png). The last image is **not a real software keyboard** and does not replace the 393×660 closed-keyboard check.

Retained Task 8 static layout references were inspected and copied for context: [admin comparison desktop](2026-09-07-match-processing-feedback-evidence/task8-admin-comparison-1440x900.png), [admin comparison mobile](2026-09-07-match-processing-feedback-evidence/task8-admin-comparison-393x660.png), [decision desktop](2026-09-07-match-processing-feedback-evidence/task8-admin-decision-1440x900.png), [decision mobile](2026-09-07-match-processing-feedback-evidence/task8-admin-decision-393x660.png). These show unavailable-media placeholders and are **prior static layout evidence**, not new authenticated Task 9 screenshots. Task 9 reran the real comparison playback interaction tests separately.

### Not run / still needed

- Authenticated staging player → coach → admin end-to-end navigation, live notifications/foreground transitions and provider email delivery. Route/model tests and local fixture interactions do not establish this.
- A real retained-source candidate pipeline, model inference/encoding, object existence/signing and publish/restore on staging. Fixture completion records and black-video playback tests are not that pipeline.
- Full web build and uninterrupted fresh migration replay after the independent baseline repairs.
- Native iOS 26.2 screen teardown on a fixed baseline/runtime, or physical-device reproduction. The failure remains a release finding, not an established production crash or a solved issue.
- Real iOS/mobile-web software-keyboard opening and dismissal, native submission-error layout, full native Tools/sheets/overlays/`PlayerTakeover` interactions and video controls. The native fixture has no raw/cut media path, so it captures the feedback card/header and does **not** verify native media playback or those presentations. Model retry and route tests pass, but are not UI verification.
- A fresh authenticated admin comparison visual pass. The retained static Task 8 images and Task 9 controlled browser playback cover separate, narrower checks.
- Tutorial footage for the new private review flow. Learn text/catalog and existing tutorial-tooling checks pass; the existing tutorial specification did not name a required new narration/capture artifact for this Task 9 section. No video assets were created or re-recorded, and existing footage has not been claimed to demonstrate this flow.
- Android implementation/device verification. QA inventory keeps the existing all-surface parity tags; those tags are not evidence of an Android app check.

No merge, deployment, app release, production migration or customer communication was performed.

## Review fix round 1: native save/refetch adoption

Base: `fdb64548`. Scope: the Important finding that a details/side save could adopt a published match row while keeping the previous version's points and video. The three Minor findings are not part of this round.

`MatchDetailModel` now owns the adopted `currentMatch` alongside its point/media snapshot. Its one version-aware refresh updates same-version row metadata without reloading the snapshot; publication/restoration adopts row, points and media together on the main actor, after successful verification. A failed replacement keeps the coherent previous row and snapshot. The Tools side/details callback, standalone details editor, first-server callback, process submission and job completion all use this path. The private feedback screen also reads the model-owned row instead of maintaining a separate copy. Same-version refresh does not close point/player presentations or replace note/tag stores.

| Check | Result | Evidence |
| --- | --- | --- |
| New regressions against the pre-fix implementation | **20 passed, 2 failed, 0 skipped; exit 65**. Save/refetch returned B while loaded snapshot remained A; failed B loading also returned B. | [RED log](2026-09-07-match-processing-feedback-evidence/ios-fix1-red.log), [exact assertion summary](2026-09-07-match-processing-feedback-evidence/ios-fix1-red-summary.json) |
| Complete focused suite, iPhone 17 Pro, iOS 26.5 | **22 passed, 0 failed; exit 0** | [Pro tests](2026-09-07-match-processing-feedback-evidence/ios-fix1-pro-tests.log) |
| Complete focused suite, iPhone 17e, iOS 26.5 | **22 passed, 0 failed; exit 0** | [Small tests](2026-09-07-match-processing-feedback-evidence/ios-fix1-small-tests.log) |
| No-signing native app build | **BUILD SUCCEEDED; exit 0** | [Build](2026-09-07-match-processing-feedback-evidence/ios-fix1-build.log) |

The three added regressions cover publication between a details/side save and refetch, same-version saved details without replacing local points or the signed URL, and failed new-snapshot loading that retains the old coherent row/points/media. Existing unrelated-refresh/draft tests and hosted feedback snapshots also passed. Commands use the same focused test target, destinations, package cache and no-signing build flags recorded above; result bundles are `/tmp/ponglens-task9-fix1-{red,pro,small}.xcresult`.

This is native model verification with compiled screen callers, not a new authenticated save/playback UI capture. Prior screenshots remain intact. No new web, database, worker, Learn, physical-device or 26.2 runtime run was performed in this native-only fix round; the earlier failed/not-run release findings above remain in force. No preview scaffolding was added, and `supabase/.temp/cli-latest` remains untouched and unstaged.

## Final independent-review hardening

Two independent review rounds found and corrected additional data-integrity edges after the original integration checks:

- completed and stale ordinary queue deliveries can no longer reclaim a published match or delete points belonging to retained/candidate versions;
- an ordinary result is revalidated under the same match-row lock used by publish/restore before any output write, and point replacement is limited to its originating version;
- publish, restore and later metadata edits preserve the worker's completed pipeline settings and executing release provenance;
- an uploaded automatic-highlight object is cleaned up even when both terminal bookkeeping writes reject;
- exact historical refunds, native bigint notification receipts, immutable event/email receipts, provider reconciliation, version-bound derived jobs and default-off reprocessing rollout were separately corrected and covered by regressions.

Final coordinator/reviewer reruns through `a530b5f1`:

| Check | Result |
| --- | --- |
| Match issue state/email/refund/version real-database suites | **52 passed**, exit 0 |
| Combined worker/database unittest suites | **196 passed**, exit 0 |
| Automatic-highlight and highlight-backfill pytest suites | **45 passed**, exit 0 |
| Worker syntax and full branch `git diff --check` | **Passed**, exit 0 |
| Real `npm run build` | **Failed at the unchanged `serveMiss` missing-export blocker described above** |

The final independent review found no remaining P1/P2 feature defects. It specifically rechecked stale ordinary-job redelivery, superseded claims, exact refund idempotency, archive rollback, output cleanup and execution provenance. The release assessment and unverified boundaries at the top of this document still apply. Reprocessing remains server-owned and disabled for ordinary users by default; administrators retain the explicit QA path. No deployment, migration push, provider send or app release was performed.
