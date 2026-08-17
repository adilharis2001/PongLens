# What Adil's serve notes turned out to mean

2026-08-17. He reviewed 24 serve calls on `/research/serves` and wrote free
text on 21 of them, with the instruction that the prose mattered and the
serve/not-serve toggles did not. This is what the corpus says about each
mechanism he described.

Scripts: `TTVid/recall-lab/s29`–`s38`. Corpus: the six calibrated matches
with his own serve-and-winner taps, 278 bounded points.

---

## The headline number was wrong, and I wrote it

`/research/serves` says "41% of what the detector finds is not a serve". That
figure counts a call as wrong when it lands more than 1.5s from one of his
278 double-tapped points. Two things break it.

**His taps do not cover the matches.** Scored share by match: prabhas_rc 99%,
ishan_rc 91%, kumar 89%, chris_b 79%, ishan 78%, chris_rc 56%. Ten percent of
all serve calls fall in stretches he never scored at all, and on chris_rc it
is 25 of 53 calls. Those cannot be graded either way.

**A point he kept but did not tap twice is not in the truth set.** Of the 181
"wrong" calls, **132 sit inside a production card he reviewed and kept**, 11
inside a card he deleted, and 38 inside no card at all.

So the three notes saying "this looks like a real serve, I don't know why it
got deleted" — chris_rc@53.27, ishan@50.87, kumar@198.28 — are right about
the serve and wrong about the deletion. All three sit inside cards he kept.
The page's own category label ("in dead time, no point nearby") is what told
him otherwise, and that label is measuring distance from his taps, not what
happened on screen.

Graded only inside the stretches he actually scored, the detector is 66%
right, not 59%. Graded against "did this call land in footage he chose to
keep", the clearly-wrong count is 11 of 445.

---

## Each mechanism he described, measured

### 1. A pass over the table is geometrically a serve — correct, and it is the
### largest error class

Five notes describe the same event: a player fetches the ball, walks back,
and bounces it across the table to the server. Two bounces, opposite sides,
inside 1.6s, rising in between, travelling forward. Every rule the detector
has is satisfied because the ball genuinely did all of those things.

This is 70% of the calls that miss his marks. **No test applied to those two
bounces can separate it**, which is why the toss test and the backtrack test
below both come back flat: they measure a half-second that is genuinely
identical between the two cases.

### 2. "After the first bounce the ball can never move back" — right rule,
### wrong implementation, and the wrong implementation is in production

He said this four separate times. The detector already claims to do it:
`BACKTRACK_MAX_M = 0.50` in `s4_ball.serve_motifs`. What that code measures
is the largest **single step** backwards between consecutive tracked frames,
on the homography-projected ground position — so a ball drifting two metres
back to a bat over twenty frames registers a few centimetres per frame and
passes. It also uses a projection that is meaningless while the ball is high
above the table plane.

Three readings, measured:

