# Height-Aware Ball Trajectory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a continuous, solid, height-corrected best-estimate ball path in the admin portal for calibrated historical and future uploads.

**Architecture:** A pure TypeScript reconstruction module recovers camera-centre candidates from the table homography, lifts each BlurBall observation along its camera ray using event-constrained height estimates, rejects physically impossible identity jumps, and returns a continuous metric trajectory. The server-side admin hydrator applies it to full-rate track rows and placement evidence; the client only renders the resulting points in a true-aspect-ratio court view.

**Tech Stack:** TypeScript, Node test runner, React 19, Next.js 15, SVG, existing R2 JSON artifacts.

**Spec:** `docs/superpowers/specs/2026-08-31-height-aware-ball-trajectory-design.md`

## Global Constraints

- Render one continuous solid best-estimate path; do not encode uncertainty with dashes.
- Preserve measured bounce coordinates exactly.
- Use the existing per-upload table calibration to account for camera height, distance, and lateral offset.
- Reject implausible neighbouring-ball identity jumps rather than drawing teleports.
- Degrade to bounce markers when reconstruction is unavailable; never fall back to the misleading airborne table-plane path.
- Apply during server hydration so existing calibrated uploads and future uploads need no schema migration or R2 rewrite.
- Validate Young 2 cards 24 and 25 and representative Kyle 2 cards before production release.

---

### Task 1: Camera-ray and trajectory reconstruction

**Files:**
- Create: `src/app/admin/uploads/ballTrajectory.ts`
- Create: `src/app/admin/uploads/ballTrajectory.test.ts`

**Interfaces:**
- Consumes: normalized BlurBall rows, source dimensions, A/B/C/D table corners, bounce/contact/net evidence, and detector seen spans.
- Produces: `reconstructBallTrajectory(input: BallTrajectoryInput): EstimatedTrajectoryPoint[]` and `recoverCameraCandidates(...)` for focused tests.

- [ ] **Step 1: Write failing camera-height tests**

Add a Young 2 calibration fixture and assert that the measured table bounce stays at its literal table coordinate while the airborne contact moves from the false plane projection toward the camera:

```ts
test("height correction keeps a bounce fixed and returns the serve contact to its lateral source", () => {
  const points = reconstructBallTrajectory(youngServeFixture);
  const contact = nearest(points, 342.63);
  const bounce = nearest(points, 343.11);
  assert.ok(contact.u > 0.2 && contact.u < 0.9);
  assert.ok(contact.v > 2.65 && contact.v < 3.45);
  closeTo(bounce.u, 0.661, 0.035);
  closeTo(bounce.v, 1.920, 0.035);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --experimental-strip-types src/app/admin/uploads/ballTrajectory.test.ts`

Expected: FAIL because `ballTrajectory.ts` and `reconstructBallTrajectory` do not exist.

- [ ] **Step 3: Implement metric homography and camera candidates**

Create focused numeric helpers and the public contracts:

```ts
export interface EstimatedTrajectoryPoint {
  t: number;
  u: number;
  v: number;
  z: number;
}

export interface BallTrajectoryInput {
  track: readonly (readonly number[])[];
  quad: readonly (readonly number[])[];
  sourceWidth: number;
  sourceHeight: number;
  bounces: readonly TrajectoryBounce[];
  contacts?: readonly TrajectoryContact[];
  crossings?: readonly number[];
  serveTime?: number | null;
  seen?: readonly (readonly [number, number])[];
}

export function recoverCameraCandidates(
  quad: BallTrajectoryInput["quad"],
  width: number,
  height: number
): CameraCandidate[];

export function reconstructBallTrajectory(
  input: BallTrajectoryInput
): EstimatedTrajectoryPoint[];
```

Use the existing Zhang constraints from `worker/table_keypoint_camera.py`: solve table-to-image `H`, derive both positive focal candidates, decompose `K^-1 H`, Gram-Schmidt the rotation columns, select positive-height cameras behind the near end, and retain plausible `0.3m–3.0m` camera heights.

- [ ] **Step 4: Implement event-constrained ray lifting**

For every sample, obtain its `z=0` table intersection `(u0,v0)`. At height `z`, move that point toward camera centre `(uc,vc)`:

