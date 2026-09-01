# Audio Impact Point-First Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make audio-impact review unambiguously point-first, split foot sounds into shoe, shoe squeak, and stomp classes, deploy the change, and reset only the 14 confused production labels.

**Architecture:** Keep the existing protected-media and durable-save infrastructure, but make navigation helpers enforce assignment boundaries and make the client render three explicit stages: point introduction, sound labeling, and point completion. Extend the shared label union, database trigger, and trainer class list together so the stored taxonomy is consistent end to end. Apply the production reset only after the application and migration are live.

**Tech Stack:** Next.js 15, React 19, TypeScript, Node test runner, Supabase/PostgreSQL, Python/NumPy/SciPy worker tests, Vercel.

**Spec:** `docs/plans/2026-09-01-audio-impact-point-first-labeling-design.md`

## Global Constraints

- The dominant hierarchy is `Point N of 30 → Sound M of K in this point`.
- A sound-label action never crosses into another assignment.
- The next point opens only after explicit point completion or deliberate queue navigation.
- `shoe`, `shoe_squeak`, and `stomp` are separate classes everywhere.
- Existing save-failure, media-playability, phase-lock, and sealed-round safeguards remain intact.
- Reset exactly the 14 labels and review state on the seven touched Round A assignments; preserve sources, proposals, media, ordering, and untouched rows.

---

### Task 1: Shared taxonomy and point-bounded navigation

**Files:**
- Modify: `src/lib/research/audioImpacts.test.ts`
- Modify: `src/lib/research/audioImpacts.ts`
- Modify: `src/app/research/audio-impacts/audioImpactView.test.ts`
- Modify: `src/app/research/audio-impacts/audioImpactView.ts`

**Interfaces:**
- Produces: `AudioImpactKind` with `shoe_squeak` and `stomp`.
- Produces: `nextReviewTargetInPoint(assignments, assignmentId, eventId): AudioImpactReviewTarget | null`.
- Produces: `pointReviewState(label): { answered: number; total: number; complete: boolean }` for UI stage rendering.

- [ ] **Step 1: Write failing taxonomy tests**

Update the shortcut test to assert the literal ordered classes and mappings:

```ts
assert.deepEqual(AUDIO_IMPACT_KINDS, [
  "paddle", "table", "floor", "shoe", "shoe_squeak", "stomp",
  "net", "background", "other", "no_impact", "unsure",
]);
assert.deepEqual(
  ["p", "T", "f", "H", "q", "S", "n", "B", "o", "X", "u"].map(audioImpactKindForShortcut),
  AUDIO_IMPACT_KINDS,
);
```

- [ ] **Step 2: Run the shared test and verify the literal mismatch failure**

Run: `node --test --experimental-strip-types src/lib/research/audioImpacts.test.ts`

Expected: FAIL because `shoe_squeak` and `stomp` are absent and `H`/`Q` are unmapped.

- [ ] **Step 3: Implement the taxonomy minimally**

Add the two classes to `AUDIO_IMPACT_KINDS` and use shortcuts `h: "shoe"`, `q: "shoe_squeak"`, and `s: "stomp"`.

- [ ] **Step 4: Run the shared test and verify it passes**

Run: `node --test --experimental-strip-types src/lib/research/audioImpacts.test.ts`

- [ ] **Step 5: Write failing point-boundary and review-state tests**

Replace the cross-point `nextReviewTarget` expectation with a boundary expectation and add literals:

```ts
assert.equal(nextReviewTargetInPoint(assignments, "one", "one-2"), null);
assert.deepEqual(pointReviewState(assignment("one", 1, ["paddle", null]).human_label!), {
  answered: 1,
  total: 2,
  complete: false,
});
```

- [ ] **Step 6: Run the view test and verify missing-export failures**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/audioImpactView.test.ts`

Expected: FAIL because `nextReviewTargetInPoint` and `pointReviewState` do not exist.

- [ ] **Step 7: Implement point-bounded helpers and verify both test files**

Filter ordered events by `assignment_id` inside `nextReviewTargetInPoint`; return only a later unanswered event from the same assignment. Count non-null event kinds in `pointReviewState`.

Run: `node --test --experimental-strip-types src/lib/research/audioImpacts.test.ts src/app/research/audio-impacts/audioImpactView.test.ts`

- [ ] **Step 8: Commit**

```bash
git add src/lib/research/audioImpacts.ts src/lib/research/audioImpacts.test.ts src/app/research/audio-impacts/audioImpactView.ts src/app/research/audio-impacts/audioImpactView.test.ts
git commit -m "feat: separate foot sounds and bound audio review by point"
```

### Task 2: Point-first reviewer stages

**Files:**
- Modify: `src/app/research/audio-impacts/audioImpactRoute.test.ts`
- Modify: `src/app/research/audio-impacts/AudioImpactLabeler.tsx`

**Interfaces:**
- Consumes: `nextReviewTargetInPoint` and `pointReviewState` from Task 1.
- Produces: point introduction, event step rail, and explicit completion-summary states in the existing reviewer component.

- [ ] **Step 1: Write failing UI contract tests**

Assert the reviewer source contains the user-visible hierarchy and distinct labels:

```ts
for (const text of [
  "Point", "Watch full point, then start labeling", "sounds in this point",
  "Label sound", "Shoe / footstep", "Shoe squeak", "Stomp",
  "Finish Point", "and open Point",
]) assert.match(labeler, new RegExp(text.replace("/", "\\/")));
assert.doesNotMatch(labeler, /Shoe \/ stomp/);
```

- [ ] **Step 2: Run the route test and verify copy/state failures**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/audioImpactRoute.test.ts`

Expected: FAIL on the missing point-first and distinct foot-sound copy.

