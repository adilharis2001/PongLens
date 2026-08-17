# When a point is over, and why the junk is junk

2026-08-16. Adil, after scoring two games each on the new pipeline's Prabhas
and Chris matches:

> There is a lot of spillage over when a point ends that doesn't really get
> effectively cut.
>
> For all the points that are deleted, I'd be really surprised if you tell me
> that we weren't able to delete that footage up front by looking at things
> like net crossings and players in position and things like that.

He is right on the second one, and the first one turns out to have a
different cause than it looks like. The two are also the same problem: half
of every card he deletes is the spillage from the point next to it.

Code: `TTVid/recall-lab/s13_ends.py`, `s14_rules.py`, `s15_presence.py`,
`s16_presence_eval.py`. Nothing here has been changed in production.

---

## What counts as evidence

Two ground truths, both already in the database, neither of them a detector
output:

| | |
|---|---|
| `points.deleted` | he watched the card and called it junk |
| `points.scored_at_cut_s` | the moment he pressed the winner key |

Three corrections had to be made before any of it meant anything.

**Only reviewed cards count.** A card in a half-scored match is not a real
point, it is an unread one. Counting those as real understated every veto's
cost by a factor of three — the crossing veto looked like it cost 12% of real
points and actually costs 0.6%. A card counts only if he deleted it or scored
it, and a match only up to the last card he reached.

**The end he watches is the padded end.** `t1` is where the detector stopped;
the player runs to `t1 + clip_pads.post`. Production pads by 1.3s and the
shadow matches by 0.4s, so comparing raw `t1` across them compares two
different things.

**Tripp is excluded.** Adil: "the camera was in the wrong position to begin
with. It was always going to be hard for any of the pipelines." It was
supplying six of the eight counterexamples to the crossing veto, and tuning
around it would have been tuning around a camera placement. It reappears at
the end as the thing a shipped rule has to notice by itself.

Corpus: prabhas_rc, chris_rc, ishan_rc, ishan, chris_a, chris_b — 521 cards
with a table found, 200 without.

---

## His taps are accurate

Everything below rests on the winner tap being a fair marker for the end of a
point, so it was checked against the one event both he and the detector mark.
The detector's serve contact is first bounce − 0.81s, a physical constant
rather than something fitted to him, and across 140 serve taps:

| | p10 | median | p90 |
|---|---|---|---|
| his tap − detected contact | −0.66s | **−0.05s** | +0.37s |

No systematic lag. He anticipates rather than reacts, and can be up to 0.7s
**early**. That last fact sets the safety margin for everything that follows:
an end landing half a second before his tap is not necessarily safe.

---

## Where a point actually ends

Against his 472 winner taps:

| | median | p90 |
|---|---|---|
| tap − last net crossing | **1.7s** | 2.6s |
| tap − last bounce on the table | **1.1s** | 2.3s |

Remarkably stable: the per-match medians run 1.4–1.9s for crossings across
two venues and four matches. **A point is over about a second after the last
bounce on the table, and the last net crossing is a hard floor under it.**

Now the spillage. Padded card end minus his tap:

| cards | p10 | median | p90 |
|---|---|---|---|
| production | −0.0s | 0.8s | 4.0s |
| new pipeline | +0.5s | **1.8s** | 4.0s |

The new pipeline shows a second more dead time at the end of every point than
production does, and its cards are longer throughout: median 5.3–6.1s against
production's 3.0–4.0s.

### It is two different faults, not one

Splitting the new pipeline's spill into the rule and the constant:

| | p10 | median | p90 |
|---|---|---|---|
| rally end − his tap | −1.2s | **+0.1s** | +2.3s |

Every card ends at `rally_end + TAIL_S` and the player adds the post pad, so
**1.7s of tail is unconditional**. The rally end itself sits within a tenth of
a second of his tap at the median.

So the median spillage is not the detector overrunning. It is the constant.
The p90 is the detector overrunning: on 36% of points the rally end runs more
than a second past his tap, and Prabhas is much worse than Chris (p90 +4.5s
against +1.8s) because dense ball motion carries on through ball retrieval.

Two separate fixes, and only the second one is interesting.

**Cut the constant.** 1.7s is longer than a point needs to breathe. His taps
can be 0.7s early, so about 1.0s is the floor; that saves 0.7s on every point
in the library.

**Cap the overrun.** `end := min(end, last on-table bounce + K)`, which can
only shorten a card:

| K | bites | ends before his tap | saved, median | worst pull-back |
|---|---|---|---|---|
| +2.5s | 45% | 14.9% | 1.2s | 0.9s |
| +3.0s | 32% | 8.1% | 1.1s | **0.4s** |
| +3.5s | 23% | 5.4% | 0.9s | 0.2s |

