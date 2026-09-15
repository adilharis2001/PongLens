# Canonical Scored-Match Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the versioned canonical score/game/server projection, source-clock observation storage, real parity tests, and shadow refresh plumbing without changing any current UI or production reader.

**Architecture:** A pure TypeScript projector defines the expected behavior from raw match/point inputs. A private PostgreSQL projector persists the same result under one match revision; triggers shadow-refresh it after existing writes, while all existing readers and writers continue unchanged. Manual-cutter boundaries are normalized as source-clock human observations with explicit provenance.

**Tech Stack:** TypeScript with `node:test`, PostgreSQL/Supabase migrations and RLS, Swift fixture parity in a later plan, Python worker integration in the structural/manual-cutter plan.

**Spec:** `docs/superpowers/specs/2026-09-15-canonical-scored-match-state-design.md`

## Global Constraints

- This phase is additive: no current web, iOS, worker, coach, share, statistic, placement, highlight or export reader switches to the projection.
- Owner score, worker evidence, manual-cutter boundaries and admin research labels remain separate authorities.
- `points.server` remains raw worker-frame evidence and is never rewritten or treated as owner-confirmed server.
- Manual-cutter `t0` and `t1` are retained as source-clock human ground truth with `manual_cutter` provenance.
- Detected side changes remain suggestions and never change the canonical owner score.
- Existing client writes must continue working while the projection is shadow-only.
- New tables are private by default; anon receives no table or function access.
- No user-visible UI or copy changes are permitted in this phase.
- All implementation follows strict red-green-refactor TDD.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/scoring/canonical.ts` | Pure runtime-independent projector and exported input/output contracts. |
| `src/lib/scoring/canonical.test.ts` | Literal behavior tests for score, game, server, timeline and authority rules. |
| `src/lib/scoring/fixtures/canonical-score-cases.json` | Shared hand-checked cases later consumed by Swift and SQL parity tests. |
| `src/lib/scoring/migration.test.ts` | Static safety contract for schema, grants, triggers and research isolation. |
| `src/lib/scoring/database.test.ts` | Opt-in real PostgreSQL behavior/RLS/parity tests; never connects to production. |
| `scripts/scoring/setup-local-db.mjs` | Creates the isolated Docker PostgreSQL test database and installs the minimum current schema plus new migration. |
| `supabase/migrations/20260915190000_canonical_scored_match_state.sql` | Private tables, revisions, projector, shadow refresh, archive and manual-cutter observation normalization. |
| `package.json` | Adds focused `test:scoring-state` script. |

## Task 1: Pure canonical projector

**Files:**
- Create: `src/lib/scoring/canonical.ts`
- Create: `src/lib/scoring/canonical.test.ts`
- Create: `src/lib/scoring/fixtures/canonical-score-cases.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: raw `CanonicalMatchInput` and `CanonicalPointInput[]` in uploader-logical coordinates.
- Produces: `projectCanonicalScore(input): CanonicalProjection`, `orderCanonicalPoints(points): CanonicalPointInput[]`, and JSON-serializable `CanonicalPointState` / `CanonicalMatchState`.

- [ ] **Step 1: Write the first failing projection test**

```ts
test("two-serve blocks and an automatic 11-0 game produce one canonical snapshot", () => {
  const projection = projectCanonicalScore({
    firstServer: "user",
    firstServerSource: "user",
    points: Array.from({ length: 12 }, (_, i) => point(i + 1, {
      t0: i * 10,
      winner: i < 11 ? "user" : null,
    })),
  });
  assert.deepEqual(projection.points.slice(0, 6).map((p) => p.resolvedServer),
    ["user", "user", "opponent", "opponent", "user", "user"]);
  assert.equal(projection.points[10].endsGame, true);
  assert.equal(projection.points[11].gameNumber, 2);
  assert.equal(projection.match.gamesUser, 1);
});
```

- [ ] **Step 2: Run RED and confirm the module is missing**

Run: `node --test --experimental-strip-types src/lib/scoring/canonical.test.ts`

Expected: FAIL because `canonical.ts` / `projectCanonicalScore` does not exist.

- [ ] **Step 3: Implement the minimum score/boundary/server fold**

```ts
export function projectCanonicalScore(input: CanonicalMatchInput): CanonicalProjection {
  const ordered = orderCanonicalPoints(input.points.filter((point) => !point.deleted));
  // One pass owns score, boundary and serve state. It emits immutable rows
  // after each point and a bounded match summary.
}
```

The implementation must encode spec §6 literally: 11 clear by two, positional `end`/`continue`, named game winner, two-serve blocks, one-serve deuce, skipped points consume neither score nor serve, unscored non-skipped points consume serve, and contradictory server overrides restart the block and parity.

- [ ] **Step 4: Run GREEN**

Run: `node --test --experimental-strip-types src/lib/scoring/canonical.test.ts`

Expected: PASS.

- [ ] **Step 5: Add one failing literal case at a time**

