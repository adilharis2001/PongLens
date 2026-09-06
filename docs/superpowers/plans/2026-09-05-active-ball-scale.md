# Active-ball Scale Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an 810-example Gemini-labeled corpus from nine additional recordings, train a small owned detector locally, and report frozen whole-match test results.

**Architecture:** A deterministic corpus builder extracts three original-resolution frames and a short context clip from fixed match splits. The existing Prompt 3 Gemini runner labels the corpus without seeing references. A training adapter turns those responses into explicit machine-provenance labels, fine-tunes a table-conditioned YOLO26 nano detector locally, selects confidence on validation recordings, and scores untouched test recordings plus the existing human audit.

**Tech Stack:** Python 3.12, OpenCV, NumPy, PyTorch MPS, Gemini 3.8 Flash REST API, unittest, Next.js 15, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-05-active-ball-scale-design.md`

## Global Constraints

- Run training and inference on the Mac Studio; use no cloud GPU.
- Never send human labels, prior predictions or evaluation results to Gemini.
- Split by full recording and reject duplicate source hashes across splits.
- Keep Gemini provenance distinct from human ground truth.
- Preserve all raw responses and frozen protocol fingerprints.
- Do not modify the production worker, iOS app, Modal worker or released BlurBall path.
- A wrong-table selection counts as a false localization; no hard table-polygon output gate.

---

### Task 1: Deterministic cross-match corpus

**Files:**
- Create: `worker/active_ball_scale_data.py`
- Create: `scripts/research/build-active-ball-scale-corpus.py`
- Test: `worker/tests/test_active_ball_scale_data.py`

**Interfaces:**
- Produces `sample_times(points, duration, rally_count, gap_count, seed) -> list[tuple[float,str]]`.
- Produces an 810-row `manifest.json` and Gemini-compatible `inputs.json` plus `context/{id}.mp4` and `frames/{id}/{0,1,2}.jpg`.

- [ ] Write tests proving deterministic counts, edge clearance, gap/rally categories and full-recording split isolation.
- [ ] Run the tests and confirm they fail because the module is absent.
- [ ] Implement the sampling helpers and extraction CLI with exact dimension/timestamp checks.
- [ ] Run the new tests and all existing active-ball data tests.
- [ ] Build the 810-example local corpus and verify 90 rows per source and 450/180/180 by split.

### Task 2: Frozen Gemini Prompt 3 labeling

**Files:**
- Modify: `scripts/research/gemini-active-ball.py`
- Create: `scripts/research/gemini-active-ball-scale.py`
- Create: `scripts/research/materialize-active-ball-teacher-labels.py`
- Test: `worker/tests/test_active_ball_scale_data.py`

**Interfaces:**
- The runner consumes the scale corpus without reference labels and writes immutable raw response files.
- `teacher_manifest(rows, responses, provenance) -> list[dict]` adds only usable Prompt 3 labels with `gemini_3_8_flash_prompt3` provenance.

- [ ] Add failing tests for normalized coordinate conversion, missing/invalid responses and preserved split/source metadata.
- [ ] Run the tests and confirm the expected failures.
- [ ] Implement the exact Prompt 3 wrapper and label materializer.
- [ ] Run a 20-example smoke batch; verify response structure, model version and cost before the full run.
- [ ] Complete all 810 requests with the unchanged protocol and record aggregate state/venue counts and estimated cost.

### Task 3: Small detector and validation-selected threshold

**Files:**
- Create: `worker/active_ball_yolo.py`
- Create: `worker/train_active_ball_yolo.py`
- Create: `scripts/research/build-active-ball-yolo-dataset.py`
- Test: `worker/tests/test_active_ball_teacher.py`

**Interfaces:**
- Produces table-conditioned 1280-pixel detector inputs and one-class YOLO labels.
- Fine-tunes YOLO26 nano with MPS and selects the checkpoint from validation only.
- Writes the checkpoint, training history, fixed data split and package version.

- [ ] Write failing tests for selected-table conditioning, normalized visible boxes and true negative images.
- [ ] Run the tests and confirm the expected failures.
- [ ] Implement focused-frame construction, YOLO dataset conversion, MPS training and validation confidence selection.
- [ ] Run training with a fixed seed and persist training history and the chosen operating point.
- [ ] Confirm checkpoint training IDs contain only train recordings and threshold selection contains only validation recordings.

### Task 4: Frozen test evaluation and human audit

**Files:**
- Create: `worker/evaluate_active_ball_yolo.py`
- Test: `worker/tests/test_active_ball_teacher.py`
- Modify: `docs/research/2026-09-05-active-ball/README.md`

**Interfaces:**
- Produces denominator-preserving metrics for proposal coverage and final model predictions by split, source and venue.
- Writes `test-summary.json`, `human-audit-summary.json`, predictions and review overlays.

- [ ] Write failing tests for visible misses, false selections, wrong centers, proposal misses and per-group totals.
- [ ] Run the tests and confirm the expected failures.
- [ ] Implement scoring and inference using the frozen checkpoint operating point.
- [ ] Evaluate validation and test once, then run the unchanged model over the existing 178 human references.
- [ ] Record what the test establishes and what continuous tracking still requires.

### Task 5: Verification and review

**Files:**
- Modify: `docs/research/2026-09-05-active-ball/README.md`

**Interfaces:**
- Consumes all frozen artifacts and produces the reviewable research record.

- [ ] Run all active-ball Python tests and research TypeScript tests.
- [ ] Run `npm run build` in the isolated worktree and inspect the full exit status.
- [ ] Verify no Gemini process or local server remains running and the git worktree contains only intended changes.
- [ ] Request independent code and evidence review; resolve every important finding.
- [ ] Commit and push the research scripts and aggregate results without production promotion.
