# Sharing to Instagram — design and implementation plan

Status: proposed, 2026-08-24. Nothing built yet.
Framing review: `docs/research/instagram-framing.html`.
Meta app: `1012434688493595` (Business type, no Live toggle exists for it).

---

## 1. What this is

A player finishes a match, finds a rally worth showing, and puts it on
Instagram without leaving PongLens or touching a file.

Three things ship, in this order:

| | What the player does | Instagram format |
| --- | --- | --- |
| **A** | Shares one rally | Story |
| **B** | Shares their starred rallies as one video | Reel |
| **C** | Shares a match recap | Reel |

C is B with a different rule for picking points, so it is nearly free once
B exists. It is listed separately only because the picking rule needs its
own decision.

**Not building:** Meta's Content Publishing API. It needs an Instagram
Professional account, App Review, business verification and publicly hosted
media, and it posts without the player ever seeing Instagram's composer.
Worse product, far more work, and most competitive players have personal
accounts. Revisit only if a coach with a business account asks for
scheduled posting.

---

## 2. The mechanism

Not an API. The app writes the video to the iOS pasteboard under keys Meta
defines, then opens Instagram's URL scheme. Instagram reads the pasteboard
and opens its own composer with the video already loaded. The player adds
stickers or music and posts it themselves.

```
Story   instagram-stories://share?source_application=<appID>
        com.instagram.sharedSticker.backgroundVideo   (NSData, the mp4)
        com.instagram.sharedSticker.appID             (NSString)

Reel    instagram-reels://share
        com.instagram.sharedSticker.backgroundVideo   (NSData, required)
        com.instagram.sharedSticker.appID             (NSString, required)
        com.instagram.sharedSticker.stickerImage      (optional overlay)
```

Pasteboard items are written with `UIPasteboard.OptionsKey.expirationDate`
set five minutes out, per Meta's sample.

Works with any Instagram account, personal included. No OAuth, no tokens,
no App Review.

### Platform limits that shape the product

| | Story | Reel |
| --- | --- | --- |
| duration | **20 s max** | 3–60 s |
| resolution | up to 1080p | 1080p |
| size | under 50 MB recommended | under 50 MB recommended |
| codecs | H.264 / H.265 / WebM | H.264 / H.265 / WebM |
| how many at once | **one** | **one** |

**One asset per handover.** There is no way to give Instagram three
Stories in one go. That is why B stitches rather than posting a sequence.

Measured against the real library (8,102 visible points, 26 matches with
stars):

- median rally with pads **7.7 s**, p95 **15.8 s**, longest 94.8 s;
- **only 2.0% of rallies exceed the 20 s Story cap** (160 of 8,102);
- starred sets average 3.1 points / 29.1 s; **3 of 26 exceed 60 s.**

So the Story path fits 98% of rallies untouched, and the Reel path fits
88% of starred sets. Both caps need handling, neither is a blocker.

### Where the documentation is unreliable

Called out rather than guessed:

1. **Instagram's Stories page lists a background *video* asset but never
   names its pasteboard key.** The Reels page and the Facebook equivalent
   both use `...backgroundVideo`, and every third-party implementation uses
   it for Stories too. **Verify on a real device in Phase 0 before
   anything depends on it.**
2. **20 s vs 60 s.** The pasteboard docs cap Story video at 20 s while
   Instagram itself and the publishing API both allow 60. Unexplained.
   Treat 20 s as real until measured.
3. **"Go Live" applies to app types that have modes.** The Reels page says
   the Meta app must be Live. Business-type apps have no such toggle — they
   use access levels. Our app has no Live state to be in. Whether Instagram
   accepts the App ID anyway is unverified; fallback is a second app under a
   type that has modes.

---

## 3. What the player sees

### iOS — share one rally

Point detail already has a four-button action bar
(`Screens/PointDetailScreen.swift`, `actionBar`): Share · Modify ·
Boundary · In match · Remove. Today **Share** mints a public link and drops
straight into the system share sheet.

That button becomes a small sheet, matching the web's ShareSheet idiom:

```
Share this point
─────────────────────────────
  Instagram Story          →      (hidden when Instagram is absent)
  Save to Photos           →
─────────────────────────────
  Copy link
  Share link…                     (the current behaviour, unchanged)
```

