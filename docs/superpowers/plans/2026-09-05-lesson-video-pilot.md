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
Create migration 172_lesson_video.sql; src/lib/lessonVideo/model.ts and tests; src/app/api/lesson-video/route.ts. Tests cover 5400 seconds, rejection beyond 10800 seconds/20GiB, clip range validation, draft-vs-shared access. Create uses server-generated ID and fixed private key. Completion verifies actual R2 size and atomically queues. Claim RPC leases queued jobs and reclaims expired processing jobs. All mutations owner checked.
- [ ] Write failing validation/access tests; implement and run.
- [ ] Implement migration/API and verify live SQL grants and upload recovery.

## Task 2: Native import and review (iOS agent)
Create LessonVideoStore/Screen and dedicated durable multipart uploader. Change coach chooser's pending row to video mode. Support optional student and list/detail/retry/review/share. Use file representation from Photos/files; persist local copy and multipart progress, bounded-memory 64MiB reads. Restore uploads after restart. API contract in ios-brief.md. No Xcode build-number edits until release coordinator allocates number.
- [ ] Implement and compile native target; test large-file arithmetic and resume state.

## Task 3: Processing and rendering (controller)
Create worker/lesson_video.py, tests, requirements and immutable release deployment. Timestamped transcription chunks checked and persisted, evidence-based edit selection, render source clips with text panels, publish review only. Explicit failure and retry states. All paths outside age sweep prefixes.
- [ ] Write timestamp/clip tests and renderer fixture; implement and run.
- [ ] Deploy same release Mac/Modal and verify parity before enabling claims.

## Task 4: Web view and integration (controller)
Create /coaching/videos page for owner listing and /lesson-video/[id] responsive viewer/editor. Link from coaching entry flows and shared lesson cards. Authenticated API handles grants. Native/Web playback text follows chapter timeline. No native controls or overlays before playback.
- [ ] Build and inspect at 393x660 and desktop; test owner/student access.

## Task 5: Release verification
- [ ] Independent full change review, fix load-bearing findings.
- [ ] Full npm run build; native archive; 90-minute synthetic processing fixture and large-file upload path.
- [ ] Deploy web/database/worker and production smoke.
- [ ] Upload TestFlight, check processing and beta group availability, tell Adil exact build and recording/import steps.
