# Preview the original where the cut has a hole

Status: proposed, 2026-09-10. Web and iOS. No worker change.

## Why

The cut video is built from the point cards. Since the body-first assembler and
the 2026-09-09 card-edge change (a card now closes 1.5 s after the ball goes
dead instead of running on), cards got shorter, their padded windows stopped
touching, and the cutter stopped merging them into one span. The waiting between
rallies is now genuinely absent from the cut. That is the dead-space cut finally
working, and it is the direction we want.

Measured on production, same `clip_pads` throughout:

| match | assembler | cut segments | kept | seams continuous |
| --- | --- | --- | --- | --- |
| Koko 2 | ball (v2) | 13 | 93% | 81% |
| Koko 2 (GPU) | bodies | 52 | 48% | **2%** |
| Julian | ball | 39 | 70% | 50% |
| Julian (re-run) | bodies | 55 | 63% | 25% |
| Yu Yu Lin | ball | 38 | 78% | 62% |
| Yu Yu Lin (re-run) | bodies | 97 | 67% | 21% |

`InsertGeometry.swift:11` records the old world: "Measured over 9,433 seams in
production, 55% are continuous." It is now about 20%, and 2% on an end-on
camera. Two owner surfaces were living off that slack:

- **Add a missing rally** offers a window it cannot play. On screen: `8.1s · 8s
  not available`.
- **Adjust** can no longer follow a handle into a neighbour's footage. Points
  boxed in on both sides went 7% -> 95% on Koko 2, 12% -> 64% on Yu Yu Lin,
  22% -> 55% on Julian.

