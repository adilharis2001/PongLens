# Task 5 Report: Shared Client Controller and Placement Tools UI

## Status

Implemented the approved placement lifecycle UI:

- one shared client controller owns placement generation/retry POSTs, exact
  `202` optimistic transitions, ten-second lifecycle polling, terminal
  refreshes, and stable API error copy;
- the only placement request/retry CTA is inside the new `Placement maps`
  Tools-row sheet;
- the match-level status card and point detail surfaces are informational
  only;
- existing drawable placement maps and all other match Tools rows remain
  available.

## TDD Evidence

### Required lifecycle matrix

Added the six-row matrix for `not_requested`, `processing`,
`retry_available`, `retrying`, `ready`, and `final_failed`.

Initial run:

```text
node --test --experimental-strip-types src/lib/placement/placementRetryView.test.ts
tests 13
pass 13
fail 0
```

The matrix was already green because Task 1 had supplied the complete
`placementLifecycleView` behavior. No false RED was manufactured.

### RED: action endpoint selection

Added a behavior test requiring generation and retry actions to select their
matching APIs.

```text
tests 14
pass 13
fail 1
AssertionError: actual 'undefined', expected 'function'
```

### GREEN: action endpoint selection

Added `placementActionEndpoint`.

```text
tests 14
pass 14
fail 0
```

### RED: stable request error copy

Added a behavior test covering source expiry, duplicate processing, used
retry, owner/auth failures, and the default queue failure.

```text
tests 15
pass 14
fail 1
AssertionError: actual 'undefined', expected 'function'
```

### GREEN: stable request error copy

Added `placementRequestErrorCopy`.

```text
tests 15
pass 15
fail 0
```

### RED: terminal refresh classification

Added a behavior test requiring only `ready`, `retry_available`, and
`final_failed` to be terminal refresh states.

```text
tests 16
pass 15
fail 1
AssertionError: actual 'undefined', expected 'function'
```

### GREEN: terminal refresh classification

Added `isPlacementTerminal` and used it in the shared controller.

```text
tests 16
pass 16
fail 0
```

## Final Verification

### Placement suite

```text
npm run test:placement
tests 37
pass 37
fail 0
```

### Targeted lint

```text
npx eslint \
  src/lib/placement/placementRetry.ts \
  'src/app/match/[id]/usePlacementLifecycle.ts' \
  'src/app/match/[id]/PlacementToolsRow.tsx' \
  'src/app/match/[id]/PlacementStatusCard.tsx' \
  'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/PointDetail.tsx' \
  'src/app/match/[id]/PointSheet.tsx' \
  'src/app/match/[id]/PlacementAggregate.tsx'
```

Exit code `0`; no findings.

### Production build

```text
npm run build
```

Exit code `0`; compilation, type checking, static generation, and route build
completed successfully.

## Files

- `src/lib/placement/placementRetry.ts`
- `src/lib/placement/placementRetryView.test.ts`
- `src/app/match/[id]/usePlacementLifecycle.ts`
- `src/app/match/[id]/PlacementToolsRow.tsx`
- `src/app/match/[id]/PlacementStatusCard.tsx`
- `src/app/match/[id]/MatchView.tsx`
- `src/app/match/[id]/PointDetail.tsx`
- `src/app/match/[id]/PointSheet.tsx`
- `src/app/match/[id]/PlacementAggregate.tsx`
- `.superpowers/sdd/2026-07-29-late-placement-generation/task-5-report.md`

## Self-review

- Verified `/api/placement-generate` and `/api/placement-retry` selection is
  centralized and that `usePlacementLifecycle` is the only match component
  performing placement POSTs or lifecycle polling.
- Verified local lifecycle state advances to `processing` or `retrying` only
  when the response status is exactly `202`.
- Verified polling uses a `10_000` ms interval, starts only for poll states,
  and cleans up on state change or unmount.
- Verified `ready`, `retry_available`, and `final_failed` refresh server
  content once per transition.
- Verified the request/retry action button exists only in
  `PlacementToolsRow`; the bottom card and point surfaces render copy and
  progress state only.
- Verified the new row reuses `TOOL_ROW_CLASS`, `ToolRowChevron`, current
  sheet geometry/colors, safe-area padding, Escape handling, focus restore,
  and current typography.
- Verified ready or previously drawable placement data still renders the
  existing aggregate.
- Verified no unrelated match tool behavior was removed.

## Concerns

- The build continues to report pre-existing warnings for the inferred
  workspace root/multiple lockfiles and the unused `MAX_SAVE_W` constant in
  `Annotator.tsx`. Task 5 adds no lint errors or warnings.
- The repository has no DOM component-test harness. Component integration is
  covered by the production TypeScript/build pass and source-level
  self-review; pure lifecycle, endpoint, terminal, and error-copy decisions
  are covered by automated tests.
