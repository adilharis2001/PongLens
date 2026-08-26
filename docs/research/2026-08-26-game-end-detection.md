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

## Results

(146-word placeholder — corpus run in flight; this section is filled in
by the run's numbers before the note is cited anywhere.)

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

## Gating

- `app_config.game_end_detection` ('on'/'off', migration 140) gates the
  worker stage AND both indicators, read at run/read time — rollback is
  one UPDATE, backfilled evidence works everywhere.
- Content: match / league / tournament only. Missing type fails safe to
  nothing (46 of 132 ready matches are untyped; typing one later lights
  it up with no reprocess, because eligibility is read-time).
- Unscored only: one confirmed winner or one pinned boundary anywhere
  hides every indicator.
- Doubles: not a supported upload type anywhere in the product; the
  ambiguity guard plus the flip budget withhold rather than guess if
  four players appear. One-player, end-on, poor-calibration footage:
  qualification starves and the match withholds (the designed refusal).
- `app_config.game_end_detection_config` (JSON) overrides
  side_change.DEFAULT_CONFIG thresholds without a deploy.

## Files

- `worker/side_change.py` — pure detection logic + evidence shaping
- `worker/extract_side_changes_rtmpose.py` — detector-first extractor
- `worker/eval_side_changes.py` — evaluation harness + backfill
- `worker/tests/test_side_change.py` — state-machine unit tests
- `worker/worker.py` — `run_side_change_stage` (post-ready enrichment)
- `supabase/migrations/140_game_end_detection.sql` — flag + allow-list
- `src/app/match/[id]/matchStructure.ts` — eligibility + resolver
- `src/app/match/[id]/MatchView.tsx`, `Player.tsx` — the two dividers
- `ios/.../Core/MatchStructure.swift`, `MatchDetailScreen.swift`,
  `PlayerTakeover.swift` — the iOS twins
- `~/ponglens-research-work/game-end-eval/` — corpus cache + artifacts