| reading | right calls | mid-rally calls | separation |
| --- | --- | --- | --- |
| largest single backward step (today's code) | median 0.13m | median 0.23m | almost none |
| furthest the ball travels *behind* the first bounce | median 0.14m | median 0.27m | almost none |
| **sharpest direction change between the bounces** | **median 16.7°** | **median 131.7°** | **strong** |

The third is what he was actually describing. A bat contact is not a drift,
it is a reversal in one or two frames. At a 90° ceiling it keeps 76% of right
calls and removes 65% of mid-rally ones. It does nothing to the dead-time
class, as expected — a pass has no bat contact either.

### 3. Bounces used that are not on the table — confirmed, and it is a plain bug

The pair test filters candidate bounces through `in_corridor`, which allows
0.7m either side and 1.5m beyond each end. The playing surface test is
tighter and is never applied to the pair.

All three of his explicit reports are this:

- `ishan_rc@686.68` "the second bounce got registered outside the table" —
  bounce 2 is off the surface.
- `prabhas_rc@635.90` "no sign of a first bounce... no second bounce within
  the table coordinates" — **both** bounces off the surface, 1.20s apart.
- `prabhas_rc@164.86` "somebody's footstep in the background... they are
  wearing white shoes" — bounce 2 is off the surface.

11% of right calls and 17% of wrong ones use at least one off-surface bounce.

### 4. "There is a real serve, it's just picking the wrong one" — real, but
### about one second, not several

Around a single real serve the detector forms a median of **2 accepted pairs,
p90 of 4, maximum 9**; 70% of his points have two or more competing pairs.
Nothing ranks them. The whole selection is:

```
keep the earliest pair, then skip 1.5 seconds
```

So the reported serve time is whichever pair came first, not the best one.
Measured against his own marks:

| | median error | p90 | within 0.5s |
| --- | --- | --- | --- |
| what the pipeline emits | 0.27s | 0.73s | 74% |
| the best pair that existed | 0.18s | 0.66s | 80% |

The mechanism he describes is real. The cost is about 0.09s of median head
placement, not the "much later" it looks like inside a 4.8s clip. A ranked
pick using only serve-legal properties did not beat it (19 wins, 10 losses,
224 identical).

### 5. The toss — physically true, not visible to this tracker

He is right that a pass has no vertical toss and a serve does. Measured as
verticality of the rise before contact: right calls median 0.62, wrong calls
median 0.66. No separation at any threshold. The ball during a toss is slow,
small and against the player's body, which is exactly where BlurBall drops
it.

### 6. "Was the opponent at the table" — no separation at the moment of the call

Share of the 1.6s before contact with both ends occupied: right calls 80%,
dead-time calls 74%. The reason his observation does not translate is that by
the time the pass happens the player **has** walked back and is at the table,
and a real serve is also preceded by a walk-back after the previous point.
The state is the same; only the intent differs.

### 7. "Bad cut, the point started in the middle of another rally" — this one
### is my page, not the pipeline

Four notes say this. The clips on `/research/serves` are a fixed window of
2.2s before to 2.6s after a serve **call** — they are not cards. A clip
around a mid-rally call necessarily opens mid-rally.

The pipeline's actual cards: across 277 points, the next card opens before
the current point ends **0 times**, the median gap between consecutive cards
is 1.22s, and none are negative.

---

## The one thing his notes point at that is genuinely expensive

Not in the notes, but underneath them. "Same side" is the top reason a real
serve's own pair is rejected — 123 occurrences against 72 for "too far apart"
and 28 for "on the net line". Those bounces sit a median of **0.37m from the
net line, p25 0.11m**, against a `NET_MARGIN_M` of 0.20m required on *both*
bounces.

**A short serve cannot form a pair at all.** It lands close to the net twice,
so one bounce is inside the margin, or projection error near the net puts
both on the same side. This is why chris_b — the match where he says "the
opponent is near the camera and he is blocking the first bounce" — accepts a
pair on only 72.5% of his marked serves against 90–96% everywhere else.

---

## What the fixes are actually worth, measured end to end

Each is the real pipeline with one thing changed, scored against his
boundaries. Recall is 100% in every row; no variant loses a point.

| | serve calls | whole | split | fused | junk | head |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | 572 | 91% | 2% | 3 | 28% | 1.8s |
| A no rally already running | 473 | 91% | 2% | 3 | 27% | 1.9s |
| B both bounces on the surface | 523 | 91% | 2% | 2 | 27% | 1.8s |
| **C = A + B** | **441** | **91%** | **2%** | **2** | **27%** | **1.9s** |
| D turn angle ≤ 90° | 396 | 88% | 1% | 2 | 25% | 1.9s |
| F A + B + D | 346 | 89% | 1% | 4 | 25% | 1.9s |

**Removing 131 of 572 serve calls moves junk by one point and nothing else.**
The false-serve rate is close to cosmetic at the card level, because a
dead-time call either produces a card the on-own-table filter already kills
or one that merges into a neighbour, and because a point whose serve is
filtered out still gets a card from the fallback path.

C is free: no metric worse anywhere, chris_b split 5%→2% and junk 18%→15%,
kumar whole 90%→93%. D buys 2 points of junk for 3 points of "held whole",
which is the wrong direction — a point split across two cards costs a manual
join.

So the turn angle should **rank competing pairs, not veto them**: when two
pairs sit around one serve, the one with a bat contact in the middle is the
mid-rally impostor and should lose to the one without.

---

## What was implemented, 2026-08-17

In `s4_ball.serve_motifs`, which is where the new pipeline gets its serves.
Production's `points_pipeline.py` does not carry this detector, so nothing
here touches a live upload yet.

Rejecting a bad pair inside the pair search rather than filtering the output
afterwards matters: the loop carries on and can still find the real pair for
that serve, where a post-filter just deletes it.

**Shipped**

1. **Both bounces on the playing surface.** `marked` is now filtered by
   `on_surface` (0.15m pad) instead of `in_corridor` (0.7m across, 1.5m past
   each end).
2. **No serve inside a running rally.** More than one net crossing in the
   1.5s before the first bounce and the pair is rejected. One is allowed
   rather than zero because the crossing detector fires on noise often
   enough that demanding zero costs 47 real serves their head.

**Built, measured, and switched off**

3. **Ranking a cluster by the turn between its bounces.** The single sharpest
   signal in the corpus and the wrong thing to steer with. See
   `USE_BEST_IN_CLUSTER` in `s4_ball.py` for the numbers; short version, the
   old rule was already within 0.27s of his own tap against a ceiling of
   0.18s, so there was 0.09s to win, and every time the turn test preferred a
   smoother pair later in the rally the head moved with it and clipped the
   serve off the front. Clipped points 7.2% → 8.7%, chris_b held-whole
   85% → 82%, chris_rc 96% → 91%.

Ablation, `s39_ablate.py`, each row a full regeneration and rescore:

| combination | serves | lost | whole | split | clipped | fused | junk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 578 | 0 | 90.6% | 2.2% | 7.2% | 3 | 26.0% |
| surface only | 535 | 0 | 90.3% | 2.2% | 7.6% | 1 | 25.4% |
| no rally running only | 488 | 0 | 91.0% | 1.8% | 7.2% | 3 | 25.6% |
| best in cluster only | 578 | 0 | 89.9% | 1.4% | **8.7%** | 3 | 26.3% |
| **surface + no rally (shipped)** | **461** | **0** | **90.6%** | **1.8%** | **7.6%** | **1** | **25.0%** |
| all three | 461 | 0 | 90.3% | 1.4% | 8.3% | 1 | 25.1% |

The shipped pair trades about one clipped point for two fewer fused cards
and a point of junk. A fused card cannot be scored at all; a clipped one can,
after hunting for the start. That is the trade being made and it is the right
way round.

Final, against his 278 bounded points: recall 100%, held whole 91%, split 2%,
fused 1 (was 3), junk 27% (was 28%), head 1.9s against a 2.0s target.
kumar 90% → 93% held whole, chris_b junk 18% → 15% and split 5% → 2%,
ishan_rc 87% → 86%.

**`/research/serves` is now stale and must not be regenerated.** Its case ids
are `matchKey@contact_s`, and the contact times have moved, so re-running
`s28_servepage.py` would orphan all 21 of his notes in `serve_review_notes`.
Its headline "41%" is also the flawed figure described at the top of this
document.

## The tail, which he complained about four times

22% of cards end on the crossing chain rather than the last table bounce, and
those are the long ones: cards run past his winner tap by a median of 1.10s,
p90 3.47s, worst 9.2s.

Shortening the pad is measured harmful and this settles it:

| TAIL_AFTER_BOUNCE | lost | whole | clipped |
| --- | --- | --- | --- |
| 2.6s (today) | 0 | 90.6% | 20 |
| 2.2s | 0 | 87.0% | 30 |
| 1.8s | 0 | 78.7% | 50 |
| 1.4s | 0 | 65.3% | 86 |

The lever is the crossing chain, not the pad.
