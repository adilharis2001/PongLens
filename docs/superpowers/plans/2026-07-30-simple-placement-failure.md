# Simple Placement Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace technical placement-failure language and the duplicate alert
card with the original `Where the ball landed` empty-state experience.

**Architecture:** Centralize plain-language lifecycle copy and deep-dive
visibility in `placementRetry.ts`. Reuse `PlacementAggregate` for every static
empty state, while Tools remains responsible for actions and progress. Change
only the presentation of worker emails.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Python 3,
`unittest`, Node test runner.

## Global Constraints

- Use the approved copy from the design verbatim.
- Do not display the placement deep-dive while generation or retry is running.
- Do not add a new error-card design; reuse `PlacementAggregate`.
- Keep all generation, retry, retention, database, API, and email-delivery
  behavior unchanged.
- Customer-facing placement copy must not use `reliable`, `calibration`,
  `stronger`, `normal placement analysis`, or `processing-retention window`.

---

### Task 1: Plain lifecycle copy and deep-dive visibility

**Files:**
- Modify: `src/lib/placement/placementRetry.ts`
- Test: `src/lib/placement/placementRetryView.test.ts`

**Interfaces:**
- Produces:
  - `showPlacementDeepDive(view: PlacementLifecycleView, hasDrawablePlacement: boolean): boolean`
  - Plain-language `noticeBody`, `sheetBody`, request errors, legacy retry
    view, and owner/non-owner notice copy.

- [ ] **Step 1: Write failing copy and visibility tests**

Add literal assertions for the approved final-failure, retry-available,
not-requested, source-unavailable, processing, and retrying copy. Assert the
combined customer-facing fields do not match:

```ts
/(reliable|calibration|stronger|normal placement analysis|processing-retention)/i
```

Add a visibility table proving:

```ts
not_requested -> true
processing -> false
retry_available -> true
retrying -> false
ready -> true
final_failed -> true
hasDrawablePlacement -> true
```

- [ ] **Step 2: Run the placement suite and verify RED**

Run: `npm run test:placement`

Expected: FAIL on the old technical copy and missing
`showPlacementDeepDive` export.

- [ ] **Step 3: Implement minimal lifecycle changes**

Replace customer-facing lifecycle and request-error copy with the approved
language. Add the pure visibility helper:

```ts
export function showPlacementDeepDive(
  view: PlacementLifecycleView,
  hasDrawablePlacement: boolean,
): boolean {
  if (hasDrawablePlacement || view.showAggregate) return true;
  return !view.poll && view.noticeBody !== null;
}
```

- [ ] **Step 4: Run the placement suite and verify GREEN**

Run: `npm run test:placement`

Expected: all placement tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/placement/placementRetry.ts \
  src/lib/placement/placementRetryView.test.ts
git commit -m "fix: simplify placement lifecycle language"
```

### Task 2: Restore the established placement empty state

**Files:**
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/PlacementAggregate.tsx`
- Delete: `src/app/match/[id]/PlacementStatusCard.tsx`

**Interfaces:**
- Consumes:
  - `showPlacementDeepDive(view, hasDrawablePlacement)`
  - `placementNoticeForViewer(view, isOwner)`
- Produces:
  - `PlacementAggregate.emptyMessage?: string | null`

- [ ] **Step 1: Add the optional empty message**

Add `emptyMessage?: string | null` to `PlacementAggregate`. In its existing
`!anyPlacement` branch, render that value when present; otherwise retain:

```text
No placement data for this match yet — the ball's bounces couldn't be mapped from the recording.
```

- [ ] **Step 2: Replace the duplicate status card**

Remove the `PlacementStatusCard` import and render. Use
`showPlacementDeepDive` around `PlacementAggregate`, passing the already
viewer-adjusted `placementNotice` as `emptyMessage`. Keep `#ball-map`, the
heading, hint, aggregate filters, and drawable-data behavior unchanged.

- [ ] **Step 3: Delete the obsolete component**

Delete `src/app/match/[id]/PlacementStatusCard.tsx`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm run test:placement
npx eslint 'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/PlacementAggregate.tsx' \
  src/lib/placement/placementRetry.ts
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/PlacementAggregate.tsx' \
  'src/app/match/[id]/PlacementStatusCard.tsx'
git commit -m "fix: restore placement empty-state design"
```

### Task 3: Plain-language placement emails

**Files:**
- Modify: `worker/tests/test_placement_notifications.py`
- Modify: `worker/worker.py`

**Interfaces:**
- Keeps existing function signatures:
  - `done_email_html(...)`
  - `placement_retry_email_html(...)`
  - `placement_generation_email_html(...)`
  - notification delivery functions.

- [ ] **Step 1: Write failing email tests**

Assert all failure variants contain `table was hard to detect`, retryable
variants contain `try once more`, final failure contains
`match, clips, and notes are ready`, and success variants contain
`see where the ball landed`. Assert rendered placement emails and placement
subjects do not match:

```py
r"reliable|calibration|stronger|normal placement|processing-retention"
```

Keep assertions for the `#placement-tools` and `#ball-map` links.

- [ ] **Step 2: Run notification tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 \
  /Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest worker.tests.test_placement_notifications -v
```

Expected: FAIL on the old technical email content.

- [ ] **Step 3: Replace only customer-facing email content**

Use the approved simple headings, bodies, button labels, and subjects. Do not
change recipients, links, BCC behavior, outcome branching, or error handling.

- [ ] **Step 4: Run notification tests and verify GREEN**

Run the Task 3 Step 2 command again.

Expected: all notification tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/tests/test_placement_notifications.py worker/worker.py
git commit -m "fix: simplify placement notification emails"
```

### Task 4: Verify, review, and deploy

**Files:**
- No source changes expected.

- [ ] **Step 1: Run complete verification**

Run worker tests; all app suites; lint; production build; `git diff --check`;
and confirm a clean worktree.

- [ ] **Step 2: Review the full branch**

Confirm no standalone status card remains, all static failure states use the
existing placement shell, progress states hide that shell, all approved copy
is exact, prohibited terminology is absent from customer-facing outputs, and
processing behavior is unchanged.

- [ ] **Step 3: Publish safely**

Fetch `origin/main`. If it is still an ancestor, push the verified revision to
`main` without force. If it advanced, merge it into the branch and repeat
Step 1 before pushing.

- [ ] **Step 4: Update the production worker**

Fast-forward the dedicated production worker worktree to the pushed `main`
revision, restart its LaunchAgent, and confirm the startup log reports the
exact commit.

- [ ] **Step 5: Verify production**

Wait for the Vercel deployment matching the pushed commit to reach `READY`.
Confirm `www.ponglens.com` is aliased and the anonymous inert placement route
still returns `401 not_authenticated`.
