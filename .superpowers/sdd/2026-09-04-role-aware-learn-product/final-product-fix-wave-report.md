# Final product fix wave report

Date: 2026-09-04

Starting commit: `cfd2b9e2cc2f568db1255c8a6103f46c8294af18`

Implementation commit: `16907ee0` (`fix: harden Learn compatibility and playback`)

Scope: the three Important findings from the final whole-branch review

External effects: none; no tutorial media was published and no staging or production data was changed

## Outcome

The Learn implementation now preserves the released player tutorial API contract, keeps the web-only YouTube import guide out of the iOS bundle, and presents chapter-specific load failures with a real retry path on both web and iOS. The iOS player also clears the previous item before any newly selected chapter begins loading, so an old video cannot play under a new title.

## Finding 1 — released tutorial API compatibility

### Root cause and compatibility design

The new `/api/tutorial-url` route accepted only `{ course, platform, slug? }`. Released clients had used `{ slug }`, `{}`, or an empty request body, and expected the flat player keys and the same `{ urls: { [slug]: signedURL } }` response shape.

History at the previous route implementation confirmed the exact legacy chapter set and storage shape. Compatibility is intentionally narrow:

- An empty body or exact `{}` signs the nine released flat player keys.
- Exact `{ slug: string }` signs one released flat player key.
- The legacy allowlist is fixed to `home`, `upload`, `viewer`, `point`, `keepscore`, `analysis`, `export`, `coach`, and `journal`, mapped to `tutorial/<slug>.mp4`.
- A request containing either `course` or `platform` is treated only as the new contract. Both fields are required, only `course`, `platform`, and optional string `slug` are allowed, and invalid or partial new requests cannot downgrade to legacy behavior.
- New requests resolve catalog chapters and sign their catalog-owned `mediaKey`; request text is never interpolated into a storage key.
- Unknown slugs and arbitrary paths remain rejected, and authentication still happens before parsing or signing.

The production handler was extracted behind dependency adapters so the actual request parsing, authentication, key selection, signing arguments, status, and response body are exercised together without mocking the implementation into a regex assertion.

### RED

`npm run test:learn` failed six new route-contract assertions before the production handler existed. The failures covered legacy single, legacy empty-body and `{}` batches, malformed/partial new requests, and current player/coach course paths.

### GREEN

`npm run test:learn` passed all 36 tests. Route-level coverage now includes:

- legacy single and both legacy batch forms;
- unknown legacy slug and arbitrary path rejection;
- malformed JSON, unrelated fields, partial current input, invalid types, and extra-key rejection;
- player/web batch and coach/iOS single namespaced keys;
- platform-hidden chapter rejection; and
- authentication before signing.

### Files

- `src/app/api/tutorial-url/route.ts`
- `src/app/learn/tutorialRequest.ts`
- `src/app/learn/tutorialRoute.ts`
- `src/app/learn/guides.test.ts`

## Finding 2 — YouTube import platform leakage

### Root cause and design

`upload-from-youtube` was marked visible on iOS even though the iOS Upload screen has no YouTube import control. Its relation could also survive serialization after the guide itself became hidden.

The guide is now web-only. The iOS generator filters every guide's related slugs against the visible guide set for that audience, preventing hidden destinations from leaking through related content.

### RED

`npm run test:learn` failed three new platform assertions before the correction: the iOS serialized catalog still contained the YouTube guide, player iOS relations still exposed it, and the iOS-visible guide list included it. The first implementation accidentally changed the adjacent upload guide's visibility; these failures caught that selector error immediately and it was corrected before regeneration.

### GREEN

- `npm run test:learn`: 36/36 passed; web retains the YouTube guide and search result while iOS omits its guide, search result, and relation.
- `npm run learn:ios:check`: passed with the generated catalog current.
- `LearnCatalogTests.testPlayerIOSCatalogExcludesWebOnlyYouTubeImport`: passed against the decoded bundled iOS catalog, including guide list, search, related guides, and groups.
- `rg -ni 'youtube|upload-from-youtube' ios/PongLens/PongLens/Resources/learn-catalog.json`: no matches.

### Files

