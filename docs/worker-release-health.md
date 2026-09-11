# Worker release and body-processing health

This work isolates the Mac main/fast worker from the editable checkout and records body-processing health separately from delivery of usable video. The implementation is staged on `codex/worker-release-health`; production has not been switched and the operational migration has not been applied. Read this record before changing launchers, runtime dependencies or body fallback reporting.

## Status and ownership

| Item | Current fact |
| --- | --- |
| Implementation checkout | `/Users/adil/Desktop/Projects/PongLens/.worktrees/worker-release-health` |
| Captured production baseline | `f4156c96`; captured current root worker while root HEAD was `b425494c`. Baseline differences from origin/main are pre-existing runtime work, not this task's fixes. |
| New release package | `77317f94`, `617381a2`, `e6e85766`, `223d2399`, with later loader-hardening verification pending final commit. |
| Outcome integration | `c6a9fb29`, with reviewed retry/terminal-coverage fixes in `0d2f810b`. Both scoped reviews approved; final whole-change review remains. |
| Root checkout | Remains live and editable until explicit verified activation; no source edits by this task. Documentation notice only. |
| Other tasks | Scorekeeper work is excluded. Do not change scoring helpers, point timing, shared score state, hand-cut or lesson launchers. |
| Cloud | Match Modal remains disabled. These local release IDs are not the historical `pipeline_releases`/parity identities; do not set processing_control.active_release_id to them. |
| Web | Previewed existing admin rows on desktop and 393×660 mobile. Screenshot approval requested, not yet received. No native iOS change. |

## Fixed-release contract

| Boundary | Rule for every future chat |
| --- | --- |
| Source | Build only from an explicit committed worker snapshot. Both parent daemon and fresh children resolve the same content-addressed directory. Never point a launcher back at a developer checkout. |
| Assets | The payload includes body models, features, V3 data, pose/detector weights, table source/weights/hub source and BlurBall source/weights. |
| Dependencies | Python environments and native libraries are currently external verified anchors, not relocated independent installations. Do not update pip/Homebrew/yt-dlp/OS in place while an active release depends on them. Prepare separately located runtimes for independently upgradable releases. |
| Identity | Full payload/model/runtime/behavior manifest hash; git HEAD alone is not evidence of the running code. Unsealed execution says `unsealed`. |
| Claims | Verify before accepting a job and in each Python child. Drift prevents new work; it must never be silently accepted as the same release. |
| Environment | Audited processing defaults are part of the manifest. Credentials remain outside it. Runtime data settings still come from the permitted per-job/app_config switches. |
| Mutable state | Logs, temporary media, outcome retry spool and generated caches stay outside payload. Python bytecode and CoreML start with fresh launch directories. |
| Table model | Sixteen frames; local sealed backbone; no redundant ImageNet download before loading the full trained table checkpoint. No change to final model weights or frame policy. |
| Limits | Integrity detection is not protection against an administrator rewriting code and manifest, nor a lock preventing a dependency from changing midway through an existing call. |
| Commands | `worker/match_release/README.md` documents build, verify, stage and check-only commands. Never activate an old temporary bundle merely because it has a release ID. |

## Outcome contract

| Fact | Meaning |
| --- | --- |
| Attempt key | Existing `job_id:read_ct`, shared with cost reporting. A queue retry gets a different key. |
| Start | After input gates and before ball/pose work, freeze pipeline and edge-switch choices and record the attempt. Gate refusals and library-only imports do not claim body processing happened. |
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
| Email | Defaults off; uses durable lease, stable incident idempotency key, existing approved renderer/sender/suppression checks and admin recipient only. No test email has been sent. |
| Activation timestamp | `worker_processing_health_control.expected_after` stays null until real rollout. Historic uninstrumented jobs are not newly failing jobs. |
| Admin read | Additive `admin_processing_health()` RPC; existing overview, scorekeeper and job-completion contracts remain unchanged. |

## Verification evidence

| Check | Result |
| --- | --- |
| Source isolation/integrity | 18 tests pass, including source edits, new/missing files, runtime edits, symlink retarget, native dependency omissions, inherited settings and loader overrides. |
| Outcome/fallback/database/boundary tests | 40 passed in 0.97s, including 15 real PostgreSQL cases. Original cards preserved through failed pose and partially written second pass. Drain and integrity pauses clear before resumed idle polling. |
| Frozen bodies/V3 | Packaged tests: 16 passed, three existing missing-sample numpy warnings, 128.28 seconds. No frozen feature changes to suppress warnings. |
| Body edge/table fitting | 41 tests passed. |
| Actual staged smoke | Source `c6a9fb29`, release `5d40fbd5374f78dc796e6648d7f9a783cc05e4618efde77924e8e10b535c4205`; inspected using reviewed `ponglens-match-release-inputs-round1.json`. This is a test bundle, not yet the final activation candidate. |
| Imports | Packaged worker imported with existing Keychain access without starting main or touching queue; fixed paths and release identity asserted. |
| Pose | Saved Prabhas clip, 2 seconds, 20 samples, actual `coreml` provider. Sandbox-only attempt failed on blocked system interfaces; normal Mac execution passed. |
| Table | Same saved clip: all 16 frames agreed; 0.48px spread. Payload verification after inference passed. |
| Loaded native libraries | Actual imports audited in all four interpreters: worker 42, pipeline 181, pose 126, table 150 non-system loaded images, all inside verified anchors. This checks the exercised imports, not every hypothetical future plug-in. |
| Smoke artifacts | `/private/tmp/ponglens-release-smoke-c6a9/`; script `worker/tests/smoke_match_release.py`. |
| Database | Isolated PostgreSQL migration, RLS, permissions, final/start idempotency, missing-final retries, out-of-order spool delivery, incident recovery and notification lease/retry checks passed. Actual mail renderer exercised; sender mocked, no emails sent. |
| Admin rendering | Success/refusal/problem/unknown/failure/running/empty/unavailable/paused/blocked/recovery/telemetry and monitor states rendered on desktop and 393×660 mobile, using actual components with temporary sample data. Temporary preview route removed; no production data was written. 40 view tests pass. |
| Web build | Real `npm run build` passed with own lockfile-installed dependencies and isolated `.next`; pre-existing lint/build warnings remain. Shared node_modules symlink initially broke lint and was replaced only in this worktree. |
| Not yet verified | Final reviewed bundle, complete live activation/rollback, first real live processing outcome, web publication. |

## Rollout gates

| Order | Required evidence |
| --- | --- |
| 1 | Complete monitor review fixes and independent review; record the exact final implementation commit. |
| 2 | Rebuild using reviewed native-link/behavior inputs; verify final bundle and retain an explicit verified rollback target. |
| 3 | Recheck root worker files and running process/queue state; do not discard newer work from another chat. |
| 4 | Validate and apply only the additive operational migration, with email/activation timestamp still off until switch. |
| 5 | Drain main and fast at job boundaries before switching exact launch paths. Existing legacy launchers have no drain flag, so the first switch needs a separately verified safe handoff. Do not kill active jobs. |
| 6 | Install independent monitor and verify release pulse identity; turn on coverage only at actual activation. Keep hand/lesson/cloud unchanged. |
| 7 | Publish admin UI only after screenshot approval, then confirm the first real point-processing attempt. Do not create fake production jobs to manufacture evidence. |
| Integration | Do not merge the captured baseline wholesale over newer main. Keep release source authority distinct from narrowly integrating the new admin/operational changes. |
