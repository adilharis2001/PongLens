# Surgical protection against a false net ending

Yu Yu Lin's first scored rally was shortened by a false two-bounce net-ending hypothesis; the corrected tail rule retains its original end.
The final guard also requires the alleged contact to project outside the table sidelines, keeping the correction limited to the suspect net-contact signature in this rally.
This is a narrow opt-in combined-policy correction, not new bounce detection, a split-rule change or promotion to ordinary uploads.

| Rule | Contract |
| --- | --- |
| Scope | Only combined-policy tail candidates with exactly two bounces and a net-motion hypothesis projecting outside the table width (u < 0 or u > 1.525m). Missing u preserves old behavior. The projection is a heuristic, not measured physical net contact. |
| Contradiction | A detected crossing occurs after the alleged net motion and before the first confirming bounce |
| Positive continuation | At least two distinct subsequent crossing clusters, more than .25s apart and at most .75s apart, before the existing card end |
| Result | Skip this tail candidate; preserve existing endpoint unless another eligible terminal event supports it |
| Why not every crossing? | The first test rejected two already approved cuts. Broader full-replay checks also showed dead-ball returns falsely counted as continued exchanges. Require rapid continuation, using the existing .75s cleanup grace; do not change bounce thresholds or the existing later-crossing rule. |
| Unchanged | All splits, three-or-more-bounce endings, starts, serving, body/ball models, cleanup, job flags, table validation, user scores, web/iOS and email behavior |
| Runtime | A scan of existing crossing timestamps for the affected tail candidates. No inference, network call or paid model added. |

## Evidence

| Check | Result |
| --- | --- |
| Yu Yu Lin point 1 | Old proposal 9.48–13.12s; corrected 9.48–15.97s. Exported old segment ended at source 13.65s; original footage shows continued play. |
| Exact causal reconstruction | Archived full-resolution detections with new production calibration/fps reproduce both bounce timestamps and the entire private net-motion record exactly. Crossings at 12.8670 and 13.3003s were hidden by the old continuation grace. |
| Yu Yu Lin full-match tail-stage replay | Both live two-bounce tail proposals reproduced. Comparing old/new policy on identical archived detections changes only point 1; other archived outputs identical. Not a full fresh body decode. Historical dump differs at some other multi-bounce events and must not be called an exact replay of the entire live run. |
| New owner scoring snapshot | 73 scored rows, 35 taps in the new match at query time. First point extended to 15.42s. Other scored combined-tail examples were not extended; that is useful feedback, not proof of physical contact or exact ending. All reads only. |
| Owner fixtures | All 20 approved real detector-window outputs unchanged |
| Broader intermediate guard, rejected | Nine full composed cached replays: 755 retained cards, 67/68 tail trims preserved; one Julian endpoint changed. This was NOT packaged for activation. |
| Julian 6d55dfb7, card 15 | The intermediate version extended 152.12 to 153.69s. The contact sheet shows later strokes but cannot conclusively distinguish continued play from post-point returns. Do not treat the earlier AI interpretation as an owner quality verdict. The final off-table restriction preserves this original cut. |
| Final nine-recording replay | All 755 retained cards unchanged across nine complete cached assembly/export replays, including all 68 existing tail trims and four cleanup removals. No fresh model inference in this corpus replay. |
| Regression | Real archived ball-track fixture fails against sealed 44cfebbf and passes on correction. Unit cases cover rapid double bounces, genuine endings, and isolated cleanup crossings. |
| Verification | Earlier broad worker suite: 216 passed plus seven subtests and three existing missing-data warnings. Final narrowed code: 77 combined/net-ending/reviewed-split/cleanup tests passed, including the archived-track fixture and in-table preservation test. 25 package tests and real isolated `npm run build` passed. Independent final read-only review found no Critical or Important issues; its ambiguous-footage label correction is included here. |
| Candidate package | `99ae3e008f2a2298b360ded74660ff8924ac6831ecae4016161fc21d63518df2`, worker source `b9cb59ab2d7b13239be8c3baa3668a6293fb9b7c`, pushed to the existing approved GitHub branch. Exactly three payload paths changed: combined policy, its tests and numerical regression fixture. Runtime, model assets and all sealed behavior settings match live 44cfebbf. |
| Rollout state | LIVE, freshly verified 2026-09-15T00:18:05.926678Z. Main PID 47993 accepted queued job 4d14a4df-b527-45ed-b204-ec3da92981b6; fast PID 47991 idle and accepting. Both exact-release process identities and fresh pulses verified, monitor fresh, both startup drain files absent. Brian finished including post-ready analysis before guarded stop/install/start. |
| Startup recovery | The host stopped returning commands during paused startup. Initial resume refused because the new monitor had not yet run. After access recovered, read-only checks verified monitor time after startup and both fresh drained identities; guarded resume then succeeded. No safety checks bypassed. |
| Rollback | Exact release 44cfebbf5c7075dd7bdab39024257ec5ecf246967a009ea15ba6ad8174e0e91d; whole signed launcher backups in `/Users/adil/Library/Application Support/PongLens/launcher-backups/20260914-net-continuity-99ae3e008f2a`. Use this rollout directory's separately guarded rollback phases, not a historical hardcoded recipe. Never activate rejected intermediate package 16e7fd0b. |
| Preserved | No active job interrupted, no scored match overwritten or requeued, no flags/schema/UI/other-lane changes. Existing mail-control state preserved. No recurring production-change automation created. |

| Reproduction / evidence | Location |
| --- | --- |
| Local diagnostics, scoring snapshot, immutable trial/final replays | `/private/tmp/ponglens-net-continuity-fix-20260914.t4IWv5` |
| Final corpus comparison | `surgical-corpus-comparison.json` there; `final-corpus-comparison.json` belongs to the rejected broader intermediate guard |
| Exact first-rally extraction and paired tail stage | `replay_yuyulin.py`, `yuyulin-replay.json` there |
| Visual checks of broader guard false positives | `19a1efc7-284.jpg`, `d59d7610-836.jpg`, `d59d7610-1023.jpg`, `9e15ed10-308.jpg` there; final rule preserves these cuts |
| Ambiguous Julian footage, original cut preserved | `6d55dfb7-150.jpg` there |
