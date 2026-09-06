# Quality-first highlights release: build 135

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
- Production web deployment `dpl_4Uz7kR5UmTq97wsrBfML8V3pw4Bg` reached Ready
  on `www.ponglens.com`; later main deployments retain this code.
- The production Mac worker was restarted with no active job. Its existing
  local production adjustments were preserved by a conflict-free three-way
  merge; 39 feature-specific tests passed against the exact live files.
- Integrated verification passed: 47 affected worker tests, 21 API/schema
  tests, 124 match/web behavior tests, the full Next.js production build,
  649/649 Swift checks, and a full iPhone 17 Pro simulator build.
- The local archive identifies version 1.0 build 127. During export, App Store
  Connect reported that 134 already existed and Xcode automatically assigned
  the uploaded package build 135. Apple processed build 135 as `VALID`; it is
  `IN_BETA_TESTING` for the internal Team group.
- Build 135 was also attached to the public External testers group with
  automatic notification enabled and submitted to TestFlight Beta App Review.
  Its external state was `WAITING_FOR_REVIEW` at the time of this record.

Archive: `/tmp/PongLens-highlights-1.0-127.xcarchive`.
Build log: `/tmp/ponglens-highlights-127-archive.log`.
Upload log: `/tmp/ponglens-highlights-127-export.log`.

The five-match, two-venue highlight canary review is not complete, so automatic
highlight generation is not globally enabled. Existing matches require a full
reprocess to generate the new evidence. Physical-device playback and a real
highlight render remain unverified.
