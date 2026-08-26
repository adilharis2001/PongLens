# Segment reasoning: read the ball's flights, not its frames

Status: design, agreed with Adil on 2026-08-26. Nothing built yet.

## What this is for

The serve-accuracy research page names a winner on 108 of 174 scored
points across the Chris and Julian matches — 62%, right on 96% of them.
The other 66 get no call. This is a plan for roughly 45 of those 66.

The goal is NOT zero no-calls. Some of these points do not contain the
answer, and inventing one is worse than a blank. The target is **wrong
calls stay at zero-ish and coverage rises as far as the footage allows**,
which on this corpus is probably near 80%.

## Why the points go uncalled

| count | reason the page gives |
| --- | --- |
| 22 | a landing was missed |
| 11 | nothing followed the last landing |
| 10 | the ball bounced somewhere too close to call |
| 9 | 2 shots after the last landing |
| 3 | 3 shots after the last landing |
| 3 | the ball bounced somewhere we could not place |
| 3 | the ball died on the wrong side to have gone unreturned |
| 3 | touched right after it dropped, so it was not dead |
| 2 | nothing to go on / no placement data |

Four of the five rules read the ball track, and every one of them reads it
**frame by frame**. That is the defect. A frame where the tracker has lost
the ball and locked onto a chair is indistinguishable from a real one when
you look at frames in isolation.

Meanwhile the event record — the bounces and contacts the worker stored —
simply has holes in it. The two failures compound: the events are missing
the landing, and the track is not trusted to supply it.

## The evidence this is built on

**Julian point 51.** Ball lands on Julian's half at clip 3.43. He hits it
long past Adil's end. Adil wins. The page says "nothing followed the last
landing" because no contact was ever recorded after the landing.

The track does not stop. It loses the ball for eight frames, and says so:

| clip | what the tracker has | confidence |
| --- | --- | --- |
| 3.30-3.37 | the ball, descending onto Julian's half | 59, 65, 19 |
| 3.40-3.47 | a static object at y=749 | **1.24, 0.57, 1.21** |
| 3.50-3.57 | a different static object | 7, 13, 15 |
| 3.64-3.97 | the ball again, crossing to Adil's end | 63, 106 |

There is exactly one detection per frame, so the ball is not hiding in a
lower-ranked candidate — BlurBall did not find it. But look at the two
flights either side of the hole:

- in: (1231,532) -> (1284,573), moving right and **descending**
- out: (1306,481) -> (1224,457), moving left and **ascending**

They nearly meet in space, 22 px apart, and reverse direction. A bounce
and a bat contact happened in that gap. Neither was seen; both are
provable.

**Julian point 74.** Same shape, opposite answer. The final flight
descends smoothly and leaves — no reversal, no bounce. Adil hit it out.

**Julian point 79.** A corner winner. The ball descends to its lowest
point at clip 10.34, s=0.723, inside the table quad, then rises and
sails past the far end. That landing was never detected, and it is the
whole point: it is what makes the shot legal and Julian's failure to
reach it decisive.

## What has already been tried, and failed

Recorded so nobody repeats it. All measured on the same corpus.

| attempt | result |
| --- | --- |
| last bat strike, then look for a bounce | 79% over all no-calls |
| the same, requiring proof the ball exited | 75% |
| "did it bounce on the other half?" | 50% |
| the same, requiring the bounce to be ON the table | 67% |
| the same, plus tracker-confidence filtering | 71% on 7 fires |

Every one of these reads individual frames. That is why the gaps ate
them, and it is the reason to change the unit of analysis rather than
keep tuning thresholds on eleven points.

Two other dead ends from earlier work, also measured:

- **Seeing the net directly.** A reversal detector fires on three
  quarters of all points at loose settings and slides to zero as it
  tightens, with the two matches disagreeing at every threshold. The
  missing quantity is height.
- **Raising the confidence floor on the shipped rules.** Costs coverage
  (108 -> 97 at conf >= 20) and buys no accuracy. Their existing gates
  already reject that noise. Left alone.

## The design

### Flights

Split the track into **flights**: runs of frames where the ball is moving
in one smooth arc. A flight ends when any of these breaks:

- a time gap larger than ~0.12 s
- a position jump larger than the ball could travel in one frame
- confidence collapsing (the tracker announcing it is lost)
- the arc itself changing — the thing the next section is about

Low-confidence frames are dropped before this, not reasoned about. The
threshold is a parameter to be swept, not guessed; the point-51 numbers
suggest somewhere around 15-20 but that is one point.

### Joins

A ball in flight only changes its arc when something touches it: the
table, a bat, or the net. Nothing else. So **every join between two
flights is an event**, and the two flights say which:

| in | out | reading |
| --- | --- | --- |
| descending | ascending, from the same place | it **bounced** there |
| descending toward a player | going back the other way, from near their end | **they hit it** |
| same arc continues | | nothing touched it |
| descending | never resumes, ball leaves the volume | it **went out** |

The join's position is where the two flights are closest, not where
either was last seen. This matters and has bitten three times already:
the flag is never the event. Twice on the net turn, once on the V.

### What it produces

Not a new rule. An **event-repair layer**: recovered landings and
contacts, with a confidence and a provenance, merged into the event list
the existing four rules already read. Where a recovered landing is on the
table, project it through the table homography — valid precisely because
a bounce is by definition on the table plane, which is the one case that
escapes the height problem that killed the prism and net detection.

Then re-run the existing rules unchanged. If the repair is right, "a
landing was missed" stops being true and the off-table read does the rest
by itself.

### Gates

To be established by measurement, but the shape is known from every rule
built so far:

- a recovered event must come from two flights that are each long enough
  to establish an arc
- the join must be within the table's neighbourhood, not across the room
- if the flights either side are too short or too noisy, recover nothing
  and leave the point uncalled

## How it will be judged

Corpus: the same 174 scored points, both matches, Adil's own taps as
truth. Two numbers, and both must hold:

1. **Wrong calls do not increase.** Currently four: Chris 47, Chris 72,
   Julian 11, Julian 53. A repair layer that adds coverage by adding
   mistakes is a failure, however good the headline looks.
2. **Coverage rises materially.** Below about ten extra points this is
   not worth the complexity it adds.

Per-bucket accounting as well, so it is clear whether the 22 "a landing
was missed" actually convert, rather than the total moving for some other
reason.

The three points that motivated it — Julian 51, 74 and 79 — must each
come out right, and their reasoning must be inspectable on the page.

## Out of scope

- **Zero no-calls.** Points whose footage does not contain the answer
  stay blank.
- **Re-running BlurBall.** The real fix for the tracker jumping to
  furniture is a motion prior, or emitting top-K peaks per frame instead
  of top-1, or simply emitting nothing below a confidence floor rather
  than the best available lie. That raises the ceiling for everything
  downstream, but it is a separate piece of work and this design is
  deliberately built to need no re-inference. Decide on it after this is
  measured, with evidence of exactly which frames need recovering.
- **Production.** This is the research page. Nothing here goes near the
  worker or the app until the numbers are in and Adil has reviewed the
  points by eye.
