# OpenAI Table Calibration Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a read-only, three-match experiment that tests whether OpenAI can recover table calibration without colored-rim evidence and whether that calibration unlocks useful RTMPose first-server and persistent side-swap results.

**Architecture:** Add provider-neutral vision-calibration evaluation primitives beside the existing placement-retry path, then build a local-only experiment runner that materializes production inputs through existing read helpers, records blinded reference corners, runs three OpenAI trials per match, validates consensus locally, and invokes the existing RTMPose extractor on accepted calibrations. A separate renderer turns the resulting JSON and image overlays into a static HTML review page; production database and R2 write helpers are never called.

**Tech Stack:** Python 3, OpenCV, NumPy, OpenAI Responses API through `requests`, psycopg2, Cloudflare R2 through the existing worker client, RTMLib/RTMPose ONNX, `unittest`, static HTML/CSS/JavaScript.

## Global Constraints

- Use only the existing OpenAI provider for this experiment.
- Send three extracted still images per trial, never the source video.
- Use `store: false`; send no match identity, names, scores, or account data.
- Run exactly three independent proposal trials per match.
- Require two agreeing trials with median corner drift at most 2% and maximum corner drift at most 4% of frame diagonal.
- Remove colored/magenta rim evidence as a mandatory acceptance condition.
- Keep geometry, generic edge, activity-core, projection, and repeatability validation fail-closed.
- Record visually reviewed reference corners before inspecting any new model proposal.
- Treat median reference error at most 2% and maximum reference error at most 4% of frame diagonal as the experimental accuracy gate.
- Do not update production database rows, R2 artifacts, score state, retry state, or feature flags.
- Keep all media and generated diagnostics under a caller-selected local output directory.
- Run on the two specified failed matches and one recent known-good control.
- Report calibration results separately from downstream RTMPose results.

---

### Task 1: Generic vision-calibration evaluation primitives

**Files:**
- Create: `worker/vision_table_calibration.py`
- Create: `worker/tests/test_vision_table_calibration.py`
- Modify: `worker/placement_retry_calibration.py`
- Test: `worker/tests/test_placement_retry_calibration.py`

**Interfaces:**
- Consumes: `CornerProposal`, `parse_corner_proposal()`, `request_corner_proposal()`, `validate_quad()`, `activity_gate()`, and `load_detections()` from the current placement calibration path.
- Produces:
  - `select_generic_representative_frames(video_path: Path, output_dir: Path) -> list[Path]`
  - `validate_generic_candidate(raw: object, background: np.ndarray, source_size: tuple[int, int], bounce_core: tuple[float, float, float, float] | None, detections: Mapping[int, tuple[float, float]]) -> dict`
  - `select_consensus(candidates: Sequence[dict], width: int, height: int) -> dict`
  - `reference_error(corners: Sequence[Sequence[float]], reference: Sequence[Sequence[float]], width: int, height: int) -> dict`

- [ ] **Step 1: Write failing tests for color-independent frame selection**

Create a synthetic 320×180 video containing a gray trapezoidal table with
white boundary lines and moving dark occluders. Assert that the selector
writes exactly three same-sized JPEGs, the first named `background.jpg`, and
the other two drawn from separated sample positions:

```python
paths = select_generic_representative_frames(video, output)
self.assertEqual([path.name for path in paths], [
    "background.jpg",
    "representative-1.jpg",
    "representative-2.jpg",
])
self.assertTrue(all(cv2.imread(str(path)).shape[:2] == (180, 320)
                    for path in paths))
```

- [ ] **Step 2: Run the selector test and verify it fails**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest \
  worker.tests.test_vision_table_calibration.GenericFrameSelectionTests -v
