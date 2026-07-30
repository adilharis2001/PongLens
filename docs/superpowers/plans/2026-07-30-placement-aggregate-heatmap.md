# Production Placement Heat Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trusted nine-zone heat map as the second swipe page of the existing match-level placement card, harden future worker placement output for aggregation, and regenerate exactly the two newest eligible production matches.

**Architecture:** A new pure TypeScript module selects and normalizes trusted v3 landing observations from live point, serving, game, and side state. Both the existing dot map and a new SVG heat map consume that single collection inside a responsive two-page viewer. The worker continues producing coordinate evidence rather than stale rendered aggregates, but its output validator gains the confidence, coordinate, sequence, phase, and server/receiver parity guarantees required by the production trust gate.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, SVG, Node test runner, Python 3.12 `unittest`, existing PostgreSQL/R2 placement backfill.

## Global Constraints

- The trust threshold is exactly `0.70`.
- The existing exact placement map remains page one.
- Mobile uses a finger-following horizontal scroll-snap swipe.
- Desktop uses the same pager with visible `Landings` and `Heat map` controls and trackpad-compatible horizontal paging.
- Filters are exactly `My serves`, `Their serves`, `My rally shots`, and `Their rally shots`.
- Serve aggregates use only the receiver-half second bounce.
- Both pages consume one trusted observation collection and must report identical counts.
- The user is always at the bottom; user-left is always map-left after game-end side changes.
- The worker must not persist rendered heat-map images or match-level heat-map summaries.
- No database migration is required.
- Backfill writes are limited to the two newest eligible matches, with the first treated as the canary.

---

### Task 1: Trusted placement observation model

**Files:**
- Create: `src/lib/placement/placementAggregate.ts`
- Create: `src/lib/placement/placementAggregate.test.ts`
- Modify: `src/app/match/[id]/PlacementAggregate.tsx`

**Interfaces:**
- Consumes: `Point[]`, `Side`, `Map<string, number>`, `Map<string, ServeInfo>`, and `selectPlacementHypothesis`.
- Produces:
  - `PLACEMENT_AGGREGATE_TRUST_THRESHOLD = 0.70`
  - `PlacementAggregateFilter = "myServes" | "theirServes" | "myRally" | "theirRally"`
  - `PlacementZone = "short_left" | ... | "deep_right"`
  - `TrustedPlacementObservation`
  - `normalizePlacementCoordinates(u, v, userPhysicalSide)`
  - `classifyPlacementZone(normalizedU, normalizedV, filter)`
  - `collectTrustedPlacementObservations(input)`
  - `trustedPlacementPointCount(observations)`

- [ ] **Step 1: Write failing coordinate, filtering, and trust tests**

Create literal v3 fixtures that prove:

```ts
const near = normalizePlacementCoordinates(0.1, 2.6, "near");
assert.ok(Math.abs(near.u - 1.425) < 1e-9);
assert.ok(Math.abs(near.v - 2.6) < 1e-9);

const far = normalizePlacementCoordinates(0.1, 2.6, "far");
assert.ok(Math.abs(far.u - 0.1) < 1e-9);
assert.ok(Math.abs(far.v - 0.14) < 1e-9);
```

Add assertions that:

```ts
assert.equal(classifyPlacementZone(0.1, 2.6, "myServes"), "deep_left");
assert.equal(classifyPlacementZone(1.42, 0.1, "theirServes"), "deep_right");
```

Build points covering:

- user near and user far;
- a game-index side swap;
- a user serve and opponent serve;
- user and opponent rally shots;
- hypothesis, shot, and landing confidence at `0.69` and `0.70`;
- `review`, `unavailable`, and hard-reason hypotheses;
- an impossible even shot owned by the server;
- a serve first bounce plus second-bounce landing.

