# Worker release and body-processing health

This work isolates the Mac main/fast worker from the editable checkout and records body-processing health separately from delivery of usable video. The first release blocked after a post-processing detector download; the corrected release below is now active with monitoring restored. Read this record before changing launchers, runtime dependencies or body fallback reporting.

## Current correction, 2026-09-11

| Item | Current evidence or required rule |
| --- | --- |
| Active source and release | Local committed source `6ec6ea19`; release `beb02a6c1002577ec521d2dce12916cdd9f8cbba3dbd640ea7dec7014c3bcf9b`, installed under `/Users/adil/Library/Application Support/PongLens/match-releases/`. Main PID 78681 and fast PID 78679 report this identity. The latest correction and operational notes are local, not yet published. |
| Why the first release blocked | At 18:07:54 UTC, post-ready side-change detection downloaded its default person detector into `TORCH_HOME`, which incorrectly pointed at the sealed table source seed. Exactly two entries were added: `models/table-keypoints/torchhub/hub/checkpoints` and its detector ONNX. No original packaged entry changed or disappeared. Main, fast and the independent monitor correctly refused the changed release. |
| First real processing evidence | The original release completed a genuine body attempt as `used` at 18:07:35 UTC before the optional side-change step. That success did not prove the complete post-ready path was safe; the previous smoke coverage missed it. |
| Model fix | Shared pose/person-detector loaders resolve and hash the approved packaged asset before invoking rtmlib. The legacy side-change default URL resolves to the local approved detector. Missing, changed, symlinked and external override models are rejected before load/download; detector provenance hashes the same local file. Unsealed research URLs remain supported. The old downloaded detector and the packaged detector have identical SHA-256 `4f4d7e07350b1753299111d1ae500fd64447a5b0e38e4bacbefab6573c742d30`; no detector-weight change is hidden in this fix. |
| Cache fix | `TORCH_HOME` is now `<state>/cache/torch`, not the table source seed. The table model still loads its packaged backbone by explicit local path with `pretrained=False`. Logs, temp data and Python/CoreML/library caches remain outside the payload. Integrity checks were not relaxed. |
| Regression evidence | 24 release tests plus 35 side-change/calibration/structure tests passed; 22 health/fallback/claim-boundary tests passed. New tests first reproduced the cache mutation and default detector download path. Independent read-only model-loader review found and prompted a test/fix for unsealed URL compatibility; no further production model-download path was found. |
| Actual offline inference | On a real 720×406 clip: side-change default path decoded all 14 requested frames, qualified both clips and reported the packaged detector hash; repeated successfully against the same external state. Pose produced 20 samples with CoreML. Table detection succeeded on all 16 sampled frames. BlurBall ran on MPS and produced 12 frame records. Every mode denied model-network connections and reverified the payload afterward. Two short clips are an inference test, not proof of end-change accuracy; no change was asserted (`withheld`). |
| Other package evidence | 16 frozen body/V3 parity cases passed, with the same three existing missing-sample warnings. Native loaded-image checks passed for all four interpreters. Installed worker import-only check passed. GPU and Keychain checks required normal Mac access after sandbox-only attempts failed; no dependency was upgraded. Artifacts: `/private/tmp/ponglens-cache-fix-smoke/`. |
| Corrected rollback | Source `24dd3eeb`; release `52a7d10eb3784e4725fd8898b8b50d321e92238352aa0c6568cfe873f0edc259`, permanently staged. Same model/cache correction on the captured baseline; 59 unit cases, 10 claim-boundary cases, 16 frozen parity cases, both lane check-only resolutions and actual offline side-change inference passed. All 1,215 selected model/loader manifest entries match the tested candidate. This baseline does not report outcomes; disable coverage/email only if actually rolling back, preserving records. No live rollback flip was performed. |
| Retired release warning | Do not reactivate `c9c012af...` or the original `b8f833e3...` rollback: both contain the cache/default-detector bug. Preserve them as historical artifacts, not approved rollback targets. |
| Controlled switch | Existing blocked workers were verified fresh, job-free and child-free and stopped under SHARE locks on only main/fast queue tables. Queued messages were preserved. Existing applet wrappers were backed up, updated and signed as before; both corrected workers started paused and reported their exact identity before pause removal. Monitor recovered at 18:35:32 UTC; existing coverage start/email preferences/history were preserved. |
| Launch preflight correction | The one-off deployment helper initially generated an unsealed Python bytecode directory while importing the staged runner. Integrity caught it before any switch. Only those two proven added cache entries were moved to `/private/tmp/ponglens-cache-fix-bootstrap-bytecode`; original files were unchanged. The helper now sets `sys.dont_write_bytecode=True` and is invoked with `-B`. Production bootstrap remains `-I -B`. |
| Launcher backup | `/Users/adil/Library/Application Support/PongLens/launcher-backups/20260911-model-cache-correction/`. These restore the old launcher configuration for diagnosis only; their old release is not a safe processing fallback. |
| Live recovery | The admin page shows the corrected workers with no blocked status and “Monitoring”. Fast completed the waiting clip update; main passed a real content check and started the waiting match at 18:37:08 UTC. Full completion of that corrected-release match is still being observed, not yet claimed. |
| Other work | Hand PID 13780, lesson workers, disabled match cloud, Scorekeeper and native/web source remain untouched. No database migration or synthetic production job/email was added. |
| Mandatory future gate | Before activating any worker package, run the actual offline `pose`, `table`, `side-changes`, `ball`, `native`, `imports` and frozen `parity` checks from `worker/tests/smoke_match_release.py`; use fresh external state and repeat side-change inference. A body result alone is not the whole pipeline: include post-ready enrichment and verify integrity afterward. Read `worker/match_release/README.md`. |

