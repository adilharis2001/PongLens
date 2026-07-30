# Multimodal Serve-Detection Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a read-only experiment that finds the true serve in every point, identifies the near/far server at high precision, measures the incremental value of table geometry and audio, and renders a review page.

**Architecture:** Reuse placement-v3's side-neutral candidate extraction and dual server hypotheses rather than building another trajectory solver. Add an experiment-only selector that compares the near/far hypotheses, exposes serve-event evidence, and abstains on a small margin. Materialize immutable local cases from the existing table-calibration artifacts, run deterministic ablations, collect blind references, and keep an optional bounded OpenAI storyboard arbiter behind an explicit flag.

**Tech Stack:** Python 3.11+, `unittest`, NumPy, SciPy, OpenCV, FFmpeg/ffprobe, existing BlurBall JSONL, existing placement reconstruction, optional OpenAI Responses API, static HTML/CSS/JavaScript.

## Global Constraints

- Work only on `codex/openai-table-calibration-experiment`.
- Do not write production Postgres, Supabase, R2, match, point, score, or feature-flag state.
- Search the complete point clip; never assume the serve is within the first 4.5 seconds.
- Do not read user-entered server fields, score-derived rotation, winners, or grading notes while generating independent predictions.
- Local high confidence requires two ordered on-table serve bounces on opposite halves and no hard contradiction.
- Audio and player motion may strengthen a candidate but cannot independently establish the server.
- No Ultralytics, YOLO, GPL, AGPL, research-only, non-commercial, or unclear checkpoint dependency.
- Provider requests are opt-in, use `store: false`, contain no identity fields, and include at most twelve frames.
- Every run is append-only and records code revision, input hash, thresholds, timings, and dependency provenance.
- Use test-driven development and commit each independently testable task.

---

### Task 1: Experiment-Only Server Selector

**Files:**
- Create: `worker/serve_detection.py`
- Create: `worker/tests/test_serve_detection.py`

**Interfaces:**
- Consumes: placement-v3 dictionaries returned by `worker.placement_reconstruction.reconstruct_placement`.
- Produces: `select_server_hypothesis(reconstruction: Mapping[str, Any], thresholds: ServeThresholds = DEFAULT_THRESHOLDS) -> dict[str, Any]`.
- Produces: `expected_server(first_server: str, game_number: int, points_played: int) -> str`.
- Produces: `aggregate_first_server(calls: Sequence[Mapping[str, Any]]) -> dict[str, Any]`.

- [ ] **Step 1: Write failing selector tests**

```python
def test_selects_clear_two_bounce_server_hypothesis():
    result = select_server_hypothesis(
        reconstruction_fixture(near_score=7.2, far_score=2.1)
    )
    self.assertEqual(result["server_side"], "near")
    self.assertEqual(result["status"], "high_confidence")
    self.assertEqual(result["serve"]["first_bounce"]["v"], 0.7)

def test_withholds_close_hypotheses():
    result = select_server_hypothesis(
        reconstruction_fixture(near_score=6.1, far_score=5.8)
    )
    self.assertIsNone(result["server_side"])
    self.assertEqual(result["status"], "needs_review")
```

- [ ] **Step 2: Run the selector tests and verify failure**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_serve_detection -v
```

Expected: `ModuleNotFoundError: No module named 'worker.serve_detection'`.

- [ ] **Step 3: Implement immutable thresholds and evidence extraction**

```python
@dataclass(frozen=True)
class ServeThresholds:
    ready_margin: float = 1.6
    review_margin: float = 0.65
    minimum_selected_score: float = 3.5
    minimum_bounce_confidence: float = 0.45

def select_server_hypothesis(reconstruction, thresholds=DEFAULT_THRESHOLDS):
    hypotheses = reconstruction.get("hypotheses") or {}
    ranked = sorted(hypotheses.values(), key=lambda item: item["score"], reverse=True)
    # Require a complete serve shot, opposite table halves, sufficient
    # bounce evidence, and a frozen score margin. Otherwise abstain.
