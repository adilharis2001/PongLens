# PongLens iOS: match playback, Modify / Insert, point playback, on-device rendering

Read-only study. Paths are relative to `/home/user/PongLens/ios/PongLens/PongLens/` unless they start with `src/`, `worker/` or `supabase/`. Line numbers are from the files as read on 2026-09-06.

Host screens: `Screens/PlayerTakeover.swift` is the match player AND the Keep-score pad (one view, `PlayerMode.watch|.score`, `PlayerTakeover.swift:5-7, 94-127`). `Screens/PlayerTakeoverScore.swift` is an extension carrying the Why bubble, analysis panel, setup sheet and pad controls. The chip strip (the web ReelBar) is `chipStrip` at `PlayerTakeover.swift:2138-2244`. The model shared by everything is `MatchDetailModel` (`Screens/MatchDetailScreen.swift:29-428`); Modify/Insert writes are extensions on it in `Core/PointExtras.swift:191-431`.

---

## 1. Video sources per surface

Every URL comes from `POST api/media-url` through `API.post` (`Core/APIClient.swift:17-70`, bearer token from `supa.auth.session`). The route (`src/app/api/media-url/route.ts`) signs:

| Body | Object | Expiry | Disposition | Route lines |
|---|---|---|---|---|
| `{matchId, preview:true}` | `matches.cut_path` (falls back to source job `result_path`) | 6 h | inline | 400-426 |
| `{matchId, rawPreview:true}` | `matches.raw_path` (HEAD-checked; `{available:false}` if gone) | 6 h | inline | 320-347 |
| `{matchId, pointId}` | `points.clip_path` | 1 h | inline | 382-398 |
| `{matchId}` | cut, attachment | 1 h | attachment | 428-434 |
| `{matchId, reel:true, scope}` | `match_reels.r2_key` | 1 h | inline for `v:` scopes | 280-318 |

**Match player (`PlayerTakeover`).** Does not fetch; the host hands it `videoURL`. `MatchDetailModel.load` mints the cut with `{matchId, preview:true}` when `status == .ready`, else `{matchId, rawPreview:true}` (`MatchDetailScreen.swift:137-156`). The "Original" pill mints `rawPreview` on tap (`MatchDetailScreen.swift:303-311, 1348-1359`) and opens the takeover with `source: .original`, which empties `points` and stands the whole cut clock down (`PlayerTakeover.swift:9-33, 299-303`). One `AVPlayer` for the life of the takeover (`@State var player = AVPlayer()`, :131). `start()` does `AVPlayerItem(url: videoURL)` and `replaceCurrentItem` (:3106-3108), keeps the item as `cutItem` (:3108) for detour swap-back, observes `.status` only to set `loadFailed` (:3112-3116), installs a 0.2 s periodic observer (:3125-3130). No `AVURLAsset` options, no range hints, no preloading of the cut. The only preloading is detour clips: `loadOwnClips` mints `{matchId, pointId}` for every card in `ownClipIds` and holds an `AVPlayerItem` per card (:3629-3662). **Expiry handling: none.** A 403 on an expired URL surfaces as `item.status == .failed` -> "This video couldn't be played" (:750-769). The cut URL is 6 h so the player is fine; the detour clip URLs are 1 h and are never re-minted (see Weakness 11).

**Modify sheet.** Its own `AVPlayer` (`ModifySheet.swift:52`). `load()` mints `{matchId, preview:true}` on EVERY presentation (:1053-1065), `replaceCurrentItem(with: AVPlayerItem(url:))`, exact-seeks to `videoSpan.start`, then installs a 0.1 s observer (:1066-1086). Web caches the cut URL for the PointDetail component's lifetime (`src/app/match/[id]/PointDetail.tsx:280-296`); iOS re-signs each open.

**Insert sheet.** Own `AVPlayer` (`InsertSheet.swift:41`). Plays the RAW upload first: `{matchId, rawPreview:true}`, expects `{url, available, trimStartS}` (:375-385); falls back to the cut `{matchId, preview:true}` (:387-393). Muted (:398), autoplays (:403). See Weakness 1: the route never returns `trimStartS`.

**Point detail.** Own `AVPlayer` shared across pages (`PointDetailScreen.swift:22`). `loadClip()` mints `{matchId, pointId}` once per point and caches it in `clipURLs: [UUID: URL]` for the screen's lifetime (:21, :945-962). `ClipPlayerView` swaps the item on URL change and autoplays (:1143-1161). No expiry handling; the cache is never invalidated (see Weakness 6).

