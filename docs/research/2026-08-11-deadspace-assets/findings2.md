# Crossing rule: decisive validation result

Everything below comes from `crossexp/evaluation.md` / `evaluation.json`
(harness `eval_all.py` / `evaluate.py`), the per-match quad work in
`crossexp/quads/`, and the labels in `kind2/gt_all.json` (duplicates
vinay_2ffe, chris_d2b5, jason_9a81 dropped). No production code, database
rows or storage objects were touched.

## 1. Verdict

**There is nothing shippable. The zero-crossing rule fails the zero-casualty
criterion at every level we could test it, and the shippable junk cut today
is 0%.**

The one defensible number is this: on the 12 matches that pass the best
label-blind health gate we could construct, the rule catches 78 of the 428
mid-match junk windows in the labeled corpus (18.2%), but it also deletes
62 of 1088 real points (5.7%). Under the zero-casualty requirement that
18.2% cannot ship. Even with a label-oracle gate that production can never
have (restrict to the 9 matches we *know* measure cleanly), the rule still
kills 5 of 563 kept points (0.89%). The pilot's 0-for-76 was real but it
was a two-match sample chosen for pristine measurement; at 22 matches the
tail shows up, and it shows up on healthy matches too (jason_5bd2 x3,
ryuchi_16ed, chris_d3c7).

One caveat on confidence: no independent verification pass ran on the final
numbers (the verification stage came back empty). The internal anchor is
that the harness reproduces the pilot exactly: chris_8e17 9/9 junk, 0/27
kept and kumar_a0f7 41/48, 0/49, identical to the original experiment. A
27-combination parameter sweep moves nothing that matters, so the negative
result is not resting on one script run or one parameter choice.

## 2. What the calibration backfill changed

The backfill produced or validated a trustworthy quad for 19 of 22
evaluable matches, and its main effect was to **overturn the "bad quad"
diagnosis**. Almost every match previously classed as broken-calibration
turns out to have a geometrically correct quad (verified visually: corners
on the rim, projected net line on the physical net) and a *track* that
cannot support the rule: side-on or low cameras where the ball is never
detected over the near half, height parallax pushing detections out of the
lateral bounds, one contaminated track (may_1466: 30% of detections are a
stationary ball on the floor), and one match tracked against the wrong
(cut) video timeline (vaibhab_fd5c, original now purged from R2).

Per-match kept-zero-rate, before and after the backfill:

| match | before | after | outcome |
|---|---|---|---|
| ishan_4c13 | no quad (untracked) | 1.3% | new vision quad, **healthy** |
| vaibhav_7899 | no quad | 1.9% | new vision quad, **healthy** |
| ryuchi_16ed | no quad | 2.0% | new crop-refine quad, **healthy** |
| chris_d3c7 | 2.8% (prod) | 2.8% | prod quad validated, **healthy** |
| chris_ebbb | 0.0% (prod) | 0.0% | prod quad validated, **healthy** |
| vaibhav_9bd8 | 18.4% | 0.0% only with cut-timeline mapping | new quad; junk windows absent from the cut video |
| jake_cb0e | 21.2% | 15.2% | quad genuinely improved; residual is parallax |
| david_5162 | 7.8% | 7.8% | quad verified; near-half track dropout |
| nathan_cff8 | 7.8% | 7.8% | quad verified within 13 px of prod; same dropout |
| vinay_5721 | no quad | 11.1% | correct quad, one-sided track after t=837s |
| julian_19a1 | 9.2% | 8.4% | prod and vision quads agree; track at fault |
| julian_522c | 9.1% (rotated) | 13.1% | orientation fixed, near half occluded |
| alex_efff | 28.8% | 16.9% | prod quad was broken; even fixed, parallax dominates |
| patrick_e009 | 16.2% | 21.6% | end-on low camera, ball height contaminates depth |
| may_1466 | degenerate | 58.5% | good quad, contaminated track |
| bradley_f5a5 | 19.1% | 19.1% | quad was never the problem; ball unseen over near half |
| yilin_6a37 | 26.0% | 64.2% (correct orientation) | match moves between two tables; excluded |
| vaibhab_fd5c | n/a | 31% best salvage | track on cut timeline, original purged |

