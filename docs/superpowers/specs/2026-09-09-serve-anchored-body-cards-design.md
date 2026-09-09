# Serve-anchored body cards, and ends that stop when the ball does

**Status: LIVE, 2026-09-09.** Built as commit 255879b8, installed in the
checkout the worker runs, worker restarted 08:06, `body_serve_anchor` and
`body_rally_end` both on. Rollback is one UPDATE each and touches no match
already processed.

His three decisions, which override the options below where they differ:

1. **End buffer 1.5 s**, not 2.0.
2. **Every camera, and no extra caution at the front.** In his words: where a
   serve is detected the card starts exactly as V3 starts one, with no change;
   where none is detected the bodies keep the start they have today. The cap in
   section 2.2 is therefore REMOVED: the only clamp left is the mechanical one
   that stops a card reaching into its neighbour, which V3's own assembly has
   too. The 22 fine rows that move more than a second later are accepted.
3. **The card's own end moves**, not only playback, so the clip file shortens
   too.

Adil, after watching the trial: the body cards do not always get the
beginning of the serve right, and they run on while the players pick the
ball up. Two changes, one at each end of every card.

1. **The front.** If the V3 serve detector finds a serve in a body card,
   the card opens there. No serve, no change.
2. **The back.** The card closes when the ball goes dead: the pink strip
   on the research page where the ball dribbles to a stop, or failing that
   the last time the ball crossed the net or touched the table.

The bodies still decide **where the points are**. The ball is only allowed
to move an edge of a card the bodies already drew. It may never create a
card, delete one, or split one. That rule is what kept the body assembler
honest through the trial and it does not change here.

Continues `2026-09-08-body-first-points-worker-design.md`. Every number
below was measured on 2026-09-09 over the thirteen lab matches (1,051 body
cards from model v2, the page Adil reviewed) with the scripts in
`~/Library/Caches/PongLens/body-lab/anchor/`.

---

## 1. Why

| | Median | p90 |
| --- | --- | --- |
| Body card length today | 8.4 s | 12.5 s |
| Dead time before the serve | 1.7 s | 4.0 s |
| Tail after the last time the ball was seen | 2.4 s | 4.0 s |
| Tail after Adil's winner press | 1.6 s | 3.8 s |
| The same card, serve-anchored and closed on the ball | **6.5 s** | 10.1 s |
| Best possible (serve − 1.0 to press + 0.5) | 6.0 s | 8.9 s |

Measured on the 436 cards from Adil's own seven matches that hold both a
press and a serve. About two seconds a point, and roughly 1.3 minutes off
an eighty-point match, but the median understates it: what he is reacting
to is the p90, the point that opens four seconds before anybody serves.

**Coverage.** 713 of the 1,051 body cards have a V3 serve close enough to
anchor to (per match: 78 to 88 on side-on cameras, 26 to 62 on end-on and
booth cameras). Anchoring to the stamps production already carries reaches
only 354, and **zero** on Terry 2, Koko 2, both Hugo matches, Wayne Wei and
Tim, because the old serve detector finds nothing there at all. Where both
exist they agree to 0.01 s at the median over 464 pairs, so this is a
coverage change, not a disagreement about where serves are.

---

## 2. The front: the serve anchor

### 2.1 Where the serve list comes from

Production has no V3 serve list. Porting it is the bulk of this work:
`serve_v2rule.serves` (1,119 lines, ~40 frozen gates) plus `handover`
(184), `servedwell` (232), `tossfilter` (75), `holepatch` (105) and
`cropinfo`, then the page-level chain that turns raw detections into the
accepted list. Ported settings, all currently lab defaults:

- gates: the held-ball rule (`held_slow_w 2.0`, `held_min_s 0.1`,
  `held_trumps_rally`, `held_rally (1, 2.5)`), `net_partner_clear_m 0.4`,
  `bounce_within 0.6`, `unpaired_rally (2, 3.0)`, the hands rules
  (`hands_box_per_frame`, `hands_drop_still_s 0.1`, `hands_parked_px 8`,
  `hands_empty_abstain`, `hands_abstain_rally (1, 3.0)`);
- chain: `V3_SEQ=2` (sequenced, not parallel), `V3_PAIR_WIN=6.0`,
  `V3_RALLY_OVERRIDE=AT:3:3.0`, away veto **off**, `V3_PORTABLE=1`;
