# Canonical Score Commands Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every owner score and point-structure mutation through revision-checked, idempotent database commands while existing readers continue to render their current calculations, and publish worker/manual-cutter points without partial canonical state.

**Architecture:** Phase one’s private `point_score_state` and `match_score_state` remain the derived truth. Phase two adds typed SECURITY DEFINER commands around one shared authorization, lock, idempotency and snapshot contract; web and iOS use those commands only when a private per-account rollout capability is enabled and otherwise retain the established write paths. Worker publication stays transaction-scoped and calls an internal finalizer once, so old worker packages remain compatible and new packages retain manual-cutter source-time observations.

**Tech Stack:** PostgreSQL/PLpgSQL migrations and RLS, Supabase JS and Swift clients, Next.js/TypeScript, Swift, Python/psycopg worker, Node test runner, Swift command-line parity suite, pytest/unittest.

**Spec:** `docs/superpowers/specs/2026-09-15-canonical-scored-match-state-design.md`

## Global Constraints

- This is rollout phase two: existing readers remain on legacy calculations and compare against returned canonical snapshots; no customer-facing score/game/server rendering switches in this plan.
- Old supported web/iOS builds and old worker packages must continue to function against the additive schema.
- Owner scoring, admin research labels and worker evidence remain separate authorities.
- Every owner command requires the authenticated match owner, an exact `expected_score_revision`, and a caller-generated unique `request_id`.
- Duplicate delivery of the same request returns the original response and never repeats a mutation.
- A stale expected revision applies nothing and returns the current revision/snapshot as a typed `score_conflict` response.
- Structural functions lock the match before points and preserve the active processing-version checks already enforced by existing RPCs.
- Manual-cutter `t0` and `t1` remain source-clock human observations with `manual_cutter` / `owner_manual_boundary` provenance.
- During this phase projection failures remain fail-open for legacy direct writes, but atomic v2 commands fail closed and roll back their own mutation.
- No direct score-field grants are revoked in this plan.
- Web changes must pass `npm run build`; native changes must pass `bash ios/Tests/run.sh` and simulator verification before production.
- The rollout capability defaults to `off` and uses the existing `off | on | user:<uuid> | users:<uuid>,...` grammar.

---

### Task 1: Command kernel, capability and exact response contract

**Files:**
- Create: `supabase/migrations/20260916120000_canonical_score_commands.sql`
- Modify: `scripts/scoring/setup-local-db.mjs`
- Modify: `src/lib/scoring/migration.test.ts`
- Modify: `src/lib/scoring/database.test.ts`
- Create: `src/lib/scoring/commands.ts`
- Create: `src/lib/scoring/commands.test.ts`

**Interfaces:**
- Consumes: `refresh_match_score_state(uuid)`, `matches.score_revision`, `match_score_mutations`, `point_score_state`, `match_score_state`, `has_match_access(uuid)`.
- Produces: `canonical_score_commands_enabled() returns boolean`, private `_canonical_score_snapshot(uuid) returns jsonb`, private `_canonical_score_command_context(uuid,uuid,bigint,text) returns jsonb`, and TypeScript `CanonicalScoreSnapshot`, `CanonicalCommandResult`, `parseCanonicalCommandResult`.

- [x] **Step 1: Write RED static and parser tests**

Add tests proving the migration seeds `canonical_score_commands = off`, the capability function uses the approved per-user grammar, all internal functions revoke client execution, and the parser accepts exactly:

```ts
type CanonicalCommandResult =
  | { ok: true; requestId: string; revision: number; snapshot: CanonicalScoreSnapshot; payload: unknown }
  | { ok: false; code: "score_conflict"; revision: number; snapshot: CanonicalScoreSnapshot }
  | { ok: false; code: "not_enabled" | "not_owner" | "not_found" | "invalid_input" };
```

- [x] **Step 2: Run RED**

Run: `node --test --experimental-strip-types src/lib/scoring/commands.test.ts src/lib/scoring/migration.test.ts`

Expected: FAIL because the second migration and parser do not exist.

- [x] **Step 3: Implement the command kernel**

The migration must:

```sql
insert into public.app_config(key,value)
values ('canonical_score_commands','off')
on conflict (key) do nothing;

create function public.canonical_score_commands_enabled()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_admin() or exists (
    select 1 from public.app_config c
    where c.key='canonical_score_commands'
      and (c.value='on'
        or c.value='user:' || (select auth.uid())::text
        or (c.value like 'users:%' and (select auth.uid())::text = any(
          string_to_array(replace(substr(c.value,7),' ',''),','))))
  )
$$;
```

