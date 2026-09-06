# Can the sound tell us a bounce happened?

2026-08-28. **Verdict: do not ship.** Wired up as written it draws
15 fewer serves on the corpus. The branch this experiment was about
moves nothing at all. Production is unchanged.

Re-run afterwards at the frequency band the published work uses, which is
15 points better at hearing a bounce: **the verdict did not move.** The
damage shrinks from −15 to −6, the rescue branch still gains nothing, and
not one recovered serve comes from the failure it was aimed at.

An inspection page carrying every reading, with a hundred points from the
most recent uploads and their audio, is at
`~/Desktop/ponglens-audio-study.html`.

`placement_reconstruction.py` has taken an `audio_impacts` argument since
the day it was written, and `points_pipeline.py` has passed `[]` on every
run. Two mechanisms inside it have therefore never fired once in
production:

- **the blend** — every visual event is matched to the nearest impact
  within a tolerance and given an `audio_confidence`, which enters its
  score as 0.72 visual + 0.28 audio;
- **the rescue** (`audio_supported_short_bounce`) — a bounce that FAILS the
  full visual test is admitted anyway if its immediate rise and fall are at
  least 3 px each and an impact sits within the tolerance, borrowing a
  neighbouring frame's table projection when its own frame has none.

The second is the interesting one. The largest single reason a serve draws
no dot is `no_landing` at 15% — we know a serve happened and not where it
finished — and the rescue branch was written for exactly that.

Audio is not asked to locate anything. The 2026-08-13 serve study measured
that dead: an audio-strike-after-silence rule found serves at 99.1% recall
with a **1.045 s** median timing error. Sound says *something struck*; it
does not say when a rally began.

## The ruler

Adil's own scoring, through the app's own code. `computeServing` gives the
ITTF rotation the scorekeeper UI runs; `diagnoseServePlacement` applies the
six serve rules, the end-swap between games and the 0.7 trust threshold.
Both are imported, never restated.

Corpus: the seven matches from CLAUDE.md's vouched list that carry v3
placement and a table Adil has looked at. **527 scored points** — the
arithmetic that identifies them, since no other combination of the vouched
list sums to it.

### Baseline, reproduced before anything was changed

| match | scored | drawn | | no landing | wrong half | 1st bounce wrong half | off table | not consecutive | no serve shot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lester | 104 | 66 | 63% | 10 | 14 | 2 | 6 | 5 | 1 |
| rowel | 80 | 55 | 69% | 8 | 8 | 3 | 2 | 2 | 2 |
| prabhas | 55 | 33 | 60% | 14 | 3 | 0 | 2 | 1 | 2 |
| ishan | 79 | 37 | 47% | 29 | 3 | 3 | 3 | 4 | 0 |
| ali | 44 | 24 | 55% | 3 | 6 | 3 | 4 | 1 | 3 |
| chris | 90 | 73 | 81% | 2 | 7 | 0 | 6 | 1 | 0 |
| julian | 75 | 40 | 53% | 11 | 9 | 5 | 5 | 1 | 4 |
| **TOTAL** | **527** | **328** | **62%** | 77 | 50 | 16 | 28 | 15 | 12 |

62% overall, 47% on Ishan, 81% on Chris, and the shares 14.6 / 9.5 / 3.0 /
5.3 / 2.8 / 2.3% — every figure CLAUDE.md records. `baseline.ts`.

## The detector

`audio_impacts.py`. Onset strength, and nothing cleverer:

1. mono 48 kHz, STFT at a 21 ms window and 5.3 ms hop;
2. spectral flux — energy that ROSE since the last frame — summed over
   1.5–8 kHz, where a celluloid ball on a table lives. Rise rather than
   level, because a hall's continuous roar has no edges;
3. `log1p` before differencing, so one loud strike does not set the scale
   for the file;
4. a robust z-score against the running median and MAD of a ±0.75 s
   neighbourhood. This is the part that matters: a global threshold asks a
   quiet club and a tournament hall the same question and only one of them
   can answer;
5. peaks at least 25 ms apart, above z = 3.

`confidence` is that z-score. It is not a probability, and the consumer was
built for a number like it: `_candidate_evidence` maps it through
1 − exp(−c/2), and the standalone-impact rule compares it against 2.5.

## It hears what vision already saw

Judged against production's own stored bounce candidates — found by the
visual test alone, since audio has always been empty, so the detector was
not tuned on them.

