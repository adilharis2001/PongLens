# Player and Coach Tutorial Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Produce, verify, and publish the refreshed nine-chapter player course and the new nine-chapter coach course using the established PongLens tutorial style.

**Architecture:** The application Learn catalog is the chapter manifest. The existing narration-first Playwright and Remotion pipeline becomes course-aware, with player and coach inputs and generated outputs isolated by directory. Browser flows capture real staged product state with cleanup guards; two debug-only simulator scenarios provide real iOS UI footage that the same Remotion composition inserts into the matching chapters.

**Tech Stack:** Node.js, Playwright, OpenAI audio speech API with Sage voice, Remotion, ffmpeg/ffprobe, Supabase staging data, xcodebuild, simctl, SwiftUI, Cloudflare R2.

**Spec:** docs/superpowers/specs/2026-09-04-role-aware-learn-and-tutorials-design.md

## Global Constraints

- Coach and player chapters use the existing voice direction, device frame, captions, bookends, annotations, and visual tokens.
- Every chapter teaches one job and targets roughly 35 to 55 seconds; shorten narration rather than speeding the voice or crowding actions.
- Coach lesson recording is audio only. No frame, caption, annotation, filename, or narration mentions video lesson recording or a future recording mode.
- Paid match reviews appear only in the web coach chapter set.
- Native inserts come from the real iOS app using debug-only deterministic state; no mock screen is presented as a working product screen.
- Every capture that mutates staged data restores it in finally, including interrupted-run recovery.
- Generated audio, raw captures, and rendered MP4 files remain ignored; only manifests, flows, timing metadata, and pipeline source are committed.
- Publish only verified files to tutorial/player and tutorial/coach. Do not delete the old flat tutorial objects in this work.

## File map

- Create scripts/demos/tutorial/course-paths.mjs for validated course/slug paths.
- Create scripts/demos/tutorial/course-paths.test.mjs for collision and traversal tests.
- Modify scripts/demos/tutorial/capture.mjs, tts.mjs, render-b.mjs, probe.mjs, publish.mjs, and guard.mjs for course-aware inputs.
- Move tracked player chapter JSON to scripts/demos/tutorial/chapters/player/.
- Add coach chapter JSON under scripts/demos/tutorial/chapters/coach/.
- Move tracked player flows to scripts/demos/tutorial/flows/player/ and add coach flows under flows/coach/.
- Move tracked timing metadata to scripts/demos/tutorial/voice/player/ and generate voice/coach/.
- Update scripts/demos/tutorial/SCRIPT.md to the approved two-course scripts and exact production commands.
- Create scripts/demos/tutorial/verify.mjs for metadata, duration, dimensions, cue, and forbidden-copy checks.
- Create scripts/demos/tutorial/capture-ios.mjs for simulator build, launch, and recording.
- Create scripts/demos/tutorial/native-inserts.json for time-bounded native footage placement.
- Modify the Remotion Chapter composition to support native inserts through the same device frame.
- Create ios/PongLens/PongLens/Core/TutorialCaptureScenario.swift for debug-only deterministic states.
- Modify Router.swift, RootView.swift, RecordScreen.swift, and LessonRecordScreen.swift only where needed to expose those real screens to capture.
- Update src/app/learn/tutorialChapters.ts with final measured durations after verified renders.

---

### Task 1: Course-aware paths and pipeline test command

**Files:**
- Create: scripts/demos/tutorial/course-paths.mjs
- Create: scripts/demos/tutorial/course-paths.test.mjs
- Modify: package.json

**Interfaces:**
- Produces: parseChapterRef(course, slug), chapterPaths(root, course, slug), catalogChapters(course, platform).
- Consumes: visibleChapters from src/app/learn/catalog.ts through Node experimental type stripping.

- [ ] **Step 1: Write failing path tests**

Test these exact outcomes:

~~~js
assert.equal(parseChapterRef("player", "home").id, "player/home");
assert.equal(parseChapterRef("coach", "coach-start").id, "coach/coach-start");
assert.throws(() => parseChapterRef("../coach", "home"), /course/);
assert.throws(() => parseChapterRef("player", "../../secret"), /slug/);
assert.notEqual(
  chapterPaths(root, "player", "home").output,
  chapterPaths(root, "coach", "home").output,
);
~~~

