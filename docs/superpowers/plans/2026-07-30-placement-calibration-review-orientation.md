# Placement Calibration Review Orientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the scored server, physical player positions, and hypothesis-match status on every Current-versus-OpenAI point comparison.

**Architecture:** Extend the static report renderer with a deterministic point-context resolver that ports the app's ITTF rotation and game-boundary rules over the frozen experiment manifest. Sanitize that context into report data, then render identical orientation labels on both mini-maps and an explicit server/hypothesis status above them.

**Tech Stack:** Python 3.12, `unittest`, static HTML/CSS, existing PongLens experiment manifests.

## Global Constraints

- Derive server and positions only from frozen manifest truth and point metadata.
- Do not infer identity from clothing or video pixels.
- Keep alternate physical-server hypotheses visible and explicitly labeled.
- Say “unresolved” instead of guessing when first server or initial side is unavailable.
- Do not change the placement reconstruction or production data.

---

### Task 1: Resolve per-point server and physical orientation

**Files:**
- Modify: `worker/eval/render_placement_calibration_comparison.py`
- Test: `worker/tests/test_render_placement_calibration_comparison.py`

**Interfaces:**
- Consumes: prepared case `truth` and ordered `points`.
- Produces: `_point_contexts(prepared) -> dict[int, dict]` with `server`, `server_source`, `user_side`, `opponent_side`, and `game_number`.

- [ ] **Step 1: Write failing rotation and side-swap tests**

Add a test with a user-first point that explicitly ends game one, followed by a second point. Assert point one resolves to user-serving/user-near and point two resolves to opponent-serving/user-far.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_render_placement_calibration_comparison -v
```

Expected: failure because `_point_contexts` does not exist.

- [ ] **Step 3: Implement the minimum deterministic resolver**

Port the existing `computeServing` and `stepBoundaryWalk` behavior needed by the frozen manifest: ordered points, overrides as anchors, lets that do not advance rotation, two-serve blocks, deuce alternation, game boundaries, first-server alternation, and player-side swaps.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same `unittest` command and expect all report tests to pass.

- [ ] **Step 5: Commit**

```bash
git add worker/eval/render_placement_calibration_comparison.py worker/tests/test_render_placement_calibration_comparison.py
git commit -m "feat: resolve placement review point context"
```

### Task 2: Render server and orientation labels

**Files:**
- Modify: `worker/eval/render_placement_calibration_comparison.py`
- Test: `worker/tests/test_render_placement_calibration_comparison.py`

**Interfaces:**
- Consumes: Task 1 point context and changed-point `server_side`.
- Produces: sanitized changed-point fields `resolved_server`, `server_source`, `user_side`, `opponent_side`, `hypothesis_player`, and `hypothesis_matches_server`.

- [ ] **Step 1: Write the failing report behavior test**

Update the representative fixture with frozen truth and points. Assert the HTML includes:

```text
System’s scored server
You served
You · near / bottom
Chris · far / top
Uses the You-serving hypothesis
Matches scored server
Receiver-relative landing
```

Also assert sanitized report data contains the context fields but no private match identifier.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_render_placement_calibration_comparison -v
```

Expected: failure because the new copy and report fields are absent.

- [ ] **Step 3: Implement report data and HTML**

Attach resolved context during `_sanitize_case`. Render a server-status strip on each changed card. Add far/top and near/bottom labels to `_point_map`, use the same labels for Current and OpenAI, and describe zones as receiver-relative. Style matching and alternate hypotheses distinctly without hiding either.

- [ ] **Step 4: Run focused and calibration suites**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_placement_calibration_comparison \
  worker.tests.test_compare_placement_calibrations -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/eval/render_placement_calibration_comparison.py worker/tests/test_render_placement_calibration_comparison.py
git commit -m "feat: explain server orientation in calibration review"
```

### Task 3: Regenerate and validate the report

**Files:**
- Regenerate: `/Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730/report/index.html`
- Regenerate: `/Users/adil/Desktop/PongLens-Reports/placement-calibration-ab-20260730/report/report-data.json`

**Interfaces:**
- Consumes: frozen `cases.json`, `comparison-results.json`, and historical results.
- Produces: updated report at `http://127.0.0.1:8771/`.

- [ ] **Step 1: Regenerate the static report**

Run the renderer against the existing frozen experiment inputs.

- [ ] **Step 2: Run repository verification**

Run the complete worker suite, `git diff --check`, and the report-specific browser checks.

- [ ] **Step 3: Verify the live report**

Confirm desktop and 390-pixel layouts have no horizontal overflow, every changed card has one server strip and two orientation-labeled maps, media has no errors, and the console is clean.

- [ ] **Step 4: Leave the report server running**

Verify both `/` and a sample video return HTTP 200 from `http://127.0.0.1:8771/`.
