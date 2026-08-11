# Temporal context on top of the audio model — leave-one-scene-out

Run: `analyse_temporal.py` (log `analysis_temporal_run.log`, machine results
`analysis_temporal_results.json`). Base = the audio study's best model
(`analyse_audio.py`; pose added nothing at the floor, per `analysis_pose.md`).
Same 11 scenes, same dedup, same mid-only rows: 2387 windows, 389 mid junk,
1998 kept. Baselines were reproduced bit-identically inside this harness
before adding anything (RANK `ioi_cv` single, tf 0.995: 4.6% @ 99.07% — the
exact base-study headline).

## Verdict

**Temporal context adds exactly nothing at the 99% floor. Marginal gain:
0.0 points.** The best honest candidates (>= 99% worst held-out scene kept
recall) all land at **4.6% cut / 99.07% worst recall** — and every
floor-passing "context pair" (`ioi_cv<= & roll3>=`, `ioi_cv<= & gap_min>=`,
etc.) was checked window-by-window against the base rule: **bit-identical
masks, same 18 junk windows, zero extra kept losses**. The context threshold
is parked at an extreme; it is the degenerate-pair artefact from the ball and
audio studies wearing a new feature.

At the 97% floor context is actually *below* baseline: best temporal
candidate 10.0% (`pair s>= & gap_max<=`, worst 97.54%, and it strands one
real point) vs the plain RAW `ioi_cv` single at 11.8% @ 98.06% in the same
folds (12.3% for the base study's rhythmicity pair).

## Did any real points become losses?

Yes — under hysteresis, exactly the predicted failure mode:

- `hysteresis ctx fwd` (RANK, tf 0.995): 3 kept windows lost, **2 of them
  stranded** — real points inside a run of junk-scored windows, swallowed by
  run extension (both in `may_1466`). And for that price it cuts only 2.1%.
- `pair s>= & gap_max<=` (RAW, tf 0.99, 97-floor): 1 stranded kept loss.
- Every honest threshold/conjunction candidate at the 99% floor: **0
  stranded**. The base rule's 8 kept losses are all isolated windows with a
  real point on at least one side.

So run-extension smoothing converts its few extra cuts directly into the one
error class the product cannot afford. Bidirectional hysteresis was uniformly
worse than forward.

## Why context failed here

1. **The junk-clusters premise is weak in the deduplicated labels.** Mid
   junk forms 300 runs with mean length **1.39**; 242 of 300 are singletons.
   The "game breaks average 4+ junk" picture describes a handful of long
   runs (two of length 7, one 11, one 13), which the base score already cuts
   parts of; the mass of junk is isolated single windows between real
   points.
2. **Kept points live inside junk neighbourhoods.** 106 kept windows have
   junk on both timeline sides. Any feature that scores a window by its
   neighbours (roll3, hysteresis) raises exactly those windows' junk scores.
3. **The gap features cannot separate either.** 76% of junk sits within 10s
   of real play, so junk shares the kept points' gap scale; meanwhile the
   last kept point before a game break has a huge `gap_next` and the first
   kept point after it a huge `gap_prev` — the context features are wrong
   precisely at the break boundaries where the junk is.
4. **Pooled lift exists, transfer does not** (the study's recurring
   pattern): at tf 0.97 the RAW ctx logistic reaches 26.2% pooled vs 23.1%
   for the base logistic (+3.1), but its worst scene collapses to 87.7%.
   Context helps on average and misfires on the held-out scene, exactly like
   raw pose and raw audio thresholds.

## What was built (for the record)

Per fold (leave-one-scene-out, train floor swept over 0.97/0.99/0.995/0.999,
RANK and RAW variants): 3-feature logistic junk-score `s` for every window;
"confidently a rally" = `s` <= median of train kept scores; per match along
the timeline: `gap_prev`/`gap_next` = seconds from the window to the
nearest confident-rally window's edge (capped 120 s), `roll3` = 3-window
rolling mean of `s`, plus `gap_min`/`gap_max`. Candidates: ctx logistic
(s + 5 context features), all s-and-context and ioi_cv-and-context
conjunctions, roll3 alone, and hysteresis (T_hi enters a cut run, T_lo
sustains it; forward and bidirectional; grid fitted on train under the
floor). All fitting on train scenes only; context computed from scores only,
never labels.

## Pre-selection operating point (FYI)

Flagging the top-scored windows until 50% of junk is caught, pooled OOF:
RAW base logistic 47.7% precision; RAW ctx logistic **44.9%** — context
makes the pre-marked-cards use case slightly *worse* (it spends flags on
break-adjacent kept windows). RANK variants: 36.5% / 36.4%.

## Where this leaves the ladder

Audio 4.6% -> +pose 4.6% (nothing) -> +temporal context 4.6% (nothing, and
the smoothing variants create stranded-point losses). Three modality/context
rungs in a row show the same signature: real pooled signal, no worst-scene
transfer. The remaining direction with a mechanism-level reason to
generalise is still the serve detector (Kind-3 note): detect the serve
motif that *starts* a real point rather than scoring windows by their
surroundings.
