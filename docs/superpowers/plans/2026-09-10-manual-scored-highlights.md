# Manual, Scored Highlight Generation Implementation Plan

> **Execution:** Use the repository's test-first workflow and implement this plan task-by-task in the isolated feature worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop automatic highlight rendering and require an explicit owner request after at least 75% of scorable points are scored, with only scored rallies eligible for the reel.

**Architecture:** Normal processing continues to persist highlight evidence but no longer renders a reel. A database-owned eligibility calculation protects the API, queue, and worker; web and iOS render the same lifecycle state through their existing Highlights and placement-request patterns. New scored-only manifests remain compatible with released clients while legacy ready reels stay playable.

**Tech Stack:** PostgreSQL/Supabase migrations, Next.js/TypeScript, Python worker/FFmpeg pipeline, SwiftUI iOS.

**Spec:** `docs/superpowers/specs/2026-09-10-manual-scored-highlights-design.md`

## Global Constraints

- Eligibility is exact: active, non-deleted, non-Skip/Let points with confirmed winners must satisfy `scored * 4 >= scorable * 3`.
- Normal processing must persist highlight evidence but never create, render, upload, or account for a highlight reel.
- New reels contain scored rallies only; current ready legacy reels remain playable.
- Opening Highlights remains read-only. Only the explicit Generate/Update action enqueues work.
- Web and iOS reuse existing PongLens colors, typography, spacing, sheets, and button treatments. Mobile actions are full-width and at least 44px/44pt high.
- Verify desktop web, 393x660 mobile web, and native iOS independently.

---

### Task 1: Database-owned score eligibility

**Files:**
- Create: `supabase/migrations/20260910190000_highlight_score_eligibility.sql`
- Create: `supabase/migrations/20260910191000_highlight_enqueue_score_guard.sql`
- Test: `src/app/api/highlights/highlightEligibilityMigration.test.ts`

**Interfaces:**
- Produces: `public.highlight_generation_eligibility(uuid)` returning `scored_points`, `scorable_points`, `required_points`, `required_percent`, and `eligible`.
- Produces: private `app_config.highlights_enabled`, copied from `automatic_highlights`.
- Updates: `enqueue_reel` to raise `highlights_score_required` for an ineligible `highlights` scope.

- [ ] Write a migration contract test proving active-version isolation, deleted/Skip exclusion, exact 75% arithmetic, private config, and queue enforcement.
- [ ] Run the test and confirm it fails because the migration is absent.
- [ ] Add the behavior-neutral SQL function and copied feature flag in the first migration.
- [ ] Add the owner-checked enqueue guard in the second migration without changing other reel scopes, so it can be applied after the API deploy.
- [ ] Run the migration contract test and existing migration/reel tests.
- [ ] Commit the database contract.

### Task 2: Worker becomes manual-only and scored-only

