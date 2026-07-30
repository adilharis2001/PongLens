# Placement Calibration A/B Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a read-only experiment that reconstructs the three Chris matches with their current and OpenAI-assisted table calibrations, quantifies placement changes, and renders every zone flip with its point video.

**Architecture:** Extend the existing calibration materializer to accept an explicit immutable match list. Add a focused comparison module that converts an accepted OpenAI consensus into PongLens calibration, runs the existing placement-v3 reconstruction twice, matches landings by full identity, and emits deterministic metrics. Add a separate HTML renderer so data computation remains independently testable.

**Tech Stack:** Python 3.12, OpenCV, NumPy, existing PongLens worker/Postgres/R2 helpers, OpenAI Responses API through the existing request boundary, `unittest`, static HTML/CSS/SVG.

## Global Constraints

- Production Postgres and R2 access is read-only.
- No match, point, job, cost, retry, score, calibration, or placement row is updated.
- No R2 object is uploaded, replaced, or deleted.
- OpenAI requests use `store: false`.
- Only three anonymous extracted JPEGs per new match are sent to OpenAI.
- Existing Vaibhav and Tripp results are reused rather than purchased again.
- The duplicated historical control is excluded from distinct-match counts.
- A stable disagreement is not labeled an accuracy improvement without reviewed truth.
- Point boundaries, scoring fields, BlurBall detections, and reconstruction code are identical between A/B arms.
- Matched landings require match, point, physical-server hypothesis, shot sequence, phase, and hitter side identity.

---

### Task 1: Explicit read-only case preparation

**Files:**
- Modify: `worker/eval/materialize_table_calibration_cases.py`
- Modify: `worker/tests/test_materialize_table_calibration_cases.py`

**Interfaces:**
- Consumes: existing `materialize_case(...)`, `load_pricing_snapshot(...)`, and `validate_control_case(...)`.
- Produces: `prepare_explicit_cases(output_dir: Path, match_ids: Sequence[str], *, model: str) -> dict`.

- [ ] **Step 1: Write the failing explicit-list tests**

Add tests proving that the new function:

```python
payload = prepare_explicit_cases(
    root,
    ["m-chris-1", "m-chris-2", "m-chris-1"],
    model="gpt-5.6-sol",
)
self.assertEqual(
    [case["match_id"] for case in payload["cases"]],
    ["m-chris-1", "m-chris-2"],
)
self.assertEqual(payload["selection"], "explicit")
```

Also assert that an empty list raises `ValueError`, that the database
connection closes, and that no control-selection query runs.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_materialize_table_calibration_cases -v
```

Expected: import or attribute failure for `prepare_explicit_cases`.

- [ ] **Step 3: Implement explicit preparation and CLI flags**

Implement:

```python
def prepare_explicit_cases(
    output_dir: Path,
    match_ids: Sequence[str],
    *,
    model: str = DEFAULT_MODEL,
) -> dict:
    ordered_ids = list(dict.fromkeys(str(value) for value in match_ids if value))
    if not ordered_ids:
        raise ValueError("at least one explicit match ID is required")
    runtime = _default_runtime()
    conn = runtime.connect()
    try:
        cases = []
        for match_id in ordered_ids:
            case_root = Path(output_dir).resolve() / "cases" / match_id
            case = materialize_case(conn, match_id, case_root)
            cases.append({**case, "root": str(case_root.relative_to(Path(output_dir).resolve())), "role": "paired_target"})
        payload = {
            "version": 1,
            "model": model,
            "pricing": load_pricing_snapshot(conn, model),
            "selection": "explicit",
            "cases": cases,
        }
        (Path(output_dir) / "cases.json").write_text(json.dumps(payload, indent=2) + "\n")
        return payload
    finally:
        conn.close()
```

Add repeatable `--match-id` arguments and dispatch explicit preparation when
at least one is supplied. Existing default behavior remains unchanged.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the Task 1 command and require zero failures.

- [ ] **Step 5: Commit Task 1**

```bash
git add worker/eval/materialize_table_calibration_cases.py \
  worker/tests/test_materialize_table_calibration_cases.py