Every "by chance" row is the same measurement with the whole impact list
slid 7.31 s along the clock. With two to four impacts a second, a wide
window catches something by accident, and a hit rate quoted without its
null reads as accuracy when much of it is arithmetic.

| match | impacts | offset | MAD | ±30 ms | chance | ±50 ms | chance | ±90 ms | chance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lester | 3635 | +9 ms | 11 ms | 78% | 15% | 84% | 23% | 88% | 36% |
| rowel | 2477 | +13 ms | 12 ms | 75% | 15% | 89% | 25% | 92% | 44% |
| prabhas | 2739 | +5 ms | 18 ms | 58% | 19% | 67% | 29% | 76% | 48% |
| ishan | 3933 | +7 ms | 19 ms | 56% | 21% | 66% | 32% | 74% | 52% |
| ali | 2128 | +5 ms | 10 ms | 82% | 16% | 88% | 24% | 92% | 40% |
| chris | 3985 | +5 ms | 11 ms | 78% | 16% | 81% | 25% | 87% | 43% |
| julian | 2928 | +8 ms | 13 ms | 72% | 19% | 80% | 27% | 84% | 43% |

Two things follow.

**The clocks agree.** The offset is +5 to +13 ms on all seven, which is
inside one video frame at 30 fps. There is no sync error to correct and no
per-match fudge to apply.

**0.09 s is about twice as wide as it should be.** It was never tuned
against real impacts because none were ever supplied. At ±90 ms more than
a third of the matches are coincidence; at ±30 ms the hit rate is still
56–82% against a 15–21% null. A threshold sweep on Lester puts the best
separation at z ≥ 3 with a ±30 ms window (78% against 15%); loosening to
z ≥ 2 buys 9 points of recall and 19 of chance.

**Ishan and Prabhas are the hard pair**, at 56–58% where the others reach
72–82%. Ishan is also the match with the worst placement coverage (47%).
Whatever is difficult about it is difficult in both sensors.

## Adil's two intuitions

**"In a large hall the loudest ball strike should still be the table
nearest the camera."** True, on every match measured. Impacts landing on
one of this table's own events run at median z 7.1–8.9 against 4.3–4.6 for
everything else — the near table really is about twice as loud as the room
around it. Loudness is a usable filter.

**"Players often stomp on the serve, which may be a separate and coarser
cue."** Not found. In its own 40–250 Hz band the low end fires 3.5 times a
second at z ≥ 3, and 80–92% of serves have a peak within 0.25 s against a
**80–81% chance rate** — no separation. Raising the threshold empties the
band rather than sharpening it: at z ≥ 5 Lester keeps 304 peaks and 12% sit
near a serve against 10% by chance. A foot on the floor does not reach
these microphones as anything that stands out.

## The biggest bucket is not what its name says

Before the audio arms, one query changed the target. Of the **77 scored
points refused for `no_landing`** across the corpus, taking the hypothesis
the scored rotation actually selects:

| | points |
| --- | --- |
| serve shot with no landing event at all | **0** |
| landing event found, with real pixel coordinates, that projects **off the table** | **77** |

Every single one. `no_landing` does not mean "we never saw the ball come
down". It means "the thing we called the landing is not on this table".

And it is not near-misses at the edge. Projecting those 77 landings without
the safety bounds, on a table that runs 0 to 1.525 m across and 0 to 2.74 m
long:

| | p5 | p25 | median | p75 | p95 |
| --- | --- | --- | --- | --- | --- |
| u (across) | −4.02 | −3.01 | **−1.20** | 0.21 | 2.55 |
| v (along) | −0.86 | 0.12 | 0.62 | 2.10 | 4.88 |

Only 14 of 77 land within half a metre of the box. Per match, two of them
cluster tightly and both are LYTTC:

| match | n | median u | u, p25 to p75 |
| --- | --- | --- | --- |
| ishan | 29 | −2.73 | −3.21 to −2.24 |
| prabhas | 14 | −3.40 | −3.89 to −1.82 |
| julian | 11 | −1.18 | −1.19 to 0.12 |
| lester | 10 | −0.15 | −0.86 to 1.76 |
| rowel | 8 | 1.53 | 0.62 to 2.11 |
| ali | 3 | 2.64 | 1.69 to 3.60 |
| chris | 2 | −0.20 | −0.21 to −0.18 |

