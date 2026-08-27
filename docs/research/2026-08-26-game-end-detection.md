# Game-end detection from player side changes — 2026-08-26

For an unscored match, detect that a game most likely ended between two
points, and show a small "Game end detected" divider there — in the
point breakdown and in Keep score. Nothing else: no scores, no game
numbers, no winners, no effect on point detection or any downstream
logic. The event primitive is deliberately a generic SIDE CHANGE so
later features can build on it without re-detection.

## What already existed, and what happened to it

A full version of this shipped on 2026-07-29 (RTMPose match structure,
migration 051) and was rolled back the next day. The post-mortem matters
more than the rollback: the stored production artifacts are both
`status: "failed"`, and worker.log shows why — `match JSON has no usable
table calibration`. In July, calibration was the pink-rim detector
(0.5–7.6% venue success); the stage's prerequisite almost never existed.
The calibration ladder that fixed this shipped 2026-08-16. The pose
extraction itself was never the failure.

v1's second flaw only became visible when v2 was measured against real
footage: v1 handed RTMPose two huge fixed boxes derived from the table
quad, and RTMPose is a top-down model — given a box it ALWAYS returns a
pose. On side-on footage the "far" box mostly frames the table and back
wall, so v1 read poses of TVs and posters at passable confidence. On
86f880b9 the far "player" signature froze at the wall colour through
four real side switches, which makes a swap geometrically undetectable
(both pairing costs go symmetric). v1's conclusions were structurally
unable to generalize, independent of the calibration outage.

## The v2 design (worker/side_change.py + extract_side_changes_rtmpose.py)

Downstream of point detection, blind to it by construction: it reads the
per-point clips the pipeline already cut and never changes a point.

1. **Detect people first, pose second.** RTMDet-m person detection
   (Apache-2.0, rtmlib, CPU ~244ms/frame — onnxruntime's CoreML EP
   rejects its output shape) on 7 frames sampled across the played
   middle (20–80%) of each point clip.
2. **Assign ends in IMAGE space, normalized by person size.** A person
   belongs to the table when their bbox-bottom anchor is within 1.1×
   their own bbox height of the quad; their end is the nearer END line
   (A-B vs C-D). Both rules come from the 2026-08-11 deadspace study.
   Ground-plane projection was tried first and failed exactly as that
   study warned: the table occludes the far player's legs, so their
   "feet" project inside the table's footprint.
3. **Ambiguity is a guard, not a tiebreak.** A second candidate nearly
   as close to an end (within 0.6× the taller bbox) makes that end
   ambiguous for the frame and it contributes nothing. Doubles and
   bystanders fail here, before any appearance is read.
4. **Anonymous appearance, adjacent comparison.** Per point per end:
   median BGR of the torso crop (shoulders/hips from RTMPose), with a
   trimmed spread gate (drop up to 2 outlier frames of 7; two or three
   samples must agree outright). Consecutive qualified points are
   compared as a pair: same-configuration cost vs swapped-configuration
   cost. Adjacent comparison is immune to lighting drift (v1 anchored
   prototypes on the first point) and to mid-gap ball retrieval —
   sampling happens during play only.
5. **A boundary is a clean, isolated step.** A confirmed side change
   needs: a 'swapped' pair verdict beyond the margin on a strictly
   adjacent pair; ≥2 stable 'same' pairs directly before; ≥2 directly
   after (the reversal persists into following points); and the match's
   total swapped verdicts within a flip budget (6) — more means the
   appearance signal itself is unstable and everything is withheld.
6. **Gap duration is confidence, never a gate.** Measured on 46 truth
   matches / 107 real boundaries: boundary gaps median 18.9s but p25 =
   6.7s and min = 0.0s — players pause the recording between games, so
   a real boundary can have no gap at all. Ordinary gaps: median 4.5s,
   p90 = 11.5s, 303/2104 above 10s. No usable threshold exists; a gap
   ≥8s only adds a small confidence bonus.

Cost: ~4 minutes of CPU per match, so the worker stage runs AFTER the
match is ready and the owner notified (post-ready enrichment). Compact
evidence (side_changes + provenance) persists to
matches.match_structure; the full diagnostic artifact (per-point
signatures, every pair verdict) uploads beside match.json as
side-changes.json. first_server is never touched.

## Ground truth, for free

Scored matches carry the answer: explicit `game_end_override = 'end'`
pins (defined by migration 021 as "the video's visible side switch")
plus the 11-with-2-clear walk on fully scored matches.
worker/eval_side_changes.py downloads a match's clips + match.json from
R2, runs the extractor, and scores detected changes against those
boundaries by time overlap. False positives are only charged on fully
scored matches; on pin-only matches an un-pinned fire may be a boundary
the owner never marked, and is reported as "unverified".

## What went wrong, and why the first number was worthless