Also assert every catalog chapter has a unique course/slug pair and its mediaKey exactly equals tutorial/<course>/<slug>.mp4.

- [ ] **Step 2: Run the test and verify failure**

Run:

~~~bash
node --test --experimental-strip-types scripts/demos/tutorial/course-paths.test.mjs
~~~

Expected: FAIL because course-paths.mjs does not exist.

- [ ] **Step 3: Implement validated paths**

Accept only player or coach and slugs matching lowercase letters, digits, and hyphens. Return these paths:

~~~js
{
  chapter: path.join(root, "chapters", course, slug + ".json"),
  flow: path.join(root, "flows", course, slug + ".mjs"),
  voice: path.join(root, "voice", course, slug + ".json"),
  audio: path.join(root, "audio", course, slug),
  rawVideo: path.join(root, "raw", course, "tut-" + slug + ".mp4"),
  rawCues: path.join(root, "raw", course, "tut-" + slug + ".cues.json"),
  output: path.join(root, "out", course, slug + ".mp4"),
}
~~~

catalogChapters imports the application catalog and refuses a course/slug pair not present for the requested platform.

- [ ] **Step 4: Add the test script**

Add:

~~~json
"test:tutorial": "node --test --experimental-strip-types scripts/demos/tutorial/*.test.mjs"
~~~

- [ ] **Step 5: Run tests and commit**

Run:

~~~bash
npm run test:tutorial
npm run test:learn
~~~

Expected: PASS.

Commit:

~~~bash
git add package.json scripts/demos/tutorial/course-paths.mjs scripts/demos/tutorial/course-paths.test.mjs
git commit -m "test: define course-aware tutorial paths"
~~~

### Task 2: Namespace the existing player pipeline

