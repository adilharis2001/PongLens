# Cross-Venue Placement Calibration Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct mirrored deterministic table coordinates and ship an authenticated, blind, cross-venue placement-labeling experiment that produces measurable current-versus-OpenAI calibration results.

**Architecture:** A shared Python canonicalization boundary normalizes deterministic and OpenAI table quads before homography construction. A new placement research route reuses the existing Supabase research assignments, protected media, and autosave model with a placement-specific label schema. A read-only production materializer freezes 42 stratified events plus six repeats, and a scorer compares the blind labels against legacy, corrected-current, and OpenAI predictions.

**Tech Stack:** Python 3, OpenCV, NumPy, unittest, Next.js 15, React 19, TypeScript, Node test runner, Supabase Postgres/RLS, Cloudflare R2, existing PongLens research infrastructure.

## Global Constraints

- Work only in `/Users/adil/Desktop/Projects/PongLens/.worktrees/openai-table-calibration-experiment` on `codex/openai-table-calibration-experiment`.
- Follow test-driven development: every behavior change starts with a failing test that is observed before production code.
- The experiment performs no writes to `matches`, `points`, or production match JSON.
- Only the scored-server reconstruction is eligible; never render or label hypothetical-server events.
- Serve targets are second bounces. Return and rally targets are first table bounces after contact.
- Predictions remain hidden until the first blind human answer is saved.
- Store canonical physical coordinates; never fix orientation only in a renderer.
- Production identifiers, raw R2 paths, secrets, and hidden predictions do not appear in ordinary reviewer exports.
- Keep the existing fused sound-labeling experience unchanged.
- Explicitly allow only `research/fused-labeling/...` and `research/placement-calibration/...` media namespaces.

---

### Task 1: Canonical Table Orientation

**Files:**
- Create: `worker/table_coordinates.py`
- Create: `worker/tests/test_table_coordinates.py`
- Modify: `worker/points_pipeline.py`
- Modify: `worker/placement_backfill.py`
- Modify: `worker/placement_retry_calibration.py`
- Modify: `worker/eval/compare_placement_calibrations.py`
- Modify: `worker/tests/test_placement_retry_calibration.py`
- Modify: `worker/tests/test_compare_placement_calibrations.py`

**Interfaces:**
- Produces: `canonicalize_table_quad(corners, near_pair=None) -> CanonicalQuad`
- Produces: `CanonicalQuad.corners`, `.reordered`, `.source_winding`
- Produces: `table_homography(canonical_quad) -> numpy.ndarray`
- Consumes: four image-space table corners and an identified near-end pair.

- [ ] **Step 1: Write failing winding-regression tests**

Add tests proving that clockwise and counter-clockwise representations of the
same table produce the same canonical array and identical projected points:

```python
def test_opposite_windings_project_to_identical_physical_coordinates():
    near_left = [100.0, 300.0]
    near_right = [500.0, 300.0]
    far_right = [420.0, 100.0]
    far_left = [180.0, 100.0]
    forward = canonicalize_table_quad(
        [near_left, near_right, far_right, far_left],
        near_pair=(0, 1),
    )
    reversed_quad = canonicalize_table_quad(
        [near_left, far_left, far_right, near_right],
        near_pair=(0, 3),
    )
    assert np.allclose(forward.corners, reversed_quad.corners)
    assert np.allclose(
        project(table_homography(forward), [250.0, 210.0]),
        project(table_homography(reversed_quad), [250.0, 210.0]),
    )
```

Also test idempotence, camera-left ordering, and abstention when the near pair
is missing or degenerate.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest worker.tests.test_table_coordinates -v
```

Expected: import failure because `worker.table_coordinates` does not exist.

- [ ] **Step 3: Implement the minimal canonicalization module**

Define:

```python
@dataclass(frozen=True)
class CanonicalQuad:
    corners: np.ndarray
    reordered: bool
    source_winding: str

def canonicalize_table_quad(
    corners: Sequence[Sequence[float]],
    *,
    near_pair: tuple[int, int],
) -> CanonicalQuad:
    ...

def table_homography(quad: CanonicalQuad) -> np.ndarray:
    ...