```

The result schema is:

```python
{
    "version": 1,
    "status": "high_confidence | needs_review | unavailable",
    "server_side": "near | far | None",
    "confidence": 0.0,
    "score_margin": 0.0,
    "serve": {
        "contact_t": None,
        "first_bounce": {},
        "second_bounce": {},
    },
    "evidence": {},
    "reason": "stable_machine_reason",
}
```

- [ ] **Step 4: Add rotation tests and implementation**

```python
def test_expected_server_switches_every_point_at_deuce():
    self.assertEqual(expected_server("near", 1, 20), "near")
    self.assertEqual(expected_server("near", 1, 21), "far")

def test_first_server_alternates_between_games():
    self.assertEqual(expected_server("near", 2, 0), "far")
```

`aggregate_first_server` must transform every sealed independent call into a
match-first-server vote using `game_number` and `points_played`, then require
at least two agreeing high-confidence votes and a two-vote margin.

- [ ] **Step 5: Run tests and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_serve_detection -v
git add worker/serve_detection.py worker/tests/test_serve_detection.py
git commit -m "feat: select server from placement hypotheses"
```

Expected: all serve-detection tests pass.

---

### Task 2: Reusable Audio-Impact Extraction

**Files:**
- Modify: `worker/research_audio_candidates.py`
- Create: `worker/tests/test_research_audio_candidates.py`

**Interfaces:**
- Produces: `analyze_samples(samples: np.ndarray, sample_rate: int = 44_100) -> dict`.
- Produces: `point_audio_impacts(path: Path) -> list[dict[str, float]]`, where every item has `t` and `confidence`.
- Preserves: existing `analyze(path: Path) -> dict` CLI behavior.

- [ ] **Step 1: Write failing in-memory audio tests**

```python
def test_three_short_high_frequency_impacts_are_returned_in_time_order():
    samples = synthetic_impulses([0.25, 0.52, 0.79])
    result = analyze_samples(samples)
    times = [candidate["time_s"] for candidate in result["candidates"]]
    self.assertEqual(len(times), 3)
    self.assertTrue(all(a < b for a, b in zip(times, times[1:])))

def test_point_adapter_uses_placement_reconstruction_schema():
    impacts = point_audio_impacts(self.clip_path)
    self.assertEqual(set(impacts[0]), {"t", "confidence"})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_research_audio_candidates -v
```

Expected: import failure for `analyze_samples`.

- [ ] **Step 3: Refactor without changing the frozen detector**

Move the Butterworth filtering, robust threshold, and peak extraction from
`analyze` into `analyze_samples`. Keep `10_000 Hz`, `1 ms`, `8 MAD`,
`4x baseline`, and `60 ms` separation unchanged. Convert `time_s` to `t` only
in `point_audio_impacts`.

- [ ] **Step 4: Run tests and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_research_audio_candidates -v
git add worker/research_audio_candidates.py \
  worker/tests/test_research_audio_candidates.py
git commit -m "feat: expose serve audio impact extraction"
```

---

### Task 3: Immutable Local Serve Cases

**Files:**
- Create: `worker/eval/materialize_serve_detection_cases.py`
- Create: `worker/tests/test_materialize_serve_detection_cases.py`

**Interfaces:**
- Consumes: table experiment `cases.json`, `evaluated-results.json`, local clips, and global BlurBall JSONL.
- Produces: `serve-cases.json`, per-point ball JSONL, audio-impact JSON, calibration, hashes, and privacy-safe manifests.
- Produces: `references.template.json` with prediction-blind labels.

- [ ] **Step 1: Write failing materialization tests**

```python
def test_materializer_scales_accepted_corners_and_localizes_ball_frames():
    result = materialize_cases(table_root, output_root)
    point = result["cases"][0]["points"][0]
    self.assertEqual(point["calibration_size"], [1280, 720])
    self.assertTrue((output_root / point["ball_path"]).is_file())
    self.assertNotIn("first_server", json.dumps(result))

def test_materializer_rejects_paths_outside_table_root():
    with self.assertRaisesRegex(ValueError, "escapes"):
        resolve_case_path(table_root, "../private.mp4")
```

- [ ] **Step 2: Run tests and verify failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_materialize_serve_detection_cases -v
```

- [ ] **Step 3: Implement local-only materialization**

For each point:

1. Read clip FPS, frame count, width, height, and duration.
2. Map source BlurBall frames into clip-local frames using `clip_t0`.
3. Scale accepted source corners into clip coordinates.
4. Compute the table homography and length axis.
5. Extract audio impacts from the complete clip.
6. Hash the clip, ball JSONL, audio JSON, and calibration.
7. Write a blank reference record:

```json
{
  "match_key": "case-001",
  "idx": 1,
  "serve_contact_t": null,
  "server_side": null,
  "visibility": null,
  "first_bounce_visible": null,
  "second_bounce_visible": null,
  "hard_negatives": [],
  "note": ""
}
```

Use anonymous `case-001` identifiers in the report. Do not copy user names,
match titles, server truth, winners, or scores into the experiment manifest.

- [ ] **Step 4: Add append-only input locking**

`freeze_input_hash` writes `serve-input-lock.json` once and rejects mutated
clips, detections, audio, calibration, or manifests on later runs.

- [ ] **Step 5: Run tests and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_materialize_serve_detection_cases -v
git add worker/eval/materialize_serve_detection_cases.py \
  worker/tests/test_materialize_serve_detection_cases.py
git commit -m "feat: materialize serve detection cases"
```

---

### Task 4: Deterministic Ablation Runner

**Files:**
- Create: `worker/eval/run_serve_detection_experiment.py`
- Create: `worker/tests/test_run_serve_detection_experiment.py`

**Interfaces:**
- Consumes: locked `serve-cases.json`.
- Produces: append-only `serve-results-<run-id>.json`.
- Produces five arms: `wrist_baseline`, `geometry`, `geometry_audio`, `geometry_audio_motion`, and `geometry_audio_motion_api`.

- [ ] **Step 1: Write failing runner tests**

```python
def test_geometry_arm_uses_full_clip_and_no_audio():
    result = run_point(point, arm="geometry")
    self.assertEqual(result["frame_window"], [0, point["frame_count"]])
    self.assertEqual(result["audio_impact_count"], 0)

def test_audio_arm_passes_impacts_to_reconstruction():
    with patch("worker.eval.run_serve_detection_experiment.reconstruct_placement") as rebuild:
        run_point(point, arm="geometry_audio")
    self.assertEqual(rebuild.call_args.kwargs["audio_impacts"], point["audio"])

def test_run_id_cannot_overwrite_existing_output():
    output.write_text("{}")
    with self.assertRaises(FileExistsError):
        run_experiment(cases_path, output, run_id="v1")
```

- [ ] **Step 2: Run tests and verify failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_run_serve_detection_experiment -v
```

- [ ] **Step 3: Implement geometry and audio arms**

For each point:

1. Load local detections and calibration.
2. Call the existing `fit_play`/placement-v3 reconstruction across frames
   `0..frame_count`.
3. Run `select_server_hypothesis`.
4. Record complete evidence, timing, memory, and failure reason.

The motion arm initially aliases `geometry_audio` with
`motion_status = "not_implemented"` and may not claim incremental coverage.
It becomes active only after Task 8's RTMDet gate.

- [ ] **Step 4: Implement sealed prediction metadata**

Every output records:

```json
{
  "run_id": "serve-dev-v1",
  "git_commit": "40-hex-sha",
  "input_sha256": "64-hex-sha",
  "thresholds": {},
  "dependency_ledger": [],
  "arms": {},
  "timing": {}
}
```

- [ ] **Step 5: Run tests and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_run_serve_detection_experiment -v
git add worker/eval/run_serve_detection_experiment.py \
  worker/tests/test_run_serve_detection_experiment.py
git commit -m "feat: run serve detection ablations"
```

---

### Task 5: Blind References, Metrics, and Frozen Thresholds

**Files:**
- Create: `worker/eval/score_serve_detection_experiment.py`
- Create: `worker/tests/test_score_serve_detection_experiment.py`

**Interfaces:**
- Consumes: sealed prediction output and content-locked references.
- Produces: `serve-evaluated-<run-id>.json`.
- Produces precision, coverage, false-event rate, contact error, match vote accuracy, subgroup breakdowns, and acceptance gates.

- [ ] **Step 1: Write failing metric tests**

```python
def test_abstention_reduces_coverage_not_precision():
    metrics = score_points([
        example(predicted="near", truth="near"),
        example(predicted=None, truth="far"),
    ])
    self.assertEqual(metrics["precision"], 1.0)
    self.assertEqual(metrics["coverage"], 0.5)

