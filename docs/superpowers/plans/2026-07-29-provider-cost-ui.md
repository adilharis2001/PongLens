# Provider Cost Reconciliation UI Implementation Plan

**Goal:** Surface configured provider usage checks in the owner-only admin cost dashboard, move the dashboard to the bottom, and retain a separate synthetic compute estimate.

**Architecture:** Extend the existing reconciliation snapshot pipeline rather than adding billing data to totals. A pure view-model function converts aggregate provider snapshots into compact provider rows. The client component renders those rows, while the worker continues to refresh snapshots daily.

**Tech stack:** Next.js, React, TypeScript, Node test runner, Python worker tests, Supabase.

### Task 1: Correct Supabase reconciliation

**Files:**
- Modify: `worker/cost_reconcile.py`
- Test: `worker/tests/test_cost_reconcile.py`

1. Add a regression test asserting the Management API request uses `interval=1day`.
2. Run the focused test and confirm it fails.
3. Change the request interval to `1day`.
4. Run the worker reconciliation tests.

### Task 2: Build provider-check view models

**Files:**
- Modify: `src/app/admin/costDashboardView.ts`
- Modify: `src/app/admin/costDashboardView.test.ts`

1. Add tests for OpenAI, Deepgram, Cloudflare, and Supabase aggregate summaries.
2. Add a test proving unavailable Vercel is omitted while Resend remains an internal meter.
3. Run the cost tests and confirm they fail.
4. Implement provider ordering, status, summaries, and timestamps.
5. Run the cost tests.

### Task 3: Render provider reconciliation and move costs

**Files:**
- Modify: `src/app/admin/CostDashboardSection.tsx`
- Modify: `src/app/admin/page.tsx`
- Add: `src/app/admin/adminPageView.ts`
- Add: `src/app/admin/adminPageView.test.ts`
- Modify: `package.json`

1. Add a test for the admin section order.
2. Render the provider-check view model in a compact table.
3. Move Platform costs after Storage and quota.
4. Clarify live internal estimates, daily provider checks, and synthetic compute copy.

### Task 4: Verify and deploy main

1. Run cost dashboard and worker tests.
2. Run lint and production build.
3. Run provider reconciliation and confirm configured providers succeed.
4. Commit directly to `main`, push, and validate the production admin UI.