The sections below preserve the original rollout record; the corrected identities above supersede its original primary and rollback selections.

## Status and ownership

| Item | Current fact |
| --- | --- |
| Implementation checkout | `/Users/adil/Desktop/Projects/PongLens/.worktrees/worker-release-health` |
| Captured production baseline | `f4156c96`; captured current root worker while root HEAD was `b425494c`. Baseline differences from origin/main are pre-existing runtime work, not this task's fixes. |
| New release package | `77317f94`, `617381a2`, `e6e85766`, `223d2399`; loader hardening, claim-status clearing, smoke runner and admin integration committed in `d14efae7`. |
| Outcome integration | `c6a9fb29`, with reviewed retry/terminal-coverage fixes in `0d2f810b`. Final fixes in `0fa465c8` recheck immediately before claims and record missing/invalid settings without changing fallback defaults. Final scoped review approved with no remaining findings. |
| Root checkout | No longer supplies main/fast worker source. Still contains other tasks' unfinished work and the externally anchored worker Python environment; do not clean, reset or upgrade it. Documentation notice only. |
| Concurrent-source check | Rechecked 279 existing captured worker files against `f4156c96`: executable/model files unchanged; only worker README documentation differs. Recheck again immediately before any activation. |
| Other tasks | Scorekeeper work is excluded. Do not change scoring helpers, point timing, shared score state, hand-cut or lesson launchers. |
| Cloud | Match Modal remains disabled. These local release IDs are not the historical `pipeline_releases`/parity identities; do not set processing_control.active_release_id to them. |
| Web | Previewed existing admin rows on desktop and 393×660 mobile. Adil approved screenshots and production rollout on 2026-09-11. No native iOS change. Narrow integration is based on main `c355e039`, not the captured worker baseline. |

## Fixed-release contract

| Boundary | Rule for every future chat |
| --- | --- |
| Source | Build only from an explicit committed worker snapshot. Both parent daemon and fresh children resolve the same content-addressed directory. Never point a launcher back at a developer checkout. |
| Assets | The payload includes body models, features, V3 data, pose/detector weights, table source/weights/hub source and BlurBall source/weights. |
| Dependencies | Python environments and native libraries are currently external verified anchors, not relocated independent installations. Do not update pip/Homebrew/yt-dlp/OS in place while an active release depends on them. Prepare separately located runtimes for independently upgradable releases. |
| Identity | Full payload/model/runtime/behavior manifest hash; git HEAD alone is not evidence of the running code. Unsealed execution says `unsealed`. |
| Claims | Verify before accepting a job and in each Python child. Drift prevents new work; it must never be silently accepted as the same release. |
| Environment | Audited processing defaults are part of the manifest. Credentials remain outside it. Runtime data settings still come from the permitted per-job/app_config switches. |
| Mutable state | Logs, temporary media, outcome retry spool and generated caches stay outside payload, including the shared `TORCH_HOME`. Python bytecode and CoreML start with fresh launch directories. A bootstrap importing sealed code must disable bytecode before that import, not only in its eventual child environment. |
| Table model | Sixteen frames; local sealed backbone; no redundant ImageNet download before loading the full trained table checkpoint. No change to final model weights or frame policy. |
| Limits | Integrity detection is not protection against an administrator rewriting code and manifest, nor a lock preventing a dependency from changing midway through an existing call. |
| Commands | `worker/match_release/README.md` documents build, verify, stage and check-only commands. Never activate an old temporary bundle merely because it has a release ID. |

