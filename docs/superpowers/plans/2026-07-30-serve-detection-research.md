# Hosted Serve Detection Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently host a fast, authenticated, delegable serve-detection review page containing exactly 100 points from five production matches.

**Architecture:** A local administrative builder applies the side-neutral serve selector to stored placement reconstructions, computes scored-server truth through an independent ITTF rotation walk, freezes a deterministic 20-per-match sample into private R2, and seeds the existing research tables. A new Next.js research route reads only assigned, review-safe source proposals, signs one protected clip at a time, and autosaves a compact serve-specific human label.

**Tech Stack:** Python 3 worker utilities and `unittest`; Next.js 15 App Router; React 19; TypeScript; Node test runner; Supabase/Postgres RLS; private Cloudflare R2; Vercel.

## Global Constraints

- The production route is `/research/serve-detection`.
- The batch slug is `serve-detection-cross-match-v1`.
- The batch contains exactly 100 unique points: 20 each from Vaibhav, Gui, Chris, Faye, and Patrick.
- The target current mix is 36 `high_confidence` and 64 `needs_review`; unavailable points are excluded.
- The detector must not read scored-server truth, first-server selection, point winner, or reviewer labels.
- Original matches, points, clips, scores, and placement data are immutable inputs.
- Only the selected video is mounted; detector work never runs in the browser or web server.
- Research media remains private and production UUIDs are not returned to the browser.
- The experimental branch is not merged; only the required selector behavior is reimplemented with focused tests.

---

### Task 1: Serve selector module

**Files:**
- Create: `worker/serve_detection.py`
- Create: `worker/tests/test_serve_detection.py`

**Interfaces:**
- Consumes: a placement reconstruction mapping with `hypotheses.near`, `hypotheses.far`, and `candidates`.
- Produces: `select_server_hypothesis(reconstruction, thresholds=DEFAULT_THRESHOLDS) -> dict[str, Any]`.

- [ ] **Step 1: Write failing selector tests**

Add literal fixtures covering a valid near-server two-bounce sequence, a
close-margin abstention, invalid same-half geometry, and missing dual
hypotheses:

```python
def test_selects_only_a_separated_legal_serve():
    result = select_server_hypothesis(valid_near_fixture())
    self.assertEqual(result["status"], "high_confidence")
    self.assertEqual(result["server_side"], "near")
    self.assertEqual(result["serve"]["first_bounce"]["t"], 1.2)
    self.assertEqual(result["serve"]["second_bounce"]["t"], 1.55)

def test_withholds_close_hypotheses():
    fixture = valid_near_fixture(near_score=6.0, far_score=5.0)
    self.assertEqual(
        select_server_hypothesis(fixture)["reason"],
        "hypothesis_margin_too_small",
    )
```

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest worker.tests.test_serve_detection -v`

Expected: import failure because `worker.serve_detection` does not exist.

- [ ] **Step 3: Implement the selector**

Implement:

```python
@dataclass(frozen=True)
class ServeThresholds:
    ready_margin: float = 1.6
    minimum_selected_score: float = 3.5
    minimum_bounce_confidence: float = 0.45
    contact_lookback_s: float = 1.25

def select_server_hypothesis(
    reconstruction: Mapping[str, Any],
    thresholds: ServeThresholds = DEFAULT_THRESHOLDS,
) -> dict[str, Any]:
    ...
```

Require both physical hypotheses, rank by score, require the ready margin,
validate first bounce on the serving half followed by a later bounce on the
opposite half, reject weak bounce evidence and hard contradictions, and infer
the strongest preceding contact candidate without consulting match truth.

- [ ] **Step 4: Verify GREEN**

Run: `python3 -m unittest worker.tests.test_serve_detection -v`

Expected: all selector tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/serve_detection.py worker/tests/test_serve_detection.py
git commit -m "feat: add independent serve selector"
```

### Task 2: Deterministic cross-match batch builder

**Files:**
- Create: `worker/build_serve_detection_research.py`
- Create: `worker/tests/test_build_serve_detection_research.py`

