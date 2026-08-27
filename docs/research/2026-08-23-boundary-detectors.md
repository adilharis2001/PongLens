# Can anything find a point boundary? — 2026-08-23

Three new detectors built and measured against a complete hand-marked
truth. The short answer is no, and the reason is worth keeping.

**Corpus.** One match, `d4593f8a`, hand-marked end to end: 79 points, 158
boundaries, in source seconds, stored in `fullmatch_labels`. 7.1 minutes of
real play inside a 17.0 minute file. It is the first non-Westchester match
with a complete truth, and everything below is scored against it.

Reviewed on `/research/endon`.

---

## The structural finding, which outranks the detectors

**72% of the shipped pipeline's card boundaries are manufactured.**

```
new pipeline   88 cards, 87 gaps   63 sit exactly on the 1.2s floor (72%)
production     71 cards, 70 gaps    0 at the floor; all real dead time
```

`MIN_DEAD_S = 1.2` in `points_v2.py` exists so consecutive cards do not show
overlapping video once the 0.3 + 0.4 clip pads are added. That is a correct
constraint *between* points. But `resolve()` applies it to any two cards
closer than the floor, including two that sit inside one rally, and what
gives is live play: the earlier card's tail retreats or the later card's
head is pushed, and 1.2 seconds of the point is deleted.

So the 88 cards were never 88 detected points. They are about **25 blocks
of continuous play, diced at 1.2s intervals.** Merging every floor-width gap
proves it:

```
                     cards  complete  straddle  fused  missing
as shipped              88     49/79        13     38    25.3s
floor gaps merged       25     73/79         2     73     6.3s
```

Straddles nearly vanish and missing play drops by three quarters — but the
card count collapses, because the pieces were never separate points. This
is not a fix to apply on its own. It is a diagnosis: **the assembler is not
choosing boundaries, the resolver is.**

## Occlusion is not the blocker here

The premise we started from was that the near player's body hides the ball
during their own serve. On this match it does not:

```
ball-track coverage around the serve (-1.2s..+0.4s)   median 76.1%
                          mid-rally                   median 79.4%
                          dead time                   median 67.1%
points with essentially no ball tracked at the serve      0 / 79
```

Serve-side detection is also close to even overall (56% near / 44% far
across 11 matches, where the rules put the truth at 50/50). There is a lean
in failing matches — 59% near when detection is healthy, 46% when it is not
— but it is a 13-point effect, not a blackout. **Where serve detection
fails, it fails on both sides at once.**

## The three detectors

Built in `boundary_lab.py`; artefacts under `~/ponglens-research-work/lab/`.

- **Audio.** 10 kHz high-pass Butterworth, six-sigma dynamic threshold on a
  3s rolling baseline. 1904 impacts. The earlier audio work (2026-08-11)
  used generic onsets and closed at 4.6%, but for a different question:
  classifying whether a window is a rally. This asks where a point starts.
- **Toss.** Local vertical excursions in the existing ball track: apex with
  rise and fall either side and small horizontal travel. Hand-picking the
  window scored 6%, because a real toss here lasts ~0.4s and the first
  attempt demanded near-vertical motion across 1.1s. Swept 72 parameter
  sets instead.
- **Pose.** RTMPose at 6 fps, wrist above shoulder. Full skeletons were
  deferred in the 2026-08-18 study and never actually tried; this is the
  first look.

## How well each marks a real point start

Within 1.0s of one of his 79 marks.

| signal | events | finds a start | and is one |
| --- | --- | --- | --- |
| **audio, first impact after 0.8s quiet** | 348 | **78%** | 21% |
| toss (best of 72 parameter sets) | 211 | 47% | 20% |
| serve detector (what we ship) | 69 | 29% | 33% |
| pose, arm up | 63 | 24% | 32% |

**Audio is the best boundary signal we have ever measured**, and it beats
the detector the whole pipeline is built on by a factor of nearly three on
recall. That is the one positive result here.

But 21% precision means it fires four to five times per real start.

## Combination does not rescue it

Union raises recall and wrecks precision, which is arithmetic. Agreement is
the interesting direction, and the detectors are near-independent — audio
hears the impact, the toss sees the ball, pose watches the body — so
agreement should be much cleaner than either alone. It is cleaner, and it
is still not enough:

| rule | events | recall | precision |
| --- | --- | --- | --- |
| any two of the four agree | 196 | 58% | 30% |
| any three agree | 46 | 27% | 52% |
| toss and pose agree | 29 | 16% | 48% |

Audio-triggered with geometry disposing — let audio propose and require the
ball to then cross the net, or bounce twice on the table, as a serve must —
is the most promising shape and also fails:

| rule | events | recall | precision |
| --- | --- | --- | --- |
| audio + ≥2 on-table bounces within 2s | 138 | 48% | 30% |
| audio + a net crossing 0.25–2.0s later | 193 | 54% | 25% |
| audio + crossing AND ≥2 bounces | 103 | 34% | 29% |

Every geometric filter trades recall away without buying precision, because
crossings and bounces follow *every* stroke, not just a serve. The geometry
cannot tell a serve from a third-ball attack.