- `src/app/learn/playerGuides.ts`
- `scripts/generate-ios-learn.ts`
- `ios/PongLens/PongLens/Resources/learn-catalog.json`
- `src/app/learn/guides.test.ts`
- `ios/PongLens/PongLensTests/LearnCatalogTests.swift`

## Finding 3 — tutorial load failure UX and stale playback

### Web root cause and design

The mobile layout had a generic non-actionable failure message, while desktop rendered no failure at all. Load state was spread across a URL dictionary and a separate boolean.

A small pure load-state helper now represents `loading`, `ready`, and `failed`, clearing prior URLs whenever a load starts or fails. One `TutorialLoadFailure` component is rendered inside the shared `ChapterVideo` used by both responsive layouts. It names the selected chapter and provides `Try again`. A request generation prevents stale responses from overwriting a later retry or audience change.

### iOS root cause and design

Selecting a new chapter changed the visible title before the old `AVPlayerItem` was replaced. If URL loading failed, the old item remained playable under the new title.

The iOS screen now begins a generation-tagged chapter-load request, pauses and clears the player item, and resets playback measurements before using cache or making the URL request. Only the active request may transition to ready or failed. A failure is tied to the selected chapter and provides `Try again`; transport controls appear only for a ready item. The existing actual-playback progress gate remains in the periodic time observer, and the single observer is still installed once and removed during stop.

### RED

- Web focused tests failed three new assertions before the load-state helper and shared retry wiring existed.
- The focused simulator XCTest build failed on the intentionally missing `TutorialChapterLoadState` and `resetTutorialPlayerForChapterLoad` production symbols.

### GREEN

- Web load transition/message tests and production wiring assertions pass within `npm run test:learn` (36/36).
- Exact iPhone 17 Pro/iOS 26.5 `LearnCatalogTests` passed 22/22, including stale-request isolation, retry generation, chapter-specific failure state, and a real `AVPlayer` item-clear test.
- The exact simulator application build passed.

### Files

- `src/app/learn/tutorialLoadState.ts`
- `src/app/learn/videos/VideoCourse.tsx`
- `src/app/learn/guides.test.ts`
- `ios/PongLens/PongLens/Core/LearnCatalog.swift`
- `ios/PongLens/PongLens/Screens/LearnScreen.swift`
- `ios/PongLens/PongLensTests/LearnCatalogTests.swift`

## Integrated verification

| Command | Result |
| --- | --- |
| `npm run test:learn` | 36/36 passed |
| `npm run test:coach-landing` | 2/2 passed |
| `npm run test:auth` | 25/25 passed |
| `npm run test:journal` | 56/56 passed |
| `npm run test:upload` | 24/24 passed |
| `npm run test:starred` | 11/11 passed |
| `npm run learn:ios:check` | passed; bundled catalog current |
| `npx eslint src/app/learn src/app/api/tutorial-url/route.ts src/app/dashboard/FirstSteps.tsx src/app/coaching/CoachFirstSteps.tsx scripts/generate-ios-learn.ts` | exit 0; five existing unused-destructure warnings in the generator |
| `npm run build` | production build passed |
| `xcodebuild test -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' -only-testing:PongLensTests/LearnCatalogTests` | 22/22 passed |
| `xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' CODE_SIGNING_ALLOWED=NO` | build succeeded |
| `ios/Tests/run.sh` | 648/648 checks passed |
| `git diff --check` | passed |
| Forbidden-copy scan of the bundled iOS catalog (`youtube`, YouTube slug, coming-soon/video-recording, paid-review/offer/payout terms) | no matches |

The first production build run exposed a TypeScript mismatch at the new route-to-resolver handoff. The handler now passes the explicit `course`, `platform`, and `slug` fields; the complete production build was rerun and passed.

## Warnings and remaining concerns

- `npm run build` still prints repository-level pre-existing warnings, including multiple-lockfile root inference and unrelated lint warnings. It completes successfully.
- `npm run learn:ios:check` still prints Node's existing typeless-package reparsing warning. The catalog freshness check passes.
- Focused ESLint exits successfully but reports five existing unused-destructure warnings in `scripts/generate-ios-learn.ts` from the serializer's omission pattern.
- No actual network failure was induced against R2. Failure behavior is covered at the production state/coordinator and route boundaries, and both platform builds pass.
- No tutorial media was uploaded, moved, or otherwise changed in this wave.