```

Expected: import failure for `worker.vision_table_calibration`.

- [ ] **Step 3: Implement generic representative-frame selection**

Implement a 24-frame bounded sampler. Write the pixel-wise median as the first
image. Score ordinary frames using Laplacian sharpness plus Hough-line support
inside the central 80% of the frame, with a penalty for extremely dense edge
maps. Select the best frame from the first and second temporal halves:

```python
def select_generic_representative_frames(
    video_path: Path,
    output_dir: Path,
) -> list[Path]:
    samples = _sample_video(video_path, count=24, max_dim=1600)
    if len(samples) < 3:
        raise ValueError("too few representative frames")
    background = np.median(np.stack([sample.image for sample in samples]),
                           axis=0).astype(np.uint8)
    halves = np.array_split(np.arange(len(samples)), 2)
    selected = [
        max((samples[int(index)] for index in half),
            key=lambda sample: _generic_frame_score(sample.image))
        for half in halves
    ]
    return _write_representatives(background, selected, output_dir)
```

No magenta mask or hue threshold may appear in this module.

- [ ] **Step 4: Write failing tests for generic candidate validation**

Use the same synthetic gray table. Assert that the known quad is accepted
without any magenta pixels, a shifted floor quad is rejected, and the result
contains explicit geometry, edge, activity, and projection scores:

```python
result = validate_generic_candidate(
    raw=proposal(GOOD_QUAD),
    background=gray_table,
    source_size=(320, 180),
    bounce_core=(90, 235, 65, 125),
    detections=ball_detections,
)
self.assertTrue(result["accepted"])
self.assertGreater(result["scores"]["edge_support"], 0)
self.assertGreater(result["scores"]["projected_on_table"], 0)
self.assertNotIn("magenta", json.dumps(result).lower())
```

- [ ] **Step 5: Run the validation test and verify it fails**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest \
  worker.tests.test_vision_table_calibration.GenericCandidateTests -v
```

Expected: failure because `validate_generic_candidate` is not implemented.

- [ ] **Step 6: Implement geometry, generic-edge, activity, and projection scoring**

Use `validate_quad()` for hard geometry and homography checks. Build a Canny
edge map and distance transform, sample each proposed perimeter edge at
one-pixel-normalized intervals, and calculate the fraction within
`max(3, round(width * 0.003))` pixels of ordinary image edges. Require:

```python
MIN_TOTAL_EDGE_SUPPORT = 0.20
MIN_SUPPORTED_EDGES = 2
MIN_SINGLE_EDGE_SUPPORT = 0.12
MIN_PROJECTED_DETECTIONS = 6
MIN_PROJECTED_ON_TABLE_RATIO = 0.02
```

The hard acceptance expression is:

```python
accepted = (
    geometry_ok
    and edge_total >= MIN_TOTAL_EDGE_SUPPORT
    and supported_edges >= MIN_SUPPORTED_EDGES
    and activity_overlap >= 0.05
    and projected_count >= MIN_PROJECTED_DETECTIONS
    and projected_on_table_ratio >= MIN_PROJECTED_ON_TABLE_RATIO
)
```

Return a JSON-serializable dictionary containing `accepted`, `reason`,
`corners`, and all subscores. Colored-rim support may be recorded only as a
diagnostic outside this acceptance expression.

- [ ] **Step 7: Write failing tests for repeatability and reference accuracy**

Test two close proposals plus one outlier, all four-corner outliers, and exact
reference error:

```python
consensus = select_consensus([first, close, outlier], 1920, 1080)
self.assertTrue(consensus["accepted"])
self.assertEqual(consensus["agreeing_trials"], [0, 1])
self.assertLessEqual(consensus["median_drift_ratio"], 0.02)

error = reference_error(GOOD_QUAD, GOOD_QUAD, 1920, 1080)
self.assertEqual(error["median_ratio"], 0.0)
self.assertEqual(error["maximum_ratio"], 0.0)
```

- [ ] **Step 8: Implement consensus and reference metrics**

Compare every trial pair by corresponding-corner Euclidean distance divided by
the frame diagonal. Accept the pair with the smallest median drift only when
its median is at most `0.02` and maximum at most `0.04`. Produce the
coordinate-wise median of the agreeing pair and revalidate it later in the
runner. `reference_error()` uses the same normalized distances and reports all
four distances, median, and maximum.

- [ ] **Step 9: Update the OpenAI prompt without changing retry behavior**