Tapping **Instagram Story**:

1. row shows `Preparing…` with a spinner, the sheet stays open;
2. server renders the vertical clip (§5);
3. on ready, the app downloads it, writes it to the pasteboard, opens
   Instagram;
4. sheet dismisses.

If the render takes more than a couple of seconds the row says
`Preparing… this takes a few seconds`. If the player backgrounds the app,
the render continues and the row is ready when they return.

### iOS — share highlights

Two entry points, same action:

- **Starred shelf** (`Screens/StarredScreen.swift`) — a `Share to
  Instagram` button in the header beside the existing controls. Scope is
  every starred point across every match, capped (§7).
- **Match tools → Export sheet** (`Screens/MatchTools.swift`,
  `ExportSheet`) — the existing rows are *downloads*. A new section above
  them:

```
Send to Instagram
  Starred points          Reel · 6 rallies · 41s      [ Share ]
  This match              too long for a Reel         (disabled)
Export
  Full match              …                           [ Create ]
  Starred points          …                           [ Create ]
  Raw match               …                           [ Download ]
```

### Web

The pasteboard handover is iOS-app only. The web app cannot open
Instagram's composer with a file. What it can do:

- **Mobile web** (80–90% of usage): render the same vertical file, then
  `navigator.share({ files: [file] })`. On iOS Safari this surfaces
  Instagram in the system share sheet. Two taps instead of one, same
  result.
- **Desktop**: no share target. Falls back to a download with the filename
  `<opponent>-point-<n>-story.mp4`.

Placement in `ShareSheet.tsx`: a new **Send to** section above the existing
link rows. Its docstring currently says "nothing here produces a file" —
that stops being true and must be rewritten, not quietly contradicted.

The **Export** row (`ReelBar.tsx`) is unchanged. Export makes files you
keep; Share sends somewhere. Instagram is a destination, so it lives in
Share even though a file is produced on the way.

---

## 4. What gets rendered

A 1080×1920 canvas.

```
┌─────────────────────────┐  ← Instagram draws its own header over
│      (breathing room)   │    roughly the top 250px. Nothing of ours
│                         │    goes there.
│  ADIL                   │
│  vs Marco       8 – 6   │  ← top band: names + score
│                 11-9    │
│ ┌─────────────────────┐ │
│ │                     │ │
│ │   the rally         │ │  ← cropped to the table (§5), full width
│ │                     │ │
│ └─────────────────────┘ │
│                         │
│      ◯ PongLens         │  ← bottom band
│                         │
│      (breathing room)   │  ← Instagram's reply bar sits here
└─────────────────────────┘
```

Ground is the product's ink `#0A0A0F` with the arena bloom, so the bands
read as a designed card rather than letterboxing. Accent cyan `#22D3EE` on
the player's own name only.

Reuses the existing reel card drawing helpers in `worker.py`
(`_reel_scorebug`, `_reel_watermark`, `_draw_lens_mark`), which already
take a width and height.

**Score comes from `gameScore.ts` via the manifest, exactly as the existing
reel does.** No second implementation. When the match has no confirmed
winners, `showScore` is already forced off upstream; the band then carries
names only.

The highlight Reel additionally gets the existing title card, per-rally
scorebug, crossfades and outro — `render_reel` already does all of it.

---

## 5. The crop

Measured across 16 matches with the current detector; see the framing
review page for what each one looks like.

```
1. corners from calibration (A near-left, B near-right, C far-right, D far-left)
2. refuse unless the quad passes the confidence gate (below)
3. px_per_m from whichever real edge runs horizontally:
      side-on  -> mean(|BC|,|AD|) / 2.740
      end-on   -> mean(|AB|,|DC|) / 1.525
4. want_w = table_bbox_width + 2 * MARGIN_M * px_per_m
5. clamp: >= 1080 / MAX_UPSCALE, <= frame width, and (safe mode) >= 0.75 * W
6. centre on the table bbox centre, clamp inside the frame
7. keep full source height
```

Constants: `MARGIN_M = 1.6`, `MAX_UPSCALE = 1.35`, `MIN_SRC_W = 1280`.

