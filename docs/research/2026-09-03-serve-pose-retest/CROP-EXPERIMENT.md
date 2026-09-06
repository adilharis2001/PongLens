# The crop experiment: why a better ball track made the emergence rule worse

Date: 2026-09-03. Match: 89b35ee0 Yu Yu Lin, Westchester TTC, 93 scored
cards, keypoint calibration, **87 cards labelled by Adil**.

## Result

Cropping works. It raises ball tracking 15% and, crucially, makes the ball
visible **before** the serve — which is exactly what destroys the emergence
rule, because that rule fires on the ball being ABSENT.

| ball detected over the table in the 1.35 s BEFORE a confirmed serve | |
| --- | --- |
| uncropped | **0 of 49 serves (0%)** |
| cropped | **34 of 49 serves (69%)**, 3.5 frames each |

The emergence rule's signal was the tracker losing the ball. A held ball is
not blurred, BlurBall needs blur, so before a serve there was silence — and
the rule detected the end of that silence. Crop the frame, the ball gets
2.1x bigger, the held and tossed ball becomes detectable, the silence goes,
and with it the signal.

Scored on the 49 serve times Adil confirmed, first flash only, at matched
firing rates (~1.3 flashes per card):

| run | first flash lands on the serve |
| --- | --- |
| uncropped | 48/49 — **circular, ignore it** |
| cropped | **22/49 (45%)** |

The uncropped number cannot be read: those 49 timestamps were *defined* as
"the uncropped run's first flash was right", so it cannot lose against them.
The cropped 45% is a real measurement against real serve times.

## What this does NOT mean

It does not mean cropping is bad. It means **the emergence rule was a
workaround for not being able to see the ball**, and the workaround stops
working once you can.

With the crop on, the ball is visible during the toss on 69% of serves.
That makes a directly observable rule possible — the ball rising near the
server and then descending onto the table — which was not available before
and is a stronger signal than an absence. That rule has not been built or
measured.

## Phase 0: the both-players crop is not viable, and is not needed

Measured from RTMDet person boxes already computed on three matches.

| match | production's crop | ball gain | table + both players | ball gain |
| --- | --- | --- | --- | --- |
| Yu Yu Lin (Westchester) | 22% of frame | **2.1x** | 71% of frame | **1.0x** |
| Lester (Pingpod) | 40% | 1.6x | 59% | 1.3x |
| PingPod W37 | 30% | 1.8x | 54% | 1.4x |

At Westchester a box holding both full bodies spans the whole frame width
and gives no magnification at all — 80% of player boxes fall outside the
shipped crop, because the camera is far back and the players stand well
behind the table. The two goals are in direct conflict.

They do not need reconciling: the emergence rule never uses a player, and
the pose thread is closed. So the shipped crop, unchanged, is the right
box — and this needed no new crop logic.

## Adil's labels, which are the ground truth for all of the above

87 of 93 cards judged. Saved as `adil-verdicts-89b35ee0.json`.

| | flash found the serve | flash missed it | rate |
| --- | --- | --- | --- |
| cards where production found NO serve | 16 | 2 | **89%** |
| cards production already handles | 39 | 27 | 59% |
| all | 55 | 29 | 65% |

**89% on the cards the shipped bounce rule gives up on.** That is the
result that makes this line of work worth continuing, and it came from
review rather than from inference — an earlier estimate of "roughly half",
made by looking at where flashes landed inside the card, was wrong.

Of the 29 misses: 17 had no flash at all, 12 had one in the wrong place.

## The toss rule the crop was supposed to unlock — first pass fails

The ball being visible before the serve does not, on its own, make the
serve visible. Coded as "the ball rose off the table, peaked, then arrived
over the table" it produces **2.5 candidates per card**, and the rise
threshold does nothing — 303 candidates at 24 px against 323 at 6 px.
Mid-rally the ball is bouncing constantly, so almost every arrival over the
table is preceded by an up-then-down.

Rather than keep tuning, the separation was measured directly: the 1.35 s
before each of the 49 confirmed serves, against a mid-rally window 4 s
later, same features both sides.

| feature | pre-serve | mid-rally | ratio |
| --- | --- | --- | --- |
| vertical range | 270 px | 288 px | 0.94 |
| horizontal range | 516 px | 512 px | 1.01 |
| verticality (rise / horizontal) | 0.53 | 0.54 | **1.00** |
| share of frames over the table | 0.09 | 0.08 | 1.15 |
| median speed | 9.74 | 5.46 | 1.78 |

Everything is flat except speed, and that is the wrong way round for a toss
— the pre-serve window is FASTER, because it contains the strike. So the
ball's path before a serve is not distinguishable from its path mid-rally
on any of these. Seeing the ball is not the same as seeing the serve, and
this line needs a different feature or a different signal, not a better
threshold.

## Method notes worth keeping

- **The trim clock was verified, not assumed.** The cropped run was aligned
  against the uncropped track by sliding one over the other; best overlap at
  lag 0.0 s. Without that check every number here would have been suspect,
  since `-ss` on a stream copy lands on a keyframe rather than a second.
- **A recovery-only metric is worthless.** An early sweep showed "recovers
  29 of 29" at 4.4 flashes per card — a strobe wins that metric. Every
  reading here is at a matched firing rate near one flash per card, which is
  what a card holding one serve deserves.

## Files

`scripts/phase0.py` (crop geometry vs player positions), `phase1.py`
(verdicts to a scoring set), `phase2_crop.py` (trim, crop, re-detect,
shift back), `phase2_fair.py` (the scoring above), `emerge.py` (the rule).