**Starred.** `ClipLinks` (`Core/ClipFrames.swift:17-53`) caches `{matchId, pointId}` links per point for 45 min against the 1 h signature, de-duplicates in-flight mints, and has a `forget(_:)` that **no caller uses** (grep). Tiles pull a keyframe through `AVAssetImageGenerator` with infinite tolerance so it is one range request at the head of the file (:111-143, the "sheet of green" note). The sequence player reads one clip ahead (`StarredScreen.swift:664-668`) and plays through `ClipPlayerView`.

**Share.** Server path: `POST api/reel {matchId, pointId, showScore, showNames}`, poll `match_reels` at 1.2 s for `status == ready` (deadline 90 s), then `{matchId, reel:true, scope:"v:point:<id>"}` and `URLSession.download` to tmp (`SharePointSheet.swift:282-326, 566-605`). Device path: `{matchId, preview:true}` for the cut plus `matches.story_crop` in parallel (:346-373), then `StoryRenderer.render` range-reads the cut (section 7).

---

## 2. Timeline math on iOS

`Core/Playhead.swift` is a line-for-line port of `src/app/match/[id]/playhead.ts` + `clipEdit.ts`. Anchoring fact (:5-12): `cut_t0` is the PADDED clip start, `cut_t0 = max(0, t0 - effPre)` in source terms.

- Pads: `CLIP_PAD` frozen `{tight .5/1.0, normal 1.0/1.6, loose 1.6/2.4}` (:21-25); `clipPad(strictness:stored:)` prefers `matches.clip_pads` (:37-40); `TIGHT_PAD = 0.3` (:28); `effectivePad` uses `min(pad, 0.3)` on tight edges (:44-49). Identical to `clipEdit.ts:13-59`.
- `rallyEnd = cutT0 + eff.pre + max(0, t1 - t0)` (:53-57); `paddedEnd = rallyEnd + eff.post` (:60-63).
- `effectiveEnd` (:123-142): edited -> padded; tap (`scoredAtCutS >= cutT0`, flag on) -> `min(padded, tap + 0.5)`; else rally end (`rallyEndCutS`, `own - observed <= 2.7`) -> `min(padded, observed + buffer)`. Same rung order and guards as `playhead.ts:131-171`.
- `cutToSource(p, t) = max(0, t0 - eff.pre) + (t - cutT0)` (:146-151) = `playhead.ts:329-334`.
- `pauseEnd` (:158-167, `PAUSE_BEAT_S 1.2`, clamp to `nextStart - 0.05`), `nextCutStart` (:170-176), `playingPointId` (0.25 s lead, :181-188), `armedPointId` (:192-199): all identical.
- `tapeMove` and `skipSpans` live in `Core/ScoreLogic.swift:235-243, 251+` rather than Playhead.swift (web keeps them in playhead.ts). `advanceMove` (`ScoreLogic.swift:207-216`, `TAIL_WATCH_S 3.5`) mirrors web `advanceFrom`.

**Modify sheet geometry** (`ModifySheet.swift:116-126`): `rallyStart = cutT0 + eff.pre`, `rallyEnd = rallyStart + (t1 - t0)`, `spanStart = cutT0`, `spanEnd = rallyEnd + eff.post`, marker band `[rallyStart + 0.3, rallyEnd - 0.3]`. Linear map `cutOf(src) = rallyStart + (src - t0)` and `srcOf(cut) = t0 + (cut - rallyStart)` (:158-166), the same map as web `ModifyClip.tsx:196-199`.

**Child cut_t0 on split** (`PointExtras.swift:195-215`):
```
anchor      = max(0, t0 - eff.pre)
at (source) = clamp(anchor + (marker - cutT0), t0+0.3 ... t1-0.3), 2dp, >= 0.3 apart, sequential floor
childCutT0  = round2(cutT0 + (at - min(pad.pre, TIGHT_PAD)) - anchor)
```
Byte-identical to `modifyOps.ts:119-141` (note both use the RAW `pad.pre`, not the effective pre, inside `min(pad.pre, TIGHT_PAD)`; that is 0.3 for every real pad). Parent patch `t1 = at, edited = true, tightEnd = true`; the child is the next parent (:229-235).