Restricting to bounces on the playing surface matters: retrieval bounces land
on the floor beside the table, so the on-table list stops exactly where the
point does. Anchoring on any in-corridor bounce saves half as much at the same
risk.

`+3.0s` takes 24 seconds out of 74 points and never pulls an end back more
than 0.4s before a tap that is itself unbiased. Combined with the shorter
constant, median spill goes from 1.8s to about 1.0s and the p90 from 4.0s to
about 2.4s.

---

## Half the junk is spillage that grew a card

Every deleted card, classified by what is next to it:

| | share |
|---|---|
| **tail** — starts within 3s of a real point ending | **49%** |
| **lead** — ends within 3s of a real point starting | 21% |
| between — in a gap, touching neither | 27% |
| isolated — nothing within 3s either way | 2% |

**70% of the junk is the head or tail of a neighbouring point**, not an
independent false positive somewhere quiet. On the new pipeline's Prabhas
it is 69% tails alone, against production's 52% on the same video.

This is the join between his two complaints. The spillage does not only make
points longer; often enough it becomes another card, which he then has to
watch and delete. Fixing the end fixes both.

---

## The crossing veto he guessed at

He guessed that net crossings should have caught the junk up front. They
would have.

Where the table is found, **97–100% of his real points contain at least one
net crossing**, and **72% of his deletions contain none**.

Searched over every conjunction of up to three clauses, ranked by the junk
killed at each cost in real points:

| real points lost | junk killed | rule |
|---|---|---|
| **0 of 336** | **97 · 52%** | no crossing **and** both ends never busy |
| 1 · 0.3% | 130 · 70% | no crossing and fewer than 5 bounces |
| 2 · 0.6% | 133 · 72% | no crossing |

On the new pipeline's own cards, where the sample is smaller and the cards
are cleaner:

| real points lost | junk killed | rule |
|---|---|---|
| **0 of 76** | **33 · 75%** | crossing chain < 2 **and** no bounce alternation |

That is a junk rate of 37% falling to 13% with no real point touched.

In footage: the crossing veto removes 393 seconds of junk across four matches
and 7 seconds of real play.

### Where it does not work

Matches with no table calibration have no crossings, no bounce sides and no
serve motifs — every ball signal in the system is downstream of the
homography. The best rule costing no real points there kills **15%** of the
junk, against 52% where the table is known. One match in four lands here.

### A shipped veto has to notice tripp by itself

Tripp's real points carry a crossing only 79% of the time, so the veto would
have cost six real points there. The obvious self-check is circular:
serve-anchored cards are selected for having good ball evidence, and they
report 97% on tripp against a truth of 79%.

The check that does work is pure geometry, available at calibration time with
no labels at all. A table is 2.74m long and 1.525m wide, so it should project
longer than it is wide:

| match | on-screen length ÷ near-edge width | ÷ 1.80 | real points with a crossing |
|---|---|---|---|
| chris_rc | 2.50 | 1.39 | 100% |
| chris_a | 1.89 | 1.05 | 99% |
| prabhas_rc | 1.33 | 0.74 | 100% |
| ishan_rc | 1.30 | 0.72 | 100% |
| **tripp_rc** | **0.50** | **0.28** | **79%** |

Tripp's table appears three and a half times shorter than it is. The camera
is nearly square-on to the table's length, so the whole near/far separation
the crossing test depends on is compressed into a few pixels. This is the
same fact Adil already knew from watching it — "the camera was in the wrong
position" — arriving as a number, which means it can gate the veto, and it
could warn a user at upload.

Five matches is not a validated threshold. It is a principled measure rather
than a fitted one: it is the geometry that makes the crossing test work.

---

## Players in position: measured, and it does not work

The other half of his intuition was worth a real detector, because it is the
only idea in the list that does not depend on the ball, and therefore the
only one that could survive a match with no table. So one was built:
`s15_presence.py` runs a person detector twice a second over the whole video
and places every person along the table's own axis.

Two false starts are worth recording. Projecting a person's feet through the
table homography puts both players somewhere on the table surface, because
feet are on the floor three-quarters of a metre below the plane the
homography maps — that version reported both ends occupied for 3% of a match.
And "the far player is higher in the frame" is false: these cameras sit beside
the table as often as behind it, and chris_rc's quad runs diagonally across
the picture.

With that fixed and the zones swept over every combination of lateral
corridor, size floor and depth limit, the answer is flat:

| | real points | deleted cards |
|---|---|---|
| both ends occupied for the **whole** card | 46% | **41%** |
| an end empty at some moment | 54% | 59% |
| an end empty for more than 2s | 23% | 29% |

**41% of the junk has both players standing at their ends for the entire
card.** They do not leave. Between points they are waiting to serve, picking
the ball off the table, or discussing the score, and when a ball does go
long the receiver stays put while the server fetches it — so an end stays
occupied either way.

