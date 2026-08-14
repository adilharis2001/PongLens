# Serve detection, rebuilt and measured on 26 matches

2026-08-13, evening. The overnight study
(`2026-08-13-serve-detection.md`) lost its artifacts to a swept
scratchpad, so the motif detector was rebuilt from that document's own
description and run again — this time on **26 matches, 2,326 points and
five venues**, with the table quads fixed by the calibration work earlier
the same day.

Everything here lives outside the repo, in
`~/Library/Caches/PongLens/serve-study/`: the scripts, the per-match ball
detections (reusable — this is the corpus the last study lost), the
per-point estimates, and the review page.

**Nothing in production changed.**

## Verdict

**The detector is accurate and safe. It is also silent on two points out
of three, and that is the whole problem.**

- Where it fires, the serve lands **0.25 s from the human tap at the
  median**, 0.83 s at p90, worst lateness **+1.50 s**.
- At a **2.0 s pad**, floored at today's clip start, it clips **0 of 97
  labelled serves** — the worst case still opens 0.20 s early.
- It fires on **35.8%** of points, and the per-match range is
  **0.6% to 93.7%**.
- The realised saving is therefore **0.49 s per point, ~44 s per match**.
  On the matches where it fires reliably it is **2.35 s per point**
  (ishan_4c13) — that gap is the entire remaining prize.

## The correction that mattered most

The previous study reported that "22 of 111 serves (19.8%) start before
`t0`". That is the cut-source timebase trap: `serve_start_at_cut_s` is in
cut seconds and `t0` is in source seconds. Compared against `cut_t0`,
which is the same clock:

**No serve in the corpus starts before `cut_t0`. The minimum is +0.55 s,
the median +2.37 s, and p90 is +6.50 s.**

The first search window built here ran to `cut_t0 + 3.0 s` and missed the
serve outright on a third of points, which read as a detector failure and
was a window failure. Measured from today's clip opening the dead head is
**median 3.57 s, p90 7.70 s** — considerably more than the 2.93 s mean the
earlier document reports, and for the same reason.

## The mechanism

Unchanged in spirit from the overnight study, and it holds up:

1. **Bounces** are local image-y maxima of a ball that is moving — a 1 px
   reversal with a 3 px/frame motion floor, which is what keeps a parked
   object from manufacturing one.
2. **The motif** is the earliest pair of bounces on opposite sides of the
   net with no racket contact between them. Only a serve does that: inside
   a rally there is always a bat between two opposite-side bounces.
3. **Serve contact = first bounce − 0.81 s.**
4. **Audio refines, never relocates.** The strongest onset within ±0.30 s
   of the motif's answer, and only when it stands 4× above the local
   baseline. It moves the median from 0.28 s to 0.25 s.

Three tests were added to the rebuild, all of which paid:

- **An apex test.** The ball has to leave the table between the two
  bounces. A ball *rolled or pushed* back to the server bounces on both
  sides with nothing touching it and is otherwise a perfect impostor.
- **A rally-follows preference.** Among qualifying pairs, prefer the
  earliest one that is followed by at least one more net crossing. A
  courtesy toss back to the server has no rally after it.
- **Off-table frames are not evidence.** A detection metres off the table
  is an identity error, not the ball; counting one as the ball doubling
  back threw away clean serves on a single bad frame.

The only threshold worth arguing about is how much backward travel to
tolerate between the two bounces. The physical answer is ~0.25 m; the
honest one is 0.5 m, because the tracker jitters. That single change took
`kumar_a0f7` from 67.3% to 81.6% availability with the p90 error unmoved.
Every other threshold — pair window, net margin, bounce sensitivity, gap
tolerance — moved the result by less than a point, which is the property
you want: this is a physical rule, not a tuned one.

## Accuracy, against 97 labelled points

| | |
|---|---|
| Median absolute error | **0.254 s** |
| p90 | 0.828 s |
| Worst lateness | **+1.50 s** |
| Signed median | −0.078 s |
| Late at all | 39 of 97 |