| Test name | Literal expectation |
| --- | --- |
| `let repeats the same server and contributes no score` | Servers `[user,user]`; before/after score remains `0-0` on the let. |
| `unscored visible card consumes a serve position without changing score` | Three cards from user produce servers `[user,user,opponent]`; all scores stay `0-0`. |
| `deuce alternates every point` | From a literal 10-10 prefix, the next four servers alternate `[user,opponent,user,opponent]`. |
| `positional end on an unscored card starts the next game` | Closing card has `endsGame=true`; next card has `gameNumber=2` and score before `0-0`. |
| `continue suppresses automatic endings until explicit end` | An 11-0 card with `continue` does not end; later `end` does. |
| `named winner resolves an incomplete manually closed game` | A pinned 3-2 game with `gameWinnerOverride=opponent` increments `gamesOpponent`. |
| `agreeing server override preserves phase` | The downstream sequence is unchanged from the no-override fixture. |
| `contradicting server override restarts the block and downstream parity` | Override point and following point share the corrected server; next game alternates from corrected parity. |
| `detected first server does not become owner-confirmed server` | Every `resolvedServer` is null when source is `detected`. |
| `split child sorts by source time despite high idx` | IDs order as parent, child, next for `t0` values 10, 15, 20 despite child `idx=99`. |
| `one missing t0 makes the whole legacy match fall back to idx order` | IDs order strictly by `idx` for the whole match. |
| `deleted point is absent and later display numbers are contiguous` | Deleted ID is absent; remaining display numbers are `[1,2]`. |

For each case: write the complete test with these hand-derived values, run RED, implement only that behavior, then run GREEN.

- [ ] **Step 6: Extract the hand-checked fixture**

Store inputs and literal expected projections in `canonical-score-cases.json`. The test reads the JSON and asserts exact equality; expected values must not be produced by the projector under test.

- [ ] **Step 7: Add the focused script and run the existing suite**

```json
"test:scoring-state": "node --test --experimental-strip-types src/lib/scoring/*.test.ts"
```

Run:

```bash
npm run test:scoring-state
node --test --experimental-strip-types 'src/app/match/[[]id[]]/gameScore.test.ts' 'src/app/match/[[]id[]]/serving.test.ts'
```

Expected: all new and existing score/serve tests pass.

- [ ] **Step 8: Commit**

```bash
git add package.json src/lib/scoring
git commit -m "Add canonical scored match projector"
```

## Task 2: Private schema and projector migration

**Files:**
- Create: `supabase/migrations/20260915190000_canonical_scored_match_state.sql`
- Create: `src/lib/scoring/migration.test.ts`

**Interfaces:**
- Consumes: current `matches` and `points` owner-input columns.
- Produces: private `point_score_state`, `match_score_state`, `point_timing_observations`, `match_score_mutations`; match revisions/health; internal `refresh_match_score_state(uuid)`.

- [ ] **Step 1: Write RED migration safety tests**

```ts
test("projection and observation tables are private and RLS protected", () => {
  for (const table of ["point_score_state", "match_score_state", "point_timing_observations", "match_score_mutations"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon`));
  }
});

test("admin research writes cannot refresh owner score", () => {
  assert.doesNotMatch(sql, /(?:trigger|update)[\s\S]{0,120}fullmatch_labels[\s\S]{0,120}refresh_match_score_state/i);
});
```

Also assert function revokes, column constraints, manual-cutter origin, owner/coach scoped SELECT policies and no authenticated mutation grants.

- [ ] **Step 2: Run RED**

Run: `node --test --experimental-strip-types src/lib/scoring/migration.test.ts`

Expected: FAIL because the migration is missing.

- [ ] **Step 3: Add schema, constraints and grants**

The migration creates the exact spec §5 tables and comments. `match_score_state` and `point_score_state` allow owner/accepted-coach reads through `has_match_access`; mutation/observation/health details remain owner/admin or internal as specified. Revoke public/anon/authenticated writes and revoke public execution on internal functions.

- [ ] **Step 4: Run migration tests GREEN**

Run: `node --test --experimental-strip-types src/lib/scoring/migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Write RED SQL-projector contract tests in `database.test.ts`**

Use an opt-in `SCORING_STATE_LOCAL_DB_TEST=1` flag and real `psql` calls. Insert a match plus literal point rows, call `refresh_match_score_state`, then assert literal pipe-delimited output for point number, before/after score, game, boundary and server.

- [ ] **Step 6: Implement the PostgreSQL projector**

```sql
create or replace function public.refresh_match_score_state(p_match_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  -- Lock the match, fold active points once, replace the private snapshot,
  -- and expose the new projection revision only after all rows exist.
  return v_revision;
end;
$$;
```

The SQL fold must consume the same literal fixture semantics as Task 1, including whole-match `idx` fallback when any active `t0` is null.

- [ ] **Step 7: Add shadow refresh triggers**