def test_unobservable_points_are_excluded_from_denominator():
    metrics = score_points([example(visibility="serve_missing")])
    self.assertEqual(metrics["observable"], 0)

def test_contact_is_correct_within_four_hundred_ms():
    self.assertTrue(contact_is_correct(4.20, 4.59))
    self.assertFalse(contact_is_correct(4.20, 4.61))
```

- [ ] **Step 2: Run tests and verify failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_score_serve_detection_experiment -v
```

- [ ] **Step 3: Implement immutable reference locking and scoring**

Reject missing visibility, invalid sides, duplicate point keys, mutated
reference hashes, and reference files created before predictions were sealed.
Report Wilson confidence intervals alongside point estimates.

- [ ] **Step 4: Implement acceptance gates**

Return `passed`, `failed`, or `unproven` for:

- precision at least `0.98`;
- coverage at least `0.60`;
- first-server accuracy `1.0` across at least five auto-decided matches;
- zero hard-negative false selections; and
- subgroup precision at least `0.95` for groups with at least 20 examples.

- [ ] **Step 5: Run tests and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_score_serve_detection_experiment -v
git add worker/eval/score_serve_detection_experiment.py \
  worker/tests/test_score_serve_detection_experiment.py
git commit -m "feat: score serve detection experiment"
```

---

### Task 6: Bounded Vision-API Arbiter

**Files:**
- Create: `worker/eval/serve_vision_arbiter.py`
- Create: `worker/tests/test_serve_vision_arbiter.py`

**Interfaces:**
- Consumes: only `needs_review` local predictions with at most two candidate windows.
- Produces: `{"candidate_id": str | None, "server_side": str | None, "confidence": float, "reason": str}` plus token/cost metadata.

- [ ] **Step 1: Write failing privacy and size tests**

```python
def test_request_contains_at_most_twelve_anonymous_frames():
    request = build_request(point, candidates)
    images = image_inputs(request)
    self.assertLessEqual(len(images), 12)
    self.assertNotIn(point["match_id"], json.dumps(request))
    self.assertFalse(request["store"])

def test_api_cannot_override_hard_geometry_contradiction():
    result = apply_arbiter(local_hard_conflict, provider_near)
    self.assertEqual(result["status"], "needs_review")
```

- [ ] **Step 2: Run tests and verify failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_serve_vision_arbiter -v
```

- [ ] **Step 3: Implement frame selection and structured response**

Select four to six chronological frames around each of the top two candidates,
encode bounded JPEGs, and request strict JSON. Keep the API arm disabled unless
`--enable-api` and an explicit API key are present. Provider failure returns
the untouched local abstention.

- [ ] **Step 4: Add cost accounting and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_serve_vision_arbiter -v
git add worker/eval/serve_vision_arbiter.py \
  worker/tests/test_serve_vision_arbiter.py
git commit -m "feat: add bounded serve vision arbiter"
```

---

### Task 7: Static Review and Labeling Report

**Files:**
- Create: `worker/eval/render_serve_detection_experiment.py`
- Create: `worker/tests/test_render_serve_detection_experiment.py`
- Create: `docs/operations/multimodal-serve-detection-experiment.md`

**Interfaces:**
- Consumes: cases, predictions, optional evaluated references.
- Produces: `report/index.html`, `report/report-data.json`, anonymous assets, and browser-exported `serve-references.json`.

- [ ] **Step 1: Write failing renderer tests**

```python
def test_report_exposes_ablation_and_blind_label_controls():
    render_report(cases, results, report_dir)
    html = (report_dir / "index.html").read_text()
    self.assertIn("Geometry + audio", html)
    self.assertIn("Mark actual serve", html)
    self.assertIn("Export references", html)
    self.assertNotIn("first_server", (report_dir / "report-data.json").read_text())