**Interfaces:**
- Consumes: the five configured match IDs, `select_server_hypothesis`, existing production REST/R2 helpers, and point `placement` payloads.
- Produces: `build_manifest(matches: Sequence[MatchInput]) -> dict`, `choose_sample(candidates: Sequence[Candidate]) -> list[Candidate]`, and CLI commands `build-manifest`, `apply-migration`, and `seed`.

- [ ] **Step 1: Write failing rotation and sample tests**

Use hand-derived fixtures to establish the independent truth walk and exact
sample contract:

```python
def test_rotation_handles_deuce_and_next_game_first_server():
    contexts = point_contexts(
        first_server="user",
        points=scored_points([("user", 10), ("opponent", 10), ("user", 2)]),
    )
    self.assertEqual(contexts[20]["server"], "user")
    self.assertEqual(contexts[21]["server"], "opponent")

def test_sample_is_twenty_per_match_and_status_stratified():
    selected = choose_sample(candidate_fixture())
    self.assertEqual(len(selected), 100)
    self.assertEqual(Counter(item.match_key for item in selected), {
        "vaibhav": 20, "gui": 20, "chris": 20, "faye": 20, "patrick": 20,
    })
    self.assertEqual(Counter(item.status for item in selected), {
        "high_confidence": 36, "needs_review": 64,
    })
```

Also test deterministic ordering, round-robin representation of review
reasons, exclusion of unavailable points, and failure when a match cannot
supply 20 eligible points.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest worker.tests.test_build_serve_detection_research -v`

Expected: import failure because the builder does not exist.

- [ ] **Step 3: Implement pure truth and sampling functions**

Define immutable candidate records and pure functions:

```python
@dataclass(frozen=True)
class Candidate:
    match_key: str
    point_id: str
    point_idx: int
    status: str
    reason: str
    proposal: Mapping[str, Any]

