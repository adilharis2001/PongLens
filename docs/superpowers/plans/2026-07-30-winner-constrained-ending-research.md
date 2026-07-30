# Winner-Constrained Point-Ending Research Implementation Plan

> **Execution:** Implement task by task with `superpowers:executing-plans`,
> test-driven development, and verification before completion.

**Goal:** Host a blinded, authenticated 97-point cross-match experiment that
measures whether confirmed-winner constraints and serve-onset boundaries
improve point-ending reconstruction.

**Architecture:** A pure worker analyzer fuses winner constraints, BlurBall
trajectory geometry, placement candidates, audio events, and optional
serve-onset boundaries. A resumable administrative builder reuses the sealed
serve-research cohort, freezes two hidden predictions per point into protected
gold records, copies private media to a new immutable namespace, and seeds the
existing research tables. A new Next.js research route renders only known
scoring context and autosaves a compact blinded human label.

**Tech stack:** Python 3 and `unittest`; Next.js 15 App Router; React 19;
TypeScript and Node test runner; Supabase/Postgres RLS; private Cloudflare R2;
Vercel.

## Global constraints

- Route: `/research/winner-constrained-endings`.
- Batch: `winner-constrained-endings-cross-match-v1`.
- Cohort: exactly 97 non-let points with confirmed winners from the existing
  100-source serve-detection batch.
- Expected match counts: Chris 20, Gui 20, Vaibhav 20, Faye 19, Patrick 18.
- Production match, point, scoring, clip, placement, and serve research rows
  are immutable inputs.
- Browser-facing source data contains no automatic ending prediction or
  production UUID.
- Automatic results live only in protected gold/export data.
- Media uses only the private versioned
  `research/winner-constrained-endings` namespace.
- Missing high-confidence serve onset means the boundary variant is
  unavailable, not silently copied.

---

### Task 1: Winner-constrained ending label contract

**Files:**

- Create: `src/lib/research/winnerConstrainedEnding.ts`
- Create: `src/lib/research/winnerConstrainedEnding.test.ts`

- [ ] Write failing tests for blank hydration, each ending family, required
  confidence, non-negative contact counts, conditional net behavior, clearing
  stale net fields, and complete/invalid answers.
- [ ] Run the focused Node test and confirm RED because the module is absent.
- [ ] Implement the versioned human-label types and pure
  create/hydrate/update/validate helpers.
- [ ] Run the focused test and `npm run test:research`; confirm GREEN.

### Task 2: Browser-safe view contracts

**Files:**

- Create:
  `src/app/research/winner-constrained-endings/types.ts`
- Create:
  `src/app/research/winner-constrained-endings/winnerConstrainedEndingView.ts`
- Create:
  `src/app/research/winner-constrained-endings/winnerConstrainedEndingView.test.ts`

- [ ] Write failing tests proving the view exposes known server/winner and
  detector-boundary availability while recursively rejecting prediction,
  evidence, alternative, and confidence keys.
- [ ] Implement strict versioned source/assignment parsing and display-copy
  helpers that name the confirmed loser for net/long/wide explanations.
- [ ] Verify the view tests and full research tests pass.

### Task 3: Terminal geometry and winner constraint

**Files:**

- Create: `worker/winner_constrained_endings.py`
- Create: `worker/tests/test_winner_constrained_endings.py`

- [ ] Write failing literal-trajectory tests for ball dying at the net,
  reversing after the net plane, lateral net deflection, net clip and
  continuation, long miss, wide miss, clear unreturned winner, attempted
  missed return, and insufficient-evidence abstention.
- [ ] Write invariants proving terminal errors are assigned only to the
  confirmed loser and winner outcomes only to the confirmed winner.
- [ ] Write a serve-boundary test proving pre-serve ball bouncing does not add
  racket contacts when an onset is supplied.
- [ ] Implement compact track/contact feature extraction, net geometry,
  candidate ranking, winner filtering, and serializable evidence.
- [ ] Verify focused and all worker tests pass.

