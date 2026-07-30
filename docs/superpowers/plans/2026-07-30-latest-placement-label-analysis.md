# Latest Placement Label Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score the reviewer’s latest placement answer and let reviewers explicitly exclude unusable points.

**Architecture:** Extend the JSON label contract with an excluded outcome and required reason, then expose a normalized latest-answer-only analysis label. The UI continues to hide predictions until first save, but edits after reveal become the authoritative answer. The Python scorer consumes only current/normalized fields and excludes unusable sources from all analytical denominators.

**Tech Stack:** TypeScript, React 19, Next.js 15, Supabase JSONB, Node test runner, Python unittest.

## Global Constraints

- The latest saved answer is the sole human truth used for scoring.
- Historical blind snapshots may remain in storage but must not be exported or scored.
- Post-reveal edits remain eligible.
- Excluded points require one of `net_contact`, `not_a_point`, `wrong_clip_or_event`, or `other`.
- Excluded points enter no accuracy, coverage, observability, zone, or mirror-rate denominator.
- No database migration is required.

---

### Task 1: Latest-answer label contract

**Files:**
- Modify: `src/lib/research/placementCalibration.ts`
- Modify: `src/lib/research/placementCalibration.test.ts`

**Interfaces:**
- Produces: `PlacementExclusionReason`
- Produces: `placementAnalysisLabel(label): PlacementAnalysisLabel`
- Extends: `PlacementCalibrationResult` with `"excluded"`
- Extends: `PlacementCalibrationHumanLabel` with `exclusion_reason`

- [ ] **Step 1: Write failing contract tests**

Add tests proving that excluded labels require a reason, switching away from
excluded clears the reason, and `placementAnalysisLabel` returns current fields
without `blind_snapshot`.

```ts
test("excluded labels require a reason and clear stale coordinates", () => {
  let label = updatePlacementCalibrationLabel(
    createPlacementCalibrationLabel(),
    { result: "excluded" },
  );
  assert.deepEqual(validatePlacementCalibrationLabel(label), [
    "exclusion_reason",
  ]);
  label = updatePlacementCalibrationLabel(label, {
    exclusion_reason: "not_a_point",
  });
  assert.deepEqual(validatePlacementCalibrationLabel(label), []);
});

test("analysis label uses the latest post-reveal answer", () => {
  const edited = updatePlacementCalibrationLabel(revealed, {
    table_u: 0.8,
  });
  assert.equal(placementAnalysisLabel(edited).table_u, 0.8);
  assert.equal("blind_snapshot" in placementAnalysisLabel(edited), false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test:research
```

Expected: FAIL because `excluded`, `exclusion_reason`, and
`placementAnalysisLabel` do not exist.

- [ ] **Step 3: Implement the minimal label contract**

Add:

```ts
export type PlacementExclusionReason =
  | "net_contact"
  | "not_a_point"
  | "wrong_clip_or_event"
  | "other";

export interface PlacementAnalysisLabel {
  result: PlacementCalibrationResult;
  table_u: number | null;
  table_v: number | null;
  visibility: PlacementVisibility | null;
  confidence: PlacementConfidence | null;
  exclusion_reason: PlacementExclusionReason | null;
}
```

Update label creation, patching, and validation. Implement
`placementAnalysisLabel` by validating and returning only latest current fields.

- [ ] **Step 4: Run the research tests and verify GREEN**

Run:

```bash
npm run test:research
```

Expected: all research tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/placementCalibration.ts src/lib/research/placementCalibration.test.ts
git commit -m "feat: make latest placement label authoritative"
```

### Task 2: Reviewer exclusion and non-blind copy

**Files:**
- Modify: `src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx`
- Modify: `src/app/research/placement-calibration/placementCalibrationView.ts`
- Modify: `src/app/research/placement-calibration/placementCalibrationView.test.ts`
- Modify: `src/app/api/research/placement-comparison/route.ts`

**Interfaces:**
- Consumes: `PlacementExclusionReason`
- Consumes: `validatePlacementCalibrationLabel`
- Produces: an excluded assignment that may be submitted without reveal

- [ ] **Step 1: Write failing UI-contract tests**

Add pure copy helpers and tests:

```ts
assert.equal(revealButtonLabel(), "Save answer & show comparison");
assert.match(latestAnswerNotice(true), /latest saved answer/i);
```

Add a source contract assertion that the comparison API no longer requires
`blind_snapshot`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
```

