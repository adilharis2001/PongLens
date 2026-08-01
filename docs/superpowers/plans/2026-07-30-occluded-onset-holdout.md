# Occluded Service-Onset Holdout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backtrack service onset through coherent pose preparation and test first-server decoding on ten sealed, previously unseen production matches.

**Architecture:** Preserve the existing legal-bounce and high-precision player-attribution gates. Add a focused onset backtracker inside `service_motion.py`, reproducible development-label scoring, and deterministic read-only held-out match selection in the experiment runner.

**Tech Stack:** Python 3.12, unittest, OpenCV, MMPose/RTMPose, BlurBall, Supabase REST, R2 media.

## Global Constraints

- The experiment is read-only and cannot update production match or point data.
- No YOLO or AGPL component may be installed, imported, invoked, or bundled.
- The 17 onset labels are development data; production claims use only the sealed fresh-match cohort.
- Require at least five decided held-out matches before recommending a user-facing feature.
- Preserve abstention and the current explicit first-server question below the frozen gates.

---

### Task 1: Backtracked service-motion onset

**Files:**
- Modify: `worker/service_motion.py`
- Modify: `worker/extract_service_motion_rtmpose.py`
- Test: `worker/tests/test_service_motion.py`
- Test: `worker/tests/test_extract_service_motion_rtmpose.py`

**Interfaces:**
- Consumes: COCO-17 near/far pose summaries, BlurBall detections, first-bounce timestamp, and optional audio peaks.
- Produces: `analyze_service_motion(...)` version 2 with `onset_t`, `contact_approach_t`, `contact_t`, and diagnostic feature families.

- [ ] **Step 1: Write failing tests for an early elbow/shoulder preparation that continuously leads to the existing toss and contact phase.**

The hand-derived fixture begins preparation at frame 4 and the wrist/ball
phase at frame 10. Assert that `onset_t == 4 / FPS` while
`contact_approach_t >= 10 / FPS`.

- [ ] **Step 2: Write a failing test proving an isolated early arm movement separated by a multi-frame idle gap does not move onset backward.**

Assert that the returned onset remains at or after the later coherent phase.

- [ ] **Step 3: Run the focused tests and verify both fail because the current sample payload lacks elbow/shoulder/torso motion and no backtracker exists.**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest \
  worker.tests.test_service_motion \
  worker.tests.test_extract_service_motion_rtmpose -v
```

- [ ] **Step 4: Add normalized elbows, shoulders, and hip-center data to `_player_samples`, compute per-frame preparation families, and backtrack with at most one sampled-frame gap.**

Keep player scoring unchanged. Return the existing coherent onset as
`contact_approach_t`, and only replace `onset_t` when an earlier preparation
sequence connects to it.

- [ ] **Step 5: Expand pose extraction to 1.20 seconds before first bounce and verify focused tests pass.**

Run the Step 3 command and expect zero failures.

### Task 2: Reproducible onset-label scoring

**Files:**
- Create: `worker/score_service_onset_labels.py`
- Create: `worker/tests/test_score_service_onset_labels.py`
- Modify: `worker/run_service_motion_experiment.py`
- Test: `worker/tests/test_run_service_motion_experiment.py`

**Interfaces:**
- Consumes: the research export containing `human_label.onset`, frozen `proposal.service_motion`, and newly generated oracle motion.
- Produces: `score_onset_labels(export_payload, cases) -> dict[str, Any]` with frozen and v2 metrics split by stratum.

- [ ] **Step 1: Write failing tests with literal timing fixtures for count, signed error, MAE, threshold buckets, and visible/occluded splits.**

- [ ] **Step 2: Run the new test and verify import failure for `worker.score_service_onset_labels`.**

- [ ] **Step 3: Implement strict source-ID joining and metric calculation without reading labels inside detector input.**

- [ ] **Step 4: Store v2 development metrics under `onset_development` in `results.json`, retaining frozen v1 metrics for comparison.**

- [ ] **Step 5: Run both scoring and orchestration tests and expect zero failures.**

### Task 3: Deterministic fresh-match holdout

**Files:**
- Modify: `worker/run_service_motion_experiment.py`
- Modify: `worker/score_service_motion_experiment.py`
- Test: `worker/tests/test_run_service_motion_experiment.py`
- Test: `worker/tests/test_score_service_motion_experiment.py`

**Interfaces:**
- Consumes: `ResearchProduction.eligible_holdout_matches(excluded_match_ids, 10)`.
- Produces: sealed `holdout-manifest.json`, five opening point calls per match, point-level rotation truth, and match-level first-server results.

- [ ] **Step 1: Write failing orchestration tests proving prior research matches are excluded and exactly ten eligible matches are selected deterministically.**

- [ ] **Step 2: Write failing scoring tests proving fewer than five decisions always remains `research_only`, even at perfect observed precision.**

- [ ] **Step 3: Implement read-only eligibility checks for user-authoritative truth, calibration, five retained clips, and immutable media.**

- [ ] **Step 4: Generalize Stage C to the held-out match IDs and derive expected point servers only after detector inference.**

- [ ] **Step 5: Extend the report with held-out point precision, match precision, coverage, per-match outcomes, and the frozen production gate.**

- [ ] **Step 6: Run focused orchestration and scoring tests and expect zero failures.**

### Task 4: Run, inspect, and package the experiment

**Files:**
- Generate locally: `/Users/adil/Desktop/PongLens-Reports/service-motion-holdout-20260730/results.json`
- Generate locally: `/Users/adil/Desktop/PongLens-Reports/service-motion-holdout-20260730/report.md`
- Generate locally: `/Users/adil/Desktop/PongLens-Reports/service-motion-holdout-20260730/holdout-manifest.json`
- Modify: `docs/superpowers/specs/2026-07-30-occluded-onset-holdout-design.md` only if the executed environment differs from the frozen design.

**Interfaces:**
- Consumes: `/Users/adil/Downloads/ponglens-serve-detection-research (2).json`, official RTMPose runtime, production read-only credentials, BlurBall, and cached research media.
- Produces: the evidence-backed production recommendation.

- [ ] **Step 1: Run the full worker test suite relevant to service motion.**

- [ ] **Step 2: Run the experiment with the completed export and a new output directory so the prior sealed manifests cannot be reused accidentally.**

- [ ] **Step 3: Run the scorer, inspect every decided held-out match, and confirm detector inputs contain no truth fields.**

- [ ] **Step 4: Record compute totals, failures, and the exact recommendation.**

- [ ] **Step 5: Run Python compilation, JavaScript tests affected by research output, git diff checks, and the YOLO/Ultralytics purge guard before any completion claim.**