```ts
const liftAlongRay = (u0: number, v0: number, z: number, camera: CameraCandidate) => ({
  u: u0 + (z / camera.height) * (camera.u - u0),
  v: v0 + (z / camera.height) * (camera.v - v0),
});
```

Build ordered anchors with bounce `z=0` and contact `z=0.28`. Between two bounces use `z = min(0.55, 4 * peak * s * (1 - s))`, where `peak = min(0.55, 9.81 * duration^2 / 8)`. Between contact and bounce blend the endpoint heights plus a positive `0.08m` arc. Preserve bounce output by replacing the nearest reconstructed sample with the measured bounce `u/v`.

- [ ] **Step 5: Write and verify RED tests for jump rejection and missing bounce**

```ts
test("an isolated neighbouring-ball teleport is removed", () => {
  const result = reconstructBallTrajectory(jumpFixture);
  assert.equal(result.some((p) => p.u < -1 || p.u > 2.5), false);
});

test("a missing first serve bounce still produces one continuous net-traversing path", () => {
  const result = reconstructBallTrajectory(missedBounceFixture);
  assert.ok(result.length > 10);
  assert.equal(result.every((_, i) => i === 0 || result[i].t > result[i - 1].t), true);
  assert.ok(result.some((p) => p.v < 1.37));
  assert.ok(result.some((p) => p.v > 1.37));
});
```

Run the focused test and confirm both new cases fail for their intended missing behavior.

- [ ] **Step 6: Implement robust candidate scoring and continuity**

Score each camera candidate with literal penalties for bounce displacement, horizontal acceleration, speed above `35m/s`, height outside `0–1.6m`, and non-terminal points outside the `u=-0.45–1.975m`, `v=-0.75–3.49m` playing corridor. Remove an interior sample only when both adjacent speeds exceed `35m/s` and the bridged speed does not. Return retained points in time order with no `startsSegment` breaks.

When a serve contact and receiver-side first landing imply a missing own-side bounce, insert a latent zero-height anchor between them at the local image-y maximum or, if unavailable, `55%` of the elapsed time. Use it only for height estimation; do not add a bounce ring.

- [ ] **Step 7: Run reconstruction tests and refactor green**

Run: `node --test --experimental-strip-types src/app/admin/uploads/ballTrajectory.test.ts`

