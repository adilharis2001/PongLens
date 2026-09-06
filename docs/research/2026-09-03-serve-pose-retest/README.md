# Serve detection from player pose, retested with the v2 person detector

Date: 2026-09-03. Two runs: the July 2026 service-motion cohort re-scored
with better person boxes, and a first measurement on a real recent match
with keypoint calibration and the owner's own scoring as truth.

## Result

**On the July clips the better boxes nearly doubled coverage. On a real
match pose names the server barely better than guessing.** Both are true and
the second one decides it.

| | coverage | precision |
| --- | --- | --- |
| July 42, v1 boxes (as reported 2026-07-30) | 43.6% | 94.1% |
| July 42, v2 person boxes | **76.9%** | 86.7% |
| **Yu Yu Lin, 93 scored points, v2 boxes** | **73.1%** | **54.4%** |
| — the same match, always answering "near" | 100% | **50.5%** |

Pose beats the majority-class baseline by 3.9 points on the only corpus
where the calibration is current, the truth is the owner's own, and the
class balance is even (47 near / 46 far). That is not a detector.

It is also **confidently** wrong: the wrong answers on the unanchored arm
carry confidences of 0.89 to 0.96.

## Why the July number does not transfer

The July cohort was 42 points chosen to be hard (23 occluded contacts, 10
known wrong-server calls, 9 controls) across 5 matches, anchored on the
owner's own hand-labelled first bounce, and scored against a truth field
stored with the labelling assignment. The real-match run is 93 consecutive
scored points from one match, anchored on the shipped serve rule's own mark
where it has one, and scored against the ITTF rotation.

The honest reading is that the July corpus does not predict production
behaviour, in either direction. It was built to be hard and it is small.

## Two corrections to the record

**1. July never measured pose without a ball anchor.** The ablation named
`unanchored_pose` in `service-motion-holdout-scored-20260730/results.json`
is not pose. It is `worker/serve_detection.py`, whose docstring says it
selects a serve "from side-neutral placement reconstruction evidence" and
"knows nothing about ... player identity". Its 54.5% precision is the BALL
rule's server call, not pose's. The name is misleading and was taken at face
value in conversation before it was traced. The unanchored arm below is the
first measurement of pose with no ball anchor at all.

**2. The July harness fed pose a table quad that was off the picture.**
`calibration.table_corners_px` is stored in whatever space the calibrator
ran in and `calibration.size` says which — except when it is null, which
means SOURCE pixels. `_scaled_corners` in `run_service_motion_experiment.py`
reads `size or [clip_w, clip_h]`, so a null size silently means "already
clip space" and a 1920x1080 quad is applied to a 720x406 clip. This is the
documented corner-scaling trap and it fails silently: the quad leaves the
frame, every person measures as too far from the table, and the run reports
no players rather than an error. Reproduced here on the first attempt — 34
of 42 clips found zero players. `scripts/corners.py` is the fix.

## What changed between the two box regimes

July asked for two boxes derived from table geometry alone
(`build_player_regions`): each **52% of the frame's width by 85% of its
height**, centred beyond an end of the table. Half the room per box, handed
to a top-down model that returns a pose for whatever box it is given — which
on side-on footage returned poses of televisions and posters (measured
2026-08-26, and the reason `extract_side_changes_rtmpose` v2 exists).

v2, reused verbatim here: detect real people with RTMDet, keep those within
1.1x their own height of the table quad, take the biggest as NEAR and the
biggest one overlapping the table as FAR. Measured 92% / 74% against 144
hand-labelled frames.

Effect on box availability, July cohort:

| | clips with no player found | median share of player slots filled |
| --- | --- | --- |
| broken corners (as July ran) | 34 of 42 | 0% |
| corrected corners + v2 | 0 of 42 | **99%** |

## The July control in full

`july-control.txt`. 39 of 42 clips are scorable — three carry no labelled
first bounce.

| stratum | n | July cov / prec | v2 cov / prec |
| --- | --- | --- | --- |
| visible (controls) | 9 | 44.4% / 100% | 66.7% / 83.3% |
| **occluded** | 22 | 54.5% / 91.7% | **77.3% / 94.1%** |
| previously-wrong-server | 8 | 12.5% / 100% | 87.5% / 71.4% |
| pooled | 39 | 43.6% / 94.1% | 76.9% / 86.7% |

Twenty-two cases moved from abstaining to a confident call and 17 of those
were right. On the occluded group — the largest, and the one the cohort was
built around — v2 is better on both axes at once.

**The gate, set before the run:** hold precision at or above 90% while
lifting coverage, with 60% coverage a clear win. Coverage cleared
decisively; precision missed at 86.7%.

**The calibration confound went the other way.** Two of the five matches
(Chris, Gui) still carry the retired pink-rim quad; this was flagged in
advance as a likely explanation for any precision loss. It is not:

| calibration | n | July | v2 |
| --- | --- | --- | --- |
| keypoint (recalibrated) | 30 | 43.3% / 92.3% | 76.7% / **82.6%** |
| pink-rim (retired) | 9 | 44.4% / 100% | 77.8% / **100%** |

The precision drop is entirely in the good-calibration group. n = 9 on the
pink-rim side, so this is noise as much as anything, but the bad quads
cannot be blamed for it.

## The real match

**89b35ee0, Yu Yu Lin, Westchester TTC, 2026-08-29.** Chosen over the Anton
matches, none of which are scored — all seven have zero confirmed winners,
so they carry no server truth at all.

- 93 of 93 cards scored, **zero server overrides**.
- Calibration: keypoint detector, **11 of 11 frames agreeing, 1.7px spread**.
- Truth: `computeServing` — the product's own ITTF rotation over the owner's
  scoring — mapped to near/far through `matches.user_side`. Imported, never
  re-derived. All 93 points get a server.
