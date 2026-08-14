# Serve detection — the overnight study

2026-08-13. Nineteen agents, five sub-studies, four adversarial
verification passes, against **111 usable serve labels** (the owner's B-key
taps) and 3,248 kept/junk windows.

> **The raw artifacts are gone.** The study wrote to a session scratchpad
> that was swept on 2026-08-13 08:09, before anything was copied out. This
> document is reconstructed from the run's own report, which was read into
> context before the wipe. Numbers are quoted faithfully; the per-point
> JSON and the scripts are not recoverable and would need re-running.

## Verdict

**The serve is locatable.** A fused estimator puts the start of the serve
within **0.365 s of the human label at the median**, 1.13 s at p90, 83.8%
of points inside one second, at 100% coverage. Three independent agents
rebuilt it from scratch and reproduced the headline within 5%.

At a **2.0 s pad**, with the proposed clip start floored at today's clip
start so a bad estimate can never make a clip worse, it removes **40.3% of
the pre-serve dead footage with zero clipped serves** on the labelled
corpus.

**The end of the point does not work.** Five signals were built and fused;
on the one protocol with a genuine leave-one-**venue**-out holdout, reading
five signals recovers 12.3% of the tail while amputating 1.12% of endings,
and reading nothing at all (`end = t1 + P`) recovers 23.2% while amputating
0.37%. Two studies on two protocols agree. **Ship no end detector.**

## The signals

Error is `detector − label`, signed positive = late.

| Signal | Availability | Median abs err | p90 | Fires on junk |
|---|---|---|---|---|
| **B — double-bounce motif** | **82.9%** here, **64.0%** corpus | **0.252 s** | 1.06 s | 15.5% |
| **F — pose exchange** | 53.9% | 0.42 s | 1.79 s | 33.6% |
| A — ITTF toss (16 cm, ≤30°) | 35.1% | 0.883 s | 3.07 s | 24.2% |
| C — audio strike after silence | 99.1% | 1.045 s | 4.07 s | **81.2%** |
| E — service-rotation prior | 93.5% | names the right half **43.8%** | — | — |
| null (`t0 + c`, reads nothing) | 100% | 1.240 s | 4.52 s | — |

**Fused (B + F, A and C as fallbacks, floored at `t0`): 100% coverage,
0.365 s median, +1.911 s worst lateness.** Drop pose and the payload falls
42.0% → 31.0%. Drop the motif and it collapses to 13.9%. Drop the toss and
nothing changes.

`+1.911 s is the worst LATENESS, not the worst error.` The worst absolute
error is 7.7 s and it is **early** — early costs footage, it never clips a
serve, because the start is floored at today's.

### The winning mechanism

1. Find bounces: the ball falling then rising. **Relaxing the test from a
   2-px to a 1-px y-reversal, while requiring the ball to be moving (which
   is what stops a parked object manufacturing a bounce), lifted motif
   availability from 62.1% to 89.3% and cut p90 from 2.65 s to 1.06 s.**
2. Find the earliest pair of bounces on **opposite sides of the net with no
   racket contact between** — only a serve does that.
3. Serve contact = first bounce − **K = 0.81 s**.

K moves **0.05 s** under leave-one-match-out. A physical quantity behaves
like that; a tuned threshold does not. This is the only signal whose
kept-vs-junk separation holds in direction at **all four venues**
(64.0% vs 15.5%, 4.1×).

### Which of the owner's ideas paid off