- `V3_MERGE_SKIP_PAIRED` and `V3_PASS_ANCHOR` on.

`V3_PORTABLE` is not optional. It converts five pixel-and-frame constants
into table widths and seconds. Production takes 60 fps uploads; the lab
corpus is 30 fps, where the difference is invisible by construction.

**Everything it needs is already in hand** when the body pass runs: the
ball track and its candidates, the table corners, the crossings and
bounces (all in `points_v2.Evidence`), the frame rate, and the players'
boxes from the pose pass. No new model, no new video read, no API call.

**Two adapters, and both can change the answer silently.**

- *The player boxes.* The lab's `servedwell.People` reads an overlay file
  and re-derives which end each box belongs to from the table's own end
  lines, deliberately **not** trusting `choose_players`' near/far labels,
  because on a camera that separates the players left to right the labels
  swap mid-serve. The port must keep that derivation even though
  production's `players.json` carries the labels.
- *The sampling rate.* The lab's boxes are 6 a second; production's are
  10. `People.at` accepts a box within 0.15 s, so at 6 a second some
  lookups find nothing and the person gates abstain. At 10 a second they
  will not. The port is therefore **more permissive than the lab by
  construction**, and section 6 measures that rather than assuming it away.

**Cost.** Timed on four matches: 1.7 s (Koko 2), 6.1 s (Hugo 11 min),
9.6 s (Yu Yu Lin), 11.0 s (Louis); the full evidence rebuild 4 to 23 s.
Against the trial's 8.7-minute Hugo match, which took 2,500 s end to end
with 770 s of that in the pose pass, this is under half a percent. Compute
is not a reason to hesitate; the 1,800 lines are.

### 2.2 The rule

For each body card, in time order, with `prev_t1` the end of the card
before it:

```
candidates = kept V3 serves s where
    t0 - 3.0 <= s <= min(t1, t0 + 4.0)          # near this card's start
    and s - 1.6 >= prev_t1 + 0.3                # cannot reach into its neighbour
if no candidate: leave the card exactly as it is
s = the earliest candidate
new_t0 = max(prev_t1 + 0.3, s - 1.6)
if new_t0 >= t1 - MIN_CARD_S: leave the card as it is
```

The cap on the card's first net crossing was in the reviewed draft and Adil
removed it: a detected serve is to be treated exactly as V3 treats it. What
remains is `prev_t1 + 0.3`, which is not caution but arithmetic, because two
cards cannot occupy the same second of video.

`1.6 s` is `points_v2.HEAD_LEAD`, production's own lead before a serve, so
an anchored body card opens exactly where a ball-first card opens.

**The cap, measured and then dropped.** Refusing to open a card after the
ball first crossed the net inside it cost nothing on the good side (starts
moved later 332 → 298, median unchanged at 0.9 s) and removed six risky
moves. Adil's call is that a detected serve is a detected serve, so it is
not in the build. Kept here because the measurement stands if the residual
risk in section 7 ever shows up on a real match.

**What it does.** 181 starts pull earlier (median 0.8 s, up to 4.1 s):
these are the cards that were cutting into the serve set-up, and pulling
back can never cut play. 298 starts move later (median 0.9 s, max 2.4 s):
this is the dead time Adil is complaining about. 200 are already right.

**Where it is checked against a human.** Rowel is the only match with
serve taps. Anchored, the card opens a median 1.2 s before his tap (p10
−2.0, p90 −0.5), with one start of 62 landing after it. Today's body cards
open a median 1.3 s before the tap but with a p10 of −5.6 s. The anchor
does not move the median; it removes the tail.

**The residual risk, stated plainly.** After the cap, 22 rows Adil marked
*fine* would start more than a second later, and 21 of those are on Wayne
Wei and Rob — a booth camera and an end-on camera, where V3 is least
verified. Section 9 asks him whether to take that everywhere or only on
side-on and diagonal cameras.

---

## 3. The back: the end

### 3.1 The two signals

**The ball going dead** is `deadsplit.dead_runs`: a run of consecutive
table bounces the ball never rises between, which is the pink strip on the
research page. It is the better signal and it is rare. It appears inside
161 of 1,046 cards, and after requiring it to fall after the serve and to
have no net crossing behind it, **53 remain — 5% of cards**. Where it does
fire it starts a median 2.0 s before the last ball event, because the
tracker goes on seeing the ball dribble after the point is over. That gap
is the difference between "the point ended" and "the ball stopped moving",
and it is why the pink strip is worth preferring when it exists.

