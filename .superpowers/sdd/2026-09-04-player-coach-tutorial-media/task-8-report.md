# Task 8 report — narration, capture, render, and verification

Date: 2026-09-04
Starting HEAD: `9253cd32f6e0f073387e35b8d8eb8af73a684aeb`

## Result

Generated and objectively validated all 118 narration lines, captured all 17 browser flows and both native inserts, rendered all 18 player/coach tutorial chapters, and verified every final MP4. The measured durations are now in the web catalog and regenerated iOS catalog. The final MP4s remain in the ignored `scripts/demos/tutorial/out/{player,coach}/` directories for Task 9. Nothing was uploaded or published, and no TestFlight build was started.

## Narration

- Generated 64 player and 54 coach lines with the OpenAI `gpt-4o-mini-tts` model, `sage` voice, and 1.3 speed.
- Preserved the approved script text. Player Export line 1 was regenerated once to improve the `PongLens` pronunciation; the displaced take is retained outside the repository at `/tmp/ponglens-task8-audio-backup/export-l1-attempt1.mp3`.
- Source audio is mono 24 kHz and showed no clipping.
- Transcribed every final MP4 with `gpt-4o-transcribe`. Normalized word agreement was 96.6–100%; 13 of 18 transcripts were exact. The remaining differences were punctuation, compound-word, or phonetic brand-name variants, with no omitted narration.
- Probed every final audio stream: AAC, 48 kHz, stereo; peaks ranged from -17.9 to -11.9 dBFS, with no clipping. Non-silent mean levels ranged from -40.3 to -37 dBFS. Long silences were expected bookends and deliberately inserted media-repair holds.
- No human listening was available or claimed. Validation used transcription, waveform/acoustic analysis, stream inspection, and video-frame timing checks.

## Verification RED → GREEN

- Added `verify.mjs` and nine tests covering missing output, stream/codec/dimension requirements, timing, cue bounds, voice/manifest agreement, catalog titles, 60-second ceiling, and forbidden coach roadmap language.
- RED: verifier tests failed before the implementation existed. GREEN: all nine tests pass and the strict verifier passes every final output.
- RED: the native-insert timing test found the coach audio source configured to continue to 50 seconds although the measured voice track ends at 29.688 seconds. GREEN: the source end was corrected to 29.688; the complete tutorial suite passes 104/104.

## Capture and exact cleanup

All browser capture ran sequentially against the fixed demo player/student and coach accounts. Credentials were read from the macOS keychain and were never printed or persisted. Prohibited commerce, email, notification, export, and non-demo/customer actions remained blocked.

Every mutating capture used a guard snapshot and `finally` recovery. After each attempt—including failed attempts—the 13 protected database/object groups matched their exact pre-capture hashes:

| Group | Baseline hash |
| --- | --- |
| matches | `f4f31b4367b7980c3edce361498f30ae` |
| points | `298e03d324586be3b2a767aecbeb155d` |
| notes | `c2e9fde8d0db0569d38ee7fda2fbd24c` |
| coach_profiles | `ca1d3a6f496b8a8bc293bd3c9b9cace9` |
| coach_students | `70586d8485ab5cb222d22af1d14e235c` |
| coach_student_invites | `f902ae5dc6f75dc10cf642d9de8810bb` |
| coach_entries | `ea024192153352ba9fafa0daad191c72` |
| lessons | `a51f9eec5e2685b264024956acd4619e` |
| share_links | `173746bf16e754200fd272a6ed11ded2` |
| offerings | `5c8cff015f3a41b2720798a1b572aaf6` |
| review_orders | `88f62846f6040e927c2ded060e7fe2f2` |
| review_findings | `f816fc0e06aec8d8038e9ffac6012952` |
| review_attachments | `d751713988987e9331980363e24189ce` |

The guard initially omitted `scored_at_cut_s`, although winner mutation writes that field. A prior exact snapshot was recovered from the user's Trash, validated against the same match/point IDs and snapshot date, used to restore the row, and the field was added to the protected point schema with a regression test. Capture remained stopped until all hashes matched. No guard snapshot files remain. Staging is inactive, and persistent demo fixture data that predated Task 8 was preserved.

## Capture/render defects resolved

- Upload initially failed because browser readiness did not prove decoded media was usable. The flow now gates on actual decoded-media readiness.
- Viewer/Point used reload-like transitions that could collapse the intended cue. They now use the real Close/Open product controls.
- Point note/winner controls required current-label and repair-control mapping rather than positional assumptions; the tests and flows now assert the live labels.
- Point, Coach Review Match, and Coach Feedback initially exposed transient Loading states. A capture-only branded PongLens transition cover was added for media-loading windows.
- Exact-frame QA found two covers could begin 130–150 ms before the last spoken waveform ended even though the nominal narration file had not ended. A tested shared 300 ms transition margin plus explicit silent holds fixed the overlap. Covers are brief, branded, absent outside loading windows, and do not obscure narrated product actions.

## Visual QA and measured durations

All 18 outputs were inspected with full-duration contact sheets and representative full-size frames, including exact frames around native/media transitions. Final visual gate: 18/18 accepted—no blank, loading, error, privacy, workspace, caption, cue, or transition defects.

| Course | Slug | ffprobe duration | Catalog seconds |
| --- | --- | ---: | ---: |
| Player | home | 35.861333 | 36 |
| Player | upload | 40.149333 | 40 |
| Player | viewer | 40.960000 | 41 |
| Player | point | 45.397333 | 45 |
| Player | keepscore | 49.130667 | 49 |
| Player | analysis | 43.093333 | 43 |
| Player | export | 45.461333 | 45 |
| Player | coach | 44.629333 | 45 |
| Player | journal | 43.562667 | 44 |
| Coach | coach-start | 30.677333 | 31 |
| Coach | coach-add-student | 27.882667 | 28 |
| Coach | coach-connect-account | 31.893333 | 32 |
| Coach | coach-lesson-entry | 35.797333 | 36 |
| Coach | coach-audio-lesson | 32.746667 | 33 |
| Coach | coach-share-entry | 31.381333 | 31 |
| Coach | coach-review-match | 39.744000 | 40 |
| Coach | coach-feedback | 32.490667 | 32 |
| Coach | coach-paid-review | 42.389333 | 42 |

The regenerated iOS catalog contains 17 chapters: all nine player chapters and the eight eligible coach chapters. Paid Review remains web-only and no paid-review copy appears in the iOS Learn resource.

## Final verification

- Strict `verify.mjs` loop: 18/18 outputs pass; every file is 1080×1920 H.264/AAC, has positive measured duration, remains within 60 seconds, and matches its manifest/catalog/cue contract.
- `npm run test:tutorial`: 104/104 pass.
- `npm run test:learn`: 36/36 pass.
- `npm run learn:ios:check`: pass.
- Remotion `tsc --noEmit`: pass.
- `npm run build`: pass, 142 static pages; only pre-existing lint warnings.
- Focused `LearnCatalogTests` on iPhone 17 Pro / iOS 26.5: `** TEST SUCCEEDED **`. The test action also completed a local Debug iOS build. Existing Swift 6 migration warnings remain.
- `git diff --check`: pass.

## Handoff

The generated audio, raw captures, rendered MP4s, Remotion public staging, and local build caches remain ignored. The 18 verified outputs are intentionally preserved for the Task 9 dry-run/publish step. Task 8 performed no R2 PUT, did not replace any legacy flat R2 object, and did not start TestFlight.