### Task 4: Reproducible 97-point batch builder

**Files:**

- Create: `worker/build_winner_constrained_ending_research.py`
- Create:
  `worker/tests/test_build_winner_constrained_ending_research.py`

- [ ] Write failing tests for cohort filtering, exact per-match counts, stable
  UUIDs, private proposal withholding, gold prediction variants, unavailable
  boundary handling, clip-relative placement alignment, and manifest hash
  validation.
- [ ] Implement pure cohort/manifest functions by reusing
  `point_contexts` from the serve builder.
- [ ] Implement resumable BlurBall and audio extraction with explicit version
  and configuration hashes.
- [ ] Implement `build-manifest`, `apply-migration`, `seed`, and `audit`
  commands with inactive-until-complete publication.
- [ ] Verify focused and all worker tests pass.

### Task 5: Private media namespace migration

**Files:**

- Create:
  `supabase/migrations/057_winner_constrained_ending_research.sql`
- Modify: `src/lib/research/labeling.ts`
- Modify: `src/lib/research/labeling.test.ts`
- Modify: `src/lib/research/migration.test.ts`

- [ ] Add failing tests for the exact versioned UUID MP4 namespace and for
  rejecting malformed paths and broader research wildcards.
- [ ] Add the namespace to the TypeScript allowlist and replace the Postgres
  check constraint with the four explicit allowed namespaces.
- [ ] Run `npm run test:research` and confirm GREEN.

### Task 6: Blinded hosted research route

**Files:**

- Create:
  `src/app/research/winner-constrained-endings/page.tsx`
- Create:
  `src/app/research/winner-constrained-endings/WinnerConstrainedEndingLabeler.tsx`
- Create:
  `src/app/research/winner-constrained-endings/labeler.module.css`
- Modify: `src/app/research/page.tsx`

- [ ] Add failing source-level assertions for exact batch filtering,
  authentication, noindex metadata, protected media route use, autosave, and
  absence of automatic prediction rendering.
- [ ] Implement the server route using the existing RLS-scoped assignment
  query and batch slug.
- [ ] Implement a one-video-at-a-time reviewer with plain-language definitions,
  known server/winner cards, required and conditional labels, filters,
  previous/next, visible save state, debounced autosave, immediate submit, and
  reload restoration.
- [ ] Add the experiment to the authenticated research index without exposing
  it to normal match pages.
- [ ] Verify tests, lint, and production build.

### Task 7: Export analysis

**Files:**

- Create: `worker/analyze_winner_constrained_ending_export.py`
- Create:
  `worker/tests/test_analyze_winner_constrained_ending_export.py`

- [ ] Write failing tests for coverage, exact ending accuracy, confusion
  matrix, net precision/recall/F1, contact exact/MAE, abstentions, and paired
  serve-boundary comparison.
- [ ] Implement analysis over the existing administrative batch export JSON.
- [ ] Verify focused and full worker tests.

### Task 8: Build, seed, deploy, and audit

**Private artifacts (never committed):**

- Manifest and analysis cache under a new `mktemp -d` directory.
- 97 copied source clips in private R2.

- [ ] Run the full Node and Python suites, lint, and production build.
- [ ] Build the sealed 97-point manifest with resumable inference; verify
  expected match counts, unique source identities, media hashes, and hidden
  prediction variants.
- [ ] Apply migration 057 using the existing production migration workflow.
- [ ] Seed the inactive batch, verify source/gold/assignment/object counts and
  hashes, then activate it.
- [ ] Commit the implementation in coherent checkpoints and inspect the final
  diff for secrets, UUID leakage, and unrelated changes.
- [ ] Integrate the verified branch through the repository's normal production
  workflow and confirm the Vercel deployment succeeds.
- [ ] Browser-smoke-test the live route, one-video mounting, autosave restore,
  submit/navigation, filters, assignment isolation, and administrative export.
- [ ] Run the production builder `audit` command and report the batch URL,
  exact cohort, inference availability, tests, deployment, and any model
  abstentions.
