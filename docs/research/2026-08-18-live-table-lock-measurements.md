# Live table lock: what the corpus says the phone can and cannot see

2026-08-18. Offline measurements gating the auto-alignment build, run
against the 61 hand-marked frames in `table_calibration_review` (median
backgrounds — empty tables, the best case a live setup view will ever be).
Harness in the session scratchpad; numbers reproducible from the rows and
frames alone.

## Vision rectangle detection: dead

`VNDetectRectanglesRequest` over a parameter grid (aspect floor 0.1–0.2,
quadrature tolerance 20–45°, confidence 0.1–0.3):

    recall 0/61, every configuration, every venue

It happily returns TVs, mats and shelf fronts, never the table. The
diagonal poses our envelope demands produce interior angles 40–140° and a
top edge visually split by the net; Vision's rectangle model wants compact
document-like quads. A framework detector was the cheap path and it is
closed. Do not propose it again without new evidence.

## Edge energy along the outline: a lock signal, not a detector

Score a hypothesized outline (four table edges + net line) by mean
gradient magnitude under it:

- The true outline ranks FIRST against ~60 rivals (its own outline slid
  3–12% of the diagonal, rescaled, plus other frames' tables rescaled in)
  on 39/61 frames; top-3 on 56/61. An orientation-aware variant (gradient
  component normal to the edge) moves it to 40/61 and 57/61 — the same
  ceiling.
- The basin is razor sharp: slide the true outline by just 1% of the
  frame diagonal and the score halves (0.48); by 2% it is a third (0.36),
  then flat noise (~0.3) beyond.

Read together: the score cannot FIND the table in an open field — busy
gyms offer too many table-shaped gradient ridges — but once an outline is
within ~1–2% of the truth, the truth is a steep, unmistakable peak.

## The corridor search, built and measured: it does not ship

The promising basin led to a full Swift implementation (archived in
`2026-08-18-live-table-lock/`, with the harness that measured it — the
identical file was to be compiled into the app). Two designs, both run
against every corpus frame:

**Corridor search** (sweep the proven pose corridor, lock when the peak
clears the corridor's median by 1.6x): 1 true lock, 38 FALSE locks,
22 abstentions. The corridor median is a broken null — most corridor
outlines overlap the same central image region, and floor seams, barrier
lines and table-rim shadows sustain 2–4x "peaks" at wrong poses all day.

**Neighborhood confirm** (seed at a stance and only ask "does the image
agree, precisely where?", verdict from a matched null — the same outline
slid ±5% of the diagonal):

    threshold 1.8: seeded at TRUTH: 5 converge, 20 fire on wrong
                   corners, 36 stay quiet; seeded a metre WRONG:
                   44 of 183 fire anyway
    threshold 2.2: truth: 2 converge; wrong: 6 of 183 fire

No operating point separates real alignment from accident. Two causes,
visible in the per-frame numbers: the local refinement drifts off the
hand-marked outline toward stronger neighbouring gradients (the pink rim,
its shadow, the barrier line), and genuinely-correct alignments often
score matched ratios of only 1.1–1.6 — inside the false-fire band. The
sharp basin measured on the hand-marked outline is real, but it is a
property of the TRUE corner positions, and nothing classical measured
here can find those positions reliably enough to stand under a green
light. A wrong lock is worse than no lock. This closes edge-energy
locking in every form tried; do not re-propose it without a fundamentally
better signal.

## What stands, and the one path left

The build-8 ghost (eye-aligned, mined pose, corridor pinch, flip) stands
as the shipped guidance — nothing measured today weakens it.

Auto-alignment's surviving route is a small learned corner detector:
train on our own hand-marked corpus (61 frames plus every production
quad, augmentable from raw match footage), permissive backbone, Core ML.
That is weeks including data expansion and licence care, not days — and
it would also unlock the far-field coaching ("step back a metre") that
no classical approach came close to. Take it up when recordings made
with the ghost start showing calibration telemetry that eye alignment
isn't enough.
