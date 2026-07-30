# Placement Server Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer correct who served, label the corresponding physical event, and prevent stale predictions from entering the experiment.

**Architecture:** Keep each frozen research proposal immutable and store `corrected_server` in the assignment's JSONB human label. A pure helper derives the effective hitter and receiver for display; comparison and scoring helpers independently enforce that predictions are compatible only with the proposal's original server.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase JSONB assignments, Node test runner, Python `unittest`.

## Global Constraints

- Never display or score predictions generated for a different server hypothesis.
- A corrected-server point remains labelable and submittable without exclusion.
- Changing server clears the current answer and reveal state.
- Existing labels hydrate with `corrected_server: null`.
- No database migration.

---

### Task 1: Model corrected server state and effective event identity

**Files:**
- Modify: `src/lib/research/placementCalibration.ts`
- Modify: `src/lib/research/placementCalibration.test.ts`
- Modify: `src/app/research/placement-calibration/placementCalibrationView.ts`
- Modify: `src/app/research/placement-calibration/placementCalibrationView.test.ts`

**Interfaces:**
- Produces: `PlacementServer = "user" | "opponent"`
- Produces: `effectivePlacementProposal(proposal, correctedServer)`
- Produces: `placementPredictionsCompatible(proposal, correctedServer)`
- Produces: `changePlacementServer(label, correctedServer)`

- [ ] **Step 1: Write failing model tests**

Add tests asserting that a return initially attributed to the user becomes the
user's return to the opponent when corrected to opponent-server, that a serve
and odd/even rally hitter are derived correctly, and that changing server
clears result, coordinates, certainty, reveal data, and blind snapshot.

- [ ] **Step 2: Run the focused tests and observe RED**

Run:

```bash
npm run test:research -- src/lib/research/placementCalibration.test.ts src/app/research/placement-calibration/placementCalibrationView.test.ts
```

Expected: failure because the correction interfaces do not exist.

- [ ] **Step 3: Implement the correction model**

Add `corrected_server` to `PlacementCalibrationHumanLabel` and
`PlacementAnalysisLabel`. Implement the effective proposal by deriving the
server's physical side from `user_side`, then deriving the hitter from phase:
server for serve, receiver for return, and server on odd shot sequences /
receiver on even shot sequences for rally. Return predictions unchanged only
when the corrected server is null or equals `proposal.scored_server`.

- [ ] **Step 4: Run the focused tests and observe GREEN**

Run the command from Step 2 and require all focused tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/placementCalibration.ts \
  src/lib/research/placementCalibration.test.ts \
  src/app/research/placement-calibration/placementCalibrationView.ts \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
git commit -m "feat: model placement server corrections"
```

### Task 2: Add the reviewer correction experience

**Files:**
- Modify: `src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx`
- Modify: `src/app/api/research/placement-comparison/route.ts`
- Modify: `src/app/research/placement-calibration/placementCalibrationView.test.ts`

**Interfaces:**
- Consumes: `effectivePlacementProposal`, `placementPredictionsCompatible`,
  and `changePlacementServer`
- Produces: editable server control and corrected-point submission flow

- [ ] **Step 1: Write failing UI contract tests**

Assert that the labeler contains an accessible “Change server” control,
corrected-server copy, and a submission path that does not require
`revealed_at` when predictions are incompatible. Assert that the comparison
route calls `placementPredictionsCompatible` before returning predictions.

- [ ] **Step 2: Run the UI tests and observe RED**

Run:

```bash
npm run test:research -- src/app/research/placement-calibration/placementCalibrationView.test.ts
```

Expected: failure because the correction UI and API guard are absent.

- [ ] **Step 3: Implement the correction UI and guard**

Replace the static server badge with a compact two-choice control. Confirm
before clearing a non-empty answer, derive the displayed proposal, disable the
event loop after a correction, show a discreet stale-prediction notice, and
allow a complete corrected label to submit without reveal. Update the
comparison API to return HTTP 409 with
`code: "server_prediction_mismatch"` if the saved correction differs from the
frozen proposal.

- [ ] **Step 4: Run research tests and observe GREEN**

Run:

```bash
npm run test:research
```

Expected: all research tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx \
  src/app/api/research/placement-comparison/route.ts \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
git commit -m "feat: let reviewers correct placement servers"
```

### Task 3: Export and score corrected labels safely

**Files:**
- Modify: `src/app/api/research/placement-export/route.ts`
- Modify: `src/lib/research/placementExport.test.ts`
- Modify: `worker/score_placement_calibration_pilot.py`
- Modify: `worker/tests/test_score_placement_calibration_pilot.py`

**Interfaces:**
- Consumes: latest `analysis_label.corrected_server`
- Produces: exported `prediction_compatible` boolean
- Produces: scorer exclusion `server_corrected_prediction_stale`

- [ ] **Step 1: Write failing export and scorer tests**

Add an export contract assertion for `prediction_compatible`, and a Python
test with a landed corrected-server row that expects zero eligible landings,
zero arm denominators, and one
`server_corrected_prediction_stale` exclusion.

- [ ] **Step 2: Run focused tests and observe RED**

Run:

```bash
npm run test:research -- src/lib/research/placementExport.test.ts
python -m unittest worker.tests.test_score_placement_calibration_pilot -v
```

Expected: failures because corrected-server compatibility is not exported or
scored.

- [ ] **Step 3: Implement export and scorer safety**

Set `prediction_compatible` by comparing the latest corrected server to
`proposal.scored_server`. In the scorer, check this flag before observability
or eligibility and record incompatible rows only under
`server_corrected_prediction_stale`.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run the commands from Step 2 and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/research/placement-export/route.ts \
  src/lib/research/placementExport.test.ts \
  worker/score_placement_calibration_pilot.py \
  worker/tests/test_score_placement_calibration_pilot.py
git commit -m "fix: exclude stale server predictions from scoring"
```

### Task 4: Verify, merge, deploy, and smoke-test

**Files:**
- No new source files

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified production deployment

- [ ] **Step 1: Run complete verification**

```bash
python -m unittest discover -s worker/tests -v
npm run test:research
npm run lint
npm run build
git diff --check
```

Require zero test/build errors. Record any pre-existing lint warning
separately.

- [ ] **Step 2: Inspect the final diff**

Confirm no schema migration, no frozen proposal mutation, no stale prediction
rendering, and no unrelated files.

- [ ] **Step 3: Merge and push**

Fast-forward the isolated branch into `main`, push `main`, and confirm the
exact deployed commit.

- [ ] **Step 4: Verify production**

Wait for the Vercel deployment to reach `READY`, then require
`https://www.ponglens.com/research/placement-calibration` to redirect an
unauthenticated request to the expected login URL.
