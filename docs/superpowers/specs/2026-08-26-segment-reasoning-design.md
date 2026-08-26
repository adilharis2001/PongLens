# Segment reasoning: read the ball's flights, not its frames

Status: built and measured on 2026-08-26. The design is below as it was
agreed; what it measured, and the parts of it that turned out to be wrong,
are recorded at the end.

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

---

# What was built, and what it measured

Built 2026-08-26. Lives in `src/app/research/serve-accuracy/segments.ts`,
with the page's single reading of a point in `pointReading.ts` and a test
on real points in `segments.test.ts`.

## The result

| | called | right | wrong |
| --- | --- | --- | --- |
| before | 108 of 174 (62%) | 104 (96%) | 4 |
| after | 117 of 174 (67%) | 113 (97%) | 4 |

The four wrong are the same four: Chris 47, Chris 72, Julian 11, Julian
53. Nine points gained, all nine right. Nothing that was already called
changed, and it cannot: the repair only runs where the rules refuse.

Nine is below the ten this document set as the bar. It is short by one
point and the shortfall is real, not a rounding. What the bar was
protecting — that the complexity buys something worth carrying — is met:
the layer converts a bucket the rules could not reach at all, and it does
so without spending a single wrong call.

## What the design got right

**Flights work.** Over both matches the machinery lands a join on 836 of
the worker's own 896 detected landings — 93%, positioned within 6.6 cm at
the median. It reconstructs the rally the detector saw, from the track
alone, without ever being shown it.

**Joins classify.** A bounce reverses the ball's height and leaves its
heading alone; a bat can reverse both. Reading a both-turn as a landing
was the first version's largest single error.

## What the design got wrong

**Per-join quality gates cannot work, and this is the important finding.**
The plan assumed a spurious join would look different from a real one —
shorter legs, lower speed, a worse fit. It does not. The 94 joins that sit
on nothing at all have the same energy loss, the same vertical speed and
the same frame counts as the 698 that sit on a confirmed landing,
overlapping at every percentile. Tightening the join is not a lever. Do
not spend another day on it.

**The separator is the sequence, not the join.** A return must bounce on
the receiver's half before it can be played, so landings alternate. Two on
the same half is a hole whose contents the sequence PREDICTS: a landing,
on the other half, between those two times. A candidate is admitted only
where it fills one. That single change took the layer from 10 right and 5
wrong to something worth gating.

**A third of it was never a detection problem.** Five of the points
refusing with "a landing was missed" had the landing recorded all along,
projected two to eleven centimetres past the far end line and dropped from
the sequence by a hard boundary. The off-table rule already tolerates that
error when it classifies an ending and not when it builds the sequence.
The flights are what make correcting it safe rather than a widened
tolerance for everybody: they never saw the detector's answer, and they
put the same event on the table.

## The two trust tests

Repair alone unlocks 20 calls, 15 right and 5 wrong. That is not a rule.
Two questions take it to 9 of 9, and neither is a filter fitted to the
failures — both are questions the repair itself raises.

1. **Did the repair finish?** A rally alternates from the serve to the
   last shot. A point still holding a hole is one where nobody knows which
   shot is being read, and filling the hole the off-table rule happens to
   look at restores that rule's confidence without earning it.
2. **Was the ending seen?** Every one of these points ends with the ball
   not coming down again — a claim about something ABSENT, which the
   record makes when the ball went out and equally when the tracker
   stopped looking. Watching it descend out of the playing volume and stay
   out separates them.

Alternation alone keeps 16 calls and leaves 3 wrong. The exit alone keeps
11 and leaves 1. Together they keep 9 and leave none. They are not
redundant and neither should be dropped.

## Thresholds

Swept, and the honest summary is that none of them is carrying the result.

- **The pad on a recovered landing** is the one real lever: 0.12 m gives 7
  calls, 0.25 gives 9, and the number it gets wrong stays flat across the
  whole range, so it is admitting landings rather than inventing them. Set
  from the measured disagreement between two honest readings of the same
  bounce (6.6 cm median, 26 cm at p90) rather than from the top of the
  range.
- **A hole the rally is seen to continue past** gets a wider pad, because
  a ball that lands out ends the point — so several more alternating
  landings after it prove it was in, with no appeal to a tolerance.
  Sweeping the two pads together is a flat plateau with zero wrong calls
  anywhere on it.
- **The track confidence floor** wobbles: 12 gives 8 right, 14 gives 8
  with one wrong, 16 gives 7 right, 20 gives 5. No plateau, so it is not
  doing real work — it shuffles which points squeak through. Left at the
  low, physically motivated value.
- **Minimum flight length** makes no difference at 3 or 4 and destroys
  everything at 5.

## Two more measured dead ends

**The exit as a terminator.** The plan listed "descending, never resumes,
ball leaves the volume" as an event meaning the ball went out. As a trust
test it is essential. As a rule in its own right it fires 6 times and is
right twice, because leaving tells you the ball went out and nothing about
who sent it there — and the contact that sent it is exactly what the
tracker missed.

**Dropping detected bounces the flights never saw.** The flights find 93%
of confirmed landings, so absence looks like evidence. It fires once
across the corpus and gets it wrong. The 7% they miss are the hard cases,
which is the same 7% a rule would be asked about.

**Recovering bat contacts.** Measured throughout and consistently
negative: contacts are noisier than landings, and a spurious one breaks
the dead-run rule, which ends a run on any racket touch. Off by default.
Julian 51 needs one and does not get it.

## The three points this was written around

- **Julian 79** comes out right, and needed both halves of the design: the
  corner winner's landing recovered at the tail, and an interior hole
  closed by a landing 33 cm past the end line with eight shots played
  after it.
- **Julian 51** is not recovered. The eight-frame hole is bridged by a
  three-frame island at confidence 12, which splits the two flights that
  would otherwise join. What it needs is a recovered CONTACT, and contacts
  measure negative across the corpus.
- **Julian 74** is out of reach and the reason is interesting: the ball
  descends toward Adil with no bounce on his half, and he plays it. He
  volleyed a ball that was going out, which loses the point under a rule
  nothing in this pipeline knows. Reading it needs the laws of the game,
  not a better track.

## What is on the page

A **Repaired** filter chip, a **Put back by the flights** line on every
point row naming what was recovered and when, cyan dashed rings for
recovered landings on the court map, and two new refusal reasons —
"repaired, but the rally still has a hole" and "repaired, but the ball was
never seen leaving" — so the calls the trust tests withheld are
inspectable rather than invisible.

## Still open

- Adil has not watched the nine gained points. The numbers say nine of
  nine; only the video says that for certain.
- **Eleven calls instead of nine, at the cost of one wrong.** Dropping the
  alternation test and keeping only the exit reaches 10 right of 11. This document's bar says no,
  and that is how it was built, but it is Adil's call and not a technical
  one.
- 58 points still get no call. The two largest reasons are unchanged in
  kind: 13 where nothing followed the last landing and 10 where a landing
  is missing from a hole the track has nothing in at all. Eight of those
  holes have no ball detected anywhere near them, which is a BlurBall
  problem and not one this layer can reach.