The taps were made during playback and land 200–400 ms after what they
mark, so a signed median of −0.08 s means the estimator is really running
~0.3 s **early** of true contact. Early is the safe direction: it costs
footage, it never clips a serve.

## What the safety pad buys

Clipping is counted against the taps moved 0.30 s earlier, to absorb the
reaction lag.

| Pad | Saved per point | Per match | Serves clipped | Worst |
|---|---|---|---|---|
| 1.00 s | 0.82 s | 74 s | 9 (9.3%) | +0.80 s |
| 1.25 s | 0.73 s | 66 s | 4 (4.1%) | +0.55 s |
| 1.50 s | 0.65 s | 58 s | 3 (3.1%) | +0.30 s |
| 1.75 s | 0.56 s | 50 s | 1 (1.0%) | +0.05 s |
| **2.00 s** | **0.49 s** | **44 s** | **0** | **−0.20 s** |
| 2.50 s | 0.37 s | 33 s | 0 | −0.70 s |

2.0 s is the first pad with nothing clipped and it is the one to pilot.
Note what the table does *not* say: zero clipped in 97 labels bounds the
true rate at about 3% (95% upper), not at zero.

## Availability is still the binding constraint

| Match | Venue | Points | Serve found | Saved per point |
|---|---|---|---|---|
| ishan_4c13 | LYTTC | 79 | **93.7%** | 2.35 s |
| chris_ebbb_rc | PingPod | 38 | 89.5% | 0.65 s |
| kumar_a0f7 | LYTTC | 49 | 81.6% | 1.26 s |
| vaibhav_7899_rc | PingPod | 123 | 78.9% | 0.79 s |
| prabhas_abcd_rc | LYTTC | 70 | 68.6% | 1.04 s |
| vinay_5721_rc | PingPod | 162 | 63.6% | 0.63 s |
| chris_d3c7_rc | PingPod | 49 | 63.3% | 0.37 s |
| … | | | | |
| santosh_6b7b_rc | — | 111 | 8.1% | 0.13 s |
| yilin_6a37_rc | Westchester | 140 | **0.7%** | 0.01 s |
| vinay_0411 | Westchester | 156 | 0.6% | 0.03 s |

The spread is not the room: PingPod holds both 89.5% and 11.7%, LYTTC both
93.7% and 12.8%. It is not the quad either — the failing matches were
re-run with human-verified quads and still fail. Ball-detection rate on
the failing matches runs 0.60–0.73 against 0.85 on `kumar_a0f7`, and the
failure is almost always "no opposite-side pair": bounces are found on
both halves of the table over the match, but rarely as a clean pair inside
one point.

**That points at the tracker, not the detector.** BlurBall's online
tracker commits to one ball per frame by global argmax; the rebuild keeps
all four candidates per frame and already tries a table-corridor
alternative, which helps but does not close the gap.

## What to do next

1. **Pilot the head trim at a 2.0 s pad, floored at today's clip start,
   behind a per-match availability gate.** Below ~50% found it should not
   run at all; the saving there is a rounding error and the exposure is
   not.
2. **Fix the tracker before anything else.** Top-k candidates per frame,
   gated to the two end zones during the pre-serve window. Availability is
   worth roughly 2 s per point and nothing else on this list is.
3. **Twenty serve taps at PingPod or Westchester.** Every timing number
   above still rests on three LYTTC matches; the availability numbers are
   cross-venue, the accuracy numbers are not.
4. **Re-read the earlier document's `t0` claims against `cut_t0`.** At
   least one is a timebase artefact; others may be.

## The review page

`~/Library/Caches/PongLens/serve-study/review/index.html` plays every
point from the opening the trim would give it, with the detected serve
marked, and records a verdict per point (right / too late / too early / no
serve) into local storage. Those verdicts are the cheapest labels
available: they need no scrubbing, only a yes or no on footage that is
already cued.
