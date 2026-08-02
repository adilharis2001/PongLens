# Serve Contact Ground Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 100-point temporal serve review from subjective onset grading to exact first serve paddle-contact labeling without losing the eight existing onset reviews.

**Architecture:** Add a version-2 contact-label contract in the existing result-view domain helpers. Hydrate version-1 records as unreviewed contact drafts containing a preserved legacy onset payload; the existing Supabase save path writes version 2 only when the reviewer relabels that point. Update the existing result component without changing the database schema or media publication.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase JSONB, Node test runner.

## Global Constraints

- The model onset is navigation context only, never a contact prediction.
- Existing version-1 labels must remain recoverable verbatim.
- A contact label is complete only with an in-clip exact time or `not_visible`.
- No database migration is required.

---

### Task 1: Versioned contact-label behavior

**Files:**
- Modify: `src/app/research/serve-detection/types.ts`
- Modify: `src/app/research/serve-detection/temporalServeResultsView.ts`
- Test: `src/app/research/serve-detection/temporalServeResultsView.test.ts`

**Interfaces:**
- Produces: `TemporalServeContactReview` schema version 2, `hydrateTemporalServeContactReview`, `validateTemporalServeContactReview`, `isTemporalServeContactReviewed`, and contact progress/filter behavior.

- [x] Write failing tests proving version-1 onset labels become unreviewed version-2 drafts with the original payload preserved.
- [x] Write failing tests proving exact contact requires an in-clip time and `not_visible` does not.
- [x] Write failing tests proving progress and filters count only completed version-2 contact labels.
- [x] Run `node --test --experimental-strip-types src/app/research/serve-detection/temporalServeResultsView.test.ts` and confirm the new assertions fail for the missing schema.
- [x] Implement the minimal types and helpers.
- [x] Run the same command and confirm all tests pass.

### Task 2: Contact-first review UI

**Files:**
- Modify: `src/app/research/serve-detection/TemporalServeResults.tsx`

**Interfaces:**
- Consumes: the version-2 hydration, validation, completion, filtering, and progress helpers from Task 1.

- [x] Replace onset verdict actions with `Mark first serve contact` and `Contact is not visible` actions.
- [x] Keep the onset jump and initial playback position, but label it “motion-onset hint” and state that no contact prediction exists yet.
- [x] Replace onset accuracy metrics with exact-contact, not-visible, and remaining counts.
- [x] Preserve legacy onset payloads when saving version-2 labels.
- [x] Run targeted ESLint and the TypeScript test.

### Task 3: Production verification and deployment

**Files:**
- No additional product files.

- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect the complete diff.
- [ ] Commit and rebase on the latest `origin/main`.
- [ ] Push the feature branch and fast-forward `main` only if it is still an ancestor.
- [ ] Confirm the Vercel status is successful and the protected route responds.
- [ ] Confirm the production batch still contains 100 sources and 100 assignments.
