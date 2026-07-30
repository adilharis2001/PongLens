# Serve Candidate Event Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent event-taxonomy labels beside likely-action jumps.

**Architecture:** Extend the browser-local reference record with anonymous
candidate judgments. Render an event-label select beside each action and preserve
them through the existing save/export path.

**Tech Stack:** Python `unittest`, static HTML, CSS, JavaScript.

## Global Constraints

- Labels never change predictions or confidence.
- Serve contact and serve-bounce labels fill only their matching fields.
- Label controls never seek the video.
- Existing reference fields and privacy guarantees remain intact.
- Existing binary verdicts remain stored but are not interpreted as labels.

---

### Task 1: Candidate Event-Label Controls

**Files:**
- Modify: `worker/eval/render_serve_detection_experiment.py`
- Modify: `worker/tests/test_render_serve_detection_experiment.py`

**Interfaces:**
- Produces: `action_judgments[].event_label` in browser-local and exported references.

- [ ] Write failing assertions for taxonomy controls and export fields.
- [ ] Run renderer tests and confirm failure from missing controls.
- [ ] Add label controls, persistence, and serve-event autofill.
- [ ] Run renderer and full worker tests.
- [ ] Regenerate the sealed report and browser-test point 008.
- [ ] Commit with `feat: label likely serve actions`.
