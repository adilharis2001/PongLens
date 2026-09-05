# Active-ball pilot, September 5

Adil authorized implementation and local training, targeting a preliminary result September 6. This supersedes the earlier read-only investigation. No cloud GPUs, hired engineering team, or production model swap.

## Current state

- Work here: `/Users/adil/Desktop/Projects/PongLens/.worktrees/active-ball-release`, branch `codex/active-ball-release`, based on production commit `ca99f55a` and updated to `37e7022a` to retain subsequent lesson-viewer releases. The original checkout and first pilot worktree diverge from production; do not deploy either wholesale.
- New page `/research/active-ball`: three adjacent frames, table polygon, source-pixel ball clicks, hidden/absent/unsure, 1/2/4× zoom, explicit save, stale-save rejection, private media. Predictions are optional and separate. No trained predictions exist yet.
- 96 samples/288 full-resolution JPGs from locally cached owner footage. Private local manifest `/Users/adil/ponglens-data/active-ball/manifest.json`. Frame timestamps come from OpenCV decoded presentation times, not assumed `frame/fps`.
- Train: Kumar and Ishan, LYTTC. Validation: Chris A, PingPod. Test: Koko, Westchester TTC. All are owner-uploaded paths from the existing recall-lab manifests. This small sample is a bootstrap, not a representative production benchmark. Only 30fps footage so far.
- Migration `20260905193700_active_ball_research.sql` is APPLIED and registered. 96 rows in `active_ball_samples`, zero labels. R2 `ponglens-media/research/active-ball/v1/{sample-id}/{0,1,2}.jpg` uploaded. All media private.
- Original `ActiveBallNet`, random initialization: 3 RGB frames + table mask + elapsed-time context, center heatmap and visible-ball logit. No BlurBall weights/source copied. Forward/backward runs on M1 Ultra MPS; three real-frame checks took 2.125 seconds. This is an execution check, not training or accuracy.
- Trainer deliberately refuses zero reviewed labels. No checkpoint yet. Gemini key and permission to send own short frame sequences externally were requested asynchronously; no answer yet. Never assume permission from elapsed time.

## Commands

Interpreter: `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`. Run modules from this release worktree.

1. `python -m worker.export_active_ball_labels /Users/adil/ponglens-data/active-ball/manifest.json`
2. `python -m worker.train_active_ball /Users/adil/ponglens-data/active-ball/manifest.json /Users/adil/ponglens-data/active-ball/run1`

Export reads the Keychain DB URL internally, never prints it. Trainer currently accepts human labels only, and requires training and validation labels. Add a clearly recorded weak-supervision path for Gemini if authorized; do not falsely mark Gemini output human. Keep the final human test set out of training/tuning.

## Verification and remaining work

Python: 8 dataset/model tests passed. TypeScript: 9 review/catalog tests passed. Full `npm run build` passed with existing warnings, with this worktree's own npm-ci dependencies and `.next`.

Real authenticated browser: desktop 1440×1000, mobile 393×660; images loaded, no browser errors or horizontal page overflow; unsaved navigation blocked, discard restored it; zoom centers on table. API rejects malformed coordinate400, stale revision409, anonymous403. SQL role checks deny anon, hide rows from ordinary user, allow admin. An authenticated save and revision history were exercised in a transaction and rolled back.

Screenshots and build log are in `/Users/adil/ponglens-data/active-ball`. Local production server port3047 is only for QA; stop/restart it before rebuilding. Independent review found and verified fixes for unsaved Research-link navigation and accepting clicks before the middle frame loaded. Browser regressions exercised both fixes, with a deliberately delayed image response. Publishing and actual training/evaluation still remain. Confirm live production still points at the expected base before promoting anything.

Hourly automation `ponglens-preliminary-ball-model` resumes the current task. Active goal remains unfinished. Do not start duplicate jobs. Future work: finish review/deploy, obtain trustworthy small labels or authorized Gemini assistance, train, implement held-out inference/metrics and publish actual prediction overlays. Do not call preliminary model complete merely because the page is live.