This shipped to the product on 2026-08-26 and came straight back out the
same day. Adil opened the first unscored match it fired on and both
markers were wrong. The cause was not the detector.

**The stage reads `match.json` from R2 and pins its findings onto
database points carrying the same `idx`, and nothing checked that the
two describe the same processing run.** On the Chris match (`e7a83f97`)
`match.json` describes a 106-point cut while the database holds 127
points from a later reprocess. Same `idx`, different rally, 198 seconds
apart. Every marker landed somewhere arbitrary.

Across the 21 matches cached at the time, 19 agreed to the frame and 2
did not — but one of the two was the match that got looked at.

**The precision figure inherited the same defect.** The harness built
detections from `match.json` times and truth from database rows, so on a
drifted match it was comparing two different videos and calling the
result 100%. The number was not measuring what it claimed.

`assert_aligned` in `side_change.py` now refuses evidence whose shared
indices disagree by more than a second, with the Chris numbers frozen
into `test_side_change.py`. A missing index stays legal — the owner
deletes junk cards and those rows are simply gone, which is why the
guard tests start times rather than counts.

## What is actually known

The corpus figure quoted in the first version of this note (100%
precision, 36% recall on 14 fully-scored matches) is **withdrawn** for
the reason above. What replaced it is better: Adil judged all 31
candidates frame by frame on the review page, which is ground truth
about the actual question rather than a proxy.

**Of the 31, 26 were real changeovers, 3 were not, 2 unclear.** Split by
what the detector decided:

```
                          real swap   not a swap
detector confirmed             18            0
detector withheld               8            3
```

Precision was already perfect. **The whole problem was recall, and it
had a single cause.** Every one of the 8 real changeovers thrown away
was rejected for the same reason: one point sat between the pair, so the
strict-adjacency rule refused it. The 3 genuine non-swaps were rejected
by the stability rule, at confidence 0.0, 0.0 and 0.1.

So adjacency was doing all the damage and stability all the useful work.

## Reaching across the transition

**A changeover is not one clean gap.** Players fetch the ball, drink,
towel off, and the cutter turns that into one to three junk cards
between the last rally of a game and the first of the next — Adil's
observation, and the numbers agree with it exactly: all 8 lost
changeovers had precisely one card in between.

The flip pair no longer has to be adjacent. It may reach across up to
`bridge_max` (3) unqualified points, and the boundary is reported after
the last qualified point before the swap, which is where the game
actually ended — the bridged cards belong to the changeover, not to the
game. The objection this replaces was that a bridged flip cannot say
which gap it happened in; true, and it does not matter for the same
reason.

Rescored against the same verdicts:

```
                            confirmed   right   wrong
strict adjacency (before)          18      18       0
reaching across (after)            26      26       0
```

**Every recovered candidate is a real changeover, and nothing new is
wrong.**

## The corpus figures

39 matches extracted; 4 refused by `assert_aligned` (stale match.json);
23 fully scored and aligned, which is where a boundary count exists to
measure against.

```
                                 matches   game ends   found   wrong    P      R
all fully-scored + aligned            23          57      33       3   92%    58%
minus the bad-truth match             22          53      33       0  100%    62%

coverage under 50%                    10          19       2       0  100%    11%
coverage 50-75%                        5          18      15       0  100%    83%
coverage over 75%                      8          20      16       3   84%    80%
```

**Accuracy is not the limit; visibility is.** Where the camera shows
both players the detector finds 80% of game ends and essentially never
fires wrongly. Where it does not, it stays quiet — which is why the
low-coverage band still reads 100% precision on the two it did find.

**All three "wrong" fires are one match, `cebaa6d4`, and there the
reference is wrong, not the detector.** It fired on gaps of 22.5s, 22.7s
and 18.3s; the score-derived boundaries sit 3–4 points later on gaps of
1.2s, 2.5s, 1.0s and 1.2s. Nobody changes ends in 1.2 seconds. That
match has 80 scored points and no pins, so its boundaries come purely
from the 11-point rule, which drifts late when a few points are
mis-scored. Score-derived truth has its own noise, and this is what it
looks like — another reason the frame-by-frame verdicts outrank it.

Coverage does NOT work as a safety gate, tempting as it looks: the
bad-reference match sits at 91% qualified, in the highest band.

## One venue, and why that settles the confidence question

Camera geometry looked like the gate. Grouped by foreshortening —
computable at calibration time, before any detection runs — square-on
cameras scored 100% precision and 96% recall while end-on scored 25%
and 7%, and the gate cleanly excluded the bad-reference match.

Then the set was deduplicated and the venues counted.

```
                    matches   game ends   found   wrong     P      R
PingPod                  16          45      31       3    91%    69%
everywhere else           7          12       2       0   100%    17%
```

