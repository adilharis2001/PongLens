# Serve Review Frame Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact one-, two-, and three-frame video navigation to the serve review report.

**Architecture:** The renderer exposes prepared clip FPS and frame count in
anonymous report data. Static browser controls compute a clamped frame target,
seek the video, pause it, and update a live readout.

**Tech Stack:** Python `unittest`, static HTML, CSS, JavaScript, HTML5 video.

## Global Constraints

- Use each prepared clip's recorded FPS.
- Clamp targets to the valid zero-based frame range.
- Frame controls never mutate labels or predictions.
- Preserve all privacy constraints.

---

### Task 1: Frame Metadata and Controls

**Files:**
- Modify: `worker/eval/render_serve_detection_experiment.py`
- Modify: `worker/tests/test_render_serve_detection_experiment.py`

**Interfaces:**
- Produces: point fields `fps: float` and `frame_count: int`.
- Produces: browser `seekFrames(delta: number)` behavior.

- [ ] Write failing tests for metadata, six buttons, and live readout.
- [ ] Run renderer tests and confirm the controls are absent.
- [ ] Add safe metadata propagation and clamped frame navigation.
- [ ] Run renderer and full worker tests.
- [ ] Regenerate the sealed report and browser-test frame stepping.
- [ ] Commit with `feat: navigate serve video by frame`.
