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
wrong.** Reaching to 2–3 cards adds 8 further candidates on the corpus,
not yet judged. Coverage remains the ceiling: 88 of 106 points qualified
on a square-on camera against 1 of 143 on Yilin's end-on tournament
footage, which correctly produced nothing.

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