## Outcome contract

| Fact | Meaning |
| --- | --- |
| Attempt key | Existing `job_id:read_ct`, shared with cost reporting. A queue retry gets a different key. |
| Start | After input gates and before ball/pose work, freeze pipeline and edge-switch choices and record the attempt. Gate refusals and library-only imports do not claim body processing happened. |
| Configuration provenance | Valid job overrides and explicit app settings remain authoritative. Missing/invalid/unavailable pipeline settings still execute the existing V1 default but record unknown intent; each edge switch records its own source. Bounded error codes expose defaults without storing raw values. |
| `used` | Delivered pipeline is bodies AND explicit body-stage evidence says used. Nonempty cards alone are not proof. |
| `refused` | Expected evidence limitation, such as insufficient visibility or missing table/activity area. Keep the existing ball cards. |
| `degraded` | A body/pose/assembly/refinement/configuration failure occurred even if usable video or body cards were delivered. |
| `unknown` | Outcome reporting is absent or incomplete. Never label as healthy. |
| `not_requested` | The recorded request selected a ball pipeline. |
| `failed` | Point processing or publication did not finish. A usable cut may still have shipped under the existing contract. |
| Body versus V3 | Record both independently. A failed serve refinement can coexist with a successfully delivered body assembly. |
| Match JSON | Additive `processing` object records selected output, release/model, configuration source and output-ready time. No point/card fields are changed. |
| Database final | Authoritative publication completion, distinct from the earlier output-ready snapshot inside match.json. |
| Error privacy | New operational records/notifications use bounded reason codes and exception class names, not raw exception text, private paths or media. |

## Persistence and monitoring

| Component | Rule |
| --- | --- |
| `worker_processing_runs` | Admin-only start/final records. A delayed start cannot overwrite a genuine final record. No FK that would block video completion on a job/match row. |
| `worker_processing_reporting_gaps` | Append-only observations of terminal attempts missing their final record. Survive retries without fabricating a worker outcome. A late genuine final remains authoritative; a running retry does not imply recovery. Admin RPC projects observed unfinished attempts as unknown without changing the raw start. |
| Retry spool | Atomic local write before send, outside release. Compare/delete under the same file lock as writes so delivery of an older start cannot remove a newer final snapshot. |
| Database isolation | A separate connection with connection/statement/lock timeouts; reporting errors never fail a player's job. |
| Independent monitor | `worker/processing_health.py --once`, intended for a separate once-per-minute launchd task. It does not claim media jobs. |
| Operational incident | Two different degraded/failed body-requested jobs within 24 hours, grouped by release. Retrying one failed job is not two failures. |
| Recovery | Two later explicit body successes on the same release. Expected refusals, silence, elapsed time and another release succeeding are not recovery. |
| Coverage | Unknown/incomplete telemetry is a separate incident. A running retry must not erase unresolved reporting; a terminal job with an explicit started attempt counts even without a published match. |
| Email | Enabled at production activation; uses durable lease, stable incident idempotency key, existing approved renderer/sender/suppression checks and admin recipient only. No test email has been sent and actual production email delivery is not yet verified. |
| Activation timestamp | `worker_processing_health_control.expected_after` is `2026-09-11 16:17:58.611383+00`. Historic uninstrumented jobs are not newly failing jobs. |
| Admin read | Additive `admin_processing_health()` RPC; existing overview, scorekeeper and job-completion contracts remain unchanged. |

## Verification evidence