| Idea | Verdict |
|---|---|
| **Only a serve bounces both sides with no contact between** | **The single best thing in the study** (see above). |
| **The 16 cm minimum rise** | **Paid off, and the measurement was the real prize.** Fitting `y = y0 + vy·t + (a/2)t²` makes `a` gravity in pixels, so **`a/9.81` is a px/m scale read off the footage itself** — no quad, no homography, no per-venue constant. Calibration-free by construction. Dropping the floor to 8 cm buys 9 points of availability and costs 50% more error — the trade a real threshold makes. |
| **The ≤30° verticality cone** | **Did not pay off.** Every confounder is *also* a near-vertical free-fall arc (a table bounce; a neighbour's serve literally is one). Verticality is true of serves but not distinctive. The discrimination lives in Law 2.6.1 — ball at rest on the palm first — which cuts candidates per point from 1.50 to 0.46 and error from 0.79 s to 0.50 s. |
| **Both players settled before a serve** | **Paid off; it is what makes pose work.** Without the ready gate, points with ≥2 s of dead head returned 3.28 s median error (firing on ball retrieval); with it, 0.53 s. Receiver trunk energy 1.42 pre-serve vs 4.77 during dead time. |
| **Rotation tells us who serves** | **Failed twice.** Names the right physical half **43.8% ± 6.7%** — at or below a coin flip. And `match_structure` exists on **2 of 43 matches**. |

### Three things that emerged unplanned

1. **Gravity as a ruler** (above) — the most transferable idea in the study.
2. **Audio is a superb refiner and a useless locator.** Given a ±0.35 s
   neighbourhood from another signal, the strongest onset in it lands within
   **0.06 s median, 0.21 s p90, on 91% of points**. Alone it barely beats
   reading nothing and fires inside 81% of junk.
3. **A replacement for the failed rotation prior:** the first confirmed net
   crossing after the serve points *away* from the server — available on
   **102 of 103** points, and its side calls come in runs of two exactly as
   ITTF rotation requires.

## Product numbers

Today every clip opens at `max(0, t0 − clip_pre)`. Over 111 labelled serves
the footage between that opening and the serve is **325.4 s, mean 2.93 s
per point, median 2.28 s** — which reconciles with the 88 s/match brief.

| Safety | Pad | s/point | Share of dead footage | Serves clipped |
|---|---|---|---|---|
| 100% in-sample | 1.911 s | 1.232 | 42.0% | 0 / 111 |
| **Recommended** | **2.000 s** | **1.181** | **40.3%** | 0 / 111 |
| Fully nested holdout | — | — | 41.2% | 2 / 111, worst 0.766 s |
| 95% | 1.172 s | 1.753 | 59.8% | 5 (4.5%) |

| Assumption | s/match |
|---|---|
| Measured on this corpus | 37 |
| **No pose, motif at its real 64% — plan against this** | **23** |

**Tail:** `end = min(clip_end, t1 + 1.07 s)` gives **15 s/match, 0 of 269
endings amputated**, with no detector at all.

**Safety is bounded by the sample, not the detector.** Zero clipped serves
in 111 labels is consistent with a true clip rate up to **2.66%**
(95% upper bound), i.e. up to 0.8 clipped serves per match.

## Junk-detection bonus

| Rule | Precision | Recall | Real rallies harmed |
|---|---|---|---|
| "No serve motif found" | 34.9% | 84.5% | 529 / 1470 (36.0%) |
| Zero crossings (ships today) | 63.3% | 63.3% | 123 (8.4%) |
| **Zero crossings AND no motif** | **64.6%** | 62.7% | **115 (7.8%)** |
| Same, behind a motif gate ≥0.7 | **81.6%** | 67.4% | **35 vs 40 (−12%)** |

**The serve detector is not a junk detector** (34.9% precision — two of
three deletions would be real rallies). Its use is as a **veto** on the
rule that already ships: requiring both to agree destroys **12–18% fewer
real rallies** for half a point of recall, and both signals are already
computed.

## What broke, and what surprised us

1. **Both unbiased labels are unusable.** Only 2 of 116 taps were made while
   paused, and both map to a time *after* their own point's `t1` (they sit
   on deleted junk fragments whose trailing pad shows the next rally). So
   the study has **zero** labels free of the 200–400 ms playback reaction
   lag. The "recompute on paused labels only" check has n = 0.
2. **The reaction lag does not make the detector secretly better** — every
   anchor carries a constant fitted leave-one-match-out, so a uniform lag is
   absorbed. Re-fitting against truth 0.25 s earlier leaves the median
   unchanged and shrinks the pot 42.0% → 37.2%.
3. **`clip_pre` is not 1.2 for half the corpus.** 16 of 32 matches predate
   migration 048, have `clip_pads = NULL`, and were cut with the frozen
   table in `clipEdit.ts` (tight 0.5/1.0, normal 1.0/1.6, loose 1.6/2.4).
4. **22 of 111 serves (19.8%) start before `t0`**, earliest by 0.65 s. On a
   fifth of points the pipeline's own boundary is already past the serve.
