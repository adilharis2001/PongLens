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