**The last ball event** — the last net crossing or on-table bounce inside
the card — carries the other 95%.

### 3.2 The rule

```
E = the start of the first dead run that falls after the card's serve
    and has no net crossing after it
    else the last net crossing or on-table bounce inside the card
new_t1 = min(t1, E + 1.5)
if new_t1 <= new_t0 + MIN_CARD_S: leave the end alone
write end_evidence_s = E
```

**Buffer, measured against the winner press.** A clip that ends more than
a second before the press has probably cut the deciding shot, since the
press lands a median 0.9 s after the last ball event.

| Buffer | Trim per card (median / p90) | Total over 13 matches | Ends >1 s before the press | Worst |
| --- | --- | --- | --- | --- |
| 1.0 s | 1.4 s / 2.8 s | 24.8 min | 69 of 447 | 2.3 s |
| **1.5 s** | 0.9 s / 2.3 s | 18.0 min | **18 of 447** | 1.8 s |
| 2.0 s | 0.4 s / 1.8 s | 12.1 min | 7 of 447 | 1.3 s |

**1.5 s is Adil's choice.** It takes half a second more off every point than
2.0 s does, and puts eighteen cards in 447 more than a second before the
press instead of seven, worst case 1.8 s before a press that is itself about
0.7 s late.

### 3.3 The end that matters is already wired, and body cards defeat it

`app_config.unscored_rally_end` is **on** with a 1.75 s buffer, and
`tap_end_playback` is **on**. `effectiveEnd` in
`src/app/match/[id]/playhead.ts` already ends a scored point at the press
plus half a second, and an unscored point at `points.rally_end_cut_s` plus
1.75 s.

`points_pipeline` fills `rally_end_cut_s` from the card's
`end_evidence_s`, and `body_points.assemble` sets that to the **body
segment's** end, which sits `pad1` (0.8 s) before the card end. The trim
therefore computes to a moment later than the clip already ends and shaves
nothing. Every unscored body-cut point plays to its full padded end. That
is the pick-up wait, and it is a two-line cause.

So writing a truthful `end_evidence_s` is worth doing **even if the rest of
this spec is rejected**: it switches on a feature that is already deployed,
already flagged, and already reviewed, and it costs no compute at all.

### 3.4 Guards measured and rejected

Do not re-propose these without new evidence.

- **The 2.7 s max-tail guard** (`RALLY_END_MAX_TAIL_S`, borrowed from
  `playhead.ts`): refuse the trim when the last ball event sits more than
  2.7 s before the card's end. It cuts the saving from 17.1 to 4.2 minutes.
  The guard was written for ball-first cards, where a long gap means the
  tracker lost the ball. On a body card the end comes from the players, so
  a long gap is the pick-up itself — precisely what we are removing.
- **The body model as a second witness** (refuse the trim while the play
  reading stays above 0.5): it blocks 188 of 534 trims and drops the
  saving to a median of 0.0 s. The model was trained on segments that
  include the pick-up, so it reads the pick-up as play. It is not
  independent evidence here.
