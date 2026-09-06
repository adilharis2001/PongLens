# Lesson video quality release: build 136

Released September 6, 2026 from the lesson video quality changes in
`5b6fe461` and `babbab66`, and the iOS chapter-context change in `08de4222`.

- Lesson videos now preserve 1920×1080 output. Clean playback uses H.264 at
  CRF 18 with the `fast` preset and 160 kbps AAC audio.
- iPhone HLG video uses its 203-nit reference white and no forced highlight
  desaturation during SDR conversion. The earlier 100-nit assumption clipped
  the club floor and windows and washed color out.
- The web and iOS recap screens show the first chapter's actual teaching cues
  instead of the transcript-recovery warning.
- Worker release `lesson-video-000cf9546cd5e3e5` is active on the production
  Mac. Modal has the identical sealed payload as a disabled backup.
- Jonathan's recap was replaced in place at revision 6 under the active
  student `Self`. Its clean playback is 1920×1080 H.264 at approximately
  4.21 Mbps with 160 kbps AAC. The rendered side-by-side asset is 1920×1080
  at approximately 1.77 Mbps. Both production outputs decode completely and
  report BT.709 color metadata.
- Production browser checks passed at 393×660 and 1280×850. They verified the
  first chapter cues, absence of the recovery warning, 1920×1080 playback,
  chapter synchronization, and playback progress without a media error.
- Color verification compared Apple AVFoundation, the old conversion, and the
  corrected conversion at four points across Jonathan's 90-minute original.
  The real-source integration fixture and 58 worker lesson-video tests passed.
  The full Next.js production build, 649/649 Swift checks, and an iPhone 17 Pro
  simulator build also passed for build 136.
- App Store Connect accepted iOS version 1.0 build 136 for processing.

Worker payload:
`fa19f0564ea0b0d558e9b5b2477d124d0e5c6bd681a9ce36c986761a0c19cdb0`.

Archive: `/tmp/PongLens-lesson-quality-1.0-128.xcarchive`.
Build log: `/tmp/ponglens-lesson-quality-128-archive.log`.
Upload log: `/tmp/ponglens-lesson-quality-128-export.log`.

Apple processing completion and physical-device installation remain
unverified.
