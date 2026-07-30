# Serve Detection Follow-up Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a focused 42-clip second labeling pass to the hosted serve research page while preserving the original 100 answers and exporting the detector evidence beside them.

**Architecture:** Extend the existing JSON human label with a backward-compatible `followup` object, mark the selected existing sources through `research_sources.prefill.followup_v2`, and render a mode-specific queue on the current protected route. A narrow migration enriches the existing admin-only export with source proposal and prefill data.

**Tech Stack:** Next.js 15 App Router; React 19; TypeScript and Node test runner; Python 3 and `unittest`; Supabase/Postgres JSONB and RLS; Vercel.

## Global Constraints

- Preserve all original 100 human labels and assignment statuses.
- Select exactly 42 unique existing sources: 23 occluded, nine additional high-confidence wrong-server cases, and ten visible correct controls with two controls per match.
- Never store an approximate occluded contact in `actual_serve_contact_s`.
- Mount only one protected video at a time.
- Keep the database export admin-only.
- Do not update production match, point, placement, score, or clip records.

---

### Task 1: Backward-compatible follow-up label contract

**Files:**
- Modify: `src/lib/research/serveDetection.test.ts`
- Modify: `src/lib/research/serveDetection.ts`

**Interfaces:**
- Produces: `ServeFollowupLabel`, `setFollowupAnchor`, `setContactWindowBoundary`, `addFollowupNetContact`, `removeFollowupNetContact`, `completeServeFollowup`, and `validateServeFollowup`.
- Preserves: all existing schema-version-one hydration and validation behavior.

- [ ] **Step 1: Write failing contract tests**

Add tests that hydrate a version-one label without data loss, mark each anchor,
validate missing anchors, reject a one-sided or reversed contact window, and
store/remove optional net contacts:

```typescript
const v1 = hydrateServeDetectionLabel({
  schema_version: 1,
  actual_serve_contact_s: 1.25,
  no_observable_serve: null,
  events: [],
  notes: "original",
});
assert.equal(v1.followup.first_bounce.status, "unmarked");
assert.equal(v1.actual_serve_contact_s, 1.25);

const marked = setFollowupAnchor(v1, "first_bounce", "exact", 1.5);
assert.equal(marked.followup.first_bounce.time_s, 1.5);
assert.deepEqual(validateServeFollowup(marked), [
  "second_bounce",
  "receiver_contact",
]);
```

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```bash
node --test --experimental-strip-types src/lib/research/serveDetection.test.ts
```

Expected: FAIL because the follow-up types and functions do not exist.

- [ ] **Step 3: Implement the additive contract**

Use:

```typescript
type FollowupAnchorStatus =
  | "unmarked"
  | "exact"
  | "not_visible"
  | "does_not_occur";

interface ServeFollowupLabel {
  first_bounce: FollowupAnchor;
  second_bounce: FollowupAnchor;
  receiver_contact: FollowupAnchor;
  contact_window: { start_s: number | null; end_s: number | null };
  net_contacts_s: number[];
  submitted_at: string | null;
}
```

Normalize timestamps to four decimals. Limit `does_not_occur` to second bounce
and receiver contact. Preserve original fields during every update.

- [ ] **Step 4: Run the contract tests and verify GREEN**

Run the command from Step 2 and confirm all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/serveDetection.ts src/lib/research/serveDetection.test.ts
git commit -m "feat: add serve follow-up label contract"
```

### Task 2: Follow-up queue and progress behavior

**Files:**
- Modify: `src/app/research/serve-detection/types.ts`
- Modify: `src/app/research/serve-detection/serveDetectionView.test.ts`
- Modify: `src/app/research/serve-detection/serveDetectionView.ts`

**Interfaces:**
- Produces: `ServeReviewMode`, `followupServeAssignments`, `serveFollowupProgress`, `nextIncompleteFollowupIndex`, and `followupReasonLabel`.
- Consumes: `source.prefill.followup_v2` and the hydrated follow-up label.

- [ ] **Step 1: Write failing queue tests**

Use a fixture with included and excluded sources and follow-up labels:

```typescript
assert.deepEqual(
  followupServeAssignments(fixture).map((item) => item.id),
  ["a2", "a3"],
);
assert.deepEqual(serveFollowupProgress(fixture), {
  completed: 1,
  total: 2,
});
assert.equal(nextIncompleteFollowupIndex(fixture, 0), 1);
```

Also assert stable follow-up order and readable selection reasons.

- [ ] **Step 2: Run the view tests and verify RED**

Run:

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
```

