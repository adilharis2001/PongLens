# Multimodal Serve-Detection Experiment

This experiment is local and read-only. It never imports user-entered server
answers, winners, scores, names, or emails into model inputs or reports, and it
has no production database, R2, match, point, or feature-flag write path.

## Run locally

Use the TTVid research virtual environment:

```bash
PYTHON=/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python
TABLE_ROOT=/Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729
SERVE_ROOT=/Users/adil/Desktop/PongLens-Reports/serve-detection-20260730

"$PYTHON" worker/eval/materialize_serve_detection_cases.py \
  --table-root "$TABLE_ROOT" \
  --output "$SERVE_ROOT"

"$PYTHON" worker/eval/run_serve_detection_experiment.py \
  --cases "$SERVE_ROOT/serve-cases.json" \
  --run-id serve-dev-v1 \
  --output "$SERVE_ROOT/serve-results-serve-dev-v1.json"

"$PYTHON" worker/eval/render_serve_detection_experiment.py \
  --root "$SERVE_ROOT" \
  --results "$SERVE_ROOT/serve-results-serve-dev-v1.json"

"$PYTHON" -m http.server 8771 --directory "$SERVE_ROOT/report"
```

Open `http://127.0.0.1:8771/`. Labels persist in browser local storage.
`Export references` downloads `serve-references.json`.

## Score a labeled run

```bash
"$PYTHON" worker/eval/score_serve_detection_experiment.py \
  --results "$SERVE_ROOT/serve-results-serve-dev-v1.json" \
  --references /path/to/serve-references.json \
  --output "$SERVE_ROOT/serve-scores-serve-dev-v1.json"

"$PYTHON" worker/eval/render_serve_detection_experiment.py \
  --root "$SERVE_ROOT" \
  --results "$SERVE_ROOT/serve-results-serve-dev-v1.json" \
  --scores "$SERVE_ROOT/serve-scores-serve-dev-v1.json"
```

Do not tune thresholds after opening reference labels. Make a new run ID and
record any threshold change before scoring.

## Optional OpenAI vision referee

The referee is deliberately not part of the default run. It accepts only local
`needs_review` candidates, sends at most two anonymous storyboards and twelve
JPEG frames, uses `store: false`, and returns to the local abstention on any
provider failure. It cannot override a hard geometry contradiction.

Provider calls must be explicitly enabled by an experiment command and supplied
an API key at runtime. Never place an API key in a manifest or report. Usage
metadata retains token counts and model name, not provider response IDs.

## Outputs

- `serve-cases.json`: anonymous immutable case manifest.
- `serve-input-lock.json`: hashes that reject later input mutation.
- `references.template.json`: prediction-blind labeling template.
- `serve-results-<run>.json`: append-only ablation output and dependency ledger.
- `serve-scores-<run>.json`: precision, coverage, confidence intervals, and gates.
- `report/index.html`: static review UI.
- `report/report-data.json`: anonymous, privacy-filtered display data.
- `report/assets/`: hardlinked or copied anonymous point clips.

## Licensing and compute

The deterministic arms use Python (PSF-2.0), NumPy (BSD-3-Clause), OpenCV
(Apache-2.0), SciPy (BSD-3-Clause), and FFmpeg under the locally installed
build's license. Motion inference stays unavailable unless an Apache-2.0
RTMDet checkpoint has an explicit source URL and SHA-256 in the run ledger.
YOLO and Ultralytics are not used.

Per-point wall time and process peak RSS are recorded. Vision-provider token
usage is recorded only when that optional arm runs.

## Privacy verification and cleanup

```bash
rg -n '"(match_id|first_server|confirmed_winner|user_side|email|name)"' \
  "$SERVE_ROOT/report/report-data.json"
```

The command should return no matches. The report directory is disposable; its
clips are local hardlinks or copies and contain no production write mechanism.
Remove the exact `SERVE_ROOT` manually when the experiment is no longer needed.