Assert that only valid `0.70+` receiver-half landings enter their exact filter,
that `serve_first_bounce` never appears, and that point IDs are deduplicated by
`trustedPlacementPointCount`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregate.test.ts
```

Expected: FAIL because `placementAggregate.ts` and its exports do not exist.

- [ ] **Step 3: Implement canonical normalization and zone classification**

Use normalized table coordinates where `u=0` is user-left, `u=1.525` is
user-right, `v=0` is the user's end, and `v=2.74` is the opponent's end:

```ts
export function normalizePlacementCoordinates(
  u: number,
  v: number,
  userPhysicalSide: Side,
) {
  return userPhysicalSide === "near"
    ? { u: TABLE_WIDTH_M - u, v }
    : { u, v: TABLE_LENGTH_M - v };
}
```

Classify lateral thirds from normalized `u`. Classify depth from the net into
the receiver's half: upward for `myServes`/`myRally`, downward for
`theirServes`/`theirRally`.

- [ ] **Step 4: Implement strict trusted observation collection**

For each visible v3 point:

1. derive the point's physical user side with `physicalSideForGame`;
2. resolve the live scored server from `serving`;
3. select the matching physical-server hypothesis;
4. require `ready`, confidence `>= 0.70`, and no hard reasons;
5. require shot and landing confidence `>= 0.70`;
6. derive the expected hitter from server side and `shot.seq` parity;
7. reject a stored hitter that disagrees;
8. normalize the landing and assign one filter and one zone.

Do not include v1 or v2 rows because they lack the v3 confidence contract.

- [ ] **Step 5: Make `mappedPointCount` use trusted observations**

Replace the independent v2/v3 counting walk in
`PlacementAggregate.tsx` with:

```ts
trustedPlacementPointCount(
  collectTrustedPlacementObservations({
    points,
    userSide,
    gameIndexByPoint,
    serving,
  }),
)
```

This keeps the Tools row, empty state, dots, and heat map on one definition of
“mapped.”

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregate.test.ts
```

Expected: all observation, trust, serve, parity, side-swap, and zone tests pass.

- [ ] **Step 7: Commit**

```bash
git add \
  src/lib/placement/placementAggregate.ts \
  src/lib/placement/placementAggregate.test.ts \
  'src/app/match/[id]/PlacementAggregate.tsx'
git commit -m "feat: derive trusted placement observations"
```

---

### Task 2: Nine-zone production heat-map renderer

**Files:**
- Create: `src/app/match/[id]/PlacementHeatMap.tsx`
- Create: `src/lib/placement/placementHeatMapView.test.ts`
- Modify: `src/app/match/[id]/placementTable.tsx`

**Interfaces:**
- Consumes: `TrustedPlacementObservation[]`, active `PlacementAggregateFilter`, and `MapLabels`.
- Produces:
  - `placementZoneCounts(observations, filter)`
  - `PlacementHeatMap`
  - stable SVG cell geometry sharing `TX`, `TY`, `TW`, `TH`, `NET_Y`, `W_M`, and `L_M`.

- [ ] **Step 1: Write failing heat-count and static UI-contract tests**

In `placementAggregate.test.ts`, assert:

```ts
assert.deepEqual(
  placementZoneCounts(observations, "myServes"),
  {
    short_left: 0,
    short_middle: 0,
    short_right: 0,
    medium_left: 0,
    medium_middle: 1,
    medium_right: 0,
    deep_left: 2,
    deep_middle: 0,
    deep_right: 0,
  },
);
```

In `placementHeatMapView.test.ts`, read the renderer source and require:

- all nine zone keys;
- `role="img"` and an accessible heat-map label;
- reuse of the existing `Table`;
- cyan and amber tone selection;
- cell count text;
- explicit top and bottom player labels;
- no new yellow warning-panel classes or copy.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregate.test.ts \
  src/lib/placement/placementHeatMapView.test.ts
```

Expected: FAIL because the count helper and renderer do not exist.

- [ ] **Step 3: Implement deterministic nine-zone counts**

Return every zone with an integer count, including zero-count cells. Normalize
cell intensity to the active filter's largest count:

```ts
const opacity =
  maxCount === 0 ? 0.06 : 0.12 + 0.68 * (count / maxCount);
```

Use cyan for `myServes` and `myRally`; amber for `theirServes` and
`theirRally`.

- [ ] **Step 4: Implement the SVG heat map**

Render only the receiver's half as the active three-by-three grid while keeping
the full shared table and player labels visible. Each cell contains its count
when nonzero. Use the same normalized table orientation as the exact dot view;
do not apply CSS transforms or a second mirroring rule.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregate.test.ts \
  src/lib/placement/placementHeatMapView.test.ts
```

Expected: all count and renderer-contract tests pass.

- [ ] **Step 6: Commit**

```bash
git add \
  'src/app/match/[id]/PlacementHeatMap.tsx' \
  'src/app/match/[id]/placementTable.tsx' \
  src/lib/placement/placementAggregate.test.ts \
  src/lib/placement/placementHeatMapView.test.ts
git commit -m "feat: render trusted placement heat map"
```

---

### Task 3: Responsive swipe and desktop pager

**Files:**
- Modify: `src/app/match/[id]/PlacementAggregate.tsx`
- Create: `src/lib/placement/placementAggregateView.test.ts`

**Interfaces:**
- Consumes: the trusted observation collector and `PlacementHeatMap`.
- Produces: one responsive `Where the ball landed` card with synchronized
  page, filter, game, coverage, and empty-state behavior.

