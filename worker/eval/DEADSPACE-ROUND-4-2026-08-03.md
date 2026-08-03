# Dead-space round 4 — 2026-08-03 (cut assembly)

Goal set by Adil: approach the ~25-30% retention of the competition
(BetterPlay renders a 20-min match as 5-6 min). Ours measured 82-99%
across every real match.

## The finding rounds 1-3 walked past

Rounds 1-3 attacked FALSE-POSITIVE POINTS (and proved audio, pose and
crop/zoom all fail there — see DEADSPACE-ROUND-2026-07-29.md). But the
retention problem is mostly not FPs. Two separate diseases:

1. **Assembly.** The cut kept whole ACTIVITY SPANS, merge gap 2.2s — and
   the ball is usually still moving between rallies (retrieval, pre-serve
   bouncing), so spans chain into near-continuous blocks. The pipeline
   already computed per-play windows and threw them away at assembly.
2. **Window fatness.** Detected t0..t1 windows sum to 55-85% of the
   source; real amateur rally time is ~25-35%. Dead motion chains onto
   rallies inside the windows. UNTOUCHED by this round — it is the next
   one (rally-core trimming off fitted-track hits/bounces, then serve
   anchoring via the temporal serve model).

## What round 4 shipped

`--cut-mode plays`: the points stage emits `cut_segments` built from the
PRE-VETO play list (vetoed footage stays watchable; only never-play time
is removed), `cmd_cut --segments` cuts exactly those windows, and the
worker runs points BEFORE the cut (span-cut fallback if the points stage
crashes). SEGMENT_PADS >= CLIP_PADS is the load-bearing invariant
(clips/reels/seeks anchor at t0-clip_pre) and is unit-tested.

## Referee run (validate_play_cut.py, Vinay 24-min match, 921MB source)

    point parity : 150 vs 150 — IDENTICAL t0/t1 (also identical to the
                   production DB rows for job 32edf621: first 2.97,
                   last 1439.49)
    spans cut    : 1229.8s  (85.3%)   48 segments
    plays cut    : 1007.7s  (69.9%)  104 segments
    cut_t0       : monotonic, in range

DB simulation across all matches: median ~88% -> ~74%; best case
(Thanakorn #2, fragmented windows) 99% -> 42%.

## Scoreboard toward ~30%

    round 4 (assembly)      82-99% -> ~70-75% median   SHIPPED
    round 5 (core trimming) target ~40-45%             next
    round 6 (serve anchor)  target ~30-35%             needs temporal
                                                       serve model

Competitive note: BetterPlay's rally detection is a learned temporal
model trained on "tens of thousands of minutes" (their copy) — the moat
is the corpus, not the algorithm; TTNet (arXiv 2004.09927) is the public
blueprint. Our user curation (delete/split/score) is the same kind of
labeled data and accumulates with every match.