In `request_corner_proposal()`, state that the visible playing surface and
outer boundary—not any paint color—define the table. Add required
`ambiguity_reason: string` to the strict response schema. Keep `store: False`,
the existing return type, and `_write_cost_usage_sidecar()` behavior.
Update existing mocks to include `"ambiguity_reason": ""`.

- [ ] **Step 10: Run calibration unit tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_vision_table_calibration \
  worker.tests.test_placement_retry_calibration -v
```

Expected: all tests pass.

- [ ] **Step 11: Commit Task 1**

```bash
git add worker/vision_table_calibration.py \
  worker/placement_retry_calibration.py \
  worker/tests/test_vision_table_calibration.py \
  worker/tests/test_placement_retry_calibration.py
git commit -m "feat: add generic vision table calibration evaluation"
```

---

### Task 2: Read-only production case materializer

**Files:**
- Create: `worker/eval/materialize_table_calibration_cases.py`
- Create: `worker/tests/test_materialize_table_calibration_cases.py`

**Interfaces:**
- Consumes: `worker.connect()`, `load_backfill_record()`,
  `download_backfill_inputs()`, `run_blurball_only()`, `parse_r2_path()`,
  `r2()`, and Task 1's `select_generic_representative_frames()`.
- Produces:
  - `choose_control_match(conn, excluded_ids: Sequence[str]) -> str`
  - `materialize_case(conn, match_id: str, output_dir: Path) -> dict`
  - CLI subcommand `prepare --output-dir PATH [--control-match-id UUID]`
  - `cases.json` and `references.template.json`

- [ ] **Step 1: Write failing record-selection tests**

Use fake cursors to assert that control selection:

```python
self.assertIn("match_structure->>'status' = 'ready'", normalized_sql)
self.assertIn("j.created_at >= now() - interval '7 days'", normalized_sql)
self.assertEqual(parameters[0], list(EXPERIMENT_MATCH_IDS))
```

The selected control must exclude the Vaibhav and Tripp IDs and require a
retained `input_path`, ready structure evidence, and a recent raw source.

- [ ] **Step 2: Run the selection tests and verify they fail**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest \
  worker.tests.test_materialize_table_calibration_cases.ControlSelectionTests -v
```

Expected: import failure for the new materializer.

- [ ] **Step 3: Implement constants and read-only control selection**

Define:

```python
EXPERIMENT_MATCH_IDS = (
    "5721edd0-a80e-4eb8-a605-a6d3c8dbe41f",
    "cb0e7027-c41d-41d3-8984-7e15fddbeb88",
)
```

The SQL is `SELECT` only. The module must not import or call any worker upload,
update, retry, persistence, or email function.

- [ ] **Step 4: Write failing materialization tests**

Mock all database and R2 boundaries. Assert that `materialize_case()`:

- downloads the source and existing `match.json`;
- downloads each point clip as `clips/point-{idx:03d}.mp4`;
- runs BlurBall once;
- creates three representative images;
- writes a local manifest containing match ID, local relative paths, point
  indices, source dimensions, and existing scoring truth;
- omits user ID, names, original filename, and provider credentials; and
- performs zero database commits and zero R2 writes.

```python
self.assertNotIn("user_id", json.dumps(manifest))
r2_client.upload_file.assert_not_called()
connection.commit.assert_not_called()
```

- [ ] **Step 5: Implement local case materialization**

Reuse `load_backfill_record()` and `download_backfill_inputs()`. Download clip
URIs from the already loaded point rows. Save only these scoring fields for
evaluation:

```python
SCORING_FIELDS = (
    "idx", "id", "t0", "t1", "confirmed_winner", "is_let",
    "game_end_override", "server_override",
)
```

Store all paths relative to the caller-selected output directory. Compute
SHA-256 for each representative image so later phases can prove that the
reference and provider trials used the same inputs.

- [ ] **Step 6: Add the reference-first phase boundary**

`prepare` writes:

```json
{
  "cases": [
    {
      "match_id": "…",
      "size": [1920, 1080],
      "image_sha256": ["…", "…", "…"],
      "corners": null
    }
  ]
}
```

It must print that API trials cannot start until a separate
`references.json` contains four finite in-frame corners for every case. The
prepare command never reads the OpenAI key and never calls OpenAI.