- Class balance 47 near / 46 far.
- 73 cards carry a serve mark; **20 do not**.

| | coverage | precision |
| --- | --- | --- |
| **anchored** (73 cards, the ball rule found the serve) | | |
| — ball rule's own server call | 49.3% | 58.3% |
| — pose (v2 boxes) | 65.8% | **52.1%** |
| **unanchored** (20 cards, no serve found) | | |
| — ball rule | 0% | — |
| — pose (v2 boxes), 17 windows scanned each | 100% | **60.0%** |
| pooled pose | 73.1% | 54.4% |
| always answering "near" | 100% | 50.5% |

The unanchored arm is 12 of 20. At n = 20 that is not separable from chance.

**The ball rule's own server call is 58.3%**, which corroborates the
standing finding that there is no independent server read in this pipeline
and is why production stores the rotation's answer rather than a detected
one. `points.server_side` is null on all 128 cards of this match.

### Checks that the result is not a harness bug

- Truth is balanced, 47 / 46.
- **Flipping every pose answer makes it worse**, 54.4% -> 45.6%. There is no
  systematic near/far inversion.
- The truth sequence runs in clean two-serve blocks.
- Pose and the ball rule agree with each other on 72.7% of the cards where
  both fire, while each sits near chance against truth — two weak signals
  that correlate, not one strong one.
- The review page was inspected by eye on wrong cases: on card #11 the near
  player is correctly boxed and skeletonised, the far player likewise, the
  quad is on the right table, and pose still answers "far" against a truth of
  "near". The machinery is right and the signal is wrong.

## The review page

`scripts/index.html` + `scripts/app.js` + `scripts/build_real_page.py`. One
card per scored point, grouped by arm, drawing the table quad, every person
the detector found with the verdict `choose_players` gave them, the pose
skeleton returned for the two chosen, the ball, and the three answers
(rotation truth, ball rule, pose).

Serve it with `scripts/serve.py <port> <dir>` and not with
`python -m http.server`: the latter ignores HTTP Range, so `<video>` reports
`seekable = [0, 0]`, every `currentTime` assignment is silently dropped, and
the page looks like a broken overlay rather than a broken server. That cost
a debugging cycle here.

## What this did NOT test

No new rule was invented here. `analyze_service_motion` is July's code, run
unchanged; only the person boxes changed. And that rule is, in substance, a
TOSS detector plus a ball tracker. Its score is six terms out of 5.8 against
a threshold of 3.0:

    toss_rise      1.2      the tossing hand rises
    toss_up_speed  0.8      it rises fast
    racket_range   1.0      the racket hand moves
    nearest_ball   1.0      the ball passes close to a wrist
    ball_rise      1.0      the ball rises
    departure      0.8      the ball leaves

**2.0 of 5.8 come from the toss and 2.8 require the ball.** Exactly one
point, `racket_range`, is body motion independent of both. So this run
measures a toss-and-ball rule with better boxes. It does not measure the
idea it was commissioned to test: both players still, then one of them
erupting — no toss assumed, because not every player tosses high.

The July study itself measured that stillness signal and found it strong —
receiver trunk energy 1.42 before a serve against 4.77 in dead time, a 3.4x
separation — but used it only as a GATE on the toss detector, never as the
detector. Nothing has ever been built on it directly.

The ball was NOT the limitation here: the unanchored windows carry a median
14.8 ball detections per second, and none were empty. These cards have ball
data; the two-bounce pattern simply does not fit them (the refusal census
says `pair_too_far_apart`, `same_side_of_net`, `travelled_backwards`). That
is a different population from the windows where a point got no card at all,
where the ball genuinely is missing.

## Recommendation

**Do not pursue serve detection via the July service-motion rule.** The measurement that
matters is the real match, and there pose is 3.9 points above always
answering "near", while being confidently wrong when it errs. Better person
detection genuinely fixed what it could fix — box availability went from 0%
to 99% on a third of the July clips — and the remaining failure is the
service-motion signal itself, not its input.

What survives:

- The **box fix is real and reusable**. Any future work that hands RTMPose a
  box should use `choose_players`, never `build_player_regions`.
- `scripts/corners.py` should be the only way a clip's quad is resolved in
  research code. The trap has now cost two studies.
- The unanchored arm is measured for THIS RULE only: **July's service-motion
  rule cannot rescue a card the ball rule gave up on** — 12 of 20, at high
  confidence, on the best calibration in the corpus. That is a narrower
  claim than "pose cannot", and the difference matters — see below.

What is NOT closed, and was not tested here: whether player position can
answer the different and easier question of *whether a point happened at
all* in a stretch of video, which is what
`docs/research/2026-09-03-missed-serve-cost/` says actually costs points.
That is a binary over a ten-second window, not a near/far attribution at a
single instant, and nothing in this run speaks to it.

## Files

| file | what it holds |
| --- | --- |
| `july-control.txt` | the July 42, v1 boxes against v2, per stratum |
| `real-match.txt` | Yu Yu Lin, per arm, pose against the ball rule |
| `real_scored.json` | per-card truth / ball / pose for the real match |
| `scripts/corners.py` | the quad resolver; the fix for the scaling trap |
| `scripts/boxes_v2.py`, `pose_v2.py`, `score.py` | the July control |
| `scripts/real_boxes.py`, `real_pose.py`, `real_score.py` | the real match |
| `scripts/truth.mjs` | `computeServing` over the corpus, for server truth |
| `scripts/peek.py` | one annotated frame per match, for checking the quad |
| `scripts/index.html`, `app.js`, `build_real_page.py` | the review page |
| `scripts/serve.py` | static server with Range, needed for video seeking |