**Insert geometry** (`Core/InsertGeometry.swift`) is in SOURCE seconds (:6-13). `seamBetween` (:75-97) computes `removed = max(0, next.t0 - prev.t0 - (next.rallyStart - prev.rallyStart))`, `continuous = removed < 0.25`. `sourceToCut` holds at the seam inside the hole (:102-108). `insertCutT0 = max(0, round2(sourceToCut(seam, w.t0) - eff.pre))` with `eff` from `tightStart: prev != nil, tightEnd: next != nil` (:174-178). `needsOwnClip` room test with 0.5 s slack (:228-259); `ownClipIds` walks the PHYSICAL timeline (deleted included) and refuses to let a retrofitted card (idx > a later card's idx) bracket its neighbours (:277-323). `Tests/InsertGeometryTests.swift` pins the Jose seam (24.1 s gap, 23.1 s removed) and the Terry 2 card-45 case against `insertGeometry.test.ts`.

**Divergences from web:**
1. iOS `runSplit` records nothing for undo; web `runSplitPlan` returns `UnsplitRecord`s and MatchView calls `unsplit_point` (`modifyOps.ts:79-86, 163-169`; no `unsplit` anywhere in ios, grep).
2. iOS `runSplit` returns `false` from inside the loop on a failed RPC without enqueueing a reclip for the children already created (`PointExtras.swift:236-240`); web enqueues if `created.length > 0` (`MatchView.tsx:2337`).
3. iOS enqueues the reclip immediately after each op; web debounces 4 s (`MatchView.tsx:2176-2182`). Both suppress only on a `queued` job (`PointExtras.swift:384-393`, `MatchView.tsx:2160-2169`).
4. iOS `refreshClipState` does not select `clip_path`; web's poll does (`MatchDetailScreen.swift:103` vs `MatchView.tsx:2440`).

---

## 3. Edit operations

All optimistic, on `MatchDetailModel.points`; `visible` is non-deleted sorted by `t0` then `idx` (`MatchDetailScreen.swift:46-53`).

| Op | RPC / write | Optimistic state | Reclip | Where |
|---|---|---|---|---|
| Split | `split_point {p_id, at_t, child_cut_t0}` sequentially down the tail | parent `t1=at, edited=true, tightEnd=true`; child appended | after the loop, once | `PointExtras.swift:195-242` |
| Join | `merge_points {p_ids}` | survivor `t1`, `tightEnd=false`, `edited=true`; merged rows removed | yes | `:247-272` |
| Adjust | `points.update {t0, t1, [tight_start:false], [tight_end:false]}` -- `edited` deliberately NOT sent (column-scoped grant; the `points_mark_edited` trigger sets it, :342-347) | `t0/t1/edited=true`, tight flags dropped; full rollback on failure | yes | `:341-378` |
| Insert | `insert_point {p_prev_id, p_next_id, p_t0, p_t1, p_cut_t0}` | created appended; prev `t1=t0, edited`, next `t0=t1, edited` where overlapped; downstream `serverOverride` cleared | yes, then `setOutcome(winner)` | `:285-337` |
| Delete | `points.update {deleted:true}` | `deleted=true` | no | `MatchDetailScreen.swift:423-427` |
| Delete-before | one `update ... in(ids)` | `deleted=true` each, rollback all | no | `PointExtras.swift:409-430` |
| Restore | `restoreScorerFields(..., deleted:false)` one patch | | no | `MatchDetailScreen.swift:378-399` |

Outcomes after Split/Join go through `setOutcome` (`Core/PointActions.swift:152-167`), which is the no-toggle variant of `pickOutcome` -- the comment records the bug it fixed (splitting a scored point un-scored its first half).

**`enqueueReclip`** (`PointExtras.swift:380-406`): reads `supa.auth.session.user.id`; `select id from jobs where kind='reclip' and status='queued' and options->>match_id = <id> limit 1`; if any, return; else `insert jobs {user_id, kind:"reclip", options:{match_id}}`. Both the query and the insert are `try?` -- a refused insert is silent.

**Worker side** (`worker/worker.py:5228-5350`): re-cuts every point `where edited and not deleted and t0/t1 not null` from the raw source (`jobs.input_path` of the source job, trimmed by `apply_source_trim`), pads with `min(pad, 0.3)` on tight edges, ffmpeg `-ss c0 -t span -vf scale=720:-2 libx264 medium crf 23 aac 96k +faststart` (:5315-5327), uploads to `r2://ponglens-media/points/<owner>/<match>/<idx:02d>-<8hex>.mp4` (fresh key per cut, :5331), `ledger_append(kind="clip")` (:5334), then `update points set clip_path=..., edited=false where id=... and t0=... and t1=...` (:5338-5343) so an edit made mid-cut is not claimed. Raw gone -> `clip_path=null, edited=false` (:5298-5310).

**Pending poll** (`MatchDetailModel.startClipPoll`, `MatchDetailScreen.swift:59-118`): guard `clipPoll == nil && hasPendingClips`; every 8 s `select id, t0, t1, edited, deleted, tight_start, tight_end from points where match_id=...` and copies those six fields onto matching rows; stops when nothing is pending. Started from: `MatchDetailScreen.task` after `load` (:797-799), `PlayerTakeover.onChange(of: model.hasPendingClips)` (:504-508), and `modifyFinished` (:2935-2946, with the note that the edit often sets `edited` on rows already pending so the watcher sees no change). **Not** started by `PointDetailScreen` (grep: only those three call sites).

**Undo** (`PlayerTakeover.swift:3040-3081`, `ScoreLogic.swift:453-463`): `.tap`, `.delete`, `.override`, `.bulkDelete` only. No Split, Join, Adjust or Insert undo on iOS. Every undo except override seeks + plays (`replay(at:)`, :3083-3090).

---

## 4. The stale state (`edited`)

Everything `edited` drives on iOS:

- `effectiveEnd` bypass: an edited point plays to its full padded end, tap/rally trims ignored (`Playhead.swift:126`).
- Chip: `RecutRing` replaces the countdown, the glow and 1.08 scale are dropped, a11y label gets ", updating clip" (`PlayerTakeover.swift:2498-2527`).
- `hasPendingClips` -> poll + the takeover's `onChange` (`MatchDetailScreen.swift:57`, `PlayerTakeover.swift:504-508`).
- Modify sheet Adjust lock: `adjustLocked = point.edited` (`ModifySheet.swift:216-218`) disables the -1s/+1s pills (:758-759) and the Save CTA (:900), and shows "This clip is still updating from an earlier change -- try again in a moment." (:725-731). Split and Join are NOT locked.
- Point detail: `ClipPlayerView(updating: point.edited)` draws the "UPDATING CLIP" capsule top-left (`PointDetailScreen.swift:133, 1125-1137`) while the stale clip keeps playing underneath.
- Starred: tile hides the frame while edited (`StarredScreen.swift:329`) and prints "Updating clip" in place of the duration (:426); the sequence player passes `updating:` (:545) and only says "This clip is still being recut." when the link ALSO failed (:539, 563-565).

**Differences from web.** Copy is identical for the lock (`ModifyClip.tsx:770-775`) and the badge (`PointDetail.tsx:520-523`). Web additionally has two states iOS lacks: "Updating clip..." placeholder when `!clip_path && edited`, and "Clip unavailable -- the original video has expired, but your timing edits are saved." when `!clip_path && hasTiming` (`PointDetail.tsx:504-511`). iOS shows an indefinite `ProgressView` for both (`PointDetailScreen.swift:1102-1104`, `url == nil` because the route 404s and `loadClip` is `try?`). The web lock reads a live prop; the iOS sheet holds `let point` (`ModifySheet.swift:37`), so the lock cannot release while the sheet is open.

---

## 5. How the Modify sheet plays video

- **Bounding.** `videoSpan` (`ModifySheet.swift:147-154`) = `(spanStart, spanEnd)`; on Join it extends to `paddedEnd(nextPoints[joinCount-1])`. The observer pauses at `span.end` and pins `playhead` there (:1080-1084); `togglePlay` restarts from `span.start` when within 0.05 s of the end (:1099-1101); tab and join-count changes `seekToSpanStart` (:280-287). `playable(t)` clamps any scrub/handle seek into `videoSpan` (:541-544).
- **Track spaces.** Split/Join draw `videoSpan`; Adjust draws `adjustSpan` (:198-210). `adjustReach = min(8, max(2.5, spanLength * 0.3))` (:184-187), same formula as web (`ModifyClip.tsx:213-215`). `adjustDragBounds = span +/- reach` (:190-193); `adjustSpan` grows to follow a handle the step buttons pushed past it (:198-204). `adjustBeyondClip = cutOf(adjT0) < spanStart-0.05 || cutOf(adjT1) > spanEnd+0.05` (:213-215) switches the caption (:716-718).
- **Markers.** `resetMarkers` spaces `parts-1` markers evenly in `[markerLo, markerHi]`, seeded by `initialCut` for a 2-way split (:950-963); drag clamps each between its neighbours with `minGapS 0.4` (:561-563); `splittable = markerHi - markerLo > 0.4` (:128-131).
- **Handle drag** measures translation from where the handle was when the finger landed, never its live box (:516-529, the double-counting note). Edge handles set `adjT0/adjT1` in SOURCE seconds and seek to `playable(cutOf(...))` (:565-577).
- **Seeking: "at most one seek in flight" (:1107-1143).** `seek(to:)` sets `playhead` and calls `request(t, exact: dragging == nil)`. `request` keeps `seeking`/`pendingSeek`: if a seek is outstanding the new time overwrites `pendingSeek` (newest wins) and returns; otherwise it issues `player.seek(to:toleranceBefore:toleranceAfter:)` with `.zero` when exact or +/-0.15 s while a handle is moving, and the completion handler clears `seeking` and replays the pending time. The crash it avoids (comment :1109-1116): a drag emits dozens of samples a second, and an exact seek on the cut video (long GOPs) means fetching and decoding a whole group of pictures over HTTP per sample; queuing dozens of those blew memory and the system killed the app. AVPlayer does cancel a superseded seek (its handler fires `false`), but the decode already dispatched is not reclaimed; collapsing to one outstanding request plus a tolerant seek during the drag is what keeps the per-sample cost to a nearby keyframe. The exact frame is fetched once, on `onEnded` (:487-490, :531-535).
- **Time observer** ignores ticks while `dragging`, `scrubbing`, `seeking` or `pendingSeek != nil` (:1078) so the knob does not fight the finger.

**Is anything preventing an immediate preview of the new t0/t1 from the cut video?** Mechanically, no: the sheet already has the cut video loaded and the linear map, so `cutOf(adjT0)..cutOf(adjT1)` is a seekable window the moment the handle moves. What stops it is a deliberate clamp: edge seeks go through `playable()` which clamps to the point's OWN padded span (:566-576, comment: "Out in the margin there is no frame to show -- the cut video jumps to a different part of the match there"). That is only true across a seam that removed footage; for the 55% of seams that are continuous (`InsertGeometry.swift:10-12`), and for the neighbour's pad on every seam, the frames ARE in the cut, and `seamBetween`/`playableAt` (`InsertGeometry.swift:75-116`) already know exactly which source seconds the cut holds. Nothing in the sheet consults that. After Save, `finish` dismisses without replaying (:1030-1049); the takeover does not move for an Adjust (`landing: nil`, :1039). The cut player then already shows the new timing (its boundaries are computed from t0/t1, and `edited` forces `paddedEnd`), so the ONLY surfaces that show stale footage after an Adjust are the ones bound to `clip_path` (point detail, starred, share, coach).

---

## 6. Point detail playback

- Plays `clip_path` via `{matchId, pointId}` (`PointDetailScreen.swift:945-962`), never the cut.
- `ClipPlayerView` (:1066-1305) is custom chrome over the bare `PlayerLayerView` (`Components/PlayerLayerView.swift:185-206`, `AVPlayerLayer` host, `.resizeAspect`); no native controls. Tap toggles play (:1106-1110); 3 px cyan progress bar from a 0.2 s observer (:1117-1124, 1146-1156); mute, replay (`seek(to: .zero)` + play, :1214-1221), zoom +/- and pinch/pan with `persistedZoom` module-global so the correction carries across points (:1061-1064, 1262-1304); "UPDATING CLIP" badge (:1125-1137); prev/next chevrons flank the picture (:1234-1244). Autoplay on every URL change (:1143-1161). `onEnded` only fires for its own item (:1162-1175); the point sheet passes none so the clip rests on its last frame; the starred sequence advances (`StarredScreen.swift:553-555`). Pause + remove observer on disappear (:1176-1180).
- Sequence: `index` binding into `model.visible`; `.task(id: point?.id)` reloads (:166-174); a horizontal paging gesture (:230-270) and the chevrons move `index`.
- Frame capture (:918-941): pause, `AVAssetImageGenerator(asset: player.currentItem!.asset)` with zero tolerance at `player.currentTime()`, async -> `AnnotatorView` -> `NoteMedia.uploadImage` (`api/note-image`, `PointExtras.swift:452-459`) -> `pendingImage` attached to the next note (:206-226). The takeover has the same routine (`PlayerTakeover.swift:1139-1154`); during a detour it captures from the clip asset, which is the right picture.
- While `edited`: the badge, and Modify (gated only on `t0/t1 != nil`, :324-329) still opens with Adjust locked inside. The stale clip plays. Nothing polls (section 3), and a fresh `clip_path` is never learned (section 9, item 6).

---

## 7. StoryRenderer as precedent (`Core/StoryRenderer.swift`)

**Range read.** `AVURLAsset(url: cutURL)` with no options (:67); `loadTracks(.video).first` (:68), `naturalSize` (:70), `nominalFrameRate` (:71), `duration` (:73). Range = `[max(0, segStart), min(segEnd, duration)]`, duration at least 0.5 s, timescale 600 (:74-78). AVFoundation range-reads the signed URL; the comment: "a rally is about 10 MB out of a file that can run to hundreds" (:51-54).

**Composition.** `AVMutableComposition`, one video track `insertTimeRange(range, of: vTrack, at: .zero)` (:80-84); audio track inserted with `try?` so a silent rally is not an error (:85-90). Crop window from `matches.story_crop` applied only if `src_w/src_h` match the asset's natural size, `y == 0`, `h == src_h` (:97-108); otherwise full frame. Scale to a 1080x1920 canvas, portrait sources fit by height (:113-121).

**Overlay.** Core Image via `AVMutableVideoComposition(asset:applyingCIFiltersWithHandler:)` (:149-160): crop -> affine place -> band artwork composited over -> ground. NOT `AVVideoCompositionCoreAnimationTool`, because in the Simulator its offline renderer trips an api-misuse trap and SIGTRAPs in `CA::OGL::render_layers` (:123-130). `renderSize = 1080x1920`; `frameDuration` from the source fps clamped 24..60, 30 if unreadable (:161-167). Bands are one `CGImage` drawn once with Core Text (:199-265), same arithmetic as the worker's `_story_background`.

**Export.** `AVAssetExportSession(asset: comp, presetName: AVAssetExportPreset1920x1080)` (:173-175), `videoComposition`, `shouldOptimizeForNetworkUse = true` (faststart, :177), `try await ex.export(to: out, as: .mp4)` into `temporaryDirectory/story-<uuid>.mp4` (:170-185). Errors: `RenderError.noVideoTrack` / `.exportFailed(String)` with user-facing text (:39-49); the export error is wrapped with its `localizedDescription` (:181-184).

**Measured numbers** (:22-27): ~0.8 s compute for a 9 s rally on Apple silicon, overlay 58 ms; A13 (iPhone 11, iOS 26 floor) expected 2-4 s, "all fixed-function video engine". Migration `supabase/migrations/136_instagram_render_path.sql:16-21`: server ~5 s end to end; device ~3-4 s on recent silicon, est. 4-7 s on A13.

**The switch.** `app_config.instagram_render` = `'server' | 'device'`, default server (`136_instagram_render_path.sql:30-33`), in the 107 allow-list so `authenticated` can read it (:35-57). Read per share by `StoryShareModel.renderPath()` (`SharePointSheet.swift:236-248`): unreadable/unset -> `"server"`. `prepare` (:250-326): if device, `prepareOnDevice` under `withShareTimeout(seconds: 25)` (:427-433, :635-648); on nil it clears the error, sets "Taking a little longer." and falls through to the server path (:266-276). `instagram_sharing` is the kill switch; unreadable answers "on" (:552-564).

**What happens to the rendered file.** It is NOT uploaded. It goes to Instagram via `UIPasteboard` + the `instagram-stories://` scheme (`Core/InstagramShare.swift:96-132`) or to the system share sheet (`SharePointSheet.swift:146-148, 185`). No `match_reels` row, no R2 write, no ledger entry. The server path is the one that books storage (worker `render_story` + `ledger_append`). So there is **no precedent on iOS for accounting a phone-rendered file**; the worker's reclip (`ledger_append(conn, owner, "clip", bytes, key, match_id)`, `worker.py:5334`) is the accounting a phone-cut clip would have to reproduce server-side.

**Cancellation / background / memory.** Cancellation only via the timeout task group's `cancelAll()` (:644-646); the comment accepts the export "keeps going briefly and its file is simply never used". No `beginBackgroundTask`; an `AVAssetExportSession` mid-export when the app is backgrounded fails and the fallback is the server path on the next tap. `AVAudioSession` untouched. Memory: one 1080x1920 RGBA band (~8 MB) plus per-frame CIImages on the GPU; nothing frees the tmp file after handover (only `removeItem` before writing, :172), so `story-*.mp4` files accumulate until the OS purges tmp.

---

## 8. Upload path on iOS

`Core/RecordingQueue.swift` is the only uploader. Flow: `POST api/upload-url {action:"create", fileSize, contentType}` -> `{key, uploadId}` (:239-256); the movie is sliced into 64 MB part files (:81, :276-300); each part is signed with `{action:"sign-part", key, uploadId, partNumber}` (:302-311) and PUT on a **background `URLSession`** (:96-102, :316-318) so the system finishes it through lock, switch-away and app death; `{action:"complete", key, uploadId, parts, register:{durationS, originalName, capturedAtMs, opponent, venue, matchType, userSide, firstServer}}` (:359-386) then `api/process` (:415-428). Recovery re-lists parts on launch (:606-671). **Does local footage survive upload?** No: `cleanup(id, keepOriginal: false)` deletes the recording from Documents once the match row is registered (:437, :462, :514-520). It survives only on permanent failure, when it is exported to Photos (:499-511, :538-553).

**What `api/upload-url` authorises** (`src/app/api/upload-url/route.ts`): signed-in user; `create` runs the quota/anti-spam gate (:63-76), forces `video/mp4|quicktime`, and mints `RAW_BUCKET/<userId>/<uuid>.<ext>` (:77-82); every other action requires `key.startsWith(user.id + "/")` (:87-91); `complete` books bytes through `register_upload` (commerce, creates a library row, :143-195) or `ledger_append_upload` (:197-206).

**Could a phone-cut point clip go through it?** Not as-is. Wrong bucket (raw vs `ponglens-media/points/<owner>/<match>/`), `complete` creates a MATCH row or books the bytes as an upload against the upload quota, and nothing sets `points.clip_path` (written only by the worker; the client's UPDATE grant is column-scoped, cf. the `edited` note at `PointExtras.swift:342-347`). Closest precedents for a media-bucket write via a route: `api/note-image` (multipart POST, server `putObject` to `sketch/<userId>/`, 8 MB cap, `ledger_append_sketch`; `src/app/api/note-image/route.ts:1-60`) and `api/lesson-video` (create/sign-part/complete keyed to a `lesson_videos` row in the MEDIA bucket, coach-only, `src/app/api/lesson-video/route.ts:48-98`). A point-clip route would need: ownership of the point, key `points/<owner>/<match>/<idx:02d>-<hash>.mp4`, `ledger_append` kind `clip`, and the worker's guarded claim `set clip_path=..., edited=false where id=... and t0=... and t1=...` (`worker.py:5338-5343`), plus encode parity with 720p/x264/faststart (:5321-5327) so `media-url {pointId}`, `ClipFrameLoader` (keyframe-at-head assumption, `ClipFrames.swift:119-135`) and the coach player keep working.

---

## 9. Weaknesses (concrete, with repros)

1. **Insert sheet plays the wrong footage on trimmed uploads (both platforms, root cause in the route).** `InsertSheet.swift:14-17, 375-385` reads `res.trimStartS ?? 0`, but `media-url`'s `rawPreview` branch returns only `{url, available}` (`route.ts:342-346`). Web has the same default (`InsertPoint.tsx:111-118`). Repro: process a library video with a trim start of 60 s, tap "+" on any seam -> the raw plays 60 s early; the handles describe the wrong rally and `insert_point` stores it.
2. **Insert sheet on the cut fallback never stops and the marker never moves.** The observer bails unless `source.kind == .raw` (`InsertSheet.swift:406-417`). Repro: a match whose original expired, tap "+", "Replay" -> plays on past `win.t1` forever, playhead line frozen.
3. **Insert sheet re-introduces the seek storm the Modify sheet guards against.** Every drag sample does a zero-tolerance `player.seek` with no in-flight guard (`InsertSheet.swift:248-257, 346-351`), on the RAW file, which is larger and longer-GOP than the cut the Modify comment (`ModifySheet.swift:1109-1116`) says got the app killed. Repro: drag a handle back and forth across a 20 s neighbourhood on cellular.
4. **A failed mid-sequence split leaves points `edited` with no reclip.** `runSplit` returns from the loop on the first RPC error before `enqueueReclip` (`PointExtras.swift:221-241`). Repro: 3-way split, kill connectivity after the first `split_point` -> parent and child 1 spin forever; the poll runs but nothing will ever clear them until an unrelated edit enqueues a job. Web enqueues for any created child (`MatchView.tsx:2337`).
5. **Modify from the point sheet never starts the poll.** `startClipPoll` is only called from `MatchDetailScreen.task` (once, on load) and inside `PlayerTakeover` (`MatchDetailScreen.swift:799`, `PlayerTakeover.swift:507, 2945`); `PointDetailScreen` and `MatchDetailScreen` have no `onChange(of: hasPendingClips)`. Repro: match page -> tap a point card -> Modify -> Adjust -> Save -> "UPDATING CLIP" and the Adjust lock persist until the match is closed and reopened.
6. **`clip_path` is never refreshed, so a new clip is invisible until full reload.** `refreshClipState` selects six columns and not `clip_path` (`MatchDetailScreen.swift:103`); `MatchPoint.clipPath` is `let` (`Core/Models.swift:253`); `model.load` reruns only on screen appear or when the source job finishes (`MatchDetailScreen.swift:798, 1667`). Consequences once the worker finishes: an inserted or split card keeps `hasClip == false`, so the Share sheet says "This rally has no video yet." (`SharePointSheet.swift:104, 159`), the Starred tile stays blank, and the card is never eligible for a detour (`PlayerTakeover.swift:3635`). Separately, `PointDetailScreen.clipURLs` (:21, :946) keeps the PRE-edit clip URL after `edited` clears, so the badge disappears while the stale footage keeps playing (the worker writes a fresh key per cut, `worker.py:5330-5331`, so the old object still serves).
7. **A card inserted during the session plays the neighbour's footage (the Terry 2 bug the detour exists for).** `ownClips` is computed only in `start()` and on the first duration tick (`PlayerTakeover.swift:3111, 3218`); nothing recomputes on `points.count` change, and with item 6 the new card has no `clipPath` anyway. Repro: Keep score -> "+" -> add a rally into a non-continuous seam -> the new chip plays from its `cutT0`, i.e. whatever the seam kept.
8. **Starred plays a stale clip for up to 45 min after a reclip.** `ClipLinks` caches per point (`ClipFrames.swift:19-20`); `forget` has no callers; `StarredStore` rows are not polled for `edited`.
9. **Point sheet spins forever when there is no clip.** `media-url {pointId}` 404s, `loadClip` is `try?`, `url` stays nil, `ClipPlayerView` shows `ProgressView` indefinitely (`PointDetailScreen.swift:952-961, 1102-1104`). One visible point in twelve has no clip (`Models.swift:250`); web shows "Clip unavailable -- the original video has expired..." (`PointDetail.tsx:508-511`).
10. **No Split/Join/Adjust/Insert undo on iOS.** `ScoreUndo` has four cases (`ScoreLogic.swift:453-463`); the spec lists split (`unsplit_point`), modify-split and adjust undos (`ios/docs/behavioral-spec.md:260-262`). Repro: score point 5, split point 6, tap Undo -> point 5's score reverts, the split stands.
11. **Detour clip URLs expire after an hour and are never re-minted.** `loadOwnClips` mints 1 h links at `start()` (`PlayerTakeover.swift:3643-3651`); no status observation on `clipItems`, no `didPlayToEnd` on a failed item, so `detourDone` never fires. Repro: leave Keep score open 61 min, reach an insert card -> black frame, playback wedges on that card.
12. **Adjust preview clamps to the clip span even where the cut is continuous** (`ModifySheet.swift:565-576`, `playable`), so widening a point shows the last frame the clip holds rather than the frame being chosen; the seam math that knows better exists (`InsertGeometry.swift:75-116`) and is not consulted. UX gap rather than a bug.
13. **The Modify sheet re-signs the cut on every open** (`ModifySheet.swift:1053-1065`); the web caches it per PointDetail instance. One extra round trip and presign per Modify.
14. **`enqueueReclip` is fully silent on failure** (`PointExtras.swift:382-405`): a refused insert (RLS, offline) leaves `edited` rows spinning with no job and no message.
15. **Modify sheet's `point` is a snapshot** (`ModifySheet.swift:37`): pickers seed from stale outcomes if the model changed underneath, and `adjustLocked` cannot release while open.
16. **Rendered story files are never deleted** (`StoryRenderer.swift:170-172`); on-device export is not background-safe and its only cancellation is the 25 s timeout (`SharePointSheet.swift:427, 635-648`).

---

## 10. Precedents for "play a window of the cut video"

Nothing is packaged as a reusable `(player, start, end)` helper; the pieces are:

- **`ModifySheet`'s bounded player** (`ModifySheet.swift:147-154, 541-544, 1053-1143`): cut video + `videoSpan` + observer auto-pause at the end + `playable` clamp + throttled `request(_:exact:)`. This is the closest thing to a windowed cut player and is private to the sheet.
- **`PlayerTakeover` detour** (`PlayerTakeover.swift:170-196, 3484-3622`): swaps a per-point clip in as the one player's item and keeps a virtual cut clock (`detourBase + rawTime`) so chips, boundaries and `scored_at_cut_s` stay on the cut clock. Item-swap on one `AVPlayer` is the established pattern for "same player, different file".
- **`PlayerLayerView`** (`Components/PlayerLayerView.swift`): the bare `AVPlayerLayer` host every surface uses.
- **`ClipPlayerView`** (`PointDetailScreen.swift:1066-1305`): whole-file clip player with chrome, `onEnded`, persisted zoom; used by the point sheet and the starred sequence.
- **`StoryRenderer.render`** (`StoryRenderer.swift:55-186`): `AVURLAsset` + `insertTimeRange([segStart, segEnd])` + export -- literally "cut a window of the cut video to a file", with `segStart = cutT0` and `segEnd = effectiveEnd(...)` computed at `SharePointSheet.swift:375-386`.
- **`ClipFrameLoader.still`** (`ClipFrames.swift:111-143`): single-keyframe range read from a signed URL.
- **`ClipLinks`** (`ClipFrames.swift:17-53`): the only signed-URL cache with TTL and in-flight de-duplication.
- Window bounds: `effectiveEnd` / `paddedEnd` / `pauseEnd` (`Playhead.swift`); "is this cut second real footage": `seamBetween` / `playableAt` / `sourceToCut` (`InsertGeometry.swift:75-116`); "does this card need its own file": `ownClipIds` (`InsertGeometry.swift:277-323`).
