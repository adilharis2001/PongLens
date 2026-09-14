# Local scorekeeper interaction checks

These checks mount the actual MatchView and Player with synthetic points and test-pattern video. Every browser API call is intercepted, including every score save; no production credentials or match data are used. Stop the fixture server before running a production build because both use this worktree's `.next` directory.

The fixture uses the current app's default ending flags: tap-end playback on, Keep score full-card on, rally-end-respects-card on, and unscored rally ending off. A previously scored point therefore plays its full card in Keep score; fixture point 1 ends at 8.0 seconds. A separate flag-off case verifies the existing tap-plus-guard stop at 6.5 seconds without changing the app's defaults.

| Step | Command or requirement |
| --- | --- |
| Generate synthetic video | `ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24 -t 27 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart /private/tmp/ponglens-scorekeeper-fixture.mp4` |
| Temporary route | Copy `scripts/qa/fixtures/scorekeeper-page.tsx` to `src/app/qa-scorekeeper/page.tsx`. Never commit the temporary route. |
| Start server | `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3218 NEXT_PUBLIC_SUPABASE_ANON_KEY=local-fixture-only node scripts/qa/scorekeeper-server.mjs` |
| Run checks in another terminal | `node scripts/qa/scorekeeper.mjs` |
| Expected | 88 scenarios pass: desktop 1440×900 and mobile 393×660, forty-four each |
| Scenarios | Correct + Undo; clear + Undo; Skip + Undo; paused first answer; continuous first answer; scrubbed first answer; automatically paused first answer; failed clear with visible feedback; failed Undo followed by retry; Undo while save is pending; pending clear then Undo then correction; pending Undo followed by close; pending Undo followed by close and reopen at another point; pending Undo followed by choosing another point; pending Undo followed by explicit pause; Join immediately followed by a winner change; replay after an inserted point's required clip fails to load |
| Focus one scenario | `QA_SCENARIO=missing-own-clip node scripts/qa/scorekeeper.mjs` |
| Early-outcome checks only | `QA_SCENARIO=early node scripts/qa/scorekeeper.mjs` runs 48 checks: both winners, Skip, live taps, L/K shortcuts, answering a second and third time, Undo of a cut, the Split pill, immediate and delayed failed saves, timing threshold, corrections, navigation, close/reopen, manual resume, full-card-off playback and natural handoff into a separate point clip |
| Early-outcome behavior | A first winner or Skip with more than 3.5 seconds remaining ARMS the second answer while the remaining full card continues playing: the two winner buttons then mean "who won the rally that just finished", and one tap cuts the card at the arm's mark and scores the new half. The new half arms in turn while footage remains, so three rallies in one clip take three taps and no editor. Neither button shows the card's existing answer while armed. Split (in the hint) and Modify both open the editor on that same mark. Tail completion, navigation, Undo, a correction or a failed save disarms it. The arm adds no playback pause. Live winner taps retain their valid ending observation; Skip, paused answers and hand-cut halves do not create one. |
| Current UI reference only | `QA_SCENARIO=reference node scripts/qa/scorekeeper.mjs` checks the named “You serve. Press to give the serve to Alex.” switch on every surface, captures `qa-desktop-reference.png` and `qa-mobile-reference.png`, and performs no scorer-repair assertions |
| Current-baseline preservation | Forward and backward Join immediately followed by scoring; Keep score full-card on stops at 8.0 seconds; flag off stops at 6.5 seconds. The named serve switch is required in every case. |
| Baseline expectation | The reference path must pass on the current app. The continuous-playback checks fail against the prior immediate-pause implementation. |
| Evidence | `.superpowers/sdd/2026-09-11-scorekeeper-containment/qa-*.png` |
| Finish | Stop the server. Remove only the temporary `src/app/qa-scorekeeper/page.tsx` copied for this run. |
| Not covered | Native iOS, production permissions/database behavior, real match footage or delayed media/network events beyond the explicit scenarios |
