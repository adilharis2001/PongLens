# Combined worker release, September 14

The combined worker is installed and accepting work on main and fast, with its independent monitor healthy.
The reviewed rally rules and whole-clip cleanup remain explicit per-job options for the owner pilot; table-calibration rejection is excluded.
Scored originals are preserved, and production pilot quality still requires the owner's review.

| Item | Verified record |
| --- | --- |
| Sealed release | `44cfebbf5c7075dd7bdab39024257ec5ecf246967a009ea15ba6ad8174e0e91d` |
| Worker source | `9e19096a0e90b613ebb31ec1cc58b6b9bf24159f`, branch `codex/combined-cuts-worker`, published to the existing GitHub repository with explicit approval |
| Installed path | `/Users/adil/Library/Application Support/PongLens/match-releases/44cfebbf5c7075dd7bdab39024257ec5ecf246967a009ea15ba6ad8174e0e91d` |
| Writable state | `/Users/adil/Library/Caches/PongLens/match-runtime/44cfebbf5c7075dd7bdab39024257ec5ecf246967a009ea15ba6ad8174e0e91d` |
| Exact rollback | `b8e07c891509bf9031a56c12ea532ae4d31b990478e39845c984055dc720c988`, not the older b7 release |
| Signed backup | `/Users/adil/Library/Application Support/PongLens/launcher-backups/20260914-combined-cleanup-44cfebbf5c70` |
| Rollout evidence/scripts | `/private/tmp/ponglens-combined-rollout-20260914.dTsXpF`; preserve `activation.py`, pinned `launcher_core.py`, `rollback.py`, phase markers, smoke logs and `live-verified.json` |
| Fresh live verification | `2026-09-14T21:25:37Z`: main PID 3409, fast PID 3411, both fresh, idle and exact release; independent monitor fresh; both startup drain files absent |
| Switch safety | Both old workers freshly drained with empty queues and no jobs; checked process identities stopped under queue SHARE lock; whole signed rollback apps preserved; no active work interrupted |
| Startup note | Initial resume correctly refused stale old pulses while new workers completed startup verification. No bypass or code change; resumed only after fresh new-release pulses and monitor run. |
| Packaged checks | All eight passed: imports, native linkage, pose, table, ball, body/V3 parity, side changes and repeated side changes. Actual model inference offline; integrity rechecked afterward. Both staged lane check-only commands passed. |
| Fresh targeted suites | 130 combined/cleanup/publication/job-option tests and 25 package unit tests passed this rollout; earlier full integration evidence remains in `RECONCILIATION.md` |
| Unchanged | External model assets, runtime anchors and all 14 sealed behavior settings exactly match b8. No schema, web/iOS, hand/lesson/cloud, mail-control or global flag changes. |
| Enablement | New pilot jobs need literal `combined_cuts: true`, `whole_clip_cleanup: true`, `reviewed_net_splits: true`, `points_pipeline: bodies`; existing body serve-anchor and rally-end settings remain on. Package installation alone does not enable the new optional policies for ordinary uploads. |
| Queue status | All four new owner copies queued after live verification. At 21:32:55 UTC Yu Yu Lin was processing (ball stage, 15%); Terry, Brian and Julian were queued. Exactly one point-processing job per new copy. Full private IDs/options/receipts remain in local `plan.json` and `status.json`. |
| Julian selection | Owner explicitly selected the latest recording with owner on the far side: September 13 final recording, 616 seconds, preserving its current source and 0–616s trim. |
| Source handling | Reuse owned upload assets. Brian's existing owner-visible research match references another account's source and has no owned raw pointer; copy that exact source internally into the new owner pilot's unique storage key, then use normal claim/ledger flow. No source scores or clips replaced. |
| Rollback procedure | Use the recorded `operate.py --release <new ID>` phases `rollback-drain`, `rollback-stop`, `rollback-restore`, `rollback-start`, `rollback-resume`, separately and with checks. It restores complete signed b8 apps and monitor, and refuses active-job interruption. Do not run a historical script with its original hardcoded release IDs. |

## Owner pilot verification

| Required evidence | State |
| --- | --- |
| New jobs created only after accepting-release verification | Verified all four, literal flags true, exact new release on the first active attempt and no configuration errors. Normal claims recorded 26/16/27/11 minutes for Yu Yu Lin/Terry/Brian/Julian respectively; no duplicate claims. |
| Both optional policies applied, not merely requested | Must verify published `processing.combined_cuts.status` and `processing.whole_clip_cleanup.status` equal `used`; degraded/refused results are not successful policy verification |
| Scored originals untouched | All four point-row digests matched after enqueue. New match IDs and output paths; owner source recordings and scores not overwritten. |
| Full end-to-end speed / quality | Not yet measured on this release. Offline replay quality evidence is not a claim about these new production runs. |

| Pilot | Source/settings preserved |
| --- | --- |
| Yu Yu Lin | August 29 Westchester; original 243–1771s trim; placement on |
| Terry | Corrected-crop recording; 0–960s; placement off |
| Brian | US Nationals recording; 0–1604.919589s; placement off; verified 4,015,131,871-byte internal copy and storage ledger entry |
| Julian | Latest far-side September 13 recording; 0–616s; placement off |

| Operational follow-up | Record |
| --- | --- |
| Large source copy | Initial 30-second response deadline expired. Destination was checked before retrying the identical target; longer response deadline completed, exact length and provenance metadata verified. No partial clip or changed source was queued. |
| Future check | Run local `status.py` for read-only exact-release/settings and original-point digest checks. Review resulting clips with the owner; inspect final policy records before saying both policies actually ran successfully. |
| Email | Existing per-match ready notification behavior remains unchanged. No special rollout, outage, recovery or test email was sent. |