**Every well-shot, well-covered match in the corpus is PingPod.** The
gated set — foreshortening ≥ 0.75 and coverage ≥ 60%, which reads 100%
precision and 92% recall — is 7 recordings after deduplication (11
before; `ec6490f4`/`86f880b9` and `7e02fbb9`/`81b609e6` are the same
uploads twice), three opponents, one room. Outside PingPod **no match
reaches 50% coverage at all**, so the gate has never been tested
elsewhere.

**And foreshortening does not predict coverage off-venue.** Westchester
`98be5eb5` and `1466e3c3` are geometrically square (2.44 and 1.79) and
still qualified only 43% and 22% of their points. Whatever suppresses
coverage there — distance to the table, how small the players sit in
frame — is not the ratio, so a gate built on the ratio would let those
through expecting PingPod behaviour.

What the corpus DOES support: **the detector fails silent, not loud.**
Precision is 100% everywhere outside PingPod and in every low-coverage
band. It refuses rather than guesses, which is the property that was
designed for and the one that matters most.

What it does not support: any claim about how often it fires on a
well-shot match at a venue we have not measured. That needs
fully-scored, calibrated, side-on matches from LYTTC, MatchPoint or
Westchester. The two attempted here (`51625364`, `16ed0458`) both
refused for lack of table calibration, which is itself the ladder
working, but leaves the question open.

`docs/research/gameend.html` is the review page: every candidate as the
two frames the detector actually compared, so a swap is either visible
or it is not. Verdicts already given are baked in by
`--labels` (kept in `verdicts-2026-08-26.json` beside the cache), so a
rebuild never asks for the same judgement twice.

The next number to trust comes from that page, not from the harness.

## The deciding-game limitation, stated plainly

In a deciding game players also switch ends when the first player
reaches five points. Without a score, that switch is INDISTINGUISHABLE
from a game boundary: same walk around the table, same persistence. It
is rare in this corpus (one instance across the fully scored matches,
and only matches that reach a deciding game have one at all), and its
gap tends to be short — but this detector will fire on it, and the
indicator will be wrong there. This is why the stored primitive is
`side_change`, why the UI copy says "detected" rather than asserting,
and why nothing downstream consumes the event yet. If score data later
arrives (the owner scores the match), the indicators disappear entirely
— the truth takes over.

## Where it lives now

**Not in the product.** Both indicators were removed from the web app
and iOS on 2026-08-26, along with the client resolver and the config
reader. `app_config.game_end_detection` is `off` and the two stored
evidence rows are cleared. The worker stage still exists and is still
gated by that flag, so it does nothing until someone turns it on
deliberately.

What survives is research tooling: the detector, the harness, the review
page, and this note. The question — can a game boundary be read off a
side change — is still worth answering. It just has to be answered
somewhere a wrong answer costs nothing.

If it does come back, the gating that was built stands: match / league /
tournament only with a missing type failing safe to nothing; unscored
only, so one confirmed winner or pinned boundary hides everything;
doubles unsupported, with the ambiguity guard and flip budget
withholding rather than guessing; and thresholds overridable through
`app_config.game_end_detection_config` without a deploy.

## Files

- `worker/side_change.py` — detection logic, evidence shaping, and the
  `assert_aligned` guard
- `worker/extract_side_changes_rtmpose.py` — detector-first extractor
- `worker/eval_side_changes.py` — evaluation harness + backfill
- `worker/build_game_end_review.py` — builds the review page
- `worker/tests/test_side_change.py` — state machine + alignment tests
- `worker/worker.py` — `run_side_change_stage` (post-ready, flag-gated)
- `supabase/migrations/140_game_end_detection.sql` — flag + allow-list
- `docs/research/gameend.html` — the review page (generated, untracked,
  like the other large review pages here)
- `~/ponglens-research-work/game-end-eval/` — corpus cache + artifacts

The product-side files (`matchStructure.ts` resolver, both dividers,
`ios/.../Core/MatchStructure.swift`) were removed in the strip commit;
git history has them if the feature earns its way back.

---

# 2026-08-27 — the rewrite

Four things changed on 2026-08-27, and only one of them was a threshold.

## Truth was the first problem, not the detector

The harness trusted a match only when EVERY non-let live point in it
carried a confirmed winner. That is a match-level gate on a point-level
fact, and it discarded most of the evidence available: a player scores
two games carefully and gets bored, and the two provable boundaries in
that match go into the bin with the rest of it.

`worker/game_truth.py` reads truth per GAME instead. A game closes as
**proven** when it reaches 11 with a clear two and every non-let point
inside it is scored; as **pinned** when the owner pressed the positional
`game_end_override='end'` control, which by design marks the video's
visible side switch (migration 021). Scoring that goes quiet latches a
`dirty` flag, and only a pin clears it, because a running count missing a
rally can reach 11 a point early or late and every automatic close after
that is a guess.

