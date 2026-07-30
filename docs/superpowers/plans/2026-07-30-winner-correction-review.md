# Winner Correction Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer confirm, correct, or mark uncertain the imported point winner without contaminating winner-constrained research metrics.

**Architecture:** Extend the existing JSON human-label contract with winner-review provenance alongside server review. Derive an effective scoring object from both corrections so every name and explanation uses the reviewed facts, while preserving the immutable proposal for audit. Treat any corrected or uncertain scoring fact as incompatible with predictions generated from the original scoring context.

**Tech Stack:** TypeScript, React 19, Next.js 15, Node test runner, Python `unittest`, Supabase JSONB autosave.

## Global Constraints

- Preserve the frozen research proposal and its imported winner.
- Do not mutate the production match or point score from the research labeler.
- Require an explicit winner review before submission.
- Clear only answers whose meaning changes when the winner changes.
- Keep automatic predictions hidden during labeling.
- Exclude corrected or uncertain scoring contexts from the original-prediction accuracy slice.

---

### Task 1: Winner review contract

**Files:**
- Modify: `src/lib/research/winnerConstrainedEnding.ts`
- Test: `src/lib/research/winnerConstrainedEnding.test.ts`

**Interfaces:**
- Consumes: existing `ScoredPlayer` and `WinnerConstrainedEndingHumanLabel`.
- Produces: `winner_review`, `corrected_winner`, `setWinnerReview(...)`, and `clearWinnerDependentAnswers(...)`.

- [ ] **Step 1: Write failing contract tests**

Add tests proving a blank label has no winner answer, a correction must name the other player, confirm/unsure clear stale corrections, and changing winner clears `ending_family`, `attempted_return`, `net_behavior`, `receiving_zone`, and `confidence` while retaining `contact_count`, `final_hitter`, and `notes`.

- [ ] **Step 2: Run the focused contract test**

Run:

```bash
node --test --experimental-strip-types src/lib/research/winnerConstrainedEnding.test.ts
```

Expected: FAIL because the winner-review API and fields do not exist.

- [ ] **Step 3: Implement the minimal contract**

Add:

```ts
winner_review: ServerReview | null;
corrected_winner: ScoredPlayer | null;

setWinnerReview(
  label,
  review,
  importedWinner,
  correctedWinner?,
): WinnerConstrainedEndingHumanLabel
```

Normalize stored JSON, validate correction consistency, require `winner_review` in submission validation, and clear winner-dependent answers only when the effective winner changes.

- [ ] **Step 4: Re-run the focused contract test**

Expected: all winner-constrained contract tests pass.

### Task 2: Effective scoring semantics and UI

**Files:**
- Modify: `src/app/research/winner-constrained-endings/winnerConstrainedEndingView.ts`
- Modify: `src/app/research/winner-constrained-endings/WinnerConstrainedEndingLabeler.tsx`
- Test: `src/app/research/winner-constrained-endings/winnerConstrainedEndingView.test.ts`
- Test: `src/lib/research/winnerConstrainedRoute.test.ts`

**Interfaces:**
- Consumes: reviewed server and winner fields from Task 1.
- Produces: `effectiveScoring(scoring, review)` with reviewed `server`, `winner`, and `loser`.

- [ ] **Step 1: Write failing semantic tests**

Add a hand-checked fixture where imported winner Adil is corrected to Patrick. Assert that effective scoring preserves the reviewed server, changes the winner to Patrick, changes the loser to Adil, and causes ending explanations to name those effective players.

- [ ] **Step 2: Run the focused view and route tests**

Run:

```bash
node --test --experimental-strip-types \
  src/app/research/winner-constrained-endings/winnerConstrainedEndingView.test.ts \
  src/lib/research/winnerConstrainedRoute.test.ts
```

Expected: FAIL because winner correction controls and effective scoring do not exist.

- [ ] **Step 3: Implement the reviewed scoring UI**

Replace “Confirmed winner” with “Imported winner.” Add:

- `Yes — Adil won`
- `No — Patrick won`
- `Can't tell`

Display “Corrected winner” plus “Imported record said Adil” after correction. Use effective scoring for all ending descriptions and losing-player questions. Autosave through the existing `human_label` update path.

- [ ] **Step 4: Re-run the focused view and route tests**

Expected: all focused tests pass.

### Task 3: Research export validity

**Files:**
- Modify: `worker/analyze_winner_constrained_ending_export.py`
- Test: `worker/tests/test_analyze_winner_constrained_ending_export.py`

**Interfaces:**
- Consumes: `winner_review` and `corrected_winner` from exported human labels.
- Produces: winner-review counts, correction rate, and scoring-compatible metrics requiring both imported server and imported winner to be confirmed.

- [ ] **Step 1: Write a failing export-analysis test**

Add submitted fixtures for correct, corrected, unsure, and unreviewed winners. Assert literal counts and assert only rows with `server_review == "correct"` and `winner_review == "correct"` enter `scoring_compatible`.

- [ ] **Step 2: Run the worker test**

Run:

```bash
python3 -m unittest worker.tests.test_analyze_winner_constrained_ending_export
```

Expected: FAIL because winner review is not summarized or filtered.

- [ ] **Step 3: Implement winner-aware analysis**

Add a winner-review summary parallel to server review and update the scoring-compatible predicate. Rename the exclusion counter to `excluded_wrong_or_uncertain_scoring_context`.

- [ ] **Step 4: Re-run the worker test**

Expected: all export-analysis tests pass.

### Task 4: Verification and deployment

**Files:**
- Verify: all files modified in Tasks 1–3.

**Interfaces:**
- Consumes: completed implementation.
- Produces: merged and deployed production behavior.

- [ ] **Step 1: Run focused regression tests**

```bash
node --test --experimental-strip-types \
  src/lib/research/winnerConstrainedEnding.test.ts \
  src/app/research/winner-constrained-endings/winnerConstrainedEndingView.test.ts \
  src/lib/research/winnerConstrainedRoute.test.ts
python3 -m unittest worker.tests.test_analyze_winner_constrained_ending_export
```

- [ ] **Step 2: Run the full research suite and production build**

```bash
npm run test:research
npm run build
```

- [ ] **Step 3: Commit and integrate**

Commit the isolated branch, merge it into the current local `main`, rerun Task 4 Steps 1–2 on the merged tree, and push `main`.

- [ ] **Step 4: Audit production**

Wait for the Vercel production deployment to reach `Ready`, verify `www.ponglens.com` resolves to that deployment, and confirm the protected research route still redirects unauthenticated requests to its login return path.