Net effect: the labeled-healthy population grew from 3 matches (early
signal) to 9 (chris_8e17, chris_ebbb, chris_d3c7, ishan_4c13, jacky_617a,
jason_5bd2, kumar_a0f7, ryuchi_16ed, vaibhav_7899). That growth is what
made this evaluation decisive, and it is also what exposed the casualties.

The structural finding: **recalibration is exhausted as a lever.** The
remaining unhealthy matches fail on camera geometry and track coverage,
and no quad placement can fix either.

## 3. The rule's final table

Reference rule verbatim from the pilot (dwell >= 2 detections/side, 0.20 m
net margin, 0.35 s teleport break, lateral bounds): zero measured crossings
in a mid-match point window means junk.

| match | gate score | kept zero-rate | healthy? | gate @0.90 | junk caught | kept harmed |
|---|---|---|---|---|---|---|
| chris_ebbb | 1.000 | 0.0% | yes | pass | 3/4 | 0/38 |
| jason_5bd2 | 1.000 | 2.3% | yes | pass | 5/21 | 3/130 |
| ryuchi_16ed | 1.000 | 2.0% | yes | pass | 3/11 | 1/49 |
| vinay_5721 | 0.987 | 6.9% | no | pass | 2/5 | 10/144 |
| julian_522c | 0.966 | 6.9% | no | pass | 0/1 | 12/175 |
| vaibhav_7899 | 0.966 | 0.0% | yes | pass | 4/10 | 0/105 |
| chris_d3c7 | 0.952 | 2.8% | yes | pass | 4/6 | 1/36 |
| julian_19a1 | 0.944 | 9.2% | no | pass | 9/12 | 12/131 |
| ishan_4c13 | 0.938 | 0.0% | yes | pass | 38/49 | 0/79 |
| david_5162 | 0.935 | 7.8% | no | pass | 7/10 | 4/51 |
| nathan_cff8 | 0.926 | 7.8% | no | pass | 0/2 | 4/51 |
| jake_cb0e | 0.924 | 15.2% | no | pass | 3/7 | 15/99 |
| jacky_617a | 0.897 | 0.0% | yes | FAIL | 20/28 | 0/50 |
| patrick_e009 | 0.897 | 23.0% | no | fail | 1/4 | 17/74 |
| chris_8e17 | 0.889 | 0.0% | yes | FAIL | 9/9 | 0/27 |
| yilin_6a37 | 0.886 | 26.0% | no | fail | 12/16 | 32/123 |
| alex_efff | 0.867 | 16.9% | no | fail | 0/0 | 10/59 |
| kumar_a0f7 | 0.837 | 0.0% | yes | FAIL | 41/48 | 0/49 |
| bradley_f5a5 | 0.750 | 19.2% | no | fail | 33/41 | 9/47 |
| vaibhav_9bd8 | 0.619 | 47.4% | no | fail | 3/3 | 18/38 |
| vaibhab_fd5c | 0.444 | 56.2% | no | fail | 0/1 | 9/16 |
| may_1466 | 0.360 | 58.5% | no | fail | 41/47 | 31/53 |

Totals on the gate-passing 12: junk 78/138 caught, kept 62/1088 harmed.
Only 6 of 22 matches are truly zero-harm (chris_8e17, chris_ebbb,
ishan_4c13, jacky_617a, kumar_a0f7, vaibhav_7899), and their gate scores
interleave with harmful matches, so no statistic we have picks them out.

Robustness: a 27-combination sweep over dwell (1-3), net margin
(0.10-0.30 m) and teleport break (0.175-0.525 s) never gets gate-passing
harm below 46/1088 or oracle harm below 5/563. The failure is
measurement-driven, not a parameter accident.

## 4. The label-blind gate: definition, and why it is not safe

The gate we designed: take a match's emitted mid-match points, keep the
longest 50%, and compute the share of those with at least one measured
crossing. Pass the match at >= 0.90. The intuition was that long points are
almost always real, so healthy measurement should see crossings in nearly
all of them.

It fails validation, for a structural reason rather than a threshold-tuning
one (the best threshold, 0.9375, still misclassifies 6 of 22):

- **Junk-heavy matches fail for the wrong reason.** Real junk in the long
  half correctly measures zero crossings and drags the score down.
  kumar_a0f7, the best match in the corpus at 41/48 junk caught with zero
  harm, scores 0.837 and is rejected. The gate punishes exactly what the
  rule exists to remove.
