# Scorekeeper fixes on the current app

The old branch is preserved but is not the release candidate; the repaired version starts from current shared main and preserves the approved interface. Adil has authorized production desktop/mobile web deployment and a new TestFlight build, with the remaining native live-playback checks performed manually. The local main checkout, unrelated work and production match data remain untouched.

| Baseline | Evidence |
| --- | --- |
| Active branch | `codex/scorekeeper-current-app` |
| Shared-app base | `fd9e529c8a984155a763bf4dbb7ea7d5db284ce3`, fetched September 11 |
| Preserved old branch | `codex/scorekeeper-playback-integrity`, `f3d16953` |
| Dependency isolation | Current lockfile installed locally in this worktree; main's dependency folder untouched |
| Current web production build | Passed before scorer port |
| Current match-structure / scorecard checks | 141/141 and 15/15 passed |
| Current native Foundation checks | 956/956 passed before scorer port |
| Native target | Debug build-for-testing and Release simulator build passed; fixture excluded from Release |
| Rendered references | Approved serve switch verified on desktop1440x900, mobile393x660 and native portrait/landscape before scorer changes |
| Current-version bug reproduction | Web correction changed prior6s to replay0.13/0.09s; native correction after fullcardpause changed6s to8s; web missing-failure feedback and pendingUndo ordering also reproduced |
| Scorer fix port | Applied selectively on current app; real web build and native Debug/Release builds pass |
| Final logic checks | Web scorer42/42, match-structure141/141, scorecard15/15; native scorer102/102 and fullFoundation1058/1058 |
| Post-port rendered web | 40/40 passed at desktop1440x900 and mobile393x660, including backwardJoin and current whole-card on/off behavior |
| Post-port native | Correction, Clear, Skip, ordinaryUndo and portrait delayedUndo+Gestures verified through real controls and accepted synthetic saves; remaining scenarios in progress |
| Independent review | Whole branch fd9e529c..f1bf2920 code-clean; no Critical, Important or Minor findings |
| Final native build | Clean Debug and Release simulator builds passed on f1bf2920 |
| Production web | f1bf2920 fast-forwarded to remote main; Vercel deployment4R8k2ytbE7JQUZGNETbbmFJgF4uL succeeded; www.ponglens.com returnedHTTP200 |
| TestFlight | Version1.0 build191 metadata prepared; physical-device Release archive/upload in progress, not yet available |
| Testing model | GPT-5.6 Sol owns remaining regression/build and actual-screen checks, as requested by Adil |

| Must remain intact | Boundary |
| --- | --- |
| Serve toggle | Current web and native controls, no old balls or subtitle restored |
| Whole-card scorekeeper playback | Current `keep_score_full_card` behavior; ordinary Watch retains its distinct ending policy |
| Body-card cushion | Current `rally_end_respects_card` behavior |
| Clip editing and hand cutting | Current source fallback, bidirectional Join, active-version refresh and hand-cut restrictions |
| Highlight / tools / feedback experience | Current shared-app implementation, no old screen replacement |
| Add controls, issue #5 | No changes to current threshold, edge offers or density |
| Worker, API, database and admin | No reconciliation changes in this delivery; iOS build number is the only release-setting change |

| Known limits | Treatment |
| --- | --- |
| Old audit source map and UI results | Historical only; not evidence of current app verification |
| Locked dependencies | Installer reported six audit vulnerabilities and a deprecated package; no dependency upgrade bundled into this repair |
| Existing build warnings | Recorded; build passed without suppressing checks |
| Full standalone TypeScript check | Ten diagnostics remain in six unchanged current-baseline test files; not claimed passing |
| Native uninterrupted1×/2× first-score acceptance | Still requires manual testing. Both automated UI drivers made the app inactive between actions, correctly invalidating the foreground-only capture run; no guard was bypassed. See docs/scorekeeper-release-checklist.md |
| Broader nine-issue program | Not represented as completed by correction/Undo containment |