`_canonical_score_command_context` locks the match, verifies owner/capability, returns a prior ledger `after_state` for a matching duplicate request, rejects a reused request for another action/match, and returns a conflict object without writing when the expected revision is stale. `_canonical_score_snapshot` refuses mixed revisions and returns the match summary plus ordered point rows.

- [x] **Step 4: Extend the isolated database setup and run GREEN**

Apply both canonical migrations in timestamp order and add the minimum `app_config` schema/grants used by the capability. Run:

```bash
node scripts/scoring/setup-local-db.mjs
SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state
```

Expected: all tests pass with capability off by default, enabled only for the selected owner/admin, and no public/anon command access.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/20260916120000_canonical_score_commands.sql scripts/scoring/setup-local-db.mjs src/lib/scoring
git commit -m "Add canonical score command kernel"
```

### Task 2: Outcome, first-server, server-anchor and game-boundary commands

**Files:**
- Modify: `supabase/migrations/20260916120000_canonical_score_commands.sql`
- Modify: `src/lib/scoring/database.test.ts`
- Modify: `src/lib/scoring/commands.ts`
- Modify: `src/lib/scoring/commands.test.ts`

**Interfaces:**
- Consumes: Task 1 command context and snapshot.
- Produces: `set_point_outcome_v2`, `set_first_server_v2`, `set_server_override_v2`, `set_game_boundary_v2` returning `CanonicalCommandResult` JSON.

- [x] **Step 1: Write RED real-database cases**

For every command assert: successful mutation and snapshot, coach/stranger rejection, stale revision with no write, duplicate request returning byte-equivalent JSON, reused request mismatch rejection, and projection failure rolling back the owner write.

Specific cases:

```text
set_point_outcome_v2: user | opponent | skip(let/misrecorded/other) | clear
set_first_server_v2: user | opponent | clear, always stamps first_server_source=user when set
set_server_override_v2: set/clear and clears later anchors exactly like existing set_server_override
set_game_boundary_v2: end/continue/clear plus named incomplete-game winner; clearing/reopening clears stale game_winner_override
```

- [x] **Step 2: Run RED**

Run: `SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state`

Expected: FAIL because the four public commands are absent.

- [x] **Step 3: Implement minimal commands**

Each SECURITY DEFINER function validates narrow enum inputs, performs one coupled write, explicitly calls `refresh_match_score_state`, inserts one `match_score_mutations` row with `base_revision`, `result_revision`, before/after fields and the returned response, and returns that response. Grant execution only to `authenticated`; revoke from `public` and `anon`.

- [x] **Step 4: Run GREEN and migration postcondition checks**

Run the real database suite twice without rebuilding the container between runs to prove request idempotency survives process boundaries.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/20260916120000_canonical_score_commands.sql src/lib/scoring
git commit -m "Add atomic score and serve commands"
```

### Task 3: Visibility and structural mutation commands

**Files:**
- Modify: `supabase/migrations/20260916120000_canonical_score_commands.sql`
- Modify: `src/lib/scoring/database.test.ts`
- Modify: `src/lib/scoring/commands.ts`
- Modify: `src/lib/scoring/commands.test.ts`

**Interfaces:**
- Consumes: Task 1 context; established `split_point`, `unsplit_point`, `merge_points`, `adjust_point`, `insert_point`, active-version guards and reclip triggers.
- Produces: `set_point_visibility_v2`, `split_point_v2`, `unsplit_point_v2`, `merge_points_v2`, `adjust_point_v2`, `insert_point_v2`.

- [x] **Step 1: Write RED structural cases**

Assert exact rows and projection after:

```text
soft delete/restore scored, skipped, boundary and server-anchor points
split one point and two sequential markers, then unsplit tail-first
merge two and three points, including conflicting outcomes
adjust start, end and both, including timing revision and observation invalidation
insert before first, between, after last and overlapping neighbours
stale/duplicate/unauthorized calls for every public command
```

- [x] **Step 2: Run RED**

Run: `SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state`

Expected: FAIL on missing v2 structural functions.

- [x] **Step 3: Implement transaction-scoped wrappers**

The v2 functions acquire the match lock before invoking the established structural function, collect affected rows, refresh once at the final revision, and write one mutation ledger entry. A mid-plan split failure raises and rolls back all splits in that command. `set_point_visibility_v2` preserves high-authority observations and invalidates only observations whose timing revision no longer matches.

- [x] **Step 4: Run GREEN plus established structural suites**

Run:

```bash
SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state
npm run test:match-structure
```

Record the existing unrelated Highlights source-inspection assertion separately if it remains the only failure.