```

Order the near pair by image `x` into `near_left`, `near_right`; pair remaining
far points by the minimum non-crossing sideline assignment; validate convexity,
finite coordinates, distinct points, and non-singular homography. Return
`[near_left, near_right, far_right, far_left]`.

- [ ] **Step 4: Verify canonicalization GREEN**

Run the Task 1 test module. Expected: all tests pass.

- [ ] **Step 5: Write failing integration tests**

Add a deterministic calibration fixture whose legacy output has `B/D` reversed.
Assert:

- `points_pipeline.calibrate` stores canonical corner provenance;
- `placement_backfill.calibration_matrix` projects the fixture without a
  horizontal mirror;
- accepted OpenAI quads use the same canonicalizer;
- `landing_zone` sees the same physical `u/v` for equivalent input quads.

- [ ] **Step 6: Run integration tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_placement_retry_calibration \
  worker.tests.test_compare_placement_calibrations -v
```

Expected: assertions fail because existing code constructs homographies
directly from legacy winding.

- [ ] **Step 7: Route every calibration arm through the canonical boundary**

Update the deterministic calibrator, backfill homography, retry/OpenAI
calibration, and read-only comparison conversion to call the shared module.
Change the OpenAI prompt/schema names to:

```python
("A_near_left", "B_near_right", "C_far_right", "D_far_left")
```

Maintain legacy-key input compatibility by resolving the near pair and
canonicalizing before use. Add provenance:

```json
{
  "orientation": "canonical-v1",
  "legacy_reordered": true
}
```

- [ ] **Step 8: Verify Task 1 and commit**

Run the Task 1 and affected calibration suites, then:

```bash
git add worker/table_coordinates.py worker/points_pipeline.py \
  worker/placement_backfill.py worker/placement_retry_calibration.py \
  worker/eval/compare_placement_calibrations.py \
  worker/tests/test_table_coordinates.py \
  worker/tests/test_placement_retry_calibration.py \
  worker/tests/test_compare_placement_calibrations.py
git commit -m "fix: canonicalize table orientation"
```

---

### Task 2: Placement Research Label Model and Database Boundary

**Files:**
- Create: `src/lib/research/placementCalibration.ts`
- Create: `src/lib/research/placementCalibration.test.ts`
- Create: `supabase/migrations/055_placement_calibration_research.sql`
- Modify: `src/lib/research/labeling.ts`
- Modify: `src/lib/research/labeling.test.ts`
- Modify: `src/lib/research/migration.test.ts`
- Modify: `src/app/api/research/media/route.ts`

**Interfaces:**
- Produces: `PlacementCalibrationProposal`
- Produces: `PlacementCalibrationHumanLabel`
- Produces: `hydratePlacementLabel`, `validatePlacementLabel`,
  `blindLabelStatus`, `predictionDistanceCm`
- Extends: `isResearchMediaKey` to two exact permanent namespaces.

- [ ] **Step 1: Write failing TypeScript label-model tests**

Cover:

- the four mutually exclusive results;
- landed labels requiring bounded `u/v`, visibility, and confidence;
- non-landed labels clearing coordinates;
- predictions hidden before `revealed_at`;
- post-reveal edits setting `post_reveal_edited`;
- distance in centimeters;
- explicit acceptance of placement media keys and rejection of traversal or
  arbitrary `research/` paths.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test:research
```

Expected: missing placement module and placement media key rejected.

- [ ] **Step 3: Implement the placement label module**

Use this stable result union:

```typescript
type PlacementResult =
  | "landed"
  | "not_visible"
  | "wrong_event"
  | "no_table_bounce";
```

Store the first blind snapshot independently from the editable current answer:

```typescript
interface PlacementCalibrationHumanLabel {
  schema_version: 1;
  result: PlacementResult | null;
  table_u: number | null;
  table_v: number | null;
  visibility: "clear" | "estimated" | null;
  confidence: "certain" | "likely" | "unsure" | null;
  blind_snapshot: PlacementBlindSnapshot | null;
  revealed_at: string | null;
  post_reveal_edited: boolean;
}
```

- [ ] **Step 4: Write and test the migration**

Migration 055 changes only the media-key check constraint so
`research_sources.media_key` accepts the two explicit regex-like prefixes. It
does not grant new table privileges. Update migration tests to assert RLS and
grants remain unchanged.

- [ ] **Step 5: Implement protected media validation and verify GREEN**

Update the server media validator, run `npm run test:research`, then:

```bash
git add src/lib/research/placementCalibration.ts \
  src/lib/research/placementCalibration.test.ts \
  src/lib/research/labeling.ts src/lib/research/labeling.test.ts \
  src/lib/research/migration.test.ts \
  src/app/api/research/media/route.ts \
  supabase/migrations/055_placement_calibration_research.sql