Existing direct writes increment `score_revision` and call the projector only when these inputs change: point insert/delete; `deleted`, `t0`, `t1`, `confirmed_winner`, `confirmed_how`, `is_let`, `server_override`, `game_end_override`, `game_winner_override`; match `first_server`, `first_server_source`. Stars, notes, tags, placement, suggestions, clips and analysis fields do not increment it.

Catch shadow projection errors during this phase, mark status `error`, and preserve the legacy write. No reader consumes the result yet.

- [ ] **Step 8: Run real PostgreSQL tests GREEN**

Run:

```bash
node scripts/scoring/setup-local-db.mjs
SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state
```

Expected: SQL output exactly matches the literal fixture, RLS denies anon writes/reads as specified, and an invalid projector case leaves legacy score inputs committed with `score_projection_status = 'error'` only in shadow mode.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260915190000_canonical_scored_match_state.sql src/lib/scoring/migration.test.ts src/lib/scoring/database.test.ts scripts/scoring/setup-local-db.mjs
git commit -m "Add shadow canonical score projection"
```

## Task 3: Manual-cutter observation backfill contract

**Files:**
- Modify: `supabase/migrations/20260915190000_canonical_scored_match_state.sql`
- Modify: `src/lib/scoring/migration.test.ts`
- Modify: `src/lib/scoring/database.test.ts`

**Interfaces:**
- Consumes: submitted `hand_cut_drafts.marks`, published `points`, `matches.cut_source = 'manual'`.
- Produces: idempotent internal `normalize_manual_cut_observations(match_id uuid)` and source-time start/end observations.

- [ ] **Step 1: Write RED database cases**

Create one cut-only and one cut-and-score draft with marks containing `t0`, `t1`, `tap`, `rate`, `w`, `let`; insert matching published points; normalize twice. Assert exactly one active start and one active end per point, literal source seconds, `manual_cutter` origin, preserved reaction metadata, training eligibility and no write to `scored_at_cut_s`/`serve_start_at_cut_s`.

- [ ] **Step 2: Run RED**

Run: `SCORING_STATE_LOCAL_DB_TEST=1 npm run test:scoring-state`

Expected: FAIL because the normalizer is missing.

- [ ] **Step 3: Implement idempotent normalization**

Match draft marks to published points by the submitted time order used by `process_hand_cut`; refuse count/timing disagreement rather than guessing. Use a deterministic uniqueness key `(point_id, kind, origin, timing_revision)`.

- [ ] **Step 4: Run GREEN and verify research isolation**

Insert/update/delete `fullmatch_labels` in the local database and assert `matches.score_revision` and projection rows do not change.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915190000_canonical_scored_match_state.sql src/lib/scoring
git commit -m "Retain manual cut boundaries as ground truth"
```

## Task 4: Foundation documentation and verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-09-15-canonical-scored-match-state-design.md`
- Create: `src/lib/scoring/fixtures/README.md`

**Interfaces:**
- Consumes: final Task 1–3 names and verified behavior.
- Produces: durable handoff rules for Claude Code, Codex and future worker releases.

- [ ] **Step 1: Update canonical documentation**

Add/restore `CLAUDE.md` sections covering owner/admin/worker authority, production card reconstruction, manual-cutter source-clock truth, canonical ordering/revisions and fixture-first semantic changes. Keep `AGENTS.md` as a short pointer with a highlighted canonical-score entry rather than duplicating the algorithm.

- [ ] **Step 2: Document the fixture protocol**

The README names TypeScript as the fixture generator for migration only, SQL as committed-truth authority after rollout, and Swift/Python as parity consumers. It includes the exact commands from Tasks 1–3.

- [ ] **Step 3: Mark implementation status accurately**

Update the design document to say “foundation implemented; readers remain on legacy paths.” Do not mark the full design implemented.

- [ ] **Step 4: Run verification**

```bash
npm run test:scoring-state
node --test --experimental-strip-types 'src/app/match/[[]id[]]/gameScore.test.ts' 'src/app/match/[[]id[]]/serving.test.ts'
npm run build
git diff --check
```

Record the unrelated pre-existing Highlights source-inspection failure separately; do not claim the entire baseline suite passes unless it does.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md AGENTS.md docs/superpowers/specs/2026-09-15-canonical-scored-match-state-design.md src/lib/scoring/fixtures/README.md
git commit -m "Document canonical score state foundation"
```

## Foundation exit gate

- The pure TypeScript and real PostgreSQL projectors match the hand-checked fixture exactly.
- Shadow projection changes no existing reader or customer-visible behavior.
- Existing score/serve tests remain green.
- Manual-cutter starts and ends are retained as source-clock ground truth.
- `fullmatch_labels` cannot affect owner revisions or projection.
- New storage/functions pass owner, coach, admin, anon and worker-access tests.
- The real production build succeeds.
- No database migration is applied to production and no feature flag is enabled as part of this plan.
