# Watching the original upload

**Status:** proposed, not built. Second revision, after Adil confirmed the
Cloudflare lifecycle rules and decided that coaches may watch the original
too. Both of those changed the design.

Measured against production: 140 processed matches, a full listing of the
live `ponglens-raw` bucket, `ffprobe` over all 86 distinct originals, and
`pg_get_functiondef` on the live access policy. Two load-bearing claims were
put through an adversarial pass and both came back corrected — see
[The two corrections](#the-two-corrections).

---

## The thing nobody expected

We already keep the original. Permanently. And we already charge for it.

`r2_raw_sweep` walks the raw bucket every 24 hours and deletes anything older
than 30 days, except this, at `worker/worker.py:7018-7034`:

```python
# Commerce (096): a raw referenced by a live library row is the
# user's stored video — it never ages out.
cur.execute("select raw_path from public.matches where raw_path = any(%s)", (paths,))
library_paths = {row[0] for row in cur.fetchall()}
...
    if path in library_paths:
        continue
```

The `continue` has no age term. Nothing on the success path ever clears
`matches.raw_path`: the only statement in the repo that nulls it is the
content-gate rejection at `worker/worker.py:6466`, which deletes the file at
the same moment. There is a test that puts a library raw at **400 days** old
and asserts it survives (`worker/tests/test_raw_retention.py:209`).

The Privacy Policy already says so, at `src/app/privacy/page.tsx:121`:

> **Your uploaded videos and cut videos:** kept while your account is active
> and the video is in your library. They count toward your storage
> allowance, and deleting a video removes both and frees the space.

So this is not a retention feature. It is a **playback** feature. The file is
there, the promise is published, the storage is billed. The original is 61%
of what an owner pays for in storage (612 MB against a 388 MB cut) and it is
the only thing they cannot see.

### The Cloudflare rule is settled, and it is harmless

The bucket carries exactly one lifecycle rule: **Default Multipart Abort
Rule — abort uploads after 7 days**, no prefix. That is
`AbortIncompleteMultipartUpload`, which discards the *parts* of a multipart
upload that never finished. It has no verb that can touch a completed object.
Cloudflare puts it on every R2 bucket by default.

Adil's guess was right. It cleans up abandoned uploads and nothing else, so
the retention premise holds: **an original stays until the player deletes the
match.**

The codebase already knows about this rule and budgets against it:
`src/app/dashboard/pendingUploads.ts:21` sets the browser's resume window to
6 days with the comment "R2 aborts incomplete uploads at 7d". (iOS does not —
see [Found in passing](#found-in-passing).)

---

## What production actually looks like

| how the original is found | file present | file gone |
| --- | --- | --- |
| `matches.raw_path` (commerce-era, 2026-08-12 onward) | **71** | 0 |
| `jobs.input_path` only (older rows) | **27** | 33 |
| no pointer at all | 0 | 9 |

98 of 140 processed matches still have their original. The 27 legacy
survivors come from jobs dated 2026-07-30 to 2026-08-13, so the sweep takes
the last of them around **2026-09-12**. Every one of the 71 commerce-era
originals is alive, and always will be.

The raw bucket today: 158 objects, 62.4 GB. Median original 194 MB, p90
1.15 GB, largest 3.0 GB. 101 `.mp4`, 57 `.mov`.

### The number that decides whether this feels like it works

Availability is not the constraint. **Codec is.** I ran `ffprobe` over all 86
distinct live originals:

| codec | matches | plays where |
| --- | --- | --- |
| H.264 | 55 | everywhere |
| HEVC | 29 | Safari and iOS fine; Firefox never; Windows Chrome usually not |
| AV1 | 8 | recent hardware only |
| VP9 | 6 | Chrome yes, Safari no, AVPlayer no |

13 of the 29 HEVC files are 10-bit, which is the harder case again.

On iOS this barely matters: AVPlayer decodes H.264 and HEVC natively, so 84
of 98 play for certain. On the web it matters a lot, and it matters most in
the browsers Adil does not test in. **Safari and iOS hide this problem
completely.**

This is not a new problem the feature creates. It is the problem the existing
unprocessed-match player already has, on 16 matches, with a message already
written for it (`RawMatchView.tsx:99-100`, "the browser refused the raw file
(usually HEVC in a .mov)"). The feature takes the blast radius from 16 to 98,
and the message needs rewriting because it currently ends with "watch it on
your phone" — advice that makes no sense for a match that already has a
working cut.

Also: 26 of the 98 have their index written after the picture data, so there
is one extra round trip before the first frame. A startup delay, not a
failure.

---

## Coaches change the answer, and it changes my recommendation

The first draft of this spec recommended a **Tools row**, partly on the
grounds that Tools is owner-only and that landed the feature owner-only for
free. Adil's decision makes that reasoning backwards. Tools is owner-only by
construction, and both platforms say so in a comment:

- `MatchView.tsx:2827-2830` — "Coach viewers never see it (every row is an
  owner action)"
- `MatchDetailScreen.swift:651-653` — "Coach viewers never see Tools — every
  row is an owner action, matching the web"

**So a Tools row cannot serve a coach, and the recommendation moves.**

### The precedent that makes this an easy call

A coach can already watch the uncut original today, on both platforms, on any
match that has not been processed. `src/app/match/[id]/page.tsx:88-100`
presigns `raw_path` for six hours and hands it to `RawMatchView` for whoever
RLS let through; `isOwner` gates only trim, process and delete. iOS does the
same at `MatchDetailScreen.swift:145-151`.

So this is not a new category. It is the *ready-match* case of something that
already ships.

### Recommendation: a second row inside the video card

The one container that already renders for owner and coach alike, on iPhone,
desktop and mobile web, is the video card itself.

```
[ poster, tap to play the cut ]
────────────────────────────────
Full video                  [↓]
Playtime only
────────────────────────────────
Original video               ›
As uploaded · 47:31
```

Adil's instinct was a button beside the download arrow, and with the coach
decision that instinct is right about the *place* — the card — and the row
form fixes what was wrong with a bare circle: it is labelled in words, it
carries its own state, and it does not sit unexplained under a caption naming
the other video.

**The words are already shipped.** `MatchDetailScreen.swift:1063-1071`
renders exactly `"Original video"` over `"As uploaded"` today, in that slot,
for unprocessed matches. The card learns to say the same thing about the same
file in both states.

Two rows also state the real fact plainly: **this match has two videos.**
That is a thing worth teaching once rather than hiding in a drawer.

### What it costs, measured

On mobile web at **393×660** (the viewport with browser chrome subtracted),
the row spends the Tools peek. Today 48–56px of the first Tools row shows
above the bottom nav, which is the affordance telling you to scroll. The new
row is 61px, so after it the first Tools row starts at y≈600–608 — behind the
bar. On a scored match the word "Tools" itself is half covered.

Dropping the subtitle recovers 16px of a 56px deficit, so there is no
arrangement that saves it. I recommend accepting the cost: the alternative is
a Tools row that a coach cannot see, which is the thing Adil ruled out.

Desktop is unaffected. The card's flex container at `MatchView.tsx:2726` has
exactly one child, so nothing sits beside it to be disturbed.

### The card's own rule has to be rewritten

`MatchView.tsx:269-280` says the card is "the poster (the ONLY match-footage
video) plus ONE header action", and that "everything else lives in the Tools
card below". Its first clause is exactly the premise this feature retires,
and its escape hatch is the container a coach cannot reach.

The rule was right and should survive in a narrower form: **the card holds
the match's videos, one shortcut each; actions live in Tools.** That still
refuses Placement and Match analysis, which nobody can call videos.

### Where it opens

Adil asked for the same full-screen player unprocessed matches use, and on
both surfaces that is what it should be.

**Web: a `/match/[id]/original` route, not an overlay on the match page.**
The destination is `ClipPlayer` in `mode="cut" tall landscape
readPixels={false}` — literally what `RawMatchView.tsx:353` already does, on
a bare presigned URL. A route rather than a modal for three reasons: the
match page never gets a second `<video>`, so the two known traps here (a
removed `<video>` keeps playing with sound; `Player.tsx:1010` reads
`fullscreenchange` with no identity check and `:1026` exits fullscreen
unconditionally) simply do not arise; the page can carry the
cannot-decode state that already exists; and it is linkable, so a coach can
be sent straight to it.

**iOS: `PlayerTakeover`, `mode: .watch`, with an explicit source flag.** See
the next section, because the obvious way to do this is wrong.

**Not the paid-review workspace, in this version.** Both platforms have one
(`FindingEditor.tsx` on web, `CoachFindingsView.swift:9` on iOS), and a paid
coach works there rather than on the match page. But its whole design is "ONE
video, the full cut, every point jump is a seek" — and on web the same
`<video>` element is handed to every finding card for frame capture, so a
coach drawing grabbed from the original would be filed against a point whose
`cut_t0` refers to the other file. Both workspaces already have an "Open the
full match" door (`CoachOrder.tsx:156`, `CoachOrderScreen.swift:88`), so a
coach reaches the card in one tap. Doing it properly inside the workspace is
its own piece of work.

---

## The two corrections

Both came from deliberately trying to refute the design. Both were right.

### 1. `raw_path` alone hides a live original on 19% of matches

The first draft said: show the row when `matches.raw_path` is set, because
that field is already loaded and costs nothing.

That is a *sufficient* signal (all 71 such objects are alive) but not a
*necessary* one. **27 of 140 processed matches have `raw_path` null and an
original that is still in R2**, HEAD-verified, 17 distinct objects of 247 MB
to 966 MB. A row gated on `raw_path` shows nothing on all 27, for owner and
coach alike — while the Export sheet's download button, which resolves
through `jobs.input_path`, works fine on the same matches. Two controls for
one file, disagreeing on the same page.

The product already solved this once. Migration 144 replaced
`admin_match_raw_path` for precisely this reason and its replacement
(`144_admin_upload_detail.sql:57-68`) is a three-way coalesce: `raw_path`,
then `jobs.input_path` by `job_id`, then by `options->>'match_id'`.

**Corrected rule:** show the row when `raw_path` is set **or**
`jobs.input_path` starts with `r2://ponglens-raw/`. Resolved server-side, one
extra column in a select that already happens. No probe, no R2 HEAD, no
layout shift at the fold.

On tap, mint the URL. `/api/media-url` already HEAD-checks and answers
`{ available: false }`, so the rare dead case says **"The original is no
longer available."** rather than opening a broken player. All 27 of those
matches also have `duration_s` null, so their subtitle reads just "As
uploaded".

### 2. On iOS, emptying the points array is NOT enough

The obvious fix is to make `PlayerTakeover` return no points when it is
showing the original, since everything that could seek wrongly reads
`cut_t0`. That is nearly true, and the exception is the one that fires first.

`deadSpans` does not go through the `points` property:

```swift
var deadSpans: [TimeSpan] {                              // PlayerTakeover.swift:320
    deletedSpans(all: model.points, visible: points, pad: pad)
}

func deletedSpans(all: [MatchPoint], visible: [MatchPoint], pad: ClipPad) -> [TimeSpan] {
    let starts = visible.compactMap(\.cutT0).sorted()     // ScoreLogic.swift:30
    for p in all where p.deleted { ... }                  // ScoreLogic.swift:32
```

The spans come from `all`, which is `model.points` — the unfiltered list,
deleted rows included. `points` supplies only `starts`, which clamps the span
*ends*. So emptying `points` does not remove a single span; it removes the
clamp and makes every one of them **wider**.

And the seek that reads it has no mode guard (`PlayerTakeover.swift:2954`):

```swift
// Deleted footage is dead in both modes: jump out of it rather than
// play frames the owner removed.
if let out = spanEnd(deadSpans, at: t) { seek(to: out); return }
```

**20 of the 71 retained matches (28%) have at least one deleted point with a
`cut_t0`**, and in every sampled case the first one sits at `cut_t0 ≤ 0.4s`.
One match has 42 deleted points with the first at 0.0. So on those, the
playhead jumps within the first tick of playback, repeatedly, before the
viewer has touched anything. It would read as a corrupt file.

Two more survive the empty array: **`startAt`**, a cut second passed in by
the caller and used at `:2883`; and **`highlightPicks`**, a separate point
array with its own boundary observer and three seek paths.

**Corrected fix:** an explicit `source: .cut | .original` on `PlayerTakeover`
that does four things, not one.

1. `points` returns `[]`
2. `deadSpans` returns `[]` — the one that does not follow from 1
3. `startAt` is ignored
4. `highlightPicks` is rejected

Everything else genuinely does stand down with the empty array: the flank
chevrons, `tapSpans`, `letSpans`, the score bug, the chip strip, the points
grid, the replay target, the auto-pause loop, and the double tap (which
already falls through to ±10s on `guard !cutPoints.isEmpty` at `:925`).

The web side is immune by construction, because `ClipPlayer` takes a bare
`src` and knows nothing about points. That is a second reason to use it
rather than `Player.tsx`.

---

## Who can reach it, exactly

Adil's decision is that coaches and other legitimate viewers may watch the
original. The boundary that implements it is `has_match_access()`, verified
against production with `pg_get_functiondef` (no drift from
`073_coach_reviews.sql:480-511`). Three arms:

| arm | how they got it | how it ends |
| --- | --- | --- |
| owner | uploaded it | account deletion |
| accepted coach link | the player minted an invite and the coach accepted | the player revokes it in Account → Coaches; takes effect on the next request |
| review order in `submitted` / `in_review` / `clarification` / `delivered` | the student sent that match to that coach | see below |

`{ rawPreview: true }` inherits that policy and has no owner check, so **the
decision needs no API change at all.** The feature ships on plumbing that
already exists.

Three consequences worth knowing, none of them blocking:

- **A minted link survives revocation for up to six hours.** The URL is a
  presigned R2 GET; Cloudflare validates the signature without asking us. If
  a player revokes a coach one minute after that coach opened the page, the
  coach holds a working link for 5h59m. Shortening the TTL is the wrong fix —
  the six hours exist because a coach streams a whole review session off one
  mint. The honest move is to make sure no UI promises instant revocation.
- **The review-order arm has no reliable exit.** `delivered` is swept to
  `completed` after 7 days, but only when someone loads the coach hub — it is
  not a cron. And `submitted`, `in_review` and `clarification` have no sweep
  at all, so a stalled order grants match access indefinitely. Pre-existing,
  and this feature raises the stakes on it.
- **Download stays owner-only, by accident, and should stay that way on
  purpose.** `{ raw: true }` reads `jobs.input_path`, and the `jobs` policy
  is strictly `user_id = auth.uid()`, so a coach gets `{ available: false }`.
  Streaming is open, downloading is not. That is a reasonable line: a stream
  expires in six hours, a file on a laptop does not.

**Share links stay on the cut.** Confirmed three independent ways: the live
`resolve_share_link` returns only `cut_path` and `point_clip_path`, and
`/api/share/media` signs nothing else. A share recipient is a stranger, and
the original contains everything the cut removed — bystanders, conversations,
other people's matches. Extending share to the original is a different
privacy decision and should not fall out of this one.

---

## Copy

New:

- Card row: **Original video** / **As uploaded · 47:31** (the duration comes
  from `matches.duration_s`, which is written at upload from the source file
  and never overwritten; where it is null the subtitle is just "As uploaded")
- Cannot decode: **This browser can't play this file.** / "Phones record in a
  format some desktop browsers don't support. Download the original instead,
  or open this page on your phone." Plus a real **Download original** pill.
- Gone: **The original is no longer available.**

Rename, because two names for one file is how a page contradicts itself two
rows apart: the Export sheet's **Raw match** becomes **Original video** on
both surfaces, keeping "Your original upload, uncut".

Three live strings say the original is deleted after 30 days. All three are
false, and the Privacy Policy contradicts them one link away. They should be
fixed, but in their own commit rather than gated behind this shipping:

- `src/app/page.tsx:142` — landing FAQ
- `src/app/learn/guides.ts:668` — Export guide
- `src/lib/placementRetry.ts:169` — tells the player the original is gone on
  day 31, which would sit beside a working row

---

## What it costs

| | |
| --- | --- |
| API | nothing — `{ rawPreview: true }` already does this, for coaches too |
| server | one extra column in two selects, for the coalesce |
| web | `/match/[id]/original` route + the card row, reusing `ClipPlayer` |
| iOS | card row + the `source` flag (four behaviours, not one) + a second URL fetch |
| iOS failure state | new work — `AVPlayerItem.status` is never observed today, so a dead link is a black screen |
| copy | 2 new messages, 2 renames, 3 false strings in a separate commit |
| migration / worker | none |

Roughly a day and a half. The iOS failure state and the `source` flag are the
only parts that are not assembly of things already built.

---

## Found in passing

Real, none of it should ride along in this change.

- **iOS re-uploads everything against a dead upload, then gives up.** The
  server answers `{ parts: [], gone: true }` when Cloudflare has aborted an
  incomplete upload, and web reads that flag and starts fresh
  (`UploadCard.tsx:1089`). `RecordingQueue.swift:587` declares
  `struct ListRes { let parts: [ListedPart] }` — no `gone`. So it reads
  "zero parts landed", re-slices every part against the dead `uploadId`, and
  fails 12 times before showing "The upload kept failing." **And iOS has no
  age expiry on its queue at all**, where web caps resume at 6 days. A phone
  that records and is not opened for eight days hits this every time. The fix
  is two lines away in `retry()`, which already nils `key`/`uploadId`.
- **The web resume card over-promises by a day.** The deadline line is
  computed from 7 days but the record is dropped at 6, so its expired branch
  is unreachable and the card silently stops appearing.
- **The delete confirmation quotes the wrong number.** `MatchView.tsx:4630`
  says "This frees N", where N counts point clips (not billed) and omits the
  original (61% of the bill). A typical match quotes ~388 MB and actually
  returns about 1 GB.
- **Two real-user matches have no pointer to their source at all.**
  `81b609e6-…` and `86f880b9-…`, both `aber97@gmail.com`, created 2026-08-25,
  with an `original_name` ending `.mov` and neither a `job_id` nor a
  `raw_path`. Three days old, so this is a live bug, not legacy drift.
- **21 raw objects are referenced by more than one match row**, one by three.
  Mostly lab re-runs, but those matches would open the same original.
- **Abandoned multipart parts survive account deletion.** `deletePrefix`
  lists objects, which does not return in-progress parts, so a deleted
  account can leave parts in R2 for up to 7 days until Cloudflare's rule
  catches them.
- **`SPEC.md:94` says "raw 7 days → delete"**, wrong in two directions at
  once for months.