git commit -m "feat: define placement research labels"
```

---

### Task 3: Authenticated Placement Calibration Route

**Files:**
- Create: `src/app/research/placement-calibration/page.tsx`
- Create: `src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx`
- Create: `src/app/research/placement-calibration/PlacementTableEditor.tsx`
- Create: `src/app/research/placement-calibration/placementCalibrationView.ts`
- Create: `src/app/research/placement-calibration/placementCalibrationView.test.ts`
- Modify: `src/lib/research/types.ts`

**Interfaces:**
- Server page returns only assigned batch/source fields needed by the client.
- `PlacementTableEditor` consumes physical near/far labels and emits normalized
  canonical `u/v`.
- `PlacementCalibrationLabeler` autosaves assignment `human_label` and
  `review_metrics`.

- [ ] **Step 1: Write failing view-model tests**

Test:

- exact serve/return/rally instructions;
- physical near player remains at bottom and far player at top;
- server label follows scored context;
- no prediction marker exists before reveal;
- abstention produces `No prediction`;
- revealed predictions use canonical `u` directly with no renderer flip;
- centimeter errors use the blind label.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
```

Expected: missing view module.

- [ ] **Step 3: Implement pure view helpers and verify GREEN**

Keep instruction, marker projection, visibility, and summary formatting in the
pure tested view module. SVG mapping is:

```typescript
const x = tableLeft + (u / 1.525) * tableWidth;
const y = tableTop + (1 - v / 2.74) * tableLength;
```

No arm-specific mirroring is permitted.

- [ ] **Step 4: Implement the server page**

Follow `/research/fused-labeling/page.tsx` authentication and assignment
patterns, but filter the batch slug to
`placement-calibration-cross-venue-v1`. Select only:

- assignment ID, sequence, status, human label, review metrics;
- anonymous source ID, batch index, match label, player labels, venue,
  duration, placement proposal, and prefill.

Redirect unauthenticated users to the route-preserving login URL.

- [ ] **Step 5: Implement the client labeler**

Provide:

- assignment navigation and progress;
- protected point video;
- event-centered replay/frame controls;
- one concise target instruction;
- four result choices;
- touch-friendly physical table editor;
- clear/estimated and confidence controls for landed labels;
- autosave;
- explicit `Reveal comparison`;
- current, OpenAI, human, and optional legacy markers after reveal;
- post-reveal edit contamination warning.

- [ ] **Step 6: Verify route behavior and commit**

Run view, research, lint-on-files, and TypeScript/build checks:

```bash
node --test --experimental-strip-types \
  src/app/research/placement-calibration/placementCalibrationView.test.ts
npm run test:research
npx eslint src/app/research/placement-calibration \
  src/lib/research/placementCalibration.ts
npm run build
```

Then commit the route files.

---

### Task 4: Read-Only Cross-Venue Batch Materializer

**Files:**
- Create: `worker/build_placement_calibration_pilot.py`
- Create: `worker/tests/test_build_placement_calibration_pilot.py`
- Modify: `worker/eval/materialize_table_calibration_cases.py`

**Interfaces:**
- Produces: frozen manifest with 42 primary sources and six repeat assignments.
- Consumes: retained production source video, match JSON, point clips, scored
  server context, BlurBall detections, legacy/current/OpenAI calibrations.
- Writes only research tables and the placement research R2 prefix.

- [ ] **Step 1: Write failing selection tests**

Use synthetic candidates to prove:

- six match strata;
- exactly 42 distinct points;
- at least 12 serve, 12 return, 15 user-near, and 15 user-far events;
- at most one event per point;
- only scored-server hypotheses;
- disagreement, agreement-control, and one-arm-abstention inclusion;
- six deterministic blind repeats;
- selection ignores labels.

- [ ] **Step 2: Run and verify RED**

Run the new worker test module. Expected: missing builder.

- [ ] **Step 3: Implement pure selection and identity functions**

Create stable UUIDv5 identities from batch slug, anonymous match ordinal,
point index, shot sequence, and phase. Keep production IDs only in the local
sealed manifest, never the reviewer proposal.

- [ ] **Step 4: Write failing materialization boundary tests**

Prove:

- read-only source queries;
- stable media/prediction hashes;
- idempotent research upserts;
- changed hash rejection;
- point clips copied once for repeats;
- no match/point update SQL;
- temporary files removed after verification.

- [ ] **Step 5: Implement materialization**

