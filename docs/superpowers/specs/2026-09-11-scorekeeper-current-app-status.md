# Scorekeeper fixes on the current app

The old branch is preserved, but it is not the release candidate: it started from divergent local code and lacked approved app changes. The active work now starts from freshly fetched shared main and carries only the scorekeeper repair and test infrastructure. Main, other tasks, production data and deployments remain untouched.

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
| Scorer fix port / post-port checks | Pending |

| Must remain intact | Boundary |
| --- | --- |
| Serve toggle | Current web and native controls, no old balls or subtitle restored |
| Whole-card scorekeeper playback | Current `keep_score_full_card` behavior; ordinary Watch retains its distinct ending policy |
| Body-card cushion | Current `rally_end_respects_card` behavior |
| Clip editing and hand cutting | Current source fallback, bidirectional Join, active-version refresh and hand-cut restrictions |
| Highlight / tools / feedback experience | Current shared-app implementation, no old screen replacement |
| Add controls, issue #5 | No changes to current threshold, edge offers or density |
| Worker, API, database, admin and release settings | No reconciliation changes in this delivery |

| Known limits | Treatment |
| --- | --- |
| Old audit source map and UI results | Historical only; not evidence of current app verification |
| Locked dependencies | Installer reported six audit vulnerabilities and a deprecated package; no dependency upgrade bundled into this repair |
| Existing build warnings | Recorded; build passed without suppressing checks |
| Broader nine-issue program | Not represented as completed by correction/Undo containment |