**Nothing saved is wrong.** The worker already re-cuts from the original
whenever the cut cannot be proven to hold the window (`_CutMap`,
`worker.py:5769`: "Anything else is not provably in the cut and goes to the
original"). This is a preview defect on both sheets, not data loss.

## What already works, and must not be rebuilt

`POST /api/media-url { matchId, rawPreview: true }` already returns
`{ url, available, trimStartS }`: a six-hour inline presigned GET of the stored
original plus the head-trim offset (`route.ts:320-365`).

**Both Add-a-rally sheets already use it** — `InsertPoint.tsx:104-142` and
`InsertSheet.swift:424-450`. They open on the cut where the seam is continuous
and reach for the original only where the cutter removed time, and they already
add `trimStartS`. The design in this spec is shipped; it is failing for reasons
below. Do not write a second path.

## The three defects

### 1. The route refuses the job-row fallback, so the original is invisible on a third of the library

`rawPreview` reads `matches.raw_path` and deliberately declines to fall back to
the source job's `input_path` (`route.ts:321-335`). The reasoning was sound for
the Original pill: a control that opens on nothing is worse than no control.

Measured today: **64 of 194 ready matches have `raw_path` NULL, and 56 of those
have a job row whose `input_path` still names an object that exists.** That set
includes every lab re-run of 2026-09-10 — Koko (crop fix), Julian (re-run),
Yu Yu Lin (re-run), Chris (re-run) — because a job inserted directly rather than
through the upload path never writes the column.

So the sheet asked for the original, was told `available: false`, fell back to
the cut and printed "8s not available". The feature was there; the pointer was
missing.

**Fix.** Coalesce `matches.raw_path` -> `jobs.input_path` via `matches.job_id`.
Keep the `headObject` check exactly as it is, so a legacy raw that really was
swept still answers `available: false` honestly and the pill still refuses to
draw. `admin_match_raw_path` already does this for the players portal; copy its
shape, not its breadth (see defect 2).

### 2. The trim offset is read under the caller's own RLS, so a coach silently gets the wrong footage

`trimStartS` comes from `jobs.options->>'trim_start_s'` read through the
**caller's** Supabase client (`route.ts:352-364`), and `jobs` SELECT is
owner-only (`001_init.sql:52-55`). A coach passes `has_match_access()`, reads
the match, receives the original, and receives `trimStartS: 0`.

On a trimmed match that is up to 298.7 s of error with no failure anywhere. It
is latent only because both sheets are owner-gated today.

**Fix.** Resolve the trim in a `SECURITY DEFINER` function keyed on
`matches.job_id`, so the answer does not depend on who is asking. The file is
already being handed over; the number that makes it readable must not be the
part that fails closed.

**And keep the lookup narrow.** `matches.job_id` is the only correct pointer. A
match can carry several jobs — 71930254 carries two at 298.7 s and 14.5 s,
Yu Yu Lin (re-run) carries five. Generalising the trim lookup the way the admin
raw lookup generalises would put every mark minutes out.

### 3. Adjust does not do this at all

`ModifySheet.swift:1084-1094` and `ModifyClip.tsx` take the cut URL and only the
cut URL. `playableBounds` correctly reports that the handle cannot leave the
clip, the caption correctly says so, and the saved file is correctly cut from
the original. The preview is the only thing missing.

**Fix.** Give Adjust the same source switch the insert sheet has: cut where
`contiguousCutBounds` holds the draft window, original otherwise, offset by
`trimStartS`. `adjustBeyondClip` already computes exactly the condition.

## Settled, and not reopened here

- **One door.** The original is reached through `/api/media-url
  { rawPreview: true }` and nothing else. No new route, no new RPC, no
  service-role read. "Only our own code calls this" has never been what keeps a
  row private (`CLAUDE.md`).
- **Share links stay on the cut.** `/api/share/media` signs `raw_path` only
  where `cut_path` is null. A share viewer is a stranger and the original holds
  everything the cut removed.
- **Both sheets stay owner-only.** The offer builders are the access boundary
  today (`MatchView.tsx:3018`, `PlayerTakeover.swift:2282/:2314`,
  `canScore = isOwner && hasCutOffsets`). The route is deliberately coach-open,
  so the gate is the surface. **Putting an original-backed preview anywhere a
  coach can see is a new exposure decision and needs Adil.** A coach seeing
  clips is footage the player curated; a coach seeing the original is warm-up,
  conversations, bystanders and the neighbouring table.
- **Retention.** A raw referenced by a live match row never ages out, whatever
  its age. Nothing here depends on a clock.
- **Cost.** R2 charges nothing for egress, the cost vocabulary has no egress
  unit, and the account's class-B operations run at about 5.7% of the free tier.
  Range requests work: `presign` signs `host` alone, so `Range` passes through
  unsigned, and Starred already reads poster frames this way.

## Traps this walks into

- **Seek storms.** The original is the largest, longest-GOP file in the system.
  iOS already caps to one in-flight seek because exact seeks queued dozens of
  network decodes, and a zero-tolerance seek storm has SIGKILLed the app with no
  crash report. Adjust scrubs continuously; keep the cap.
- **Codecs.** 43 of 98 originals are HEVC, AV1 or VP9, which desktop browsers
  refuse. Without a named undecodable state the sheet shows a black rectangle.
  The existing "watch it on your phone" copy is wrong here, because a working
  cut is one tap away: offer that instead.
- **No frame reads.** The raw bucket answers CORS with nothing, so canvas
  capture, sketches and drawing all fail against the original. Anything that
  grabs a frame must stay on the cut.
- **Do not clear `src` in an effect cleanup** (StrictMode remounts with no
  source), and pause on unmount: a `<video>` removed from the document keeps
  playing with sound.

## Order of work

1. Route: the `job_id` fallback and the definer-read trim, plus one migration.
   This alone fixes Add-a-rally on 56 matches, including every one being tested
   this week.
2. Backfill `raw_path` for those 56 so the Original pill is right too.
   `worker/backfill_raw_path.py` is the existing tool; check whether it covers
   the direct-insert case before extending it.
3. Adjust's source switch, web and iOS together.
4. The undecodable state on desktop web.

Steps 1 and 2 are small and independent of 3. Ship them first.

## How we would know it worked

- On Koko (crop fix), the "+" between two cards plays the footage instead of
  printing "8s not available".
- On a trimmed match (Yu Yu Lin, 243 s), the preview opens on the right rally
  rather than four minutes early. This is the one that silently regresses, so it
  needs a test with a real trimmed match, not a synthetic one.
- Adjust's handle follows past the clip edge on a point boxed in on both sides.
- `available: false` still comes back for a legacy match whose raw really was
  swept, and the Original pill still refuses to draw on it.
