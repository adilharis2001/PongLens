# What a missed serve costs, and whether the first bounce is recoverable

Date: 2026-09-03. Corpus: the ten newest scored matches, all with 15 or more
winner taps — 632 scored points, 1,025 production cards. Nothing was changed
in the assembler; this is measurement only.

## Result

The mechanism an external review flagged as the v2 assembler's top risk is
real, and it is the minority cause. Fusion — one card holding two points —
costs about **4 points in 632 (0.6%)** on this corpus, and every one of
those four was caught and repaired by the owner. The assembler builds **no
card at all** for a rally three and a half times more often, and where that
happens and we can look at it, the ball was never tracked.

| how a scored point goes missing | count | of 632 scored |
| --- | --- | --- |
| (a) fused, card under 20 s | 2 | 0.3% |
| (b) fused, over 20 s at the merge, cut by the cap and still fused | 2 | 0.3% |
| (c) card deleted by `on_own_table` | 0 | 0% |
| (d) no card built at all, inserted by hand | 14 | 2.2% |
| uncaught — rallies the owner's own scoring says are missing | 3 | 0.5% |

(a) and (b) are the four cards the owner split by hand. (d) is the fourteen
points he inserted into dead space. The three in the last row are what the
score-gap rule finds on top of all that — games fully scored, not the last
game of the match, which still did not reach eleven.

**And the mechanism is mostly not the one that was flagged.** Of six cards
independently confirmed to hold two points, **one** is a serve card whose
crossing chain ran through the boundary, and **five** are `fallback_points`
cards fused by `FALLBACK_MERGE_S`, a different constant in a different
function. Details in "Which stage fuses them" below.

## The corpus, and one premise corrected

| match | opponent | venue | scored | prod cards | production route |
| --- | --- | --- | --- | --- | --- |
| 89b35ee0 | Yu Yu Lin | Westchester TTC | 93 | 128 | serve-anchored |
| d15aad4d | Louis | Westchester TTC | 91 | 141 | serve-anchored |
| fa96cd0e | Kyle (cropped) | Westchester TTC | 51 | 66 | serve-anchored |
| 5a6d1a61 | Jose Suarez | Westchester TTC | 26 | 72 | serve-anchored |
| 98a9c15c | — | PingPod W37 | 74 | 86 | serve-anchored |
| bfc9b31b | — | PingPod W37 | 76 | 89 | serve-anchored |
| 77fc4dee | Lester | Pingpod | 104 | 126 | serve-anchored |
| b7a01f05 | Lester 2 | Pingpod | 73 | 126 | serve-anchored |
| dd66043d | Lester crop test | Pingpod | 20 | 124 | serve-anchored |
| 9ef09000 | Tomo | Aro | 24 | 67 | serve-anchored |

**All ten are `route serve-anchored`, the four Westchester matches
included.** The router keys on serves per minute, not on the venue or the
camera, and these four are all above the 2.1 threshold (2.50 to 3.37). So
there is no end-on split to make on this corpus: `points_endon.build_cards`
never ran on any of it, and every number below is a v2 number. Read from
each match's own `match.json` notes; two other Westchester matches in the
bundle set (01aba2ce Kyle, 99df6fbf Young) *are* end-on, so the venue really
does produce both.

**77fc4dee and b7a01f05 are the same video uploaded twice** — identical
duration, identical 101 accepted serves, identical cards. They are two
matches for scoring and one video for anything measured off the evidence, so
mechanism counts below never double them without saying so.

## How the numbers were taken

Three rulers, none of them a second opinion about a shipped rule.

**1. The owner's own repairs.** A point row whose `(t0, t1)` does not appear
in that match's `match.json` was made in the app, not by the worker. Three
shapes and they mean opposite things: a **split** is two rows tiling one
production card end to end, which is a card that held two points; a **join**
is one row covering two production cards, which is the opposite defect; an
**insert** is a row overlapping no production card at all, which is a rally
that got no card. `scripts/repairs.py`. Twenty-nine hand-made rows on the
corpus: **8 rows forming 4 splits**, so 4 fused cards; **15 inserts**, of
which 14 carry a winner; and 6 joins — one clean join plus five rows that
cover two production cards only partially, which is a join with the boundary
dragged afterwards. Four of those five are on d15aad4d.

**2. The score.** `scripts/gaps.mjs` imports `scoreMatch` from
`src/lib/research/scoreGaps.ts`, which folds through `stepBoundaryWalk` —
the same boundary walk the match page and the serve rotation use. Three
suspect games, three missing rallies. It also reports three *overrun* games
(6-12, 10-13, 7-12), which is the opposite fault — a boundary in the wrong
place, not a rally lost — and is not counted here.

