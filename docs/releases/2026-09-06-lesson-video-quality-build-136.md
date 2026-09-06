# Lesson video quality release: build 136

Released September 6, 2026 from the lesson video quality changes in
`5b6fe461` and the iOS chapter-context change in `08de4222`.

- Lesson videos now preserve 1920×1080 output. Clean playback uses H.264 at
  CRF 18 with the `fast` preset and 160 kbps AAC audio.
- iPhone HLG video is converted to SDR with a Hable tone map, avoiding the
  crushed shadows, clipped highlights, and exaggerated color in the earlier
  recap.
- The web and iOS recap screens show the first chapter's actual teaching cues
  instead of the transcript-recovery warning.
- Worker release `lesson-video-4cded6c75989b547` is active on the production
  Mac. Modal has the identical sealed payload as a disabled backup.
- Jonathan's recap was replaced in place at revision 5. Its clean playback is
  1920×1080 H.264 at approximately 5.22 Mbps with 160 kbps AAC. The rendered
  side-by-side asset is 1920×1080 at approximately 2.19 Mbps. Both outputs
  decode completely and report BT.709 color metadata.
- Production browser checks passed at 393×660 and 1280×850. They verified the
  first chapter cues, absence of the recovery warning, 1920×1080 playback,
  chapter synchronization, and playback progress without a media error.
- Verification passed: 58 worker lesson-video tests, the real Jonathan HLG
  integration fixture, the full Next.js production build, 649/649 Swift
  checks, and an iPhone 17 Pro simulator build.
- App Store Connect accepted iOS version 1.0 build 136 for processing.

Worker payload:
`f7834d79aeb4b66e59163233f267bebd2c2843b34df353c48cea4d2fe64b9495`.

Archive: `/tmp/PongLens-lesson-quality-1.0-128.xcarchive`.
Build log: `/tmp/ponglens-lesson-quality-128-archive.log`.
Upload log: `/tmp/ponglens-lesson-quality-128-export.log`.

Apple processing completion and physical-device installation remain
unverified.
