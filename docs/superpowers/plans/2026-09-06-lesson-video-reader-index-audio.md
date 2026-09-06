# Lesson Video Reader, Chapter Index, and Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every authorized coach or student read the complete lesson recap, jump to any chapter during playback, and control audible iOS playback.

**Architecture:** Keep the existing lesson-video API and rendered media unchanged. Add small, testable chapter presentation helpers, then use them from the existing responsive web detail/player and native SwiftUI detail/player so all surfaces consume the same stored edit and timestamps.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, SwiftUI, AVFoundation, AVPlayer, Node test runner, XCTest

**Spec:** `docs/superpowers/specs/2026-09-06-lesson-video-reader-index-audio-design.md`

## Global Constraints

- Reuse PongLens typography, colors, card, button, and sheet treatments.
- Use **Read lesson notes** as the read-only action and keep **Edit recap** owner-only.
- Keep the original recording and owner actions private from shared students.
- Mobile web and iOS action buttons fill the available width and remain at least 44px/44pt tall.
- Do not alter worker processing, chapter generation, rendered media, or retention.
- Preserve portrait, landscape, swiping, arrows, automatic chapter synchronization, URL renewal, and retry behavior.
- Run the complete Next.js production build and iOS test suite before release.

---

### Task 1: Shared chapter presentation rules

**Files:**
- Create: `src/lib/lessonVideo/presentation.ts`
- Create: `src/lib/lessonVideo/presentation.test.ts`
- Modify: `ios/PongLens/PongLens/Core/LessonVideo.swift`
- Test: `ios/PongLens/PongLensTests/LearnCatalogTests.swift`

**Interfaces:**
- Produces: `lessonChapterStart(chapters, index): number | null` for recap-time selection.
- Produces: `lessonReaderSections(edit): {number,title,cues}[]` for complete ordered notes.
- Produces: `LessonVideoChapterSelection.start(at:chapters:original:) -> Double?` with accumulated-duration fallback for recap chapters without `summary_start_s`.

- [ ] **Step 1: Write failing TypeScript tests**

Assert that `lessonReaderSections` preserves all 12 ordered chapter titles and cues, and that `lessonChapterStart` uses `summary_start_s`, falls back to accumulated preceding clip durations, and rejects an invalid index.

- [ ] **Step 2: Run the TypeScript test and observe the missing-module failure**

Run: `node --test --experimental-strip-types src/lib/lessonVideo/presentation.test.ts`

- [ ] **Step 3: Implement the TypeScript helpers**

Create pure functions over `LessonEdit` and `LessonChapter`; do not duplicate title or cue content and return `null` for an invalid chapter index.

- [ ] **Step 4: Write failing XCTest coverage**

Add tests showing recap chapter 3 uses its explicit summary time, falls back to the first two source clip durations when that time is absent, and original playback uses `start_s`.

- [ ] **Step 5: Run the focused XCTest and observe the missing-method failure**

Run `xcodebuild test` for `PongLensTests/LearnCatalogTests` on the iPhone 17 Pro simulator.

- [ ] **Step 6: Implement the Swift selection helper and rerun both focused suites**

Add `LessonVideoChapterSelection.start(at:chapters:original:)`, then require both the Node test and focused XCTest to pass.

- [ ] **Step 7: Commit**

Commit the helper and test files with message `Add lesson chapter presentation rules`.

---

### Task 2: Complete lesson reader on web and iOS

**Files:**
- Modify: `src/app/lesson-video/[id]/LessonVideoView.tsx`
- Modify: `ios/PongLens/PongLens/Screens/LessonVideoScreen.swift`
- Test: `src/lib/lessonVideo/presentation.test.ts`
- Test: `ios/PongLens/PongLensTests/LearnCatalogTests.swift`

**Interfaces:**
- Consumes: `lessonReaderSections(edit)`.
- Produces: read-only web `dialog` and native full-screen cover containing every chapter.

- [ ] **Step 1: Add failing UI contract checks**

Assert the web detail contains a **Read lesson notes** control, renders every reader section, and sends a non-owner back to `/journal`; assert the native source presents a read-only lesson-notes cover and contains no edit actions in that reader.

- [ ] **Step 2: Run the focused tests and confirm each new check fails for the absent reader**

Run the presentation Node test and focused XCTest.

- [ ] **Step 3: Implement the responsive web reader**