43 of the 77 sit two table-widths to the left of our table, in one venue.
That is the ball track being captured by the next table along — the same
defect the table-aware reseed study measured from the other end and found
the candidate cloud could not fix.

**This is why the rescue branch cannot reach the target it was written
for.** `audio_supported_short_bounce` admits a bounce whose visual PEAK
test was marginal. These peaks were not marginal; they passed. What
refused them was the PROJECTION. Audio says a strike happened. It says
nothing about which table it happened on, and a ball bouncing on the next
table makes a real sound at a real moment — so audio confirms these
events rather than doubting them.

## How it was measured

`replay.py` rebuilds every point's placement through
`reconstruct_existing_match`, imported from `worker/placement_backfill.py`
— the production function the placement backfill and the retry both run,
and it has taken an `audio_impacts` argument since it was written. So the
harness supplies an argument and changes no rule. The inputs are
production's own: match.json's stored calibration, which is the quad that
drew the maps now in the database, and the point windows from the points
table. Only the ball track is re-derived.

**Step one, before any audio: the replay with `audio_impacts=[]` must
reproduce what the database holds.** If it does not, every later number is
measuring the harness.

Two module flags were added to `placement_reconstruction.py` so the three
audio mechanisms could be measured apart, both defaulting to exactly what
the module has always done. Byte-identical output against the committed
version was checked on an empty impact list and a populated one before
anything else ran.

## What the audio does to the map

Nine arms, one ruler, 527 scored points. The first row is the honesty
check: the replay with an empty impact list must equal the database, and
it does, on all seven matches.

| arm | drawn | | gained | lost | net |
| --- | --- | --- | --- | --- | --- |
| database today | 328 | 62% | — | — | — |
| replay, `audio_impacts=[]` | **328** | **62%** | **0** | **0** | **0** |
| audio wired up as written (0.09 / 0.09) | 313 | 59% | 8 | 23 | **−15** |
| audio, tuned tolerances (0.05 / 0.03) | 311 | 59% | 5 | 22 | **−17** |
| audio, z ≥ 5, tuned | 322 | 61% | 6 | 12 | −6 |
| rescue branch alone, 0.09 | 328 | 62% | 1 | 1 | 0 |
| rescue branch alone, 0.03 | 328 | 62% | 0 | 0 | 0 |
| rescue branch alone, z ≥ 5 | 328 | 62% | 0 | 0 | 0 |
| blend restricted to events with table coordinates, 0.09 | 332 | 63% | 7 | 3 | +4 |
| the same, tuned | 331 | 63% | 5 | 2 | +3 |

Per match, for the arm that matters and the one that helps:

| match | scored | today | as written | on-table blend |
| --- | --- | --- | --- | --- |
| lester | 104 | 66 | 63 (−3) | 68 (+2) |
| rowel | 80 | 55 | 55 | 56 (+1) |
| prabhas | 55 | 33 | 32 (−1) | 34 (+1) |
| ishan | 79 | 37 | 34 (−3) | 36 (−1) |
| ali | 44 | 24 | 24 | 25 (+1) |
| chris | 90 | 73 | 69 (−4) | 73 |
| julian | 75 | 40 | 36 (−4) | 40 |

### Three results, in order of how much they matter

**1. Wiring it up as written makes the maps worse.** 62% to 59%, and the
losses outrun the gains three to one. The cause is the standalone-impact
branch. A z-score never falls below the `confidence < 2.5` guard, so every
impact with no visual event within 0.12 s becomes a candidate: **3,500
impact candidates added to a list of 2,277** on three matches alone. The
solver then has a much larger menu, and 15 points that used to draw a dot
end up refused for `no_landing`.

**2. The branch this experiment was about does nothing.** Isolated from
the other two mechanisms, `audio_supported_short_bounce` fires 5 to 13
times per match and moves **zero serves on 527 points** at every setting
but one, where it gains one and loses one. It is narrow by construction:
it admits a peak whose ±2-frame window was ambiguous but whose ±1-frame
window was not. The serves that draw no dot did not fail that test.

**3. Not one gained serve, on any arm, came from `no_landing`.** Every
gain came from `not_consecutive` (5 or 6), with single points from
`wrong_half` and `no_serve_shot`. The 15% bucket audio was aimed at did
not move once in nine arms.

### The one thing that helps, and why it is not enough