Verification on 2026-09-16: the real PostgreSQL scoring suite passed 55/55
twice. `test:match-structure` passed all score, serve, game, split, insert,
playhead, side-change and clip-edit cases; its sole failure remained the
pre-existing Highlights source assertion for `min-h-11 w-full`, also present
on the baseline branch.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/20260916120000_canonical_score_commands.sql src/lib/scoring
git commit -m "Add revisioned structural score commands"
```

### Task 4: Web command transport and compatibility switch

**Files:**
- Create: `src/lib/scoring/client.ts`
- Create: `src/lib/scoring/client.test.ts`
- Modify: `src/app/match/[id]/page.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/scorerState.ts`
- Modify: `src/app/match/[id]/scorerIntegration.test.ts`

**Interfaces:**
- Consumes: Task 1 capability and `CanonicalCommandResult`.
- Produces: `CanonicalScoreCommandClient`, match-page `canonicalCommandsEnabled`, command result reconciliation and measured legacy fallback.

- [x] **Step 1: Write RED transport tests**

Tests prove: one stable request UUID is reused across a network retry; conflict replaces only score-derived optimistic state; `not_enabled` uses the established direct write; authorization/validation errors do not fall back; and a successful canonical snapshot is compared with the legacy local fold without changing rendering.

- [x] **Step 2: Run RED**

Run: `node --test --experimental-strip-types src/lib/scoring/client.test.ts 'src/app/match/[[]id[]]/scorerIntegration.test.ts'`

- [x] **Step 3: Implement transport and server capability load**

`page.tsx` calls `canonical_score_commands_enabled`; `client.ts` owns UUID creation/retry/parser behavior. `MatchView` receives the boolean and preserves all existing rendering. Parity comparison emits only a sanitized development/admin diagnostic; it never logs player names, notes or video URLs.

- [x] **Step 4: Run GREEN and full scorer tests**

Run: `npm run test:scorer`

Verification on 2026-09-16: the focused transport/integration suite passed
30/30, the established scorer suite passed 43/43, and the full production
`npm run build` completed. The build reported only established repository
warnings plus the pre-existing unused `SideChangeMarker` warning in
`MatchView`; the command transport introduced no build errors.

- [x] **Step 5: Commit**

```bash
git add src/lib/scoring/client.ts src/lib/scoring/client.test.ts 'src/app/match/[id]'
git commit -m "Add web canonical score command transport"
```

### Task 5: Migrate web owner mutations behind the capability

**Files:**
- Modify: `src/app/match/[id]/PointScorecard.tsx`
- Modify: `src/app/match/[id]/ServerChipMenu.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/Player.tsx`
- Modify: `src/app/match/[id]/PointDetail.tsx`
- Modify: `src/app/match/[id]/modifyOps.ts`
- Modify: matching tests under `src/app/match/[id]`

**Interfaces:**
- Consumes: Task 4 transport and existing direct-write callbacks.
- Produces: capability-gated web outcome, first-server, server override, boundary, delete/restore, Split/Unsplit/Join/Adjust/Insert calls.

- [x] **Step 1: Add failing integration cases for every mutation path**

Use the existing scorer harness to prove v2 success, stale conflict, duplicate retry, mid-command error, Undo and capability-off legacy behavior. Preserve loss reasons, notes, tags, clips, strictness, reclip requests and optimistic rollback exactly as today.

- [x] **Step 2: Run RED**

Run: `npm run test:scorer && npm run test:match-structure`

- [x] **Step 3: Route score-affecting writes through the transport**

Non-score metadata (`starred`, loss reasons, serve details, placement flag, notes, tags, side-change dismissal) remains on its current path because it does not increment canonical score revision. Do not alter layout or copy.

- [x] **Step 4: Run GREEN and production build**

Run:

```bash
npm run test:scorer
npm run test:match-structure
npm run test:scorecard
npm run build
```

Verification on 2026-09-16: the canonical PostgreSQL suite passed 66/66,
the scorer suite passed 43/43, the scorecard suite passed 15/15, focused
web transport and structural mutation tests passed 12/12, targeted lint
reported no errors, and the full production build completed. The broader
match-structure suite passed 140/141; its only failure is the established
unrelated Highlights source assertion for `min-h-11 w-full`, also recorded
before this task.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/match/[id]' src/lib/scoring
git commit -m "Route web scoring through canonical commands"
```

### Task 6: Native command transport and mutation migration

