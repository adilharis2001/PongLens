# Clip-file and cut-video consumers — surfaces audit

Read-only study of every surface that reads `points.clip_path` (the per-point
720p clip) or `matches.cut_path` / `jobs.result_path` (the whole-match cut).
Repo: `/home/user/PongLens`. All paths below are relative to it. Nothing was
edited. Line numbers are from the working tree on 2026-09-06.

---

## 0. The two objects, and what the code believes about them

### Clip file (`points.clip_path`)

- **Produced by** `worker/points_pipeline.py:3036-3082`. Cut from the ORIGINAL
  upload at `c0 = max(0, t0 - clip_pre)` to `c1 = min(dur, t1 + dyn_post)`,
  encoded `scale=720:-2`, libx264 crf 23, AAC 96k, `+faststart`
  (`:3077-3081`). Pads come from `CLIP_PADS` (`:239-243`, 1.2/1.3 normal,
  1.8/2.0 loose).
- **The tail is dynamic.** `dyn_posts` (`:291` `DYN_POST_MAX_S = 2.0`,
  `:3040`) stretches the post pad per point up to 2.0s when there is room.
  `matches.clip_pads` stores the STATIC pair (`:3143`), so the app's
  `paddedEnd` under-estimates the real file by up to 0.7s. The true window
  (`clip_t0`/`clip_t1`, `:3084-3086`) is written to match.json in R2 only;
  the `points` row does not carry it (`worker/worker.py:4078-4110`).
- **Keys.** First processing: `points/<uid>/<matchId>/NN.mp4`
  (`worker/worker.py:4708-4716`). Reclip: `NN-<uuid8>.mp4`, deliberately a
  fresh key so caches never win (`:5332`).
- **Reclipped by** `process_reclip` (`worker/worker.py:5228-5352`) from the
  RAW upload only. Raw gone → `clip_path = null, edited = false`
  (`:5296-5309`). Split edges use `TIGHT_PAD = 0.3` (`:5225`, `:5316-5317`).
- **`edited`** is set by a DB trigger on any t0/t1 change
  (`supabase/migrations/007_score_and_clip_edits.sql:28-42`) and cleared only
  by the reclip worker (`worker/worker.py:5305`, `:5340`).
