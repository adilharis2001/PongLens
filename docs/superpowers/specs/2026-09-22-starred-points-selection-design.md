# Starred points: Home row, a compact shelf, and sharing across matches

> **Outcome, 2026-09-22: built as below and live.** Migration
> `20260922221228_starred_selection`; worker release `112a1e25…` (source
> `f78a93f7`) active on main, fast and the monitor, every smoke mode passed;
> a real two-match selection rendered on the live fast lane in about 25 s
> (26 s of 1080×1920 at 60 fps, each rally with its own names and score).
> Found on the way: `render_story` had always written 25 fps, because the
> still band artwork was the overlay's main input. Fixed in the same release.
> Not done: the cloud twin still carries `e2eb55a7`, so it reports
> `release_mismatch` (it is Off).

Adil, 2026-09-22. Three asks, every surface (web desktop, mobile web, iOS):

1. Starred points get their own row on Home: sideways-swiping, cheap to load,
   with a way through to the whole shelf.
2. The Starred page stops being a wall of big tiles. Points stay grouped by
   match, but they can be **selected across matches** and shared as an
   Instagram Reel, saved as a video, or sent as a link.
3. Playback reuses what exists instead of a bespoke starred player.

Approved direction (the mockup in the conversation): compact rows, a Select
mode with a bottom bar ("3 points · 0:28", Play, Share), one share sheet.

## What exists, and what it forced

- Every starred share today is **one match**: `share_links.kind = 'starred'`
  needs a `match_id`, `/api/reel` scope `v:starred` is keyed by
  `match_reels(match_id, scope)`. The web shelf has no sharing at all.