def point_contexts(match: Mapping[str, Any], points: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    ...

def choose_sample(candidates: Sequence[Candidate]) -> list[Candidate]:
    ...
```

Port the application's ITTF behavior for first server, game alternation,
deuce, lets, server overrides, `game_end_override`, and side changes. Keep
this function outside the selector call path.

- [ ] **Step 4: Implement read/build/seed commands**

Use stable UUIDs and hashes. The seed command must:

```python
DESTINATION_PREFIX = "research/serve-detection/v1/sources"
BATCH_SLUG = "serve-detection-cross-match-v1"
MATCH_QUOTA = 20
TOTAL_SOURCES = 100
```

Fetch current production match/point rows; call the selector with only
`point["placement"]`; freeze each selected clip; probe duration, FPS, and frame
count; upload immutable MP4s; upsert `research_batches`, `research_sources`,
`research_gold_labels`, and exactly 100 owner assignments; and validate the
sealed manifest before publishing the batch as active.

- [ ] **Step 5: Verify GREEN**

Run: `python3 -m unittest worker.tests.test_build_serve_detection_research -v`

Expected: all builder tests pass.

- [ ] **Step 6: Commit**

```bash
git add worker/build_serve_detection_research.py worker/tests/test_build_serve_detection_research.py
git commit -m "feat: build cross-match serve research batch"
```

### Task 3: Serve-specific TypeScript contracts

**Files:**
- Create: `src/lib/research/serveDetection.ts`
- Create: `src/lib/research/serveDetection.test.ts`

**Interfaces:**
- Produces: `createServeDetectionLabel`, `hydrateServeDetectionLabel`, `setActualServeContact`, `setNoObservableServe`, `upsertServeEvent`, `validateServeDetectionLabel`, and `frameStepTime`.
- Consumed by: the hosted labeler in Task 5.

- [ ] **Step 1: Write failing label-contract tests**

```typescript
test("a serve contact completes the required answer", () => {
  const label = setActualServeContact(createServeDetectionLabel(), 1.234);
  assert.deepEqual(validateServeDetectionLabel(label), []);
  assert.equal(label.actual_serve_contact_s, 1.234);
});

test("no observable serve clears the contact", () => {
  const initial = setActualServeContact(createServeDetectionLabel(), 1.2);
  const next = setNoObservableServe(initial, "bad_cut");
  assert.equal(next.actual_serve_contact_s, null);
  assert.equal(next.no_observable_serve, "bad_cut");
});

test("frame stepping clamps to clip bounds", () => {
  assert.equal(frameStepTime(0.02, -1, 30, 5), 0);
  assert.equal(frameStepTime(4.99, 1, 30, 5), 5);
});
```

Also cover event upsert, allowed taxonomy, hydration, and rejecting an empty
required answer.

- [ ] **Step 2: Verify RED**

Run: `node --test --experimental-strip-types src/lib/research/serveDetection.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement minimal typed contracts**

Define schema-versioned proposal, event, and human-label types. Keep the
primary answer mutually exclusive and normalize timestamps to four decimals.
The taxonomy is:

```typescript
type ServeEventType =
  | "serve_contact"
  | "serve_first_bounce"
  | "serve_second_bounce"
  | "return_contact"
  | "return_bounce"
  | "later_contact"
  | "later_bounce"
  | "net_contact"
  | "non_relevant"
  | "unsure";
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test --experimental-strip-types src/lib/research/serveDetection.test.ts`

Expected: all contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/research/serveDetection.ts src/lib/research/serveDetection.test.ts
git commit -m "feat: add serve research label contract"
```

### Task 4: Private media namespace migration

**Files:**
- Create: `supabase/migrations/056_serve_detection_research.sql`
- Modify: `src/lib/research/labeling.ts`
- Modify: `src/lib/research/labeling.test.ts`
- Modify: `src/lib/research/migration.test.ts`

**Interfaces:**
- Extends the existing research source constraint and `isResearchMediaKey`.
- Reused by the existing `/api/research/media` endpoint.

- [ ] **Step 1: Write failing allowlist and migration tests**

Add behavior assertions:

```typescript
assert.equal(
  isResearchMediaKey(
    "research/serve-detection/v1/sources/12345678-1234-1234-1234-123456789abc.mp4",
  ),
  true,
);
assert.equal(
  isResearchMediaKey("research/serve-detection/v1/sources/not-a-uuid.mp4"),
  false,
);
```

The migration test must verify that migration 056 replaces the constraint
with exactly the three allowed namespaces and preserves the versioned UUID
MP4 shape.

- [ ] **Step 2: Verify RED**

Run: `npm run test:research`

Expected: the serve-detection key is rejected and migration 056 is missing.

- [ ] **Step 3: Implement the narrow allowlist**

Add `serve-detection` to both the TypeScript regex and the Postgres constraint:

```sql
check (
  media_key ~ '^research/(fused-labeling|placement-calibration|serve-detection)/v[0-9]+/sources/[0-9a-f-]{36}\.mp4$'
);
```

- [ ] **Step 4: Verify GREEN**

Run: `npm run test:research`

Expected: all research tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/056_serve_detection_research.sql src/lib/research/labeling.ts src/lib/research/labeling.test.ts src/lib/research/migration.test.ts
git commit -m "feat: allow private serve research media"
```

### Task 5: Authenticated hosted review page

**Files:**
- Create: `src/app/research/serve-detection/types.ts`
- Create: `src/app/research/serve-detection/serveDetectionView.ts`
- Create: `src/app/research/serve-detection/serveDetectionView.test.ts`
- Create: `src/app/research/serve-detection/page.tsx`
- Create: `src/app/research/serve-detection/ServeDetectionLabeler.tsx`

**Interfaces:**
- Consumes: the Task 3 contracts, existing Supabase client, `/api/research/media`, `/api/research/reviewers`, and `/api/research/export`.
- Produces: the production `/research/serve-detection` page.

- [ ] **Step 1: Write failing view-model tests**

Test pure queue behavior before React implementation:

```typescript
test("filters by match and detector status without changing source order", () => {
  assert.deepEqual(
    filterServeAssignments(fixture, { match: "Faye", status: "needs_review" })
      .map((item) => item.sequence),
    [61, 62],
  );
});

test("progress counts only submitted assignments", () => {
  assert.deepEqual(serveProgress(fixture), { completed: 1, total: 3 });
});
```

Also test likely-action labels and direct next-unsubmitted selection.

- [ ] **Step 2: Verify RED**

Run: `node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the server page**

Follow the existing research authorization pattern:

```tsx
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Serve detection research",
  robots: { index: false, follow: false, nocache: true },
};
```

Redirect unauthenticated users to
`/login?next=/research/serve-detection`, return `notFound()` for inactive
unassigned reviewers, query only the fixed batch slug, and select only
review-safe source fields. Do not select `source_match_id` or
`source_point_id`.

- [ ] **Step 4: Implement the client labeler**

Build a single-player workflow with:

- progress, match/status filters, and previous/next;
- one mounted `<video preload="auto">`;
- exact likely-action jumps;
- -3/-2/-1/+1/+2/+3 frame controls;
- “Mark actual serve here” and “No observable serve”;
- event-type selectors and “Add missing event here”;
- hard-negative reason buttons;
- visible scored server and detector output;
- 650 ms debounced autosave with visible state;
- immediate `Submit & next`;
- admin reviewer assignment; and
- admin export.

Use the existing RLS-protected assignment update directly from the Supabase
browser client. On save failure, retain the local label and show a retryable
error.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
npm run test:research
npx eslint src/app/research/serve-detection src/lib/research/serveDetection.ts
```

