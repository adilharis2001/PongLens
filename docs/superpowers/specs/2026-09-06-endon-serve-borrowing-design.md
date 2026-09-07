# The end-on assembler borrows the serves the detector did find

**Status:** agreed by Adil on 2026-09-06 as a change to the end-on
assembler only. Built the same day on the branch `endon-serve-borrowing`
(worktree `.claude/worktrees/endon-serve-borrowing`); the faithfulness
check below passed in full (lab `s82_port_check.py`) and the s41-style
match.json diff is recorded at the end. Not merged, not deployed: it
reaches the production worker checkout only on Adil's word.
**Goal:** a card built by the end-on assembler carries the detected serve
inside it, and the segmentation may open a card on a detected serve. Today
every end-on card has `serve_s = None`, which starves placement and the
serve statistics on every match that takes that route.

The measurements behind this are in
`docs/research/2026-09-06-endon-routing.md`, section 5, and the lab code is
`TTVid/recall-lab/s71_endon_serves.py`, s73 and s79.

---

## What changes, and what does not

Changes: `worker/points_endon.py`, and one word in the "points v2" note
that `points_pipeline.cmd_points` writes into match.json.

Does not change:

- `worker/points_v2.py`. A match on the serve-anchored route never runs
  the end-on assembler, so its cards cannot move. The six side-on corpus
  matches are unaffected by construction.
- The router (`points_endon.wants_endon`, `SERVE_RATE_MIN`). Which matches
  reach the end-on assembler is exactly as today.
- `app_config`. No new key, no flag. The existing
  `points_endon_fallback = 'on'` is the only switch.
- `/admin/processing`. No new job kind, stage or lane.
- Ball detection, calibration, the crop. Those are separate proposals in
  the research record and are NOT part of this spec.

---

## The two changes

### 1. Detected serves become boundary candidates

`points_endon.boundaries` offers the Viterbi three kinds of candidate tick:
freeze valleys, prism exits and crossing-chain gaps. It gains a fourth: every
accepted serve contact in `E.serves`, minus `SERVE_LEAD`. The segmentation
still decides; a serve tick it does not like is ignored like any other.

```python
SERVE_LEAD_S = 0.0   # seconds before the contact the candidate sits.
                     # Swept 0.0 / 0.3 / 0.6 / 1.0 leave-one-match-out on
                     # koko, terry, tripp_rc; every fold chose 0.0.
```

`boundaries()` becomes: build the three existing candidate arrays as now,
then append `E.serves - SERVE_LEAD_S` for contacts after 0 s, then the
same `np.unique`, tick conversion and clip to `[0, E.n)` as today. It
keeps a `borrow_serves` switch (default on) so the faithfulness check can
run the old candidate set through the new code. `segment()` only passes
the switch through; the Viterbi is untouched.

### 2. Cards are stamped with the serve they contain

After `V2.resolve`, each card gets `serve_s` = the first accepted contact
with `t0 <= contact <= t1` and `contact - t0 <= STAMP_MAX_OFFSET_S`, else
`None`. The card also keeps `serves_inside`, the count of contacts in the
card, for the diagnosis page; a card holding two is a fusion candidate.

```python
STAMP_MAX_OFFSET_S = 4.5   # lead 2.2 + HEAD_LEAD 1.6 + slack. A contact
                           # deeper into the card than this is a mid-rally
                           # pair the detector mistook for a serve.
```

The docstring on `build_cards` currently promises `serve_s` is always
None. Rewrite it: `serve_s` is None wherever no contact lies in the card,
and downstream must still treat None as the normal case.

---

## Where the stamp goes

`cmd_points` already does the rest. The loop over `v2_cards` copies any
`serve_s` into `v2_serves`, keyed by the card's start frame; that value is
written to `points.serve_s`, passed to the placement seed when
`app_config.placement_serve_seed` is on, and read by the serve statistics
and both apps' placement maps. None of that code needs touching; it has
been reading None from end-on cards since the assembler shipped.

Two things that do not read the stamp and should not start to: the
research page's `serves.json` recomputes which contacts fall inside each
card from the evidence dump, and `research_serve_misses` walks its own
rules. They will agree with the stamp by construction.

Add the stamped count to the note, at the END, because the admin uploads
page parses the front of this note with a regex (`uploadView.ts`,
`points v2: N cards, M serves, ...`) and a count inserted after "cards"
would stop it matching:

```
points v2: 94 cards, 32 serves, 409 crossings, camera 0.68, serves/min 1.46,
route end-on, surface pad 0.15, merge 1.5s, 23 stamped
```

The count is written on both routes. On the serve-anchored route it is the
number of cards the serve motif built (the dense-net fallback cards carry
no serve), which is a useful number in its own right.

The note is the only record of what a match was cut with; a stamp count
there is how the next argument about an end-on match gets settled from the
match rather than from memory.

---

## What it is measured to do

On the bench (koko, terry, tripp_rc; Adil's marks; s60's five outcomes),
the s71 implementation with borrowing off reproduces the shipped module to
the tick, and with borrowing on, held out one match at a time:

| match | points | clean | clipped | fused | split | lost |
|---|---:|---:|---:|---:|---:|---:|
| koko | 45 | 34 (76%) | 2 | 0 | 9 | 0 |
| terry | 52 | 37 (71%) | 5 | 2 | 8 | 0 |
| tripp_rc | 102 | 76 (75%) | 3 | 9 | 14 | 0 |
| total | 199 | 147 (74%) | 10 | 11 | 31 | 0 |

