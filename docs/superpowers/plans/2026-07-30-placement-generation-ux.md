# Placement Generation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the placement confirmation sheet after an accepted request,
show progress in the normal Tools row, and display one mobile-friendly
acknowledgement toast.

**Architecture:** Keep server submission and polling in
`usePlacementLifecycle`, but return a request result to the view. Drive the
sheet and toast through a small pure state transition in `placementRetry.ts`,
then make `PlacementToolsRow` render the established Share/Coach sheet style,
the row spinner, and the temporary toast.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Node test
runner.

## Global Constraints

- Keep the pre-submit confirmation step.
- Close the sheet only after the API accepts a generation or retry request.
- Show the acknowledgement exactly once per accepted request.
- Use the exact copy: “Placement maps are generating. We’ll email you when ready.”
- Do not show a completion or failure toast.
- Match the existing Share and Coach responsive sheet treatment.
- Do not change worker, database, retention, retry, or email behavior.

---

### Task 1: Define and test request UI transitions

**Files:**
- Modify: `src/lib/placement/placementRetry.ts`
- Test: `src/lib/placement/placementRetryView.test.ts`

**Interfaces:**
- Produces:
  - `PlacementRequestUiState` with `sheetOpen: boolean` and
    `acknowledgement: string | null`
  - `PlacementRequestUiEvent` for `open`, `close`, `started`, `failed`, and
    `dismiss_acknowledgement`
  - `placementRequestUiTransition(state, event): PlacementRequestUiState`

- [ ] **Step 1: Write failing state-transition tests**

Add tests with literal expectations:

```ts
test("accepted placement request closes the sheet and acknowledges once", () => {
  const started = placementRequestUiTransition(
    { sheetOpen: true, acknowledgement: null },
    { type: "started" },
  );
  assert.deepEqual(started, {
    sheetOpen: false,
    acknowledgement:
      "Placement maps are generating. We’ll email you when ready.",
  });
  assert.deepEqual(
    placementRequestUiTransition(started, {
      type: "dismiss_acknowledgement",
    }),
    { sheetOpen: false, acknowledgement: null },
  );
});

test("failed placement request keeps the sheet open without a toast", () => {
  assert.deepEqual(
    placementRequestUiTransition(
      { sheetOpen: true, acknowledgement: null },
      { type: "failed" },
    ),
    { sheetOpen: true, acknowledgement: null },
  );
});
```

- [ ] **Step 2: Run the placement suite and verify RED**

Run: `npm run test:placement`

Expected: FAIL because `placementRequestUiTransition` is not exported.

- [ ] **Step 3: Implement the minimal pure transition**

Implement an exhaustive switch in `placementRetry.ts`. `started` closes the
sheet and adds the approved acknowledgement; `failed` preserves an open sheet
without adding a toast; `open`, `close`, and `dismiss_acknowledgement` update
only the state they own.

- [ ] **Step 4: Run the placement suite and verify GREEN**

Run: `npm run test:placement`

Expected: all placement tests pass.

- [ ] **Step 5: Commit the transition**

```bash
git add src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetryView.test.ts
git commit -m "test: define placement request feedback"
```

### Task 2: Integrate accepted-request feedback and consistent responsive UI

**Files:**
- Modify: `src/app/match/[id]/usePlacementLifecycle.ts`
- Modify: `src/app/match/[id]/PlacementToolsRow.tsx`

**Interfaces:**
- Consumes:
  - `placementRequestUiTransition`
  - `PlacementRequestUiState`
- Produces:
  - `PlacementLifecycleController.requestAction(): Promise<boolean>`
    (`true` only when the requested job is accepted)

- [ ] **Step 1: Make request submission report acceptance**

Change the controller interface and callback to return `Promise<boolean>`.
Return `true` after a `202` response updates the local lifecycle to
`processing` or `retrying`. Return `false` for missing actions, duplicate
submits, stale completions, API conflicts, and network failures. Preserve all
existing reconciliation and inline-error behavior.

- [ ] **Step 2: Drive the sheet and toast from the tested transition**

Replace the standalone `open` state with `useReducer` and
`placementRequestUiTransition`. Await `controller.requestAction()` from the
CTA and dispatch `started` only for `true`; otherwise dispatch `failed`.
Dismiss the acknowledgement once after five seconds and clear its timer on
unmount.

- [ ] **Step 3: Match Share and Coach sheet styling**

Use their exact responsive structure:

```tsx
<div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
  <button className="absolute inset-0 bg-ink/70 backdrop-blur-sm" />
  <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-edge bg-surface p-5 pb-8 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
```

Use `text-base font-semibold` for the title, `mt-1 text-sm text-zinc-400`
for the supporting paragraph, and the same bordered `p-1.5` close button.
Remove the sheet spinner and mobile drag handle.

- [ ] **Step 4: Put progress in the Tools row**

When `controller.view.poll` is true, render a small decorative spinner beside
the existing `Generating…` or `Retrying…` status. Keep the status in its
polite live region.

- [ ] **Step 5: Render the one-time mobile-friendly toast**

Render a non-interactive fixed toast above mobile navigation using
`bottom-24 md:bottom-6`, `role="status"`, `aria-live="polite"`, a bounded
mobile width, `text-sm`, existing border/surface colors, and safe horizontal
padding.

- [ ] **Step 6: Run focused checks**

Run:

```bash
npm run test:placement
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the UI integration**

```bash
git add 'src/app/match/[id]/usePlacementLifecycle.ts' \
  'src/app/match/[id]/PlacementToolsRow.tsx'
git commit -m "fix: streamline placement generation feedback"
```

### Task 3: Verify and publish

**Files:**
- No production source changes expected.

**Interfaces:**
- Consumes the completed UI and test commits.
- Produces a verified production revision.

- [ ] **Step 1: Run the complete relevant verification**

Run:

```bash
npm run test:placement
npm run test:auth
npm run test:research
npm run test:learn
npm run test:journal
npm run test:costs
npm run test:match-structure
npm run lint
npm run build
git diff --check
git status --short
```

Expected: every test, lint, and build command exits 0; diff check is clean.

- [ ] **Step 2: Review the final diff against the approved design**

Confirm the sheet closes only on an accepted request, progress appears only
in the Tools row, the acknowledgement is immediate and one-time, failure
keeps the sheet open, and no worker/database/email code changed.

- [ ] **Step 3: Push without disturbing parallel work**

Fetch `origin/main`; if it remains an ancestor of the branch, push the
verified revision to `main` without force. If it advanced, merge it into the
feature branch and repeat Step 1 before pushing.

- [ ] **Step 4: Verify production**

Wait for the Vercel deployment matching the pushed commit to reach `READY`.
Confirm the production placement API still rejects an anonymous inert request
with `401 not_authenticated`.