- **Retention:** never swept (`worker/worker.py:7924-7926`, "kept while the
  account is active"). Deleted with the match
  (`src/app/api/delete-match/route.ts:76-104`).

### Cut video (`matches.cut_path`, falling back to `jobs.result_path`)

- Full source resolution, GOP 60 (`worker/points_pipeline.py:995-1000`).
- `points.cut_t0` is the padded clip start inside the cut
  (`src/app/match/[id]/playhead.ts:9-17`), i.e. the same frame the clip file
  opens on. This "ANCHORING FACT" is what every cut-clock helper is built on.
- **Retention:** `results/` objects are swept after 30 days
  (`worker/worker.py:316`, `:7929-7931`) unless `_live_cut_paths` protects
  them, and that only returns rows when `app_config.commerce_enabled = 'true'`
  (`:7847-7860`, `:3524-3529`; seeded `'false'` in
  `supabase/migrations/096_commerce.sql:34`). So on a non-commerce account
  a match older than 30 days has NO cut, and the clip files are the only
  footage that survives.
- **`cut_t0` is not re-anchored after an Adjust.** `adjustPatch`
  (`src/app/match/[id]/modifyOps.ts:170-179`) writes only t0/t1/tight flags;
  I found no other writer (grep of migrations and worker). A split does set
  the child's cut_t0 (`modifyOps.ts:97`, migration 023) and an insert sets
  it (`MatchView.tsx:2218`). After an Adjust that moves t0, every
  cut-clock window is off by the delta; the reclipped clip file is the only
  correct footage.

### Fallback chain for the cut, used identically in three places

`matches.cut_path` → `jobs.result_path` when `jobs.status = 'done'` →
nothing. `src/app/api/media-url/route.ts:400-411`,
`worker/worker.py:6500-6515` (`_cut_video_path`), `:6540-6576`
(`_fetch_cut_video`). The share RPC does the same join
(`supabase/migrations/153_share_raw_fallback.sql:85-88`).

---

## 1. Web — signing routes

### `/api/media-url` (`src/app/api/media-url/route.ts`)

| Body | Lines | Reads | Signs | Who |
|---|---|---|---|---|
| `{matchId, pointId}` | 382-398 | `points.clip_path` via RLS | any `r2://bucket/key`, 3600s, inline | owner or accepted coach (`has_match_access`) |
| `{matchId, preview:true}` | 400-426 | cut → job result fallback | 6h, inline | same |
| `{matchId}` | 428-434 | same | 3600s, attachment "(pure play).mp4" | same |
| `{matchId, reel:true, scope}` | 280-318 | `match_reels.r2_key` (owner-scoped RLS) | 3600s; inline for `v:` scopes unless `download` | owner |
| `{matchId, raw}` / `{rawPreview}` | 320-380 | `matches.raw_path` (→ job input) | HEAD-checked | owner (raw) / any access (rawPreview) |
| `{thumbs:[…]}` | 196-232 | `matches.thumb_path` | batch, inline | any access |

- **Null clip_path → 404 "Clip not found"** (`:389-392`). No `edited` check.
- **No prefix check on `clip_path`** (`:389`), unlike the note branch which
  pins keys to `voice/<author>/` (`:260-267`). Today that is fine because
  `clip_path` is worker-written; if a phone ever writes `clip_path`, this
  route would sign whatever bucket/key the client put in the column.

### `/api/share/media` (`src/app/api/share/media/route.ts`) — public, token is the credential, 15-minute TTL (`:27`)

| Branch | Lines | Source | Null handling |
|---|---|---|---|
| point link | 86-97 | `link.point_clip_path` from `resolve_share_link` (`153_share_raw_fallback.sql:100`) | 404 |
| starred link + pointId | 99-121 | `resolve_share_starred` re-run at sign time (`015_share_starred.sql:50-77`) | 404 (no pointId also 404) |
| tag link + pointId | 123-145 | `resolve_share_tagged` (`036_tag_share_export.sql:230-255`) | 404 |
| match link + pointId | 147-164 | `resolve_share_points` (`139_share_tap_end.sql`) | 404 — **not called by the web page**; `src/app/s/[token]/` only ever passes `pointId` from `StarredView.tsx:44` (starred/tag kinds) |
| match link, no pointId | 166-177 | `link.cut_path ?? link.raw_path` | 404 |

None of the four share RPCs filter on `edited`; they filter on `deleted`
only (`153:104-110`, `015:74`, `036:252`, `139:47`).

### `/api/review-media` (`src/app/api/review-media/route.ts:128-186`)

`{orderId, pointId}` or `{orderId, pointIds[≤24]}` → clip files of points
cited by a finding of that order, 600s inline (`:158-173`). Authorisation is
the points SELECT policy `point_in_completed_review`
(`073_coach_reviews.sql`), so the coach needs NO match access — this is
how a coach replays cited points after the order closes. No `edited` check.
Null clip_path → that id is simply absent from `urls` (`:167-168`).

### `/api/admin/media-url` (`src/app/api/admin/media-url/route.ts:53-84`)

`{matchId}` cut, `{matchId, pointId}` clip, `{matchId, raw:true}` raw,
through `admin_match_cut_path` / `admin_point_clip_path`
(`069_admin_match_points.sql:59-77`, `is_admin()` inside). Admin only.
No `edited` filter.

### `/api/download-url` (`src/app/api/download-url/route.ts:35-72`)

`{jobId}` → `jobs.result_path` (cut) as an attachment, owner only; legacy
Supabase-Storage fallback. Used by the dashboard's finished-job card
(`src/app/dashboard/HomeOverview.tsx:227-235`). Cut only.

### `/api/thumb/[matchId]` (`src/app/api/thumb/[matchId]/route.ts:55-90`)

Streams `matches.thumb_path` bytes (stable URL, a day of cache). The thumb
is a still, not a clip — but it is EXTRACTED FROM a clip (see worker §5).

### `/api/reel` (`src/app/api/reel/route.ts`) — manifest for every rendered export

- Owner only (`:270-278`). Scopes: starred, full, `tag:<uuid>`,
  `v:point:<uuid>`, `v:starred`, `v:hl:{story|reel|long}` (`:225-235`).
- **A point is included only if it has a `clip_path`** (`:386-398`), even
  though manifest v2 renders from the CUT (`:39-50`). `edited` is not
  checked.
- Segment maths (`:413-424`): `seg_start = cut_t0`,
  `seg_end = effectiveEnd(p, pad, ends)`; pad from
  `clipPad(strictness, match.clip_pads)` (`:281-296`). Null when `cut_t0`
  is null → worker falls back to the clip file.
- `v:hl:*` takes bounds from the canonical highlight manifest instead
  (`:416-419`).

### `/api/tag-reel` (`src/app/api/tag-reel/route.ts`)

Cross-match: selects tagged points `not clip_path is null` (`:80-85`),
writes `seg_start/seg_end = null` for every point (`:128-138`), so the
worker ALWAYS renders from clip files. No `edited` check.

### `/api/highlights` (`src/app/api/highlights/route.ts`)

Owner only. Signs the rendered `reels/<matchId>-highlights-*.mp4` (6h,
`:142-145`) after `selectedPointsAreFresh` — which REJECTS any manifest
point that is now `deleted`, `edited`, or `is_let` (`:74-85`, line 77).
Enqueues a render only when `match.cut_path` exists (`:154-156`). Never
touches clip files.

---

## 2. Web — players and pages

### PointDetail / PointSheet (owner AND linked coach; `MatchView` is served to anyone `has_match_access` admits)

`src/app/match/[id]/PointDetail.tsx` (PointSheet wraps it, `PointSheet.tsx:7`, `:502`).

- Plays the **clip file**: fetches `{matchId, pointId}` (`:322-347`); if
  `clip_path` is null it stops before fetching with "No clip for this point."
  (`:326-329`).
- Render states (`:497-518`): clip → `ClipPlayer`; `!clip_path && edited` →
  "Updating clip…" pulse; `!clip_path && hasTiming` → "Clip unavailable —
  the original video has expired, but your timing edits are saved."; error.
- **`edited && clip_path` plays the OLD clip with an "Updating clip" badge**
  (`:520-524`). Adjust is locked while edited (`:269`, `:931`).
- The Modify modal plays the **cut** (`{preview:true}`, `:277-294`,
  `:898-931`); `ModifyClip.tsx:60-66` builds geometry with `effectivePad`.
- Pads: `clipPad(strictness, clipPads)` (`:262`), threaded from
  `page.tsx:171-183` (job `options.strictness`) and `match.clip_pads`.
- Resolution: whatever the file is; `ClipPlayer` reads `duration` and
  `videoWidth/videoHeight` from the element (`ClipPlayer.tsx:592-599`,
  `:1046-1056`) for the scrub bar and portrait layout; Annotator frame
  capture draws the element to a canvas (`readPixels`, `crossOrigin
  anonymous`, `:1045`).
- Needs a file? No — it seeks nothing; it plays whole. Cut+window would
  work for every non-inserted, non-edited point.

### Player (the cut-video takeover on the match page) — `src/app/match/[id]/Player.tsx`

- Plays the **cut** (`{preview:true}`, `:1806-1823`). Every skip/pause/end
  helper is cut-clock via `playhead.ts` with the job pad (`:651-656`).
- **Detour** (`:1446-1475`): inserted cards whose footage the cut cannot
  show are played from their **own clip file** on a second `<video>`.
  `ownClipIds` (`insertGeometry.ts:326-366`) picks them; only cards with a
  `clip_path` qualify (`:1750-1758`); URLs are minted with
  `{matchId, pointId}` up front (`:1764-1788`).
- **Pad assumption:** `enterDetour` sets `detourBase = cut_t0` and seeks the
  clip to `t - cut_t0` (`:1874-1895`), i.e. clip frame 0 IS the cut_t0
  frame. A clip cut with a different pre pad shifts every detour.
- `edited` is not consulted for the detour set; the strip chip shows
  "Updating clip" (`:6553-6580`).
- Frame capture for annotations scales the active surface to ≤1280 wide
  (`:3524-3536`) — during a detour that surface is the 720p clip.

### MatchView — `src/app/match/[id]/MatchView.tsx`

- Download card: `{matchId}` cut attachment (`:328-336`).
- Reclip enqueue, 4s debounce, one queued job per match (`:2161-2182`);
  Adjust writes `edited: true` optimistically (`:2255-2275`).
- Polls `points` every 8s while any visible point is `edited`
  (`:2429-2451`) so the badge resolves.
- Tag row export counts only points with a `clip_path` (`:1028`).

### ReelBar / HighlightsRow (owner) — `ReelBar.tsx`, `HighlightsRow.tsx`

- ReelBar: starred/full ids are the points with a `clip_path`
  (`:238-239`); POSTs `/api/reel` (`:348-354`); download via
  `downloadReel` → `/api/media-url {reel:true, scope}`
  (`src/lib/download.ts:26-35`). Raw probe `{raw}` (`:306`).
- HighlightsRow: `/api/highlights` (`:42-46`); download scope
  `"highlights"` (`:64`). Files, rendered from the cut.

### InsertPoint — `InsertPoint.tsx:103-106`

Plays the **raw original** (`{rawPreview:true}`) to pick a window the cut
does not contain; computes the new card's `cut_t0` (`:266`).

### Share page `/s/[token]` — public stranger

`src/app/s/[token]/page.tsx`, `ShareView.tsx`, `StarredView.tsx`, `SharePlayer.tsx`.

- **Point link:** `ShareView` fetches `/api/share/media?token=` only
  (`ShareView.tsx:87-103`) → the point's **clip file**
  (`kind === "point"`, `:44`, `:239-240`). No `edited` in the resolved link;
  no badge. Null clip → "Couldn't load the video."
- **Match link:** the **cut** (or raw, 153), with dead spans from
  `skipSpans` computed server-side using `resolve_share_clip_pads` and
  `clipPad(null, pads)` (`page.tsx:108-155`). No cut and no raw → "This
  video is no longer available." (`:523-531`).
- **Starred / tag links:** `StarredView` signs each clip on demand with
  `pointId` (`StarredView.tsx:44-51`), auto-advances on `ended`. The
  resolved rows carry no `edited` (`shareData.ts:102-109`;
  `015_share_starred.sql:50-57`).
- Resolution: whatever the file is (720p clips, full-res cut).

### Starred page (owner) — `src/app/starred/`

- URLs: `clipUrls.ts:26-56` (`{matchId, pointId}`, 45-min cache).
- Tiles mount the clip at `#t=posterTime` (`StarredView.tsx:195-201`) —
  **skipped when `row.edited`**, and the label reads "Updating clip"
  (`:317`). `posterTime` = 0.4–1.5s into the clip (`:149-153`).
- `StarredPlayer.tsx` loads any row with `has_clip` (`:34-40`), reads one
  ahead, plays whole and auto-advances on `ended` (`:158-175`). **It does
  not consult `edited`** — the stale clip plays; only the failure message
  mentions a recut (`:175-182`).
- Data: `starred_points()` (`134_starred_points.sql:39-85`),
  `has_clip = clip_path is not null`, `edited` returned.

### Coach review reader (web) — `src/components/reviews/PointReel.tsx:35-41`, `ReviewReader.tsx:18-24`, `:136`

Batch-signs cited clips via `/api/review-media {orderId, pointIds}`, mounts
them in `ClipPlayer` (`PointReel.tsx:372-390`). Student from delivery,
coach any time. Clip files only, no `edited` handling.

### Coach's editing workspace (web) — `src/app/coaching/orders/[id]/FindingEditor.tsx:163-166`

Plays the **cut** (`{preview:true}`); coach is admitted by `has_match_access`
while the order is open.

### Coach sample page (public) — `src/app/coach/[handle]/sample/page.tsx:61-82`, `SampleFinding.tsx:47-62`

`resolve_sample_review` (`078_offering_images_receipts_sample.sql:208-218`)
returns each cited point's `clip_path` (filters `not deleted` only); the
page presigns them for an hour and renders bare `<video>` elements. Null →
that point is omitted (`:47`). Public, unauthenticated.

### Research / admin pages (admin only)

- Cut via `{preview:true}`: `research/recall/RecallReview.tsx:129`,
  `serve-detector/ServeDetector.tsx:117`, `spin/SpinReview.tsx:182`;
  admin cut via `research/themes/adminClipUrls.ts:55-62` →
  `ThemeAnalysis.tsx:76`; `admin/uploads/[matchId]/UploadView.tsx:249-252`.
- Clip via `{pointId}`: `crossing-review/CrossingReview.tsx:219`,
  `serve-accuracy/ServeAccuracy.tsx:864-876` (pairs the clip with ball
  tracks keyed by point — clip-local timing), `themes/ThemeTape.tsx:65-72`
  (admin route, `has_clip` gate).
- Raw: `v3-serve-detector/V3ServeDetector.tsx:859-861`,
  `UploadView.tsx:272-276`.

### Dashboard / import (cut only)

`HomeOverview.tsx:227-235` (`/api/download-url` on a finished job),
`:249-252` (reel); `dashboard/shared.tsx:148-157` (a failed match with a
`cut_path` still shows), `:364` (thumbs); `YouTubeImport.tsx:432`, `:472`
(polls `jobs.result_path` to find the match row).

---

## 3. iOS

Model: `Core/Models.swift:253` `clipPath`, `:260` `hasClip`, `:137` `cutPath`,
select list includes `clip_pads` (`:178`).

| Screen | Plays | Request | Null / edited behaviour | Lines |
|---|---|---|---|---|
| `PointDetailScreen` | clip file | `{matchId, pointId}` | plays the OLD clip with an "UPDATING CLIP" badge when `edited` | `:128-141`, `:943-962`, `:1125-1136` |
| `StarredScreen` | clip file | `ClipLinks.url` (`Core/ClipFrames.swift:18-53`) | poster frame only when `hasClip && !edited` (`:329-331`); label "Updating clip" (`:426`); sequence player passes `updating: row.edited` (`:545`); plays if `hasClip` (`:653`), reads one ahead (`:666`) | |
| `PlayerTakeover` (cut player) | cut, with **detours to clip files** | `{matchId, pointId}` per flagged card | `ownClipIds ∩ hasClip` (`:3629-3634`); no `edited` check; virtual time `detourBase + t` (`:341-347`) | `:3623-3660` |
| `MatchDetailScreen` | cut (`preview`) or raw (`rawPreview`) when not ready | `:136-150` | download `{matchId}` attachment `:283-289`; polls pending clips `:57`, `:91-113` | |
| `ModifySheet` | cut | `{preview:true}` | | `:1055-1060` |
| `InsertSheet` | raw, falling back to cut | `{rawPreview}` then `{preview}` | | `:377-392` |
| `CoachFindingsView` | cut | `{preview:true}`, seeks to `cutT0` | pads `clipPad(strictness: nil, stored:)` | `:615-633`, `:205`, `:644` |
| `CoachOrderStore.clipURLs` (delivered review) | clip files | `/api/review-media {orderId, pointIds}` in batches of 24 | | `Core/CoachOrderStore.swift:484-527` |
| `HighlightsSheet` | rendered highlight file | `/api/highlights` | share via `ActivityView` / Instagram | `:58-66`, `:163` |
| `MatchTools` | rendered reels, raw | `{reel, scope}`, `{raw}` | | `:1143-1158`, `:1206-1218`, `:1622-1650` |
| `SharePointSheet` (Instagram) | **built from the cut**, on device or server | device: `{preview:true}` + `story_crop`; server: `/api/reel {pointId}` then `{reel, scope:"v:point:…"}` | **`hasClip` gates the whole UI** (`:80`, `:89`, `:103-106`, `:159`) although neither path plays the clip; device path needs `cutT0/t0/t1` (`:375-378`) | `:275-321`, `:335-437` |
| `StoryRenderer` | cut over HTTP range | `AVURLAsset(cutURL)`, `CMTimeRange`, 1080x1920 canvas, export 1920x1080 preset | | `Core/StoryRenderer.swift:29`, `:67`, `:76`, `:174` |
| `InstagramShare` | a local FILE on the pasteboard | `Data(contentsOf:)` | | `Core/InstagramShare.swift:103-120` |
| `ClipFrameLoader` (Starred tiles) | one still from the clip | `AVAssetImageGenerator`, any keyframe, max 900px | | `Core/ClipFrames.swift:72-120` |
| `ImportedVideoStatusView` | nothing; reads `jobs.result_path` to find the match row | | | `:52-66` |

Pads on iOS: `Core/Playhead.swift:21-60`, `:123`, `:146` mirror
`clipEdit.ts`/`playhead.ts`. Note that iOS always calls
`clipPad(strictness: nil, stored:)` (`CoachFindingsView.swift:205`, `:644`;
`MatchDetailScreen.swift:543`; `HighlightsSheet.swift:88`), so a pre-048
match cut at `loose` gets `normal` pads on the phone but the job's pads on
the web (`page.tsx:171-183`). Existing drift, not caused by clips.

---

## 4. Worker

### Renders

- **`render_reel`** (`worker/worker.py:6072-6145`): per point, cut segment
  `[seg_start, min(seg_end, cut_dur)]` when the cut is local and bounds
  exist, else **downloads the clip file** (`:6092-6113`). Target format is
  ffprobed from the cut, or from the FIRST clip when no segment came from
  the cut (`:6118-6134`). Audio is kept only if EVERY source has an audio
  stream (`:6136-6142`).
- **`render_story`** (`:6278-6345`): same choice; cut may be a presigned URL
  that ffmpeg range-seeks (`:6303-6311`). The 9:16 `story_crop` is applied
  ONLY to cut-sourced points — "a preview clip is 720px wide, and cropping
  that then blowing it back up to 1080 is visibly soft" (`:6316-6320`).
- **`render_auto_highlights`** (`:5840-5875`): cut only; ffprobes the cut for
  size/fps/audio; `process_reel` raises if the cut is unavailable
  (`:6729-6732`). But `highlights.build_manifest` excludes any point without
  a `clip_path` (`worker/highlights.py:59`) alongside deleted/edited/let
  (`:57`).
- **`process_tag_reel`** (`:6578-6645`): `cut_local = None` always
  (`:6606-6609`) → every point from its clip file.
- **`process_reel`** (`:6647-6775`): fetches the cut only when some point
  has `seg_start` (`:6733-6743`); vertical uses a URL, named exports
  download the whole cut.

### Stages that read LOCAL clip files during processing

- **Poster thumb**: first point's clip, seeked to half the rally length
  (`:4717-4723`, `:4763-4779`, `extract_thumb` `:3914-3935`). A separate
  raw-upload thumb exists for unprocessed matches (`:7325-7355`).
  `worker/backfill_thumbs.py:34-76` downloads a clip from R2 and does the
  same seek.
- **RTMPose match structure** (`run_match_structure_stage` `:4175-4200`,
  called `:4690`) and **side-change detection** (`run_side_change_stage`
  `:4321-4363`, called `:7630` with `workdir/points_out`): both pass
  `--clips-dir` pointing at the job's local clips. The extractor opens each
  clip with cv2 for fps/frame count/size
  (`worker/extract_match_structure_rtmpose.py:155-170`), maps source-time
  ball detections to clip-local frames using `clip_t0`/`clip_t1` from
  match.json (`:85-96`), and takes the calibration frame size from the
  first clip (`:309-311`). They never download clips from R2.

### Not consumers, but touch the same objects

- `process_reclip` (`:5228-5352`) — producer; reads the RAW.
- Retention: `retention_sweep` `:7914-7940`; clips never swept; cut swept at
  30 days unless commerce protects it.
- Research scripts that read clip files offline (not imported by
  `worker.py`): `recalibrate_from_clips.py`, `run_service_motion_experiment.py`,
  `run_temporal_serve_experiment.py`, `temporal_serve_manifest.py`,
  `publish_temporal_serve_results.py`, `train_audio_impacts.py`,
  `build_*_research.py`, `eval/winner_constrained_analysis.py`.
- `scripts/demos/clone_match.py:90-169`, `stage_reviewer.py:56-65` copy
  rows and objects between accounts for tutorial captures.

---

## 5. Answers

### Q1. If the phone produced the clip files (same keys, same 720p mp4), which consumers are affected, and which inspect the file?

**Inspect the file (ffprobe / cv2 / AVFoundation):**

1. `render_reel` / `render_story` fallback and **every tag reel**
   (`worker.py:6118-6142`, `:6338-6342`, `:6606-6609`): width, height, fps,
   and audio presence are read from the clip. A phone clip with no audio
   track mutes the whole reel (`keep_audio = all(...)`); a tag reel mixing
   phone clips with worker clips of other matches takes its target format
   from whichever is first.
2. **RTMPose stages** (`worker.py:4190-4197`, `:4353-4356`;
   `extract_match_structure_rtmpose.py:85-96`, `:155-170`, `:309-311`):
   the biggest structural hit. They read clips from the job's LOCAL
   `points_out` directory, which a phone-produced clip is not in, and they
   assume the clip starts exactly at match.json's `clip_t0` at a constant
   fps. Variable-frame-rate phone encodes break the frame mapping silently.
   Either the worker keeps cutting local analysis clips (not uploaded), or
   these stages move to the cut with `cut_t0` windows.
3. **Thumbnail** (`worker.py:4717-4723`) and `backfill_thumbs.py:54-76`.
4. Browser and AVFoundation players read `duration` and dimensions
   (`ClipPlayer.tsx:592-599`, `:1046-1056`; `ClipFrames.swift:111-120`;
   `StarredPlayer`/`StarredScreen` auto-advance on `ended`). They do not
   care WHERE the file came from, but they do care that it is H.264 +
   AAC, 8-bit yuv420p, even dimensions, `+faststart`, `Content-Type:
   video/mp4` (worker sets it `:4713`). iPhone default HEVC/HDR capture
   will not play in desktop Chrome/Firefox, and a moov-at-end file will
   not stream progressively.

**Depend on the cut layout even though they never open the file:**

5. Both detours (`Player.tsx:1874-1895`, `PlayerTakeover.swift:341-347`)
   assume clip frame 0 == the `cut_t0` frame.
6. Every reel manifest and the tag reel (`reel/route.ts:386-398`,
   `tag-reel/route.ts:80-85`) and `highlights.py:59` use `clip_path` as
   "this point has footage" — if a phone clip can arrive later than the
   worker's rows, those surfaces exclude the point until it does.
7. Caching: web `clipUrls.ts:16`, iOS `ClipFrames.swift:19` cache a signed
   URL for 45 minutes, and R2/HTTP caches sit behind it. The reclip path
   deliberately writes a new key every time (`worker.py:5332`). A phone
   that overwrites `NN.mp4` in place will show the old bytes for up to
   45 minutes on every surface.
8. Reclip ownership: an owner edit trips `edited` (`007:28-42`) and the
   worker re-cuts from the RAW or nulls the clip (`worker.py:5296-5309`).
   If the raw never reaches the server, every phone-produced match loses
   its clip on first edit and shows "Clip unavailable — the original video
   has expired" (`PointDetail.tsx:508-512`).
9. Ledger: clip bytes are booked by the worker (`worker.py:4761`, `:5336`).
10. Security: `/api/media-url` signs whatever `clip_path` says with no
    bucket/prefix check (`:389`). Today safe because only the worker
    writes the column; a client-writable `clip_path` needs the same
    pinning the notes branch has (`:260-267`).

**Unaffected:** every cut-only consumer (`/api/highlights`, auto
highlights, the cut player, coach workspace cut, ModifySheet, InsertPoint,
downloads, `download-url`, `thumb` route, share match links).

### Q2. Which consumers could switch to "cut video + time window", and which fundamentally need a file?

**Already cut + window:** `/api/reel` manifest v2 (starred/full/tag-in-match,
all `v:` scopes), auto highlights, Instagram share on both paths, the cut
players on web and iOS, the coach workspace players, ModifyClip/ModifySheet.

**Could switch, with the caveats below:** web PointDetail/PointSheet
(owner and coach), iOS PointDetailScreen, web and iOS Starred sequence
players, Starred tiles/posters (a range read of the cut's moov per tile is
heavier than a 3 MB clip but workable), share point/starred/tag links (the
RPCs would need `cut_t0` + pads; today a point token exposes ONE clip and
would then sign the whole cut — a product/privacy decision, not a code
detail), thumbnails (trivial: seek `cut_t0 + pre + (t1-t0)/2` in the cut),
the RTMPose stages (moderate: they would read cut windows instead of clip
frames), research pages (ball tracks are clip-local and would need
re-basing).

**Caveats that make cut + window wrong or impossible in real cases:**

- **The cut expires.** 30-day sweep on `results/` unless
  `commerce_enabled = 'true'` (`worker.py:316`, `:7847-7860`; seeded false).
  Clips are the only footage older than a month on a non-commerce account.
  `/api/media-url` answers 409 "Video not ready" once it is gone (`:410-411`).
- **Inserted points have no footage in the cut** — the detour exists for
  exactly this (`Player.tsx:1448-1453`). Only the raw (30 days) or a file
  can serve them.
- **`cut_t0` is stale after an Adjust** (`modifyOps.ts:170-179`; no
  re-anchoring writer found). The reclipped file is right; the window is
  off by the t0 delta, and `effectiveEnd` on an edited point returns the
  padded end from that stale anchor (`playhead.ts:141`).
- **The file is longer than the window.** Dynamic post up to 2.0s
  (`points_pipeline.py:291`, `:3040`) versus `clip_pads.post` 1.3s. A
  window recomputed from `clip_pads` cuts up to 0.7s off the tail users
  see today. The real `clip_t1` lives only in match.json.

**Fundamentally need a file:**

- Instagram share handover (`InstagramShare.swift:103-120`) and every
  download (highlights, reels, tag reels, `download-url`) — but these are
  rendered FROM the cut; only the tag reel is built from clip files.
- Cross-match tag reel (`tag-reel/route.ts`, `worker.py:6606-6609`): N cuts
  would have to be downloaded instead of N clips.
- Coach replay after the order closes (`review-media/route.ts:128-186`):
  the coach is admitted to the POINTS, not the match; a cut window needs a
  new access rule for the whole cut.
- Public coach sample page (`coach/[handle]/sample/page.tsx:61-82`): a
  public page showing only cited points; a cut window would put the whole
  match behind an unauthenticated URL.
- Detours for inserted cards (both platforms).

### Q3. Consumers that play the clip of a point whose `edited` is true, showing stale footage to a coach or public viewer

Named as a correctness problem:

1. **Public point link** — `/s/[token]` kind `point`: `resolve_share_link`
   returns `p.clip_path` with no `edited` filter
   (`153_share_raw_fallback.sql:100`, `:104-110`); `ShareView.tsx:87-103`
   plays it with no indicator. A stranger sees the pre-edit rally until the
   reclip lands; if the raw is gone, the clip becomes null and the link
   shows "Couldn't load the video." permanently.
2. **Public starred and tag links** — `resolve_share_starred`
   (`015:63-77`) and `resolve_share_tagged` (`036:237-255`) return
   `clip_path` regardless of `edited`; `ResolvedStarredPoint` has no
   `edited` (`shareData.ts:102-109`); `StarredView.tsx:44-51` plays them.
3. **Coach sample page (public)** — `resolve_sample_review`
   (`078:208-218`) filters `deleted` only; `SampleFinding.tsx:61-62` plays.
4. **Coach review replay** — `/api/review-media` (`:158-173`) signs cited
   clips regardless of `edited`; `PointReel.tsx:372-390` and iOS
   `CoachOrderStore.clipURLs` (`:508-527`) play them with no badge. Less
   severe (the coach cited that footage) but unlabelled.
5. **Linked coach on the match page** — `PointDetail.tsx:520-524` plays
   the old clip WITH an "Updating clip" badge; iOS `PointDetailScreen`
   likewise (`:133`, `:1125-1136`). Labelled; acceptable.
6. **Owner surfaces without a badge** — web `StarredPlayer.tsx:34-40`
   (only the tile says "Updating clip", `StarredView.tsx:317`); the web
   detour (`Player.tsx:1750-1758` filters on `clip_path` only) and the iOS
   detour (`PlayerTakeover.swift:3634`) will detour an edited inserted card
   to its stale clip, badge on the chip only.
7. **Reel manifests include edited points** (`reel/route.ts:386-398`,
   `tag-reel/route.ts:80-85`). In-match scopes render from the cut, so the
   clip only matters on the fallback; the tag reel renders the stale clip
   until the reclip's new key changes the manifest and forces a re-render
   (`tag-reel/route.ts:141-159`).

Correct today: `highlights.py:57` and `/api/highlights:77` exclude edited
points; `effectiveEnd` refuses to trim an edited point (`playhead.ts:141`).

### Q4. Consumers that assume clips are cut with specific pads

A clip produced elsewhere must keep `clip_t0 = max(0, t0 - effPre)` and at
least `t1 + effPost` of tail (with `effPad = effectivePad(pad, tight_start,
tight_end)`, `TIGHT_PAD = 0.3`), or these break:

**Clip-file-local (the file's own clock):**

- Web detour: `Player.tsx:1886-1895` (`at = t - cut_t0`, virtual
  `cut_t0 + clipTime`).
- iOS detour: `PlayerTakeover.swift:341-347`, `:3623-3660`.
- RTMPose extractors: `extract_match_structure_rtmpose.py:85-96`
  (`local_frame = round((source_time - clip_t0) * clip_fps)`), and
  `extract_side_changes_rtmpose.py:38-60` imports the same helpers.
- Thumb seek `(t1 - t0)/2` into the clip: `worker.py:4723`,
  `backfill_thumbs.py:74` (assumes the clip opens shortly before t0).
- Poster frame 0.4–1.5s in: `StarredView.tsx:149-153`,
  `Starred.swift:65-68`, `StarredScreen.swift:329-331`.
- Research: `ServeAccuracy.tsx:864-876` pairs clip playback with tracks
  keyed by point (clip-local time).
- Reel/story clip fallback plays the whole file (`worker.py:6092-6113`,
  `:6321-6336`) — the pads define what the viewer gets.

**Cut-clock, built on `cut_t0 == t0 - effPre` (must stay true whoever
cuts the clip, because the reel's cut segment is defined as "exactly what
the preview clip shows", `reel/route.ts:40-46`):**

- `clipEdit.ts:13-59` (frozen `CLIP_PAD`, `clipPad`, `TIGHT_PAD`,
  `effectivePad`); `playhead.ts:41-56`, `:131-171`, `:329-334`, `:354-368`;
  `Playhead.swift:21-60`, `:123`, `:146`.
- `/api/reel` segments `:413-424`; `SharePointSheet.swift:379-386`
  (mirrors them, "keep rule-identical" `reel/route.ts:410-412`).
- `ModifyClip.tsx:60-66`, `InsertPoint.tsx:266` via `insertGeometry.ts`,
  `MatchView.tsx:1044`, `Player.tsx:651-656`, share page
  `page.tsx:145-154` (`resolve_share_clip_pads`), `HighlightsSheet.swift:88`,
  `CoachFindingsView.swift:205`, `:644`.

And the two facts a "keep the pads" rule has to reckon with: the worker's
pre pad is exact but its post pad is dynamic (`points_pipeline.py:291`,
`:3040`), and the app reads the static `matches.clip_pads` for both, so a
clip cut to the static pair is shorter than today's, while a clip cut
longer than the static pair is harmless to every consumer above (they all
clamp or play whole).
