# The deck shows only what it has earned (web, iOS builds 211 and 213)

The Match analysis deck no longer draws half-filled cards on a partly scored match. The serve maps show whenever the detailed analysis exists, since they are the worker's own evidence; everything that reads the score waits until 75 percent of the points have a winner. One "What's next" card closes the deck until nothing is left to do, and only then does "More cards coming soon" appear.

## Rules

| Card | Shows when |
| --- | --- |
| Serve landings, Heat map | Analysis ready, the owner's end known, three or more placed points. A line says who served is estimated until the match is scored. |
| Overview, Point length, Serve speed, Where points ended | 75 percent of scorable points scored, plus each card's own minimum. |
| Why you lost, Serve follow-ups | Unchanged: three or more answered. |
| What's next | Owner only. Rows in order: which end did you play from, score the match (progress, needed count, button), then the detailed analysis. Generate or Try again is offered only once the match is scored; an analysis that exists or is running shows as a status row at any time. Until every row is done. |
| More cards coming soon | Only when fully scored and the analysis is ready or has finally failed. |

## Checks

- Headless captures of four of Adil's matches on the dev server at 393×660: partly scored with analysis (maps + What's next), unscored without analysis (What's next only, with Generate), fully scored (full deck + teaser, no next-step card), practice with no end set (side question + analysis ready).
- Placement suites pass; the retry copy no longer promises an email.
- iOS builds for the simulator with the same rules; not verified by eye (the simulator tool cannot tap).

## Build 213: no upload-time toggle

The "Placement maps" switch is gone from the web process panel, the dashboard upload card, the iOS process panel, Record settings and the upload sheet. The detailed analysis has one entry point, the next-step card after scoring, so it runs on confirmed cuts. Learn guides, QA cases and the admin processing labels say "detailed analysis".