Expected: all reconstruction tests pass with zero failures.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/app/admin/uploads/ballTrajectory.ts src/app/admin/uploads/ballTrajectory.test.ts
git commit -m "feat: reconstruct height-aware ball trajectories"
```

---

### Task 2: Attach placement evidence during server hydration

**Files:**
- Modify: `src/app/admin/uploads/uploadView.ts`
- Modify: `src/app/admin/uploads/serveMiss.ts`
- Modify: `src/app/admin/uploads/serveMiss.test.ts`
- Modify: `src/app/admin/uploads/[matchId]/page.tsx`

**Interfaces:**
- Consumes: `reconstructBallTrajectory` from Task 1 and runtime placement-v3 candidates/hypotheses from `match.json`.
- Produces: `MissCard.trajectory?: EstimatedTrajectoryPoint[]` in the serialized admin payload.

- [ ] **Step 1: Write the failing hydration test**

Extend the real hydration fixture with a matching `matchJson.points` row and a ready placement hypothesis. Assert that measured full-rate rows are used and the card receives a non-empty trajectory whose event times match the placement shots.

```ts
assert.ok(hydrated.cards[0].trajectory?.length);
assert.equal(hydrated.cards[0].trajectory?.[0].t, 342.63);
assert.equal(hydrated.cards[0].track[0].length, 3);
```

- [ ] **Step 2: Run the hydration test and verify RED**

Run: `node --test --experimental-strip-types src/app/admin/uploads/serveMiss.test.ts`

Expected: FAIL because hydration does not accept match evidence or produce `trajectory`.

- [ ] **Step 3: Add the minimal placement JSON types**

Extend `MatchJson.points` without importing worker-only types:

```ts
points?: Array<{
  idx?: number;
  t0?: number;
  t1?: number;
  serve_s?: number | null;
  placement?: {
    status?: string;
    candidates?: PlacementCandidateJson[];
    hypotheses?: Record<string, PlacementHypothesisJson>;
  } | null;
}>;
```

Only fields read by reconstruction belong in these interfaces.

- [ ] **Step 4: Select consistent contact and bounce evidence**

In `serveMiss.ts`, find the match point with `abs(point.t0 - card.t0) < 0.1`. Prefer the highest-confidence hypothesis whose status is `ready`; flatten its ordered shot contact, `serve_first_bounce`, and landing references. Deduplicate events within `0.035s`. If none is ready, pass the card's on-surface bounce list and serve time.

- [ ] **Step 5: Reconstruct before stripping confidence**

Change the signature to:

```ts
export function hydrateServeMissData(
  data: ServeMissData,
  tracks: FullRateTrackSource | null,
  fps?: number,
  matchJson?: MatchJson | null
): ServeMissData;
```

Call reconstruction with the full rows, then retain the existing behavior that serializes only `[t,x,y]` into `card.track`. Attach `trajectory` only when at least two valid points are returned.

- [ ] **Step 6: Pass match JSON from the admin page**

Update the page call to `hydrateServeMissData(serveMisses, tracks, matchJson?.source?.fps, matchJson)`.

- [ ] **Step 7: Run hydration and reconstruction tests**

Run: `node --test --experimental-strip-types src/app/admin/uploads/serveMiss.test.ts src/app/admin/uploads/ballTrajectory.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/app/admin/uploads/uploadView.ts src/app/admin/uploads/serveMiss.ts src/app/admin/uploads/serveMiss.test.ts 'src/app/admin/uploads/[matchId]/page.tsx'
git commit -m "feat: hydrate admin cards with estimated trajectories"
```

---

### Task 3: Render the metric best-estimate court view

**Files:**
- Modify: `src/app/admin/uploads/[matchId]/ServeMissView.tsx`
- Modify: `src/app/admin/uploads/serveMiss.test.ts`

**Interfaces:**
- Consumes: `MissCard.trajectory` from Task 2.
- Produces: a true-aspect-ratio table plus court margin, persistent solid path, bright recent trail, current ball marker, and unchanged bounce rings.

- [ ] **Step 1: Write the failing trajectory-selection test**

Extract and test a pure selector in `serveMiss.ts`:

```ts
test("the court draws only a reconstructed trajectory, never raw airborne plane projection", () => {
  assert.deepEqual(courtTrajectory({ ...card, trajectory: estimate }), estimate);
  assert.deepEqual(courtTrajectory({ ...card, trajectory: undefined }), []);
});
```

- [ ] **Step 2: Run the selector test and verify RED**

Run: `node --test --experimental-strip-types src/app/admin/uploads/serveMiss.test.ts`

Expected: FAIL because `courtTrajectory` does not exist.

- [ ] **Step 3: Implement the selector and update the SVG geometry**

Use a single metric scale for both dimensions:

```ts
const METRES_TO_PX = 65.5;
const COURT_W = TABLE_W_M * METRES_TO_PX;
const COURT_H = TABLE_L_M * METRES_TO_PX;
const SIDE_MARGIN_M = 0.45;
const END_MARGIN_M = 0.70;
```

Compute `courtXY` from the extended metric bounds so the table retains its physical aspect ratio and positions behind either end remain visible.

- [ ] **Step 4: Replace raw path rendering**

Read `const projectedTrack = courtTrajectory(card)`. Keep `CompleteCourtPath` and `tableTrailAt`, but supply the reconstructed continuous points. Change accessibility and visible copy from `BlurBall path` to `Best estimate path`. Do not call `projectTrackToTable` in the client.

- [ ] **Step 5: Run focused tests and production build**

Run:

```bash
node --test --experimental-strip-types src/app/admin/uploads/serveMiss.test.ts src/app/admin/uploads/ballTrajectory.test.ts
npm run build
```

Expected: tests pass and Next.js build exits `0`.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/app/admin/uploads/serveMiss.ts src/app/admin/uploads/serveMiss.test.ts 'src/app/admin/uploads/[matchId]/ServeMissView.tsx'
git commit -m "feat: draw metric best-estimate ball paths"
```

---

### Task 4: Validate Young 2 and Kyle 2 against production artifacts

**Files:**
- No repository files; this is a read-only replay of production JSON through the shipped hydrator.

