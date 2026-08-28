# Ending an unscored point when the rally ends, not when the tap would have

**Status:** proposed, blocked on one measurement (see "What gates this").
**Goal:** a match nobody scores should stop each point when the rally is
over, instead of holding the 2.6 seconds of tail that exists to catch a
winner tap that is never coming.

---

## The finding this rests on

`worker/points_v2.py:490` already computes both numbers. Its own docstring
says why there are two:

```python
def rally_end_ev(E, contact_s):
    """(padded end, evidence end) for the rally opened by this serve.

    The chain of net crossings bounds it, and the last bounce on the table
    inside that chain says where the ball actually died. The PADDED end
    adds the tail margin so his winner click lands inside; the EVIDENCE
    end is the last moment the rally itself was observed.
    """
```

The padded end becomes `t1`. The evidence end is used once, as `open_ev` in
`serve_points`, to decide whether the next serve is a new point — and is
then thrown away. It is never stored, never reaches `match.json`, and never
reaches the database.

The padding is `TAIL_AFTER_BOUNCE = 2.6` (`points_v2.py:99`), and the
comment above it names its purpose exactly: *"His winner click lands 1.45s
after the last table bounce."* **The tail is sized for a tap.** A match with
no taps carries it for nothing.

So this is not a new detector. It is storing a number the worker already
has and stops using.

## What the trim is worth

Measured across the six matches on `/research/serve-accuracy` — Chris,
Julian, Rowel, Ishan, Prabhas, Anton — 423 live points.

The gap from the last bounce on the table to `t1` is a median of **2.57s**,
which is `TAIL_AFTER_BOUNCE` almost exactly, confirming the mechanism. It is
available on **99–100% of points** on four of the six matches, because it
needs no winner, no side and no attribution — only a bounce that projected
onto the table.

Rebuilding each match's cut segments end to end with the evidence end in
place of `t1`, re-padded and re-merged the way `play_cut_segments` does:

| buffer | saved | % of the cut | retention |
| --- | --- | --- | --- |
| 0.5s | 11m52s | 16.5% | 79% → 66% |
| 1.0s | 9m18s | 13.0% | 79% → 69% |
| 1.5s | 6m58s | 9.7% | 79% → 72% |
| 2.0s | 4m49s | 6.7% | 79% → 74% |

Per match at a 1.5s buffer: Chris 71→61%, Julian 71→61%, Rowel 73→64%,
Anton 76→71%, Ishan 94→88%, Prabhas 91→89%. Ishan and Prabhas gain least
because their points sit so close together that the padded segments already
merge; trimming a tail there lands inside the next point's lead-in.

## What gates this

**The buffer cannot be chosen from the data I have.** Two safety tests were
built and both are unsound in opposite directions:

- **Event-based** — "is there another on-table touch after the proposed
  end?" — reports zero unsafe points at every buffer. It is circular: the
  proposed end IS the last on-table touch, so by construction nothing
  on-table follows it. A test that cannot fail proves nothing.
- **Motion-based** — "is the ball still moving at rally speed?" — reports
  the ball flying for a median of 1.50s past the last table bounce, and
  would call 66% of points unsafe at a 1.0s buffer. This is far too
  pessimistic: after a point ends the ball flies off the table, hits the
  floor and rolls, and all of that is fast motion. It is exactly the dead
  time we are trying to remove, counted as live play.

The truth is between them and neither brackets it usefully. The tap gives a
third read — a median of **2.33s** after the last table bounce — but that
includes human reaction time and deliberate waiting, so it is an upper
bound on the true end, not the true end.

There is one case that genuinely threatens the design and neither test
resolves: **a point that ends with a ball hit long or wide never touches
the table again.** The winning shot and the miss both happen after the last
bounce. Trim too tight and the video loses the shot that won the point.

**Required before any code ships:** hand-mark the true last moment of play
on a stratified sample of 60 points — 10 from each of the six matches,
picked to over-sample rallies ending off the table — and set the buffer to
the 99th percentile of (true end − last table bounce). Record it in
`docs/research/2026-08-27-rally-end-calibration.md` with the marked frames.
Until that number exists, treat 1.5s as a placeholder, not a decision.

## Design: store it in the worker, apply it at read time

**Do not shorten `t1` in card assembly.** The code already measured what
that costs: the comment at `points_v2.py:95` records that sweeping
`TAIL_AFTER_BOUNCE` from 2.6 to 2.2 *"loses 3.6 points of whole for zero
junk"* — shortening the tail split rallies into two cards, and a split
costs a manual join. `t1` is load-bearing for `merge_continuous`,
`resolve`, `split_long` and `on_own_table`. It must not move.

**Do not re-cut the video.** The cut file has to keep enough tail for the
winner tap to land inside it, or scoring breaks for everyone who does score.
We never know at processing time whether a match will be scored.