| | boundaries | matches |
| --- | --- | --- |
| old, match-level | 57 | 27 |
| new, per game | **122** (85 proven, 37 pinned) | 52 |

## Twelve matches had no table at all

Twelve of those 52 carried `calibration: {"ok": false}` and nothing else.
They were processed when the only calibrator was the retired pink-rim
one, and their raw uploads were swept at 30 days, so the normal retry
path — which needs the raw video and its BlurBall detections — cannot
run on them.

The clips can stand in for the raw. The camera does not move during a
match, so a frame from the middle of a rally shows the same table in the
same place, and the keypoint detector only ever looked at single frames.
`worker/recalibrate_from_clips.py` takes one frame from each of sixteen
clips spread across the match, encodes them into a throwaway reel, and
hands it to `table_keypoints.py` **unchanged** — sixteen filtered-then-
pooled frames is the measured rule and reimplementing the pooling to feed
it loose frames would be a second, unmeasured copy of it.

**Twelve of thirteen recovered**, most at 15/16 or 16/16 agreement with
sub-pixel spread. The thirteenth declined because the frames split evenly
between two tables, which is the detector working.

## The state machine was asking the wrong question

v2 decided one pair at a time — is this pair 'swapped', with N clean
pairs either side — and patched the decisions together with stability
runs. That cannot express "a changeover happened around here". Ishan
(`d59d7610`) is the case: three real boundaries, four candidates found,
every one refused because a single pair in the middle of a changeover
read 'same' and split the transition into two halves with settled ground
on one side each.

v3 labels the whole match at once. Each qualified point holds one of two
configurations; every comparison between two points is evidence about
whether they agree; the cheapest single explanation of all of it wins,
with a fixed penalty per state change so changes have to earn their
place. Two consequences no threshold could buy:

- **Non-adjacent evidence counts.** Each point is compared with the next
  three qualified points, so point 28 is compared directly with point 31,
  straight across the mess — usually the cleanest comparison available.
- **An ambiguous pair is outvoted rather than obeyed.** Under v2 one
  'uncertain' verdict zeroed a stability run.

The optimisation is exact, not a search: a Viterbi pass whose state is
the last three labels plus a minimum-run countdown returns the global
optimum in one sweep.

Three guards, each earning its place on a case that failed without it:

- **A run of one configuration must last at least three points.** Without
  it, one rally with the players mixed up is explained by paying the
  switch penalty twice, which strongly-coloured shirts easily cover.
- **Every candidate is verified a second way**, against the median
  signature of the settled runs either side with the immediate neighbours
  dropped. That is evidence the transition itself cannot reach, and it is
  what refuses a one-rally glitch.
- **If the winning labelling still contradicts more than 30% of its own
  comparisons, the match is withheld whole.** Not how many changes were
  found — how much evidence had to be ignored to find them.

## Gap length is a real prior. Deleted points are not.

Both were measured over 3,573 gaps between consecutive live points on the
52 scored matches.

| | at a true boundary | everywhere else |
| --- | --- | --- |
| median gap | **17.6s** | 4.0s |
| p75 / p99 | 28.0s | 7.0s / 21.5s |
| contains a deleted point | 37.7% | 14.6% |

Gap length alone is worth 77% precision at 25% recall (`gap >= 30s`), so
it now discounts the switch penalty smoothly — never to zero, because
recordings paused between games produce real boundaries with no gap at
all (p10 of true boundary gaps is 2.0s).

Deleted points are a real 2.6x enrichment and far too weak to detect
with, and they do not exist on a fresh unscored match, which is the only
case the product cares about. **Adil deletes junk cards generally, not
changeovers specifically** — 62% of true boundaries have no deleted point
in them at all.

## Scoring drift is real and is not detector error

Of 49 confirmed fires, 33 land exactly on the scored boundary, 6 land one
to four rallies early, and 6 are plainly wrong (26 to 46 rallies away).

Every one of the six near misses fired on a **longer break** than the
scored boundary had:

| match | fired at a gap of | scored boundary's gap |
| --- | --- | --- |
| `cebaa6d4` | 22.5s | 1.2s |
| `cebaa6d4` | 18.3s | 1.0s |
| `d4592913` | 57.5s | 3.5s |
| `86f880b9` | 34.0s | 9.7s |
| `5bd279f4` | 21.0s | 4.5s |
| `1466e3c3` | 26.0s | 1.5s |

Players walking round a table take longer than a second. A "boundary"
with a 1.0s gap is one rally following another; the score drifted by a
rally or two and the detector found the actual changeover. Since
`game_end_override` is defined as the video's visible side switch, that
is the thing being detected.