**Files:**
- Move: scripts/demos/tutorial/chapters/*.json to chapters/player/*.json
- Move: scripts/demos/tutorial/flows/{home,upload,viewer,point,keepscore,analysis,export,coach,journal}.mjs to flows/player/
- Move: scripts/demos/tutorial/voice/*.json to voice/player/
- Modify: scripts/demos/tutorial/capture.mjs
- Modify: scripts/demos/tutorial/tts.mjs
- Modify: scripts/demos/tutorial/render-b.mjs
- Modify: scripts/demos/tutorial/probe.mjs
- Modify: scripts/demos/tutorial/guard.mjs
- Test: scripts/demos/tutorial/course-paths.test.mjs

**Interfaces:**
- Consumes: chapterPaths(root, course, slug).
- Produces CLI forms capture.mjs <course> <slug>, tts.mjs <course> <slug> [--reuse], render-b.mjs <course> <slug>, and probe.mjs <course> <account> <path> [steps].

- [ ] **Step 1: Add failing CLI parser tests**

Export pure parse functions from each driver. Assert missing course, invalid course, unknown catalog slug, and extra positional arguments fail with a usage error before credentials or filesystem state are read.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:tutorial

Expected: FAIL because the drivers still accept one flat chapter argument.

- [ ] **Step 3: Move tracked player source files**

Use git mv so history follows the files. Keep account.mjs at flows/account.mjs because both course folders import it. Update relative imports in all moved flows.

- [ ] **Step 4: Make every driver consume chapterPaths**

Create parent directories recursively, but never flatten course and slug into an unchecked path. capture.mjs writes under raw/<course>; tts.mjs writes audio and timing under course directories; render-b.mjs stages and renders out/<course>/<slug>.mp4. Keep the existing narration-measured clock and cue-coordinate behavior unchanged.

- [ ] **Step 5: Make guard snapshots course-aware**

Snapshot files live under raw/<course>/<slug>-guard.json. Recovery requires the same course and slug. Preserve all existing point, tag, note, and upload cleanup behavior.

- [ ] **Step 6: Run one no-network parser check and commit**

Run:

~~~bash
npm run test:tutorial
node --experimental-strip-types scripts/demos/tutorial/capture.mjs invalid home
~~~

Expected: tests PASS and the invalid command exits nonzero with a usage error before asking for SERVICE_KEY.

Commit:

~~~bash
git add scripts/demos/tutorial
git commit -m "refactor: namespace tutorial assets by course"
~~~

### Task 3: Commit the approved player and coach narration manifests

**Files:**
- Modify: scripts/demos/tutorial/chapters/player/*.json
- Create: scripts/demos/tutorial/chapters/coach/*.json
- Modify: scripts/demos/tutorial/SCRIPT.md
- Create: scripts/demos/tutorial/narration.test.mjs

**Interfaces:**
- Consumes: exact narration in the spec sections Player tutorial course and Coach tutorial course.
- Produces: eighteen chapter JSON manifests with chapter, title, subtitle, voice, speed, instructions, and lines.

- [ ] **Step 1: Write failing narration tests**

For every visible catalog chapter, require one JSON file. Assert:

~~~js
assert.equal(script.voice, "sage");
assert.equal(script.speed, 1.3);
assert.match(script.instructions, /Warm and plain spoken/);
assert.equal(script.title, catalogChapter.title);
assert.ok(script.lines.length >= 5);
assert.ok(script.lines.every((line) => line.id && line.text && line.beat));
~~~

Scan all coach JSON text case-insensitively and fail on coming soon, video lesson, video recording, or record video. Assert coach-paid-reviews exists only under chapters/coach and is excluded from the iOS-visible catalog.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:tutorial

Expected: FAIL listing the missing coach manifests and stale player lines.

- [ ] **Step 3: Replace the player narration**

Enter the exact nine approved player scripts from the spec without paraphrasing. Use subtitles Chapter 1 of 9 through Chapter 9 of 9. Keep the established Sage direction and speed. Preserve stable beat identifiers where the old visual beat still matches; name new beats after the control or state they show.

- [ ] **Step 4: Add the coach narration**

Enter the exact nine approved coach scripts from the spec without paraphrasing. Use subtitles Chapter 1 of 9 through Chapter 9 of 9. The audio lesson chapter says audio and iPhone exactly as approved. The paid-review chapter is explicitly marked web-only in its manifest metadata.

- [ ] **Step 5: Rewrite the production script document**

SCRIPT.md contains the two ordered course tables, the verbatim narration, account environment variables, mutation notes, capture commands, native-insert commands, render commands, verification commands, and publish commands. Remove the obsolete six-chapter tour and twelve-chapter-library description.

- [ ] **Step 6: Run tests and commit**

Run:

~~~bash
npm run test:tutorial
rg -ni "coming soon|video lesson|video recording|record video" scripts/demos/tutorial/chapters/coach
~~~

Expected: tests PASS and rg returns no matches.

Commit:

~~~bash
git add scripts/demos/tutorial/chapters scripts/demos/tutorial/SCRIPT.md scripts/demos/tutorial/narration.test.mjs
git commit -m "content: script player and coach tutorial courses"
~~~

### Task 4: Add guarded coach browser flows

**Files:**
- Create: scripts/demos/tutorial/flows/coach/coach-start.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-add-student.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-connect-account.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-lesson-entry.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-share-entry.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-review-match.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-feedback.mjs
- Create: scripts/demos/tutorial/flows/coach/coach-paid-reviews.mjs
- Modify: scripts/demos/tutorial/guard.mjs
- Modify: scripts/demos/stage_coach.sql
- Create: scripts/demos/tutorial/coach-flows.test.mjs

**Interfaces:**
- Each flow exports account, optional guard, and run(page, clock, helpers).
- Consumes: TUTORIAL_COACH and TUTORIAL_STUDENT from flows/account.mjs.
- Produces: one continuous real-product capture aligned to the manifest beat IDs.

- [ ] **Step 1: Write failing structural flow tests**

For the eight browser coach chapters, import each flow and assert every narration beat has a flow timing call, every selector has aria, text, or scoped element intent, and mutating flows declare guard tables. coach-audio-lesson is excluded because Task 6 captures it natively.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:tutorial

Expected: FAIL listing all missing coach flows.

- [ ] **Step 3: Extend staged coach data**

stage_coach.sql must guarantee a coach profile, at least two roster students including one connected and one offline, an accepted link with shared-match access, a shareable lesson entry, a shared match with scored points and placement data, existing point and overall feedback, one offering, and one accepted review order. Use stable marker text prefixed Tutorial fixture so cleanup and reruns target only tutorial-owned rows.

- [ ] **Step 4: Extend guard coverage**

Snapshot and restore coach_students, coach_student_invites, coach_entries, coach_entry_lessons, coach_entry_links, coach_entry_photos, notes, note_drawings, coach_profiles, offerings, review_orders, review_findings, and review_attachments when a flow touches them. Restoration deletes tutorial-created rows and restores changed fields on pre-existing rows in reverse foreign-key order.

- [ ] **Step 5: Implement read-mostly flows**

Drive the exact screens and actions named by each narration beat. Where narration explains creating, sharing, accepting, or delivering, use the staged completed state unless the interaction itself must be shown. Do not create a charge, payout, export job, or customer-visible notification during capture.

- [ ] **Step 6: Prove cleanup on success and failure**

Add a test guard adapter with in-memory rows. Run one flow to completion and one flow that throws mid-beat; assert both restore the snapshot and remove rows carrying the Tutorial fixture marker.

- [ ] **Step 7: Run tests and commit**

Run:

~~~bash
npm run test:tutorial
node --test scripts/demos/landing/flows/coach.test.mjs
~~~

Expected: PASS.

Commit:

~~~bash
git add scripts/demos/stage_coach.sql scripts/demos/tutorial/flows scripts/demos/tutorial/guard.mjs scripts/demos/tutorial/coach-flows.test.mjs
git commit -m "feat: capture guarded coach tutorial flows"
~~~

### Task 5: Refresh the changed player capture flows

**Files:**
- Modify: scripts/demos/tutorial/flows/player/home.mjs
- Modify: scripts/demos/tutorial/flows/player/upload.mjs
- Modify: scripts/demos/tutorial/flows/player/viewer.mjs
- Modify: scripts/demos/tutorial/flows/player/point.mjs
- Modify: scripts/demos/tutorial/flows/player/keepscore.mjs
- Modify: scripts/demos/tutorial/flows/player/analysis.mjs
- Modify: scripts/demos/tutorial/flows/player/export.mjs
- Modify: scripts/demos/tutorial/flows/player/coach.mjs
- Modify: scripts/demos/tutorial/flows/player/journal.mjs
- Create: scripts/demos/tutorial/player-flows.test.mjs

**Interfaces:**
- Consumes: refreshed player manifests and existing demo match fixtures.
- Produces: capture beats for the nine chapter course, with player/upload and player/coach mutation guards.

- [ ] **Step 1: Add failing beat-coverage tests**

Load all nine manifests and flows. Assert every line beat is scheduled exactly once, all expected chapter slugs match the Learn catalog, and each mutating flow declares a guard.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:tutorial

Expected: FAIL because the old flows do not cover new highlights, Original, missed-rally, placement request, coach entries, and Ask/Recollect beats.

- [ ] **Step 3: Update each flow against current controls**

Capture current Home, upload choice and YouTube entry, middle replay and Original, scoring and clip repair, verified Score Keeper labels, placement generation/retry, automatic highlights plus exports, coach access and shared entries, and Journal photo/scan/Ask/Recollect. Use the browser for cross-platform portions; Task 6 inserts native recording footage into player/upload.

- [ ] **Step 4: Verify selectors with probe**

For every new selector, run probe.mjs against the staged route before capture and record the stable aria label or scoped text in the flow. Do not retain guessed pixel coordinates when the cue can follow a DOM element.

- [ ] **Step 5: Run tests and commit**

Run:

~~~bash
npm run test:tutorial
npm run test:learn
~~~

Expected: PASS.

Commit:

~~~bash
git add scripts/demos/tutorial/flows/player scripts/demos/tutorial/player-flows.test.mjs
git commit -m "feat: refresh player tutorial capture flows"
~~~

### Task 6: Add debug-only real iOS capture scenarios

**Files:**
- Create: ios/PongLens/PongLens/Core/TutorialCaptureScenario.swift
- Modify: ios/PongLens/PongLens/App/Router.swift
- Modify: ios/PongLens/PongLens/App/RootView.swift
- Modify: ios/PongLens/PongLens/Screens/RecordScreen.swift
- Modify: ios/PongLens/PongLens/Screens/LessonRecordScreen.swift
- Modify: ios/PongLens/PongLensTests/LearnCatalogTests.swift

**Interfaces:**
- Produces DEBUG-only TutorialCaptureScenario values playerRecord and coachAudioLesson.
- Consumes launch arguments --tutorial-capture player-record and --tutorial-capture coach-audio-lesson.
- Produces deterministic real-view phase timing without writing customer or staged database data.

- [ ] **Step 1: Add failing launch-argument tests**

Test parsing exact valid values, ignoring missing values, and rejecting any unknown value. Assert the type and all scenario-only view branches are enclosed by #if DEBUG.

- [ ] **Step 2: Run tests and verify failure**

Run the LearnCatalogTests xcodebuild command from the product plan.

Expected: FAIL because TutorialCaptureScenario does not exist.

- [ ] **Step 3: Reuse the current player recorder entry**

playerRecord opens the real RecordScreen through Router. It supplies the existing SimulatorViewfinder footage and deterministic display values for match/practice selection, camera alignment, spoken-score option, recording timer, pause, and finish handoff. It does not create a match or upload.

- [ ] **Step 4: Drive the real audio lesson screen through deterministic states**

coachAudioLesson opens LessonRecordScreen in coach mode. Add a DEBUG-only capture controller that advances the existing real view through ready, recording, paused, writing-up, and review states. Feed the review UI a fixed transcript and LessonTakeaways value through an injected capture state; do not replace the screen with a mock and do not call Supabase save.

The fixed transcript describes an ordinary table-tennis lesson and contains no personal data. The visible title remains Audio record a lesson or Record a lesson according to the shipping screen.

- [ ] **Step 5: Prove release builds exclude the hooks**

Run:

~~~bash
xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -configuration Debug -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" CODE_SIGNING_ALLOWED=NO
xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -configuration Release -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO
~~~

Expected: both PASS; the Release compilation has no reference to TutorialCaptureScenario.

- [ ] **Step 6: Commit**

~~~bash
git add ios/PongLens
git commit -m "feat: add debug-only native tutorial capture states"
~~~

### Task 7: Capture and compose native iOS inserts

**Files:**
- Create: scripts/demos/tutorial/capture-ios.mjs
- Create: scripts/demos/tutorial/native-inserts.json
- Modify: scripts/demos/tutorial/render-b.mjs
- Modify: scripts/demos/tutorial/remotion/src/Chapter.tsx
- Modify: scripts/demos/tutorial/remotion/src/Root.tsx
- Modify: scripts/demos/tutorial/remotion/src/inserts.json
- Create: scripts/demos/tutorial/native-inserts.test.mjs

**Interfaces:**
- Produces raw/native/player-record.mp4 and raw/native/coach-audio-lesson.mp4.
- Produces raw/coach/tut-coach-audio-lesson.mp4 plus an empty validated cue
  track by promoting the native audio-lesson capture to the chapter source.
- Produces insert records { course, chapter, source, start, end, at } consumed by Chapter.tsx.

- [ ] **Step 1: Write failing insert tests**

Assert every insert references a catalog chapter, has end greater than start, lies inside its narration duration, references a file under raw/native, and never targets coach-paid-reviews. Assert native source dimensions are discoverable before render.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:tutorial

Expected: FAIL because capture-ios.mjs and native-inserts.json do not exist.

- [ ] **Step 3: Implement simulator capture**

capture-ios.mjs accepts player-record or coach-audio-lesson. It:

1. builds Debug for simulator id E62D60DD-6664-4C19-ADBE-ECF1A67E0047;
2. boots the simulator if needed;
3. installs the built PongLens.app;
4. mints a tutorial-account token hash using SERVICE_KEY;
5. launches com.ponglens.PongLens with --dev-token-hash and the scenario arguments;
6. waits for the deterministic scenario readiness marker in simctl spawn log output;
7. records with xcrun simctl io <id> recordVideo;
8. terminates after the manifest duration; and
9. always terminates the app and recorder process in finally.

Write only ignored raw/native output.

- [ ] **Step 4: Add insert composition**

For player/upload, stage player-record.mp4 beside chapter.mp4 and render it
inside the existing SCREEN_X, SCREEN_Y, SCREEN_W, and SCREEN_H device geometry
during its insert interval. For coach/coach-audio-lesson, copy the native clip
to raw/coach/tut-coach-audio-lesson.mp4 and write the standard cue JSON shape
with an empty cues array and the captured duration. Captions, header, progress,
bookends, and narration audio remain unchanged. Native clips are muted.

- [ ] **Step 5: Capture and inspect both native clips**

Run:

~~~bash
SERVICE_KEY="$(security find-generic-password -a openclaw -s ponglens-service-role -w)" node --experimental-strip-types scripts/demos/tutorial/capture-ios.mjs player-record
SERVICE_KEY="$(security find-generic-password -a openclaw -s ponglens-service-role -w)" node --experimental-strip-types scripts/demos/tutorial/capture-ios.mjs coach-audio-lesson
ffprobe -v error -show_entries stream=width,height,duration -of json scripts/demos/tutorial/raw/native/player-record.mp4
ffprobe -v error -show_entries stream=width,height,duration -of json scripts/demos/tutorial/raw/native/coach-audio-lesson.mp4
~~~

Expected: both files are portrait, non-empty, and show only the real app UI.

- [ ] **Step 6: Run tests and commit**

Run: npm run test:tutorial

Expected: PASS.

Commit:

~~~bash
git add scripts/demos/tutorial/capture-ios.mjs scripts/demos/tutorial/native-inserts.json scripts/demos/tutorial/native-inserts.test.mjs scripts/demos/tutorial/render-b.mjs scripts/demos/tutorial/remotion/src
git commit -m "feat: compose native iOS tutorial footage"
~~~

### Task 8: Generate narration, capture, render, and verify all chapters

**Files:**
- Modify/generated and commit: scripts/demos/tutorial/voice/player/*.json
- Generate and commit: scripts/demos/tutorial/voice/coach/*.json
- Create: scripts/demos/tutorial/verify.mjs
- Generated but ignored: scripts/demos/tutorial/audio/, raw/, out/
- Modify after measurement: src/app/learn/tutorialChapters.ts
- Regenerate: ios/PongLens/PongLens/Resources/learn-catalog.json

**Interfaces:**
- Consumes: eighteen manifests, seventeen browser flows, two native inserts, and the catalog.
- Produces: eighteen verified MP4 files and measured duration metadata.

- [ ] **Step 1: Implement verification before spending capture time**

verify.mjs <course> <slug> checks:

- MP4 exists and ffprobe reports 1080 by 1920, H.264 video, AAC audio, and positive duration.
- duration differs from voice timing plus bookends by no more than 0.25 seconds.
- every cue rectangle remains inside the 390 by 844 source viewport for its full interval.
- voice line text matches the chapter manifest.
- chapter title matches the Learn catalog.
- output duration is at most 60 seconds.
- coach outputs and captions contain no forbidden recording-roadmap phrases.

It exits nonzero with the course/slug and failed condition.

- [ ] **Step 2: Generate and listen to narration one course at a time**

For each player then coach chapter:

~~~bash
node --experimental-strip-types scripts/demos/tutorial/tts.mjs <course> <slug> --reuse
~~~

Listen to every regenerated line. Confirm names, iPhone, AI, 2x, 0.25x, R2-independent product terms, and table-tennis vocabulary are pronounced correctly. If a chapter exceeds its pacing budget, shorten only by returning to the approved meaning and record the final text in both the manifest and spec amendment.

- [ ] **Step 3: Capture browser chapters**

With the local app running and staged data loaded, run capture.mjs for all nine player chapters and the eight browser coach chapters. Use TUTORIAL_ACCOUNT, TUTORIAL_COACH, TUTORIAL_STUDENT, and SERVICE_KEY from the shell/keychain. After each mutating capture, run guard recovery and confirm the staged row counts match the pre-capture snapshot.

- [ ] **Step 4: Render and verify each chapter**

For every chapter:

~~~bash
node --experimental-strip-types scripts/demos/tutorial/render-b.mjs <course> <slug>
node --experimental-strip-types scripts/demos/tutorial/verify.mjs <course> <slug>
~~~

Watch each output from first frame through outro. Check audio timing, caption accuracy, no blank/loading frames, cue targets, touch markers, workspace identity, privacy, and the native insert transition.

- [ ] **Step 5: Write measured durations back to the catalog**

Round ffprobe duration to the nearest whole second and update the matching TutorialChapter.seconds. Run npm run learn:ios so the iOS course metadata matches. Do not estimate any final duration.

- [ ] **Step 6: Run automated checks and commit source metadata**

Run:

~~~bash
npm run test:tutorial
npm run test:learn
npm run learn:ios:check
git diff --check
~~~

Expected: PASS.

Commit:

~~~bash
git add scripts/demos/tutorial/voice scripts/demos/tutorial/verify.mjs scripts/demos/tutorial/chapters src/app/learn/tutorialChapters.ts ios/PongLens/PongLens/Resources/learn-catalog.json
git commit -m "media: render verified player and coach tutorials"
~~~

### Task 9: Publish safely and verify playback in both apps

**Files:**
- Modify: scripts/demos/tutorial/publish.mjs
- Modify: scripts/demos/tutorial/SCRIPT.md
- Test: scripts/demos/tutorial/course-paths.test.mjs

**Interfaces:**
- Consumes: verified out/<course>/<slug>.mp4 files and catalog mediaKey values.
- Produces: R2 objects at tutorial/player/<slug>.mp4 and tutorial/coach/<slug>.mp4.

- [ ] **Step 1: Add failing publish-selection tests**

Extract publishPlan(course, platform). Assert player/web returns nine new keys, coach/web returns nine, coach/ios returns eight, every source file is inside out/<course>, and no request-provided string is concatenated into an R2 key.

- [ ] **Step 2: Run tests and verify failure**

Run: npm run test:tutorial

Expected: FAIL because publishPlan does not exist.

- [ ] **Step 3: Make publishing explicit and verifiable**

publish.mjs accepts --course player or --course coach and --dry-run. It gets keys from the catalog, refuses any unverified file, uploads with video/mp4 and the existing cache policy, then performs HEAD and compares Content-Length. It never deletes or overwrites a key outside tutorial/player or tutorial/coach.

- [ ] **Step 4: Dry-run both courses**

Run:

~~~bash
node --experimental-strip-types scripts/demos/tutorial/publish.mjs --course player --dry-run
node --experimental-strip-types scripts/demos/tutorial/publish.mjs --course coach --dry-run
~~~

Expected: exactly eighteen source-to-key mappings with no missing file.

- [ ] **Step 5: Publish and verify R2**

Run the same commands without --dry-run. Confirm every PUT succeeds and every HEAD size matches. Leave flat tutorial/<slug>.mp4 objects untouched.

- [ ] **Step 6: Verify application playback**

On web, play every player and coach chapter through the signed endpoint. On iOS, play all nine player chapters and all eight coach chapters, rotate during playback, use previous/next, open the chapter sheet, and confirm no paid-review title or URL request appears.

- [ ] **Step 7: Run final checks and commit**

Run:

~~~bash
npm run test:tutorial
npm run test:learn
npm run learn:ios:check
npm run build
xcodebuild build -project ios/PongLens/PongLens.xcodeproj -scheme PongLens -destination "platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5" CODE_SIGNING_ALLOWED=NO
git diff --check
~~~

Expected: PASS.

Commit:

~~~bash
git add scripts/demos/tutorial/publish.mjs scripts/demos/tutorial/SCRIPT.md scripts/demos/tutorial/course-paths.test.mjs
git commit -m "media: publish role-aware tutorial courses"
~~~
