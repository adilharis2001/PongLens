# Low-confidence Placement Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reveal raw sub-70% placement hypotheses in the local review report and replace production warning cards with discreet one-line notices.

**Architecture:** Keep production suppression and local review rendering separate. Add an explicit review-only raw-render path to the Python report generator, and centralize production notice selection in the existing placement model so it is testable independently from React markup.

**Tech Stack:** Python `unittest`, SVG/HTML report generation, TypeScript, React, Node test runner, Tailwind CSS.

## Global Constraints

- Low-confidence means strictly less than `0.70`.
- Raw suppressed trajectories are visible only in local review HTML.
- Production never renders a hard-invalid or unavailable trajectory.
- Production uncertainty copy is one line with no amber card treatment.
- Do not rerun BlurBall inference when existing reconstructed artifacts suffice.

---

### Task 1: Raw low-confidence review rendering

**Files:**
- Modify: `worker/eval/render_placement_match.py`
- Modify: `worker/tests/test_placement_reconstruction.py`

**Interfaces:**
- Produces: `render_v3_svg(..., reveal_suppressed: bool = False) -> str`
- Produces: report rows with `data-low-confidence="true|false"` and filter controls.

- [ ] **Step 1: Write failing tests**

Add tests that give a 60% hard-invalid hypothesis a valid shot and assert the
review-only SVG contains a trajectory line and a “raw suppressed hypothesis”
label. Add a report test asserting the default filter controls and low
confidence row metadata at the 0.70 boundary.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction.RenderReportTests -v
```

Expected: failures because suppressed hypotheses still return the placeholder
SVG and the report has no low-confidence filter.

- [ ] **Step 3: Implement review-only rendering and filtering**

Add the optional renderer flag, bypass early suppression only when the flag is
true and usable shot geometry exists, add honest raw-hypothesis labeling, add
row metadata, and add small Under 70% / All points controls whose default is
Under 70%.

- [ ] **Step 4: Verify the report tests pass**

Run the command from Step 2. Expected: all render-report tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/eval/render_placement_match.py \
  worker/tests/test_placement_reconstruction.py
git commit -m "feat: reveal low-confidence placement hypotheses in review"
```

### Task 2: Minimal production uncertainty notice

**Files:**
- Modify: `src/lib/placement/placementModel.ts`
- Modify: `src/lib/placement/placementModel.test.ts`
- Modify: `src/app/match/[id]/PlacementMap.tsx`

**Interfaces:**
- Produces: `placementNotice(hypothesis) -> { mode, message } | null`
- Consumes: the selected physical hypothesis already used by `PlacementMapV3`.

- [ ] **Step 1: Write failing notice tests**

Add table-driven tests asserting:

- ready returns `null`;
- review returns the “may be less accurate” notice;
- unavailable and any hard reason return the “couldn’t be generated” notice.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm run test:placement
```

Expected: failure because `placementNotice` does not exist.

- [ ] **Step 3: Implement the notice helper and minimal markup**

Implement the pure helper. Use it in `PlacementMapV3`; return a single quiet
line for unavailable/hard-invalid output, and render the quiet line above a
review map. Remove both amber card treatments and duplicate title/subtitle
copy.

- [ ] **Step 4: Verify placement tests pass**

Run `npm run test:placement`. Expected: all placement tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/placement/placementModel.ts \
  src/lib/placement/placementModel.test.ts \
  'src/app/match/[id]/PlacementMap.tsx'
git commit -m "fix: make placement uncertainty notices discreet"
```

### Task 3: Regenerate and verify the Vaibhab review artifact

**Files:**
- Modify locally: `/tmp/ponglens-placement-v3/vaibhab-final-20260726-video/index.html`
- Modify locally: `/tmp/ponglens-placement-v3/vaibhab-final-20260726-video/point-*.svg`

**Interfaces:**
- Consumes: existing `reconstructed-match.json`, point videos, and report HTML.
- Produces: updated local review page without model inference.

- [ ] **Step 1: Rebuild review SVGs and HTML from existing reconstruction data**

Use the report generator’s pure render/build functions and the existing
artifacts. Do not invoke BlurBall.

- [ ] **Step 2: Run full verification**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_reconstruction \
  worker.tests.test_placement_backfill_reconstruction -v
npm run test:placement
npm run lint
npm run build
npx tsc --noEmit
git diff --check
```

- [ ] **Step 3: Visually inspect the local review page**

Verify the page defaults to sub-70% points, each visible point retains its
video, suppressed hypotheses show raw trajectories where geometry exists, and
the All points control restores the full match.

- [ ] **Step 4: Commit any final code corrections**

Commit only repository code and tests. Keep `/tmp` artifacts local.
