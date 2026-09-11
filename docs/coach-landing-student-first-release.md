# Coach landing page: student-first update

Approved by Adil, September 10, 2026. Based on production commit `8e0c1189`.

## Scope

Keep the existing design and headline. Put students, shared match feedback,
audio lesson summaries, two-way journals and video recaps first. Paid reviews
remain the sixth feature and walkthrough chapter. Update the hero description,
FAQs, metadata and the two “Start coaching” actions. Mobile actions are full-width.

The coach video, script, runtime, cuts and video-specific metadata are unchanged.
The player page only gains an anchor for the existing iPhone beta form. The
shared hero also receives a hydration fix: start with the same static markup on
server and browser, then honor the browser's motion preference.

## Screenshots

Five new stills use shipped app components with staged demo data. Mobile stills
are 780×1688 (390×844 at 2×), matching the existing player carousel. The hero
tablet still is 2360×1640 (1180×820 at 2×). The thumbnail is copied unchanged from
the existing public-showcase demo match. The data describes an illustrative
lesson; no actual student records, recordings or email workflows were changed.

Capture driver: `scripts/demos/coach-student-shots.mjs`. The fixture route exists
only during local capture and is removed even if browser startup fails. It must
not be present during a production build. The script blocks unrecognized API
requests and performs no account, email or database writes.

## Verification

- Full `npm run build`: passed, including lint/type checking and all 160 pages.
  Existing lint and workspace-root warnings remain; no warnings in changed files.
- Coach landing/capture/mode tests: 6 passed.
- All 23 package `test:*` unit suites (excluding the live research smoke test):
  1,463 passed, 1 failed. The failing Learn-guide copy assertion expects
  “reprocessing requests are open”. The same failure was reproduced from a clean
  archive of `origin/main`; none of its source files changed in this release.
- Production-build browser checks: 393×660, 320×660 and 1440×900 with reduced
  motion, plus 393×660 and 1440×900 with normal motion. All six chapters, image
  decoding/proportions, CTA sizes, FAQ beta destination and overflow checks pass.
  No coach-page client exceptions. Player page checked with normal motion.
- Independent code review: no remaining findings.
- Native iOS was not changed or tested. These are web screenshots, not native QA.
- No beta signup was submitted and no emails were sent.

## Existing issue outside this release

The player's other feature animations still produce a reduced-motion hydration
warning. Reproduced on the live site before this release; normal-motion player
checks pass. This is separate from the fixed shared hero and should be handled
in a player-animation follow-up, not concealed as a passing reduced-motion test.

## Release

Merge/push to `main` and let Vercel deploy the production branch. Do not use a
branch-based CLI production deployment. Verify the new deployment is Ready and
serving `www.ponglens.com/coaches` before reporting it as live.