Replace the first-chapter preview with one full-width outlined **Read lesson notes** button above sharing. Open a full-screen mobile dialog and centered scrollable desktop dialog with title, close button, and all numbered chapters and cues. Change the shared-student back destination to `/journal`.

- [ ] **Step 4: Implement the native reader**

Replace the first chapter block with the same full-width secondary action. Present a full-screen SwiftUI reader using the existing background, fonts, spacing, and 44pt close control; render all chapters without timestamps or edit controls.

- [ ] **Step 5: Run focused tests and commit**

Require the Node test and focused XCTest to pass, then commit with message `Add complete lesson recap reader`.

---

### Task 3: Chapter index and native audio controls

**Files:**
- Modify: `src/app/lesson-video/[id]/LessonPlayback.tsx`
- Modify: `ios/PongLens/PongLens/Screens/LessonVideoScreen.swift`
- Test: `src/lib/lessonVideo/presentation.test.ts`
- Test: `ios/PongLens/PongLensTests/LearnCatalogTests.swift`

**Interfaces:**
- Consumes: `lessonChapterStart` and `LessonVideoChapterSelection.start`.
- Produces: underlined chapter-index controls and selection overlays on web/iOS.
- Produces: iOS `AVAudioSession` playback configuration and an `AVPlayer.isMuted` toggle.

- [ ] **Step 1: Add failing interaction contract checks**

Require the underlined **Chapter N of M** control, numbered chapter rows, current selection marker, index dismissal on selection, native playback audio-session category, and native mute button with changing accessibility labels.

- [ ] **Step 2: Run focused tests and confirm the contracts fail**

Run the presentation Node test and focused XCTest.

- [ ] **Step 3: Implement the web chapter index**

Turn the cyan label into an underlined button. Open an accessible overlay within the existing playback dialog, mark the current chapter, and route row selection through `choose(index)` so it closes, seeks, and resumes. Preserve the existing web speaker control and muted-autoplay fallback.

- [ ] **Step 4: Implement the native chapter index**

Turn the native label into an underlined button and present a sheet listing numbered titles with a checkmark on the current row. Route selection through `selectChapter`, use the shared fallback time helper, dismiss the index, and resume.

- [ ] **Step 5: Implement native audio**

When the takeover appears, activate `AVAudioSession` with category `.playback`, set `player.isMuted = false`, and show a 44pt top-right speaker button over the video chrome. Toggle the player and accessibility label without losing the state during URL refresh.

- [ ] **Step 6: Run focused tests and commit**

Require both focused suites to pass, then commit with message `Add lesson chapter index and audio controls`.

---

### Task 4: Full verification and release

**Files:**
- Modify: `ios/PongLens/PongLens.xcodeproj/project.pbxproj`
- Update if required: `docs/superpowers/plans/2026-09-06-lesson-video-reader-index-audio.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified production web deployment and a new TestFlight upload.

- [ ] **Step 1: Run complete automated verification**

Run the full lesson-video Node suites, `npm run lint`, `npm run build`, the complete PongLens XCTest suite, `git diff --check`, and an unsigned Release simulator build. Fix every relevant failure and rerun the affected full command.

- [ ] **Step 2: Inspect web layouts**

At 393×660 and 1280×850, use the real Jonathan recap to verify the reader contains all 12 chapters, the index selects and seeks, audio is audible/unmutable, retry remains available, and no owner-only source action appears to an authorized student fixture.

- [ ] **Step 3: Inspect native layouts**

Build and run on iPhone 17 Pro. Verify portrait and landscape playback, complete reader scrolling, chapter index selection, audio and mute state, and return navigation. Save screenshots for the release record.

- [ ] **Step 4: Prepare and push the web release**

Integrate the verified commits with current `origin/main` without dropping concurrent work, push `main`, wait for the production deployment to report Ready, and repeat the 393×660 and desktop smoke checks on `www.ponglens.com`.

- [ ] **Step 5: Archive and upload iOS**

Increment `CURRENT_PROJECT_VERSION` from the latest main value, create a signed Release archive through the established PongLens release path, upload it to App Store Connect, and record the build number Apple accepted.

- [ ] **Step 6: Report exact release state**

State the production web URL, TestFlight build number, whether Apple is still processing it, the automated checks run, the two web viewport checks, the native devices/orientations inspected, and any unverified limitation.
