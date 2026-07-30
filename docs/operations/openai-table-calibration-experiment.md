# OpenAI table-calibration experiment

This evaluation tests whether three still frames can recover table corners
when the color-based calibrator fails, then runs the existing RTMPose
structure extractor against the accepted calibration.

It is not a production backfill. The commands use production `SELECT` and R2
download paths but never call database updates, R2 uploads, retry enqueueing,
score writes, or feature flags.

## Sample

- Vaibhav: `5721edd0-a80e-4eb8-a605-a6d3c8dbe41f`
- Tripp: `cb0e7027-c41d-41d3-8984-7e15fddbeb88`
- Control: the newest retained match whose RTMPose structure status is ready

Raw-upload retention must still cover all three matches.

## Requirements

The normal worker Keychain entries provide Postgres, R2, and OpenAI access.
RTMPose uses:

```text
/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python
/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
```

OpenAI receives only three extracted JPEGs. The Responses API request uses
`store: false` and contains no match ID, names, scores, filenames, or account
data.

## 1. Prepare local cases

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/materialize_table_calibration_cases.py prepare \
  --output-dir \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729
```

This downloads the retained source, point clips, and match JSON, runs BlurBall
locally, selects three representative frames, records their hashes, and writes
`references.template.json`. It does not read the OpenAI key or call an AI
provider.

## 2. Record reference corners

Before viewing any new OpenAI proposal, inspect the prepared images and copy
`references.template.json` to `references.json`. For every case, replace
`corners: null` with:

```json
{
  "A_near_1": [0, 0],
  "B_near_2": [0, 0],
  "C_far_2": [0, 0],
  "D_far_1": [0, 0]
}
```

Coordinates use the prepared image dimensions, not the original video
dimensions. The labels form one cyclic polygon: the camera-facing near end,
the far end, then back to the start.

Validate without provider access:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/run_openai_table_calibration_experiment.py \
  validate-references \
  --cases \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/cases.json \
  --references \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/references.json
```

## 3. Run nine provider trials

Load the existing Keychain value into the subprocess environment without
printing it:

```bash
OPENAI_API_KEY="$(security find-generic-password \
  -a openclaw -s openai-api-key -w)" \
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/run_openai_table_calibration_experiment.py run \
  --cases \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/cases.json \
  --references \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/references.json \
  --output \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/experiment-results.json
```

The runner makes exactly three requests per match. It records proposal
stability, generic local validation, reference error, returned token usage,
latency, and price using the database rate snapshot captured during
preparation.

## 4. Run RTMPose and render

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_table_calibration_experiment.py \
  --experiment-root \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729 \
  --run-rtmpose \
  --rtmpose-python \
  /Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python \
  --rtmpose-model \
  /Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
```

RTMPose runs only when calibration passed repeatability, local validation, and
the final consensus validation. It reads a local copy of `match.json`; the
downloaded original remains untouched.

Serve and side-swap failure after a successful calibration is reported as an
RTMPose-stage result, not a calibration failure.

## 5. Review

```bash
/usr/bin/python3 -m http.server 8770 \
  --directory \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/report
```

Open `http://127.0.0.1:8770/`. The report data excludes provider response IDs,
credentials, R2 URIs, and identity fields.

## Cleanup

The complete experiment directory contains private match media. Delete it
after review or when it is no longer needed. Nothing under
`PongLens-Reports/openai-table-calibration-20260729` belongs in Git.
