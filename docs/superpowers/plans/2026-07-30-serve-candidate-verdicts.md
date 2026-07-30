# Serve Candidate Verdicts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent correct/incorrect judgments beside likely-action jumps.

**Architecture:** Extend the browser-local reference record with anonymous
candidate judgments. Render verdict controls beside each action and preserve
them through the existing save/export path.

**Tech Stack:** Python `unittest`, static HTML, CSS, JavaScript.

## Global Constraints

- Verdicts never change predictions or confidence.
- Only a correct contact candidate may fill contact time.
- Verdict controls never seek the video.
- Existing reference fields and privacy guarantees remain intact.

---

### Task 1: Candidate Verdict Controls

**Files:**
- Modify: `worker/eval/render_serve_detection_experiment.py`
- Modify: `worker/tests/test_render_serve_detection_experiment.py`

**Interfaces:**
- Produces: `action_judgments` in browser-local and exported references.

- [ ] Write failing assertions for verdict controls and export fields.
- [ ] Run renderer tests and confirm failure from missing controls.
- [ ] Add verdict controls, persistence, selected styling, and contact-only
  autofill.
- [ ] Run renderer and full worker tests.
- [ ] Regenerate the sealed report and browser-test point 008.
- [ ] Commit with `feat: grade likely serve actions`.