- [ ] **Step 3: Implement introduction and hierarchy state**

Add `contextReadyAssignmentIds: Set<string>` state. On a newly opened assignment, render a context callout with `Point {queueIndex + 1} of {queue.length}`, match/venue/source point, number of marked sounds, and `Watch full point, then start labeling`. The action plays from time zero at 1x and marks the assignment ready; retain `Play full point context` afterward.

- [ ] **Step 4: Implement the sound step rail and point-bounded advance**

Render one numbered button per event with completed/current/unanswered styles and accessible labels. Change `finishSave` to call `nextReviewTargetInPoint`; when it returns null, remain in the assignment and show the completion summary instead of opening a new assignment.

- [ ] **Step 5: Implement summary and explicit next-point transition**

When every event has a kind, show a compact sound list with class titles and a `Finish Point N and open Point N+1` button. Keep completion disabled otherwise. `completePoint` submits and opens the first target in the next open assignment only after the save succeeds.

- [ ] **Step 6: Run focused tests and typecheck through build**

Run: `node --test --experimental-strip-types src/app/research/audio-impacts/audioImpactRoute.test.ts src/app/research/audio-impacts/audioImpactView.test.ts src/lib/research/audioImpacts.test.ts`

Run: `npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/app/research/audio-impacts/AudioImpactLabeler.tsx src/app/research/audio-impacts/audioImpactRoute.test.ts
git commit -m "feat: guide audio review point by point"
```

### Task 3: Database and trainer taxonomy

**Files:**
- Create: `supabase/migrations/153_audio_impact_foot_classes.sql`
- Modify: `src/lib/research/migration.test.ts`
- Modify: `worker/tests/test_train_audio_impacts.py`
- Modify: `worker/train_audio_impacts.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: exact string labels from Task 1.
- Produces: database validation and training/export support for all 10 trainable classes, excluding only `unsure`.

- [ ] **Step 1: Write failing migration and trainer tests**

Add the new migration to the migration test and assert the final trigger definition accepts the literal set including `shoe_squeak` and `stomp`. Update the trainer test to expect both in `AUDIO_IMPACT_CLASSES`.

- [ ] **Step 2: Run tests and verify taxonomy failures**

Run: `node --test --experimental-strip-types src/lib/research/migration.test.ts`

Run: `python -m unittest worker.tests.test_train_audio_impacts`

Expected: FAIL because the migration and trainer classes do not yet contain the new values.

- [ ] **Step 3: Add the forward-only migration**

Create migration 153 with `create or replace function public.validate_audio_impact_assignment()` preserving every guard from migration 152 and changing only the accepted event-kind list to include `shoe_squeak` and `stomp`.

- [ ] **Step 4: Extend trainer classes and operational docs**

Add `shoe_squeak` and `stomp` immediately after `shoe` in `AUDIO_IMPACT_CLASSES`. Update the research label list and shortcut explanation in `README.md`.

- [ ] **Step 5: Run migration, worker, and research tests**

Run: `node --test --experimental-strip-types src/lib/research/migration.test.ts`

Run: `python -m unittest worker.tests.test_train_audio_impacts worker.tests.test_build_audio_impact_research`

Run: `npm run test:research`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/153_audio_impact_foot_classes.sql src/lib/research/migration.test.ts worker/train_audio_impacts.py worker/tests/test_train_audio_impacts.py README.md
git commit -m "feat: persist distinct audio foot classes"
```

### Task 4: Production verification, migration, deployment, and exact reset

**Files:**
- No application files expected.

**Interfaces:**
- Consumes: the tested commits from Tasks 1–3.
- Produces: migrated production database, production Vercel release, and a clean Round A annotation state.

- [ ] **Step 1: Run the complete release matrix**

Run: `git diff --check`

Run: `npm run test:research`

Run: `python -m unittest worker.tests.test_train_audio_impacts worker.tests.test_build_audio_impact_research`

Run: `npm run lint`

Run: `npm run build`

- [ ] **Step 2: Review the final diff and request code review**

Inspect `git diff origin/main...HEAD`, confirm no unrelated files, and apply the requesting-code-review workflow before merging.

- [ ] **Step 3: Apply migration 153 and verify the function definition**

Use the established production database migration path. Query `pg_get_functiondef('public.validate_audio_impact_assignment()'::regprocedure)` and confirm both new class literals are present.

- [ ] **Step 4: Push the release to production main and deploy Vercel**

Push the tested commits, update production `main` without force, deploy with the existing Vercel production command, and verify the deployment reaches READY.

- [ ] **Step 5: Smoke test the live authenticated desktop page**

Verify the live page displays the point-first introduction, separate Shoe / footstep, Shoe squeak, and Stomp choices, and does not permit a label click to advance across point boundaries.

- [ ] **Step 6: Re-read and validate the destructive reset target**

Query batch `audio-impact-labeling-recent-v1` and assert exactly seven Round A assignments are touched and exactly 14 event kinds are non-null. Abort if either count differs.

- [ ] **Step 7: Reset the seven exact assignments transactionally**

For the resolved assignment IDs only, set `status = 'not_started'`, `human_label = NULL`, `review_metrics = NULL`, `started_at = NULL`, and `submitted_at = NULL`. Do not delete rows. Perform the update through an exact ID list in one database transaction.

- [ ] **Step 8: Verify the reset and production health**

Assert all 30 available Round A assignments are `not_started`, zero event kinds are stored, the study remains in `development_a`, 60 assignments still exist across A/C, and the live route still serves successfully for the authenticated reviewer.

- [ ] **Step 9: Report the irreversible operation clearly**

State that the 14 confused labels and review state were erased, assignments/media/proposals were preserved, and the erased annotation values are not recoverable through the application.
