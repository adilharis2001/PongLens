# Inline allowance recovery

Players can request free storage or processing-minute increases from the
screen where they reach a limit, without navigating to Account. The existing
request endpoint, duplicate protection, admin email notifications and grants
remain unchanged. Purchases enabled retains the Account purchase destination.

## Surfaces

- Web upload: storage refusal retains the selected file and offers a request
  plus manual upload retry. Insufficient processing minutes retains the saved
  match and offers a request plus manual processing retry.
- Web import: storage refusal retains the link. Completed downloads check the
  saved match, active processing jobs and minutes, rather than assuming that
  download completion means processing started. Recovery processes the saved
  match, never imports it again. Non-minute failures remain retryable.
- Web raw match: inline request and explicit balance refresh, retaining trim
  and processing settings.
- iOS: shared request sheet on failed upload rows, match-details sheet,
  YouTube import and the unprocessed match. Failed balance checks preserve the
  last known limit. Upload notifications claim processing started only after
  the server confirms a job.
- An import's downloaded video path is the fallback match identifier because
  the worker replaces matches.job_id as processing advances.

## Verification

- `npm run test:commerce` covers error classification, recovery mode and the
  downloaded-but-not-processed state.
- `bash ios/Tests/run.sh` covers storage classification and truthful upload
  processing outcomes alongside the existing native logic tests.
- Full web production build and iOS simulator build are required.
- `node scripts/qa/allowance-recovery.mjs` against a local Next dev server on
  port 3012 checks real components at 393×660 and 1440×900. It generates a
  temporary `/qa-allowance` route and deletes that file in cleanup. Do not
  deploy while the test is running. Supabase and application API calls are
  intercepted; no production users, requests, grants, or jobs are written.
- Generate a short valid MP4 at `/tmp/ponglens-allowance-fixture.mp4`, or set
  QA_VIDEO to an existing local test video. The test verifies cancellation,
  preserved drafts on focus/failure, pending deduplication, configuration
  failures, live purchase-mode changes, retrying the retained upload file,
  import lookup after the job link changes, and queue-full processing retry
  after an allowance increase. QA_BASE_URL may override the local server.
- Inspect screenshots written to `/tmp/ponglens-allowance-*.png`.

No database migration or worker deployment is required. Native changes need
an iOS release; a web deployment cannot update installed TestFlight builds.

## Results, September 5

- 108 web commerce, upload, payment, review and email tests passed.
- 668 native logic checks passed.
- Full Next.js build and iOS simulator build passed, with existing unrelated
  warnings. Native screens were not interactively tested on a physical iPhone.
- Browser smoke checks passed at both specified viewports. Screenshots of the
  real upload form and request/pending states were inspected.
- Independent review found no remaining Critical or Important defects after
  correcting failed refreshes, import identity and non-minute retry handling.