Expected: FAIL because the copy helpers and latest-answer behavior are absent.

- [ ] **Step 3: Implement reviewer behavior**

- Add `Exclude this point` to result choices.
- When selected, render four exclusion-reason buttons.
- Submit a complete excluded label directly with status `submitted`.
- Change reveal copy to `Save answer & show comparison`.
- Replace the blind-analysis warning with:
  `Your latest saved answer is used in the analysis.`
- Remove the comparison API’s `blind_snapshot` requirement while retaining
  `revealed_at` as the prediction-access gate.

- [ ] **Step 4: Run focused and research tests**

Run:

```bash
node --test --experimental-strip-types \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
npm run test:research
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/research/placement-calibration \
  src/app/api/research/placement-comparison/route.ts
git commit -m "feat: let reviewers exclude placement points"
```

### Task 3: Latest-answer export and scoring

**Files:**
- Modify: `src/app/api/research/placement-export/route.ts`
- Modify: `worker/score_placement_calibration_pilot.py`
- Modify: `worker/tests/test_score_placement_calibration_pilot.py`

**Interfaces:**
- Consumes: normalized `analysis_label`
- Produces: score report version `2` with `eligible_landings`

- [ ] **Step 1: Write failing scorer tests**

Replace blind-oriented fixtures with divergent current and historical answers.
Assert the current coordinates are scored, a post-reveal edit is eligible, and
excluded assignments do not enter observability.

```python
def test_latest_answer_overrides_blind_snapshot():
    result = score_labels([row(truth=(0.8, 2.0), blind_truth=(0.4, 2.0),
                               edited=True)])
    assert result["eligible_landings"] == 1
    assert result["arms"]["canonical_current"]["distance_cm"]["median"] == 30.0

def test_excluded_sources_leave_every_denominator():
    result = score_labels([row(result="excluded",
                               exclusion_reason="not_a_point")])
    assert result["eligible_landings"] == 0
    assert result["observability"] == {}
    assert result["exclusions"]["not_a_point"] == 1
```

- [ ] **Step 2: Run scorer tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_score_placement_calibration_pilot
```

Expected: FAIL because the scorer reads `blind_snapshot`, excludes edited
answers, and exposes `eligible_blind_landings`.

- [ ] **Step 3: Implement latest-answer scoring and export**

- Export `analysis_label: placementAnalysisLabel(human_label)`.
- Do not include `blind_snapshot` in analytical exports.
- In Python, prefer `analysis_label`, fall back to current `human_label`, and
  never inspect `blind_snapshot`.
- Count excluded assignments by `exclusion_reason` before observability.
- Remove the `post_reveal_edited` exclusion.
- Return schema version `2` and `eligible_landings`.

- [ ] **Step 4: Run scorer and research tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_score_placement_calibration_pilot
npm run test:research
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/research/placement-export/route.ts \
  worker/score_placement_calibration_pilot.py \
  worker/tests/test_score_placement_calibration_pilot.py
git commit -m "fix: score latest placement answers"
```

### Task 4: Full verification and production deployment

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: deployed production behavior

- [ ] **Step 1: Run the full worker suite**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest discover -s worker/tests
```

Expected: zero failures.

- [ ] **Step 2: Run frontend tests, lint, and build**

```bash
npm run test:research
npm run lint
npm run build
git diff --check
```

Expected: zero test/build/lint errors.

- [ ] **Step 3: Push main**

```bash
git fetch origin main
git rebase origin/main
git push origin main
```

- [ ] **Step 4: Verify deployment and production data**

Confirm the exact pushed commit reaches Vercel `READY`, the authenticated route
redirects anonymous requests to login, and the active research batch still has
42 sources and 48 assignments.