Unchanged from production in every fold, zero lost, which is the point: on
an end-on camera the detector finds 5, 4 and 31 serves for those points, so
there is little to borrow, and borrowing costs nothing where the detector
is blind. On Anton's two side-on matches (86 and 53 audio-marked points,
cropped detections) it equals the plain end-on assembler at 64% clean on
both, with 44 of 104 and 35 of 58 cards stamped.

Stamp precision, which is what placement inherits:

| camera | stamped | right (no cap) | right with the 4.5 s cap |
|---|---:|---:|---:|
| end-on bench (3 matches) | 35 of 254 cards | 17 (49%) | 13 of 22 (59%) |
| Anton's side-on booth (2 matches) | 79 of 162 | 65 (82%) | 61 of 71 (86%) |

"Right" means a marked serve within 0.8 s (bench) or 1.5 s (audio marks).

**The risk to say once, properly.** On a genuinely end-on camera about
four stamps in ten will be a mid-rally bounce pair, and placement will try
to draw a serve dot from it. Placement's own checks (the serve's first
bounce on the server's half, both bounces consecutive, the 0.7 trust
threshold) will refuse some of those; the rest become wrong dots on
Westchester-style matches that today show no dots at all. The cap is the
mitigation this spec carries. If wrong dots show up on the bench matches
after shipping, the next lever is to stamp only when `serves_inside == 1`,
which is not measured here.

---

## Ship checklist

1. Port `boundaries`, the widened `segment` and `stamp_serves` from
   `s71_endon_serves.py` into `worker/points_endon.py`, with the two
   constants above and their provenance in comments. `CONFIG` untouched.
2. Faithfulness, lab, before commit: `s71_endon_serves.bench(key,
   serve_lead=None, stamp=False)` must equal the ported module with
   borrowing disabled, to 0.000 s, on koko, terry and tripp_rc; and the
   ported module with borrowing on must equal `s71` at lead 0.0, cap 4.5,
   on the same three. Print both comparisons; do not eyeball them.
3. The serve-anchored path is untouched by construction, but run the s41
   pattern anyway on one side-on corpus match and one end-on bench match
   through `cmd_points`, and diff match.json against the previous build:
   the side-on one byte-identical, the end-on one differing only in
   `serve_s`, the stamped count in the note, and the cards a serve tick
   moved (tripp_rc: 120 cards become 121).
4. Update the module docstring's "serve_s is always None" sentence and the
   `build_cards` docstring.
5. Commit with a pathspec (`worker/points_endon.py` and this spec), never
   `git add -A`. Merge into the production worker checkout the usual way.
   Nothing in `app_config` moves.
6. Expected result on Anton's two matches if they are reprocessed with
   nothing else changed: same 32 and 13 serves (the crop still does not
   apply on his booth), 23 of 94 and 10 of 53 cards stamped with the
   4.5 s cap (s82, measured on the built module). Placement gets those
   serves; the clean rate does not move until the serves come back, which
   is the separate detection proposal.

---

## Faithfulness, as run on the built module (2026-09-06, lab s82)

| match | production cards | new, borrowing off | new, borrowing on | stamped | clean |
|---|---:|---|---|---:|---|
| koko | 60 | equal, max drift 0.000 s | equals s71 (60 cards) | 5 | 76% → 76%, 0 lost |
| terry | 74 | equal, 0.000 s | equals s71 (74) | 2 | 71% → 71%, 0 lost |
| tripp_rc | 120 | equal, 0.000 s | equals s71 (121) | 17 | 75% → 75%, 0 lost |
| anton_long, full frame | 94 | | equals s71 (94) | 23 | |
| anton_long, crop | 103 | | equals s71 (104) | 38 | |
| anton_short, full frame | 53 | | equals s71 (53) | 10 | |
| anton_short, crop | 58 | | equals s71 (58) | 33 | |

Stamps equal s71's with the 4.5 s cap on every card. The whole points
command (`points_pipeline.py points --pipeline v2 --cut-mode plays
--endon-fallback --no-clips`) was then run from both checkouts on koko
(end-on) and ishan (side-on); the match.json diff is in the section below.

---

## Out of scope, held for Adil's word

- Ball detection cropped from the vision quad. Changes detections on
  every vision-calibrated match, both routes.
- The routing rule (serves per candidate point, plus the table-bounce
  share veto). Changes which matches reach each assembler; the veto half
  was measured on seventeen lab matches only and may move PingPod W37
  matches that go serve-anchored today.

Both are written up in the research record with their numbers.

## The match.json diff, both checkouts, same inputs (2026-09-06)

`points_pipeline.py points --pipeline v2 --cut-mode plays --endon-fallback
--no-clips`, production code against this branch, on the lab's stored
detections and raw video:

- **ishan (side-on, serve-anchored, 100 points):** no card moved, no
  per-point field differs, `cut_segments` identical. The only difference
  in the file is the note's trailing `84 stamped` (84 of 100 cards came
  from the serve motif; the other 16 are dense-net fallback cards).
- **koko (end-on, 60 points):** one card, the 18th, starts 2.9 s later
  (142.99 s → 145.89 s) because a detected serve at 148.12 s became its
  boundary; five cards gain `serve_s` (148.12, 253.26, 282.24, 371.98,
  418.03 s). Everything else that differs follows from that one start:
  `cut_t0` on the 43 cards after it (the cut is 2.9 s shorter), and that
  card's `clip_t0`, `highlight_evidence.table_bounces` and
  winner/how `suggestion` (same verdict, different bounce list). The
  scorecard against Adil's marks is unchanged: 34 of 45 clean, 0 lost.