`score_match` therefore forgives up to three rallies of offset, but only
when the fire sits on a gap at least as long as the boundary's own. The
condition is what stops it being a free pass: an offset is forgiven only
in the direction the physical evidence supports. Both numbers are
reported.

## What the measurement then said the limiter was

With v3 and the expanded truth, on the 31 matches that had evidence at
that point:

| qualification coverage | recall | precision |
| --- | --- | --- |
| **>= 70%** | **78%** (35 of 45) | **92%** |
| 40-70% | 17% (3 of 18) | 60% |
| < 40% | 12% (2 of 17) | 33% |

The model works when it can see both players. Sweeping every threshold —
switch penalty, confidence floor, separability floor — moved the corpus
figure between 84% precision at 51% recall and 87% at 50%, and no
combination did better. **The thresholds were not the limiter; the
evidence was.**

Where the evidence goes, over 2,926 points:

| | share |
| --- | --- |
| qualified | 58.4% |
| NEAR player's signature unstable across frames | **15.3%** |
| no NEAR player found | 9.8% |
| FAR player's signature unstable | 8.0% |
| both unstable | 4.3% |
| no FAR player found | 2.8% |
| nobody found at all | 1.4% |

The NEAR player is the biggest, closest, easiest person in the frame, and
it is the one whose signature will not hold still. That is a descriptor
problem, not a detection one.

## The descriptor bank

`player_descriptors` now computes ten candidate signatures in one pass
and stores every one, so choosing between them is a sweep over stored
numbers rather than an hour and a half of pose inference per idea
(`worker/sweep_descriptors.py`).

Three defects were named by the literature sweep and all three are real:

1. **A bounding rectangle is mostly not the player.** It catches floor and
   wall through the gap under the arms, and how much it catches changes
   with every movement — the instability the spread gate was rejecting
   points for. Regions are now masked polygons warped into one fixed
   24x64 body frame anchored on the shoulder and hip midpoints, so
   "chest" is the same rows for a 300px near player and a 40px far one.
2. **A median is the wrong statistic for the case that fails.** Two
   players in black tops have near-identical medians by construction —
   that is what 0.147 means. What separates them is what the median
   discards: a collar, a printed panel, a lighter waistband. `lab_q`
   stores five quantiles per Lab channel per band; the 50th percentile is
   the old number, so it is a strict superset.
3. **Raw BGR reads brightness as much as colour**, and comparing a player
   at one end against themselves at the other is exactly what a
   changeover forces. Three independent answers now ride along: the
   **table as a calibration target** (one uniform surface photographed in
   both lights in every frame, so the ratio of its two halves is the
   illuminant difference); **inter-band log contrast** (a change of light
   is additive in log space, so subtracting two bands of the same player
   in the same frame cancels it exactly, gamma included); and **body
   proportions**, which never look at colour.

The hue histogram had a plain bug for the failing case: it discarded
every pixel under a saturation of 20 or a value of 25, which on a dark
top is most of the shirt, so it was computed on noise exactly where it
was needed. Pixels are now weighted by saturation rather than thresholded
on it, and soft-binned.

Rejected, with reasons: learned re-ID embeddings (cheap enough at 4-8ms a
crop, but standard backbones collapse at 40px person height and the good
weights carry no licence), CLIP/DINOv2/SigLIP (worse transfer at ten
times the cost), YCrCb (1.90% rank-1 against HSV's 11.07% under a fixed
protocol), 512-bin joint histograms (0.23 samples per bin on our crops),
per-crop grey-world (forces a mostly-shirt region's mean to grey, which
is normalising away the signal), and van de Weijer's colour-name lookup
table (no stated licence — the 16-colour palette is built here instead).

**Thresholds do not transfer between descriptors.** A Hellinger distance
lives in [0, 1.41] and a 60-float quantile vector compared with L2 does
not. Every sweep fits each descriptor's grid to its own measured
distribution — the spread gate from how far apart two frames of one
player sit, the switch penalty from how far apart the two players sit.
Comparing descriptors at one shared literal threshold would be comparing
tunings, and it would look like a result.

## What the corpus chose, and what it is worth

Fifty-one matches, 120 boundaries, every descriptor fitted to its own
ruler. The winner is not the clever one:

| descriptor | dims | precision | recall | coverage |
| --- | --- | --- | --- | --- |
| **lab+legs_lab** — torso a*b* joined to shorts a*b* | **4** | **85.7%** | **65.0%** | 92.2% |
| lab — torso a*b* alone | 2 | 83.7% | 64.2% | 91.0% |
| lab_q_tc — banded quantiles, table-corrected | 60 | 84.3% | 62.5% | 91.1% |
| rg — chromaticity | 2 | 85.9% | 60.8% | 70.9% |
| cn_up — colour names | 16 | 86.7% | 60.0% | 61.4% |
| hs_up — saturation-weighted hue histogram | 64 | 81.3% | 61.7% | 87.0% |
| lab_q+logdiff | 84 | 84.3% | 58.3% | 97.9% |
| **bgr — the baseline, on a masked polygon** | 3 | 81.4% | 58.3% | 82.7% |
| logdiff — inter-band log contrast | 24 | 83.1% | 53.3% | 97.9% |
| geom — body proportions, no colour | 5 | 55.6% | **4.2%** | 70.9% |

