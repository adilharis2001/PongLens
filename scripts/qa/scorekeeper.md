# Local scorekeeper interaction checks

These checks mount the actual MatchView and Player with synthetic points and test-pattern video. Every browser API call is intercepted, including every score save; no production credentials or match data are used. Stop the fixture server before running a production build because both use this worktree's `.next` directory.

The fixture reproduces the current deployed ending flags: tap-end playback on, Keep score full-card on, rally-end-respects-card on, and unscored rally ending off. A previously scored point therefore plays its full card in Keep score; fixture point 1 ends at 8.0 seconds, not the older tap-plus-guard stop at 6.5 seconds.

| Step | Command or requirement |
| --- | --- |
| Generate synthetic video | `ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24 -t 27 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart /private/tmp/ponglens-scorekeeper-fixture.mp4` |
| Temporary route | Copy `scripts/qa/fixtures/scorekeeper-page.tsx` to `src/app/qa-scorekeeper/page.tsx`. Never commit the temporary route. |
| Start server | `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3218 NEXT_PUBLIC_SUPABASE_ANON_KEY=local-fixture-only node scripts/qa/scorekeeper-server.mjs` |
| Run checks in another terminal | `node scripts/qa/scorekeeper.mjs` |
| Expected | 34 scenarios pass: desktop 1440×900 and mobile 393×660, seventeen each |
| Scenarios | Correct + Undo; clear + Undo; Skip + Undo; paused first answer; continuous first answer; scrubbed first answer; automatically paused first answer; failed clear with visible feedback; failed Undo followed by retry; Undo while save is pending; pending clear then Undo then correction; pending Undo followed by close; pending Undo followed by close and reopen at another point; pending Undo followed by choosing another point; pending Undo followed by explicit pause; Join immediately followed by a winner change; replay after an inserted point's required clip fails to load |
| Focus one scenario | `QA_SCENARIO=missing-own-clip node scripts/qa/scorekeeper.mjs` |
| Current UI reference only | `QA_SCENARIO=reference node scripts/qa/scorekeeper.mjs` checks the named “You serve. Press to give the serve to Alex.” switch on every surface, captures `qa-desktop-reference.png` and `qa-mobile-reference.png`, and performs no scorer-repair assertions |
| Baseline expectation | The reference path must pass on the current app. Until the scorer behavior is ported, failures in the 34-scenario regression matrix remain evidence of the intended repairs rather than permission to weaken its assertions. |
| Evidence | `.superpowers/sdd/2026-09-11-scorekeeper-containment/qa-*.png` |
| Finish | Stop the server. Remove only the temporary `src/app/qa-scorekeeper/page.tsx` copied for this run. |
| Not covered | Native iOS, production permissions/database behavior, real match footage or delayed media/network events beyond the explicit scenarios |