As a veto on its own, at every threshold tried, the strongest rule costing no
real points kills **10%** of the junk. As a third clause on top of the
crossing rule it lifts the zero-cost kill from 52% to 59%, which is real but
does not justify a person detector over every upload.

As an end-of-point marker it is worse. The moment an end first goes empty,
measured against his winner tap:

| p10 | median | p90 |
|---|---|---|
| −6.2s | −0.6s | +3.5s |

A ten-second spread, and it fires mid-rally as often as after one, because
the detector loses a lunging or occluded player.

### One player, not two: the sharper version of the question

Adil, reading the above, aimed it better:

> After every point, one player typically goes to go get the ball from their
> side or wherever. During those times, the player is not there, and the
> point is not active.

That is a specific state — exactly one end empty while the other player
waits — and the binary above had collapsed it away. `s17_one_player.py` puts
every half-second into one of four states instead.

First, the detector's own error floor. During a rally both players are at
their ends by definition, so anything but "both" there is a miss. Raw, that
floor was 12%, which is the same size as the effect being looked for. Closing
holes shorter than a second — a player does not vanish for half a second —
brings it to 8%, and the numbers below use that.

**The mechanism is real.** Per half-second of video, share reading "exactly
one end empty":

| | one end empty |
|---|---|
| during the rally (the detector's floor) | 8% |
| 1–3s after his winner tap | **38%** |
| 6s after his winner tap | 21% |

A four-and-a-half-fold rise the moment a point ends, decaying as the next one
sets up. By gap length, between one real point and the next:

| gap | one end empty |
|---|---|
| under 3s | 20% |
| 6–12s | 37% |
| over 12s | 35% |

And per card, the split he asked for, on matches with a table:

| | both ends | exactly one | neither |
|---|---|---|---|
| his real points | 83% | 16% | 1% |
| cards he deleted | **58%** | **36%** | 6% |

A deleted card spends more than twice as much of its life with one end empty.
He is right about what happens.

**It is still not a usable filter, and the reason is in the same table.** Even
in gaps longer than twelve seconds — where somebody is definitely fetching a
ball — both ends are occupied 57% of the time. The ball usually does not go
far. The player retrieving it stays inside their own end zone, and the other
player does not move at all.

So at the card level the distributions overlap where it matters:

| rule | kills junk | costs real points |
|---|---|---|
| one end empty ≥90% of the card | 14% | 1 · 0.3% |
| one end empty ≥80% | 18% | 3 · 0.9% |
| no crossing **and** one end empty ≥20% | 39% | **0** |
| no crossing **and** both ends never busy *(motion only)* | **52%** | **0** |

The last row uses s5's frame differencing, which is already computed and
costs nothing. **Presence is dominated by a signal we get for free.**

**Do not build this.** The hypothesis was reasonable, it describes something
that genuinely happens, and it is now closed: what happens is not rare enough
in real points nor common enough in junk to separate them. The detector and
its cached output stay in the lab so nobody pays for the answer twice.

---

---

## A better ground truth, and what it overturns

Everything above judges a card by whether Adil kept it. He pointed out that
a much stronger label already exists and was going unused:

> In a whole bunch of matches, you have the serve starts and those taps
> indicating the serve ends as well... you know the times at which the points
> start and the times in which the points end. It would be great if you are
> able to just port over those timestamps and generally leverage that as a
> source of truth.

Both taps sit on the **same point row** — `serve_start_at_cut_s` from
migration 089 and `scored_at_cut_s` — so a row carrying both hands over an
exact start and an exact end, drawn by a human, owing the detector nothing.
**292 such points across seven matches.** `s18_taps.py`.

Six of the seven have lab evidence and carry 278 points after six mis-taps
are dropped for describing a rally shorter than 0.7s or longer than a minute.
Kumar was pulled in for this and is the fourth match in the corpus with no
table calibration, which is where the corpus was thinnest.

This is better than `deleted` in three ways. It bounds a point at both ends,
so the head can be checked at all — it never had been. It is stored against
the whole cut rather than clamped to its card, so it can land outside the
card that owns it, which is the case that matters. And it charges a veto for
losing a *point* rather than for losing a card, which is not the same thing
when two cards cover one point.

### What it says

**A real point is 3.8 seconds long** (p10 2.6s, p90 5.6s).

Dead footage around it, on the padded window he watches:

| | head | tail | point | shown |
|---|---|---|---|---|
| production | **1.8s** | 1.0s | 3.8s | 6.6s |
| new pipeline | 1.3s | **2.2s** | 3.8s | 7.3s |

**The head was the larger waste all along, and nobody had looked.** Production
shows nearly twice as much video before a point as after it. The new pipeline
has already fixed the head — it anchors on the detected serve — and lost the
same footage again at the tail.

That head anchoring is sound. Against his own serve taps, the detector's
serve contact lands at **median +0.04s, p10 −0.37s, p90 +0.60s.** It is not
approximately right, it is right.

Coverage, measured properly for the first time: **no true point is missing
from either pipeline**, and none is meaningfully clipped. Some cards do end a
hair before his tap — 9 to 16% of points — but by a median of 0.01–0.12s and
never more than 0.36s. That is his thumb, not a defect.

### The correction

**Shortening the tail padding would cut the end off real points.** Adil was
right to be nervous, and the tap pairs prove it where the earlier work could
not. Reducing `TAIL_S` from its present 1.3s:

| `TAIL_S` | ends before his winner tap | worst |
|---|---|---|
| **1.3s (today)** | 1 of 58 · 1.7% | 0.04s |
| 0.9s | 4 · 6.9% | 0.44s |
| 0.7s | 6 · 10.3% | 0.64s |
| 0.5s | 7 · 12.1% | 0.84s |
| 0.3s | 9 · 15.5% | 1.04s |

The earlier recommendation to take the constant from 1.7s to about 1.0s would
have taken up to a second off the end of one point in eight. **It is
withdrawn.** The reasoning behind it was that production's tail is 1.0s and
he has never complained about it, but production reaches that by having its
raw end sit slightly *before* the tap and a 1.3s pad rescue it — which is not
a shorter tail, it is the same tail measured from somewhere else.

The tail cap survives, barely. `end := min(end, last ball event + 3.0s)`
clips three more points than the cards already do, by at most 0.36s, and
saves 0.36s per point. Safe, and small.

### The veto, charged properly

Scored against true points rather than kept cards:

| rule | cards cut | of which he deleted | **true points lost** |
|---|---|---|---|
| no crossing | 123 of 412 | 122 | **0 of 201** |
| no crossing and both ends never busy | 90 | 90 | **0 of 201** |
| crossing chain < 2 and no alternation | 126 | 123 | 3 · 1.5% |

The plain crossing veto cuts 123 cards, and 122 of them are cards he had
already deleted by hand. It costs nothing at all.

---

---

## Postscript, 2026-08-17: the gap was calibration all along

Everything above concluded that the match with no table was the biggest
structural gap, and that the point pipeline was better than production where
the table was found and worse where it was not. Both held. What was not
obvious is how much of the whole problem that one gate was holding.

The keypoint detector was re-run over the five matches in the corpus with no
table or a suspect one. **All five answered, on the local detector, in about
ten seconds each, with no paid call** — including four that had previously
been abandoned entirely, and Gavin, whose quad had come from the paid
escalation.

That last one is worth stating plainly: **the free local detector produced a
better quad than the paid one.** "Most expensive" had been treated as "most
accurate" without anyone measuring it, and on this match it is not.

Serve detection against his taps went from **76% to 90%** — Kumar from 37% to
95%, Ishan from 64% to 96% — with the false-serve rate falling at the same
time. And the pipeline comparison stopped being conditional:

| | lost | whole | split | head | tail | shown | junk |
|---|---|---|---|---|---|---|---|
| production | 0 | 91% | 8% | 1.8s | 1.0s | 8.0s | 37% |
| **the new pipeline, recalibrated** | **0** | 91% | **2%** | 1.8s | 1.5s | **7.3s** | **32%** |

A quarter as many points needing a manual join, half a second less dead video
per point, five points less junk, nothing lost. The only remaining regression
is the tail.

**None of that came from tuning the point pipeline.** Every constant in it was
already searched against his boundaries and had stopped yielding. The gain
came from fixing the thing upstream that every ball signal depends on, which
is the lesson worth keeping: when a system's quality splits cleanly on one
gate, work the gate.

---

## What to do

In order of measured value, revised after the tap pairs.

1. **Add the crossing veto**, gated on the table's foreshortening. It removes
   whole cards and never shortens one, so it cannot clip a point — and
   charged against his 201 tap-defined points it loses none. 122 of the 123
   cards it cuts are cards he deleted by hand.

2. **Cap the tail** at last ball event + 3.0s. Small and safe: three points
   trimmed by at most 0.36s, 0.36s saved per point.

3. **Leave the padding alone.** Withdrawn, see above.

4. These compound with 1. 70% of the junk is the head or tail of a
   neighbouring point, so a tighter end deletes junk cards as well as dead
   seconds.

5. **The match with no table is the biggest structural gap.** One upload in
   four, no crossings, no bounce sides, no serve motifs, and the best veto
   that costs nothing kills 15% of its junk. Presence was the candidate
   rescue and has failed. The work is either fixing calibration on those
   matches or finding a crossing test that does not need it.

Not addressed here, but visible in the data: the new pipeline emits three
cards over 15 seconds on prabhas_rc, one of them 24.3s, which is the card
Adil split by hand. Production emits none. Long fused cards are a separate
defect from spillage and are not fixed by anything above.
