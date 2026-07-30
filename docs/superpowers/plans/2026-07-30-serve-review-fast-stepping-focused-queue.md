# Fast Frame Stepping and Focused Serve Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repeated media reloads from frame stepping and make a deterministic, representative 60-point queue the report's default review surface.

**Architecture:** The Python renderer will calculate anonymous focused point keys from the existing primary prediction arm and embed them in `report-data.json`. The static JavaScript will filter to those keys by default, fetch only the selected clip into a seekable in-memory blob, and use one in-place seek path for action jumps and adjacent frame navigation.

**Tech Stack:** Python standard library, static HTML/CSS/JavaScript, `unittest`, browser-based verification.

## Global Constraints

- Keep all 406 points accessible through `All points`.
- Include all primary-arm `high_confidence` points before sampling withheld points.
- The target focused queue size is 60.
- Sampling must use only anonymous case, reason, and point-key data.
- Frame stepping must never change `src`, call `load()`, or mutate labels.
- Selecting a point may fetch and load that one clip into a blob URL.
- Existing labels must remain stored under the unchanged `ponglens-serve-references-v1` key.

---

### Task 1: Deterministic Focused Review Queue

**Files:**
- Modify: `worker/eval/render_serve_detection_experiment.py`
- Test: `worker/tests/test_render_serve_detection_experiment.py`

**Interfaces:**
- Consumes: anonymous point dictionaries containing `case_key`, `point_key`, and `predictions`.
- Produces: `_focused_review_keys(points, target=60) -> list[str]` and top-level `focused_point_keys` in `report-data.json`.

- [ ] **Step 1: Write failing queue tests**

Import `_focused_review_keys`, construct more than 60 anonymous points across
three cases and multiple withheld reasons, and assert:

```python
focused = _focused_review_keys(points, target=60)
self.assertEqual(len(focused), 60)
self.assertTrue(set(high_confidence_keys).issubset(focused))
self.assertEqual(focused, _focused_review_keys(points, target=60))
self.assertEqual(
    {point["case_key"] for point in points if point["point_key"] in focused},
    {"case-001", "case-002", "case-003"},
)
```

Extend the report test to require `focused_point_keys` and the `Focused review`
filter.

- [ ] **Step 2: Run the focused renderer tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_render_serve_detection_experiment -v
```

Expected: failure because `_focused_review_keys` and the focused filter do not
exist.

- [ ] **Step 3: Implement deterministic stratification**

Add a primary-prediction helper and:

```python
def _focused_review_keys(points, target=60):
    high = [
        point["point_key"]
        for point in points
        if _primary_prediction(point).get("status") == "high_confidence"
    ]
    buckets = defaultdict(list)
    for point in points:
        prediction = _primary_prediction(point)
        if prediction.get("status") == "needs_review":
            buckets[
                (point["case_key"], str(prediction.get("reason") or "unknown"))
            ].append(point["point_key"])
    for values in buckets.values():
        values.sort(key=lambda key: hashlib.sha256(key.encode()).hexdigest())
    # Round-robin over sorted bucket keys until target is reached.
```

Write the returned keys into `report-data.json`.

- [ ] **Step 4: Make focused review the default filter**

Add:

```html
<option value="focused" selected>Focused review</option>
```

Update `filtered()` to use `data.focused_point_keys`, display the queue count,
and initially select the first filtered point. Keep `All points`,
`high_confidence`, `needs_review`, `unavailable`, and `Labeled`.

- [ ] **Step 5: Run focused renderer tests and verify GREEN**

Run the command from Step 2. Expected: all renderer tests pass.

### Task 2: In-Place Frame Stepping

**Files:**
- Modify: `worker/eval/render_serve_detection_experiment.py`
- Test: `worker/tests/test_render_serve_detection_experiment.py`

**Interfaces:**
- Consumes: selected clip path, frame delta, current video time, clip FPS, and frame count.
- Produces: `loadActiveClip()` and `seekLoadedVideo(seconds)` used by action and frame jumps.

- [ ] **Step 1: Write failing no-reload tests**

Assert the generated report contains `preload="auto"`,
`function seekLoadedVideo`, `fetch(active.clip_path)`,
`URL.createObjectURL`, and `URL.revokeObjectURL`. Isolate the `seekFrames`
function text and assert it calls `seekLoadedVideo` and does not call a
media-reloading path.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_render_serve_detection_experiment -v
```

Expected: failure because the selected clip is not yet materialized as a
seekable blob and frame navigation still uses the media-reloading seek path.

- [ ] **Step 3: Implement loaded-media seeking**

Add:

```javascript
function seekLoadedVideo(seconds) {
  const video = $("video");
  const duration = Number.isFinite(video.duration)
    ? video.duration : Number(active.duration || 0);
  const seekTime = Math.max(0, Math.min(Number(seconds) || 0, duration));
  video.pause();
  const apply = () => {
    video.currentTime = seekTime;
    updateFrameReadout();
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener("loadedmetadata", apply, {once: true});
}
```

Fetch the selected clip once, assign the resulting blob URL to the video, and
revoke the prior blob URL after a new selection loads. Change `seekFrames` and
likely-action jumps to call `seekLoadedVideo`, and set the video element to
`preload="auto"`.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run the command from Step 2. Expected: all renderer tests pass.

### Task 3: Regenerate and Verify the 406-Point Report

**Files:**
- Generated output: `/Users/adil/Desktop/PongLens-Reports/serve-detection-20260730-v3/report`

**Interfaces:**
- Consumes: existing case materialization and serve experiment results.
- Produces: the revised local review page at port 8772.

- [ ] **Step 1: Regenerate the report**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/eval/render_serve_detection_experiment.py \
  --root /Users/adil/Desktop/PongLens-Reports/serve-detection-20260730-v3 \
  --results /Users/adil/Desktop/PongLens-Reports/serve-detection-20260730-v3/serve-results-serve-dev-v1.json
```

- [ ] **Step 2: Verify the focused queue in-browser**

Confirm the default list has 60 points, includes all 30 primary-arm automated
points, and `All points` exposes 406.

- [ ] **Step 3: Verify in-place stepping in-browser**

From frame zero, click `+1`, `+3`, and `−2`; confirm frames 1, 4, and 2.
Confirm repeated `−3` clamps at zero, `currentSrc` does not change, and the
contact field remains empty.

- [ ] **Step 4: Run full verification**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest discover -s worker/tests
node -e '/* parse every inline script in the generated report */'
git diff --check
curl -sS -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:8772/?v=focused-review"
```

Expected: all tests pass, JavaScript parses, diff check is clean, and HTTP is
200.

- [ ] **Step 5: Commit the implementation**

```bash
git add worker/eval/render_serve_detection_experiment.py \
  worker/tests/test_render_serve_detection_experiment.py
git commit -m "feat: focus and speed up serve review"
```
