# Simple Placement Failure Design

## Goal

Explain placement-map failures in plain language and restore the established
`Where the ball landed` empty-state design instead of showing a second,
standalone failure card below Match analysis.

## Root cause

The late-generation rollout added `PlacementStatusCard` and suppressed
`PlacementAggregate` for every lifecycle state except `ready`. That replaced
the original placement subsection—heading, hint, rounded empty-state shell,
and centered copy—with a separate lifecycle alert. The same rollout exposed
internal concepts such as reliability, calibration strategy, and processing
retention in customer-facing UI and emails.

## Approved UI

- Delete the standalone placement failure/status card.
- Keep generation and retry actions and live progress in the Placement maps
  Tools row.
- Show no `Where the ball landed` subsection while generation or retry is
  running.
- For an unrequested, retryable, expired, or failed placement state, restore
  the existing `PlacementAggregate` subsection and its rounded, centered
  empty-state shell.
- Keep the existing aggregate unchanged when drawable placement data exists.

## Approved copy

- Final table-detection failure:
  `Placement maps couldn't be generated because the table was hard to detect in this video.`
- Retry available:
  `Placement maps couldn't be generated because the table was hard to detect in this video. You can try once more from Tools.`
- Not requested:
  `Placement maps haven't been generated for this match. You can generate them from Tools.`
- Source unavailable:
  `Placement maps couldn't be generated because the original video is no longer available.`
- Processing:
  `Placement maps are generating. We'll email you when they're ready.`
- Retrying:
  `We're trying again. We'll email you when they're ready.`

Non-owner copy replaces the Tools instruction with a short statement that the
match owner can generate or try again.

## Email copy

- Email subjects and card headings say either `Your placement maps are ready`
  or `Placement maps couldn't be generated`.
- Failure emails explain that the table was hard to detect in the video.
- When a retry remains, the email says the user can try once more from Tools.
- After the final retry, the email says the match, clips, and notes are ready.
- Success emails simply invite the user to see where the ball landed.

Customer-facing placement copy must not use `reliable`, `calibration`,
`stronger`, `normal placement analysis`, or `processing-retention window`.
Internal worker names and diagnostic codes remain unchanged.

## Component boundaries

- `placementRetry.ts` owns lifecycle copy and a pure helper deciding whether
  the placement deep-dive should render.
- `MatchView.tsx` uses that helper and passes the lifecycle empty message into
  `PlacementAggregate`.
- `PlacementAggregate.tsx` accepts an optional empty message while retaining
  its existing shell and default no-data message.
- `PlacementStatusCard.tsx` is removed.
- `worker.py` changes only customer-facing placement email content and
  subjects. Processing behavior is unchanged.

## Testing

- Lifecycle tests cover plain-language copy, prohibited terminology, owner and
  non-owner messages, and the deep-dive visibility matrix.
- Worker notification tests cover initial failure, retry success/failure, late
  generation success/failure, links, and prohibited terminology.
- The full placement, worker, application, lint, and production-build gates
  run before deployment.