- [ ] **Step 1: Write the failing responsive UI contract**

Read `PlacementAggregate.tsx` and assert that it contains:

- a two-page state: `"landings" | "heatmap"`;
- labels `Landings` and `Heat map`;
- `snap-x`, `snap-mandatory`, and two `snap-center` pages;
- a scroll handler that derives the active page from `scrollLeft`;
- a pager action that calls `scrollTo`;
- two visible page indicators;
- all four exact landing filter labels;
- the exact sparse copy
  `Not enough trusted landings in this view yet.`;
- `Second bounce` copy for both serve filters;
- one use of `collectTrustedPlacementObservations`;
- no independent second placement-selection loop.

- [ ] **Step 2: Run the view test and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregateView.test.ts
```

Expected: FAIL because the existing aggregate has three filters and no pager.

- [ ] **Step 3: Replace the local aggregate walk with shared observations**

Collect all trusted observations once. Derive the current game and landing
filter with `useMemo`. Map normalized coordinates to SVG pixels without
re-mirroring:

```ts
const x = TX + (TW * observation.u) / W_M;
const y = TY + TH * (1 - observation.v / L_M);
```

Use the same filtered array for exact circles, heat cells, landing count, and
contributing-point count.

- [ ] **Step 4: Implement shared filters and honest copy**

Use exact filter labels and helper text:

```text
My serves: Second bounce on their side.
Their serves: Second bounce on your side.
My rally shots: Your non-serve shots that bounced on their side.
Their rally shots: Their non-serve shots that bounced on your side.
```

When the filter contains fewer than three observations, keep the exact dots
available but show the sparse message on the heat-map page instead of
interpreting a pattern.

- [ ] **Step 5: Implement the two-page viewer**

Mobile:

- full-width pages;
- `overflow-x-auto snap-x snap-mandatory`;
- native touch scrolling;
- page follows the finger;
- two tappable indicators.

Desktop:

- preserve one page in the existing card footprint;
- keep `Landings` and `Heat map` controls visible;
- use the same `scrollTo` pager;
- allow horizontal trackpad scrolling;
- do not render an unrelated dashboard grid.

- [ ] **Step 6: Run placement UI tests**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregate.test.ts \
  src/lib/placement/placementHeatMapView.test.ts \
  src/lib/placement/placementAggregateView.test.ts
```

Expected: all model and UI-contract tests pass.

- [ ] **Step 7: Commit**

```bash
git add \
  'src/app/match/[id]/PlacementAggregate.tsx' \
  src/lib/placement/placementAggregateView.test.ts
git commit -m "feat: swipe between placement map and heat map"
```

---

### Task 4: Worker heat-map readiness contract and scoped backfill

**Files:**
- Modify: `worker/worker.py`
- Modify: `worker/backfill_placement_v3.py`
- Modify: `worker/tests/test_worker_backfill.py`
- Modify: `worker/tests/test_backfill_runner.py`

**Interfaces:**
- Consumes: placement v3 JSON from reconstruction.
- Produces:
  - `_validate_unit_confidence(value, label)`
  - stricter `_validate_v3_placement(payload)`
  - `run_rollout(..., target_match_ids: Sequence[str] = ())`
  - repeatable CLI `--match-id`.

- [ ] **Step 1: Write failing worker-contract tests**

Add validator tests proving it rejects:

- `NaN`, infinity, negative, and `>1` hypothesis/shot/event confidence;
- landing coordinates outside `0..1.525` and `0..2.74`;
- noncontiguous or zero-based shot sequences;
- a shot whose hitter side contradicts odd/even sequence from the hypothesis
  server side;
- a serve shot not at sequence 1;
- a serve landing on the server's half.

Keep terminal out markers and contact coordinates exempt from on-table landing
bounds.

- [ ] **Step 2: Run validator tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_worker_backfill.OutputSchemaTests -v
```

Expected: new invalid payloads are currently accepted.

- [ ] **Step 3: Implement bounded confidence, landing, and parity validation**

Use `math.isfinite`, require confidence in `[0, 1]`, require landing coordinates
inside the table, require `shot.seq == index + 1`, and derive:

```python
expected_hitter = (
    side if shot["seq"] % 2 == 1
    else ("far" if side == "near" else "near")
)
```

Reject a mismatch before any production placement update is committed.

- [ ] **Step 4: Run worker-contract tests and verify GREEN**

Run the same focused `OutputSchemaTests`; expect all tests to pass.

- [ ] **Step 5: Write failing explicit-target rollout tests**

Extend `test_backfill_runner.py` to assert:

- `target_match_ids=("newest-a", "newest-b")` runs the canary first and only
  those two IDs;
- a requested ID outside the eligible set fails before mutation;
- `--all-after-canary` and explicit `--match-id` cannot be combined;
- dry run reports the two selected matches without calling the backfill;
- a canary consistency failure prevents the second match.

- [ ] **Step 6: Run rollout tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_backfill_runner -v
```