**Interfaces:**
- Consumes: existing R2 `match.json`, `serves.json`, and `tracks.json` for Young 2 and Kyle 2 plus `hydrateServeMissData` from Task 2.
- Produces: a read-only validation report to stdout; it does not change repository, R2, or database state.

- [ ] **Step 1: Download the three artifacts into a disposable directory**

Create the directory with `mktemp -d`. Use `worker.research_reprocess.s3_client(config())` in a Python here-document to download `match.json`, `serves.json`, and `tracks.json` for each ID. Print only the temporary directory path and object sizes; never print credentials and never call an upload API.

- [ ] **Step 2: Replay the production artifacts through the real hydrator**

Run Node with `--experimental-strip-types --input-type=module`, import `hydrateServeMissData` from `src/app/admin/uploads/serveMiss.ts`, read each downloaded JSON file, and call:

```ts
const hydrated = hydrateServeMissData(
  serves,
  tracks,
  matchJson.source?.fps,
  matchJson
);
```

For each card, compute and print: trajectory sample count, fraction inside `u=-0.45–1.975m` and `v=-0.70–3.44m`, minimum/maximum `u/v`, and number of sign changes around the net `v=1.37`. For every bounce with `u/v`, compare the nearest trajectory sample and print the maximum displacement.

- [ ] **Step 3: Check the named acceptance cases**

Inspect Young 2 cards 24 and 25 by their `t0` values `323.40` and `341.03`. Card 25 must retain the useful bounces near `(0.661,1.920)` and `(1.246,0.914)` within `0.035m`, cross the net, and keep the reconstructed serve source inside the displayed court margin. Card 24 must cross the net without any retained point outside the displayed court margin. Sample at least three serve cards from Kyle 2 and require the same bounds and bounce preservation.

- [ ] **Step 4: Delete the disposable directory**

Remove only the exact `mktemp` directory recorded in Step 1 after confirming it contains the six downloaded JSON files and nothing else.

---

### Task 5: Review, merge, deploy, and inspect production

**Files:**
- No planned source changes; review fixes remain scoped to files above.

**Interfaces:**
- Consumes: completed feature commits and validation output.
- Produces: reviewed `main`, a successful production deployment, and direct admin-page evidence for Young 2 and Kyle 2.

- [ ] **Step 1: Run the complete relevant verification set**

Run:

```bash
node --test --experimental-strip-types src/app/admin/uploads/serveMiss.test.ts src/app/admin/uploads/ballTrajectory.test.ts src/lib/placement/*.test.ts
npm run lint -- src/app/admin/uploads/ballTrajectory.ts src/app/admin/uploads/ballTrajectory.test.ts src/app/admin/uploads/serveMiss.ts src/app/admin/uploads/serveMiss.test.ts 'src/app/admin/uploads/[matchId]/ServeMissView.tsx' 'src/app/admin/uploads/[matchId]/page.tsx' src/app/admin/uploads/uploadView.ts
npm run build
git diff --check origin/main...HEAD
```

Expected: zero test failures, zero lint errors, build exit `0`, and no whitespace errors.

- [ ] **Step 2: Request code review**

Dispatch the code-review agent with `origin/main` as base, `HEAD` as head, this plan, and the design spec. Fix every Critical and Important finding, then rerun Step 1.

- [ ] **Step 3: Merge the feature branch to main**

The user explicitly requested production integration. Update local `main` without discarding its unrelated working-tree changes, merge `codex/admin-ball-trail` non-destructively, and push `main`. If the dirty main checkout overlaps any feature file, stop and preserve both versions rather than overwriting.

- [ ] **Step 4: Verify deployment provenance**

Use the repository's existing Vercel deployment workflow, wait for READY, and verify the production build reports the merged commit SHA and the `www.ponglens.com` alias.

- [ ] **Step 5: Inspect the signed-in production admin portal**

Open Young 2 and Kyle 2 in the in-app browser. On Young 2 cards 24 and 25 verify the label is `Best estimate path`, the path is solid, the table has true aspect ratio and court margin, bounce rings remain fixed, and the large outward loop/teleport is absent. Inspect at least two Kyle 2 cards at serve and mid-rally playheads.

- [ ] **Step 6: Report exact evidence**

Report the merged SHA, deployment ID/URL, test counts, validation summaries for both matches, and any remaining known limitations. Do not claim the feature is complete without fresh command and production-page evidence.
