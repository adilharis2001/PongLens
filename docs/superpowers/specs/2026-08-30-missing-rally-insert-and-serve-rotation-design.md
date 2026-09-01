# Missing rallies and serve rotation — design

2026-08-30

Two problems, one root cause. The serve rotation is a function of how many
cards there are, so a rally the cut missed puts every later card on the
wrong server, and the corrections we offer today cannot express what
actually went wrong. This covers both the small repairs to the correction
model and the new "+" that puts a missing rally back.

---

## 1. What is wrong today

`computeServing` (`src/app/match/[id]/serving.ts`, ported line for line to
`ios/PongLens/PongLens/Core/Serving.swift`) walks the visible points and
hands each one a server: two serves each, one each from 10-10, the same
server again after a skipped rally, first server alternating at every game
boundary. `points.server_override` is both the answer for its own point and
the anchor the walk continues from.

Three defects, each verified against the real module:

**A. The lit ball is a toggle on web.** Both balls call one zero-argument
`flipServer` (`Player.tsx:3574`), so tapping the ball that is already lit
hands the serve to the other player. iOS passes a specific side and no-ops
(`PlayerTakeover.swift:2039`). Both carry the same accessibility label.

**B. A later override cancels an earlier correction.** The walk anchors to
the most recent override before each point, so a correction made further
down the match wins over one made upstream:

```
point index          01234567890123456789
baseline             UUTTUUTTUUTTUUTTUUTT
fix point 12         UUTTUUTTUUTT[T]TUUTTUU
then fix point 4     UUTT[T]TUUTTUU[T]TUUTTUU   <- reverts at 12
wanted               UUTT[T]TUUTTUUTTUUTTUU
```

**C. A correction refuses to move the block boundary.** The walk keeps
`servesInBlock` across an override by design: it relabels who serves
without moving where the two-serve blocks start. That is exactly backwards
for a missing rally, which IS a block boundary that moved. Thirteen
rallies, the sixth dropped by the cut:

```
card:        1  2  3  4  5  6  7  8  9 10 11 12
truth        U  U  T  T  U  T  T  U  U  T  T  U
app today    U  U  T  T  U  U  T  T  U  U  T  T
```

After the gap the app is right on every other card, which is why it reads
as broken rather than merely wrong. Reaching the truth today takes **seven
taps**, one on every remaining card. Restarting the block on a correction
takes **one**. Putting the missing card back takes **none** — the rotation
is a count, so restoring the beat fixes everything downstream by itself,
and fixes the score too, which nothing else does.

Neither `serving.ts` nor `Serving.swift` has a test file.

---

## 2. What the cut video actually contains

Measured across 9,433 seams in production:

| removed at the seam | seams | share |
| --- | --- | --- |
| under 0.25s (continuous) | 5,225 | 55.4% |
| 0.25–1s | 458 | 4.9% |
| 1–3s | 1,557 | 16.5% |
| 3–10s | 1,581 | 16.8% |
| over 10s | 612 | 6.5% |

`removed = (next.t0 - prev.t0) - (next.cut_t0 - prev.cut_t0)`. Within a
point's own span the cut keeps source duration intact, so this is exact.

**More than half of all seams are continuous**: the footage between the two
cards is already in the cut video and a new card can be carved out of it
with arithmetic alone — no worker, no cost, no wait. At the rest, some
footage was removed and only the raw has it.

Raw availability, by match:

| | matches | share |
| --- | --- | --- |
| raw kept (commerce library row, never expires) | 93 | 57.1% |
| raw under 30 days | 41 | 25.2% |
| raw swept | 29 | 17.8% |

82% today, and everything uploaded from now on keeps its raw permanently,
because a raw attached to a live library row is the storage the player is
paying for (`r2_raw_sweep` exempts it). The placeholder fallback is for a
shrinking tail of old matches, not the common case.

---

## 3. Part A — the correction model

Three changes, all small, landing together.

**A1. Each ball sets its own side.** Web `flipServer` takes a side, matching
iOS. Tapping the lit ball does nothing. Both accessibility labels stay
truthful.

**A2. A correction clears the corrections after it.** Adil's call: earlier
ones stay, later ones reset, so one fix does not have to be re-applied card
by card. Implemented in the write path, not the walk — `setServerOverride`
clears `server_override` on every visible point after the corrected one, in
the same round trip. The cleared values ride the undo entry.

