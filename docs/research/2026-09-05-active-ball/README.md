# Active-ball pilot, September 5

Adil authorized implementation and local training, targeting a preliminary result September 6. This supersedes the earlier read-only investigation. No cloud GPUs, hired engineering team, or production model swap.

## Current state

- Work here: `/Users/adil/Desktop/Projects/PongLens/.worktrees/active-ball-release`, branch `codex/active-ball-release`, based on production commit `ca99f55a` and updated to `37e7022a` to retain subsequent lesson-viewer releases. The original checkout and first pilot worktree diverge from production; do not deploy either wholesale.
- LIVE page `https://www.ponglens.com/research/active-ball`: three adjacent frames, table polygon, source-pixel ball clicks, hidden/absent/unsure, 1/2/4× zoom, explicit save, stale-save rejection, private media. Predictions are optional and separate. Live authenticated mobile verification passed, including the research catalog link and run-2 label.
- 96 samples/288 full-resolution JPGs from locally cached owner footage. Private local manifest `/Users/adil/ponglens-data/active-ball/manifest.json`. Frame timestamps come from OpenCV decoded presentation times, not assumed `frame/fps`.
- Train: Kumar and Ishan, LYTTC. Validation: Chris A, PingPod. Test: Koko, Westchester TTC. All are owner-uploaded paths from the existing recall-lab manifests. This small sample is a bootstrap, not a representative production benchmark. Only 30fps footage so far.
- Migration `20260905193700_active_ball_research.sql` is APPLIED and registered. 96 rows in `active_ball_samples`, zero labels. R2 `ponglens-media/research/active-ball/v1/{sample-id}/{0,1,2}.jpg` uploaded. All media private.
- Original `ActiveBallNet`, random initialization: 3 RGB frames + table mask + elapsed-time context, center heatmap and visible-ball logit. No BlurBall weights/source copied. Runs on M1 Ultra MPS. Preliminary checkpoint is `/Users/adil/ponglens-data/active-ball/weak-run2/model.pt`.
- To keep moving without the Gemini key, explicit `--weak-bootstrap` uses only provisional local pixel-motion labels on the TRAIN split. 20 visible + 10 hidden selected; 18 ambiguous samples skipped. No validation or test labels generated or used. Run1 collapsed under background-dominated sigmoid error. Run2 uses conditional spatial-softmax localization and fixed 60 epochs; it outputs guesses but visibly confuses people/background objects with the ball. It predicts visible on all 96 samples: visibility is not yet useful. This is a rough bootstrap, not a validated detector.
- Default trainer still requires reviewed train/validation labels. Gemini key and permission to send own short frame sequences externally were requested asynchronously; no answer yet. Never assume permission from elapsed time. No paid API or cloud GPU spending so far.

## Commands

Interpreter: `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`. Run modules from this release worktree.

1. `python -m worker.export_active_ball_labels /Users/adil/ponglens-data/active-ball/manifest.json`
2. `python -m worker.train_active_ball /Users/adil/ponglens-data/active-ball/manifest.json /Users/adil/ponglens-data/active-ball/run3` (reviewed labels required; use explicit `--weak-bootstrap` only for provisional training)
3. `python -m worker.predict_active_ball /Users/adil/ponglens-data/active-ball/manifest.json /Users/adil/ponglens-data/active-ball/weak-run2/model.pt /Users/adil/ponglens-data/active-ball/weak-run2 --run-name local-motion-v0-run2`

Export reads the Keychain DB URL internally, never prints it, and retains separate weak labels. Human labels override weak guesses. Add a clearly recorded weak-supervision path for Gemini if authorized; do not falsely mark Gemini output human. Keep the final human test set out of training/tuning.

## Verification and remaining work

Python: 16 dataset/model/motion/training/prediction tests passed. TypeScript: 9 review/catalog tests passed. Full `npm run build` passed with existing warnings, with this worktree's own npm-ci dependencies and `.next`.

Real authenticated browser: desktop 1440×1000, mobile 393×660; images loaded, no browser errors or horizontal page overflow; unsaved navigation blocked, discard restored it; zoom centers on table. API rejects malformed coordinate400, stale revision409, anonymous403. SQL role checks deny anon, hide rows from ordinary user, allow admin. An authenticated save and revision history were exercised in a transaction and rolled back.

Screenshots and build log are in `/Users/adil/ponglens-data/active-ball`. Independent review found and verified fixes for unsaved Research-link navigation and accepting clicks before the middle frame loaded. Browser regressions exercised both fixes, with a deliberately delayed image response. Expanded training/prediction code also independently reviewed without blockers. Research page source published as `1a8e56db`; actual run-2 predictions are in all 96 database rows and human labels were not modified. Model-run display explicitly says automatic labels and accuracy not measured. Local JSON/overlays retain both failed run1 and run2. Median model-only inference is 8.56ms/frame (excludes decoding/input preparation); not an end-to-end speed claim.

Hourly automation `ponglens-preliminary-ball-model` resumes the current task. Active goal remains unfinished: a rough bootstrap is available, but reliable active-ball behavior still needs work. Do not start duplicate jobs. Next: inspect human feedback, improve label quality locally or through authorized Gemini assistance, expand training beyond 30 provisional samples, and rerun. A trained checkpoint and held-out outputs now exist; no verified accuracy or improvement over BlurBall has been established. No production worker or iOS pipeline changes.