Read that carefully, because most of it is a negative result:

- **The shorts were the win, not the statistics.** Adding the legs region
  to a two-number torso colour beat every histogram, quantile vector and
  colour-name distribution tried against it. Table tennis players wear a
  club shirt and their own shorts, and the shorts are where they differ.
- **Quantiles did not pay off on their own.** `lab_q` (60 numbers,
  designed to catch the collar and the trim a median throws away) scored
  BELOW the plain median it was built to beat — unless it was also
  table-corrected, and then it only drew level.
- **`geom` is dead.** Body proportions are immune to lighting and to
  identical shirts, and at 4.2% recall they are also immune to being
  useful. RTMPose keypoint noise on a 40px twisting torso swamps the
  difference between two adults.
- **Coverage and accuracy are different axes.** `logdiff` qualifies 97.9%
  of all points, the best of any descriptor, and finds the fewest
  boundaries. Being able to measure something on every rally is not the
  same as measuring the right thing.
- **Masking the region was worth more than any descriptor change.**
  Coverage went 58.4% -> 82.7% from that alone, with the SAME median-BGR
  statistic.

Tuning the state machine on the winner added two more points of recall at
equal precision: comparing each point with the next FIVE qualified points
rather than three, and requiring four points of settled ground per side
rather than three.

### The operating point

On the 44 competitive matches — the only ones the product would run on,
since `SIDE_CHANGE_SKIP_TYPES` has always excluded drills and practice:

**73 of 109 boundaries found (67%), 11 wrong (87% precision).**

| | boundaries | found | wrong | precision |
| --- | --- | --- | --- | --- |
| match | 56 | 79% | 8 | 85% |
| tournament | 23 | 57% | 1 | 93% |
| league | 17 | 53% | 1 | 90% |
| *practice (excluded)* | *11* | *36%* | *0* | *100%* |

Practice is the interesting exclusion: three practice matches sit at
88-92% coverage and find nothing at all. **Players often do not change
ends in a practice session**, so the owner's pinned game end is real and
the video contains no side change to see. The detector is right to say
nothing; the truth is simply not a side change.

Within competitive matches, coverage still governs:

| both players visible in | recall | precision |
| --- | --- | --- |
| >= 70% of rallies | 76% | 90% |
| 45-70% | 48% | 76% |

And the separability floor was **removed**, at zero by default. Every
non-zero value lost recall and bought no precision: `max_contradiction`
already withholds those matches, and on better evidence — how much of its
own comparisons the winning explanation had to ignore, rather than how
similar two shirts happen to be.

### Where it stands against where it started

| | boundaries judged | precision | recall |
| --- | --- | --- | --- |
| v2, on the old (partly misaligned) truth | 57 | 92% | 60% |
| v2's descriptor on the honest truth | 120 | 81% | 58% |
| **v3, competitive matches** | **109** | **87%** | **67%** |

The 92% was measured against a truth set half the size, on a third of the
corpus, with the alignment flaw still in the harness. It was never
comparable.

### Still open

- **Tournament and league recall (53-57%) against match (79%).** Busier
  venues, more people near the table, smaller players. This is the next
  thing worth attacking and it is a player-finding problem, not a
  descriptor one.
- **Eleven wrong fires**, concentrated in five matches. Four of them
  (`5721edd0`, `d4592913`) are on matches with pins rather than full
  scoring, where an extra fire may be a boundary the owner never marked.
- **`cebaa6d4` remains the hard case**: 96% coverage, three confident
  fires, and the scoring disagrees with all of them by three to four
  rallies while every fire sits on a break four to twenty times longer.
  Judged by the video the detector looks right; judged by the score it is
  wrong on three of four.

---

# 2026-08-27, later — judged by eye

Adil reviewed 110 of the 141 cases on `gameend.html` — every fire that
disagreed with his scoring, every miss shown, and most of the hits —
answering one question per case: did the two players swap ends between
these rallies. Verdicts are kept in
`docs/research/2026-08-27-game-end-verdicts.json`.

The result changes what the earlier numbers mean.

| the detector | you said swapped | you said same | couldn't tell |
| --- | --- | --- | --- |
| fired, scoring agreed | 49 | **0** | 1 |
| fired, scoring DISAGREED | **20** | **0** | 1 |
| stayed quiet | 22 | **16** | 1 |