**3. The assembler, replayed.** `scripts/reload.py` rebuilds an
`Evidence`-shaped object out of an `--evidence-dump` bundle — track, bounces
with their on-table flag, crossings, accepted serves, the dense mask — and
then calls the *shipped* `serve_points`, `fallback_points`, `veto`,
`merge_continuous`, `resolve`, `split_long` and `on_own_table` over it. No
rule is restated anywhere in these scripts. Bundles came from
`research/crossings/` and `research/endon/` in R2 (52 of them, 9 of the 10
corpus matches; dd66043d has none).

### What the replay is worth, stated plainly

The replay reproduces **765 of 901 production cards exactly** and 803 within
half a second. The 15% that differ split into three known causes, and it
matters which match you are reading:

- **Four matches were processed before the 0.45 m serve pad shipped**
  (2026-08-28): 77fc4dee, b7a01f05, bfc9b31b, 9ef09000. Their `match.json`
  notes carry no `surface pad` line. The replay runs today's constants, so
  for these it says what the shipped code *would* do, not what shipped.
  9ef09000 agrees on only 41 of 67 cards.
- **d15aad4d and 98a9c15c** are on today's config but still drift —
  d15aad4d because production applied a `rescued 1 vetoed span` step that
  lives in `points_pipeline`, not in `points_v2`, and 98a9c15c because its
  table came from vision, which is not reproducible between runs, so the
  re-run projected onto a slightly different quad.
- **A reload artefact.** The dump rounds crossings to two decimals, and
  `rally_end_ev` breaks on `t - last > CROSS_GAP_S` exactly. A gap that was
  3.001 s in production is 3.00 s in the bundle and no longer breaks, which
  lengthens one card's tail by a couple of seconds and can cascade into the
  next serve being skipped or not. This accounts for the one- and two-card
  count differences.

**5a6d1a61, 89b35ee0, fa96cd0e and 44c85a9b reproduce production
card-for-card** (bundle against `match.json`: 72/72, 128/128, 66/66, 99/99).
All four hand-split cards and both theme-tagged "two points in one" cards
live in those matches, so the mechanism findings rest on the matches where
the replay and production are the same thing.

## Which stage fuses them

Six cards are independently known to hold two points: the four the owner
split by hand, and the two he tagged `two points in one` while reviewing.
`scripts/twochains.py` replays each one stage by stage.

| card | length | serve | fused by |
| --- | --- | --- | --- |
| 89b35ee0 37.67–51.60 | 13.9 s | 39.29 | serve card, crossing chain |
| fa96cd0e 400.00–415.42 | 15.4 s | none | fallback merge |
| fa96cd0e 822.19–846.48 | 24.3 s | none | fallback merge, then the cap |
| 5a6d1a61 160.84–189.17 | 28.3 s | none | fallback merge, then the cap |
| 44c85a9b 272.47–293.69 | 21.2 s | none | fallback merge, then the cap |
| 44c85a9b 303.97–322.19 | 18.2 s | none | fallback merge, then the cap |

**One of six is the reviewed mechanism, and it is a textbook instance.**
89b35ee0's card is a serve card opened on 39.29. Its crossings run 38.50,
41.73, 44.33, 46.67, 49.40 — every gap under `CROSS_GAP_S = 3.0`, so
`rally_end_ev` followed the chain straight through the point boundary. The
next serve *was* detected, at 45.42, and `serve_points` skipped it because
it fell inside the previous card's evidence window. The card is 13.9 s, so
`split_long` never looked. The owner split it at 44.93, 0.49 s before the
serve the assembler had already found and thrown away.

**Five of six are `fallback_points`, and `rally_end_ev` never ran on them.**
These cards carry no serve at all, so their extent comes from merging
`ball_dense` runs up to `FALLBACK_MERGE_S = 3.5 s` apart, capped only by
`MAX_FALLBACK_S = 30`. Dense motion does not stop when a rally does — the
retrieval, the walk back and the next server bouncing the ball all register
— so a fallback card swallows holes no rally could contain. The crossings
inside these five show the holes plainly: **7.34, 7.40, 7.90 and 12.01
seconds**, against a rally rule that breaks at 3.