- [ ] **Step 7: Snapshot current provider prices read-only**

Query active `public.cost_rates` rows for the configured OpenAI model and
units `input_token`, `cached_input_token`, and `output_token`. Store price,
effective date, source URL, and source label under `pricing` in `cases.json`.
Fail preparation if no complete active rate set exists; do not silently use a
hard-coded estimate.

- [ ] **Step 8: Run materializer tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_materialize_table_calibration_cases -v
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add worker/eval/materialize_table_calibration_cases.py \
  worker/tests/test_materialize_table_calibration_cases.py
git commit -m "feat: materialize read-only calibration experiment cases"
```

---

### Task 3: Three-trial OpenAI experiment runner

**Files:**
- Create: `worker/eval/run_openai_table_calibration_experiment.py`
- Create: `worker/tests/test_openai_table_calibration_experiment.py`

**Interfaces:**
- Consumes: Task 1 validation functions, Task 2 `cases.json`,
  `references.json`, current `request_corner_proposal()`, and one
  trial-specific `PONGLENS_COST_USAGE_OUTPUT` sidecar.
- Produces:
  - `validate_references(cases: dict, references: dict) -> None`
  - `run_case(case: dict, reference: dict, api_key: str, model: str) -> dict`
  - `estimate_trial_cost(usage: dict, pricing: dict) -> float`
  - CLI subcommand `run --cases PATH --references PATH --output PATH`
  - `experiment-results.json`

- [ ] **Step 1: Write failing reference-integrity tests**

Assert rejection for null corners, mismatched image hashes, mismatched frame
size, missing match ID, out-of-frame coordinates, and a reference file changed
after trials begin:

```python
with self.assertRaisesRegex(ValueError, "image hashes"):
    validate_references(cases, mismatched_references)
```

- [ ] **Step 2: Run the reference tests and verify they fail**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest \
  worker.tests.test_openai_table_calibration_experiment.ReferenceTests -v
```

Expected: import failure for the new runner.

- [ ] **Step 3: Implement strict reference validation**

Require exactly the four canonical names:

```python
CORNER_NAMES = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")
```

Validate with `parse_corner_proposal()` using confidence `1.0`, then hash the
entire references document into every result as `reference_sha256`.

- [ ] **Step 4: Write failing trial, consensus, and cost tests**

Inject three provider responses: two close gray-table proposals and one
outlier. Assert exactly three calls, unique usage sidecars, consensus of the
close pair, a second validation pass on median corners, exact token cost, and
separate accuracy status:

```python
self.assertEqual(provider.call_count, 3)
self.assertEqual(result["consensus"]["agreeing_trials"], [0, 1])
self.assertTrue(result["calibration"]["accepted"])
self.assertEqual(result["accuracy"]["status"], "passes_reference_gate")
self.assertAlmostEqual(result["provider"]["estimated_usd"], expected_cost)
```

- [ ] **Step 5: Implement one case run**

For trials `0..2`:

1. set a unique local `PONGLENS_COST_USAGE_OUTPUT`;
2. call the existing structured OpenAI request with the same three image
   hashes;
3. measure wall time;
4. parse and validate the proposal;
5. retain raw corners, confidence, ambiguity reason, usage, response ID,
   latency, and validation result; and
6. exclude image bytes, prompts, account data, and credentials from results.

After `select_consensus()`, run `validate_generic_candidate()` again on the
median corners. Calculate reference error only after consensus is fixed.

- [ ] **Step 6: Implement pricing from the stored snapshot**

Use returned input, cached-input, and output tokens:

```python
cost = (
    uncached_input * rates["input_token"]
    + cached_input * rates["cached_input_token"]
    + output * rates["output_token"]
)
```

Report each trial and total. Include the pricing source labels and effective
dates from `cases.json`.

- [ ] **Step 7: Add safe command behavior**

The command must:

- require `OPENAI_API_KEY`;
- refuse an output path outside the prepared experiment root;
- create no network calls other than the three OpenAI requests per case;
- write results atomically after every completed case; and
- preserve a provider error as a failed trial rather than discarding the
  other trial results.

