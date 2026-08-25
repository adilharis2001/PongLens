# Solving the lens from the quad: measured, and refused

2026-08-25. Adil approved the half-day study: can the live gate solve the
focal length from the four corners (Zhang's two single-plane constraints)
instead of trusting the phone's reported lens? The prize was a monitor
that works as a test rig and a gate immune to lens misreports. The
script is `worker/study_focal_recovery.py`, read-only against the same
61 hand-marked matches every other gate decision was measured on.

## Verdict

**Do not replace the gate.** Both workable formulations fail, in
opposite directions, and the failure is in the data rather than the
implementation.

## Why: one table quad is too little signal for the lens

The two Zhang constraints each solve for a focal length; if the quad is
an honest picture of a table, the two answers should agree. On the 61
HAND-MARKED quads — no model noise at all — the median disagreement is
already 21.6%, the 85th percentile 74%, and 7 of 61 produce no second
answer at all. A single table quad, seen obliquely at our distances, is
close to degenerate for lens recovery: the far vanishing point is too
unstable to pin the focal down.

That single fact sinks both variants:

**Variant A — require the two answers to agree** (the honest lie
detector). Refuses garbage as well as the current gate or better, but at
any threshold it also refuses 34–44% of REAL tables, and corner noise
finishes it: at 1% noise it accepts 112/305, at 2% — the live model's
regime — 41/305. It would go silent at the venue.

**Variant B — accept if ANY candidate yields a sane lens and an
in-bounds pose** (the server's own recipe from `mine_record_poses`).
Accepts 61/61 true and survives noise (278/305 at 1%). But its refusal
power craters exactly where the live gate earns its keep:

| garbage family | current gate refuses | variant B refuses |
| --- | --- | --- |
| rotated end-for-end | **61/61** | 33/61 |
| one corner moved | 59/61 | 54/61 |
| stitched from two tables | 52/61 | 44/61 |
| random quad | 61/61 | 61/61 |

The two families it weakens on are the two real ones: end-for-end
rotation is the most common labelling/model error in the holdout study
(29 of 105 frames), and the stitched quad is THE multi-table-hall
failure — the exact case where a wrong green light films an unusable
match. The premise of the whole feature is that a wrong table is worse
than no table; variant B trades that away for monitor convenience.

(The "rewound" mirrored family is refused poorly by both gates — 11/61
current, 0/61 B — but the live decoder emits a fixed winding by
construction, so it cannot arise on the phone. Noted, not load-bearing.)

## Why the server can use this math and the phone cannot

`mine_record_poses` runs variant B legitimately: it starts from
CORRECTED, human-verified corners, so its input is already trusted and
the solve only has to recover the pose. The live gate's input is
untrusted by definition — the decomposition IS the trust check, and it
only checks anything when the focal is known independently. Same
equations, opposite epistemic jobs.

## What ships instead

The study's by-product is diagnostic, and it is genuinely useful: when
the known-lens residual refuses a steady sighting but SOME solvable lens
explains the quad cleanly, that signature — plausible geometry, wrong
lens — is what a re-photographed screen looks like. So:

- a sighted table whose stance is refused persistently, and which fits
  under a solved lens, now captions "That looks like a screen, not a
  real table" instead of "Checking the angle" forever;
- any other persistent refusal captions "Can't judge the angle from this
  view" after ~8 s, so a refusal never reads as a hang.

Neither grants green. The gate is untouched.

## Reproducing

`venv/bin/python worker/study_focal_recovery.py` — fixed seed, fetches
corners read-only, prints every table above.