**Not one fire out of seventy was wrong.** Every single one — including
all twenty-one the harness had been charging as a false positive — is a
real changeover on the video. The eleven "wrong" fires in the score-based
figure were the score being wrong, not the detector.

**And sixteen of the thirty-nine judged misses have no changeover in them
at all.** The scoring says a game ended; the video shows the same two
players staying where they were.

Corrected, over the whole corpus:

| | score as truth | video as truth |
| --- | --- | --- |
| precision | 87% | **100%** (98 fires, 0 false) |
| recall | 67% | **80%** (98 of ~122 real changeovers) |

The score-based figures were not wrong to compute — they were the only
truth available before this review — but they were measuring the
agreement between two imperfect records, and charging every disagreement
to the detector.

### Where the scoring says a game ended and the video does not

`cebaa6d4` (Rowel) x3, `57237caf` (Chris, practice) x3, `6a3777db`
(Yilin) x2, `efff9208` (Alex) x2, and one each on six more.

`cebaa6d4` is now fully explained: three confident fires, three scored
boundaries three to four rallies later, and the video agrees with the
detector on all three. It was never a detector failure.

The practice matches are the other clean story. Players often do not
change ends in practice, so a pinned game end there is real and invisible
— which is why `SIDE_CHANGE_SKIP_TYPES` excluding drills and practice was
right for a reason nobody had written down.

### The 22 real changeovers still missed

| match | missed | both players seen |
| --- | --- | --- |
| `c27e196d` Ch (practice) | 3 | 92% |
| `4c138aa1` Ishan | 2 | 53% |
| `617a2067` Jacky | 2 | 52% |
| `7e02fbb9` / `81b609e6` Julian (same match, twice) | 2 each | 80% |
| `98be5eb5` Patricia | 2 | 47% |
| `a0fb8f44` Gui | 2 | 64% |
| nine more | 1 each | 45-88% |

Half of these sit below 65% coverage, which is the familiar story. But
`c27e196d` at 92% and the Julian pair at 80% are not — those are cases
where the players were seen perfectly well and the change was still not
called, and they are the ones worth opening next.

### A caveat on corpus size

Three matches are in the corpus twice, and one three times: Chris
(`345ce4fb`, `86f880b9`, `ec6490f4`), Julian (`7e02fbb9`, `81b609e6`) and
Alex (`1c7eb2b8`, `efff9208`). Four uploads of three matches. They do not
bias precision or recall — both copies behave the same way — but the
corpus is 47 distinct matches, not 51.

---

## What the second review round found (2026-08-27, afternoon)

Adil went through the 22 misses and the 9 borderline candidates one by
one, wrote a cause against each and a paragraph of what he could see.
Three things came out of it, and only one of them was the thing being
asked about.

### 1. The candidates were real, so the bar came down

All nine were shown as "a looser verification bar would fire here — did
they swap?". Seven came back described as obvious changeovers ("this is
clearly a change", "it seems pretty obvious"); two were in a match he
asked to drop.

That settles a question that could not be settled by measurement. Four
thresholds moved together:

| | was | now |
| --- | --- | --- |
| `verify_margin` | 0.008 | 0.002 |
| `switch_penalty` | 0.016 | 0.008 |
| `confidence_scale` | 0.032 | 0.016 |
| `min_confidence` | 0.65 | 0.35 |

No single one of them carries it — each is worth two to four boundaries
alone and all four together are worth thirteen, because a candidate has
to survive every gate. Scored per BOUNDARY rather than per rally index,
against the 93 changeovers Adil has now confirmed by eye:

| | before | after |
| --- | --- | --- |
| recall | 72.0% | **86.0%** |
| precision | 100% | **100%** |
| fires nobody has judged | 28 | 28 |

The last row is the one that makes this safe. Loosening added thirteen
fires and every one of them landed on a boundary he had already
confirmed; it did not go and find thirteen new places to be wrong.

Against the score sheet the same change reads 66% → 73% recall and 87% →
85% precision. Those three extra "false positives" are fires the video
says are right. Quote the video numbers.

### 2. Scoring per rally index was inventing misses

Seven of the 22 "misses" had fired one to three rallies away from the
truth position. `eval_side_changes.score_match` has forgiven that drift
since the morning — a changeover takes half a minute and the owner taps
when he gets to it — but the by-hand tally built for the review page did
not, so the page showed a correct detection as a failure and asked him to
explain why it had not fired.

`worker/judged_boundaries.py` is the fix: judged rally positions within
three of each other collapse into one physical boundary, and a fire
within three of any of them finds it. Worth seven boundaries on this
corpus, none of them a change to the detector.

### 3. The page drew the table in the wrong place

Eight of the causes he returned were `not-detected` or `table-wrong`,
with notes like "I don't see a green box and a yellow box" and "the far
player identification is not working very well". Measured directly
afterwards on two of those matches: the far player was found in **74 of
75 frames**, and adding a second detection pass on a crop of the table
took it to 75 of 75. There was nothing wrong with the detection.

