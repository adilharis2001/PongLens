# Lesson video pilot implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Independent iOS implementation is delegated while the controller implements backend; a read-only agent checks release readiness. Do not overlap file ownership.

**Goal:** Import a 90-minute lesson, generate a private reviewed video recap, and deliver TestFlight before the lesson.
**Architecture:** Dedicated lesson-video records/API/leased portable worker; existing coaching ownership and notes reused when sharing. Native resumable multipart upload, portable ffmpeg rendering, web viewer.
**Tech Stack:** SwiftUI/AVFoundation, Next.js, Supabase, R2, Python/ffmpeg/Deepgram/OpenAI.
**Spec:** docs/superpowers/specs/2026-09-05-lesson-video-pilot-design.md

## Global constraints
- No edits to existing dirty checkout; worktree only. Native agent owns ios/ only.
- Original and summary kept indefinitely until owner deletion.
- 3 hours and 20 GiB maximum. 64 MiB multipart parts.
- No match pipeline dependency or 45-minute restriction.
- Explicit review before share; source remains private.
- Shared worker release identical on Mac/Modal; cloud disabled until parity verified.

## Task 1: Backend contract and storage (controller)
Create migrations 173–175; src/lib/lessonVideo/model.ts and tests; src/app/api/lesson-video/route.ts. Tests cover 5400 seconds, rejection beyond 10800 seconds/20GiB, clip range validation, draft-vs-shared access. Create uses server-generated ID and fixed private key. Completion verifies actual R2 size and atomically queues. Claim RPC leases queued jobs and reclaims expired processing jobs. All mutations owner checked.
- [x] Write failing validation/access tests; implement and run.
- [x] Implement migration/API and verify live SQL grants and upload recovery.

## Task 2: Native import and review (iOS agent)
Create LessonVideoStore/Screen and dedicated durable multipart uploader. Change coach chooser's pending row to video mode. Support optional student and list/detail/retry/review/share. Use file representation from Photos/files; persist local copy and multipart progress, bounded-memory 64MiB reads. Restore uploads after restart. API contract in ios-brief.md. No Xcode build-number edits until release coordinator allocates number.
- [x] Implement and compile native target; test large-file arithmetic and resume state.

## Task 3: Processing and rendering (controller)
Create worker/lesson_video.py, tests, requirements and immutable release deployment. Timestamped transcription chunks checked and persisted, evidence-based edit selection, render source clips with text panels, publish review only. Explicit failure and retry states. All paths outside age sweep prefixes.
- [x] Write timestamp/clip tests and renderer fixture; implement and run.
- [ ] Deploy same release Mac/Modal and verify parity before enabling claims.

## Task 4: Web view and integration (controller)
Create /coaching/videos page for owner listing and /lesson-video/[id] responsive viewer/editor. Link from coaching entry flows and shared lesson cards. Authenticated API handles grants. Native/Web playback text follows chapter timeline. No native controls or overlays before playback.
- [x] Build and inspect at 393x660 and desktop; test owner/student access.

## Task 5: Release verification
- [x] Independent full change review, fix load-bearing findings.
- [x] Full npm run build; native archive; 90-minute synthetic processing fixture and large-file upload path.
- [ ] Deploy web/database/worker and production smoke.
- [x] Upload TestFlight, check processing and beta group availability, tell Adil exact build and recording/import steps.

## Verification record (2026-09-05)

- Full production web build passed after incorporating main at 6dca9c99.
- Native simulator build and 660 existing checks passed; dedicated lesson tests cover 90 minutes, 20 GiB arithmetic, file-backed multipart staging, completion recovery, signed playback renewal, and stable create requests. Device archive and App Store upload subsequently passed for builds 129 and 130.
- Real provider pipeline processed a synthetic 5400.033-second source: all nine audio chunks transcribed, four evidence-selected chapters rendered, private review state reached. The repetitive fixture yielded 158 seconds, intentionally below the usual target instead of padding. This does not establish real club audio or coaching quality.
- Actual two-part R2 upload (64 MiB + 137 bytes) verified resume, missing-part refusal, final byte, idempotent create and complete, and exactly-once retained-source accounting.
- Owner/student/stranger tests verified private drafts, explicit/idempotent share, source privacy, stale edit refusal, and owner deletion.
- Web screenshots inspected at 393×660 and 1280×850; uninterrupted playback for 24 seconds across two refresh intervals passed on both. Composite export frame inspected at 1920×1080.
- Independent review findings fixed: stale multipart completion, native link renewal, stable import identity, lease-specific render keys, edit recovery, visual-frame refusal, web playback URL churn, editor revision snapshots, deletion/retry races, and upload/deletion race.
- Modal profile has no connected account. A question requesting an explicit Mac-only pilot exception is pending; no customer worker release has been activated. This is a project-rule exception, not an inferred permission requirement. Original match service is untouched.

## Follow-up verification and approved scope revisions