git commit -m "feat: prepare explicit calibration experiment cases"
```

---

### Task 2: Deterministic paired reconstruction and metrics

**Files:**
- Modify: `worker/eval/run_openai_table_calibration_experiment.py`
- Create: `worker/eval/compare_placement_calibrations.py`
- Modify: `worker/tests/test_openai_table_calibration_experiment.py`
- Create: `worker/tests/test_compare_placement_calibrations.py`

**Interfaces:**
- Consumes:
  - `calibration_matrix(calibration: Mapping[str, Any]) -> np.ndarray`
  - `reconstruct_existing_match(match, points, detections, calibration) -> dict`
  - accepted result shape from `run_openai_table_calibration_experiment.py`
- Produces:
  - `freeze_case_input_hash(cases_path: Path, lock_path: Path) -> str`
  - `run_unreferenced_experiment(...) -> dict`
  - `calibration_from_consensus(case: Mapping, result: Mapping) -> dict | None`
  - `landing_zone(landing: Mapping, receiver_side: str) -> str | None`
  - `compare_placements(current: Mapping, proposed: Mapping, match_id: str) -> dict`
  - `compare_case(case: Mapping, result: Mapping, root: Path) -> dict`
  - CLI output `comparison-results.json`

- [ ] **Step 1: Write failing identity and displacement tests**

Use two synthetic placement payloads with:

```python
identity = {
    "match_id": "m1",
    "point_idx": 18,
    "server_side": "far",
    "shot_seq": 1,
    "phase": "serve",
    "hitter_side": "far",
}
```

Assert:

- a 0.10 m lateral shift reports `10.0` cm;
- a left-to-middle third change increments `lateral_flips` and `zone_flips`;
- the same shot number in a different server hypothesis never matches;
- missing or untrusted landings contribute to arm-only counts rather than a
  false pair;
- 5 cm boundary-band entry and exit are counted;
- percentile output is deterministic for one, two, and many matches.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_compare_placement_calibrations -v
```

Expected: module import failure.

- [ ] **Step 3: Implement the immutable no-reference provider mode**

Extend `run_case(...)` to accept `reference: dict | None`. When no reference
is supplied, retain `accuracy.status = "not_measured"` and set
`reference_sha256 = None`; do not fabricate coordinates.

Implement:

```python
def freeze_case_input_hash(cases_path: Path, lock_path: Path) -> str:
    cases = json.loads(cases_path.read_text())
    locked = {
        "version": cases["version"],
        "model": cases["model"],
        "cases": [
            {
                "match_id": case["match_id"],
                "source_size": case["source_size"],
                "image_size": case["image_size"],
                "image_sha256": [image["sha256"] for image in case["images"]],
            }
            for case in cases["cases"]
        ],
    }
    digest = _canonical_sha256(locked)
    payload = {"version": 1, "sha256": digest, "inputs": locked}
    try:
        with lock_path.open("x") as destination:
            destination.write(json.dumps(payload, indent=2) + "\n")
    except FileExistsError:
        if json.loads(lock_path.read_text()) != payload:
            raise ValueError("prepared comparison inputs changed after lock")
    return digest
```

`run_unreferenced_experiment(...)` must validate every prepared image hash,
freeze `comparison-input-lock.json`, keep append-only run IDs and output
paths, and call `run_case(..., reference=None)` exactly once per case. Add CLI
command `run-unreferenced` with no `--references` argument.

Tests must prove a changed image hash, changed match list, reused run ID, or
output outside the experiment root fails before a provider call.

- [ ] **Step 4: Implement calibration conversion**

Convert the prepared-image consensus back to source dimensions, validate its
corner order, and emit:

```python
{
    "ok": True,
    "table_corners_px": {
        "A_near_1": [x, y],
        "B_near_2": [x, y],
        "C_far_2": [x, y],
        "D_far_1": [x, y],
    },
    "length_axis": [axis_x, axis_y],
    "note": "read-only OpenAI calibration A/B experiment",
}
```

Return `None` when consensus or final validation is not accepted.

- [ ] **Step 5: Implement full-identity landing extraction**

Extract trusted landings only from `ready` or `review` hypotheses with landing
confidence at least `0.70`. Key each landing by:

```python
(
    match_id,
    point_idx,
    server_side,
    shot_seq,
    phase,
    hitter_side,
)
```

Store `u`, `v`, confidence, terminal kind, and canonical receiver-relative
zone. Never infer a match across a missing identity field.

- [ ] **Step 6: Implement metrics and changed-point payloads**

Compute:

- calibration corner displacement;
- per-arm point and hypothesis status counts;
- per-arm trusted landing counts;
- matched and arm-only landing counts;
- median, p90, and maximum table displacement in centimeters;
- lateral, depth, and nine-zone flips;
- boundary-band transitions; and
- sorted `changed_points`, each containing both coordinates and exact clip
  relative path.

All rates use explicit numerators and denominators in JSON.

- [ ] **Step 7: Implement case loading and CLI**

The CLI accepts:

```text
--cases CASES_JSON
--openai-results RESULTS_JSON
--output COMPARISON_RESULTS_JSON
```

It reads local files only, verifies match-ID equality, loads each case's
match JSON and BlurBall file, reconstructs both arms, and writes deterministic
JSON. It never imports worker mutation functions.

- [ ] **Step 8: Run focused tests and confirm GREEN**

Run the Task 2 test command and require zero failures.

- [ ] **Step 9: Commit Task 2**

```bash
git add worker/eval/run_openai_table_calibration_experiment.py \
  worker/eval/compare_placement_calibrations.py \
  worker/tests/test_openai_table_calibration_experiment.py \
  worker/tests/test_compare_placement_calibrations.py
git commit -m "feat: compare placement calibrations deterministically"
```

