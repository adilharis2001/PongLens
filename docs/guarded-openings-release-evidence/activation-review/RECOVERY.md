The activation helper now refuses incomplete preparation and verifies saved signatures before any drain. Recovery restores both complete original signed apps and all three original plists, then starts the combined release paused. These helpers passed 20 isolated checks; no production operation or real macOS permission recovery was performed by this reviewer.

| Item | Exact value |
| --- | --- |
| Candidate | `caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92` |
| Rollback | `7bc22c834fd237f866cc957fc17967524c43aa469d31e3e812854b0c59697576` |
| Activation helper SHA-256 | `d9dbba619b5185bbe1838efe9e3a385a10c9650e3d27f6f414ac6f3ec6dbe0c4` |
| Rollback helper SHA-256 | `958de32a0c01294d11e04f5139ae4e9d49218f99f5ecf0a94d954506fe547a3e` |
| Imported original recipe SHA-256 | `eb4d6a4af4071fe10e0f5142d06f6ef9b6111fb4d13ade2d094725ce2fb84e32` |
| Saved original apps/plists | `/Users/adil/Library/Application Support/PongLens/launcher-backups/20260912-guarded-caeb69ce8163/` |
| Phase evidence | `/private/tmp/ponglens-guarded-launchers-caeb69ce8163/` |
| Python | `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -B` |

| Recovery phase | Executable command suffix | What it must prove |
| --- | --- | --- |
| 1. Pause | `/private/tmp/ponglens-guarded-release/rollback.py drain --release caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92` | Original stop completed; complete preparation fingerprints and rollback payload still verify; no old media worker is already running. Candidate work may finish. |
| 2. Stop | `/private/tmp/ponglens-guarded-release/rollback.py stop --release caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92` | Both states paused. Main/fast queue locks held. Every real candidate media worker has a fresh job-free drained pulse and no children. If startup never reached worker.py, only exact applet trees and candidate bootstrap descendants qualify. Detached or unknown candidate processes refuse. PID birth time/command checked immediately before each signal. |
| 3. Restore | `/private/tmp/ponglens-guarded-release/rollback.py restore --release caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92` | All checked processes exited and launchers unloaded. Preserve failed candidate apps/plists in `failed-candidate`, copy both whole signed originals and all three plists, verify signatures and fingerprints. No re-signing. |
| 4. Start paused | `/private/tmp/ponglens-guarded-release/rollback.py start --release caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92` | Completed restore marker, exact restored files, no candidate processes/loaded labels, old drain files present. |
| 5. Resume | `/private/tmp/ponglens-guarded-release/rollback.py resume --release caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92` | Both actual old worker PIDs have fresh exact old-ID drained pulses dated after rollback startup; no worker children; monitor completed after startup and remains fresh. Only old drain files removed. |

| Failure / restriction | Required response |
| --- | --- |
| Any refusal | Stop that phase; inspect the stated evidence. Never manufacture phase markers or remove drain files manually to force progress. |
| Partial restore | Start remains blocked. Preserve `failed-candidate` and original backups; inspect exact file state before writing a separate recovery correction. Do not rerun restore blindly. |
| Repeated phase invocation | Existing markers or saved bundles refuse repeated destructive work. Do not delete markers to retry. |
| TCC failure again | No Full Disk Access, no TCC reset, no foreground bypass, no new signature. Original signed backups are the recovery artifact. |
| Scope | Hand/lesson/cloud, queues, processing history, health preferences, scored matches and runtime dependencies unchanged. |
| Tests | `python3 -B /private/tmp/ponglens-guarded-release/review-activation/check_gates.py` and `python3 -B /private/tmp/ponglens-guarded-release/review-activation/check_rollback.py` |
| Not tested | Actual launchctl exit behavior, real signature/TCC restoration, a live rollback flip, any candidate model smoke/export gate. Those are not established by mocked process/database checks. |