- **A self-calibrating silence test** (trim only if the final silence is
  longer than the card's own worst tracking hole): blocks 343 to 489 cards
  and moves the cards ending early only from 18 to 16. It costs a third of
  the saving and buys almost nothing.

The buffer is the guard. That is the finding.

---

## 4. Where the code changes

All of it is inside the worker; no app, database or admin change is
needed, because `end_evidence_s` and `serve_s` already flow to
`points.rally_end_cut_s` and `points.serve_s`.

| File | Change |
| --- | --- |
| `worker/serve_v3.py` (new) | the ported serve rule and its chain, one entry point: `serves(track, corners_px, crossings, bounces, players, fps) -> [t]` |
| `worker/serve_v3_gates.py` (new) | the frozen settings, as data, with the sha the fixture checks |
| `worker/body_points.py` | `refine()` gains the anchor and the end rule, both behind their settings; `assemble()` takes the V3 serve list beside the existing one |
| `worker/points_pipeline.py` | block 2d computes the V3 list after the pose pass and passes it in; the note sentence gains its clause at the END, after the regex the admin page reads |
| `worker/tests/` | the parity fixture and its test |

`holepatch` monkeypatches `points_v2.bounces`. In the lab that is
harmless; in the worker it must be scoped to the serve computation and
undone afterwards, or the ball pipeline's own bounce reading changes
underneath it. This is the single most dangerous line in the port.

No new processing stage, so `processingView.ts` needs nothing. The cloud
twin is disabled and is not part of this.

---

## 5. Flags and rollback

Two keys in `app_config`, both read per job like `points_pipeline`, both
overridable per job through `options`, both failing open to today's
behaviour on any error:

- `body_serve_anchor` = `off` | `on`
- `body_rally_end` = `off` | `on`

Rollback is one UPDATE each, and neither touches a match already
processed. Shipping them separately is deliberate: the end rule is small,
cheap and reversible; the front rule carries 1,800 lines of new code.

---

## 6. Verification, before anything is switched on

**Done, 2026-09-09.** Parity: all thirteen matches, every serve contact and
every dead-ball run identical to the millisecond against the lab's own chain
(`worker/tests/test_serve_v3_parity.py`, 14 tests). Card rules: twelve unit
tests. Cards: the real assembler over the thirteen matches, count unchanged at
1,014, 692 starts anchored, 769 ends closed, median card 8.6 s to 7.0 s. The
whole worker suite runs as it did before (two failures, both already there on
origin/main). Steps 2 and 3 below are still owed.

**End to end on a real job, 2026-09-09 08:43** (the QA account's match
1bc1e30d, 645 s, reprocessed with both switches on): the serve detector ran
inside the points child and found 43 serves from 49 detections, dropping 4
passes and 2 unpaired, plus 4 dead-ball runs; 47 cards came out, 26 started
at their serve and 38 closed on the ball, 2 of those on a dead ball. Every
point carries a `cut_t0` and, for the first time on a body-cut match, a real
`rally_end_cut_s` — 47 of 47, where before the trial wrote the body model's
own play-off and the app's unscored trim could do nothing with it.

1. **Parity.** Freeze the lab's own accepted serve list for the thirteen
   matches (`serves_v3.json` beside the existing frozen inputs in
   `~/ponglens-models/body-poses/<m>/`). The port must reproduce every
   time within 0.05 s when fed the lab's own 6-a-second boxes. A test in
   `worker/tests/` that fails the build otherwise.
2. **The sampling difference, measured not assumed.** Run the same port
   against 10-a-second boxes and report the serves it gains and loses per
   match. If it moves cards, it is a finding, not a footnote.
3. **The page.** Rebuild all thirteen research pages with both rules on
   and score them against Adil's 303 row calls, the way the w15 window was
   scored: missed / fused / extra / early / junk, plus the new column that
   matters here — cards whose start now sits within 1.6 s of the serve.
   His `fine` rows are the ruler; a rule that moves one of them is a
   regression until he says otherwise.
4. **One real upload** through the worker end to end with both flags on,
   checked on `/admin/uploads/<matchId>`: the note reads correctly, every
   point has a `cut_t0`, and the ball cards are still kept beside the body
   cards.

---

## 7. What we accept

- **A wrong serve moves a start.** The cap stops the mid-rally case; a
  false serve in the dead time before a point can still open the card
  1.6 s before itself. It cannot open a card that does not exist, and it
  cannot reach into its neighbour.
- **Seven cards in 447 end about a second before the press.** With the
  press being ~0.7 s late, they are ending at roughly the true end of the
  rally. Nobody has to edit anything.
- **No serve, no change.** 338 of 1,051 cards keep exactly the edges the
  bodies gave them. That is the design, not a shortfall.

---

## 8. Build order

1. `end_evidence_s` from the ball, behind `body_rally_end`. Half a day,
   no V3, switches on the trim that is already deployed.
2. The port, with the parity fixture, offline only. Two to three days.
3. The anchor in `refine`, behind `body_serve_anchor`. Half a day.
4. Rebuild the thirteen pages, score against his calls, show him.
5. Flip, one flag at a time.

---

## 9. Answered in review, 2026-09-09

1. **End buffer 1.5 s.**
2. **Every camera, and the front cap dropped.** A detected serve starts the
   card exactly where V3 would start it. No serve, no change.
3. **The card's own end moves**, so the clip file shortens with it. The
   clip is re-cut by the trigger on `points` that already exists.