---

### Task 3: Review report with overlays, heat maps, and point videos

**Files:**
- Create: `worker/eval/render_placement_calibration_comparison.py`
- Create: `worker/tests/test_render_placement_calibration_comparison.py`

**Interfaces:**
- Consumes: `cases.json`, OpenAI results, and `comparison-results.json`.
- Produces: `report/report-data.json`, copied review assets, and
  `report/index.html`.

- [ ] **Step 1: Write failing report tests**

Create a two-case fixture and assert the report:

- says “comparison, not ground truth”;
- includes current and OpenAI outline legends;
- shows explicit match count and excluded duplicate count;
- includes coverage and displacement numerators;
- renders paired current/OpenAI maps for each zone flip;
- places one metadata-only point video under every changed point;
- escapes arbitrary labels and paths;
- contains no R2 URI, response ID, credential, match identity, or absolute
  private path; and
- works when one OpenAI calibration is withheld.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_placement_calibration_comparison -v
```

Expected: module import failure.

- [ ] **Step 3: Implement sanitized report data**

Project only:

- ordinal labels (`Chris Match 1`, etc.);
- calibration metrics and validation scores;
- placement comparison metrics;
- relative frame/clip asset paths; and
- precomputed SVG-safe coordinates.

Copy only the selected representative image and changed-point clips into the
report directory. Reject paths escaping a case root.

- [ ] **Step 4: Implement static HTML rendering**

Render:

- executive recommendation and limitations;
- cross-match metric cards;
- per-match representative-frame calibration overlay;
- displacement grid;
- paired aggregate nine-zone heat maps;
- changed-point cards with paired maps and video; and
- reused Vaibhav/Tripp context in a separate non-paired section.

Use the existing dark PongLens visual language. The HTML must be fully usable
from a local HTTP server without a build step.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the Task 3 command and require zero failures.

- [ ] **Step 6: Commit Task 3**

```bash
git add worker/eval/render_placement_calibration_comparison.py \
  worker/tests/test_render_placement_calibration_comparison.py
git commit -m "feat: render placement calibration comparison"
```

---

### Task 4: Execute the read-only experiment and verify the artifact

**Files:**
- Create locally outside Git:
  `/Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730/`
- Modify docs only if execution reveals a stable operational caveat:
  `docs/operations/openai-table-calibration-experiment.md`

**Interfaces:**
- Consumes: Tasks 1–3 CLIs and existing Keychain-backed worker credentials.
- Produces: completed local experiment and morning-ready report.

- [ ] **Step 1: Run all new and existing calibration tests**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_materialize_table_calibration_cases \
  worker.tests.test_openai_table_calibration_experiment \
  worker.tests.test_vision_table_calibration \
  worker.tests.test_compare_placement_calibrations \
  worker.tests.test_render_placement_calibration_comparison -v
```

- [ ] **Step 2: Materialize the three explicit Chris cases**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/materialize_table_calibration_cases.py prepare \
  --output-dir /Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730 \
  --match-id 8e17b962-e26e-454a-9fe2-8f7c0a3a61de \
  --match-id ebbb8f94-def1-493d-85df-f37c28afe0a7 \
  --match-id d3c7827e-d576-427b-9b79-1e4ebeaf7ee6
```

Verify the materialization log and `production-mutation-audit.json` contain no
write operation.

- [ ] **Step 3: Create an immutable no-reference comparison lock**

Hash `cases.json` and the three prepared image hashes into
`comparison-input-lock.json`. The OpenAI runner for this experiment must
verify that lock before every provider call. No manual corner reference is
fabricated.

- [ ] **Step 4: Run nine OpenAI proposals**

Load the existing Keychain API key into the subprocess environment without
printing it, use run ID `placement-ab-20260730-v1`, and write append-only
results plus usage sidecars.

- [ ] **Step 5: Run paired reconstruction**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/compare_placement_calibrations.py \
  --cases /Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730/cases.json \
  --openai-results /Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730/openai-results.json \
  --output /Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730/comparison-results.json
```

- [ ] **Step 6: Render and serve the report**

Render into `report/`, start a local server on the first available port from
`8771` through `8775`, and record the URL in `report-url.txt`.

- [ ] **Step 7: Browser-audit the report**

Verify:

- every Chris case is present;
- summary numerators equal JSON;
- every zone flip opens its own clip and paired maps;
- withheld states are honest;
- no horizontal overflow at desktop and mobile widths;
- no secrets, response IDs, R2 URIs, or absolute private paths appear; and
- the recommendation is supported by the displayed evidence.

- [ ] **Step 8: Run complete verification**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest discover \
  -s worker/tests -v
npm run test:placement
npm run lint
npm run build
git diff --check
git status --short
```

- [ ] **Step 9: Commit any execution-discovered documentation only**

Do not commit generated reports or private media. Commit source or
documentation changes only after the complete verification passes.
