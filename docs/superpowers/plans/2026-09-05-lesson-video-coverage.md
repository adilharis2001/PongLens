# Lesson recap coverage

Approved: preserve the complete teaching outline before selecting footage; use the audio-lesson summary approach without turning uncertain words into confident technical instructions. A teaching-rich 90-minute lesson can have 10–14 chapters and 9–12 minutes, with fewer when evidence is limited. Hard safety bounds: 16 chapters, 15 minutes total, two minutes per clip. Do not manufacture chapters to hit a count.

Implemented on codex/lesson-video-coverage:
- Extract all distinct supported teaching in each window and consider up to six candidate clips instead of two.
- Merge the section teaching into a complete outline before arranging clips; preserve that outline independently of clip selection.
- Keep source ranges exact and contextualize each chapter from the transcript.
- Reject excessive chapter counts instead of silently truncating them.
- Match API validation to worker limits; native decoding and playback timestamps already support the expanded format.

Verification: real npm run build passed with existing lint warnings after installing this worktree's locked dependencies. Five web model tests passed. Worker lesson suite: 30 tests, 29 passed and one optional FFmpeg test skipped. Native Swift lesson tests passed, including twelve-chapter decoding. This does not claim simulator UI verification or end-to-end evaluation of the new automatic prompt on multiple recordings.

Release status: prepared, NOT activated or deployed. Preserve the user's instruction to wait for Mac Studio/Modal coordination. Build one immutable release for both execution locations and run parity fixtures before promoting the worker or the matching web editor limits. Do not enable Modal as the default. The manually reviewed 12-chapter Jonathan recap is a separate data replacement and does not activate the pipeline.

Known current limitation until coordinated deployment: the existing production editor still enforces the old ten-chapter/seven-minute bounds. Viewing and sharing the manually produced recap do not use that validator. Do not represent the prepared code as globally live.

Review follow-up: fuller outlines preserve themes, points and sentences past the old truncation limits. Outlines exceeding 64 themes, 64 points per theme or 2,000 characters per point now fail explicitly instead of silently losing teaching. Regression fixtures cover 17 themes, 17 points and 500-character points. Independent code review found no remaining important issues.
