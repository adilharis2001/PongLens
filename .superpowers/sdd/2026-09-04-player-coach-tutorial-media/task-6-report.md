# Task 6 report — DEBUG-only native tutorial capture states

## Result

The iOS app now accepts two DEBUG-only launch scenarios:

- `--tutorial-capture player-record` opens the shipping `RecordScreen` as a
  match and advances its real simulator viewfinder through ready, recording
  settings, recording, pause, and the finish-details handoff.
- `--tutorial-capture coach-audio-lesson` opens the shipping
  `LessonRecordScreen` in the coach workspace and advances through ready,
  recording, paused, writing-up, and review. Review uses a fixed ordinary
  table-tennis transcript and deterministic `LessonTakeaways`.

Each scenario emits a stable readiness marker and follows literal phase
boundaries so the native inserts can be recorded repeatably in Task 7.

## TDD checkpoints

RED: added parsing, deterministic-timeline, and DEBUG-fence tests first, then
ran the focused `LearnCatalogTests` command with DerivedData at
`/tmp/ponglens-media-task6-red`. It exited 65 because
`TutorialCaptureScenario` and its phase values did not exist.

The first implementation compile exposed a missing explicit `return` in
`RecordScreen.sessionCount` after its DEBUG early return changed the getter
from a single expression to multiple statements. The getter was corrected at
the cause rather than weakening a test.

GREEN: the focused suite with DerivedData at
`/tmp/ponglens-media-task6-green` passed 26 of 26, including the three new
tests:

- exact valid, missing, and unknown launch-argument parsing;
- exact phase boundaries for both scenarios;
- static verification that every capture hook in the scenario, router, root,
  recorder, and audio-lesson sources is enclosed by `#if DEBUG`.

## Data and shipping safety

The player capture exits before recorder configuration and never installs the
segment/session callbacks that enqueue footage. It also bypasses score
listening, upload-queue completion holds, poster and processing-balance
lookups, queue metadata/processing updates, and match registration. The
finish form receives only fixed in-memory metadata.

The coach capture exits before microphone/transcriber preparation and orphan
recovery. Its start and save functions are capture-guarded, its `saveAs`
closure returns false, and it creates no audio file or journal/Supabase write.
The workspace is selected by direct process-local assignment rather than the
shipping workspace setter, so it does not write UserDefaults or account
metadata.

No coach video-recording or coming-soon copy was introduced.

## Verification

- Focused `LearnCatalogTests`: PASS, 26/26.
- Debug simulator build with DerivedData at
  `/tmp/ponglens-media-task6-debug-build`: `** BUILD SUCCEEDED **`.
- Release generic simulator build with DerivedData at
  `/tmp/ponglens-media-task6-release-build`: `** BUILD SUCCEEDED **`.
- Positive control: the Debug app dylib contains `player-record`,
  `coach-audio-lesson`, and `PONGLENS_TUTORIAL_CAPTURE_READY`.
- Release exclusion: `nm -gj` scanned 9,803 symbols and `strings -a` scanned
  285,361 lines in the universal arm64/x86_64 Release executable. No match
  existed for the scenario type, property, flag, readiness marker, or either
  scenario value.
- `git diff --check`: PASS.

Existing iOS 26 and Swift 6 migration warnings remain in the builds; neither
build reported a new error.

## Review round 1

Review found that the deterministic player ready state sets
`settings.callOutScore` to true. Although the recorder's initial setup path
was capture-guarded, the shipping settings `onChange` observer was not, so it
could still call `ScoreListener.prepare()` during tutorial capture.

RED: added
`testPlayerTutorialCaptureCannotPrepareScoreListenerFromSettingsObserver`
against the real `RecordScreen` observer before changing production code. The
focused suite at `/tmp/ponglens-media-task6-review-red` exited 65: the 26
existing tests passed and only the new safety contract failed.

The observer now returns immediately for player tutorial capture inside a
`#if DEBUG` branch, before it can create the task that prepares the score
listener. Normal Debug use and all Release behavior keep the shipping path.

Review GREEN and renewed verification:

- Focused `LearnCatalogTests` at
  `/tmp/ponglens-media-task6-review-green`: PASS, 27/27.
- Debug simulator build at
  `/tmp/ponglens-media-task6-review-debug-build`: `** BUILD SUCCEEDED **`.
- Release generic simulator build at
  `/tmp/ponglens-media-task6-review-release-build`: `** BUILD SUCCEEDED **`.
- The Debug app dylib still contains both scenario values and the readiness
  marker.
- `nm -gj` scanned 9,803 symbols and `strings -a` scanned 285,177 lines in
  the renewed universal arm64/x86_64 Release executable. No capture type,
  property, flag, marker, or scenario value was present.