- **Subtly-broken matches sail through.** vinay_5721 (0.987), julian_522c
  (0.966) and julian_19a1 (0.944) measure long points fine and fail only
  on short ones. The harm lives in short windows; a long-window statistic
  is blind to it by construction.

Alternatives tried and failed the same way: share of >= 6 s windows with a
crossing, same at >= 8 s, share with >= 2 crossings, median crossings per
second, and per-window abstention on detection density (broken measurement
produces exactly the sparse kept windows the abstention assumes are junk).

So there is no honest answer to "why is the gate safe": it is not, and
that is the central reason the experiment failed. A per-match average
cannot certify the short-window tail where the rule actually operates.

## 5. Struck vs lobbed (audio time-lock extension)

The idea: a real crossing should coincide with a paddle-strike sound, so a
window with only 1-2 crossings and no audio onset near any of them is
junk. It does not work. On the gate-passing population the extension adds
10 junk catches and kills 22 kept points; even on the oracle-healthy
population it is 9 junk for 6 kept casualties (ishan_4c13 x3, jason_5bd2
x2, ryuchi_16ed x1). The mechanism is that the signal is nearly
uninformative: these videos run 96-169 audio onsets per minute, so a
random 0.45 s window contains an onset with probability 0.52-0.72, and 78%
of *junk* crossings are "time-locked" by coincidence. Dead end at any
casualty budget.

## 6. What the ship shape would have been (not built, no code changed)

For the record, the worker-side logic this experiment was gating, as
pseudo-logic:

```
after points_pipeline emits point windows for a match:
  if match has no valid quad: skip (rule inactive)
  gate = share of longest 50% of mid-match points with >= 1 crossing
  if gate < 0.90: skip (measurement not trusted)
  for each mid-match point window:
      crossings = crossings2-rule(track, quad, window)   # verbatim pilot params
      if crossings == 0: flag window as junk
  flagged windows -> [auto-delete | pre-marked recommendation]
```

Recommendation on auto-delete vs pre-marked: **auto-delete is disqualified
outright**, since it destroys 5.7% of real points with no recourse. The
only defensible variant today is the pre-marked shape: flagged windows
stay in the cut but arrive pre-marked for deletion in review, one tap to
confirm. That converts the 62 casualties from destroyed points into 62
wrong suggestions across ~1088 points, which the player can veto. Whether
that is worth building is a product call, not a validation call: it saves
review taps rather than storage or watch time, and it was not the goal of
this experiment. Nothing was implemented; no worker or src changes were
made.

## 7. Coverage honesty

- **Evaluated: 22 of 28 deduped labeled matches.** Six have no ball track
  and the compute envelope did not cover backfilling them: ali_a52a,
  chris_45b3, m_4481, patricia_98be, prabhas_abcd, vinay_0411. All six
  have local video, so they are trackable later; they hold 93 of the
  corpus's 428 mid-match junk windows.
- **vaibhab_fd5c is evaluated but unusable:** its track is on the
  cut-video timeline, the original was purged from R2 after 30 days, and
  the best salvage mapping still shows 31% kept-zero. Its numbers sit in
  the fail half of the table and do not affect the verdict.
- **vaibhav_9bd8's junk catch is untestable** without a re-track of the
  original: its 3 labeled junk windows are not present in the cut video
  its track covers.
- **Excluded duplicates:** vinay_2ffe, chris_d2b5, jason_9a81 (duplicate
  uploads of vinay_5721, chris_45b3, jason_5bd2).
- The audio time-lock analysis skipped matches whose onsets are on the cut
  clock (patrick_e009 among gate-passers).
- fps: true container fps per match; the fps=30 convention moves
  individual matches (julian_522c 23 -> 12 kept-zero windows) but flips no
  conclusion.

## Where this leaves the dead-space goal

The three honest paths to reopen, in order of leverage:

1. **Fix crossing recall, not the gate.** Casualties with 50-80 in-bounds
   detections and zero measured crossings indict the crossing detector
   itself (net-line placement, dwell against sparse tracks). Sub-margin
   interpolation and time-varying calibration attack the real failure.
2. **A provably safe per-window abstention.** None of duration, in-bounds
   count or density worked; anything shipped needs a statistic whose
   zero-harm property survives a corpus this size.
3. **More labeled healthy matches**, to bound the healthy-tail casualty
   rate honestly. 0.89% of 563 kept points is not "never eats a real
   point" at production scale.