Reuse the existing production credential and R2 helpers from
`build_research_pilot.py`, but define a placement-specific builder. Freeze:

- legacy deterministic prediction;
- canonical deterministic prediction;
- OpenAI prediction;
- server and physical side context;
- target event timing and semantics.

Default to the six approved match strata and disclose the selected match labels
in the sealed run manifest.

- [ ] **Step 6: Verify and commit**

Run builder, table materialization, comparison, and relevant reconstruction
tests. Commit with:

```bash
git commit -m "feat: materialize cross-venue placement pilot"
```

---

### Task 5: Blind Placement Scorer and Export

**Files:**
- Create: `worker/score_placement_calibration_pilot.py`
- Create: `worker/tests/test_score_placement_calibration_pilot.py`
- Create: `src/app/api/research/placement-export/route.ts`
- Modify: `src/app/research/placement-calibration/PlacementCalibrationLabeler.tsx`

**Interfaces:**
- Produces: anonymized raw export plus aggregate JSON/HTML score report.
- Excludes: post-reveal edits, unsure labels, invisible events, wrong events,
  and no-bounce events from calibration distance denominators.

- [ ] **Step 1: Write failing metric tests**

Cover centimeter distance, percentiles, nine-zone accuracy, lateral/depth
accuracy, mirror rate, coverage, per-stratum metrics, detector exclusions,
observability exclusions, and repeat-label reliability.

- [ ] **Step 2: Run and verify RED**

Expected: missing scorer.

- [ ] **Step 3: Implement scorer**

Score `canonical_current` versus `openai`; report `legacy_current` as
diagnostic. Every percentage includes numerator and denominator. Emit an
engineering-holdout disclaimer.

- [ ] **Step 4: Add protected placement export**

Follow the existing research export route, filtering the placement batch and
omitting production IDs and media keys. Add an admin-only export button.

- [ ] **Step 5: Verify and commit**

Run scorer tests, research tests, lint, and build. Commit with:

```bash
git commit -m "feat: score placement calibration pilot"
```

---

### Task 6: Local End-to-End Verification

**Files:**
- Modify only files required by failures discovered in this task.

- [ ] **Step 1: Run all worker and frontend tests**

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  -m unittest discover -s worker/tests -v
npm run test:research
npm run test:placement
npm run lint
npm run build
git diff --check
```

- [ ] **Step 2: Seed a local fixture batch**

Build a synthetic two-source fixture containing one visible landing and one
abstention. Run the page locally with an authenticated test assignment.

- [ ] **Step 3: Verify in the in-app browser**

Check desktop and 390-pixel mobile layouts:

- predictions absent before reveal;
- table click and re-click work;
- autosave persists after reload;
- reveal markers and distances are correct;
- far/near player labels match the fixture;
- no horizontal overflow;
- no console errors;
- video loads.

- [ ] **Step 4: Correct only verified failures and repeat all checks**

Use a fresh failing test for each behavior correction.

---

### Task 7: Production Migration, Deployment, and Frozen Batch

**Files:**
- Production migration history and deployment metadata only; do not modify
  product data outside research tables/storage.

- [ ] **Step 1: Review Supabase and deployment state**

Confirm migration 055 is unapplied, inspect current database advisors, verify
the application deployment target, and verify all six source matches remain
retained.

- [ ] **Step 2: Apply migration and verify permissions**

Apply the reviewed migration once. Verify:

- check constraint allows both explicit media namespaces;
- RLS remains enabled;
- anonymous access remains revoked;
- authenticated reviewers retain only select and assignment-label update
  privileges.

- [ ] **Step 3: Deploy the authenticated route**

Deploy the exact tested commit through the repository's existing production
workflow. Verify `/research/fused-labeling` is unchanged and
`/research/placement-calibration` requires authentication.

- [ ] **Step 4: Materialize and seed the frozen batch**

Run the builder once with a unique output directory. Verify 42 primary sources,
six repeats, hashes, media probes, target semantics, and the admin assignment
before marking the batch active.

- [ ] **Step 5: Production smoke test**

Open the authenticated placement route, verify one assignment without
submitting a label, and confirm protected media, physical player labels,
blindness, autosave readiness, and mobile layout.

- [ ] **Step 6: Record the experiment handoff**

Report:

- production route;
- frozen batch slug and counts;
- selected match labels/venues;
- exact commit and migration;
- verification evidence;
- how to label and export;
- known abstentions or excluded sources.