**A3. A correction starts a new two-serve block.** In `computeServing`,
reset `servesInBlock` when the override contradicts the walk (today it is
reset only when there is no anchor at all). An override that agrees stays a
pure pin. Same edit in `Serving.swift`. This is what turns seven taps into
one, and it is the change that needs the most care: it alters the displayed
server on existing matches that already carry overrides.

**A4. Tests.** `serving.test.ts` and the Swift equivalent, covering the
baseline rotation, deuce, skipped rallies, game boundaries, an agreeing
pin, a contradicting override, and the missing-rally fixture above. The
fixture is shared between the two so the port cannot silently drift.

---

## 4. Part B — the "+"

### 4.1 The operation

One operation covers both of Adil's options. The difference between "create
a real card" and "create a placeholder" is only whether footage exists, not
what the row is.

`insert_point(p_prev_id, p_next_id, t0, t1, cut_t0)`, SECURITY DEFINER,
modelled on `split_point`:

1. Ownership check through `matches.user_id = auth.uid()`, `for update` on
   both neighbours.
2. Insert a point with the given source window, `idx = max(idx) + 1`,
   `edited = true`, `tight_start = true`, `tight_end = true`. Timeline
   order comes from `sortPoints` (t0 first, idx as tiebreak), so a high idx
   is correct — the card slots in by its own t0, exactly as split children
   already do.
3. Trim only where the new window actually overlaps:
   `prev.t1 = min(prev.t1, t0)`, `next.t0 = max(next.t0, t1)`, marking each
   trimmed neighbour `edited` and tightening the moved edge. A card placed
   purely in the gap touches nobody.
