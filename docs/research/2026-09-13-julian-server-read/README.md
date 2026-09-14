# Why the server still read wrong on Julian, 13 September

Adil scored this match and set the server by hand where he saw it go
wrong, then asked why V3 still gets it wrong. **Mostly it does not. The
ruler does.**

Match `1075f229`, PingPod, 67 points, 64 scored, 5 server overrides.

## What the comparison said

V3 named an end on 52 of the 66 visible points and disagreed with the
scoring rotation on **17 of them — 33%**, far worse than the 19% error the
worker measured when V3 was built.

## What was actually wrong

**The scoring has one game that never closed, reading 26–38.** Zero game
boundaries. A game ends at 11.

That matters because the ITTF rotation switches to ONE serve each at
10–10. With no boundary ever found, the walk has been in permanent deuce
since about point 21 and simply alternates the server every point from
there on. It is not counting anything out any more.

It shows in the run lengths. Clean pairs for the first 33 points, then
almost nothing but singles:

```
runs: 2 2 2 2 2 2 1 2 2 3 2 2 2 2 2 1 2 | 1 1 1 1 1 1 1 1 2 1 1 1 1 1 1 ...
                                        ^ the anchor goes here
```

## Asking the ball instead

Neither side is ground truth, so `arbitrate.py` uses the one thing that
cannot be argued with: a bounce, a net crossing, then a bounce on the
other half within about half a second is a serve, and the first half is
the server's.

Of the 17 disagreements:

| | |
| --- | ---: |
| **V3 right, rotation wrong** | **12** |
| rotation right, V3 wrong | 2 |
| the ball is silent | 3 |

The control holds: on the 35 where the two agreed, the ball confirms both
30 times, is silent once, and disagrees with both 4 times.

**And every one of the 17 came from the computed rotation. Not one came
from a server Adil set by hand** — where he named the server himself, V3
agreed every time.

So V3's real error on this match is at most 2 of 52, plus some share of
the 4 where the ball disputes the consensus: **roughly 90%, not 67%**.

## What shipped

The accuracy figure is now suppressed when no game has closed and the
score has run past 11, with a line saying why and what to do. A number
built on a rotation in permanent deuce measures the ruler's drift, not the
detector, and this page exists to decide what to trust.

## What did NOT hold

Three plausible explanations, all dead on this match:

- **the bounce sits near the net, where the half flips easily** — median
  distance from the net 0.92 m on the ones V3 got right and 0.93 m on the
  ones it got wrong. Identical.
- **the ball had already crossed, so V3's bounce is really the second one**
  — 1 of 35 right, 1 of 17 wrong.
- **the net-crossing order disputes the half** — the check shipped on
  2026-09-13 caught 6 of 8 on the earlier sample and **0 of 17 here**,
  firing only on 2 that were right. It is weaker than that sample made it
  look; leave it as a flag and do not build on it.