- [ ] **Step 8: Run experiment-runner tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_openai_table_calibration_experiment -v
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add worker/eval/run_openai_table_calibration_experiment.py \
  worker/tests/test_openai_table_calibration_experiment.py
git commit -m "feat: run repeatable OpenAI calibration trials"
```

---

### Task 4: RTMPose downstream evaluation and static review page

**Files:**
- Create: `worker/eval/render_table_calibration_experiment.py`
- Create: `worker/tests/test_render_table_calibration_experiment.py`
- Create: `docs/operations/openai-table-calibration-experiment.md`

**Interfaces:**
- Consumes: accepted calibration in `experiment-results.json`, prepared local
  `match.json`, clips, global BlurBall detections, existing
  `worker/extract_match_structure_rtmpose.py`, RTMPose interpreter/model paths,
  and local representative images.
- Produces:
  - `run_structure(case: dict, accepted: dict, output_dir: Path) -> dict`
  - `render_overlays(case_result: dict, output_dir: Path) -> list[Path]`
  - `render_report(results: dict, output_dir: Path) -> Path`
  - `index.html`, overlays, and `report-data.json`

- [ ] **Step 1: Write failing downstream-command tests**

Mock `subprocess.run()` and assert the generated local match copy contains the
accepted calibration with `ok: true` and source `size`, while the original
downloaded `match.json` remains byte-identical:

```python
self.assertEqual(original_path.read_bytes(), original_before)
self.assertEqual(local_match["calibration"]["table_corners_px"], accepted)
self.assertIn("--match-json", command)
self.assertIn("--blurball", command)
```

Rejected calibration must produce `status: "not_run"` and no subprocess call.

- [ ] **Step 2: Implement read-only RTMPose invocation**

Copy the prepared match JSON to `downstream/match.json`, replace calibration
only in that copy, and invoke:

```bash
<rtmpose-python> worker/extract_match_structure_rtmpose.py \
  --clips-dir <case>/clips \
  --blurball <case>/blurball.jsonl \
  --match-json <case>/downstream/match.json \
  --output <case>/downstream/match-structure.json \
  --model <rtmpose-model> \
  --backend onnxruntime \
  --device mps
```

Capture elapsed time, exit status, stderr tail, evidence coverage,
first-server result, side-swap intervals, and the extractor's compute block.
Do not import `persist_match_structure()`.

- [ ] **Step 3: Write failing overlay and HTML tests**

Use a fixture with one accepted and one rejected match. Assert:

- three input images per match are present;
- reference, each trial, and accepted consensus have distinct legend labels;
- rejection reasons and validation subscores render;
- calibration and RTMPose conclusions use separate fields;
- provider cost and compute timing render;
- the page contains no API key, user ID, R2 URI, source filename, or model
  response ID; and
- all image links resolve beneath the report directory.

- [ ] **Step 4: Implement diagnostic overlays**

Copy representative images into `report/assets/<case>/`. Render quadrilaterals:

```python
COLORS = {
    "reference": (34, 197, 94),
    "trial_1": (59, 130, 246),
    "trial_2": (168, 85, 247),
    "trial_3": (245, 158, 11),
    "accepted": (239, 68, 68),
}
```

Write labeled circles and edges with OpenCV. Do not modify prepared input
images.

- [ ] **Step 5: Implement the static report**

Render a summary table and one case card per match. The summary contains:

- proposal stability and reference accuracy;
- local validation status;
- first-server result and available truth;
- detected side-swap intervals and reviewed/score boundaries;
- API latency and estimated cost; and
- RTMPose elapsed and inference time.

Include this warning verbatim:

> Three matches are a focused engineering check, not a statistically
> representative accuracy study.

Copy the complete sanitized result as `report-data.json`; use no remote
scripts, fonts, or analytics.

- [ ] **Step 6: Write the operations guide**

Document exact `prepare`, reference, `run`, downstream, and render commands;
the three-match sample; required Keychain/env credentials; `store: false`;
read-only invariants; local artifact deletion; and how to distinguish
calibration failure from RTMPose failure.

- [ ] **Step 7: Run renderer and downstream tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_table_calibration_experiment -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit Task 4**

```bash
git add worker/eval/render_table_calibration_experiment.py \
  worker/tests/test_render_table_calibration_experiment.py \
  docs/operations/openai-table-calibration-experiment.md