`split_long` then does fire on four of the five, because the merge exceeded
20 s. It does not help. It cuts at the quietest moment of the middle half,
which is not the boundary: 44c85a9b's 262.50–322.20 merge was cut into two
halves and the owner tagged **both halves** `two points in one` afterwards.

### The same signatures, counted over the whole corpus

`two_chains` in `two-chain-cards.json` is the conservative reading of a
fused card: an internal crossing gap longer than `CROSS_GAP_S`, with at
least two crossings and one own-table bounce on both sides, so both halves
look like play rather than noise.

Replayed over the nine corpus matches that have a bundle (dd66043d has
none), so 899 cards against production's 1,025 over all ten.

| | count |
| --- | --- |
| final cards replayed | 899 |
| of them, fallback cards (`no serve seen`) | 269 |
| two-chain cards | 14 |
| — from a fallback merge | 11 |
| — from a serve card | 3 |
| — over 20 s before the cap cut them | 9 |
| of the 14, confirmed fused by the owner | 3 |

Three of the four hand-split cards are in the fourteen. The fourth
(89b35ee0) cannot be, by construction: a serve card can only fuse two points
if the crossings run *continuously* across the boundary, so its largest
internal gap is under 3 s and this signature cannot see it. The two
detectors are complementary, not redundant, and neither covers the other's
case.

For the serve-card family the only available signature is a **swallowed
serve**: a serve in `E.serves` that `serve_points` opened no card on, which
is derived from the shipped function's own output rather than from a copy of
its skip test.

- 65 swallowed serves out of 692 accepted, over 9 matches. (The band table
  below says 691: re-deriving the motifs from the dump's own two-decimal
  bounce times loses exactly one serve on d15aad4d, same rounding artefact
  as above.)
- **All 65 sit on cards of 20 s or less.** `split_long` never sees this
  family — zero exceptions on the corpus.
- 65 is a loose upper bound, and the arithmetic proves it: 98a9c15c accepts
  94 serves and the owner scored 74 points; bfc9b31b accepts 92 and he
  scored 76. At least 20 and 16 of those accepted serves are false, which is
  the caveat the earlier refusal census already carried — whether an
  accepted pair was really the serve is unverified.
- Filtering to serves with at least `MIN_DEAD_S` (1.2 s) of crossing silence
  before them leaves 22. **Do not use that filter.** It misses the one
  confirmed case: 89b35ee0's swallowed serve at 45.42 has 1.09 s of silence
  before it, just under the threshold. A discriminator that fails on the
  only case with an answer is not a discriminator.

## Q3: the tolerance mismatch — real, and it costs nothing

Two places ask "is this bounce on the table" with different numbers:
`PAIR_SURFACE_PAD_M = 0.45` for serve detection (`points_v2.py:82`) and
`0.15` hardcoded in `Evidence.bt_table` (`points_v2.py:539`), which is what
`on_own_table` reads. They agreed until 2026-08-28; one was widened and the
other was not. `on_own_table` runs last, after `resolve` has settled
overlaps, so in principle a card anchored on a serve the wide pad rescued
can trim its neighbour's tail and only then be deleted. `scripts/band.py`
measured it. Nobody had.

| | count |
| --- | --- |
| bounces projected onto the table | 6,132 |
| inside 0.15 m | 4,969 |
| inside 0.45 m | 5,516 |
| **in the band — outside 0.15, inside 0.45** | **547 (9%)** |
| accepted serves | 691 |
| **serves depending on the band** (a bounce of the pair fails at 0.15) | **400 (58%)** |
| cards anchored on such a serve with no other bounce inside 0.15 | **0** |
| serve cards dropped by `on_own_table` | **0** |
| dropped cards that had trimmed a neighbour | **0 of 145** |

The band is genuinely populated and genuinely load-bearing — 58% of accepted
serves would not survive at 0.15, which is the 2026-08-28 widening earning
its keep. And it still cannot cost a card, for a structural reason rather
than a lucky one: **`MIN_TABLE_BOUNCES = 1`.** A card needs one bounce inside
0.15 m across its whole span, and a rally supplies many well inside the
lines even when the serve's own two are in the band.

The "trim then die" scenario is impossible in the current code, not merely
unobserved. The only branch of `resolve` that shortens a predecessor
requires the *later* card to carry a serve, and no serve card is ever
dropped by `on_own_table` — all 145 drops on the corpus had `serve_s = None`.
Leave both constants alone.

## Q2: which rule refused the serve

`worker/eval/serve_refusal_census.py` over the corpus bundles, at today's
0.45 / 2.5 settings. Full per-card detail in `refusal-census.json`.