def test_assets_cannot_escape_report_directory():
    with self.assertRaisesRegex(ValueError, "escapes"):
        copy_asset(report_dir, Path("../../private.mp4"))
```

- [ ] **Step 2: Run tests and verify failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_serve_detection_experiment -v
```

- [ ] **Step 3: Implement report**

Render:

- aggregate precision/coverage and gate status when references exist;
- point filters for automated, withheld, wrong, hard negative, and failure;
- synchronized video and waveform;
- table overlay, bounce timestamps, candidate timeline, selected side, margin,
  and evidence;
- blind timestamp/server/visibility/hard-negative labeling controls;
- localStorage persistence and JSON export; and
- timing, peak memory, API usage, and cost.

- [ ] **Step 4: Document exact read-only commands**

Document materialization, local run, optional API run, scoring, rendering,
server startup, expected output files, privacy behavior, licensing ledger,
cleanup, and proof that no production mutation path is called.

- [ ] **Step 5: Run tests and commit**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_serve_detection_experiment -v
git add worker/eval/render_serve_detection_experiment.py \
  worker/tests/test_render_serve_detection_experiment.py \
  docs/operations/multimodal-serve-detection-experiment.md
git commit -m "feat: render serve detection review"
```

---

### Task 8: RTMDet Motion Gate and End-to-End Development Run

**Files:**
- Create: `worker/serve_motion.py`
- Create: `worker/tests/test_serve_motion.py`
- Modify: `worker/eval/run_serve_detection_experiment.py`
- Modify: `docs/operations/multimodal-serve-detection-experiment.md`

**Interfaces:**
- Produces: `motion_evidence(clip: Path, candidate_times: Sequence[float], table_corners: Mapping[str, Sequence[float]]) -> dict`.
- Must load only an Apache-2.0 RTMDet checkpoint whose SHA-256 appears in the dependency ledger.

- [ ] **Step 1: Write failing license and fallback tests**

```python
def test_motion_model_rejects_unapproved_license():
    with self.assertRaisesRegex(ValueError, "commercial-use allowlist"):
        validate_model_provenance({"license": "AGPL-3.0"})

def test_missing_motion_runtime_preserves_geometry_audio_result():
    result = run_point(point, arm="geometry_audio_motion", motion_runner=None)
    self.assertEqual(result["server_side"], geometry_audio["server_side"])
    self.assertEqual(result["motion_status"], "unavailable")
```

- [ ] **Step 2: Run tests and verify failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_serve_motion -v
```

- [ ] **Step 3: Implement candidate-window-only person motion**

Run RTMDet only around locally generated candidate windows, not across the
complete clip. Measure optical-flow energy inside the near/far person boxes
and return a bounded supporting score. Motion cannot turn a hypothesis with
invalid bounce geometry into high confidence.

- [ ] **Step 4: Run complete tests**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest discover \
  -s worker/tests -v
```

Expected: all worker tests pass.

- [ ] **Step 5: Materialize and run the development set**

```bash
SERVE_ROOT=/Users/adil/Desktop/PongLens-Reports/serve-detection-20260730
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/materialize_serve_detection_cases.py \
  --table-root \
  /Users/adil/Desktop/PongLens-Reports/openai-table-calibration-20260729 \
  --output "$SERVE_ROOT"

/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/run_serve_detection_experiment.py \
  --cases "$SERVE_ROOT/serve-cases.json" \
  --run-id serve-dev-v1 \
  --output "$SERVE_ROOT/serve-results-serve-dev-v1.json"

/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_serve_detection_experiment.py \
  --root "$SERVE_ROOT" \
  --results "$SERVE_ROOT/serve-results-serve-dev-v1.json"
```

- [ ] **Step 6: Verify artifact invariants and commit**

```bash
rg -n 'first_server|confirmed_winner|user_side|email|name' \
  "$SERVE_ROOT/report/report-data.json"
git diff --check
git status --short
git add worker/serve_motion.py worker/tests/test_serve_motion.py \
  worker/eval/run_serve_detection_experiment.py \
  docs/operations/multimodal-serve-detection-experiment.md
git commit -m "feat: complete multimodal serve experiment"
```

Expected: privacy scan has no identity/truth fields, the report opens locally,
and the worktree is clean.

