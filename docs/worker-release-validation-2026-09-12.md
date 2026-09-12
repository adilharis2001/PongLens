# Worker release validation, 2026-09-12

The offline candidate was built from the deployed worker baseline plus the committed camera-check and processing-telemetry changes. Its pinned runtimes, behavior settings and body model match the active corrected release. The candidate passed the sealed model, parity and integrity gates and was copied to the established content-addressed release directory; it was not activated or connected to production.

| Item | Verified value |
| --- | --- |
| Source commit | `f8fa33098e9ec833fe92dfd3f8bf24244d93663e` |
| Candidate release | `b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef` |
| Staged path | `/Users/adil/Library/Application Support/PongLens/match-releases/b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef` |
| Build inputs | Reviewed `ponglens-match-release-inputs-round1.json` |
| Active corrected release | `beb02a6c1002577ec521d2dce12916cdd9f8cbba3dbd640ea7dec7014c3bcf9b` |
| Manifest | 1,534 files; final full verification passed after inference |
| Runtime and behavior | Runtime anchors, 14 behavior settings and body model are equal to the active release manifest |
| Payload delta | Exactly the nine files committed by `f8fa3309`: camera check, telemetry, their tests, release allowlist/test, and `worker.py` |
| Activation | Staged and reverified only; neither launcher changed; no worker started |

## Offline evidence

| Gate | Result |
| --- | --- |
| Release tests | 25 passed |
| Worker regression set | 109 passed: camera, telemetry, worker, claim boundary, outcome and health |
| Import-only smoke | Passed with inert configuration; fixed source, interpreter and media-tool identities verified |
| Loaded native images | Worker 42, pipeline 181, RTMPose 126, table 150 external images checked against sealed anchors |
| Pose | 20 samples; CoreML provider |
| Table | 16/16 frames kept; agreement 1.0; spread 0.4825 px |
| Ball | 12 frame records |
| Side changes | Passed twice against the same external state; 14/14 frames decoded and 2/2 clips qualified each run; packaged detector SHA-256 `4f4d7e07350b1753299111d1ae500fd64447a5b0e38e4bacbefab6573c742d30`; result correctly withheld on this clip |
| Camera-check CLI | Ran from the sealed payload on 12 real frames; returned `stable` with bounded reason `dominant_static_background` |
| Frozen point parity | 16 passed; the same three existing NumPy missing-sample warnings as the active release |
| Lanes | Main and fast `--check-only` both resolved the candidate and separate external state; status `verified, not started` |
| Rollback | Active corrected release `beb02a6c…` also passed a fresh full verification |
| App contracts | 19 web processing/job-selection tests and 1,114 native pure checks passed |

The first sandboxed pose run reached the sealed models but CoreML failed at the restricted IOSurface boundary with model-plan error `-6`; the same smoke passed with normal local accelerator access. The first import-only run could not read `DATABASE_URL` from Keychain inside the sandbox. It then passed with inert values, so no credential was read and the smoke remained offline.

## Commands

```sh
python3 -m worker.match_release build \
  --repo /Users/adil/Desktop/Projects/PongLens/.worktrees/upload-feedback-worker \
  --commit f8fa33098e9ec833fe92dfd3f8bf24244d93663e \
  --config /private/tmp/ponglens-match-release-inputs-round1.json \
  --output /private/tmp/ponglens-upload-feedback-release-f8fa

python3 -m worker.match_release verify \
  /private/tmp/ponglens-upload-feedback-release-f8fa/b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef \
  --expected-id b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef

python3 -m worker.match_release stage \
  /private/tmp/ponglens-upload-feedback-release-f8fa/b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef \
  --destination '/Users/adil/Library/Application Support/PongLens/match-releases'

python3 -m worker.match_release verify \
  '/Users/adil/Library/Application Support/PongLens/match-releases/b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef' \
  --expected-id b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef

python3 -m unittest worker.tests.test_match_release

python3 worker/tests/smoke_match_release.py \
  --release /private/tmp/ponglens-upload-feedback-release-f8fa/b4c33be2d1f573e67a32e56e3c56cdad7f6d059712f8dd99bfe187fc5af62eef \
  --state /private/tmp/ponglens-upload-feedback-smoke/MODE \
  --video LOCAL_TEST_CLIP \
  --mode MODE

python3 -m worker.match_release run CANDIDATE \
  --state /private/tmp/ponglens-upload-feedback-smoke/lane-main \
  --lane main --check-only

python3 -m worker.match_release run CANDIDATE \
  --state /private/tmp/ponglens-upload-feedback-smoke/lane-fast \
  --lane fast --check-only
```

The smoke modes run were `imports`, `native`, `pose`, `table`, `ball`, `side-changes` twice, and `parity`. Detailed machine-readable output is at `/private/tmp/ponglens-upload-feedback-smoke/release-evidence.json` for the life of this host's temporary directory.

## Integration boundary

This candidate deliberately remains on the exact deployed `6ec6ea19` lineage. Newer main has versioned `MatchProcessingDestination` candidate publication and does not contain the sealed-release and processing-health modules from this worker line. The app branch carries a separately tested semantic port of the camera and telemetry behavior at its claim, profile, stage, publication, failure and release boundaries; merging this worker branch wholesale would remove candidate-processing behavior, while replacing it with newer `worker.py` would remove the tested sealed baseline.
