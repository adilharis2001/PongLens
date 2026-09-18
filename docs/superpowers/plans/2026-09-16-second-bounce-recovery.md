# Second-bounce Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover a trustworthy serve landing when the detector misses the server-side first bounce, without inventing landings for service errors or occluded balls.

**Architecture:** Add one pure post-solver recovery function to `placement_reconstruction.py`. It uses the existing serve anchor, bounce candidates, and receiver-side contact labels, then runs independently for the near and far hypotheses before the payload status is computed.

**Tech Stack:** Python 3, unittest, existing placement v3 JSON contract.

**Spec:** `docs/research/2026-09-16-second-bounce-recovery/README.md`

## Global Constraints

- Preserve both physical-server hypotheses.
- Do not recover without receiver-contact evidence.
- Do not retain rally shots assembled from the rejected serve pair.
- Keep the existing behavior when `serve_s` is absent.

---

### Task 1: Pin reviewed recovery and refusals

**Files:**
- Create: `worker/tests/test_placement_second_bounce_recovery.py`

**Interfaces:**
- Consumes: `recover_second_bounce(hypothesis, candidates, server_side, serve_s)`.
- Produces: regression coverage for Chris 5, Chris 14, Christine 30, and both Julian service errors.

- [x] Write tests with the reviewed event times and table halves.
- [x] Run the new test file and verify it fails because the recovery function does not exist.

### Task 2: Recover the landing before the receiver's first return

**Files:**
- Modify: `worker/placement_reconstruction.py`
- Test: `worker/tests/test_placement_second_bounce_recovery.py`

**Interfaces:**
- Produces: `recover_second_bounce(...) -> dict[str, Any]` and applies it before placement payload status is computed.

- [x] Select the first receiver contact after the serve anchor.
- [x] Select a high-confidence receiver-half bounce 0.05–0.45 seconds before that contact and 0.25–1.35 seconds after the anchor.
- [x] Replace only a missing, later, or invalid serve landing.
- [x] Emit one ready serve shot with `serve_first_bounce_missing` evidence and discard shots assembled from the rejected pair.
- [x] Run the focused tests until they pass.

### Task 3: Regression and release evidence

**Files:**
- Modify: `docs/research/2026-09-16-second-bounce-recovery/README.md`

**Interfaces:**
- Consumes: the focused implementation and existing placement suite.
- Produces: exact verification commands and corpus outcome.

- [x] Run the placement reconstruction suite.
- [x] Replay the local scored corpus and compare proposal/refusal counts against the reviewed labels.
- [x] Record what was verified and any dependency-limited checks.
- [x] Commit the isolated branch only after the checks pass.
