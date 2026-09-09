# Body detector: the crop, player identity, and coverage (2026-09-08)

Adil's question: the body-based point detector cuts Anton's match against
Wayne Wei almost perfectly except two cards (7 and 12) where Anton's stick
figure leaves the frame and the card ends early; Lester's early endings looked
like the same thing. Is it the crop the person detector runs on? Would
processing the raw frame fix it? And, after the ruler changed mid-day: what is
the body detector's COVERAGE, and what else can place a point's end without
creating junk?

Lab: `scratchpad/poseretest` (V3 + body lab), harness scripts in `scripts/`
here (they carry the session's absolute scratchpad paths; treat them as a
record of what was run, not as a tool). Matches: the 13 of the body page
(07aeee04 excluded). Model: the deployed body dumps (`bodyfirst.py VFINAL2 ...
--fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --dump`,
`V3_BF_SMOOTH=0.5`, see `poseretest/BODYFIRST_README.md`).

## Adil's ruler (stated 2026-09-08, applies to everything below)

Coverage first: every scored production point has a card behind it. Then
two points glued under one card. Early or late against his taps is
secondary: the taps are right 70–80% of the time and fuzzier on split
points. "Junk" (cards on nothing, or on rallies he deleted) is the cost side.

## 1. The mechanism on Wayne Wei cards 7 and 12

Traced play probability and both players' boxes through each card, window
poses beside full-frame poses (`compare_all.py`, the trace is in the session).

- **Card 7 (77.0–82.1 s, production to 88.9 s).** At 81 s Anton runs back
  toward the camera on the left until his box is 60% of the frame height and
  half outside the picture. The person window (x from 191 px) lost him at
  81.5 s; the whole frame keeps him to 83 s, then the picture itself cuts
  him. From 84 s his box shrinks steadily for 3.5 s: he is walking back to
  the table, so the rally most likely ended near 84 s and production's
  88.9 s is production being generous.
- **Card 12 (125.0–130.1 s, production to 141.7 s).** Anton is outside the
  picture, or hanging on its extreme left edge at two thirds of the frame
  height, from 130 s to 140.5 s while the rally continues and Wayne is
  visible and hitting throughout. The per-frame player chooser hands Wayne
  the "near" slot and a spectator mid-room the "far" slot; the model calls
  it dead. No crop setting shows a player the camera did not capture.

The chooser (`choose_players`: near = biggest person, far = biggest person
overlapping the table, everyone else dropped) is re-decided every frame, so
any clipped or missing player becomes a slot swap. It also needs the table
corners, which is the one place the body pipeline still depends on the table.

## 2. Full frame vs window, and a two-second identity patch

`redo.sh`: for each variant, swap the pose file in, re-run the dump command,
build the page, restore. The deployed dumps were first reproduced from the
deployed poses and matched exactly (`p` and `segs` equal), so the deltas are
real. **Trap that cost a round:** the compare page READS
`bodyfirst/bf_<m>.npz`; swapping a pose file and rebuilding the page
changes nothing. Four "results" came back identical to the deployed cards
before this was noticed (memory: `body-dump-is-an-input`).

`pose_fix.py` is the patch: a slot's box that overlaps the other slot's box
is dropped; a box that matches the other slot's recent box is relabelled; a
box on the window edge under 60% of that slot's recent width is treated as
missing; then either hold the last good pose for ≤2 s ("hold") or leave the
gap ("nan").

| Wayne Wei card | window (deployed) | full frame | full + hold |
|---|---|---|---|
| 7 ends | 82.1 s | 83.6 s | 84.1 s |
| 12 ends | 130.1 s | 130.2 s | 130.2 s |

