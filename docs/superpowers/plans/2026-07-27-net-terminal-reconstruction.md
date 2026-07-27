# Net-Terminal Placement Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover edge landings and correctly terminate rallies when audiovisual evidence indicates that the ball hit the net.

**Architecture:** Keep candidate extraction side-neutral, but retain slightly out-of-bounds projections in a marked, lower-confidence safety band and attach a nearest tracked ball position to unmatched audio impacts. In the solver, offer a contextual net-terminal transition only when a shot is already open and near-net spatial evidence is paired with audio or explicit net suggestion evidence. Mark observed terminals as absorbing so rebound motion cannot create later shots.

**Tech Stack:** Python 3, NumPy, `unittest`, existing BlurBall/audio reconstruction pipeline.

## Global Constraints

- Do not let audio alone decide that an impact is a net collision.
- A net transition requires an open shot plus near-net spatial evidence.
- Preserve both physical-server hypotheses and all current suppression rules.
- Retained safety-band projections must carry lower evidence than fully plausible table projections.
- Once an observed net/out terminal is accepted, later candidates must not create new shots.
- Use test-driven development: each production behavior starts with a failing test.
- Rerender all 17 Vaibhab points with the user-confirmed server truth before evaluating the result.

---

### Task 1: Retain Calibrated Edge Landings and Localize Audio Impacts

**Files:**
- Modify: `worker/placement_reconstruction.py`
- Test: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Produces: candidate fields `projection_safety_band: bool`, `u`, `v`, `x`, `y`, and `projection_frame`.
- Consumes: existing detections, homography, FPS, and unmatched audio impact times.

- [ ] **Step 1: Add a failing point-4 regression test**

Add a regression test that reconstructs fixture point 4 and asserts candidate 5 retains approximately `u=1.5904`, `v=2.2409`, is marked `projection_safety_band`, and appears as shot 2's landing under the narrated `far` server hypothesis.

- [ ] **Step 2: Verify the point-4 test fails**

Run:

```bash
python3 -m unittest worker.tests.test_placement_reconstruction.VaibhabRegressionTests.test_point_four_retains_wide_edge_return
```

Expected: failure because candidate 5 currently has `u=None`, `v=None`.

- [ ] **Step 3: Add a failing unmatched-audio localization test**

Create a monotonic five-frame detector track with an unmatched audio impact at the middle frame and assert the emitted `impact` candidate includes the nearest detection's projected `u`, `v`, `x`, `y`, and `projection_frame`.

- [ ] **Step 4: Verify the audio localization test fails**

Run its focused `unittest` target. Expected: failure because unmatched audio candidates currently have no position.

- [ ] **Step 5: Implement the projection safety band and nearest-position attachment**

Retain projections inside an expanded safety band around the calibrated table, mark candidates outside the current strict bounds, and reduce their visual confidence. For unmatched audio, attach the nearest tracked position only when its frame is within 60 ms of the audio time; use unbounded projection coordinates as diagnostic spatial evidence.

- [ ] **Step 6: Run focused and full reconstruction tests**

Run:

```bash
python3 -m unittest worker.tests.test_placement_reconstruction
```

Expected: all tests pass.

### Task 2: Contextual Net Terminals and Absorbing Rally State

**Files:**
- Modify: `worker/placement_reconstruction.py`
- Test: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Consumes: localized candidate `v`, audio confidence, candidate kind, open-shot contact time, and match suggestion.
- Produces: a shot terminal with `kind="net"` and an absorbing `terminal_reached` solver state.

- [ ] **Step 1: Add a failing point-9-style audio-net test**

Build a legal far-server sequence ending with a far paddle contact followed 80–350 ms later by a strong localized audio impact within 0.45 m of the net. Assert the final far shot owns a `net` terminal and no `non_alternating_contacts` reason is emitted.

- [ ] **Step 2: Verify the audio-net test fails**

Run the focused test. Expected: the impact is currently interpreted as another paddle contact.

- [ ] **Step 3: Add a failing point-8-style visual-net and rebound test**

Build a legal near-server sequence ending with a far paddle contact followed by an audio-supported visual reversal within 0.35 m of the net, then add rebound bounce candidates. Assert the far shot terminates at the net and no later rebound shot is created.

- [ ] **Step 4: Verify the visual-net/rebound test fails**

Run the focused test. Expected: the reversal starts a new hitter's shot and rebound bounces create additional shots.

- [ ] **Step 5: Implement contextual net alternatives**

When an open shot exists, allow:

- a strong localized audio impact (`audio_confidence >= 2.5`) 40–450 ms after contact and within 0.45 m of the net;
- an audio-supported visual contact reversal (`audio_confidence >= 0.75`) 40–350 ms after contact and within 0.35 m of the net;
- a near-net bounce when the upstream suggestion explicitly says `hit into net`.

The alternative transition attaches the terminal to the open shot, scores the fused evidence, and marks `terminal_reached=True`. Terminal states carry forward without candidate skip penalties or new transitions.

- [ ] **Step 6: Run focused and full reconstruction tests**

Run:

```bash
python3 -m unittest worker.tests.test_placement_reconstruction
```

Expected: all tests pass.

### Task 3: Match Rerender, Regression Comparison, and Integration

**Files:**
- Modify only if required by verified integration findings: `worker/eval/render_placement_match.py`
- Test: `worker/tests/test_placement_reconstruction.py`
- Generate: `/tmp/ponglens-placement-v3/vaibhab-net-terminal-20260727/`

**Interfaces:**
- Consumes: the completed reconstruction changes and `/tmp/ponglens-placement-v3/vaibhab-final-20260726-video/server-truth-20260727.json`.
- Produces: a fresh 17-point HTML/video review and a before/after diagnostic summary for points 4, 8, 9, and 10.

- [ ] **Step 1: Rerender the full match into a new output directory**

Use the existing match JSON, BlurBall detections, audio candidates, raw video, and user-confirmed server truth. Do not overwrite the current baseline report.

- [ ] **Step 2: Compare affected point hypotheses**

Record server, status, confidence, hard reasons, shot ownership, landing event IDs, and terminal kind before and after for points 4, 8, 9, and 10.

- [ ] **Step 3: Validate generated artifacts**

Assert the report contains 17 rows, each corrected point has a non-empty SVG and MP4, point 4 contains drawable shot-2 geometry, and points 8/9 end with a net terminal without post-terminal shots.

- [ ] **Step 4: Run final verification**

Run:

```bash
python3 -m unittest worker.tests.test_placement_reconstruction
python3 -m py_compile worker/placement_reconstruction.py worker/eval/render_placement_match.py
git diff --check
```

Expected: all tests and checks pass.

- [ ] **Step 5: Request code review and integrate only after a clean verdict**

Review the whole branch against its base, resolve all Critical/Important findings, then fast-forward PongLens `main` and push only after the rerender demonstrates improvement without new contradictions.