Expected: FAIL because the follow-up helpers do not exist.

- [ ] **Step 3: Implement the queue helpers and source types**

Add:

```typescript
interface ServeFollowupPrefill {
  included: boolean;
  order: number;
  reasons: Array<
    "occluded" | "high_confidence_wrong_server" | "correct_control"
  >;
}
```

Sort included sources by `order`, count completion from
`human_label.followup.submitted_at`, and leave original status filtering
unchanged.

- [ ] **Step 4: Run the view tests and verify GREEN**

Run the command from Step 2 and confirm all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/research/serve-detection/types.ts src/app/research/serve-detection/serveDetectionView.ts src/app/research/serve-detection/serveDetectionView.test.ts
git commit -m "feat: add serve follow-up queue behavior"
```

### Task 3: Focused hosted follow-up UI

**Files:**
- Modify: `src/app/research/serve-detection/page.tsx`
- Modify: `src/app/research/serve-detection/ServeDetectionLabeler.tsx`

**Interfaces:**
- Consumes: the Task 1 label helpers and Task 2 queue helpers.
- Produces: a default Follow-up 42 mode and an Original 100 mode on the same route.

- [ ] **Step 1: Add a failing page-source assertion**

Extend the view/page test command with assertions that the page query requests
`prefill` and that the labeler source contains the mode labels and anchor
controls:

```typescript
assert.match(pageSource, /duration_s,proposal,prefill/);
assert.match(labelerSource, /Follow-up 42/);
assert.match(labelerSource, /Mark first bounce here/);
assert.match(labelerSource, /Earliest plausible contact/);
```

- [ ] **Step 2: Run the page/view tests and verify RED**

Run:

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
```

Expected: FAIL because the query and follow-up UI are absent.

- [ ] **Step 3: Implement the mode-specific UI**

Load source `prefill`, default to follow-up mode when selected assignments
exist, and add:

- a Follow-up 42 / Original 100 switch;
- separate follow-up progress;
- original-answer read-only context;
- mark-here, not-visible, and did-not-occur anchor controls;
- an occluded contact-window panel;
- optional net-contact add/remove controls; and
- `Submit follow-up & next`, which sets `followup.submitted_at` and saves
  without changing the original assignment status.

- [ ] **Step 4: Run the page/view tests and verify GREEN**

Run the command from Step 2 and confirm all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/research/serve-detection/page.tsx src/app/research/serve-detection/ServeDetectionLabeler.tsx src/app/research/serve-detection/serveDetectionView.test.ts
git commit -m "feat: add focused serve follow-up review"
```

### Task 4: Deterministic 42-source cohort builder

**Files:**
- Modify: `worker/tests/test_build_serve_detection_research.py`
- Modify: `worker/build_serve_detection_research.py`

**Interfaces:**
- Produces: `choose_followup_sample(export_payload, source_rows) -> list[dict]`, `mark_followup_sources(production, export_payload) -> dict`, and CLI command `mark-followup`.
- Writes: only `research_sources.prefill.followup_v2`.

- [ ] **Step 1: Write failing cohort tests**

Create a five-match fixture and assert:

```python
selected = choose_followup_sample(export_payload, source_rows)
self.assertEqual(len(selected), 42)
self.assertEqual(sum("occluded" in item["reasons"] for item in selected), 23)
self.assertEqual(
    sum("high_confidence_wrong_server" in item["reasons"] for item in selected),
    10,
)
self.assertEqual(
    Counter(
        item["match_label"]
        for item in selected
        if "correct_control" in item["reasons"]
    ),
    Counter({"Vaibhav": 2, "Gui": 2, "Chris": 2, "Faye": 2, "Patrick": 2}),
)
```

Assert deterministic order and preservation of unrelated prefill keys.

- [ ] **Step 2: Run the worker test and verify RED**

Run:

```bash
python3 -m unittest worker.tests.test_build_serve_detection_research -v
```

Expected: FAIL because the follow-up selector does not exist.

- [ ] **Step 3: Implement selection and the safe write command**

Parse first-pass labels, compare high-confidence detector
`server_side` with gold `scored_server_side`, choose controls by stable
source-ID hash, verify exact invariants, and PATCH each source with merged
prefill:

```python
{
    **existing_prefill,
    "followup_v2": {
        "included": source_id in selected_ids,
        "order": selected_order_or_none,
        "reasons": selected_reasons,
    },
}
```

Add `mark-followup --export <path>` and an audit result with total and reason
counts.

- [ ] **Step 4: Run the worker test and verify GREEN**

Run the command from Step 2 and confirm all tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/build_serve_detection_research.py worker/tests/test_build_serve_detection_research.py
git commit -m "feat: select serve follow-up cohort"
```

