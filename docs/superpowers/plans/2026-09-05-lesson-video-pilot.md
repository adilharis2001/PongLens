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