**Files:**
- Modify: `worker/highlights.py`
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_highlights.py`
- Modify: `worker/tests/test_worker.py`
- Modify: `worker/tests/test_match_reprocess.py`

**Interfaces:**
- `qualifies(point)` additionally requires `confirmed_winner`.
- `build_manifest(points)` writes additive `scored_only: true`.
- `points_revision(points, scored_only=True)` includes only the scored/unscored boolean for new manifests; legacy freshness remains available for old manifests.
- `process_reel` reads and rechecks database eligibility before evidence recovery or rendering.

- [ ] Add failing tests that normal processing never calls `prepare_auto_highlights`, unscored rallies never qualify, winner corrections do not alter the scored-only revision, and unscoring does.
- [ ] Run the focused worker tests and confirm the new assertions fail.
- [ ] Remove the automatic post-processing call while retaining evidence insertion creation and persistence.
- [ ] Add `confirmed_winner` to highlight point loads and scored-only selection/revision metadata.
- [ ] Add the pre-compute eligibility check to the worker; mark an obsolete queued request without running recovery or FFmpeg.
- [ ] Run focused worker tests and commit.

### Task 3: API lifecycle and backward compatibility

**Files:**
- Modify: `src/app/api/highlights/access.ts`
- Modify: `src/app/api/highlights/route.ts`
- Modify: `src/app/api/highlights/endPolicy.ts`
- Modify: `src/app/api/highlights/access.test.ts`
- Modify: `src/app/api/highlights/endPolicy.test.ts`
- Modify: `src/app/api/highlights/highlightsRoute.test.ts`

**Interfaces:**
- GET adds `needs_scoring` plus coverage fields and remains read-only.
- POST maps ineligible requests to `highlights_score_required` without enqueueing.
- `highlightManifestIsFresh` uses legacy revision for ready manifests without `scored_only` and scored-only revision for new manifests.

- [ ] Add failing tests for below/exact threshold, read-only GET, POST rejection, in-flight priority, legacy-ready grandfathering, and old empty/failed regeneration.
- [ ] Run the API tests and confirm the failures.
- [ ] Implement the new feature-flag name, eligibility read, lifecycle ordering, response fields, and stable error mapping.
- [ ] Run all highlight API and match lifecycle tests.
- [ ] Commit the API contract.

### Task 4: Existing web Highlights sheet gains the score gate

**Files:**
- Modify: `src/app/match/[id]/highlights.ts`
- Modify: `src/app/match/[id]/HighlightsRow.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/highlights.test.ts`

**Interfaces:**
- `HighlightState.needs_scoring` carries score coverage.
- `HighlightsRow` receives `onScore()` and uses it for the sole primary action below 75%.

- [ ] Add failing presentation tests for the exact row summary, title, body, action label, and full-width action treatment.
- [ ] Read `PlacementToolsRow.tsx`, `AllowanceRequest.tsx`, and `AllowanceRecovery.tsx` completely before editing.
- [ ] Extend parsing and lifecycle presentation without changing the ready/share layout.
- [ ] Wire `Score the Match` to the existing player scorekeeper and preserve current focus/scroll behavior.
- [ ] Run highlight and match tests, then inspect desktop and 393x660 mobile web.
- [ ] Commit the web UI.

### Task 5: Native iOS Highlights sheet gains the same gate

**Files:**
- Modify: `ios/PongLens/PongLens/Core/Models.swift`
- Modify: `ios/PongLens/PongLens/Screens/HighlightsSheet.swift`
- Modify: `ios/PongLens/PongLens/Screens/MatchTools.swift`
- Modify: `ios/Tests/HighlightsTests.swift`

**Interfaces:**
- `AutomaticHighlightsResponse` decodes the optional coverage fields.
- `AutomaticHighlightsRequestView` exposes the same title/body/action as web.
- `HighlightsSheet` receives `onScore` and dismisses before opening the existing scorekeeper.

- [ ] Add failing native tests for below-threshold copy, exact threshold behavior, and action identity.
- [ ] Read the full placement request sheet and approved allowance request/recovery views before editing.
- [ ] Add the lifecycle fields and full-width existing-style score action without new pills, panels, or colors.
- [ ] Wire the action through `ToolsSection` to the existing scorekeeper.
- [ ] Run iOS tests, build the simulator target, and visually inspect the native sheet.
- [ ] Commit the iOS UI.

### Task 6: Release verification and rollout evidence

**Files:**
- Update: `docs/superpowers/plans/2026-09-10-manual-scored-highlights.md`

**Interfaces:**
- Produces verification evidence for database, worker, web, iOS, and the shared Mac/Modal worker release.

- [ ] Run focused TypeScript and Python suites.
- [ ] Run the real `npm run build` in this isolated worktree.
- [ ] Run native iOS unit tests and a simulator build.
- [ ] Capture/inspect desktop web, 393x660 mobile web, and native iOS states.
- [ ] Review the branch diff against the approved spec and verify no unrelated files changed.
- [ ] Prepare the migration/web/iOS/worker deployment sequence; do not claim production until every deployed surface is verified.