**Confidence gate, on top of the detector's own.** The ladder's threshold
was tuned for placement maps, where a few pixels of corner error nudges a
dot. Framing fails differently: if corners wander between frames the crop
*centre* is uncertain, and a crop that cuts a player out is visible to
everyone who sees the Story.

```
require frames_used >= 4
require spread_px <= 0.01 * frame_width
```

This can only ever fall back to no crop. It cannot make a frame wrong,
only decline to improve one. On the 16-match sample it declined 3.

**Never crop when:** no calibration, gate not passed, source under 1280px
wide, or the source is already portrait. All fall back to the centred full
frame, which is what we would have shipped without the crop at all.

**Open decision — safe or tight.** Safe never removes more than a quarter
of the width and keeps every player on all 16 samples, filling 42% of the
Story. Tight fills 65%. See §11.

---

## 6. Where the work happens

**Everything renders on the server.** One implementation of the crop and
the frame, full-resolution source, and it is the only option that also
serves the web. An on-device AVFoundation path would be faster for a single
rally but would put the frame design in Swift *and* ffmpeg — the same shape
of problem as the placement mirror living in `Placement.swift` and
`placementAggregate.ts` and being wrong the same way in both.

Latency is acceptable because ffmpeg range-seeks the cut video over its
presigned URL rather than downloading it. Measured during the framing
review: a full-resolution frame came back in about two seconds from a
17-minute match, without fetching the file.

```
queue pickup      up to 15 s   (worker poll interval)
segment fetch       2–3 s      (range request, not a download)
encode              1–2 s      (h264_videotoolbox)
upload              1–2 s
                  ~20–25 s typical
```

If that proves annoying in use, the fix is a shorter poll or a fast lane —
not a second renderer.

---

## 7. Data model

### `matches.story_crop jsonb` (new)

```json
{ "x": 535, "y": 0, "w": 1244, "h": 1080,
  "camera": "side-on", "frames": 15, "spread": 1.6, "src_w": 1920 }
```

`null` means no usable crop. Written by the worker in `run_points_stage`
straight after calibration — no extra inference, the corners are already in
hand. Read directly by both clients through the existing `matches` RLS
policy; **no new API route.** Add to `MatchRow.librarySelect`
(`Core/Models.swift`) and to `Match` in `src/lib/types.ts`.

### `match_reels` scopes (extended)

Already keyed `(match_id, scope)` and already carries a non-uuid scope form
(`tag:<uuid>`), so vertical renders follow the same pattern:

- `v:point:<point_uuid>` — one rally, 9:16
- `v:starred` — starred points, 9:16

`enqueue_reel`'s scope regex needs both. Manifest gains
`"format": "story" | "reel9x16"` so the worker picks the canvas.

### Retention

**Single-rally vertical renders must be swept.** A player who shares twenty
rallies creates twenty rows and twenty R2 objects, all cheaply regenerable.
Add a tier to `retention_sweep()`:

```
r2://ponglens-media/reels/v-point-*      7 days
```

with the matching `match_reels` rows deleted. `v:starred` follows the
existing reel lifetime.

### Ledger and metering

Bytes book to `storage_ledger` kind `'reel'` with `match_id` set, so the
existing match-delete trigger frees them. Cost metering gets a
`story_encoding` stage beside `reel_encoding`.

---

## 8. iOS implementation

### Info.plist

```xml
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>instagram-stories</string>
  <string>instagram-reels</string>
</array>
<key>FacebookAppID</key>
<string>1012434688493595</string>
```

**Put these in `PongLens/Info.plist`, the real file, not in
`INFOPLIST_KEY_*` build settings.** `INFOPLIST_KEY_UIBackgroundModes`
already expanded to nothing on this project once. **Verify by reading the
built app's Info.plist**, never the build setting.

### New file: `Core/InstagramShare.swift` (~90 lines)

```swift
enum InstagramShare {
    static var isAvailable: Bool          // canOpenURL on both schemes
    static func shareStory(videoURL: URL) async -> Bool
    static func shareReel(videoURL: URL) async -> Bool
}
```