Stopping the blend from raising events with no table coordinates — a
one-line rule, and the direct answer to what the first arms measured —
turns −15 into +4. That is **0.8 percentage points of coverage**, 62% to
63%, and it still costs three serves that draw today.

It is not worth a pipeline stage. Shipping it means extracting audio on
every upload, running a detector, threading impacts through
`points_pipeline`, changing the confidence blend and gating all of it. And
the serve-placement spec's own gate — look at the landings a rule newly
admits, against the video — has not been met for those seven points.

## What audio IS good at here, and why it is out of scope

The one measurement where sound clearly separates the two populations is
the wrong way round. Taking the serve landing production chose, and asking
whether any impact sits within 50 ms of it:

| | landings that draw | landings that project off the table |
| --- | --- | --- |
| median z of the nearest impact | 6.4 | 3.5 |
| **no impact at all** | **10%** | **42%** |

A landing that is not on this table is four times as likely to be silent.
That is real, and it is a **veto** — it would remove an event rather than
add one, which the brief for this experiment rules out, and it does not
draw a dot by itself. Worth writing down; not worth building today.

## Two things measured afterwards that explain the rest

### The band was wrong, and fixing it changed nothing that matters

The Sony AI bounce pipeline (arXiv 2409.11760) high-passes at **10 kHz**
before looking for peaks; this study's detector used 1.5–8 kHz. Compared
at matched impact density — each band's threshold raised until it emits
the same number of peaks, so the chance rate is held equal:

| match | impacts | 1.5–8 kHz | chance | 10 kHz+ | chance |
| --- | --- | --- | --- | --- | --- |
| lester | 3635 | 78% | 15% | 89% | 15% |
| rowel | 2477 | 75% | 15% | 86% | 15% |
| prabhas | 2739 | 58% | 19% | 86% | 18% |
| ishan | 3933 | 56% | 21% | 84% | 22% |
| ali | 2128 | 82% | 16% | 89% | 16% |
| chris | 3985 | 78% | 16% | 93% | 18% |
| julian | 2928 | 72% | 19% | 82% | 20% |
| **weighted** | | **72%** | **17%** | **87%** | **18%** |

A hall's voices, shoes and rolling balls live below 10 kHz; a celluloid
ball's strike does not. So every arm was re-run at the better band:

| arm | 1.5–8 kHz | 10 kHz+ |
| --- | --- | --- |
| wired up as written | −15 | **−6** |
| tuned tolerances | −17 | −7 |
| rescue branch alone | 0 | **−1** |
| blend limited to on-table events | +3 | +4 |

The damage more than halves, which is what a better detector should do. The
**rescue branch still moves nothing**, the best arm is still about one
point of coverage, and across all fifteen settings in both bands **not one
gained serve came from `no_landing`**.

### Between points, the room is nearly as loud as during them

`public.point_boundaries` holds Adil's own serve and winner taps for 373
points across 12 matches. They are 90% accurate to 0.71 s so they cannot
time anything, but they mark exactly when the ball is in play. Impacts per
second, inside those windows and in the gaps between them:

| match | points | in play | gaps | 1.5–8k play/gap | ratio | 10k+ play/gap | ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ishan | 71 | 294 s | 639 s | 4.08 / 3.50 | 1.2× | 4.88 / 4.01 | 1.2× |
| rowel | 75 | 356 s | 446 s | 3.33 / 2.14 | 1.6× | 3.14 / 2.06 | 1.5× |
| prabhas | 50 | 193 s | 470 s | 4.14 / 3.42 | 1.2× | 4.69 / 3.53 | 1.3× |

**This is the number that explains every other number in this document.**
With nobody at this table serving and nobody rallying, the detector still
fires two to four times a second. The better band improves the timing and
leaves the ratio alone: it is a better ball-strike detector, and it detects
everyone's ball strikes.

### Is there direction information in the file? Almost never, and then not usably

The only measure the literature reports as separating your own court from
the next one along is a **directional microphone** (US5908361). A phone has
two omnidirectional capsules a few centimetres apart. Two problems:

- **Eight of the ten most recent uploads are mono at source**, and all
  seven study matches are mono. There is no second channel.
- On the two stereo uploads, cross-correlating a 10 ms window around each
  impact gives a channel delay with a MAD of 225 and 414 µs, against a
  maximum possible delay of about 437 µs for a 15 cm baseline. Only 6% and
  9% of impacts sit within 30 µs of the median. That is noise, not
  direction.