**Files:**
- Create: `ios/PongLens/PongLens/Core/CanonicalScoreCommands.swift`
- Create: `ios/Tests/CanonicalScoreCommandsTests.swift`
- Modify: `ios/PongLens/PongLens/Core/Models.swift`
- Modify: `ios/PongLens/PongLens/Core/PointActions.swift`
- Modify: `ios/PongLens/PongLens/Core/PointExtras.swift`
- Modify: `ios/PongLens/PongLens/Screens/MatchDetailScreen.swift`
- Modify: `ios/PongLens/PongLens/Screens/PlayerTakeoverScore.swift`
- Modify: `ios/Tests/main.swift`
- Modify: `ios/Tests/run.sh`

**Interfaces:**
- Consumes: the same capability and JSON command contract as web.
- Produces: `CanonicalScoreCommandTransport`, retry-stable request IDs, conflict reconciliation and capability-off legacy behavior.

- [ ] **Step 1: Write RED Swift parity and transport cases**

Add decoder fixtures identical to TypeScript, then exercise score, Undo, first server, boundary, Split/Unsplit/Join/Adjust/Insert, deletion/restoration, retry and conflict behavior against the loopback transport.

- [ ] **Step 2: Run RED**

Run: `bash ios/Tests/run.sh`

- [ ] **Step 3: Implement transport and route score-affecting writes**

Keep the established optimistic UI and restore it on command failure. Metadata-only patches remain direct. Capability is loaded once with the match and safely defaults off for an older backend.

- [ ] **Step 4: Run GREEN and simulator acceptance**

Run `bash ios/Tests/run.sh`, then verify native score, Undo, first server, boundary, Split/Join/Adjust/Insert and coach read-only state in the simulator. No visual change is intended; screenshots document unchanged states rather than request a redesign.

- [ ] **Step 5: Commit**

```bash
git add ios/PongLens ios/Tests
git commit -m "Route iOS scoring through canonical commands"
```

### Task 7: Atomic manual-cutter publication

**Files:**
- Modify: `supabase/migrations/20260916120000_canonical_score_commands.sql`
- Modify: `src/lib/scoring/database.test.ts`
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_hand_cut.py`
- Create: `worker/tests/test_canonical_publication.py`

**Interfaces:**
- Consumes: frozen `hand_cut_drafts`, worker-created active-version points, `normalize_manual_cut_observations`.
- Produces: private `publish_hand_cut_v2(match_id,job_id) returns jsonb` and worker publication receipt.

- [ ] **Step 1: Write RED database and worker tests**

Cover cut-only, cut-and-score, 30/60fps metadata, duplicate delivery, one missing clip/reclip request, count/timing disagreement, obsolete processing version and forced projection failure. The failure cases must leave the draft frozen/recoverable and publish no partial ready/projection state.

- [ ] **Step 2: Run RED**

Run the scoring database suite and focused worker hand-cut tests.

- [ ] **Step 3: Implement the finalizer and worker call**

After all point rows/outcomes exist inside the worker transaction, `publish_hand_cut_v2` validates job/version/draft ownership, normalizes observations, refreshes one canonical snapshot and returns a receipt. The worker marks ready only after the receipt succeeds. Grant execution to `ponglens_worker` only when that role exists; postgres retains owner execution.

- [ ] **Step 4: Run GREEN**

Run focused tests plus `python3 -m unittest discover -s worker/tests -p 'test_hand_cut.py'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260916120000_canonical_score_commands.sql src/lib/scoring worker
git commit -m "Publish manual cuts with canonical ground truth"
```

### Task 8: Automatic worker publication receipt and old-package compatibility

**Files:**
- Modify: `supabase/migrations/20260916120000_canonical_score_commands.sql`
- Modify: `src/lib/scoring/database.test.ts`
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_points_pipeline.py`
- Modify: `worker/tests/test_canonical_publication.py`
- Modify: worker release manifest/package metadata used by the current production package flow.

**Interfaces:**
- Consumes: automatic `insert_points` transaction and active processing version.
- Produces: private `finalize_worker_points_v2(match_id,processing_version_id)`, one projection receipt and a declared minimum migration version.

- [ ] **Step 1: Write RED worker publication cases**

Prove one finalization after a 100-point batch, obsolete-version rejection, owner first-server/outcome preservation on reprocess, old worker row-by-row publication against additive triggers, new worker against the migration floor, and rollback to the old package.

- [ ] **Step 2: Run RED**

Run focused worker tests; expected failure is the absent finalizer/receipt.

- [ ] **Step 3: Implement finalization**

The worker inserts evidence and points as today, calls the finalizer before ready status, and records the migration/contract version in its release manifest. The database finalizer never promotes `points.server` or detected first server to owner truth.