Writes `Data(contentsOf:)` to the pasteboard under the two keys with a
five-minute expiry, then `UIApplication.shared.open`. Returns false when
the scheme will not open, so the caller can fall back to the system share
sheet.

### Changed files

| File | Change |
| --- | --- |
| `Screens/PointDetailScreen.swift` | Share button opens a row sheet instead of minting a link directly; adds the Instagram and Save to Photos rows |
| `Screens/MatchTools.swift` | `ExportSheet` gains a "Send to Instagram" section above the download rows |
| `Screens/StarredScreen.swift` | header gains a Share to Instagram button |
| `Core/Models.swift` | `MatchRow` gains `storyCrop`; add to `librarySelect` |
| `Core/PointActions.swift` | render request + poll helper |
| `PongLens/Info.plist` | the keys above |

### Polling

The render is a `jobs` row. The app already polls `match_reels` in
`loadReels()`. Reuse it: poll every 1.5 s while a share is in flight, give
up at 90 s with "Couldn't prepare that clip. Try again."

---

## 9. Web implementation

| File | Change |
| --- | --- |
| `src/components/ShareSheet.tsx` | "Send to" section; rewrite the docstring's file claim |
| `src/app/api/reel/route.ts` | accept `format: 'story' \| 'reel9x16'`, `pointId`; build the single-point manifest |
| `src/app/api/media-url/route.ts` | sign `v:` scopes (the scope param already exists) |
| `src/lib/types.ts` | `Match.story_crop` |
| `src/app/match/[id]/MatchView.tsx` | pass the new props through |
| `src/app/starred/…` | share button on the shelf |

`navigator.share` with a `File` is feature-detected via
`navigator.canShare({ files })`; desktop falls through to a download.

---

## 10. Worker implementation

| File | Change |
| --- | --- |
| `worker/points_pipeline.py` | `story_crop_window()` beside `_canonical_calibration_geometry`; emit into `match.json` |
| `worker/worker.py` | `run_points_stage` writes `matches.story_crop`; `render_reel` gains a vertical target; `retention_sweep` gains the story tier |
| `worker/backfill_story_crop.py` (new) | re-runs the current detector on existing matches and fills `story_crop` |

### `render_reel` vertical target

The filter chain is the only real change. Today:

```
scale=tw:th:force_original_aspect_ratio=decrease,pad=tw:th:...:black
```

Vertical:

```
crop=<w>:<h>:<x>:<y>, scale=1080:-2, pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#0A0A0F
```

with the band artwork overlaid as PNGs, the same way the scorebug and
watermark already are.

### Backfill

~130 matches × ~16 s of CPU inference ≈ 35 minutes, one-off, off-peak.
Idempotent, safe to re-run, writes only `story_crop`. Follows the
`backfill_placement_v3.py` pattern: dry-run a named canary first, confirm
no other field moved, then the rest.

---

## 11. Edge cases

Every one of these is either handled or deliberately accepted.

**Availability**
1. *Instagram not installed* — `canOpenURL` false, row hidden, system share
   sheet remains.
2. *Offline* — render is server-side; row shows "You're offline".
3. *Instagram installed but the scheme is refused* — fall back to the
   system share sheet with the file, do not fail silently.

**Content**
4. *Point has no clip* — 647 of 8,102 visible points (8%). Row disabled
   with "This rally has no video."
5. *Rally over 20 s* — 2% of points. Offer it as a **Reel** instead
   (60 s), which needs no trimming. Only above 60 s is it refused.
6. *Starred set over 60 s* — 3 of 26 matches. Offer the first N rallies
   that fit and say so plainly: "First 7 of 11 rallies — a Reel can hold
   60 seconds."
7. *Match still processing* — no share affordance.
8. *Cut video swept at 30 days* — fall back to the 720p preview clip and
   skip the crop, since a cropped 720p source is too soft to publish.
9. *Portrait-native source* (608×1080 exists in the library) — no crop,
   fills the canvas.
10. *Source under 1280 wide* — no crop.
11. *No calibration or gate not passed* — no crop, centred frame.

**Correctness**
12. *Score not confirmed* — names only, no score. Mirrors the existing
    `showScore` forcing.
13. *Names missing* — the fallback chain in `/api/reel` already resolves
    account first name → "Player" / "Opponent".
