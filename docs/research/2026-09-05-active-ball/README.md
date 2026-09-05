# Active-ball pilot, September 5

Adil authorized implementation and local training, targeting a preliminary result September 6. This supersedes the earlier read-only investigation. No cloud GPUs, hired engineering team, or production model swap.

## Review interface revision, September 5

User rejected the initial three-image selector as unusable. Live reproduction confirmed that Next frame selects image2 once and every later click is a no-op; adjacent images are only about33ms apart. This was a control-design fault, not evidence that the JPEGs were identical.

The replacement uses the existing research app theme and large media/side-action layout. Each example has a private2.4s source-video clip, replayed at half speed (quarter/normal also available), optional looping, and an explicit return to the exact original JPEG for labeling. Playback ends on that still automatically. Coordinates are never collected from a moving video. Save and next advances only after successful revision-checked persistence; failed saves retain the draft. Venue/review-status filters, skip-without-label, explicit discard, keyboard shortcuts and optional predictions are included. New sample state is keyed by id; mobile advancement scrolls back to the frame. Labels are unchanged by clip generation and upload.

`python scripts/research/prepare-active-ball-context.py MANIFEST OUTPUT --upload` reproduces clips from the frozen source paths/timestamps.178 clips (202,203,216 bytes) were uploaded to private `research/active-ball/v1/{id}/context.mp4`. The authenticated media route signs only that fixed per-sample path and the original validated JPEG keys. No new SQL migration or processing/model change.

Verification: full Next build passed; nine existing review/catalog tests passed. `node scripts/qa/active-ball-review.mjs` exercises actual authenticated sample/media reads and intercepts label POSTs only: replay moves, manual/automatic return uses exact still, dirty navigation disabled, save failure retains sample/mark, successful save advances and clears previous label, mobile advancement restores frame visibility. Screenshots at1440×1000 and393×660 were inspected. QA does not write labels. Independent review identified the mobile scroll issue and it was fixed.

## Preliminary delivery: run 4

The user requested a reviewable preliminary model, allowing poor initial accuracy. That scope is delivered with the run-4 checkpoint and research batch; reliable production tracking remains unproven. Do not silently expand the completion requirement to production accuracy.

- Own random-initialized native-resolution patch classifier: `worker/active_ball_patches.py`, training and inference in the adjacent `train_active_ball_patches.py` / `predict_active_ball_patches.py`. Three native RGB patches plus soft table-relative geometry and measured frame spacing. Pixel motion proposes candidates; the network scores them and can abstain. No BlurBall code or weights. No hard table crop in inference. This is candidate detection, not a completed rally-level identity tracker.
- All training ran on Mac Studio M1 Ultra MPS. Checkpoint: `/Users/adil/ponglens-data/active-ball/patch-run4/model.pt`, SHA256 `11d9046bf098496b517968244e7fd13c2a98d534e66845127ef278c7db6b7435`. Fixed 50 epochs; threshold 0.7, ambiguity margin 0.1 selected before viewing held-out outputs.
- 22 unique training source frames from Kumar and Ishan at LYTTC: 16 assistant-checked moving balls, six held-ball/no-active-ball frames. They produce 384 jittered positive crops and 1,089 negative candidate crops. Augmentations are not additional independent observations. Provenance is explicitly `assistant_visual_v1`, not human gold labels. Native triptychs and full scenes were inspected locally; one uncertain frame was excluded.
- Training-only proposal discovery yielded 356 provisional motion tracks, then 23 clear-table candidates; the assistant retained 22. Manifests and curation audit are local: `motion-v1-manifest.json`, `motion-v1-clear-manifest.json`, `curated-v1-manifest.json`, `curated-v1-audit.json`. Early automatic proposals frequently marked logos/watches. The older run2 training labels are not trustworthy gold.
- Held-out data: 60 additional later-in-point frames, 30 PingPod and 30 Westchester. Entire matches and venues excluded from training. Only 30fps footage covered. Run4 emits 10 visible, 46 unlocated, four ambiguous. These are counts, not accuracy. Visual inspection confirms some real ball detections, including serves, but also shirt details and neighbouring-table balls. Abstention does not prove absence or occlusion. Human-independent accuracy, recall, identity switches, and improvement over BlurBall are NOT measured.
- Inference median 62.4ms per held-out frame including three JPEG decodes and candidate generation; excludes video extraction and whole-pipeline processing. This is not a production throughput claim.
- Review database now has 178 rows and 534 private JPEGs: original96 + curated22 + heldout60. Every row has run4 predictions, no human labels changed. Newest batches appear first. UI distinguishes training matches/unseen venues and explains abstentions. Authenticated page: https://www.ponglens.com/research/active-ball.
- Full combined manifest: `/Users/adil/ponglens-data/active-ball/review-manifest.json`. Checkpoint, predictions, summaries and overlays are retained locally under `patch-run4/{training,original,heldout}`; old failed runs retained for comparison. Training labels are independent of optional displayed predictions.
- Gemini key/upload permission remain pending. No external model uploads, paid API calls or cloud GPUs used. Production worker/iOS processing unchanged.

### Reproduce and use feedback

From this release worktree, with `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python`:

```sh
python -m worker.export_active_ball_labels /Users/adil/ponglens-data/active-ball/review-manifest.json
python -m worker.train_active_ball_patches /Users/adil/ponglens-data/active-ball/curated-v1-manifest.json /Users/adil/ponglens-data/active-ball/patch-new --allow-assistant-labels --epochs 50
python -m worker.predict_active_ball_patches /Users/adil/ponglens-data/active-ball/rally-heldout-manifest.json /Users/adil/ponglens-data/active-ball/patch-run4/model.pt /Users/adil/ponglens-data/active-ball/patch-repeat --run-name run4-repeat
```

For training from newly saved user feedback, pass the exported review manifest instead of the frozen curated manifest; omit `--allow-assistant-labels` to use only human-reviewed training rows. Validation/test rows are never training input. Human labels override provisional labels. Keep test feedback separate from training/tuning; this initial test batch has now been visually inspected and is no longer an untouched final benchmark.

### Verification

25 Python dataset/model/motion/training/prediction tests pass. Nine TypeScript review/catalog tests pass. Full `npm run build` passed (log `/Users/adil/ponglens-data/active-ball/build-run4.log`). No pytest is installed; tests use unittest. Private R2 upload completed, database count178 and preserved human labels checked transactionally. Earlier authenticated save/history, stale409, invalid400, anonymous403 and ordinary-user isolation checks passed; no fake human labels were left.

## Earlier runs (historical)

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

The initial hourly follow-up was scoped to preliminary delivery. Stop it after live run4 verification; further training should consume actual user feedback or an explicitly authorized next experiment. Do not launch duplicate jobs or claim production readiness.
