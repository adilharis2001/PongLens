# Trimming the warm-up before processing

**Status:** building
**Surfaces:** iOS (record + upload), desktop web, mobile web
**Date:** 2026-08-30

---

## What is already true

The trim is not a new capability. It has existed end to end since
migration 096 and it is in production use.

- `claim_processing` takes `p_trim_start_s` / `p_trim_end_s` and writes
  them into `jobs.options`, recharging the job from the kept window.
- `POST /api/process` accepts `trimStartS` / `trimEndS`
  (`src/app/api/process/route.ts:43`).
- The worker cuts the working copy to that window before anything
  expensive runs (`apply_trim` / `apply_source_trim`, `worker/worker.py:3429`).
- The web upload card already offers it: a collapsed "Trim it first" row
  with a live local-file preview and a two-handle bar
  (`src/app/dashboard/UploadCard.tsx:1539`).

Measured in production on 2026-08-30: **106 jobs carry a trim window, 18
have a real head cut.** Average head cut 1:42, largest 4:59.

So this is not "build a trimmer". It is "put the existing trimmer in
front of the two doors that never got it, and make the reason for it
legible on the two that did".

## Where it is missing

- **iOS record.** No trim anywhere in the post-record flow.
- **iOS upload.** No reachable trim. `RawTrimBar` exists
  (`ios/PongLens/PongLens/Components/RawTrimBar.swift`) but only on the
  match detail screen, and both iOS upload paths pass `processOn: true`,
  so processing fires the moment the upload lands and that screen is
  never the next thing the owner sees.
- **A promise the app does not keep.** `AccountScreen.swift:327` already
  tells the owner that "trimming off the warm-up first uses fewer"
  minutes. On iOS today there is no way to do that.

---

## The design

### One surface, because there already is one

`MatchDetailsSheet` (`RecordScreen.swift:1093`) is the single sheet both
iOS doors open — recording at `RecordScreen.swift:439`, library upload at
`UploadScreen.swift:125`. Adding the trim there covers both entry points
with one implementation, one set of copy, and one thing to test.

It goes in the existing **Processing** section, directly under the two
toggles, because it is the third processing decision and it only means
anything when `processOn` is true. It is disabled when processing is off,
exactly like the placement toggle.

### Default off, and it stays a number

A collapsed row reading **"Whole video"** until touched. This matches the
web, and it is the honest default: most videos do not need it.

The trim is **never applied to the bytes**. The file uploads whole and is
stored whole. The chosen window rides on the process request and the
worker cuts a working copy. Three reasons this is the only sane option
here:

1. **The upload has already started when the sheet opens.** Both flows
   deliberately begin uploading before asking any question, so the owner
   fills in details during dead time rather than watching a spinner.
   Cutting the file first would mean holding the upload back.
2. Re-encoding a 45-minute capture on the phone costs battery, heat and
   minutes for no gain the worker cannot deliver for free.
3. The worker's cut is a **stream copy** — no frames are decoded, so it
   is seconds on a long file.

### The timebase, and the one rule that must not be broken

Once a job carries a window, **every timestamp the pipeline writes is in
the trimmed clock.** A rally four minutes into the real video is stored
as starting at zero. Anything that later reads those timestamps against
the untrimmed original lands short by exactly the warm-up length, on
every point, and looks plausible rather than broken.

The worker already knows this: `apply_source_trim` exists so reclips and
placement backfills re-cut the same window first. **Nothing in this change
introduces a new consumer of those timestamps**, so the rule is preserved
by not touching it.

(Separately: `worker/research_reprocess.py` does not honour trim windows
and therefore misdraws the review pages on trimmed matches. Pre-existing,
out of scope here, recorded so it is not lost.)

### The 45-minute roll

`Recorder` rolls to a fresh file at 45 minutes, and each file registers as
its **own match**. A warm-up is at the front of the session, not at the
front of part 3.

**Rule: the trim window applies to the first item of the session only.**
`updateTrim` targets the lowest-`capturedAtMs` item; later parts process
whole. Getting this wrong would silently chop four minutes off the head of
every part of a long match.

### Duration, and why the row can be trusted

The bar needs a duration before it can draw. Both flows already have one:
`QueuedRecording.durationS`, set at enqueue. The preview player reads the
local file through `RecordingQueue.fileURL(item)` — the same file that is
mid-upload — so scrubbing is instant and offline.

If the duration is missing or zero the row does not appear at all. A trim
bar over an unknown length is a control that cannot be honest.

### Cost

`processingFootnote` currently charges from raw duration. It must charge
from the **kept window**, or the sheet quotes a number the invoice will not
match. Same rounding as today: whole minutes, ceiling, one-minute floor.

Note in passing: because of that rounding, a short trim often saves
nothing. The copy therefore leads on **what gets processed**, not on
money.

---

## Copy

Same words on all four surfaces.

- Row label: **"Trim it first"** — kept from the web. It is accurate for a
  two-handle control; "warm-up" alone would be narrower than what it does.
- Collapsed value: **"Whole video"**, or the kept length once set.
- Footer: **"Most videos open with a warm-up. Trim it off and it will not
  be processed."**

The footer is the actual change in discoverability. The control was always
there; nothing told anyone why they would open it.

---

## Scope

**iOS**
1. `QueuedRecording` gains `trimStartS` / `trimEndS`.
2. `RecordingQueue.updateTrim(sessionId:start:end:)`, first item only.
3. `ProcessReq` sends the window.
4. `MatchDetailsSheet` gains the row, the preview and the bar; the cost
   footnote charges from the kept window.

**Web** — the footer line on the existing row. Nothing structural: this
control works and people are using it.

**Worker / database** — nothing. Both already honour the window.

## Out of scope

- YouTube imports (no local file to scrub).
- Cutting the stored original.
- Frame-exact starts. A stream copy begins at a keyframe, so the real
  start can land a few seconds early — never late. The copy does not
  promise an exact second.