`build_missed_page.py` read `calibration` straight out of `match.json`
and handed it to `_scaled_corners`. Corners are stored in the SOURCE
video's pixels; the per-point clips are 720x406 against a 1920x1080
source. `_scaled_corners` rescales between the two, but only when it is
told the source size, and **50 of the 62 calibrated matches do not record
one**. Its fallback is to assume the clip IS the source, which leaves the
corners at their 1920-wide values on a 720-wide frame and puts the quad
off the right-hand edge.

Nothing raises. `choose_players` finds nobody within reach of a table
that is not on screen, so every frame comes back with no players chosen,
which looks exactly like a detector that cannot see people. The
extractor, the labeller and the diagnostic all patch the size; the review
page was the one that did not.

It is `calibration_with_size()` now, in the extractor, imported by the
page. A named function so the next caller inherits the fix rather than
the bug.

**His verdicts survive this and his causes do not.** Whether two players
swapped ends is read off the picture; the boxes were decoration. But
`not-detected`, `table-wrong` and some of `look-alike` were read off
decoration that was wrong, so they cannot be used to direct the next
change.

### 4. And then the tables really were wrong

Chasing the drawing bug turned up a real one underneath it. **Twenty-two
of the 62 matches — twelve of the 37 Adil judged — still carry a quad
from the retired pink-rim calibrator**, the one measured at 0.5% at LYTTC
and 7.6% at PingPod.

Eleven of them were re-detected with the keypoint model, from sixteen
frames taken out of sixteen different rally clips
(`recalibrate_from_clips.py`, built the same morning for matches with no
calibration at all). Mean corner displacement against the stored quad,
as a fraction of frame width:

| | matches |
| --- | --- |
| agrees (< 1%) | 2 |
| 13-20% out | 5 |
| 45-49% out | 4 |

Rendered side by side, all eleven tell the same story: the keypoint quad
sits on the table and the pink-rim quad is spread across the hall, over
two tables, or off the frame entirely. In the three PingPod matches the
stored quad is not visible in the picture at all.

This matters more than any descriptor. Near and far are decided by which
side of the quad a person stands on, so a wrong quad does not add noise
to the appearance comparison — it compares the wrong two people. That it
still reached 86% is a property of `choose_players` degrading gracefully:
"the biggest person" finds the near player whatever the quad says.

Eleven quads replaced, originals kept as `match.pinkrim.json`, evidence
cleared for re-extraction. The other eleven declined — the keypoint model
refuses rather than guesses — and are being retried with more frames,
which is the honest retry when the pooled vote could not decide. One of
them, `98be5eb5`, declined with "frames split evenly between two tables
(7 each of 14)", which is the two-rule guard doing exactly its job.

### What Adil asked for, and what the corpus is being asked

His own suggestions, in his order of confidence:

- **Shoes.** "One thing that is almost always different is the color of
  shoes." Tournaments hand every entrant the same shirt; they do not hand
  out shoes. COCO-17 stops at the ankle, so `footwear_pixels` hangs a box
  below it sized from the player's own shin. Available on **98.3% of
  frames**, which is far better than the "shoes could be under the table"
  worry suggested. On `2f7168db` — his navy-against-navy case — the
  baseline descriptor fires nothing and `lab+legs_lab+shoe_lab` finds the
  changeover.
- **Height.** "If you take the measurements of the near player standing
  in the same spot and then you see that the near player changes, you
  know." `geom` already stores body ratios and scored 4.2% recall alone,
  because a ratio throws away the one number that separates a tall player
  from a short one. `stature` stores the absolute lengths instead,
  divided by the 1.525 m end line at that player's own end.
- **Sample the shirt in more than one place.** "His shirt does have dark
  spots... the top half is lighter." `lab_q` already does this and lost
  to the plain median; it is worth retrying as an addition rather than a
  replacement.
- **Skin tone.** Not built, and not a close call. It is a protected
  characteristic under GDPR Article 9 and the EU AI Act, PongLens has an
  open legal compliance audit, and a table tennis product that tells
  players apart by their race is indefensible whatever it scores. Adil
  raised the concern himself in the same sentence he raised the idea.

### One thing measured and rejected already

**A second detection pass on a crop of the table.** RTMDet's ONNX has a
static 640x640 input, so a 1920-wide frame is downscaled 3x before the
model sees it and a far player 40px tall arrives as 13px. Re-running the
detector on a crop around the table should have helped. Measured over 150
frames of the two matches where the far player was supposedly missing:
74/75 to 75/75 on one, 74/75 to 75/75 on the other. One frame in 150.
Not worth doubling detection time for, and the reason it is not worth it
is that the problem it was built for did not exist.