- [ ] **Step 4: Run GREEN and package parity tests**

Run both Mac and remote worker package tests and compare manifest source revision/migration floor.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260916120000_canonical_score_commands.sql src/lib/scoring worker
git commit -m "Finalize worker points into canonical score state"
```

### Task 9: Admin diagnostics, parity telemetry and rollback control

**Files:**
- Modify: `supabase/migrations/20260916120000_canonical_score_commands.sql`
- Modify: `src/app/admin/uploads/[matchId]/page.tsx`
- Modify: `src/app/admin/uploads/[matchId]/UploadView.tsx`
- Modify: `src/app/admin/uploads/uploadView.ts`
- Modify: `src/app/admin/uploads/uploadView.test.ts`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Create: `docs/releases/2026-09-16-canonical-score-commands.md`

**Interfaces:**
- Consumes: projection health, command mutation ledger and sanitized parity counts.
- Produces: an admin-only compact diagnostic line, rollout instructions, exact disable command and release handoff.

- [ ] **Step 1: Name and inspect the shipped Upload Detail diagnostics card**

Use its existing diagnostics row as the visual reference; do not add a new nested panel. Read its rendered desktop/mobile state before editing.

- [ ] **Step 2: Write RED admin/RLS tests**

Assert the admin RPC exposes only revision/status/counts/last sanitized code, owner/coach/anon cannot call it, and no timing reaction metadata or mutation before/after payload is returned.

- [ ] **Step 3: Implement the compact diagnostic**

Show `Score projection: current revision N`, or a calm stale/error equivalent, inside the existing diagnostics card. This is admin-only and has no customer copy.

- [ ] **Step 4: Render and verify UI**

Verify desktop and 393×660 mobile screenshots. Show screenshots to Adil before publishing this UI. Run admin tests and `npm run build`.

- [ ] **Step 5: Document rollback**

The release note must include:

```sql
update public.app_config set value='off' where key='canonical_score_commands';
```

and state that this returns new clients to legacy writes while leaving additive projection data intact.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260916120000_canonical_score_commands.sql src/app/admin CLAUDE.md AGENTS.md docs/releases
git commit -m "Add canonical score rollout diagnostics"
```

### Task 10: Full verification and production canary

**Files:**
- Modify: `docs/releases/2026-09-16-canonical-score-commands.md`
- Modify: design implementation-status block.

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: verified release candidate, production canary evidence and a phase-three reader-migration input.

- [ ] **Step 1: Run the full automated matrix**

```bash
SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state
npm run test:scorer
npm run test:match-structure
npm run test:scorecard
npm run test:stats
npm run test:placement
npm run test:lesson-video
npm run test:costs
npm run build
bash ios/Tests/run.sh
python3 -m unittest discover -s worker/tests
git diff --check
```

- [ ] **Step 2: Verify production-like database migration**

Apply both migrations to a fresh PostgreSQL container populated with representative legacy rows. Measure backfill and command p95, verify owner/coach/admin/anon/worker grants, and verify rollback leaves old readers/writers intact.

- [ ] **Step 3: Production deployment checkpoint**

Publish web/backend with `canonical_score_commands=off`. Verify projection health first. Enable only `user:<Adil UUID>` for the production canary; do not enable globally.

- [ ] **Step 4: Production canary acceptance**

On Adil’s account verify web desktop/mobile and native iOS: score, Undo, first server, boundary, Split/Unsplit/Join/Adjust/Insert, delete/restore and manual cutter. Compare returned snapshots to legacy folds and require zero unexplained differences.

- [ ] **Step 5: Worker package and rollback drill**

Install the reconciled package only while no match is actively publishing, verify release acceptance/heartbeats, process one automatic and one hand-cut match, then demonstrate the documented previous-package rollback without deleting projection data.

- [ ] **Step 6: Record evidence and proceed to phase three**

Update the spec to “phase two canary verified” only with exact build/package/migration identifiers. Create the phase-three reader-migration plan from measured parity evidence; do not switch owner readers as part of this phase-two commit.

## Phase-two exit gate

- Every owner score/structure mutation has a typed v2 command and preserves current coupled behavior.
- Duplicate, stale, unauthorized and partial-failure behavior is proven in real PostgreSQL.
- Supported web and iOS builds use v2 commands only when capability-enabled and safely retain legacy writes otherwise.
- Manual and automatic worker publication retain canonical state in one transaction/finalization boundary.
- Old clients and old worker packages remain functional.
- Production canary has zero unexplained projection differences.
- Rollback has been exercised, not merely documented.
- Existing readers still render legacy calculations until the separately planned phase-three migration.
