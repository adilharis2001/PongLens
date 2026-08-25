# Tap-end playback: implementation plan across every surface

2026-08-25, follow-up to `2026-08-25-tap-end-shave.md`. Adil's decisions:
tap + 0.5s guard, skip deleted cards between points, behind a kill switch,
and the guard must never EXTEND an end — the rule is a clamp:

    effectiveEnd(p) = min(paddedEnd(p), scored_at_cut_s + 0.5)
      when scored_at_cut_s exists, tap >= cut_t0, and NOT p.edited;
      otherwise paddedEnd(p) exactly as today.

A point can only get shorter. `edited` points keep their edited ends —
the clip editor is explicit intent about boundaries and the tap predates
the edit (today zero tapped points are edited, so this guard is free).
Deleted points and lets carry no tap and are untouched by the formula.

## Where the rule lives (once per platform, the mirror-bug lesson)

- Web: `src/app/match/[id]/playhead.ts` — new `effectiveEnd(p, pad)`
  beside `paddedEnd` (playhead.ts:52). Every consumer routes through it.
- iOS: `Core/Playhead.swift` — same helper beside `paddedEnd` (:60).
- The two padded-end copies that must stay byte-parallel with the API:
  `api/reel/route.ts:302-313` and `SharePointSheet.swift:352-359`.

`ModifyClip.tsx` / `ModifySheet.swift` (the footage editors) deliberately
KEEP `paddedEnd` — an editor must show the real clip extent.

## Kill switch

`app_config.tap_end_playback` = 'on' | 'off', read at match load.
- Web: server-side read on the match page / share page / reel route,
  passed down as a prop (pattern: placement_serves_only, 132).
- iOS: same app_config read the Instagram flow already uses for
  `instagram_render` (SharePointSheet.swift:221-231).
- Migration: seed the key + add it to the 107 anon/authenticated
  read allow-list (it is not a secret).
- Rollback = one UPDATE. Exports self-heal: the reel route's manifest
  freshness check (route.ts:429-451) is a canonical-JSON compare, so
  flipping the flag makes stored manifests stale and they re-render
  with the old (or new) ends on next request. No worker restart ever —
  the worker obeys the manifest verbatim (worker.py:5501/5280).

## Surface-by-surface

### 1. Web watch player (Player.tsx) — owner, invited coach, mobile web
Deleted-card skipping ALREADY EXISTS (`deadSpanEnd` at Player.tsx:1706,
spans from MatchView.tsx:988). The new piece is a watch-mode span jump
modeled exactly on the highlights block (Player.tsx:1742-1757): spans =
visible points' `[cut_t0, effectiveEnd]`; outside any span while playing,
snap to the next span start. This one mechanism covers tails AND the gap
between a shortened tail and a deleted card's start (which today's
deleted-span skip alone would not, since those spans start at the deleted
card's own cut_t0).
Also route through `effectiveEnd`: score-mode `stopAt` (:1799, scored arm
only — unscored keeps `pauseEnd`), `chipSpans` countdown (:1625),
`advanceFrom` tail (:2889), review clamp (:1905). ScoreBug needs nothing:
it keys off point index via cut_t0 crossings, so jumps advance it
naturally.

### 2. iOS watch player (PlayerTakeover.swift)
Mirror of 1. `deadSpans` skip exists (tick :2835); add the watch-mode
span jump beside the highlights one (:2844-2853). Route `stopAt` (:2933),
`targetAt`/`advanceMove` (ScoreLogic.swift:134/:185), `offerSplitIfEarly`
(:2609), review stop (:2877), ticker chip (:2101) through `effectiveEnd`.
`scored_at_cut_s` already arrives on every point (Models.swift matchSelect
:146). Tests: extend ScoreLogicTests (clamp, no-extend, edited-ignored,
null-tap fallback).

### 3. Highlights (picker + playback + renders)
Playback spans on both platforms inherit from the players' span builders.
The picker's clip length `s` (highlights.ts:100-116, Highlights.swift:69)
becomes the tap-clamped length — budget cost AND `rankS` both use the
trimmed length (dead tail must not buy rank; the n_hits cap stays).
Consequence: more rallies fit the same 20/60/150s budgets, so picks
change on tapped matches. Regenerate `highlights-parity.json`, update
highlights.test.ts + HighlightsTests.swift. The reel route's cap check
recomputes from segments, so it stays consistent automatically.

### 4. Exports (/api/reel + on-device render)
One clamp at route.ts:302-313 (`segEnd = min(padded, tap + 0.5)` under
the flag) covers every scope: starred, full, tag, v:point, v:starred,
v:hl:*. The route already selects `*`, so the tap is in hand. Mirror the
clamp in SharePointSheet.swift :358 (device render) and :51-56 (the
Story-vs-Reel length gate, with a cutT0-null fallback). enqueue_reel
needs NO migration — Postgres never inspects seg times. Known remainder:
when the cut file is expired/too short the worker falls back to the
pre-baked 720p clip file, which keeps its padded end (rare, acceptable).

### 5. Coach surfaces
- Invited coach watching on /match/[id]: inherits 1 for free (same page,
  same select("*")).
- Paid-review workspace, web (coaching/orders/[id] → FindingEditor):
  select list must add scored_at_cut_s, t1, tight_start, tight_end and
  thread clip_pads through; add the span jump to its own onTime (:201) —
  it currently plays the whole cut with no skipping at all, deleted cards
  included.
- Paid-review workspace, iOS (CoachFindingsView inline player :526): same
  two gaps — `workspaceSelect` (CoachModels.swift:317) lacks the columns,
  and the player has no end bound. Same fix shape.

### 6. Public share page (/s/token)
The weakest surface today: `resolve_share_points` (130) returns neither
the tap, nor t1/tight flags, nor pads, nor anything about deleted rows —
the client cannot compute any end. One migration widens the RPC to add
scored_at_cut_s, t1, tight_start, tight_end, plus the match clip_pads and
the deleted-card spans (either the flag on rows or a spans array).
Remember the 133 lesson: a missing key is not an empty one — ShareView
must treat an RPC without the new fields (cached page, old deploy) as
"no spans", never as "skip everything". Then port the same span jump into
ShareView (it is small — one onTime handler).

### 7. Deliberately deferred (clip-FILE surfaces)
/starred shelf, public starred/tag links, student review PointReel,
PointDetail: these play pre-baked per-point clip files whose tails were
cut into the file. A client-side early-stop at `(tap - cut_t0) + 0.5` in
clip time is possible but each needs its RPC widened for a few seconds of
tail on single-clip viewing. Low value next to the match players; do
later if at all. Cross-match tag reels (tag-reel/route.ts) also stay
padded for now (segments are hardcoded null there).

## What does NOT change
No video file is re-rendered, no database row is rewritten, the worker is
untouched (no restart), and unscored/untapped points play exactly as
today. The rule is applied at read time on every match ever processed,
which is also why the kill switch is total.

## Order of work
1. Core rule + flag + both watch players (items 1, 2) — the 80% of value.
2. Picker + exports (3, 4) — keeps every surface telling the same story.
3. Coach workspaces (5).
4. Share page migration + jump (6).
Each step ships independently behind the same flag.

## Verification
- Unit: playhead/ScoreLogic clamp tests both platforms; picker fixture
  regen + parity suites; highlights tests.
- Live: the Julian 08-23 match (76/79 tapped, measured 25% shave) —
  watch it end to end on web + iOS with the flag on; flip the flag off
  and confirm padded behavior returns without a reload on next match
  open. Export one v:hl:reel before/after and compare durations.
