# Serve Review Action Jumps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add candidate-action jump buttons to every reviewable point.

**Architecture:** The static renderer derives a bounded, anonymous
`likely_actions` list from existing reconstruction evidence. The browser UI
renders the list below the video and seeks to the exact event timestamp.

**Tech Stack:** Python `unittest`, static HTML, CSS, JavaScript.

## Global Constraints

- Do not change predictions, confidence, scoring, or references.
- Prefer accepted events, then visual geometry candidates.
- Use audio-only impacts only when no visual event exists.
- Keep at most four chronological, deduplicated actions.
- Candidate buttons are navigation aids, not truth labels.

---

### Task 1: Candidate Extraction and Jump Controls

**Files:**
- Modify: `worker/eval/render_serve_detection_experiment.py`
- Modify: `worker/tests/test_render_serve_detection_experiment.py`

**Interfaces:**
- Produces: `likely_actions: list[dict]` on every report point.
- Every action contains only `kind`, `t`, `source`, and `confidence`.

- [ ] **Step 1: Write failing renderer tests**

Add reconstruction candidates to the report fixture and assert that
`report-data.json` contains no more than four chronological visual actions.
Assert that `index.html` contains `Jump to likely action` and exact-timestamp
seek behavior.

- [ ] **Step 2: Run the test and confirm expected failure**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_serve_detection_experiment -v
```

Expected: failure because `likely_actions` and the controls are absent.

- [ ] **Step 3: Implement the minimal extraction and controls**

Add a private extraction helper that deduplicates candidates within 0.18
seconds and caps the list at four. Render buttons below the video. On click:

```javascript
video.currentTime = actionTime;
video.pause();
```

- [ ] **Step 4: Run renderer and full worker tests**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_render_serve_detection_experiment -v
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest discover \
  -s worker/tests
```

- [ ] **Step 5: Regenerate and verify the live report**

Render the existing sealed results, reload `http://127.0.0.1:8772/`, click a
candidate on `case-001-point-008`, and verify the video seeks to 2.60 seconds
without creating a label.

- [ ] **Step 6: Commit**

```bash
git add worker/eval/render_serve_detection_experiment.py \
  worker/tests/test_render_serve_detection_experiment.py
git commit -m "feat: jump to likely serve actions"
```