| Check | Result |
| --- | --- |
| Source isolation/integrity | 18 tests pass, including source edits, new/missing files, runtime edits, symlink retarget, native dependency omissions, inherited settings and loader overrides. |
| Outcome/fallback/database/boundary tests | Final `0fa465c8`: 60 passed in 1.88s, including 15 real PostgreSQL cases. Original cards preserved through failed pose and partially written second pass. Drain/integrity changes during retention or either digest prevent the next claim, and lifted pauses clear. |
| Frozen bodies/V3 | Final packaged tests: 16 passed, three existing missing-sample numpy warnings, 129.77 seconds. No frozen feature changes to suppress warnings. |
| Body edge/table fitting | 41 tests passed. |
| Final bundle | Source `0fa465c8`, release `c9c012af733163130a87b4cb17612ec5fa2798e26ec83392f240fcbe296b07e9`; verified and active at `/Users/adil/Library/Application Support/PongLens/match-releases/c9c012af733163130a87b4cb17612ec5fa2798e26ec83392f240fcbe296b07e9`. Built using reviewed `/private/tmp/ponglens-match-release-inputs-round1.json`. |
| Actual native inference | Source `d14efae7`, release `46e93cc85ecbf89185431f219298afe4f45bff4a0f5638a734ee6e15b12b8427`: imports, pose, table and loaded-native audits pass. Those model, loader and inference files are unchanged in final source `0fa465c8`. |
| Imports | Final packaged worker imported with existing Keychain access without starting main or touching queue; fixed paths and release identity asserted. |
| Main/fast launch resolution | Both `run --check-only` commands executed using the staged package's own runner and passed. Each resolves the same exact sealed worker source with its intended lane, using temporary external state. Neither worker was started. |
| Pose | Saved Prabhas clip, 2 seconds, 20 samples, actual `coreml` provider. Sandbox-only attempt failed on blocked system interfaces; normal Mac execution passed. |
| Table | Same saved clip: all 16 frames agreed; 0.48px spread. Payload verification after inference passed. |
| Loaded native libraries | Actual imports audited in all four interpreters: worker 42, pipeline 181, pose 126, table 150 non-system loaded images, all inside verified anchors. This checks the exercised imports, not every hypothetical future plug-in. |
| Smoke artifacts | `/private/tmp/ponglens-release-smoke-final/` for final imports/parity; `/private/tmp/ponglens-release-smoke-d14/` for native inference checks. Point pipeline, body/V3 algorithms, model assets, inference loaders and parity tests are byte-identical between final and d14efae7. Script: `worker/tests/smoke_match_release.py`. |
| Database | Isolated PostgreSQL migration, RLS, permissions, final/start idempotency, missing-final retries, out-of-order spool delivery, incident recovery and notification lease/retry checks passed. Actual mail renderer exercised; sender mocked, no emails sent. |
| Independent monitor CLI | Final packaged `processing_health.py --once` ran under `prepare_run` environment against loopback-only `ponglens_worker_health_integration`, with a fresh separate test spool and email disabled. Monitor timestamp advanced; final bundle verification passed afterwards. No production records replayed and no media worker launched. |
| Admin rendering | Success/refusal/problem/unknown/failure/running/empty/unavailable/paused/blocked/recovery/telemetry and monitor states rendered on desktop and 393×660 mobile, using actual components with temporary sample data. Temporary preview route removed; no production data was written. 40 view tests pass. |
| Web build | Real `npm run build` passed for final `0fa465c8` with own lockfile-installed dependencies and isolated `.next`; pre-existing lint/build warnings remain. Temporary preview removed. No native iOS code changed or native testing claimed. |
| Test resource cleanup | Local preview server stopped. Task-created PostgreSQL containers `ponglens-worker-health-20260911` and `ponglens-worker-health-integration-20260911` stopped after verification; their disposable fixture data remains recoverable with `docker start`. Other containers untouched. |
| Not yet verified | Full production rollback flip, first real live processing outcome and production notification delivery. No point-processing job arrived during rollout; zero attempts is the expected empty state, not evidence of successful body processing. |

## Rollout gates

| Order | Required evidence |
| --- | --- |
| 1 | Complete: final implementation `0fa465c8`, independently reviewed after fixes. |
| 2 | Complete: candidate and explicit sealed rollback built, verified and permanently staged. See the operational handoff below; older temporary bundles are not approved rollback releases. |
| 3 | Complete: rechecked 279 existing captured worker files immediately before rollout; only worker README documentation differs. Other tasks' unfinished source is preserved. |
| 4 | Complete: applied only `20260911143000_worker_processing_health.sql` and its migration ledger entry in one production transaction. SHA-256 `a014473d761a39a1a78daff4072f0c99c97d31df7a5df6a0729a9b5e81ff3fad`. Admin RPC rejects anonymous and non-admin authenticated reads; all four operational tables have RLS. |
| 5 | Complete: both idle legacy workers stopped under the rehearsed queue claim barrier. Both fixed-release workers started paused and reported the correct full release identity before activation. |
| 6 | Complete: independent monitor's first run exited 0 and advanced production heartbeat at 16:16:44 UTC. Coverage/email enabled at 16:17:58 UTC, then both worker drain files removed. Hand/lesson/cloud unchanged. |
| 7 | Web published after screenshot approval and verified live on desktop and 393×660 mobile. First real point-processing attempt remains awaiting a normal upload. No fake production job or test email was created. |
| Integration | Do not merge the captured baseline wholesale over newer main. Keep release source authority distinct from narrowly integrating the new admin/operational changes. |
| Launcher source | At activation, load `match_release` from the exact staged release's `worker` directory, not this developer worktree. Main, fast and the independent monitor must all use the same explicit release directory and external state; never resolve a moving alias per child. |