**Apply it at read time,** exactly as `tap_end_playback` already does. That
precedent is in `src/app/match/[id]/playhead.ts:80`, `effectiveEnd`, which
is already a clamp of the padded end. This adds a second clamp source, used
only when there is no tap. Consequences: scoring is untouched, every
existing match benefits after a backfill, the kill switch is one
`app_config` row, and card assembly is not perturbed at all.

The cost is honest and should be stated: **the cut file does not get
smaller.** Storage and bandwidth are unchanged. What changes is how long
the user watches. If file size is also wanted, that is a re-cut and a
separate, riskier phase.

---

## The change, file by file

### 1. Worker — carry and store the evidence end

**`worker/points_v2.py`**

- `rally_end_ev` (line 490) already returns `(padded, ev)`. No change.
- `serve_points` (line 522): store the second value on the card as
  `"end_evidence_s": ev`, alongside `t0`/`t1`/`serve_s`/`why`.
- `fallback_points` (line 541): it calls `rally_end(E, b)`, which discards
  `ev`. Switch to `rally_end_ev(E, b)` and store the evidence end. For the
  `not len(cr)` branch, where the end is `b + 1.6` with no crossing chain,
  store `None` — there is no evidence end, and a missing value must stay
  missing rather than become a guess.
- `resolve`, `merge_continuous`, `split_long` (lines 599–706): each of
  these creates, merges or trims cards. Every branch that writes `t1` must
  decide what happens to `end_evidence_s`:
  - `resolve` trimming `prev["t1"]` downward: clamp
    `end_evidence_s = min(end_evidence_s, t1)`. An evidence end past the
    card's own end is meaningless.
  - `merge_continuous` joining two cards: take the LATER card's evidence
    end. The merged card ends where the second rally ended.
  - `split_long` cutting one card in two: the first half has no evidence
    end (`None`); the second keeps the original.
  - A card dropped for `MIN_CARD_S` takes its evidence end with it.

**`worker/points_pipeline.py`**