## What the published work says

- **Sound-Based Spin Estimation in Table Tennis** (2024, Sony AI funded) —
  the closest work to this study. Butterworth high-pass at 10 kHz, energy
  peaks against a decaying average, then a six-layer CNN on 15 ms Mel
  spectrograms. Onset accuracy 0.09 ms clean, 0.2 ms with speech; detection
  0.98 precision / 1.00 recall; **surface classification (racket / table /
  floor) at 0.97 F1**. Recorded with a directional mic at 50 cm–2 m, and
  the paper does not test multiple tables or venue acoustics.
  [arXiv:2409.11760](https://arxiv.org/abs/2409.11760); dataset at
  [cogsys-tuebingen/tt_sounds](https://github.com/cogsys-tuebingen/tt_sounds),
  3,396 samples, **CC BY-NC 4.0 — not usable in a commercial product**.
- **Ball Hit Detection in Table Tennis Games Based on Audio Analysis** —
  Zhang, Xiao, Dellandréa, Dou, Chen, ICPR 2006. Energy Peak Detection plus
  MFCC refinement: **91% precision, 73% recall**. The closest prior art to
  the detector built here.
- **TTNet / OpenTTGames** — Voeikov et al., CVPRW 2020. 97.0% event
  spotting, 2 px ball RMSE. Notable for using **no audio at all**: the
  leading video system for this sport does not need a microphone.
  [arXiv:2004.09927](https://arxiv.org/abs/2004.09927)
- **Detection of Tennis Events from Acoustic Data** — Baughman et al.
  (IBM), MMSports 2019. CNN on MFCC-delta-acceleration, 92.5% precision /
  92.4% recall, but 20 ms frames put a floor under onset accuracy — the
  same detector/locator trade this study measured.
- **US5908361** (automated tennis line calling) states the remedy for
  adjacent courts outright: raise the microphone's **directivity**. A
  capture-side fix, not a signal-processing one.
- **Snickometer / UltraEdge** is the mature commercial version of the idea:
  audio confirming a contact the picture is already looking at — with a
  microphone *at the stumps*, not five metres away on a tripod.
- **Sound event localisation** (DCASE SELD) is unanimous that placing a
  sound needs a microphone array. A bounce on the next table and a bounce
  on ours are the same event class.

### What the literature would have us try next, in order

1. **Surface classification** (racket / table / floor), 0.97 F1 in the lab.
   It sharpens bounce-versus-contact, which is where every gain in this
   study came from. It cannot say *which* table, so it cannot touch the
   15%. The public dataset is non-commercial; we would need our own labels.
2. **Inter-hit rhythm priors** (AVSP 2011). Free, untried, and aimed
   squarely at a detector firing 2–4 times a second between points.
3. **A directional microphone** — a change to how matches are filmed.

## Recommendation

**Do not ship any of it.** Leave `audio_impacts=[]` in
`points_pipeline.py`. The verdict survived a detector 15 points better at
its job, which is the strongest thing that can be said for it. Production was reverted and is unchanged; the two
mechanisms that hurt stay dormant, as they have been all along, and
nothing about the clips or the maps changes.

If the 15% is ever worth attacking again, the target is the ball track
being captured by the next table along — 43 of 77 in one venue — and the
information needed is not in the audio, which confirms the neighbouring
table's bounce exactly as readily as our own.

## Reproducing

    ./venv/bin/python .../dump_corpus.py <corpus-dir>          # DB, read-only
    ./venv/bin/python .../fetch_inputs.py <corpus-dir> <work>  # R2 + blurball
    ./venv/bin/python .../replay.py <corpus-dir> <work> <out>  # all arms
    ./run.sh baseline.ts <corpus-dir>                          # the 62%
    ./run.sh compare.ts <corpus-dir> - <out>/none  "honesty"
    ./run.sh compare.ts <corpus-dir> <out>/none <out>/<arm> "<arm>"

`replay.py` needs a scaffold in `placement_reconstruction.py` that this
study reverted; its docstring records the five names and the four edits,
and how to prove they change nothing at their defaults.

Nothing here writes to `jobs`, `matches` or `points`. No match was
reprocessed, no notification can fire, and the videos were re-downloaded
to a scratch directory rather than touched in place.