git commit -m "feat: report calibration and RTMPose experiment results"
```

---

### Task 5: Execute the three-match experiment and verify the artifact

**Files:**
- Modify only if verification reveals a tested defect:
  `worker/vision_table_calibration.py`,
  `worker/eval/materialize_table_calibration_cases.py`,
  `worker/eval/run_openai_table_calibration_experiment.py`,
  `worker/eval/render_table_calibration_experiment.py`, and corresponding
  tests.
- Generate outside Git:
  `/Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/`

**Interfaces:**
- Consumes: all prior tasks and production read credentials.
- Produces: a local review page and measured three-match conclusion.

- [ ] **Step 1: Run the focused and regression test suites**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_vision_table_calibration \
  worker.tests.test_placement_retry_calibration \
  worker.tests.test_materialize_table_calibration_cases \
  worker.tests.test_openai_table_calibration_experiment \
  worker.tests.test_render_table_calibration_experiment \
  worker.tests.test_extract_match_structure -v
```

Expected: all tests pass.

- [ ] **Step 2: Prepare the cases without calling OpenAI**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/materialize_table_calibration_cases.py prepare \
  --output-dir \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729
```

Confirm `cases.json`, three case directories, clips, BlurBall output, three
images per case, and `references.template.json` exist. Record the automatically
selected control match ID.

- [ ] **Step 3: Record reference corners before API trials**

Open only the prepared representative frames, inspect them at original
resolution, and write `references.json` with the four named corners and copied
image hashes. Validate it without contacting OpenAI:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/run_openai_table_calibration_experiment.py validate-references \
  --cases /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/cases.json \
  --references /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/references.json
```

Expected: all three references validate.

- [ ] **Step 4: Run exactly nine OpenAI trials**

Load the existing Keychain API key into the subprocess environment without
printing it, then run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/run_openai_table_calibration_experiment.py run \
  --cases /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/cases.json \
  --references /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/references.json \
  --output /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/experiment-results.json
```

Confirm three recorded trials per case, usage metadata, cost, validation,
consensus, and reference metrics. Do not rerun a successful trial set merely
to improve the answer.

- [ ] **Step 5: Run downstream RTMPose only for accepted calibrations**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_table_calibration_experiment.py \
  --experiment-root /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729 \
  --run-rtmpose \
  --rtmpose-python /Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python \
  --rtmpose-model /Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
```

Confirm rejected calibrations remain `not_run`, accepted cases have validated
structure evidence, and original prepared `match.json` hashes are unchanged.

- [ ] **Step 6: Render and visually inspect the report**

The previous command writes `report/index.html`. Start a local static server:

```bash
/usr/bin/python3 -m http.server 8770 \
  --directory /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729/report
```

Inspect desktop and narrow layouts, every image and legend, summary values,
rejection explanations, and the separation between calibration and RTMPose
results.

- [ ] **Step 7: Prove production state was not mutated**

Record database snapshots before and after the experiment for the three match
rows and point counts. Assert identical values for:

```text
matches.match_structure
matches.first_server
matches.first_server_source
matches.placement_status
matches.placement_retry_count
matches.match_json_path
points.game_end_override
points.server_override
```

Also compare the downloaded R2 `match.json` object ETags or SHA-256 values
before and after. Any difference is a hard failure.

- [ ] **Step 8: Run final verification**

Run:

```bash
git diff --check
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest discover \
  -s worker/tests -p 'test_*.py' -v
npm test
npm run build
git status --short
```

Expected: no whitespace errors, all Python and application tests pass, the
Next.js build succeeds, and only intentional source/test/doc changes remain.

- [ ] **Step 9: Commit any verification-driven corrections**

If Step 6 or Step 8 required a tested correction, commit only those source,
test, and documentation changes:

```bash
git add worker docs/operations
git commit -m "fix: harden table calibration experiment"
```

Do not add downloaded videos, representative frames, API responses, report
assets, or other experiment artifacts to Git.