- Where v2 cards become points (around line 2884, "4. per point: fit,
  suggestion, placement, clip"): carry `end_evidence_s` onto the point dict
  and into `match_json["points"][i]`.
- Convert to cut seconds with the existing `cut_position(cut_segments,
  seg_offsets, t)` (line 349), the same helper that produces `cut_t0` at
  line 2941. Store both: `rally_end_s` (source) and `rally_end_cut_s`
  (cut), so nothing downstream has to redo the conversion. This is the same
  choice `point_boundaries` made — both clocks pre-converted — and it is
  the reason that view is usable.
- `--cut-mode spans` and the v1 path do not get this. They set it `None`.

### 2. Database

**New migration, 143** (142 is the current highest):

```sql
alter table public.points add column rally_end_cut_s numeric;
comment on column public.points.rally_end_cut_s is
  'Cut-seconds position of the last observed moment of the rally: the '
  'last bounce on the user''s own table inside the point''s crossing '
  'chain. Null when no such bounce was seen. Written by the worker only. '
  'Used to end playback on UNSCORED points, where there is no winner tap '
  'to clamp against.';
```

Grants: **do not** add this to the `authenticated` UPDATE column list. It is
worker-written and client-read. The memory on `points-column-grants` is
about the opposite direction — a client-written column needing a grant —
and does not apply. Read access comes with the existing row policy.

Also add to `app_config`:

```sql
insert into public.app_config (key, value) values
  ('unscored_rally_end', 'off'),
  ('unscored_rally_end_buffer_s', '1.5');
```

Both must go in the **allow-list** in the `app_config` select policy.
Migration 107 set the rule — a key is private until someone adds it — and
138 shows the mechanic: the policy is dropped and recreated with the full
list re-stated, `tap_end_playback` appended at the end. 140 did it again.
So this migration re-states all seventeen current keys plus the two new
ones; there is no incremental form. Both are read by the public share page,
so they belong on the list. Ship the flag `off`.

Getting this wrong fails loudly in one direction and silently in the other:
omit the keys and the share page reads the flag as off, which you see;
put `is_admin()` in the anon policy instead of a second policy and every
anonymous read of the whole table dies with `42501`, which took the pricing
off the public pages for one commit.

### 3. Web — the clamp

**`src/app/match/[id]/playhead.ts`**, `effectiveEnd` (line 80). It takes
`(p, pad, on)` today. It needs the new flag and buffer. Keep it a pure
function; pass a small options object rather than growing the positional
list.

The rule, in order:

1. `padded = paddedEnd(p, pad)`. If null, return null.
2. If the point is `edited`, return `padded`. Hand-edited boundaries are
   explicit intent and outrank both clamps — this already holds for the tap
   and must hold here for the same reason.
3. If there is a usable tap and `tap_end_playback` is on, return
   `min(padded, tap + 0.5)`. **The tap always wins where it exists.** It is
   a human saying "decided by here" and it is better evidence than a bounce.
4. Otherwise, if `unscored_rally_end` is on and `rally_end_cut_s` is
   non-null and not before `cut_t0`, return
   `min(padded, rally_end_cut_s + buffer)`.
5. Otherwise `padded`.

A clamp, never an extension, at every step — same discipline as the
existing code.

**`src/lib/config.ts`**: add `getUnscoredRallyEnd()` and
`getUnscoredRallyEndBufferS()` beside `tap_end_playback` at line 161.

**Every caller of `effectiveEnd` / clip length must be updated together**,
or the surfaces disagree about how long a point is. The full list, from
the `tap_end_playback` references:

- `src/app/match/[id]/Player.tsx:652`
- `src/app/match/[id]/MatchView.tsx:436`
- `src/app/match/[id]/HighlightsRow.tsx:44`
- `src/app/match/[id]/highlights.ts:91`
- `src/app/s/[token]/ShareView.tsx:53` — the share page, which is the one
  page a stranger sees
- `src/app/api/reel/route.ts:241` — Instagram renders
- `src/app/coaching/orders/[id]/page.tsx:134` — what a paying coach watches

`src/lib/types.ts`: add `rally_end_cut_s?: number | null` to `Point`.

### 4. iOS — the same rule, again

`ios/PongLens/PongLens/Core/Playhead.swift:79` is the mirror of
`playhead.ts` and carries the same comment. It must get the identical
ladder. `Core/AppState.swift:92` fetches `["placement_serves_only",
"tap_end_playback"]` — add both new keys to that `in` list.
`Core/Highlights.swift:51` takes `tapEnd` and needs the same treatment.

This is the "rule exists twice" trap from CLAUDE.md, and the placement
mirror bug is what it costs when the two drift. Add a shared fixture:
`ios/Tests/fixtures/rally-end-parity.json`, generated from the web
implementation over one real match, asserting both produce the same
effective end for every point. That is how `serve-parity.json` was handled
and it is the only thing that has actually caught a drift here.

### 5. Backfill

`worker/placement_backfill.py` already has the shape for this: an offline
`reconstruct` subcommand that reprocesses a stored match without
re-running the whole pipeline. Add a `rally-ends` subcommand that recomputes
`Evidence` from stored detections plus the stored calibration and writes
`rally_end_cut_s` for existing matches. Reuse `recover_calibration`, which
already prefers stored calibration when `ok` — a match must not silently
get a different table than the one its points were built on.

---

## Testing

**Unit, `points_v2`:** a card whose evidence end survives `resolve`
trimming; a `merge_continuous` join taking the later end; a `split_long`
first half with `None`; a fallback card with no crossing chain getting
`None`. Assert against hand-built `Evidence` fixtures, not against what the
code returns.

**Unit, `playhead.ts`:** the ladder in order — edited point ignores both
clamps; tap beats bounce where both exist; bounce applies only with no tap;
a `rally_end_cut_s` before `cut_t0` is refused; flag off is a no-op. Then
the same suite in Swift against the same fixture.

**Integration:** reprocess one match end to end and confirm
`match.json` and `points.rally_end_cut_s` agree, and that `cut_t0`,
clip boundaries and `cut_segments` are byte-identical to before — this
change must not move a single existing number.

**The one that matters:** watch a full unscored match with the flag on,
start to finish, at the chosen buffer. Not a sample of points. The
CLAUDE.md note about a sheet left open for 17 seconds is exactly this
failure — a beat nobody checked because only one moment was reviewed.

## Rollout

1. Migration and worker change, flag `off`. Nothing changes for anyone.
2. Backfill the six research matches. Compare on `/research/serve-accuracy`.
3. Do the 60-point hand-marking. Set the buffer. This gates step 4.
4. Flag `on` for the admin account only, watch three unscored matches whole.
5. Flag `on` globally.

**Rollback is one row:** `update app_config set value='off' where
key='unscored_rally_end'`. No re-cut, no reprocess, no deploy. The buffer
is a second row and can be widened without a deploy if a rally gets clipped.

## Risks

- **The buffer is a guess until step 3.** Everything else here is
  mechanical; this is the only judgement call, and getting it wrong cuts
  the shot that won the point. It is why step 3 gates step 4.
- **A missed bounce cuts early.** The same detection gap that leaves 64 of
  300 points with no winner call will occasionally lose the last table
  bounce, and the trim would then fire on the bounce before it. The clamp
  to `padded` bounds the damage — we can never end later than today — but
  it does not bound how early. Consider refusing the trim when the gap
  between the last two on-table bounces is larger than a rally's normal
  stroke interval.
- **The share page and coach orders are the exposed surfaces.** A clipped
  rally on `/s/[token]` or in a paid review is worse than one in the
  owner's own player. If the rollout is staged further, stage those last.
- **Ishan and Prabhas gain almost nothing**, so a dense club session will
  not see the headline number. Do not promise 13% in copy; the honest range
  across six matches is 2% to 20% depending on how spread out play is.
