# Sol replaces Luna as the first vision rung — 2026-08-26

The ladder was keypoints → Luna → Sol. It is now keypoints → Sol → Luna.

## Why it was Luna first

The original note in `points_pipeline.py` was explicit and honest about the
trade it was making:

> Luna is 2.4% median corner error against those marks and Sol 0.0% on the
> 7 it was called for, but Sol is 25x the price, and five Luna trials cost
> about a seventh of three Sol ones.

That was a **cost** decision, not an accuracy one, and both halves of it
were true. Sol had only ever run on the 7 frames Luna failed on, so nobody
knew what Sol did on the other 55.

## What changed

Sol was run over all 62 hand-marked frames in `table_calibration_review`
(the trials were already stored for Luna, so only Sol cost anything).
Scored as mean corner distance from the owner's own marks, in source pixels:

| | median | p75 | p90 | worst | ≤20px | >80px |
| --- | --- | --- | --- | --- | --- | --- |
| Luna | 57.0 | 108.0 | 137.0 | 425.9 | 21 | 22 |
| **Sol** | **10.6** | **23.1** | **45.6** | **96.1** | **41** | **2** |

- Sol better on **50 of 60**, worse on 10 — and **not one of those 10 is
  worse by more than 10px.** They are ties with noise on them.
- Luna wrong (>40px) on 35 frames; Sol fixes 27 of them.
- Luna right (≤40px) on 25 frames; **Sol breaks none.**

So there is no trade being made. Sol is not "better on average with a worse
tail" — its worst frame is better than Luna's median.

## The 2.4% was not wrong

2.4% of a 1080p frame diagonal is about 53px, which agrees with the 57px
above. The figure was accurate; expressing it as a fraction of the diagonal
hid the tail, and the tail is where a calibration either works or produces
fiction.

## Luna is fine at one venue, and that is probably the whole story

| venue | n | Luna | Sol |
| --- | --- | --- | --- |
| PingPod | 13 | 3.8px | 4.0px |
| LYTTC | 18 | 73.9px | 16.0px |
| Westchester TTC | 14 | 55.2px | 8.7px |
| Pingpod | 4 | 110.5px | 18.5px |

At PingPod the two are indistinguishable. Everywhere else Luna is three to
six times worse. The early corpus was PingPod-heavy, which is the most
likely reason Luna was ever first. **Do not read a venue-thin calibration
result as a general one.**

## Why this also killed two proposed guards

Before running Sol, two ways of detecting a bad Luna quad were tested on the
same 62 frames. Both failed, and the reason is the table above.

- **Trial dispersion** (escalate when Luna's own trials disagree) is
  *inverted*: the quartile with the tightest agreement had 69px median error
  and the loosest had 8px. `select_by_shape`'s existing comment already said
  why — "two trials can agree on the same wrong table" — and with a diverse
  pool shape-ranking has something good to find.
- **A net-presence probe** failed its own control, beating Luna on exactly
  30 of 60 frames when scored on the hand marks themselves. Chance.

Neither was ever going to work, because they were built to detect an edge
case. Luna is wrong on 35 of 60. That is not an edge case.

## Cost

Sol is ~25x Luna: roughly $0.075 a match against $0.003, and only on the
matches where the keypoint detector declines. Accepted by the owner on
2026-08-26 — a match already takes minutes to process, and a wrong table
poisons every stage after it.

**The number to watch is not this one.** It is the keypoint decline rate,
which has been running near half of recent uploads and on one clean,
well-lit, side-on PingPod match returned *zero* usable frames out of
sixteen. That rate sets the bill, and fixing it removes the paid step
entirely rather than making it cheaper.

## Caveat on the measurement

These are standalone frames with no ball detections, so the
`activity_overlap` validation could not run and Sol proposals rejected for
that reason alone were reinstated. Luna's stored trials were judged with
detections available. Distance to the hand marks is the stricter test and
Sol wins on it, but **Sol's refusal rate under the real gate is unmeasured**
— which is why Luna is kept underneath as a fallback rather than deleted.
