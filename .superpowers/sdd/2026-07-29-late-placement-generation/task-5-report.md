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

## Fix Round 1

### Findings addressed

1. Placement action completions were not tied to the match and request
   generation that started them. An older response could overwrite a newer
   match lifecycle, error, or submitting state.
2. Point-level `not_requested` copy directed non-owner viewers to an
   owner-only Tools row.

### RED: stale/current request identity

Added a focused pure behavior test requiring a completion to match both the
current match id and request epoch.

```text
node --test --experimental-strip-types \
  src/lib/placement/placementRetryView.test.ts
tests 17
pass 16
fail 1
AssertionError: actual 'undefined', expected 'function'
```

### GREEN: stale/current request identity

Added `isPlacementRequestCurrent` and applied it to success, error, and
`finally` completion paths. Incoming match/server lifecycle props now
invalidate prior epochs and reset transient submitting/error state.

```text
tests 17
pass 17
fail 0
```

### RED: viewer-aware informational copy

Added a focused test requiring owner copy to remain unchanged while
non-owner generation/retry notices name the match owner and never direct the
viewer to owner-only Tools.

```text
node --test --experimental-strip-types \
  src/lib/placement/placementRetryView.test.ts
tests 18
pass 17
fail 1
AssertionError: actual 'undefined', expected 'function'
```

### GREEN: viewer-aware informational copy

Added `placementNoticeForViewer` and used its result for both desktop
`PointDetail` and mobile `PointSheet`.

```text
tests 18
pass 18
fail 0
```

### Fix Round 1 final verification

```text
npm run test:placement
tests 39
pass 39
fail 0
```

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

```text
npm run build
```

Exit code `0`; compilation, type checking, static generation, and route build
completed successfully. The previously documented multiple-lockfile and
unused `MAX_SAVE_W` warnings remain unchanged.

```text
git diff --check
```

Exit code `0`; no whitespace errors.

### Fix Round 1 self-review

- A request captures `{ matchId, epoch }` before starting.
- Match or incoming server lifecycle changes increment the epoch and reset
  `submitting` and `error`.
- Success/error writes and `finally` cleanup compare both captured values
  with the current identity, so old completions cannot change newer state.
- Owner point notices retain the existing Tools instruction.
- Non-owner generation and retry notices explicitly identify the match owner
  as the person who can request the action.

### Fix Round 1 concerns

- No new concerns. The repository still has no DOM component-test harness;
  the required stale/current decision and viewer-copy branches are covered
  through pure tests used directly by the hook and MatchView.