14. *Point edited after a render* — the manifest freshness check already
    re-renders.
15. *Match deleted mid-render* — the equivalent of
    `check_match_row_alive`; job ends without emailing.

**Abuse and cost**
16. *Rapid repeat taps* — button-local busy state, plus the existing
    manifest freshness check returns the cached render.
17. *Queue flooding* — `claim_processing` caps a user at 4 active jobs;
    `enqueue_reel` has **no such cap**. Add one, or story renders can
    starve a user's own processing queue.
18. *Storage growth* — the 7-day sweep above.

**Platform**
19. *Pasteboard 5-minute expiry* — write it immediately before opening
    Instagram, never earlier.
20. *Paste banner* — iOS shows "Instagram pasted from PongLens". Expected,
    unavoidable, every app doing this has it.
21. *App Store review* may ask why we query Instagram's schemes.
22. *Instagram re-encodes anyway* — do not over-tune bitrate.

**People**
23. *Not the owner* — a coach viewing a shared match gets **no** Instagram
    row. Publishing someone else's footage is theirs to decide.
24. *The opponent is identifiable.* Terms §"you confirm you have the right
    to share footage of…" appears to cover it, but it was written for
    private share links, not public posting. **Needs a read-through before
    launch** (§12).

---

## 12. Rollout

**Phase 0 — prove the undocumented bit (half a day).**
Hard-code one existing mp4, write it to the pasteboard, open Instagram on a
real iPhone. Confirms the Stories `backgroundVideo` key works, that the
Business-type App ID is accepted, and that 20 s is the real cap. **Nothing
else starts until this passes.**

**Phase 1 — one rally to a Story.**
Crop rule + `story_crop` column + backfill + vertical render + the iOS
sheet. Ship behind `app_config.instagram_sharing` so it can be turned off
with one UPDATE.

**Phase 2 — starred rallies as a Reel.**
Mostly manifest work; `render_reel` already stitches.

**Phase 3 — web.** `navigator.share` path for mobile web.

**Phase 4 — match recap.** Needs a point-picking rule, which is a product
decision, not an engineering one.

### Testing

- `worker/tests/` — crop maths against the 16 hand-checked frames, with
  the expected window pinned per match, in the spirit of
  `ios/Tests/fixtures/serve-parity.json`.
- `npm run test:starred` — extend for the manifest builder.
- Manual on a real device: Instagram installed, not installed, offline,
  20 s rally, 90 s rally, no-clip point, uncalibrated match, coach view.
- The QA library (`src/lib/qa/testLibrary.ts`) gains a `sharing` area case
  set, written the way the rest of that file is — with the `why`.

---

## 13. What I need from you

**1. Safe crop or tight crop.** The one blocking decision. Safe keeps every
player on all 16 samples and fills 42% of the Story; tight fills 65% and
can cut a player on close-camera shots. My recommendation is **tight**, now
that the calibration is corrected — the case that worried me last time was
a calibration bug, not a framing one. Open the review page before
answering.

**2. What goes in the top band.** Proposed: your name, "vs <opponent>", and
the score entering the rally. Alternatives: no score, or add the venue or
date. Everything there comes from data we already have.

**3. Does the outro card belong on a single rally?** The highlight Reel
gets the existing title and outro cards. On a 7-second Story an outro
would eat a fifth of the video. Proposed: no outro on Stories, keep the
small PongLens mark in the bottom band.

**4. Should sharing cost minutes?** Every other render in the product is
metered against the processing balance. A story render is a few seconds of
CPU. Proposed: **free**, because a share button that charges will not get
used, and virality is the point. Your call, since it is your compute.

**5. Terms read-through.** The sharing clause was written for private
links to a named coach. Posting to Instagram is public and the opponent is
identifiable. I do not think this needs new legal text, but it needs you
to read the clause with public posting in mind.

**6. Phase 0 needs a real iPhone with Instagram installed** and signed in.
The simulator cannot test this — there is no Instagram app to open. If you
can run that ten-minute check yourself, or leave a device connected, that
unblocks everything.

**Not needed from you:** anything further on the Meta side. The app is
created and correctly configured.
