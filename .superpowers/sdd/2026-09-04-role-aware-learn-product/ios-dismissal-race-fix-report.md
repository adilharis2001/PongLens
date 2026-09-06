# Approved iOS tutorial dismissal-race fix

Date: 2026-09-04

Parent fix-wave HEAD: `355cbd590a588eec761ec2726c6696a180f6d7c5`

Implementation commit: `8b595d46b6b99d2d97a3761eb20cdfec506974a5`

Scope: the one additional Important iOS lifecycle finding explicitly approved after the final fix wave

External effects: none; no distribution, build upload, media publishing, or data mutation was performed

## Finding and root cause

`stopPlayback()` paused and cleared the current `AVPlayerItem` and removed its observer, but it did not invalidate the active `TutorialChapterLoadRequest`. Chapter loads were also launched as unretained tasks whose request generation was created inside the asynchronous function.

If the tutorial screen disappeared while the URL request was suspended, a late response could still satisfy `chapterLoad.succeed(request)`, install a new player item and time observer, and call `play()` after the screen was gone. A task that had been scheduled but had not yet begun could similarly create a fresh request after dismissal.

## RED

The focused delayed-response regression was added first to `LearnCatalogTests`. It begins a real production chapter request, models dismissal before a delayed URL arrives, and then sends that late URL through the intended production completion boundary.

Exact command:

`xcodebuild test -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -only-testing:PongLensTests/LearnCatalogTests`

Result: exit 65 with the expected compile failures because `TutorialChapterLoadState.cancel()` and `finishTutorialPlayerLoadIfCurrent` did not exist. No unrelated test failure caused the RED.

## Implementation

- `startPlayback(index:)` now creates the request generation synchronously before starting any asynchronous work.
- The screen retains a single URL-load `Task`. Starting another chapter cancels the previous task; stopping or dismissing cancels and releases it.
- `TutorialChapterLoadState.cancel()` advances the generation and returns to the picker phase, so any completion already in flight becomes stale.
- The network path checks task cancellation immediately after its await and before changing cache or playback state.
- Cached and network URLs both enter the same `finishTutorialPlayerLoadIfCurrent` gate. Only the still-current generation may install an `AVPlayerItem`, install the periodic observer, or start playback.
- `stopPlayback()` centralizes task cancellation, generation invalidation, player clearing, observer removal, and measurement reset. It is used by Chapters, the close button, the picker Back button, and `onDisappear`.
- Retry, previous/next selection, chapter-sheet selection, and automatic chapter advance all use the same synchronous start path.
- The existing observer body and actual-playback progress gate were preserved.

## GREEN and integrated verification

| Check | Result |
| --- | --- |
| Exact iPhone 17 Pro/iOS 26.5 `LearnCatalogTests` | 23/23 passed |
| Delayed-dismissal regression | passed |
| Exact simulator application build with `CODE_SIGNING_ALLOWED=NO` | passed |
| `ios/Tests/run.sh` | 648/648 checks passed |
| `npm run learn:ios:check` | passed |
| `git diff --check` | passed |

The regression asserts all observable late-completion outcomes: the completion is rejected; chapter selection and loading state are cleared; the real `AVPlayer` keeps no current item; observer installation is not called; and playback start is not called.

One parallel verification attempt caused the focused XCTest process to report Xcode's shared `build.db` lock while the exact app build was running. The app build passed, and the focused XCTest suite was rerun serially against the exact destination and passed 23/23. This was an invocation collision, not a product or test failure.

The exact simulator build continues to print existing warnings in unrelated code and one existing `Text` concatenation deprecation in `LearnScreen.swift`; no new warning was introduced by this fix.

## Files changed

- `ios/PongLens/PongLens/Core/LearnCatalog.swift`
- `ios/PongLens/PongLens/Screens/LearnScreen.swift`
- `ios/PongLens/PongLensTests/LearnCatalogTests.swift`