## Why this keeps happening

Cutting 79 points needs high recall *and* high precision. The best on offer
is 78/21 or 58/30. Nothing is close.

The reason is the same one the oracle study found and this now confirms
from a second direction: **every signal we can compute fires during a
rally.** Bounces, crossings, prism exits, motion and racket impacts all
recur throughout a point, which is why they are 3× to 11× denser than the
boundaries. The toss was the one candidate that is unique to a start by
rule, and at 47% recall the tracker simply does not see enough of it.

What no detector here has is *context*: an impact is a serve because of
what came before it (a pause, a score called, the players resetting) and
what follows (exactly one crossing, then a rally). Every rule above looks
at a fixed window and asks a fixed question.

## What to do next

1. **Do not ship the floor-gap fix alone.** It turns 13 straddles into 2 and
   recovers 13.2s of play, but collapses 88 cards to 25. It is only correct
   alongside something that can re-cut the blocks.
2. **Add audio as a candidate generator.** 78% recall at essentially no cost
   (one ffmpeg pass and a Butterworth filter) is strictly better than the
   29% the assembler currently starts from. It does not solve selection, but
   nothing downstream can select a boundary that was never proposed.
3. **The selection step wants a learned discriminator, not another rule.**
   The well-posed version: given a 2s window around an audio impact, is this
   a serve or a rally stroke? That is a small binary classifier over
   spectral shape plus context, and there are now 79 labelled positives on
   this match and 278 more on Koko, Terry and Tripp.
4. **Mark a second match before trusting any of this.** Every number here
   is one match and one venue.

## Files

- `docs/research/2026-08-23-boundary-detectors.md` — this note
- `~/ponglens-research-work/lab/boundary_lab.py` — the three detectors
- `~/ponglens-research-work/lab/sweep.py` — assembler combination sweep
- `~/ponglens-research-work/lab/{audio,toss,pose,scores}.json` — artefacts
- `fullmatch_labels`, `match_key = d4593f8a-…` — the truth

---

# Part 2: four matches, held out — 2026-08-23 (later)

The four steps proposed at the end of Part 1, built and measured. Corpus is
now every match with hand marks: `d4593f8a` (79 points), koko (45), terry
(52), tripp_rc (102). **278 points, two venues.**

The measure throughout is the one that matters: **standalone cards** — one
card holds one point, start to finish, with no neighbour attached.

## Result

```
                                        standalone / 278
production today                             27    10%
motion envelope alone                        74    27%
held-out learned model                       70    25%
envelope + crossing gaps, single config     109    39%   (optimistic)
envelope + crossing gaps, config held out    94    34%   <- honest
```

**34% against production's 10%**, with the configuration chosen on three
matches and scored on the fourth it had never seen. Per match: d4593f8a
20/79, koko 18/45, terry 9/52, tripp_rc 47/102.

## The model works, and loses

Trained on three matches, tested on the fourth, never on itself. Held-out
starts 44–71% recall at 20–44% precision; ends 24–74% at 28–44%.

It beats production comfortably (70 vs 27) and it is the most even
performer across matches. It also **loses to a hand-written rule** (70 vs
94). That was not the expected outcome and it is worth stating plainly: on
this corpus, with these features, learning did not beat looking for a gap
in the crossing stream.

The likely reason is corpus size, not method. 278 points from two venues,
with the strongest match contributing 102, is thin, and leave-one-match-out
across two venues is close to leave-one-venue-out.

## Service alternation: real, and not yet usable

Service changes every two points. The test is label-free — a correct side
reading must give lag-2 agreement near 0% and lag-4 near 100%, where noise
gives 50% for both.

```
side reading            lag1   lag2   lag3   lag4
first on-table bounce    51%    42%    40%    56%   (d4593f8a)
serve-motif side         59%    27%    57%    60%   (35 of 79 points)
```

**The signature is there** in the motif-based side (lag-2 at 27%), so
alternation is real and detectable in this footage. Three of the four
matches also show clean game structure: breaks longer than 15s split
d4593f8a into 22, 15, 21, 21 points, which is games to 11.

But the cheap side reading is noise, and the good one covers 44% of points.
Two independent readings agree 83% of the time, which is not enough — a
constraint built on an 83% signal invents errors faster than it fixes them.

**This is the most promising unfinished thread.** Deciding which end served
is one bit from a whole rally, a far easier problem than timing a serve to
the quarter second, and nothing else we have constrains the point COUNT.

## What did not help

- **Audio, toss and pose as cutting rules.** Every placement of the cut by a
  new detector lost to the plain midpoint of a crossing gap (34 → 20, 16,
  14 on d4593f8a). They fire during rallies too.
- **The crossing trick does not transfer evenly.** koko and terry carry 2.4
  crossings per point against d4593f8a's 7.3, and terry scores worst
  everywhere (9/52). Crossing-based cutting needs crossings.

## Next

1. A better server-side classifier, then alternation as a hard constraint.
2. More marked matches. Every number here is two venues.
3. Route on crossing density, the way we already route on serve rate.