### Task 5: Evidence-complete admin export

**Files:**
- Create: `supabase/migrations/057_serve_followup_export.sql`
- Create: `src/app/api/research/export/route.test.ts`
- Modify: `src/app/api/research/export/route.ts`

**Interfaces:**
- Extends: `public.research_export_batch(uuid)`.
- Adds to each assignment: `proposal` and `prefill`.
- Preserves: `public.is_admin()` gate and authenticated-only function grant.

- [ ] **Step 1: Write failing migration and route assertions**

Assert the migration contains:

```typescript
assert.match(sql, /'proposal', s\.proposal/);
assert.match(sql, /'prefill', s\.prefill/);
assert.match(sql, /when not public\.is_admin\(\)/);
assert.match(sql, /revoke execute .* from public, anon/s);
```

Assert the route derives a sanitized filename from `data.batch.slug`.

- [ ] **Step 2: Run the export tests and verify RED**

Run:

```bash
node --test --experimental-strip-types src/app/api/research/export/route.test.ts
```

Expected: FAIL because migration 057 and slug filename handling are absent.

- [ ] **Step 3: Implement the narrow export change**

Recreate the function from migration 034 with only the two additive source
fields. Keep the function stable, security definer, fixed search path, admin
gate, revocation, and authenticated grant. Return:

```http
Content-Disposition: attachment; filename="<sanitized-batch-slug>.json"
```

- [ ] **Step 4: Run the export tests and verify GREEN**

Run the command from Step 2 and confirm all tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/057_serve_followup_export.sql src/app/api/research/export/route.ts src/app/api/research/export/route.test.ts
git commit -m "feat: export serve detector evidence"
```

### Task 6: Verification, production data mark, and deployment

**Files:**
- Modify only if verification exposes a defect in a file from Tasks 1–5.

**Interfaces:**
- Consumes: migration 057 and the first-pass export at `/Users/adil/Downloads/ponglens-serve-detection-research.json`.
- Produces: 42 marked production sources and a deployed production route.

- [ ] **Step 1: Run focused and regression tests**

```bash
node --test --experimental-strip-types src/lib/research/serveDetection.test.ts src/app/research/serve-detection/serveDetectionView.test.ts src/app/api/research/export/route.test.ts
python3 -m unittest worker.tests.test_build_serve_detection_research -v
npm run test:research
npm run lint
npm run build
git diff --check
```

- [ ] **Step 2: Apply migration 057**

Run the builder's migration command, then query the function definition and
confirm proposal/prefill fields and authenticated-only execution.

- [ ] **Step 3: Mark and audit the production cohort**

```bash
python3 -m worker.build_serve_detection_research mark-followup \
  --export /Users/adil/Downloads/ponglens-serve-detection-research.json
```

Confirm exactly 42 included sources, ten high-confidence disagreement reason
tags, 23 occluded tags, ten controls, and two controls per match.

- [ ] **Step 4: Merge and push production**

Merge the feature branch into `main`, push `main`, and wait for the Vercel
production deployment to reach `Ready`.

- [ ] **Step 5: Verify the live boundary**

Confirm:

- anonymous `/research/serve-detection` redirects to
  `/login?next=/research/serve-detection`;
- the production export contains proposal, prefill, human label, and gold;
- database labels retain all 100 original answers; and
- the 42 selected assignments expose follow-up metadata without a second media
  copy.

