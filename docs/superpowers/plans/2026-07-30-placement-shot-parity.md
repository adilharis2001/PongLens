# Placement Shot-Owner Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct impossible placement shot ownership, withhold incompatible predictions, and prevent future pilot batches from selecting parity-invalid events.

**Architecture:** A pure TypeScript identity layer derives the hitter and receiver from effective server and shot sequence for display and prediction compatibility. The Python pilot builder applies the same parity rule before selection, while exports and scoring preserve a specific incompatibility reason.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase JSONB, Python 3.12 `unittest`.

## Global Constraints

- The effective server owns odd-numbered shots and the receiver owns even-numbered shots.
- Detector-provided `hitter_side` is never authoritative when it contradicts parity.
- Incompatible predictions must never be shown or scored.
- Existing frozen proposals remain immutable.
- Only item 7's invalid in-progress answer may be reset.
- No database migration.

---

### Task 1: Derive authoritative shot ownership in the UI

**Files:**
- Modify: `src/lib/research/placementCalibration.ts`
- Modify: `src/lib/research/placementCalibration.test.ts`
- Modify: `src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx`
- Modify: `src/app/research/placement-calibration/placementCalibrationView.test.ts`

**Interfaces:**
- Produces: `expectedPlacementHitterSide(proposal, server)`
- Produces: `placementPredictionIncompatibilityReason(proposal, correctedServer)`
- Modifies: `effectivePlacementProposal` to normalize identity on every path

- [ ] **Step 1: Add failing parity regression tests**

Add a proposal where Vaibhav is the opponent server, the user is far, shot 4
stores `hitter_side: "near"`, and assert that the effective proposal uses
`hitter_side: "far"` with an incompatibility reason of
`shot_owner_inconsistent`. Add coverage for serve, return, odd rally, and even
rally.

- [ ] **Step 2: Run focused tests and observe RED**

```bash
node --test --experimental-strip-types \
  src/lib/research/placementCalibration.test.ts \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
```

Expected: failure because compatible proposals currently return before
normalizing the stored hitter.

- [ ] **Step 3: Implement authoritative identity**

Derive server physical side from effective server and `user_side`. Derive
hitter by shot parity, always return normalized hitter/receiver, and return
null predictions whenever either a server correction or stored-hitter
inconsistency exists. Show “Shot ownership corrected from serve order” in the
labeler when that inconsistency is present.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run the Step 2 command and require all focused tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/placementCalibration.ts \
  src/lib/research/placementCalibration.test.ts \
  src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
git commit -m "fix: derive placement hitters from shot order"
```

### Task 2: Reject impossible identities during pilot construction

**Files:**
- Modify: `worker/build_placement_calibration_pilot.py`
- Modify: `worker/tests/test_build_placement_calibration_pilot.py`

**Interfaces:**
- Produces: `expected_hitter_side(scored_server, user_side, phase, shot_seq)`
- Modifies: manifest candidate eligibility

- [ ] **Step 1: Add a failing builder test**

Create otherwise eligible candidates with matching scored server but incorrect
return or rally hitter parity. Assert that `build_manifest` marks those
candidates ineligible so `select_pilot_events` cannot select them.

- [ ] **Step 2: Run the builder tests and observe RED**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_build_placement_calibration_pilot -v
```

Expected: failure because builder eligibility currently checks server only.

- [ ] **Step 3: Implement parity eligibility**

Add one pure physical-side helper in the builder and require
`hitter_side == expected_hitter_side(...)` in addition to the existing server
eligibility check.

- [ ] **Step 4: Run builder tests and observe GREEN**

Run the Step 2 command and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add worker/build_placement_calibration_pilot.py \
  worker/tests/test_build_placement_calibration_pilot.py
git commit -m "fix: reject impossible placement shot owners"
```

### Task 3: Export and score incompatibility reasons

**Files:**
- Modify: `src/app/api/research/placement-export/route.ts`
- Modify: `src/lib/research/placementExport.test.ts`
- Modify: `worker/score_placement_calibration_pilot.py`
- Modify: `worker/tests/test_score_placement_calibration_pilot.py`

**Interfaces:**
- Consumes: `placementPredictionIncompatibilityReason`
- Produces: `prediction_incompatibility_reason`
- Produces: `shot_owner_inconsistent_prediction_stale` scorer exclusion

- [ ] **Step 1: Add failing export and scorer tests**

Require the export to call `placementPredictionIncompatibilityReason`. Add a
scorer row with `prediction_compatible: false` and
`prediction_incompatibility_reason: "shot_owner_inconsistent"`; assert zero
model denominators and one
`shot_owner_inconsistent_prediction_stale` exclusion.

- [ ] **Step 2: Run focused tests and observe RED**

```bash
node --test --experimental-strip-types \
  src/lib/research/placementExport.test.ts
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_score_placement_calibration_pilot -v
```

Expected: failures because the export and scorer currently use only the
generic compatibility boolean.

- [ ] **Step 3: Implement reasoned export and scoring**

Export the nullable reason beside `prediction_compatible`. Map
`server_corrected` to `server_corrected_prediction_stale` and
`shot_owner_inconsistent` to
`shot_owner_inconsistent_prediction_stale`, with a defensive generic fallback
for older malformed exports.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run the Step 2 commands and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/research/placement-export/route.ts \
  src/lib/research/placementExport.test.ts \
  worker/score_placement_calibration_pilot.py \
  worker/tests/test_score_placement_calibration_pilot.py
git commit -m "fix: distinguish stale placement identities"
```

### Task 4: Verify, deploy, and reset item 7

**Files:**
- No schema changes

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified production correction

- [ ] **Step 1: Run complete verification**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest discover -s worker/tests -v
npm run test:research
node --test --experimental-strip-types \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
npm run lint
npm run build
git diff --check
```

- [ ] **Step 2: Re-run the production audit read-only**

Require five inconsistent sources and seven affected assignments. Verify item
7 is the only affected assignment with a non-null answer before resetting it.

- [ ] **Step 3: Merge, push, and wait for Vercel READY**

Fast-forward the isolated branch into `main`, push `main`, and verify the exact
commit reaches `READY`.

- [ ] **Step 4: Reset only item 7 with guarded predicates**

Update the one assignment only when all guards match: batch slug, sequence 7,
status `in_progress`, source match `Adil–Vaibhav`, source point 27, and current
human result `excluded`. Set status to `not_started`, replace `human_label`
with the blank current schema, clear review metrics and timestamps, and verify
exactly one returned row.

- [ ] **Step 5: Smoke-test and audit**

Require the unauthenticated production calibration route to redirect to login,
then re-run the production audit and confirm item 7 is unanswered while all
seven assignments render under parity-derived identity.
