# Match tools and sharing: build 160

Released September 7, 2026 from `codex/match-tools-sharing`, rebased onto
production `main` at `1fb980db`. Design and implementation plan:
`docs/superpowers/specs/2026-09-07-match-tools-sharing-simplification-design.md`
and `docs/superpowers/plans/2026-09-07-match-tools-sharing-simplification.md`.

- Tools now gives each job one name and one home: Highlights, Match analysis,
  placement, Share a link, Coach, and Export. The approved Tools card styling
  is unchanged.
- Match analysis is a section on the match page, directly before placement.
  Its Tools row scrolls there instead of opening a second presentation.
- Share a link offers This match, Highlights when a ready automatic reel
  exists, and Starred points. Coach access remains a separate private invite
  flow. Opening either link sheet only reads highlight readiness and never
  generates or regenerates a reel.
- The Highlights sheet keeps Play highlights, one Instagram entry, Share a
  link, and Save the video. Names, score, and logo are explicitly labelled as
  video appearance controls for Instagram and saved videos.
- Export contains video files only. The duplicate starred-point Instagram
  Reel action was removed.
- A coach invite now asks for its optional starter matches before the final
  Create invite link action.

## Public highlight links

The public highlights page now receives the same scored point and placement
context as a whole-match link when Include score and stats is on. It also
receives a narrow timeline containing only selected point IDs and their reel
output bounds. The page maps the reel's stitched output clock back to the
full scored match, so its running score advances at the correct rally even
across the 0.3-second joins. It does not expose detector evidence or storage
paths and does not render another video.

Production migration `20260907180000_highlight_share_score_and_stats` was
applied directly and recorded in Supabase migration history. A read-only
production probe found an active highlight link with 21 timeline rows, an
invalid token returned zero rows, `anon` can execute the token-gated resolver,
and `anon` still cannot select `match_reels` directly.

## Web

The real `npm run build` completed successfully on the current production
base: compilation, type checking, all 157 static pages, and build traces.
The repository's existing Rushstack/ESLint patch warning remains non-fatal.

Production deployment: pending the `main` push.

## iOS

`ios/Tests/run.sh` passes 695/695. The iPhone 17 Pro / iOS 26.5 simulator
build succeeds, installs, launches, and reaches the sign-in screen without a
crash.

Version 1.0 build **160** is reserved. Archive and App Store Connect upload
are pending.

## Focused verification

- 32/32 migration, highlight-link, public timeline, Highlights lifecycle,
  and Tools-structure checks pass.
- The full Next.js production build passes.
- The native Swift harness passes 695/695.
- The full iOS simulator target builds successfully.

## Not verified

- The simulator is signed out, so the account-level Tools, Highlights, Share
  a link, Coach, and Export sheets were compiled and covered by their model
  and source contracts but were not tapped through against a real account.
- No physical iPhone was used.
- A new public link was not created as a production user during release
  verification. The existing active link was used only for the read-only
  database probe.
