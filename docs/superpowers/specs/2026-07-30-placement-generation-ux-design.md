# Placement Generation UX Design

## Goal

Make placement-map generation feel like the existing PongLens match tools,
especially on mobile. Starting a job should return the user to the match
instead of leaving a progress dialog over a dimmed page.

## Approved interaction

1. Selecting **Placement maps** from Tools opens a confirmation bottom sheet.
2. The sheet uses the same mobile and desktop treatment as Share and Coach:
   full-width mobile bottom sheet, centered `sm:max-w-sm` desktop dialog,
   `p-5` spacing, `text-base` heading, `text-sm` supporting copy, bordered
   circular close button, and the existing full-width cyan action.
3. The confirmation sheet never shows a progress spinner.
4. While the request itself is being submitted, its action reads
   **Starting…** and remains disabled.
5. Once the API accepts the generation or retry job, the sheet closes.
6. The normal match view remains visible. The Placement maps Tools row shows
   a small spinner beside **Generating…** or **Retrying…** while polling.
7. A temporary toast appears once for that accepted request:
   **Placement maps are generating. We’ll email you when ready.**
8. The toast does not reappear when the job succeeds or fails. The live Tools
   status, placement content, failure state, and existing email communicate
   the eventual outcome.
9. The same acknowledgement behavior applies to the one stronger retry.
10. If the API does not accept the request, the sheet stays open and shows
    its existing inline error.

## Component boundaries

- `usePlacementLifecycle.ts` continues to own API submission and polling. Its
  `requestAction` method reports whether a new request was accepted.
- `PlacementToolsRow.tsx` owns the confirmation sheet, immediate
  acknowledgement toast, toast timer, and row-level progress indicator.
- `placementRetry.ts` owns a small pure request-UI state transition used by
  the component and covered by the existing placement test suite.
- The worker, database lifecycle, retry rules, retention rules, and email
  delivery remain unchanged.

## Accessibility and mobile behavior

- The confirmation remains a labelled modal dialog before submission.
- Focus returns to the Placement maps Tools row when the sheet closes.
- The toast uses `role="status"` and polite live-region behavior.
- The toast sits above the mobile navigation/safe area and does not block
  interaction.
- The Tools row status remains a polite live region and the spinner is
  decorative.

## Testing

- Add a failing pure-state test proving an accepted request closes the sheet
  and creates exactly one acknowledgement.
- Add a failing test proving a rejected request leaves the sheet open and
  creates no acknowledgement.
- Keep all placement lifecycle, retry, API, migration, lint, and production
  build checks green.