- Build130 replaces129: VALID and IN_BETA_TESTING confirmed at12:39UTC. Uses coach styles and removes player creation, plus latest merged allowance changes.
- Two actual signed-simulator Photos imports of5400.034seconds/40,632,268bytes completed. This caught and fixed a double-dismissal bug in the picker; no real multiGiB/background-interruption claim.
- Final native import/detail/editor/playerchooser screenshots inspected at402×874points; new web layout/player continues playing across polls at393×660 and1280×850.
- Coach-only API regression: old deployment accepted player creation (red); updated production build rejects player/stranger creation, permits coach creation, preserves shared student playback (green local integration).
- Account deletion integrated with lesson media and durable cleanup. Isolated Postgres-WASM tests verify fencing, creation/claim refusal, auth-cascade survival and24h retirement. Real account-delete route successfully removed all3isolatedQAaccounts and their lesson objects; repeated sweep/marker acknowledgements verified.
- Supplied real file Adam Hugh Lesson.MOV:2442.138345seconds,2,686,375,772bytes,1080pHEVC HLG. All41multipart parts uploaded privately to the user's coaching account. Original local file unchanged.
- Actual HDR excerpts pass frame extraction, both H264/yuv420pBT709 outputs with audio, exact duration and full decode. Final Mac binary is separate ffmpeg-full9.0.1_1 with zscale; match binary path unchanged.
- Real audio exposed Deepgram empty results. Timestamped OpenAI fallback recovered211words from60seconds; legacy sparse checkpoints retry viaASRversion2. Full private lesson retry completed: six chapters, 376.984 seconds, private review. Both video and audio decode without errors; all six chapter layouts inspected. Original audio remains quiet with the distant microphone; no claim of denoising or full listening review.
- Exact TestFlight archive/export logs and QA reports are under/tmp/ponglens-lesson-*. No automatic worker service activation yet; pending Mac-only exception remains.

- Production deployment 71cc2a94 includes c1b258c7 and is READY. Actual owner authenticated lesson GET returned 200 with source, recap and playback grants. Source and recap retained privately; no student share performed.
- Real recap exported to /tmp/ponglens-adam-hugh-recap.mp4 and opened for user review. Full composite decode passed, H264/BT709 1920×1080 with AAC audio, 377.011224 seconds including container timing.

## Context rewrite verification

- Added a source-grounded text pass after footage selection. Selected speech stays separate from surrounding context; only titles/cues change. Raw lengths validate before normalization, so conditions cannot be silently truncated. Sixteen relevant tests pass, including unchanged footage, context across clip boundaries, panel retry, and preserving an overlong trailing exception.
- Full npm run build exits 0 (compile, type checking, generation complete). Embedded ESLint still reports the existing eslint-config-next/Rushstack configuration failure; lint is not claimed passed.
- Real lesson rewrite was generated then editorially corrected against its noisy transcript and independently reviewed. Important corrections retained emergency-only arm recovery, avoided misreading a long shot as incoming depth, and kept the close-attempt condition for retrying an opening. This is not evidence that unreviewed model output is reliable; coach review remains required.
- User-authorized targeted rerender completed as revision 2 under the same manual student, private review state, with source and footage boundaries retained. Six updated chapter frames inspected; complete video/audio decode passed; duration 377.011224 seconds including container timing; live owner API returned the revised text and media grants.
- Sealed worker release lesson-video-403199d1c96253b3 used for this private rerender. Automatic processing and cloud promotion remain disabled pending the earlier project-rule exception/Modal connection. No native change or new TestFlight build needed for revised media.

## Viewer consistency and playback verification

- Replaced the separate web lesson transport with the existing ClipPlayer controls and optional saved poster. Added authenticated private poster grants; generated the current lesson's preview without changing its text, footage or revision. Worker writes poster before publishing future renders; sealed release lesson-video-e566095130d65944 installed for targeted use only.
- Mobile web keeps the player and compact chapter picker together while scrolling. Desktop retains footage beside the active chapter. Both show only active reminders; stored full themes are retained but no longer duplicated in this viewer. Share/Edit are grouped, with source/export/delete in More. Empty student sections show one import action.
- Native uses the existing PL typography/cards/buttons, saved preview and obvious Play affordance, one active chapter panel, nearby chapter picker and scroll-to-player on selection. Reopen refreshes current revision; playback drives chapter selection. More contains source/export/delete. Larry's empty section has only Import.
- Full npm run build exits0; embedded lint retains the previously documented eslint-config-next/Rushstack configuration failure. Signed simulator build and lesson regression suite passed. Poster JPEG fixture and context/release tests passed.
- Authenticated local and production browser QA at393x660 and1280x850 verified poster HTTP200/JPEG, first Play, chapter6 seek with player fully within viewport, stable element/source and continuing playback across two polling intervals, edit/delete cancellation, export visibility, and Larry one-action empty state. Production unauthenticated lesson GET401.
- Simulator QA at402x874points verified initial poster, first play, chapter4 seek, automatic advance to5, latest revision2 on reopen, More menu and Larry empty state. No student sharing, source deletion, or lesson text edits performed during UI QA. Native commit ff277c95; web/API aec4ca9e deployed before live checks. Build133 archive/export uploaded successfully; release report tracks Apple availability.

## Dedicated lesson playback follow-up

User chose a dedicated Play takeover, with video above synchronized swipeable notes on phones and beside notes on desktop. Detail pages keep review status near the title, one full-width Share action, and Edit in More. This supersedes the inline chapter picker layout above. No media reprocessing or sharing is part of this UI change.

- Web now mounts one player in an accessible full-screen dialog. Horizontal chapter pages seek only on user selection; clock-driven updates move the notes without seeking backward. Closing pauses the actual video and reopening resumes its position. Mobile at393×660 displays the full-width16:9video and both first-chapter reminders together.
- Browser regression first failed because Play did not open a dedicated dialog; the new flow passes at393×660 and1280×850. Verified chapter selection, scroll paging, automatic chapter4→5transition,21seconds across polling, close/pause/resume, full-width sharing and More→Edit cancellation. Real CDP touch swipe1→2 seeks to65.57seconds.
- Review identified final-frame chapter reset, retry-position loss, and source renewal resetting playback. Browser regression reproduced renewal resetting196.48secondsto0 before the fix. Updated code preserves the playback position and final chapter; forced bad-source/retry and fresh-URL tests pass on mobile and desktop. API responses were intercepted in the test browser only; no lesson record or media was changed.
- Full npm run build exits0, including compilation, complete type checking and page generation. Embedded ESLint retains the existing eslint-config-next/Rushstack configuration failure; lint is not claimed passed.
