# Audio, tried again on the quiet venues — 2026-08-29

The night before, audio bounce confirmation was measured dead and written
into CLAUDE.md. Adil's objection to that verdict was specific and fair:
almost everything had been judged on LYTTC, which is a hall with other
tables in earshot, and the obvious next move was to start with the quiet
rooms instead — PingPod's booths — and to aim at the places where vision
is weakest rather than where it already works.

This is the record of that attempt. One new capability came out of it,
five doors are now closed with numbers behind them, and nothing here is
ready to ship.

---

## The corpora

Venue turned out to be the axis that matters, and it is legible straight
from the database:

| Venue | What it is | Matches used |
| --- | --- | --- |
| PingPod / W37 | enclosed booths, one table in earshot | 7 |
| LYTTC | open club hall, neighbouring tables | 4 |
| Westchester TTC | open club hall, **end-on camera** | 8 |

Westchester is both end-on and busy, so the two are confounded there and
no claim in this document separates them.

**Only source-clock audio can be used for event work.** Where the raw
upload had already been swept from R2 the cut was downloaded instead, and
event times on the cut clock scatter by ±0.45 s point to point — measured,
not assumed, by sliding the events against the audio and looking for the
offset with the most agreement. A constant correction does not fix it.
Six matches were set aside for this reason. Source-clock matches align to
about 10 ms.

Two bugs in the harness were found this way and fixed: the conversion
between the cut and source clocks must subtract `clip_pads.pre`, exactly
as the `point_boundaries` view does, and leaving it out shifts every tap
by 1.2 s — larger than most of the things being measured.

---

## What works

### A knock can be told from the room, and nobody had to label anything

Two piles whose identity is not in doubt:

* **ball** — an audio peak within 45 ms of a bounce or contact that vision
  projected onto the table with high confidence, inside a rally;
* **room** — any audio peak in the space between two point cards, where
  nobody at this table is rallying.

A small logistic regression over fifteen acoustic descriptions of each
knock, trained leave-one-match-out so no match ever grades itself:

| Venue | AUC |
| --- | --- |
| PingPod | 0.82 – 0.88 |
| LYTTC | 0.71 – 0.80 |
| Westchester TTC | 0.48 – 0.64 |

This is the answer to the question Adil asked about distinguishing sound
types, and it is a capability the project did not have. It degrades
exactly where the room gets busy, and at Westchester it is at chance.

**It demonstrably does something.** Finding the start and end of a rally
from the onset train alone works at PingPod and fails at LYTTC; filtering
that train by ball-likeness first closes most of the gap.

| Match | Start within 1 s | End within 1 s |
| --- | --- | --- |
| Ishan (LYTTC), plain train | 6% | 4% |
| Ishan, ball-filtered | **61%** | **44%** |
| Prabhas (LYTTC), plain | 14% | 6% |
| Prabhas, ball-filtered | **67%** | **47%** |

Production already anchors about 75% of serves, so this does not beat what
ships. It is evidence the classifier is real, not a feature.

### The quiet venue is measurably quieter

At three audio peaks per rally second, agreement with production's own
visual events:

| Venue | Audio hears what vision saw | Audio's knocks that vision accounts for |
| --- | --- | --- |
| PingPod | 91% | 51% |
| LYTTC | 80% | 44% |
| Westchester (source clock) | ~50% | ~28% |

Adil's instinct about the venues was right in direction and roughly right
in size.

### A long reference beats a local one, modestly

The previous detector scored each frame against the median and spread of
its own ±0.75 s neighbourhood. During a rally that neighbourhood is other
ball strikes, so a strike is divided by its own neighbours; in a quiet gap
the reference collapses to the room's hiss and a shoe clears the bar.

Same audio, same band, same peak picker, only the reference window
changed:

| Reference | In-play vs gap peak rate | 1.5 s window AUC |
| --- | --- | --- |
| ±0.75 s (previous) | 1.13× – 1.17× | 0.773 |
| 30 s | 1.34× – 1.66× | 0.820 |

Worth having, and worth recording that CLAUDE.md's "1.2 to 1.6" is
reproducible. **It does not overturn the conclusion drawn from it.** An
earlier draft of this document claimed it did, on the strength of AUCs
from a richer feature set; that claim was wrong and the direct comparison
above is why.

---

## What does not work

### Trimming the pad inside a clip — AUC 0.42

This is the important one, because it is the most natural thing to try
next and because the project's own note on dead space names a serve
detector as the blocker for 29% of kept footage.