- Every **multi-rally** video is rendered by the worker, on iOS too
  (`prepareHighlights`: "a phone rebuilding it would be a third copy of the
  frame"). The phone renders single rallies only. So the selection video is
  a worker render on both platforms, one renderer, one file. This reverses
  what the first plan said about iOS rendering on the phone, for that reason.
- The only cross-match video precedent is the tag reel (`tag_reels`,
  `process_tag_reel`): its own row, same `reel` job kind, same queue.
- Both apps already deep-link a point inside its match: web
  `/match/<id>?p=<pointId>`, iOS `MatchPointRoute(match:pointId:)`.

## Playback

**Revised the same evening (Adil, after using build 232):** opening a point
inside its match took people to the match screen, and Play all earned its
place nowhere. Now:

- **Tap a point** (Home card or shelf row): it plays **full screen**, the way
  the match player shows video, and the side arrows step through the stars
  across matches; a point that ends moves on to the next. Close returns to
  where you were. No Play all.
- It is the shared clip player, not the match player: the full-screen match
  player (`PlayerTakeover` / `Player.tsx`) is built on one match's cut video
  and cannot play clips from several matches, and on the web it only exists
  inside the match page.
- **Web:** `ClipPlayer` with `fill` (no height cap) and `landscape` (the
  expand button, which is the match player's own full-screen code) on black,
  a header with the point and match and the match player's close button.
- **iOS:** `ClipPlayerView(fullScreen: true)` (square edges, star and mute
  moved to the bottom row) on black, with the match player's rotate button
  and close button; landscape uses the notch margins. Tap plays, hold
  starts selecting.
- The selection bar keeps **Play** for the picked points.

## Home

- Web `HomeOverview`, iOS `HomeScreen`: a **Starred points** section directly
  after Recent matches, only when the account has at least one star.
  Heading + "View all ›" to the shelf, the same header as Recent matches.
- Up to 10 newest (the shelf's order: newest match first). One RPC call,
  `starred_points(p_limit => 10)`, loaded once per visit, NOT on Home's
  10-second poll.
- Cards: 16:9 frame (the shelf's existing lazy frame on web, `ClipFrame` on
  iOS), outcome dot and label, "Point 42", match title, rally length.
  Horizontal scroll with snap: web copies the `AnalysisCards` scroller
  classes; iOS `ScrollView(.horizontal)` + `LazyHStack` + `.viewAligned`,
  as `CoachDeliveredView` does. Frames load only near the viewport.

## The shelf

- Header: title, count line, **Play all** (existing cyan ghost) and
  **Select** (secondary pill). In Select mode the header shows **Cancel**.
- Group header per match: title + date (taps through to the match). In
  Select mode its right side is **Select all** / **Deselect all**.
- Rows, in one bordered card per match (the Recent matches row language):
  small 16:9 frame, "Point 42", outcome in its colour, reason line, rally
  length; star on the right unstars (7 s Undo, unchanged). Select mode: a
  check circle on the left, the whole row toggles. iOS: long-press a row
  starts Select mode with it selected.
- Bottom bar while anything is selected: "3 points · 0:28" (sum of rally
  lengths), **Play** (outlined), **Share** (the one cyan primary).

## The share sheet (one per platform, for any selection)

- **iOS** `ShareSelectionSheet`, replacing `ShareHighlightsSheet` (only the
  shelf used it): `PLChooserSheet("Share N points")` with Instagram Reel
  (when sharing is on and Instagram is installed), Save the video, Share a
  link; then the existing names / score / logo toggles (same `@AppStorage`
  keys); the error line. Link = mint then the system share sheet, exactly
  like `SharePointSheet`'s "Share a link".
- **Web** `ShareSelectionSheet` on `BottomSheet`: Save video, Share link;
  the three toggles (localStorage `shareShowNames/Score/Logo`). Share link
  opens the same title step as `ShareSheet` (prefilled "Starred points"),
  then `navigator.share` or copy, plus the QR. Instagram is not offered on
  the web (no handover exists there).
- The video is the 9:16 render, the same file for Instagram and for saving,
  as today's per-match highlights sheet does. Instagram takes 60 s; saving
  takes up to 180 s. The server measures and refuses past the cap with a
  sentence; the phone and web show it.

## Share link: `kind = 'selection'`

- `share_links.point_ids uuid[]` (1 to 100, the owner's own points, in shelf
  order). `match_id`, `point_id`, `tag_id`, `lesson_id`, `lesson_video_id`
  all null. A **fixed** selection: unstarring later does not change a link
  already sent; a deleted point or match simply drops out. One active link
  per identical selection (unique on `(owner, point_ids)`), so re-sharing
  returns it (and renames it when a title is sent), like every other kind.
- Ownership is enforced three times: `/api/share` checks every point's match
  belongs to the caller; a trigger re-checks on insert with definer rights
  and forbids changing `point_ids`/`kind`/`owner` afterwards; and
  `resolve_share_selection` only ever returns points whose match the link's
  owner still owns. The RLS policy gains one disjunct so the owner can
  insert and revoke these rows.
- Public page `/s/<token>`: resolved after the match resolver and before the
  recap/entry ones (the order the media route already uses). Heading = the
  owner's title, else "Starred points"; sub line "5 points · 3 matches".
  Played with the existing public `StarredView`, which gains a per-clip
  caption ("Point 42 · Jordan · Sep 6"). Media: `/api/share/media?token&pointId`
  signs a clip only for a point the resolver returns. OG image: generic.
- Account → Public links: its own "Starred points" group on web and iOS.

## Video: `selection_reels`

- Table `selection_reels(user_id pk, status, manifest, r2_key, duration_s,
  size_bytes, error, created_at, updated_at)`, owner-read RLS. One row per
  account: a new selection replaces the last (and its file).
- `enqueue_selection_reel(p_manifest)`: signed in; every manifest point is an
  active, undeleted, clipped point in a match the caller owns, and its
  `match_id` in the manifest IS that point's match; 1 to 60 points; the same
  3-in-flight cap as `enqueue_reel`; upsert the row; insert a `reel` job with
  `options.scope = 'v:selection'` unless one is already queued. The `v:` scope
  routes it to the fast lane through the existing `enqueue_job` rule.
- Manifest (built by `/api/reel` from the same score walk as `v:starred`):
  `{ version: 1, format: 'story', show_names, show_logo, points: [{ point_id,
  match_id, clip_path, seg_start, seg_end, score_you, score_them, games_you,
  games_them, games_detail }], matches: { <match_id>: { you_name, them_name,
  show_score } } }`. Scores are each rally's own match score entering it;
  names are that match's names.
- Worker `process_selection_reel`: claim like the tag reel (row lock, source
  versions current, owner and match identity re-checked), render each point
  with the existing single-rally `render_story` (its match's signed cut URL
  and story crop, stream-copied at 10 Mbps), join them with the same
  crossfade as a multi-rally story at 6 Mbps (frame rate normalised to the
  fastest clip, capped at 60; audio kept only if every clip has it), upload
  to `reels/sel-<user_id>-<uuid>.mp4`, book the ledger, finish only if the
  request is still the current one, delete the previous file.
  `render_story` itself is unchanged.
- The unreferenced-object guard and the 7-day share-render sweep both learn
  `selection_reels`. `storage/inventory.ts` learns `reels/sel-<user>-…` as
  owned by that user.
- Clients poll the row (RLS) and sign with `/api/media-url { selectionReel:
  true }` (attachment, "Starred points - PongLens.mp4").
- The processing page needs nothing new: same `reel` kind ("Share video"),
  same `reel` stage.

## Rollout order (each step safe on its own)

1. Migration (additive; old clients unaffected). `starred_points` gains a
   defaulted `p_limit` and only numbers matches that hold a star.
2. Worker: commit, build a sealed release from it, verify, unit tests, the
   mandatory smoke modes, stage, check-only all lanes, drain and switch main,
   fast and the monitor. Hand lane untouched. Before this step a selection
   job would fail on the old worker, so no client may enqueue one yet.
3. Web deploy through main.
4. iOS TestFlight build.
5. Cloud twin: rebuilt from the new release and registered, or recorded as
   `release_mismatch` (it is Off) with the steps left for later.

## Tests

- `starred.ts` / `Starred.swift`: selection summary and ordering, same cases.
- `shareTarget` stays match-only; new `selectionShare.ts` validation tests.
- Manifest builder refactor: existing `/api/reel` output unchanged for one
  real match (compare before/after on the same points).
- Worker: unittest for manifest validation and the join argument builder;
  a real render of a 3-point, 2-match selection before the release is
  sealed.
- Storage inventory test for `sel-`.
- Screens: desktop, 393×660 mobile web, iOS simulator.
