# Task 7 report — native iOS tutorial footage

## Result

The tutorial media pipeline now captures the two approved DEBUG-only iOS
scenarios and composes them according to a catalog-owned native-insert
manifest.

- `player-record` is a muted 14-second insert in `player/upload`, beginning
  four seconds into the narrated chapter and rendered inside the existing
  portrait device screen geometry.
- `coach-audio-lesson` is promoted to the complete native source for
  `coach/coach-audio-lesson`, with the standard cue-track shape, an empty
  `cues` array, and the measured 50-second duration.
- Other chapters stage no native insert. Existing landing inserts, captions,
  header, progress, narration, intro, and outro remain unchanged.
- Paid reviews are excluded from the native manifest and remain web-only.

The driver validates its scenario and the exact available iPhone/iOS 26.5
simulator before reading credentials. It builds Debug, boots and installs the
app, mints the tutorial token only in-process, waits for the deterministic
marker through an unbuffered simulator console, records H.264, and cleans up
the recorder and app on success, failure, timeout, signal, and cleanup error.
Neither the key nor token hash is logged. Xcode DerivedData is stored under
the system temporary directory so it cannot enter Next.js's source scan.
Every capture child receives a positive allowlist of simulator/build
environment variables; service credentials, tutorial account variables, and
token/hash-like secrets are stripped even if passed as child-only additions.

## TDD and debugging checkpoints

Initial RED: `npm run test:tutorial` ran the new focused contract as part of
the suite and failed 1 of 6 because `capture-ios.mjs` did not exist. The first
implementation brought the focused tests to 7 of 7 and the tutorial suite to
52 of 52.

Real capture then exposed four runtime conditions that unit-only work did not:

1. The Swift readiness line was block-buffered by `simctl launch --console`.
   The driver now uses `--console-pty` plus
   `SIMCTL_CHILD_NSUnbufferedIO=YES`; the real marker arrived before capture.
2. The static coach review screen produced a short variable-frame-rate movie
   despite a 50-second wall-clock recording. A failing duration regression
   preceded fixed-rate finalization and final-frame padding.
3. Recorder shutdown could race QuickTime finalization. A failing close-event
   regression preceded waiting for `simctl`'s `close` after `SIGINT`.
4. The app readiness marker preceded dismissal of the branded presentation.
   Failing sequencing and trim regressions preceded the presentation settle
   wait and a one-second coach-source trim. The normalized result is padded
   from its genuine final review frame to the exact catalog duration.

A final cleanup RED passed 9 of 10 and showed that an exception while stopping
the recorder skipped app termination. GREEN is 10 of 10 after making the two
cleanup attempts independent while preserving the original capture error.

The production build then exposed generated Swift package examples beneath
the original in-repository DerivedData directory. A new regression failed
because the external-path helper was absent, then passed 11 of 11 after the
driver moved DerivedData outside the repository. The disposable earlier cache
was moved recoverably to `/tmp/ponglens-task7.Zo7HCS/DerivedData`.

Review follow-up added three independently failing contracts before their
implementations:

1. A real child-process environment inspection failed while credential,
   tutorial-account, and token/hash variables could cross the process
   boundary. It now passes with only the explicit safe allowlist, including
   the one unbuffered-simulator-console flag.
2. The coach scenario lacked a Transcript phase. Focused XCTest failed until
   the DEBUG-only timeline selected the real Transcript tab with deterministic
   content before selecting the real prepared Notes tab.
3. A failed `simctl terminate` status was not surfaced. Cleanup tests now prove
   recorder stop, app termination, and console draining are all attempted, a
   termination failure is reported on an otherwise successful run, and it
   does not mask an earlier capture failure.

The coach driver now defaults to one fixed, previously verified demo coach
identity. Before minting, it requires exactly one exact-email auth user marked
as a coach and exactly one coach profile for that same user; it never searches
for or chooses an arbitrary test-like account.

## Real simulator capture and cleanup

Both scenarios were built and captured from the real Debug app on the
validated iOS 26.5 simulator
`E62D60DD-6664-4C19-ADBE-ECF1A67E0047`.

`ffprobe` results:

| Source | Codec | Dimensions | Duration |
| --- | --- | --- | --- |
| `raw/native/player-record.mp4` | H.264 | 1206×2622 | 39.008333 s |
| `raw/native/coach-audio-lesson.mp4` | H.264 | 1206×2622 | 50.000000 s |

The promoted coach source has SHA-256
`896cc64a0923e9bbaca0bec62e60a2dd2570af698e9242f0ce4eebc72a622352`,
identical to the normalized native source. Its cue sidecar records a 390×844
viewport, duration 50, and no cues.

After capture, `simctl terminate` reported `found nothing to terminate`, and
an anchored process lookup found no `simctl ... recordVideo` process. The raw
captures, promoted coach source, and cue sidecar are all ignored by the
tutorial `.gitignore`; none is committed.

## Visual QA

The player clip was inspected at approximately 0, 5, 10, 15, 20, 25, 30,
and 35 seconds. It shows only the real app: the deliberately landscape
recording UI within the portrait simulator framebuffer, live recording
settings and progress, then the portrait Match details handoff. Visible values
are generic fixtures (`John`, `Opponent`, `Training partner`, and
`Club session`). There are no full black, sign-in, loading, error, or private
data frames.

The freshly normalized coach clip was inspected at 0.2, 5, 12, 20, 27, 34,
40, 46, and 49 seconds, including full-resolution Transcript and Notes frame
exports. It begins on the real `Record a lesson` ready state with no launch
splash, then shows active recording, paused recording, writing-up, the real
Transcript tab with readable ordinary table-tennis content, and the real
prepared Notes tab with title and Receive/Recovery bullets through the last
second. There are no full black, sign-in, loading, error, or private data
frames.

## Final verification

- Focused native insert suite: PASS, 16/16.
- Focused iOS `LearnCatalogTests`: PASS, 28/28.
- Debug iOS build: PASS; the capture scenario and marker strings are present.
- Release iOS build: PASS; 9,803 symbols and 285,611 extracted strings were
  scanned with zero capture-hook, scenario, marker, or Transcript-phase
  matches.
- `npm run test:tutorial`: PASS, 61/61.
- `npm run test:learn`: PASS, 36/36.
- `npm run learn:ios:check`: PASS.
- Remotion `npx tsc --noEmit`: PASS.
- `npm run build`: PASS; 142 static pages generated. Existing unrelated lint
  warnings remain.
- `git diff --check`: run before commit.

No TTS was generated, no final tutorial chapters were rendered, no media was
published, and no TestFlight build was started.
