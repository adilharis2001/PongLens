# Fixed Mac worker releases

Build and stage a fixed worker bundle without changing the running worker.
The bundle contains committed worker source, both frozen body models, BlurBall code and weights, table detector code and weights, RTMPose weights, and the committed CoreML helper.
Python environments and native libraries stay at their existing locations, with their contents checked before startup, before each claim, and in each Python child.

| Boundary | Contract |
| --- | --- |
| Build source | An explicit Git commit; checkout edits and untracked files cannot enter the worker payload. External assets are inventoried before and after copying. |
| Identity | SHA-256 of canonical manifest excluding `release_id`; manifest seals every payload file and runtime anchor. No timestamp in the identity. |
| External code | BlurBall and table trees copied, excluding Git history, bytecode caches and Finder metadata. The BlurBall wrapper's one hardcoded repository assignment is replaced with its sealed environment path; original wrapper hash is recorded. |
| Runtime | Existing Python environment, base interpreter, package files, Homebrew dependency trees and macOS build. Symlink targets are checked too. Package names and versions are recorded by local inspection. |
| Live updates | Do not run pip, Homebrew upgrades, OS updates or yt-dlp self-update while a release uses those anchors. Create separately located runtimes for future independently upgradable releases. |
| Verification | First use in each process hashes everything. Subsequent checks compare file inventories including inode, ctime, mtime and size; changes trigger complete content comparison. Cache is process-local, never trusted from disk. |
| Caches | Work/logs/CoreML/temp caches outside payload. Python gets a fresh empty bytecode prefix and cannot write bytecode. Table torchhub source remains inside payload; table loader must use existing local hub code without network refresh. |
| Trust | Integrity checks detect accidental drift; they are not signatures, sandboxing, or protection against an attacker who can rewrite both the runner and its manifest. No filesystem lock can prevent an administrator editing an active dependency mid-call. |
| Scope | Server-side Mac bundle only. Never distribute table detector assets to players; never upload this bundle to Modal. |

## Prepare on this Mac

| Step | Result |
| --- | --- |
| Commit implementation in the isolated release branch | Build includes the path adapters and health reporting, not just captured baseline `f4156c96`. |
| Inspect paths | Generates local JSON build inputs with interpreter/package identities and native dependencies. |
| Review JSON | `body_model` must match the accepted frozen version. Paths must point to the intended runtime environments. |
| Build and verify | Produces `<output>/<64-character-release-id>/manifest.json`. Never writes `current`. |
| Stage | Copies and re-verifies into an install directory; leaves launchd and existing aliases untouched. |
| Check only | Resolves exact paths, verifies, creates empty runtime directories, and prints the worker command without running it. |

```sh
python3 -m worker.match_release inspect-local \
  --repo /Users/adil/Desktop/Projects/PongLens/.worktrees/worker-release-health \
  --output /private/tmp/ponglens-match-release-inputs.json

python3 -m worker.match_release build \
  --repo /Users/adil/Desktop/Projects/PongLens/.worktrees/worker-release-health \
  --commit HEAD \
  --config /private/tmp/ponglens-match-release-inputs.json \
  --output /private/tmp/ponglens-match-releases

# Replace RELEASE_ID with the exact ID printed by build.
python3 -m worker.match_release verify /private/tmp/ponglens-match-releases/RELEASE_ID \
  --expected-id RELEASE_ID

python3 -m worker.match_release stage /private/tmp/ponglens-match-releases/RELEASE_ID \
  --destination /Users/adil/Library/Application\ Support/PongLens/match-releases

python3 -m worker.match_release run \
  /Users/adil/Library/Application\ Support/PongLens/match-releases/RELEASE_ID \
  --state /Users/adil/Library/Caches/PongLens/match-runtime/RELEASE_ID \
  --lane main --check-only
```

## Required verification and release handoff

| Check | Evidence required before activation |
| --- | --- |
| Integrity | `python3 -m unittest worker.tests.test_match_release` |
| Actual pose | Use `prepare_run` environment and its `PONGLENS_RTMPOSE_PY` to run sealed `worker/extract_players_rtmpose.py` against a known short clip with sealed pose and detector models. Confirm actual provider and output. |
| Point parity | Run packaged points assembly on representative frozen input; compare card decisions with captured baseline. |
| Both lanes | `run ... --lane main --check-only` and `--lane fast --check-only`; confirm separate drain files and appropriate logs. |
| Rollback | Record and verify an explicit previous release directory and its runtime anchors before changing either launcher. This package does not select a rollback for you. |
| Activation | Owner drains current work and switches both approved launchers to the exact verified directory. `run` without `--check-only` executes the worker and may claim real work. |
| Post-switch | Confirm release/model IDs in actual attempt records and health reporting; preserve the previous verified directory. |

## Runtime adapter map

| Environment | Meaning |
| --- | --- |
| `PONGLENS_MATCH_RELEASE` | Resolved release directory, **not** manifest path. Manifest is `manifest.json` beneath it. |
| `PONGLENS_RELEASE_ID` | Manifest content hash. |
| `PONGLENS_BODY_MODEL` | Frozen version such as `v2`, **not** a filesystem path. |
| `PONGLENS_WORKER_PY`, `PONGLENS_PIPELINE_PY` | Exact checked interpreters; preserve venv executable spelling. |
| `PONGLENS_BLURBALL_INFER`, `PONGLENS_BLURBALL_HOME` | Copied wrapper and detector tree. |
| `PONGLENS_RTMPOSE_PY`, `PONGLENS_RTMPOSE_MODEL`, `PONGLENS_RTMPOSE_DET_MODEL`, `DET_MODEL` | Pose interpreter and copied model files; no model URL fallback. |
| `PONGLENS_TABLE_KEYPOINT_HOME`, `PONGLENS_TABLE_KEYPOINT_PY`, `TORCH_HOME` | Copied table assets, checked interpreter, sealed hub seed. |
| `PONGLENS_FFMPEG`, `PONGLENS_FFPROBE`, `PONGLENS_YTDLP` | Exact checked media executables. PATH contains sealed wrappers ahead of system tools. |
| `PONGLENS_STATE_DIR`, `PONGLENS_WORK_DIR`, `PONGLENS_LOG_DIR`, `PONGLENS_COREML_CACHE` | Writable state outside payload; worker adapters must honor these. |
| `PONGLENS_DRAIN_FILE` | `<state>/drain-main` or `<state>/drain-fast`; checked before a new claim by worker integration. |

```python
from worker.match_release import prepare_run, verify_unchanged

# Worker integration: call before each queue claim; failure prevents claiming.
verify_unchanged(release_directory)

# Smoke-test integration: use this environment and cwd for every sealed child.
command, env, cwd = prepare_run(release_directory, state_directory)
```