## Operational handoff, 2026-09-11

| Item | Exact record |
| --- | --- |
| Primary source | `0fa465c8`, published on `codex/worker-release-health`. Full release ID `c9c012af733163130a87b4cb17612ec5fa2798e26ec83392f240fcbe296b07e9`. |
| Rollback source | `21d83b9d`, published on `codex/worker-release-rollback`. Full release ID `b8f833e35e2af1633e70dc3f473842d4df90f7676c95b7ce1aeb000ce0dcd98f`. Both releases live under `/Users/adil/Library/Application Support/PongLens/match-releases/`. |
| Rollback meaning | Captured baseline processing with the reviewed fixed-path/cache/drain/integrity adapters only, without new outcome reporting. All 204 other worker functions and the processing algorithms match the captured baseline. Shared runtime anchors must still verify. |
| Rollback verification | 18 release tests, 10 boundary tests, 16 frozen-parity tests, imports and both staged lane check-only commands passed. Independently reviewed. No full production rollback flip was performed. |
| First handoff | Empty main/fast queues, no processing jobs, fresh idle exact-PID pulses and no worker children were checked while SHARE locks on only those two queue tables prevented a claim race. Both legacy processes exited before releasing the locks. The claim barrier was rehearsed on isolated PostgreSQL. No active job was killed. |
| Main/fast startup | Existing applet wrappers retained at `/Users/adil/Applications/PongLensWorker.app` and `PongLensWorkerFast.app`; scripts resolve the explicit sealed release through its own runner. Same ad-hoc signer and identifier. Both reported the correct release with `drained` before activation. |
| State and logs | `/Users/adil/Library/Caches/PongLens/match-runtime/<release-id>/`; logs under `logs/`, pause files `drain-main` and `drain-fast`. Health spool remains `/Users/adil/Library/Application Support/PongLensProcessingHealth/spool`. |
| Independent monitor | LaunchAgent `com.adil.ponglens-processing-health`, 60-second interval, exact sealed `processing_health.py --once` under the verified environment. Uses default scheduling, not `ProcessType=Background`: background throttling produced a 187-second gap, exceeding the 180-second freshness threshold. After removing that launcher-only setting, two completed runs at 16:23:31 and 16:24:57 UTC exited 0, 86 seconds apart, with empty stderr. Independently reviewed; neither media worker restarted. Does not claim media work. |
| Original launch backups | `/Users/adil/Library/Application Support/PongLens/launcher-backups/20260911-worker-release-health/` contains the original main/fast app bundles and plists. These are emergency recovery artifacts, not the preferred fixed rollback. |
| Future rollback procedure | Create both active state's drain files; wait for fresh `drained` pulses and no active jobs; verify the rollback bundle; boot out only main/fast and the monitor; replace their explicit release and state paths with the rollback ID; start both rollback workers paused and verify identity before unpausing. Turn coverage/email off for the uninstrumented rollback and preserve all outcome records. Never point workers at the editable checkout. |
| Other work | Hand worker remains PID 13780; hand/lesson launchers and disabled match cloud were not changed. Scorekeeper source and shared scoring contracts excluded. |
| Web release | 53 processing/admin tests and full `npm run build` passed in an isolated latest-main checkout with its own dependencies and `.next`. Independent narrow-integration review approved. Publish by fast-forwarding main and pushing through Vercel Git integration, never branch `vercel --prod`. |
| Production web verification | Main `fd9e529c`, deployment `dpl_D2h6eHfZGHKcXEUz9Dkm4qtGbjp2`, READY and aliased to `www.ponglens.com`. Actual admin session shows both fixed workers idle, “Monitoring”, and no recorded attempts. Desktop and 393×660 mobile screenshots inspected; mobile document width equals 393, no horizontal overflow. No native iOS change or native test. |
| Final live check | 16:25:21 UTC: both fixed workers have fresh pulses, no paused/blocked stage, no active job, zero waiting main/fast messages, zero processing incidents. Hand PID 13780 unchanged; match cloud still disabled. First genuine upload is the remaining end-to-end observation. |
