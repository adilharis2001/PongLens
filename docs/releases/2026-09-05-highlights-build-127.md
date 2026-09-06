# Quality-first highlights release: build 127

Released September 5, 2026 from
`5e2e9cc24ff52f4b52afd069c6d40bcef00e6d20`.

- Automatic highlights now fail closed unless a rally has at least five
  contacts, four connected net crossings, two table bounces, and an observed
  end. The 150-second limit is a ceiling, not a duration target.
- Web and iOS consume one server-rendered H.264/AAC video instead of seeking
  between rally fragments during playback.
- Production database migrations `20260906040000` and
  `20260906041000` are installed. The switch is private and enabled only for
  the product owner's account.
- Production web deployment `dpl_4Uz7kR5UmTq97wsrBfML8V3pw4Bg` is Ready and
  assigned to `www.ponglens.com`.
- The production Mac worker was restarted with no active job. Its existing
  local production adjustments were preserved by a conflict-free three-way
  merge; 39 feature-specific tests passed against the exact live files.
- Integrated verification passed: 47 affected worker tests, 21 API/schema
  tests, 124 match/web behavior tests, the full Next.js production build,
  649/649 Swift checks, and a full iPhone 17 Pro simulator build.
- App Store Connect accepted iOS version 1.0 build 127 for processing.

Archive: `/tmp/PongLens-highlights-1.0-127.xcarchive`.
Build log: `/tmp/ponglens-highlights-127-archive.log`.
Upload log: `/tmp/ponglens-highlights-127-export.log`.

The five-match, two-venue canary review is not complete, so the feature is not
globally enabled. Existing matches require a full reprocess to generate the
new evidence. Physical-device playback, desktop browser playback, 393×660
browser playback, Apple processing completion, and TestFlight installation
remain unverified.