5. **`fit_play`'s table axis has an arbitrary sign** — it comes from
   `activity_gate`'s SVD principal axis, so near/far hit attribution is a
   coin flip per match **in production today**. Deriving the axis from the
   calibrated quad fixes it at no cost. **Live bug, independent of this
   study.**
6. **The quad-derived pixel scale is wrong by ~1.54× at toss height.** At
   release the ball is well above the table plane, so the homography places
   it further away than it is. Sizing tosses off the quad would read a
   0.24 m toss as 0.37 m.
7. **The end labels are censored by our own app.** Keep score froze the
   video at `t1 + min(effPost, PAUSE_BEAT_S)` with `PAUSE_BEAT_S = 0.6` for
   every label in this corpus. 52% of 480 labels sit in a 0.35 s band, 126
   in a single 0.1 s bin. **Any tail safety claim above `t1 + 0.35` is
   structurally unfalsifiable on this data.** (The beat is now 1.2 s, so
   re-collect before asking the question again.)
8. **Withholding is dominated.** Because the proposed start is floored at
   today's, a wrong answer cannot make a clip worse, so abstaining only
   gives up footage. Every confidence threshold tested is worse than full
   coverage.
9. **Verification found a real label defect:** `kumar_a0f7` idx 96/97/98
   have `cut_t0` anchored 0.9 s later than the rest of that match, so their
   labels are 0.9 s early. Correcting them moves the median 0.362 → 0.353.
10. **Two of four verification passes refuted the headline framing** (never
    the arithmetic): "worst 1.911 s" is worst *lateness*; "zero clipped" is
    measured at a pad defined as the corpus maximum; "37 s/match" is the
    optimistic row of a table recommending 23.

## Availability is the binding constraint everywhere

Motif kept-firing rate per match runs **10.2% (alex_efff, PingPod) to 94.7%
(chris_ebbb, PingPod)** — top and bottom at the *same venue*, so it is not
the room. **Every match below ~50% is a tracking or calibration failure,
not a serve-detection failure.** The same rule reaching 90.7% precision on
`kumar_a0f7` reaches 1.9% on `alex_efff`.

## The caveat that gates everything

**110 of 111 precise labels are LYTTC** (Ishan 59, Kumar 47, Prabhas 8),
one is PingPod, and two of the three matches are the same opponent pair in
the same room with the same camera. Leave-one-match-out was run everywhere
and holds; **leave-one-venue-out is impossible for anything timed.** The
only genuinely cross-venue statement is that the motif fires more on
rallies than on junk at all four venues — availability, not accuracy.

> **Re-run, same day:** the detector was rebuilt from this document and
> measured on 26 matches and 2,326 points — see
> `2026-08-13-serve-detection-rerun.md`. It confirms the mechanism and the
> availability finding, and corrects item 4 below the "What broke" heading:
> compared against `cut_t0`, which is the same clock as the labels, **no
> serve in the corpus starts before the point's own boundary.**

## Next steps, in priority order

1. **Post-roll to `t1 + 1.1 s`.** 15 s/match, 0 of 269 amputated, no
   detector, no compute. Highest value-to-risk in the study.
2. **Motif as a veto on the shipped junk rule.** 12–18% fewer real rallies
   destroyed, both signals already computed.
3. **Twenty serve labels at a second venue.** An evening of tapping. This is
   the binding constraint on every timing claim above.
4. **Measure pose availability outside LYTTC** — the whole difference
   between planning for 23 s and 37 s per match.
5. **Fix the tracker.** Top-k candidates per frame instead of the global
   argmax, gated to the two end zones during the pre-serve window. Every
   toss failure inspected was an identity error with the real ball visible
   in the same frame.
6. **Then pilot the head trim** at a 2.0 s pad, floored at today's clip
   start, behind a per-match availability gate (off below ~50%).
7. **Put a person detector in front of RTMPose** — far-end wrist recall is
   53–66% against 98–99% near, because the fixed table-geometry crop
   contains neighbouring courts. Sample at 30 fps, not 15.
8. **Build no more end-of-point detectors** until the tail is re-labelled.
9. **Fix the `fit_play` axis sign** (item 5 above) — live pipeline bug.
