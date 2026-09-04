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
`10fff654e3f53adc8593d2ffacc2b2e4eeaa27185af0a2a627f377849a2348c7`,
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

The normalized coach clip was inspected at 0.2, 7, 14, 21, 28, 35, 42, and
49 seconds, including exact early and late frame exports. It begins on the
real `Record a lesson` paused state with no launch splash and proceeds to the
real `Your lesson` review with fixed ordinary table-tennis notes through the
last second. There are no full black, sign-in, loading, error, or private data
frames.

## Final verification

- Focused native insert suite: PASS, 11/11.
- `npm run test:tutorial`: PASS, 56/56.
- `npm run test:learn`: PASS, 36/36.
- `npm run learn:ios:check`: PASS.
- Remotion `npx tsc --noEmit`: PASS.
- `npm run build`: PASS; 142 static pages generated. Existing unrelated lint
  warnings remain.
- `git diff --check`: run before commit.

No TTS was generated, no final tutorial chapters were rendered, no media was
published, and no TestFlight build was started.