Expected: view and research tests pass; no lint errors in the new route.

- [ ] **Step 6: Commit**

```bash
git add src/app/research/serve-detection src/lib/research/serveDetection*
git commit -m "feat: host serve detection research review"
```

### Task 6: Seed production research batch

**Files:**
- Generated local manifest outside git: private temporary JSON
- Production writes: migration 056, private R2 research objects, and research-table rows only

**Interfaces:**
- Consumes: Task 2 builder and production credentials.
- Produces: active `serve-detection-cross-match-v1` batch and owner queue.

- [ ] **Step 1: Run dry manifest generation**

Run:

```bash
python3 worker/build_serve_detection_research.py build-manifest --output <private-temp-manifest>
```

Expected: exactly 100 unique sources, exactly 20 per configured match, no
unavailable predictions, and status counts matching the deterministic
manifest.

- [ ] **Step 2: Apply the migration**

Run:

```bash
python3 worker/build_serve_detection_research.py apply-migration
```

Expected: migration 056 applies successfully and the research source media
constraint accepts only the three versioned namespaces.

- [ ] **Step 3: Seed frozen media and rows**

Run:

```bash
python3 worker/build_serve_detection_research.py seed --manifest <private-temp-manifest>
```

Expected: 100 immutable R2 objects, 100 sources, 100 gold records, and 100
owner assignments.

- [ ] **Step 4: Run read-only production audit**

Run the builder's `audit` command and verify:

- batch status is active;
- every source has one media object and gold record;
- the owner has sequences 1 through 100;
- each match has 20 sources; and
- no original `matches` or `points` rows were written.

### Task 7: Full verification and production deployment

**Files:**
- No additional product files unless verification exposes a defect.

**Interfaces:**
- Produces: merged `main` and verified live route.

- [ ] **Step 1: Run full local verification**

Run:

```bash
python3 -m unittest worker.tests.test_serve_detection worker.tests.test_build_serve_detection_research -v
python3 -m unittest discover -s worker/tests
npm run test:research
npm run test:auth
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Review the complete diff**

Confirm line-by-line that:

- no experimental UI or unrelated worker code was merged;
- no credentials, manifests, downloaded clips, or production UUID payloads
  are tracked;
- the selector call receives placement only;
- the route selects no source production IDs; and
- the media allowlist remains narrow.

- [ ] **Step 3: Commit any verification-only fixes**

Use focused commits that include their regression test and rerun the failing
verification before continuing.

- [ ] **Step 4: Merge and push production**

Fast-forward or merge `codex/serve-detection-research` into the current
`main`, then push `origin/main`. Do not push the experimental branch as part
of this operation.

- [ ] **Step 5: Verify Vercel and the live route**

Inspect the production deployment until terminal success, then verify:

- `https://www.ponglens.com/research/serve-detection` redirects an anonymous
  visitor to login;
- the assigned owner can load one protected video;
- frame stepping and exact jumps work;
- a label autosaves, survives reload, and submits;
- delegation creates an independent 100-point queue; and
- export contains labels and gold metadata only for administrators.