Wayne overall (ruler = production's cards): ok 67 → 68 of 89, cards ending
>2 s before production's end 40 of 86 → 41 of 87.

| Lester, 105 scored points | cards | ok | end before press | missed |
|---|---|---|---|---|
| window, deployed | 108 | 103 | 12 | 0 |
| full frame | 109 | 101 | 11 | 0 |
| window + hold | 111 | 103 | 5 | 0 |
| window + nan | 107 | 102 | 6 | 0 |
| full frame + hold | 114 | 103 | 6 | 0 |

Lester's window already starts at x = 16, so the whole frame adds nothing;
his early endings are the near player leaving the picture's own left edge.
The four that survive the patch are that player gone for more than 2 s.

**Identity patch across the corpus** (`hold_all.sh`, `compare_bf.py`,
scored with `bodyfirst.score` on the dumps, 973 points):

| | deployed | hold |
|---|---|---|
| points with a card | 923 | 925 |
| points with their own clean card | 758 | 747 |
| points sharing a card (fusedP) | 135 | 149 |
| stray cards | 85 | 107 |

Neutral on coverage, worse on tidiness. The proper fix (choose the two
players once, follow them by continuity, treat a missing one as unknown, add
visibility features and retrain) is still right for the Anton case and for
cutting the table out of the loop, but it must be scored on this table.

**Crop conclusion.** There is no single crop. The ball detector needs its
tight crop (a ball is ~10 px; the model shrinks its input). The person
detector's cost per sampled frame is the same whatever rectangle it is
given, and pose runs inside each person's box at source resolution. Run the
person detector on the whole frame by default; a window only when the
players measure too small, drawn around the players (or the projected
playing area), never around the ball's flight volume. The crop touches a
second or two on one card and the leg-cut cases below; it is not the lever.

## 3. Coverage census, deployed model, 13 matches (`missed_census.py`)

923 of 973 points have a card (94.9%). Lester, Yu Yu Lin, Louis, Rowel,
Hugo 11m have no misses. The 50 misses:

- **10: the far player hidden** behind the near one for 40–100% of the point
  (Hugo 22m 7, Tim 3; the end-on cameras). A missing player's features
  become zeros, which after standardising reads as an idle player, not an
  unknown one.
- **27: the model saw play (p ≥ 0.5 inside the point) but the decoder
  dropped it.** Mostly 3–5 s points with a weak, brief reading against a
  length prior tuned for 6 s rallies.
- **13: the model never read play** with both players visible. On Rob and
  Koko 2 the near player's legs are cut by the window bottom for most of the
  point (Koko 2's camera itself cuts the feet).

72 point pairs share a card; in 68 the gap between the points is under 2 s
and the model dipped below 0.5 inside the gap on only 12. Bodies do not
look different for one second between two quick points.

## 4. Decoder sweep (`sweep_decoder.sh`, 973 points, no --dump)

| config | missed | fusedP | split | stray | cards |
|---|---|---|---|---|---|
| deployed (dur_w 8) | 50 | 135 | 71 | 85 | 1024 |
| dur_w 4 | 48 | 130 | 75 | 102 | 1055 |
| dur_w 2 | 46 | 138 | 80 | 124 | 1084 |
| dur_w 1 | 44 | 139 | 82 | 139 | 1109 |
| play_min 1.5 | 50 | 135 | 71 | 85 | 1024 |
| bias 0.5 | 37 | 175 | 82 | 136 | 1079 |
| bias 0.5, dur_w 4 | 30 | 190 | 84 | 150 | 1096 |
| bias 1.0 | 22 | 237 | 98 | 176 | 1123 |

The minimum point length does nothing. Making play cheaper buys coverage
with glue and strays. On the nine bundle matches through the page ruler
(617 points), bias 0.5 / dur_w 4 takes missed from 36 to 19, fused cards 34
to 44, cards on nothing 30 to 31, cards on rallies Adil deleted 32 to 48.

## 5. Where a point ends (`end_signal.py`, `end_chain.py`)

320 scored points with a press on the nine matches whose crossings bundle
survived the temp sweep.

- **Body alone:** press minus card end median +0.67 s; 57% within ±1 s, 87%
  within ±2 s; 30 end >2 s early (Terry 2 9, Hugo 11m 9, Lester 6, Rob 4),
  12 end >2 s late.
- **The ball's last crossing or bounce + 0.8 s:** 144 of 326 ends more than
  2 s late. Players bounce the ball before serving, fetch it, knock it
  about. Never use the last sighting as an end.
- **The ball as continuity:** extend a body card only while net crossings
  keep arriving with gaps ≤ 0.8 s from before the body's end, stop at the
  first silence, cap 0.3 s before the next point. Repairs 7 of the 30 early
  endings, pushes 0 late. With table bounces too: 11 repaired, 3 pushed
  late. Creates no card.

The other twenty early endings are the two end-on cameras and players out
of the picture; they need the far player's strokes carried by a model that
knows which body it cannot see.

## 6. The ball's four statements in confirm mode (`refine_run.sh`)

`V3_BODYFIRST=confirm` does nothing by itself: `V3_BF_NOCROSS`,
`V3_BF_SPLIT` (+`V3_BF_SERVE`), `V3_BF_END`, `V3_BF_AFTER_FIRST` are each
off by default (`sweep_dead._bf_refine`). A first run with the mode on and
no switches measured nothing and had to be redone. Nine bundle matches, 617
points, page ruler (missed = point with no card; fused = card holding two
points; extra = card on nothing; junk = card on a rally Adil deleted; early =
card ending before his press):

| cards from | cards | ok | missed | fused | extra | junk | early |
|---|---|---|---|---|---|---|---|
| deployed dumps, body alone | 616 | 517 | 36 | 34 | 30 | 32 | 54 |
| + quiet (no ball event → drop) | 611 | 518 | 37 | 36 | 26 | 34 | 52 |
| + split (two serves ≥3 s apart) | 698 | 481 | 32 | 28 | 76 | 36 | 48 |
| + end to last crossing | 625 | 521 | 34 | 34 | 28 | 34 | 158 |
| + end to last crossing or bounce | 625 | 521 | 35 | 33 | 28 | 33 | 120 |
| + after first ball card | 625 | 522 | 32 | 35 | 28 | 34 | 51 |
| + quiet, split, after first | 684 | 477 | 37 | 29 | 74 | 36 | 49 |
| bias 0.5 / dur_w 4, body alone | 672 | 523 | 19 | 44 | 31 | 48 | 41 |
| + quiet | 636 | 520 | 26 | 45 | 26 | 45 | 43 |
| + split | 760 | 484 | 19 | 31 | 83 | 50 | 33 |
| + after first | 672 | 523 | 19 | 44 | 31 | 48 | 41 |
| + quiet, split, after first | 724 | 481 | 26 | 32 | 78 | 47 | 35 |

- **Splitting on detected serves un-glues 6–13 cards and litters 46–52
  cards on nothing.** The serve detector fires inside rallies and knock-ups
  often enough that every split is bought with four strays. Dead at this
  precision.
- **Pulling the end back to the ball triples the early endings** (54 → 120
  or 158): the ball detector misses the tail of rallies. Dead; the ball may
  extend an end by continuity (section 5), never trim one.
- **Dropping cards the ball never saw** costs coverage (1 point on the
  deployed cards, 7 on the cheaper-play cards, where the extra coverage is
  exactly the points the ball was blind to) for 4–5 fewer strays. Not worth
  it.
- **Refusing cards before the ball pipeline's first card** is the only
  harmless statement: +5 ok, −4 missed, +2 junk on the deployed cards; no
  effect on the cheaper-play cards.

So the coverage frontier is the decoder bias alone: on these nine matches
19 missed instead of 36, for 10 more glued cards, 1 more card on nothing and
16 more cards on rallies Adil deleted. The ball cannot tidy that up today;
the glued pairs need a boundary signal bodies do not carry at 0.5 s
smoothing, and the strays are real rallies he chose not to keep.

## What to do next, in order of coverage

1. Decide the bias trade on the ruler above (17 inserts saved for 10 splits
   and 17 deletes on 617 points). Measure it on the four bundle-less matches
   once their bundles are rebuilt.
2. The chooser: follow the two players by continuity in the pose stage,
   treat a missing one as unknown, add visibility features (per-joint
   confidence, fraction of the window each body is present) and retrain. This
   is the fix for a player out of the picture and for the hidden far player,
   and it removes the table from the body pipeline. Score on coverage first.
3. The ball as continuity at the end of a card (crossings, gap ≤ 0.8 s): +7
   early endings repaired, 0 pushed late, no cards created.
4. Run the person detector on the whole frame; window only when players
   measure small. Expect a second or two on the odd card and the Rob/Koko 2
   leg cases, nothing else.

## Traps

- The body page reads `bodyfirst/bf_<m>.npz`; regenerate it with the dump
  command for any pose experiment, and restore `bodyfirst/` and
  `/tmp/v3exp/bodyedge` after, because other matches train on the swapped
  one.
- macOS `xargs -I` caps the assembled command at 255 bytes ("command line
  cannot be assembled, too long"); pass state through exported variables and
  a runner script (`rf_one.sh`).
- A zsh function's loop variable is global: `restore_all`'s `for m` clobbered
  the caller's `m` and the corpus loop ran Tim eleven times. `local`.
- The crossings bundles for Yu Yu Lin, Louis, Anton Aug and Julian were lost
  to the temp sweep; their pages cannot be rebuilt until `make_bundle.py` is
  re-run from detections that may also be gone. `compare_bf.py` scores from
  the dumps and needs no bundle.

## 7. Closing the loop: Adil's calls on the rows (built 2026-09-08)

Adil's ask: a way to say, on the page, "this was fine to miss, the tap or
production card was wrong to start with", so the numbers he is shown update.

**Design.** Every row on the Body detector and V3 pages (a production point,
a card on a deleted rally, a card on nothing) carries one call about MY card
on that row: **fine as is** (the reference is off, or the flag does not
matter), **genuinely wrong**, **unsure**, plus a free-text note. Stored in
`research_row_verdicts` (page, match, row time, verdict, note; admin-only
RLS), written by `POST /api/research/row-verdict`. Keyed by the row's
REFERENCE time (production's card start, else my card's start, to 0.1 s),
never a card number, so a rule change cannot re-point a call.

**Arithmetic, in one place** (`src/app/research/v3-serve-detector/rowCalls.ts`,
unit-tested): a flagged row called fine leaves both the count and its
denominator. Points found = (points − missed) / (points − excused missed);
Clean likewise over problem points; Endings hold your press over pressed
points; Junk over cards. The page shows each percentage as flagged and
"after your calls"; the across table shows "(n you called fine)" beside
each hard number; three filters (called fine / called wrong / problems not
yet called) list the rows behind them. The lab reads the same table
(`scripts/verdicts_pull.py` under the worker venv →
`verdicts_<page>.json`; `scripts/adjusted_numbers.py` prints every match's
numbers as flagged and adjusted with the same rules), so a number here and
a number on the page cannot disagree.

**What "fine" means for each flag:** a missed point → it was not a point, or
not where the reference says; an early ending → the tap is late or the
point was split; a fused pair → the two production cards are one rally; a
card on a deleted rally or on nothing → a real point he never carded. The
raw counts stay on the page too; the calls sit beside them, never replace
them.

**The fixed page** (pushed to main 2026-09-08: 90b557b5 the row calls, 37ac1bf4 the payloads). The nine bundle matches were re-exported with the
deployed settings plus `V3_BF_EXTEND=both V3_BF_EXTEND_GAP=1.2
V3_BF_EXTEND_PMIN=0.3` (the ball keeps an end open by continuity, section
5) and `V3_BF_AFTER_FIRST=1`; Wayne Wei's lab poses are now the full-frame
ones (`pose_95a07786_window.json` keeps the old window poses). Cards whose
end the ball kept open say so in their `why` ("end kept open by the ball").
Numbers: see the table below.

**Fixed vs baseline, nine bundle matches, 617 points** (baseline = the
deployed settings re-exported on today's ball data, so the page's earlier
numbers differ slightly from both; the sweep_dead.py change is inert with
the switch off, checked card for card on Lester):

| | cards | ok | missed | fused | extra | junk | end before press |
|---|---|---|---|---|---|---|---|
| baseline | 618 | 517 | 37 | 34 | 29 | 35 | 51 |
| fixed | 619 | 518 | 37 | 33 | 29 | 35 | 44 |

Early endings 51 → 44 (Lester 8 → 6, Terry 2 16 → 15, Koko 2 7 → 6, Hugo
11m 12 → 9); coverage, extras and junk unchanged; Wayne Wei +1 clean card
from the full-frame poses. 28 of Wayne's 87 cards had their end kept open
by the ball. Anton's card 7 now runs 77.0–83.6 s (was 82.1); card 12 (now
card 11) 125.0–130.5 s, still cut: he is outside the picture for ten
seconds and the ball chain breaks at the body's low reading, as section 5
predicted. Those two rows are the first candidates for a call on the page.

Lab state after this: `pose_95a07786.json` is the full-frame pose file
(`pose_95a07786_window.json` the old one); the dumps in `bodyfirst/` and
the snapshot `fullframe/deployed_bodyfirst/` match the deployed page. A
re-dump after swapping a pose file must also purge that match's EDGE cache
entry (`bodyfirst._edgekey`), or `snap_edges` fails on a sample-count
mismatch (6149 vs 6150) — the `redo.sh` harness does; `fixed_export.sh`
did not, and `wayne_redo.sh` repaired it.

**Incident on the first deploy (37ac1bf4, fixed in 06900be3).** The row-call
buttons shared the `.vd` strip with the serve-call buttons, whose handler was
bound to every `.vd button`. Clicking "fine as is" ran both: mine saved the
call (the logs show 200s), then the serve handler repainted all three row
buttons from an undefined verdict and POSTed a clear to the serve route,
deleting any serve call on that row. Fix: the serve handler binds to
`button[data-v]` only, and both routes refuse a request with no verdict
field instead of treating it as a clear. Adil's serve calls on the rows he
clicked that afternoon may be gone (16 rows from 2026-09-05 remain).
`npm run test:research-smoke` (esbuild + jsdom, `scripts/research-smoke.mjs`)
now mounts the component against the committed Rob payloads and works a
row; it fails on the morning's component and passes on the fix.

## 8. The ball as a witness inside the model (started 2026-09-08 16:00)

Adil's examples after the fix (Wayne Wei points 21, 11, 60, 61): the ball
kept crossing the net while the bodies' play reading collapsed, so the gated
end rule of section 6 stopped. On point 21 Wayne Wei was already on
whole-frame poses. The cause is no longer the crop: the body model has
learned that a player deep behind the table looks like dead time, and the
ball is the only witness that the point is on.

**Lob check first** (`lobcheck.py`): on the 86 pressed points whose body card
ends more than 2 s before the press, the ball detector still tracks the ball
at a median 41.7 detections a second, and 1% of them have any gap over 1.5 s
(the other 527 points: 23.9 det/s, 0%). The ball crop is not losing the ball
on these rallies; the ball is a reliable witness exactly where the bodies
fail. No ball-crop change is warranted.

**Crossings for all 13 matches, one way** (`ballx_build.py` →
`ballx_<m>.json`): the lab's own dwell-confirmed detector
(`points_v2.crossings`) over the ball track the page's overlay carries, in
the overlay's crop pixels with its own corners, on the pose files' clock.
Matches with a bundle agree closely where the bundle was built from the same
track (Rowel 572 of 611 within 0.15 s, Wayne 587 of 614, Hugo 22m 966 of
1049, Tim 131 of 139) and poorly where the bundle came from another
detection pass (Lester 247 of 442, Rob 226 of 527, Koko 2 156 of 328, Terry
2 172 of 330, Terry 2 overlay-derived 534). The clock offsets are ~0, so the
disagreement is the track, not the clock. Four matches (Yu Yu Lin, Louis,
Anton Aug, Julian) have no bundle and only this source.

**The feature family "ball"** (`bodyfeat.py`, two columns): seconds since the
last net crossing, capped at 4 s; crossings in the last 3 s. Dead time is
"not lately, zero tempo"; a rally with a player deep behind the table is
"just now, tempo 2 to 4" with the bodies reading low. Retrained with the
deploy settings (`--fam rhythm,floor,snap,ball`), 13 matches, leave-one-out,
against the same model without the family (`retrain_ball.sh`, `rt_table.py`).
Results: appended below.

**Whole-frame poses for the remaining ten matches** are being computed in the
background (`fullframe_all.sh`, ~4-5 h of the Mac's CPU, approved by Adil),
so the retrain can be repeated on whole-frame poses everywhere.

**Retrain, points ruler (13 matches, 973 points, leave-one-out; `rt_table.py`).**
"base" is the deployed families on today's poses (Wayne Wei whole-frame); it
reproduces the earlier table except Wayne's own row, as it should.

| run | missed | clean | fusedP | split | stray | cards | card end vs press, per-match median |
|---|---|---|---|---|---|---|---|
| base (rhythm, floor, snap) | 50 | 758 | 135 | 72 | 85 | 1025 | −0.8 s (early) |
| + ball | 48 | 753 | 151 | 60 | 77 | 997 | −0.3 s |
| + ball, dur_w 4 | 43 | 750 | 156 | 61 | 98 | 1020 | −0.4 s |
| + ball, bias 0.5 | 32 | 729 | 191 | 74 | 121 | 1049 | +0.1 s |

The ball family moves the ends where it was meant to: Wayne Wei's median
end goes from 2.0 s early to 1.3 s, Hugo 22m from 2.4 to 1.4, Hugo 11m
from 1.4 to 0.7; Terry 2 finds three more points, Wayne two, Hugo 22m
three. It costs glue: 16 more points share a card, because the ball keeps
crossing between two quick points too (a ball passed back is a crossing).
Strays fall by eight. The page ruler (nine matches, presses, extras, junk,
after the export's split-on-two-serves rule) decides; see below.

**Page ruler, nine matches, 617 points** (`ball_pages.sh`, `compare_pages.py`;
shipped = the deployed settings + end rule, as on the page today):

| | cards | ok | missed | fused cards | extra | junk | end before press | >2 s early |
|---|---|---|---|---|---|---|---|---|
| shipped | 619 | 518 | 37 | 33 | 29 | 35 | 44 | 114 |
| + ball family | 629 | 507 | 35 | 38 | 37 | 36 | 39 | 91 |

Early endings fall (114 → 91 by two seconds, 44 → 39 before the press),
missed 37 → 35, but 11 fewer clean points: 5 more glued cards and 8 more
cards on nothing. Adil's four examples: card 60 now holds to the press
(672.1 vs 672.7); card 21 ends 261.0 (production 263.0), card 61 681.1
(688.3), card 11 131.7 (141.7): still cut. A learned weight on two ball
columns is outvoted by the body features that read "deep behind the table"
as dead time, so the next step is the ball as a VETO on ending
(`bodyfirst.py --set ball_floor=…`: while crossings arrive at tempo the play
reading cannot fall below the floor). On card 11 the crossings themselves
are sparse (131.7, 137.4, 141.3; the lob rally's table bounces at 133.6,
134.6, 135.4 are there but the net-crossing detector misses the high ball),
so that card needs bounces in the witness too.

**The ball as a veto on ending** (`bodyfirst.py --set ball_floor=F --set
ball_floor_tempo=N`: while at least N net crossings fell in the last 3 s the
play reading cannot drop below F). Points ruler, 973 points:

| run | missed | clean | fusedP | split | stray | end vs press, median |
|---|---|---|---|---|---|---|
| base | 50 | 758 | 135 | 72 | 85 | −0.8 s |
| ball family, learned only | 48 | 753 | 151 | 60 | 77 | −0.3 s |
| floor 0.5, tempo 2 | 41 | 742 | 167 | 68 | 89 | 0.0 s |
| floor 0.6, tempo 2 | 39 | 719 | 187 | 81 | 101 | +0.7 s (late) |
| floor 0.6, tempo 3 | 41 | 739 | 171 | 67 | 83 | +0.3 s |
| floor 0.75, tempo 2 | 33 | 702 | 218 | 78 | 115 | +0.8 s |
| ball family with 3 knots | 50 | 743 | 164 | 67 | 78 | −0.1 s |

The veto does what the learned weight could not: the ends centre on the
press and nine more points are found. The price is glue: 32 to 36 more
points share a card at floor 0.5 or 0.6/tempo 3, because a ball passed back
between quick points is a crossing too. Higher floors glue faster than
they find. Candidates for the page ruler (where the export's split-on-two-
serves rule takes some glue back): floor 0.5/tempo 2 and floor 0.6/tempo 3.

**Table bounces as a witness too** (family `bounce`: on-table bounces in the
last 3 s and how often they changed halves), points ruler:

| run | missed | clean | fusedP | split | stray | end vs press |
|---|---|---|---|---|---|---|
| ball + bounce, learned | 46 | 735 | 183 | 44 | 67 | 0.0 s |
| + floor 0.6, tempo 2 | 37 | 716 | 199 | 64 | 92 | +0.8 s |
| + floor 0.6, alternation ≥1 | 29 | 700 | 212 | 82 | 112 | +1.0 s |
| + floor 0.5, alternation ≥1 | 42 | 726 | 189 | 52 | 75 | +0.5 s |

Bounces glue: the server bouncing the ball before a serve is a table bounce
on one half, and the alternation test does not separate it well enough at
3 s. Four more points found for 48 more shared. Tim loses five. Kept as its
own family, not in the deployed set. The crossings-only veto candidates
(floor 0.5/tempo 2, floor 0.6/tempo 3) go to the page ruler.

**Veto candidates on the page ruler** (nine matches, 617 points; shipped = the
page as deployed that afternoon):

| | cards | ok | missed | fused cards | extra | junk | end before press | >2 s early |
|---|---|---|---|---|---|---|---|---|
| shipped | 619 | 518 | 37 | 33 | 29 | 35 | 44 | 114 |
| floor 0.5, tempo 2 | 648 | 512 | 29 | 39 | 37 | 41 | 33 | 92 |
| floor 0.6, tempo 3 | 652 | 513 | 29 | 35 | 40 | 38 | 29 | 91 |

Wayne Wei after Adil's 90 calls (rows he called fine set aside): shipped
fused 1, extra 4, early 8; floor 0.6/tempo 3: fused 1, extra 2, early 3,
junk 2. Of his eight "wrong" rows the veto joins two of the four mid-rally
splits (66, 74); 42 and 79 still split; the ends cut by the near player
leaving the frame (11, 21, 18, 20) move by under a second, because they are
the identity problem, not the model's. **Adopted floor 0.6 / tempo 3** (8
fewer points with no card, 15 fewer early endings before the press, for 2
more glued cards, 11 more cards on nothing and 3 more on deleted rallies;
by the edit-cost ruler 8 inserts against 13 easy edits). The lab's deploy
command gains `--fam rhythm,floor,snap,ball --set ball_floor=0.6 --set
ball_floor_tempo=3`; the pose files' clock and the overlay-derived crossings
(`ballx_<m>.json`) are now inputs to the model.

## 9. The four matches without a bundle, rebuilt from the page's own data

Yu Yu Lin, Louis, Anton Aug and Julian lost their crossings bundle (and Yu
Yu Lin its detection file) to the temp sweep, so their body pages could not
be rebuilt. `bundle_from_overlay.py <m>` rebuilds a bundle with exactly the
fields `reload.Reloaded` and `serve_v2rule.load` read, from the V3 page's
`overlay.json` (ball track and bounces in crop pixels shifted by the crop
origin, kept serves, corners from `real_calib.json`), with crossings from
`ballx_<m>.json` and dense runs from the track; where `<m>_shifted.jsonl` is
missing it writes one from the same track. The V3 side of such a page is a
replay from the page's own track, not the original run; the body page only
takes serves, crossings and bounces from it.

Yu Yu Lin with the veto model on the rebuilt bundle: ok 86 → 88, extra 5 →
3, junk 5 → 4, ends before the press 6 → 3. Of Adil's eight "wrong" calls,
four were body cards on dead time (picking up the ball, switching sides,
passing) that the new cards no longer make; card 73 ("cut half a second too
early") now holds to the press.

**Calls whose row disappears.** A "wrong" call on a card the new cards no
longer make is a resolved problem: `verdicts_check.py` reports it RESOLVED
and it does not block a deploy; the call stays stored as the record of what
was wrong. A "fine" or "unsure" call whose row disappears is a regression
and blocks. A card on nothing that moved under a second gets a REKEY
statement (applied through the Supabase MCP before the deploy).

**Dropping a body card with no crossing and no serve inside** (`V3_BF_NOCROSS=serve`),
aimed at Yu Yu Lin's dead-time cards: on the nine matches it costs 5 points (Tim 2,
Rob 1, Terry 2 1, Wayne 1) for 1 fewer card on nothing. Rejected. Players passing or
fetching the ball often send it across the net, so a crossing does not separate
handling from play; the four Yu Yu Lin dead-time cards went away with the veto
model itself.

Deployed e51b4658 (Yu Yu Lin, Louis, Anton Aug on the veto model); **Julian is
rebuilt (`fullframe/pages_julian_new/`) but held on its old page while Adil
reviews it** — missed 4 → 3, extra 4 → 1, early 14 → 6 when it goes.

**Two traps from this step.** (1) `ball_pages.sh` snapshots the export
directory at start and restores it at the end; a page rebuilt in between
(Yu Yu Lin) was overwritten with the old one and had to be put back from
`pages_yyl_new/`. Never run two export-writing scripts against
`v3deploy/public/research/body-detector` at once. (2) The page keys a row
with JS `Math.round(t*10)/10`, which rounds .5 up; Python's `round(t, 1)`
does not (418.15 → 418.1). Every lab script that reproduces the key now uses
`floor(t*10 + 0.5)/10`; the mismatch produced a false re-key on Julian.

**Julian, against Adil's 15 wrong/unsure calls (deployed 67a42ef6).** The veto
model fixes: two split rallies (52, 77) are one card; ends now hold his press
on 17, 36, 59 and 41 (within 0.4 s); a missed point (37) has a card; a
side-change card is gone. Still wrong: three missed points (15, 31, 34) and
one cut (30). In all four Julian, the near player, is clipped at the RIGHT
edge of the person window ([553, 113, 1187, 643], a narrow crop) — the play
reading peaks for a second and collapses, and the ball's crossings are too
few (two per point) for the veto. This is the crop case proper, and it waits
for the whole-frame poses. His note on 52 names the length prior ("the
average rally is 6 seconds"): `play_mu` and `dur_w=8` do push the decoder to
end a long rally, and the veto is what now overrides it while the ball keeps
crossing. His note on 53 is about the server call (`V3_BODY_SRV`), a
separate reading not touched today.

## 10. Full evaluation against Adil's calls (2026-09-08 evening)

**Match ids on the body page.** `public/research/body-detector/index.json` is the
authority. Several lab scripts (and one compaction summary) had these scrambled,
so every table below was regenerated with this map:
10322849 Rob · 5fd822ec Hugo 11m · 5c90151a Hugo 22m · f3237587 Koko 2 ·
2eab3e3d Terry 2 · 1c08539e Tim · cebaa6d4 Rowel · bfc9b31b Anton ·
7e02fbb9 Julian · d15aad4d Louis · 77fc4dee Lester · 89b35ee0 Yu Yu Lin ·
95a07786 Wayne Wei.

**The calls.** 303 rows on 10 matches (Tim and both Hugo matches unreviewed):
164 fine, 65 wrong, 74 unsure, 167 with a note. Per match (fine/wrong/unsure):
Wayne 79/8/3, Rob 41/10/13, Louis 10/6/23, Julian 5/13/2, Yu Yu Lin 8/8/2,
Terry 2 5/8/9, Koko 2 3/6/12, Anton 7/1/6, Lester 5/3/2, Rowel 1/2/2.
Pulled with `verdicts_pull.py`, joined to the live rows with `calls_dump.py`
(`calls_wrong_unsure.txt`, `calls_fine.txt`).

### 10.1 What the 65 wrong calls are

| theme | n | rows |
| --- | --- | --- |
| whole point missed | 8 | Rob 215, Terry 2 400.5, Lester 783.5, Julian 174.4 / 360.5 / 386.6, Koko 2 196.4 / 718.4 |
| starts late, the serve is not in the card | 9 | Rob 377.9 / 558.0, Julian 528.4 / 609.6, Wayne 489.8 / 738.9 / 826.2 / 878.9, Koko 2 267.1 |
| ends cut, a player left the picture | 8 | Terry 2 701.8, Julian 306.4 / 343.9 / 406.8 / 720.7, Yu Yu Lin 1166.8, Wayne 123.7 / 251.8 |
| two points in one card (fault or receive miss, then the next serve at once) | 11 | Rob 481 / 539.7 / 708.9, Terry 2 198.2 / 238.8 / 291.3, Yu Yu Lin 537.6, Julian 433.8, Wayne 891.4, Anton 464.3, Rowel 698.4 |
| one rally split in two | 1 | Julian 905.1 (Wayne 489.8 and 878.9 are counted above) |
| junk: ball pass, fetching, walking, side change | 20 | Rob 0 / 70.4 / 79.8 / 575.6, Terry 2 204.6 / 456.3 / 531.1, Lester 3.7 / 745.0, Yu Yu Lin 759.4 / 844.9 / 1315.6, Wayne 896.0, Rowel 203.5, Louis 999.1 / 1123.1 / 1246.0 / 1376.5 / 1459.5 / 1488.0 |
| other | 8 | 2 warm-up cards (Koko 2 29.2 / 39.3), server wrong (Julian 632.9), page replayed the neighbour (Koko 2 356.3), 4 cards already gone by the time he called them |

The 74 unsure: about 48 warm-up cards (Louis 20, Koko 2 11, Rob 8, Terry 2 7),
7 lets glued to the point they belong to (Anton 5, Rowel 2, "fine if it has to
stay"), about 10 endings he felt were half a second early, 3 with dead time at
the end. None of the unsure rows is a coverage loss.

### 10.2 Causes, each measured

**A. A short point reads as dead time.** The model's "play" is rally motion. A
service fault, a receive miss or an ace has one toss and one stroke, and the
body reading peaks at 0.55 to 0.89 for one to three seconds (probe over the
eight misses, deployed dump), against a decoder that wants 2.5 s and a length
prior (median 6.3 s, `dur_w` 8) that taxes a 3 s stretch about nine log-odds
units more than a 6 s one. Every one of the eight has a V3 serve stamp inside
it (`serve_rescue.py`). Same cause behind the late starts (the serve set-up is
still, so the card opens at the first exchange) and behind most glued pairs
(the short first point has no gap the decoder can see). Loosening the decoder
on the deployed dumps, all 13 matches, no retraining:

| decoder | of the 8 misses recovered | segments over 13 matches |
| --- | --- | --- |
| deployed | 0 | 1006 |
| `dur_w=4` | 3 | 1023 |
| `bias=0.5, dur_w=4, play_min=1.5` | 6 | 1032 |
| `bias=0.5` | 6 | 1049 |
| `bias=1` | 7 | 1058 |

The earlier 973-point sweep (section 4) prices the same knobs on the decode
ruler: base 923 found / 135 fused points / 85 strays; `bias=0.5` 936 / 175 /
136; `bias=0.5, dur_w=4` 943 / 190 / 150; `bias=1` 951 / 237 / 176. Coverage
first says take it; the edit-cost ruler says it is roughly a wash. Page builds
of `loose` (`bias=0.5, dur_w=4, play_min=1.5`) and `bias05` are in
`fullframe/pages_loose` and `pages_bias05` (`variants_run.sh`, `compare13.py`).

**B. The quiet-ball rule deletes real points where the ball track is blind.**
`V3_BF_NOCROSS=quiet` throws away a body card with no net crossing and no
table bounce inside it. Across the 13 matches, 13 decoder segments after the
first scored point never reach the page; 11 of them were removed by this rule;
6 overlap a scored point, 5 of those on Tim (141 crossings in an 11-minute
match: the ball is barely tracked there). Cost: about 6 real points for about
7 junk cards. It should go, or apply only when the match's ball track is
dense enough to be trusted (`refine_census.py`, the Tim probe).

**C. A player leaves the picture.** Whole-frame poses for all 13 (chain
finished 19:28; `wholeframe_all.sh`, `compare13.py wholeframe`):

| | shipped | whole frame |
| --- | --- | --- |
| Julian missed / early(>2 s) | 3 / 2 | 0 / 0 |
| Anton missed | 4 | 1 |
| Louis short / early / junk | 10 / 6 / 22 | 2 / 1 / 19 |
| Koko 2 missed | 3 | 9 |
| Tim missed | 9 | 11 |
| all 13: missed / fused / extra / junk / short / early | 36 / 48 / 51 / 64 / 53 / 104 | 39 / 49 / 46 / 66 / 48 / 96 |
| after his calls: missed / fused / extra / early / junk | 25 / 39 / 34 / 55 / 77 | 30 / 36 / 31 / 55 / 81 |

It repairs exactly what he flagged on Julian (all three misses back, 343.9 no
longer cut) and Anton, and trims Louis's junk. Koko 2's six new misses are NOT
a whole-frame effect: Koko's lab poses were already the whole frame (identical
files, checked); the loss comes from the model being retrained on whole-frame
features of the other matches. The model is fragile on the small far player
at Westchester (182 px tall, p10 126 px). Not adoptable as it stands; it needs
the continuity chooser (section "What to do next") and the retrain checked
per venue. `verdicts_check`: 5 orphans, all unsure warm-up rows whose card
vanished; 3 rekeys.

**D. The serve stamp cannot be a rule.** 1310 stamps; 1160 inside a body card.
Of the 150 outside: 12 in a point the page missed (all 8 of his), 61 in a
covered point (a late start), 61 in nothing, 3 in production junk, 13 before
the first point. Nothing separates the 12 from the 61: body reading after the
stamp (1-s max median 0.58 rescue vs 0.68 nowhere), onset model log-odds
(about -2 in every group, `serve_witness.py`). Splitting on a second stamp:
175 of 838 clean cards carry two stamps 2.5 s or more apart (lets, mid-rally
false stamps) against 23 glued cards; spacing, ball silence, minimum body
reading, crossings between the stamps (`fault_split.py`) and the pipeline's
own dead-ball runs (`dead_split.py`: 3 right, 23 wrong) all fail to separate
them. The one usable reading: a stamp within 4 s before a card start with the
ball continuous (crossing gaps <= 0.8 s) to the card is the same point 22
times and not 8 times, of 163 late starts (`serve_evidence.py`).

**E. Junk is not a ball question.** 87 junk cards, only 8 without a crossing;
the serve detector itself fires on ball passes (Lester 3.7, Terry 2 456.3,
Louis 1246 and 1376 carry "serve seen"). 12 of the 18 wrong junk cards have
no stamp, 6 do. Lowest cost on his ruler; leave it.

**F. Glued fault-then-re-serve pairs stay glued** (D). He accepts lets; the
faults are a one-keystroke split.

### 10.3 Production cost of the body chain

Whole-frame RTMDet + RTMPose at 10 samples/s, CPU, `nice 15`, from
`fullframe_all.log`: Hugo 22m (1319 s of video) 25 min boxes + 4.5 min
poses; Rob (950 s) 18 + 4.5; Julian (983 s) 18 + 4.5; Terry 2 (960 s) 18 + 4.
About 1.4 minutes of compute per minute of video on the Mac Studio, one job
at a time. MPS is not available to these models (see "Finding the table").

### 10.4 Traps this evening

- **Never read the lab's `bodyfirst/` dumps while a variant run is in
  flight.** `wholeframe_all.sh` overwrote them for four minutes; two censuses
  and one decoder test read the whole-frame dumps and reported the deployed
  refine "killing" Julian's three points. It never did; re-run clean, the
  decoder simply had not found them. Read from `deployed_bodyfirst/` or wait.
- **The id-to-name map.** See the top of this section.
- `deployed_bodyedge` is the pre-ball-family snapshot; restoring it makes the
  next dump retrain 13 edge models (about 4 minutes). Refresh it from a run
  made with the deployed poses.

### 10.5 The two decoder candidates on the page ruler (built 20:10, `variants_run.sh`)

| all 13 matches | shipped | `bias05` | `loose` (bias 0.5, dur_w 4, play_min 1.5) |
| --- | --- | --- | --- |
| missed / fused / extra / junk / short / early(>2 s) | 36 / 48 / 51 / 64 / 53 / 104 | 23 / 59 / 50 / 86 / 39 / 93 | 23 / 63 / 43 / 90 / 40 / 83 |
| after his calls: missed / fused / extra / early / junk | 25 / 39 / 34 / 55 / 77 | 16 / 46 / 33 / 50 / 110 | 17 / 47 / 27 / 42 / 114 |

Both bring back six of his eight misses (Lester 783.5, Julian 174.4 and 360.5,
Rob 215.1, Terry 2 400.5, Koko 2 718.4); neither finds Julian 386.6 or Koko 2
196.4. `loose` also rejoins the three rows he called "started from the middle"
(Rob 558.0, Wayne 489.8, 878.9) and pulls Rob 377.9's start back over its
serve; `bias05` leaves those split. The junk arrives mostly at Westchester
(Terry 2 10 -> 22, Koko 2 14 -> 18) and Yu Yu Lin (4 -> 9). `verdicts_check`
on `loose`: 293 of 303 calls keep their row; 2 orphans, both unsure junk rows
whose card vanished (Rob 936.4, Louis 95.8). Not deployed: the trade is
Adil's to make. Payloads in `fullframe/pages_loose` and `pages_bias05`.

### 10.6 Decisions and corrections (Adil, 2026-09-08 late)

- **Loosened decoder adopted.** Adil: three more junk cards a match do not
  matter. `adopt_loose.sh`: lab dumps, `deployed_bodyfirst` (the veto model
  kept as `deployed_bodyfirst_floor60t3`), README deploy command, payloads.
  Three calls re-keyed (Yu Yu Lin 1315.6 -> 1316.0, Rowel 203.5 -> 202.9,
  Louis 0.2 -> 0.6); two `unsure` calls on junk cards that no longer exist
  (Rob 936.4, Louis 95.8) stay in the table with no row.
- **"Points" on the page are PRODUCTION cards; only a row with a winner tap
  is Adil's scoring.** Tim (0 of 57 rows tapped), Hugo 22m (0 of 94) and
  Wayne Wei (3 of 89) were never scored by him, and Rob only partly (22 of
  52). Every "missed" count on those matches is against the pipeline he is
  replacing, not against truth. Section 10.2 B overstated the quiet-ball
  rule: re-measured against tapped points it removed ONE scored point
  (Louis 356.4), not six. Rule kept for now.
- **Whole frame stays off** until the chooser exists; Koko 2's six lost
  points were a retrain effect, not a whole-frame effect, but no change that
  loses scored points ships.
- **No switch-on criterion.** Adil decides on the fly. His ruler: serve-
  anchored side-on matches are mostly fine in production; end-on and
  no-table matches are where production fails and where the bodies go first.

## 11. The pose window: does the crop need to know how far the camera is? (2026-09-08 night)

Adil's question for the production spec: on a diagonal or side camera such as
Yu Yu Lin's, a wide window could make a spectator at the side the biggest
person in the frame and be taken for the near player; can the window adapt
to the camera's distance from the table?

**What is already distance-aware.** The widened window is defined in table
widths, not pixels (`serve_v2rule._table_w`: the mean of the two end lines
in pixels), so a far camera gets a small margin and a close one a large one.
Production's `choose_players` (worker/extract_side_changes_rtmpose.py) is
distance-aware too: a person counts only within 1.1 times their OWN box
height of the table quad, so a big spectator in the foreground is excluded
unless they stand right beside the table. Its two rules come from Adil's
own 144 hand-labelled frames (2026-08-26): near is the biggest person (92%),
far is the biggest whose box overlaps the table (74%); "second biggest, no
table test" scored 46%, which is why size alone is not used for the far end.

**What the body detector Adil reviewed actually ran on.** Every deployed
pose file except Wayne's (whole frame) and Koko 2's (whole frame, because the
widened crop already covers it) is a widened crop of about one table width
each side and half a width above and below (`deployed_poses/*.json` rects
against the expected windows: 5 to 127 px apart). So his review of the
body page, Yu Yu Lin included (0 missed, 8 wrong of 93, junk and one early
end), is a review of the widened crop.

**Simulation on the whole-frame boxes** (`people_<m>_full.json`, all 13):
clip every box to a window, drop boxes with under 30% of their area inside,
run production's chooser, compare with the whole-frame pick. "Other person"
= the window's pick and the whole frame's pick overlap by under 0.3.
"Jumps" = the chosen box's centre moved more than half a box width between
samples, the wrong-person proxy from 2026-09-06.

| match | window | people in window / frame | near picks another person | far missing | jumps near / far |
| --- | --- | --- | --- | --- | --- |
| Yu Yu Lin | ball crop | 9.6 | 44.0% | 4.9% | 8.9 / 13.8% |
| | 1 width | 14.5 | 4.6% | 0.7% | 2.9 / 7.5% |
| | 1.5 widths | 16.9 | 1.6% | 0.2% | 3.0 / 7.4% |
| | 2 widths | 18.3 | 2.1% | 0.3% | 2.9 / 7.4% |
| | whole frame | 18.5 | reference | reference | 3.2 / 7.5% |
| Louis | 1 width | 12.7 | 4.4% | 1.7% | 2.8 / 6.4% |
| | 1.5 widths | 13.7 | 2.3% | 0.9% | 2.6 / 5.7% |
| | whole frame | 18.9 | reference | reference | 2.3 / 5.3% |
| Julian | ball crop | 1.5 | 60.3% | 51.1% | 7.2 / 4.0% |
| | 1 width | 2.1 | 10.0% | 8.6% | 3.8 / 1.9% |
| | 1.5 widths | 2.2 | 1.1% | 0.7% | 1.2 / 1.3% |
| | 2 widths | 2.2 | 0.3% | 0.1% | 1.3 / 1.4% |
| Koko 2 / Terry 2 | 1 width | 8.7 / 5.7 | 0.0 / 0.2% | 0.0 / 0.2% | same as whole frame |
| Lester / Rowel / Wayne | 1 width | 2.0 / 1.9 / 3.5 | 0.7 / 0.8 / 0.8% | 0.4 / 0.8 / 0.5% | 2.3 / 1.6 / 1.6% near |

Sideways clipping of the chosen players (a player's box crossing the
window's left or right edge): Julian 29% at one width, 19% at 1.5, 10% at 2,
against 8% at the raw picture edge; Lester 20% at one width, 0% at 1.5; the
booths otherwise 0 to 2%. Below-edge clipping (feet) at half a width below:
30 to 46% on most cameras; a full width below: 1 to 11% except Lester 28%,
Louis 35%, Julian 43%, where the near player stands below the picture.

**Reading.** (1) The spectator fear does not show on Yu Yu Lin: from one
table width to the whole frame the window admits four more people a frame
and the wrong-person proxy does not move (near 2.9 to 3.2%, far 7.4 to
7.5%). The chooser's own guard is doing the work, at every window. (2) The
window that matters is the booth's: Julian's near player leaves a
one-width window in a tenth of the frames and a 1.5-width window in one in
a hundred, and a booth has two people in it, so widening costs nothing
there. (3) The far player's identity jumps in halls (Koko 2 13%, Terry 2
9%, Yu Yu Lin 7%) are the same at every window: that is the continuity
chooser's job, not the crop's. (4) "Two biggest people" is measured worse
than the table rule on Adil's own labels, and a distance estimate adds
nothing the table width and the body-height guard do not already carry.

**Recommendation for the spec:** 1.5 table widths each side, one width
below, half above, clamped to the frame; production's chooser unchanged.
Regenerating the thirteen matches' poses on that window (about five hours of
CPU) is part of freezing the model, and the frozen model is checked against
Adil's calls before the flag flips. Scripts: the three probes in this
section are inline in the session transcript; the whole-frame boxes they
read are `poseretest/people_<m>_full.json`.
