# Pose features + audio, leave-one-scene-out

**Gate B fails.** The combined (audio + pose) feature set does not beat the
audio-only 4.6% by ten points at the required floor. The best honest
combined candidate at >= 99% worst-scene kept recall removes **4.9%** of
mid-match junk (RANK pair `n_onsets & ioi_cv<=`, worst recall 99.18%) --
and that rule is pure audio. At the floor that matters, pose contributes
nothing the audio did not already have.

This is the same failure mode as the audio study and the reverted
match-structure rollout: real pooled signal, no cross-scene transfer.

## Data

Join: pose windows (RTMPose COCO-17 @ 3 fps, `pose/<key>.json`) matched to
`features_audio.json` mid-match rows on (key, t0 +- 0.2 s). 1948 mid
windows across 21 matches -- 305 junk, 1643 kept -- in the same 11 scenes as
the audio study. 439 audio windows have no pose file (`chris_d3c7`,
`ishan_4c13`, `jake_cb0e`, `m_4481`, `ryuchi_16ed`); every scene stays
represented. `vinay_5721` reads `vinay_2ffe`'s pose (identical footage).
17 windows disagree on the junk label between the two pipelines -- the
known duplicate-scoring noise; the audio-side label is used.

## Pose features (features_pose.py)

Per window: `p_n_near` (mean persons near table), `p_bilateral` (fraction
of frames with exactly one person per table end), `p_pitch_mean` (torso
shoulder->hip angle vs vertical), `p_wrist_max` (max wrist speed,
person-heights/s), `p_lat_energy` (mean squared horizontal hip speed).

Geometry lessons that cost a round each:

- A fixed expansion of the calibration quad cannot say "near the table":
  perspective puts the near player's feet hundreds of pixels below the
  quad. Near = distance-to-quad <= 1.1x the person's own bbox height.
- A net line drawn in the table plane cannot split players either -- feet
  live on the floor and all project below it. Side = nearer table END
  edge (A-D vs B-C).
- Speeds are normalised by the person's own height, not table length, so
  near and far players compare fairly.
- **`jason_5bd2`'s calibration quad is not on the table.** `calib_debug.jpg`
  shows it floating around the room; `calibration.ok == true` is not proof.
  Blacklisted (image-half fallback). The other nine quads check out
  visually (`quads_all.jpg`).
- 9 of 26 keys have usable quads; the rest use the image-half fallback
  (side by x vs W/2, near by relative person size).

Sanity: `p_wrist_max` is higher on kept windows for 25 of 26 matches, and
`p_pitch_mean` is higher on kept for most -- players lean into rallies and
straighten up to fetch balls, so "bending = retrieval" is backwards as a
universal, but the per-match direction is consistent. The signal is real.

## Results (train floor 99%, worst held-out scene recall)

| candidate | cut of mid junk | worst recall | honest? |
|---|---|---|---|
| RANK pair `n_onsets & ioi_cv<=` (audio only) | **4.9%** | 99.18% | yes |
| logistic combinedR (3 feats) | 10.2% | 97.56% | no |
| logistic combined RAW (3 feats) | 15.1% | 93.44% | no |
| logistic audio-only RAW (subset) | 11.8% | 93.44% | no |
| logistic pose-only RAW | 7.2% | 82.11% | no |
| best pose single, RAW (`p_wrist_max`) | 8.5% | 92.68% | no |
| best pose single, RANK (`p_wrist_max`) | 6.9% | 98.11% | no |
| depth-2 tree combined | 0.0% | 100% | degenerate |

Every fold's logistic picks `p_wrist_max` third behind `n_onsets` and
`max_gap_frac` -- the model wants the pose signal, and it does lift the
pooled cut (11.8% -> 15.1% RAW, and at a 97% train floor 25.9% -> 32.8%).
But the worst scene never clears 99%: pose thresholds calibrated on ten
scenes misfire on the eleventh, exactly like every prior cross-scene
attempt. The relaxed view: at >= 97% worst-scene recall the best combined
candidate (logistic combinedR) reaches 10.2% vs 7.5% for audio-only -- a
real but small gain, nowhere near Gate B.

Scene S03 (`may_1466`, cut-source) is still the recall-killer for RAW
models; RANK models survive it but flatten the pose features'
between-match scale differences that carried most of their pooled signal.

## Pre-selection operating point (FYI)

Pooled out-of-fold combined logistic, threshold at 50% of junk caught:
precision **48.4%** (153 junk / 316 flagged), worst-scene kept recall at
that point 68.9%. Statistically indistinguishable from audio-only (47.7%).
Pose does not improve the pre-marked-cards use case either.

## Verdict

Do not add a pose stage to the dead-space pipeline. Five features, honest
geometry handling, and per-fold selection all agree with the 2026-07-30
match-structure revert: pose signal pools well and transfers badly. If the
30% retention goal needs more than audio, the serve detector (Kind 3 note)
remains the unexplored direction with a mechanism-level reason to
generalise, unlike scene-calibrated thresholds.

Artifacts: `features_pose.py`, `features_pose.json`, `analyse_pose.py`,
`analysis_pose_results.json`, `analysis_pose_run.log`, `quads_all.jpg`.