| gate | cards | share |
| --- | --- | --- |
| `pair_too_far_apart` | 79 | 29.2% |
| `same_side_of_net` | 63 | 23.2% |
| `travelled_backwards` | 61 | 22.5% |
| `rally_already_running` | 29 | 10.7% |
| `bounce_too_near_net` | 28 | 10.3% |
| `no_apex` | 9 | 3.3% |
| `bounce_off_surface` | 1 | 0.4% |
| `no_bounces_at_all` | 1 | 0.4% |

271 of 899 cards carry no serve. The ordering has moved since the last
census (which read `travelled_backwards` 49, `same_side_of_net` 45,
`pair_too_far_apart` 37): `pair_too_far_apart` now leads. Two caveats travel
with these numbers and neither has been discharged. The census reports the
gate that refused the pair which got **furthest** through the tests, and
whether that pair was the serve is unverified — only video settles it. And
**2 of the 271 had no usable bounce pair at all**, so on this corpus the
rule is nearly always refusing bounces it has rather than missing the ball.
That last figure is about the *rule*, and it is the opposite of what the
misses look like when you go and find them, which is the next section.

## The three theme-tagged cards, and what the theme actually means

`missing-first-bounce-on-server-side` has three cards. **None of the three is
a fused card, and two of them have a detected serve.**

| card | serve in `match.json` | placement's own verdict |
| --- | --- | --- |
| 6f7e3be6 Anton m3 #5, 38.18–42.69 | **38.54** | no hypotheses stored |
| dd66043d Lester crop test #15, 145.02–150.82 | **146.64** | `serve_first_bounce_on_receiver_half`, `serve_second_bounce_on_server_half` |
| 44c85a9b Young 2 #23, 303.97–322.19 | none | `serve_first_bounce_on_receiver_half`, `serve_second_bounce_on_server_half` |

Two of the three carry production's own `serve_first_bounce_on_receiver_half`
flag on the far hypothesis, alongside `serve_second_bounce_on_server_half`.
Those two reasons together say the detected pair's bounces are in the wrong
order — receiver's half first, server's half second. That is a serve whose
first bounce on the server's own half was never found, so the pair begins one
bounce late. **The theme is about the serve MARK starting late, not about a
card holding two points.** `two points in one` is a separate tag, and both of
its cards are Young 2 fallback cards.

Young 2 #23 is the one worth reading closely, because the owner's note on it
is the finding. Eighteen seconds of card, and the assembler has **one
crossing and one own-table bounce** in the whole of it. His note: "the only
bounce that was detected was the ball toss onto the table, and then all the
other bounces were just not detected. It was just like his fast smashes were
also not even detected." The replay agrees exactly. This is not the serve
rule refusing a pair. There was no pair.

And Young 2 routed **serve-anchored** in production, not end-on — worth
saying because the venue invites the opposite assumption.

## Where the missing points actually are

The three rallies the score says are missing localise to a game each, and
two of the three land where a signature already points.

- **77fc4dee game 3**, 6-10, 507.6–688.1 s. Its one two-chain card sits at
  635.00–652.20, inside that game.
- **fa96cd0e game 3**, 4-10, 761.7–908.4 s. Contains both a two-chain card
  (822.21–846.51, which he split) and an insert (773.51–790.24). One fault
  repaired, the game still a point short.
- **d15aad4d game 4**, 11-10, 917.5–1229.7 s. No two-chain card in it. It
  has a 20.55 s hole between two cards, at 1186.42–1206.97, and that hole is
  the answer: **0 crossings, 0 own-table bounces, one corridor bounce, and
  250 tracked frames across 27 seconds.** A rally was played there and the
  ball detector did not see it.

The hand inserts say the same thing. Fourteen of the fifteen abut their
neighbours exactly — they fill dead space between cards, which is what the
insert UI does; the fifteenth (5a6d1a61 at 34.18–65.96) is a 31.8 s window
drawn straight over an existing card and is counted separately. In the
windows where the replay is production's equal, what the assembler had there
was almost nothing: fa96cd0e's two inserts have 0 and 1 crossings and 0
own-table bounces; 5a6d1a61's have 1 and 0. Four of the inserts are on the
pre-0.45 matches and today's rule *does* accept a serve in those windows, so
the August widening has already recovered part of this category and the
older half of the corpus understates the current code.

By venue, on a corpus too small to carry the claim far:

| venue | matches | scored | fused cards | insert rows (scored) | missing per score |
| --- | --- | --- | --- | --- | --- |
| Westchester TTC | 4 | 261 | 4 | 5 (4) | 2 |
| Pingpod / PingPod W37 | 5 | 347 | 0 | 6 (6) | 1 |
| Aro | 1 | 24 | 0 | 4 (4) | 0 |

All four confirmed fusions are at Westchester, as are all six joins. That is
4 in 261 scored points against 0 in 347, which is suggestive and no more —
it is four events.

## Recommendation

**Do not go after the missing first bounce. Go after the ball track, and
label for recall rather than for identity.**

The case against chasing the bounce is three independent reads that agree:

1. The owner's scoring says 3 rallies are missing in 632 scored points.
   Fusion of any kind accounts for at most 4 more, all of which he caught.
2. His repairs run 14 inserts to 4 splits. The assembler builds no card
   three and a half times more often than it builds one card too few.
3. In every window where a point went missing and the evidence can be
   looked at, the ball was not tracked — d15aad4d's 20 s hole, Young 2 #23's
   18 s card with one bounce in it, fa96cd0e's two inserts.

And the theme that prompted the question is not about fusion at all: two of
its three cards have a detected serve and carry production's own "first
bounce on the receiver's half" flag. That is a serve-mark accuracy problem,
worth its own study, and it changes which dot placement draws rather than
whether a point exists.

**So: label bounces first — but not to resolve the 0.4 s serve-mark error.**
Label them to measure the ball detector's recall, which is the actual
bottleneck. `admin_event_labels` is the wrong shape for that as it stands:
it labels bounces the pipeline already found (table / paddle / net /
not-ball), and it cannot record a bounce that was never found. Measuring
recall needs a "there was a bounce here and you missed it" label.

The cheapest measurement that settles the most: **28 clips — the 14 insert
windows and the 14 two-chain cards, about seven minutes of video — with
every bounce the owner can see marked.** That yields detector recall inside
exactly the windows where points go missing, per venue, against the 6,132
bounces the pipeline found on this corpus. Two further things fall out of
the same 28 clips for free: how many of the 14 two-chain cards really hold
two points (3 are confirmed, 11 are unverified), and whether Westchester's
4-in-261 fusion rate against PingPod's 0-in-347 is a venue effect or noise.

**The ruler for judging any change to this area should be the owner's own
repair actions** — inserts and splits per hundred scored points — together
with `scoreGaps`' `missing` count. Both are already recorded on every match,
both need no new labelling, and neither has the ±0.7 s problem that killed
the 2026-08-28 investigation. A change that reduces inserts is worth
shipping; a change that only moves the swallowed-serve count is not, because
that count is dominated by false serve detections.

If one assembler change is ever wanted from this study, it is **not** a
constant in the serve rule. It is that `fallback_points` merges `ball_dense`
runs across gaps of 7 to 12 seconds that its own crossing rule would refuse
at 3, and `split_long` cutting the result at its quietest midpoint does not
find the boundary. That is where five of the six confirmed fused cards came
from. It was not measured further here and is not proposed — it needs the 28
clips first, for the same reason everything else in this area does.

## What was measured dead, again

- **The 0.15 / 0.45 tolerance mismatch.** 0 cards, and structurally 0.
- **`split_long` as the guard against fusion in serve cards.** All 65
  swallowed serves are on cards of 20 s or less; the cap cannot reach them.
- **`MIN_DEAD_S` as a "was the ball dead before this serve" test.** Fails on
  the one confirmed case at 1.09 s against a 1.2 s threshold.

## Files

| file | what it holds |
| --- | --- |
| `scripts/reload.py` | bundle → `Evidence`-shaped object; the shipped stages are called over it |
| `scripts/measure.py` | swallowed serves, cap products, `on_own_table` drops, uncarded bursts |
| `scripts/analyse.py` | the same with the dead-ball filter and a resolve-aware neighbour-trim test |
| `scripts/twochains.py` | cards holding two rally chains, and which stage built them |
| `scripts/band.py` | the 0.15 / 0.45 band population and what depends on it |
| `scripts/repairs.py` | split / join / insert classification against `match.json` |
| `scripts/gaps.mjs` | `scoreMatch` over the corpus; run with `node --experimental-strip-types` |
| `replay.json` | per-match swallowed serves, drops, band rows, cap products |
| `two-chain-cards.json` | every final card with its internal crossing structure |
| `refusal-census.json` | per-card refusal gate for the 271 cards with no serve |
| `score-gaps.json` | per-game scoring, suspect and overrun games, long gaps |