Expected: FAIL because explicit target selection does not exist.

- [ ] **Step 7: Implement safe explicit targeting**

Add repeatable:

```python
parser.add_argument("--match-id", action="append", default=[])
```

When targets are supplied, build the ordered rollout as:

```python
ordered_ids = [canary_match_id, *deduplicated_non_canary_targets]
```

Validate every ID against `list_eligible_matches` before the first mutation.
Preserve the existing pre/post non-placement snapshot invariant.

- [ ] **Step 8: Run focused worker tests and verify GREEN**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_worker_backfill \
  worker.tests.test_backfill_runner -v
```

Expected: all validator and rollout tests pass.

- [ ] **Step 9: Commit**

```bash
git add \
  worker/worker.py \
  worker/backfill_placement_v3.py \
  worker/tests/test_worker_backfill.py \
  worker/tests/test_backfill_runner.py
git commit -m "fix: guarantee heatmap-ready placement output"
```

---

### Task 5: Full verification, production deployment, and two-match backfill

**Files:**
- Verify: all files changed in Tasks 1–4.
- Production mutations: placement fields for exactly two existing matches.

**Interfaces:**
- Consumes: merged main commit, Vercel deployment, production worker
  credentials, and the two newest eligible match IDs.
- Produces: live placement carousel and regenerated v3 point placement for the
  two matches.

- [ ] **Step 1: Run the complete local verification suite**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/placement/placementAggregate.test.ts \
  src/lib/placement/placementHeatMapView.test.ts \
  src/lib/placement/placementAggregateView.test.ts
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  discover -s worker/tests -v
npm run test:research
npm run lint
npm run build
git diff --check
git status --short
```

Expected:

- all Node tests pass;
- all worker tests pass;
- research tests pass;
- lint has no new errors or warnings;
- production build succeeds;
- worktree is clean after commits.

- [ ] **Step 2: Merge and push main without overwriting concurrent work**

Fetch origin, rebase or merge only if main advanced, rerun the focused model,
view, validator, and rollout tests on the merged commit, then push `main`.

- [ ] **Step 3: Wait for the exact Vercel commit**

Find the deployment whose Git SHA equals the pushed commit. Wait until
`READY`, then verify:

```bash
curl -sS -o /dev/null -D - \
  https://www.ponglens.com/research/placement-calibration
```

Expected: the authenticated route redirects to login when unsigned.

- [ ] **Step 4: Discover the two newest eligible matches read-only**

Using the same eligibility predicate as `list_eligible_matches`, select exactly
two IDs ordered by `matches.created_at desc`. Record only safe audit fields:
match ID, creation time, point count, placement status, and raw-source
availability. Do not print storage credentials or URLs.

- [ ] **Step 5: Run a two-match dry run**

Use the newer match as canary:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/backfill_placement_v3.py \
  --canary-match-id "$NEWEST_MATCH_ID" \
  --match-id "$SECOND_NEWEST_MATCH_ID" \
  --dry-run
```

Expected: exactly two selected eligible matches, zero writes.

- [ ] **Step 6: Snapshot non-placement invariants and execute**

Record hashes of the two match rows excluding placement lifecycle fields and
of their point rows excluding `placement`. Run the same command without
`--dry-run`. The canary must complete and pass invariant verification before
the second match begins.

- [ ] **Step 7: Verify production database results**

For each match assert:

- match and point non-placement hashes are unchanged;
- every point has v3 placement with both hypotheses;
- lifecycle status and mapped-point count match the completed backfill;
- every ready hypothesis passes the new heat-map readiness validator;
- no match, job, point, clip, or research rows were created.

- [ ] **Step 8: Verify the production user experience**

Using the authenticated browser session, open both match pages and check:

- the existing exact map is initially visible;
- mobile swipe follows the finger and lands on the heat map;
- desktop pager and horizontal trackpad paging work;
- both page indicators stay synchronized;
- all four filters work;
- exact and heat counts agree;
- serve filters state `Second bounce`;
- user/opponent labels and left/right match video in both matches;
- a game-end side change retains user-relative orientation;
- filters with fewer than three observations show the sparse message.

- [ ] **Step 9: Final production report**

Report the pushed commit, deployment URL/status, the two backfilled match IDs
and point counts, trusted landing/point coverage per match, verification
results, and any filter that remained sparse. Do not claim population-level
accuracy from two matches.
