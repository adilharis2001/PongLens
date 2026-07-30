# Terminal Ball Zone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal-ball placement question valid when the ball hit the net or went out.

**Architecture:** Extend the existing `receiving_zone` string union with one backward-compatible value, `not_applicable`. Revise only the labeler prompt and option copy; the current JSON autosave/export path requires no migration.

**Tech Stack:** TypeScript, React, Next.js, Node test runner

## Global Constraints

- Existing stored `forehand`, `backhand`, `middle`, and `unknown` labels must continue to hydrate.
- Do not infer `not_applicable` from the ending family.
- Do not change the human-label schema version or database schema.

---

### Task 1: Extend the receiving-zone contract

**Files:**
- Modify: `src/lib/research/winnerConstrainedEnding.ts`
- Test: `src/lib/research/winnerConstrainedEnding.test.ts`

**Interfaces:**
- Consumes: `hydrateWinnerConstrainedEndingLabel(stored: unknown)`
- Produces: `ReceivingZone` including `"not_applicable"`

- [ ] **Step 1: Write the failing test**

Add a test that hydrates a complete net-ending label with:

```ts
receiving_zone: "not_applicable"
```

Assert that the hydrated field is exactly `"not_applicable"` and that `validateWinnerConstrainedEndingLabel` returns `[]`.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
node --test --experimental-strip-types src/lib/research/winnerConstrainedEnding.test.ts
```

Expected: FAIL with `Unsupported receiving zone.`

- [ ] **Step 3: Implement the minimal contract change**

Add `"not_applicable"` to `RECEIVING_ZONES` before `"unknown"`.

- [ ] **Step 4: Run the focused test and verify green**

Run the same command and expect all tests to pass.

### Task 2: Revise the reviewer-facing question

**Files:**
- Modify: `src/app/research/winner-constrained-endings/WinnerConstrainedEndingLabeler.tsx`
- Test: `src/lib/research/winnerConstrainedRoute.test.ts`

**Interfaces:**
- Consumes: `RECEIVING_ZONES` and `ReceivingZone`
- Produces: one select option for every accepted receiving-zone value

- [ ] **Step 1: Write the failing UI contract check**

Assert the labeler contains:

```text
Where did the final ball go relative to the receiving player?
No receiving zone — hit the net or went out
Couldn’t tell
```

- [ ] **Step 2: Run the route test and verify red**

Run:

```bash
node --test --experimental-strip-types src/lib/research/winnerConstrainedRoute.test.ts
```

Expected: FAIL because the revised copy is absent.

- [ ] **Step 3: Implement the copy and option mapping**

Add:

```ts
not_applicable: "No receiving zone — hit the net or went out",
unknown: "Couldn’t tell",
```

Replace the old question with the approved wording.

- [ ] **Step 4: Run the focused tests and verify green**

Run both focused test files and expect zero failures.

### Task 3: Verify and release

**Files:**
- No additional source files

**Interfaces:**
- Consumes: completed Tasks 1–2
- Produces: deployable production build

- [ ] **Step 1: Run research tests**

```bash
npm run test:research
```

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-terminal-ball-zone-design.md docs/superpowers/plans/2026-07-30-terminal-ball-zone.md src/lib/research/winnerConstrainedEnding.ts src/lib/research/winnerConstrainedEnding.test.ts src/lib/research/winnerConstrainedRoute.test.ts src/app/research/winner-constrained-endings/WinnerConstrainedEndingLabeler.tsx
git commit -m "fix: make terminal ball zone inclusive"
```