4. Clear `server_override` on every visible point after the new card — an
   insert is a correction upstream, and any overrides the player already
   taped over the gap with would now double-correct (A2's rule, same code).
5. Return the new row plus the neighbours' patches so the client can mirror
   optimistically.

**`cut_t0` is mandatory, not optional.** The Keep-score strip skips any
point with a null `cut_t0` (`Player.tsx`, the chip map returns null), so a
card without one is invisible in the ScoreKeeper — which would defeat the
whole feature. It is always derived from the previous card's anchor:
`prev.cut_t0 + (t0 - prev.t0)`.

The client schedules the existing debounced `reclip` job. Nothing new is
needed: reclip already picks up every `edited` point, cuts it from the raw,
and marks `clip_path = null` when the raw is gone. The new card, the
trimmed prev and the trimmed next all ride the same job.

### 4.2 What the player can and cannot watch

The cut video is never re-assembled — reclip regenerates per-point clips
only. So:

- **Continuous seam (55%)** — the card plays exactly right in the
  ScoreKeeper straight away, from the cut video, before any job runs.
- **Seam with footage removed** — the ScoreKeeper's playback jumps where
  the dead space was taken out. The point view plays the exact clip once
  the reclip lands.
- **Raw gone and a removed seam** — the card exists, holds the rotation and
  the score, and has no footage. This is the placeholder, reached through
  the same flow rather than a separate one.

We say this in the UI rather than hiding it: the seam is drawn as a hatched
band labelled **Not in this video**, sized to the measured removal. It
explains the jump, and it tells the player where the handles can usefully
go. A later job could re-assemble the cut for exactness everywhere; it is
not worth it for v1.

### 4.3 The interface

The work belongs in the Modify sheet, which is already "ALL clip surgery,
shared by the Keep-score pad and the point view" on both platforms, already
owns a scrubbable video on the cut URL, already has two-handle dragging,
and already has the busy/lock/undo plumbing. A fourth tab beside Split,
Join and Adjust:

```
Split | Join | Adjust | Insert
```

**Insert is Adjust over a wider span.** Adjust drags two handles across one
point's clip span; Insert drags the same two handles across
`prev.spanStart → next.spanEnd`, with the seam marked. That reuse is the
whole reason this is affordable on two platforms at once.

The tab contains:

- The combined timeline, with the previous card's band, the seam, and the
  next card's band drawn behind the draggable window, so it is obvious that
  dragging left takes footage from the previous rally and dragging right
  takes it from the next one. This is the flexibility Adil asked for, and
  making it a shared timeline is what makes it legible without explaining.
- Two handles, clamped to `prev.t0 + 0.3s` and `next.t1 - 0.3s`, kept 0.5s
  apart, scrubbing the video as they move (Adjust's existing behaviour).
- Default window: the gap when there is one, otherwise 1.5s straddling the
  seam.
- **Who won it? Me / Them / Not sure yet.** Deliberately *not* Skip: a
  skipped card does not advance the rotation, so offering Skip here would
  hand back a card that fixes nothing. "Not sure yet" leaves it unscored,
  which still fixes the rotation, and Keep score will ask when the player
  reaches it.
- Confirm reads **Add card**; the flash reads **Card added. Rotation
  updated.**

Entry points, both opening Modify with the Insert tab selected:

- **ScoreKeeper** — a small "+" between two cards whose seam runs longer
  than four seconds. Eight was the first line, reasoned from rally length,
  and it was blind to the case that actually hurts: a missed serve is
  re-served within a couple of seconds. Nothing signals that a point was
  eaten, so the line is arbitrary either way; four costs ~33 offers on a
  73-card match against ~13 at eight, and that was accepted (2026-08-31)
  over a two-tier design, on the grounds that a second visual language on
  this strip costs more than the buttons do.
- **Point view** — the same tab, reachable from the existing Modify button.

### 4.4 Per platform

**Web** (`ModifyClip.tsx`, `Player.tsx`, `modifyOps.ts`)

- Fourth tab in the existing segmented control; the timeline, handle drag
  and pointer capture are the Adjust code with a different span source.
- `runInsertPlan` in `modifyOps.ts` beside `runSplitPlan` / `runJoinPlan`,
  so the cut→source arithmetic has one implementation.
- The "+" lives inside the pad's own branch. Both responsive layouts render
  at once with one hidden by `display: none`, so it must not be portalled
  or fixed out of the hidden branch (the two-videos-playing trap).
- Undo entry: delete the new point, restore `prev.t1` / `next.t0`, restore
  the cleared overrides. Unlike Join, this is fully reversible, because
  nothing is hard-deleted.

**iOS** (`ModifySheet.swift`, `PlayerTakeover.swift`, `PointActions.swift`)

- Fourth `Tab` case; the band and `Handle` drag state already exist for
  Adjust. `vClass` compact layout applies unchanged.
- `insertPoint` in `PointActions.swift` beside the split/join calls.
- The "+" goes in the chip strip in both orientations. In the rotated
  fullscreen takeover, position it with container-relative units and
  `localPoint`/`localDims`, never `dvh` or physical rect maths.
- Same undo semantics; `ModifyOutcome` already carries the landing playhead
  so the pass resumes on the new card.

### 4.5 Edge cases

- **Before the first card / after the last.** Supported; the missing span is
  bounded by the match start or end rather than a neighbour.
- **Two rallies missing at one seam.** Insert twice. Not worth a stepper.
- **Insert while a reclip is pending.** The neighbours are `edited`, so the
  tab locks exactly as Adjust does today.
- **Reclip finds no raw.** Existing behaviour: `clip_path = null`. The card
  keeps its timing, rotation and score. `PointDetail` already renders a
  clipless point gracefully.
- **Game boundaries.** An inserted card folds through the shared boundary
  walk like any other, so dividers and rotation stay in agreement.

---

## 5. Deliberately not doing

- **Re-assembling the cut video.** Minutes of worker time and a full
  re-upload to make 45% of seams exact. Revisit if players ask.
- **A stepper for multiple inserts.** Rare; two taps is fine.
- **Offering Skip on an inserted card.** It would produce a card that fixes
  nothing.
- **Auto-detecting missing rallies.** The player is looking right at the
  gap; a detector here would need to beat the cut that just missed it.

---

## 6. Order of work

1. A1 + A2 + A4 — the toggle, the downstream clear, and the tests. Small,
   independently shippable, fixes the reported bug.
2. A3 — the block reset, with the shared fixture proving web and iOS agree.
3. B on web — RPC, `runInsertPlan`, the Insert tab, the "+".
4. B on iOS — the same tab and entry point against the same RPC.

Verification: `npm run build` in the worktree (never against the running
dev server's `.next`), the new unit tests on both platforms, and a live
run on a real match with a known missing rally — confirming the card
appears in the strip, the rotation self-corrects with no ball taps, the
score advances, and undo restores every one of the three rows.