Restricted to seconds **inside a point card**, labelled rally or dead by
Adil's taps, every audio signal in this study combined reaches AUC 0.42
pooled. Below 0.5 means the pad scores *more* ball-like than the rally.

The explanation is physical and it is the same fact from two directions.
The seconds either side of a point are full of ball-on-table sounds: the
server bouncing the ball before serving, the loose ball afterwards. To a
microphone those are the same event as a rally bounce. The only thing that
separates them is that nobody is hitting the ball with a bat — and:

### Bat versus table — AUC 0.56

The published work (Sony AI, arXiv 2409.11760) separates racket, table and
floor at 0.97 F1. That is with a directional microphone at half a metre to
two metres, in controlled conditions, on a dataset licensed CC BY-NC and
therefore unusable commercially.

Asked to reproduce that distinction from a phone across the room, using
labels the pipeline already owns — it calls an event a bounce or a contact
from the ball's *trajectory*, so sound is not being asked to grade itself
— the answer is AUC 0.39 to 0.67, median 0.56, over 13 matches. Only
loudness carries anything (0.66), and bounces being louder than bat
contacts is not a timbre.

**Do not propose porting the classifier from the paper.** The distinction
does not survive the recording distance.

### Which half of the table — AUC 0.55 to 0.60, and the sign flips

The far end is 2.74 m further from the phone, so its bounces should be
quieter, duller and more reverberant. Measured against production's own
`v` coordinate over 4,300 bounces in 19 matches, the best feature reaches
0.55–0.60 within a match, and the direction **reverses between matches**
(Rowel: near louder, 0.675; Jason: far louder, 0.358). Shot power is the
confound and it is bigger than the distance effect: a bounce on the near
half is a ball the far player hit, and a serve's first bounce is soft and
always on the server's own side.

### The loose ball — real to the eye, at chance as a detector

After a point the ball bounces freely, losing a constant fraction of its
energy each time, so the gaps between its bounces shrink by a constant
ratio. It is plainly visible after a winner tap:

```
0.36  0.31  0.27  0.23  0.21  0.18  0.15   seconds apart
   0.86  0.87  0.85  0.91  0.86  0.83      each gap over the last
```

and 0.86 is where a ping-pong ball's coefficient of restitution puts it.
A rally cannot make this shape, because players set the tempo.

It still does not work. Runs of four gaps that decay inside a ratio band
happen constantly by coincidence in a train carrying three knocks a second
of which half are room. Against the same detector run over the peak list
slid 7.31 s along the clock, the lift is +0.04 to +0.10 at every setting,
and — the decisive check — the decay ratios of trains landing on a real
point end are **identical to the shifted control**: 0.840 vs 0.840, 0.826
vs 0.828, 0.804 vs 0.804.

Recorded because it is a genuinely attractive idea and someone will have
it again.

### The serve's own shape — AUC 0.64 to 0.78

A serve is the one stroke with two bounces and no bat between them, which
should read as a figure in the timing of the knocks. Against mid-rally it
separates at 0.73–0.91; against the pad immediately before it, which is
the only comparison that would be useful, 0.64–0.78. The serve tap ruler
is itself only good to about 0.7 s, so part of that ceiling is the ruler.

### Rallies with no card — 8 minutes across 14 matches

The in-play track lights up on 91–99% of existing cards at PingPod. The
stretches it flags that have no card at all total eight minutes across the
whole corpus, most of them short. Not a source of missed points.

---

## Where this leaves audio

The shape of the problem has not changed, but it is now stated more
precisely than "audio is dead".

Audio hears nearly every ball event — 91% of what vision sees, at PingPod.
It cannot say **where** the ball was, and the two proxies for position
that a single microphone might have offered are both measured out: which
half of the table (0.57) and what struck it (0.56). What it can say is
whether a knock sounds like this table's ball rather than the room (0.85
in a booth), and that is genuinely new — but every job the product
actually needs turns out to hinge on position or on the bat/table
distinction rather than on ball/room.

The one untried thing with a plausible mechanism is feeding the
ball-versus-room score into placement as `audio_confidence`, in place of
the raw local z-score the previous study fed it. The `wrong_half` and
`first_bounce_wrong_half` family is 12% of serves and is, by construction,
placement choosing the wrong candidate — which is the one failure a better
prior on "is this a real ball" could move. It is not expected to touch
`no_landing`, which is 15% and is off-table projection.
