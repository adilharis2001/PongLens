# Pose-assisted last-bounce review

The primary pose experiment matched 32 of 50 existing last-bounce marks versus 28 of 50 for ball evidence alone. The new immutable research run provides 479 review suggestions, including 286 with pose and 193 using ball-only fallback. Existing human labels and previous winner predictions are preserved; ranking margins are not calibrated correctness probabilities.

| Recording | Points using pose | Ball-only fallback |
|---|---:|---:|
| Lester | 103 | 0 |
| Yu Yu Lin | 91 | 0 |
| Julian August 23 | 75 | 0 |
| Prabhas | 17 | 36 |
| Ishan | 0 | 69 |
| Chris August 22 | 0 | 88 |

| Mark definition | Reference |
|---|---|
| Long/wide failed return | Last legal table bounce on the hitter’s side before the failed shot |
| Long/wide failed serve | Server-side first bounce if the receiver’s side was missed |
| Failed net shot | Legal table bounce before the failed shot, excluding dead-net bounces |
| Winner/missed return/double bounce | First bounce on the receiver’s side, excluding the terminal second bounce |
| None occurred / cannot locate | Separate optional review outcomes |

| Verification | Evidence |
|---|---|
| Frozen primary replay | All 50 candidate selections/features identical; 32 match existing marks |
| Corpus replay | 479 independent predictions, eight refits, 18 penalty fits; annotation-poison check; byte-identical regeneration |
| Production payload validator | All 479 accepted by TypeScript validator |
| Research tests | 267 TypeScript tests; four mounted form/performance tests; 48 Python research tests |
| Build | Full npm run build passed on isolated checkout |
| Visual reference | Existing shipped PointEndingReview and RallyPredictionReview, rendered and source inspected |
| Desktop and mobile web | Actual bundled components rendered on desktop and 393×660; guide, result table, pose/fallback states, confirmation, explicit clearing, uncertainty and reload persistence checked; no horizontal overflow on mobile |
| Native / worker | Unchanged; not tested |

Private reproducibility bundle: `out-ball-private/pose-corpus-review-v1` in this task’s artifact directory. Run ID: `pose-last-bounce-20260924-v1`. Prediction SHA256: `62b771439616c5e1a0543d171dc651bb7c0d1f8e201a96f426caef6fce47b92e`.

The intended live-bounce definition is a review convention; ranking does not yet guarantee candidate semantics. Missing true bounces, floor detections, dead-net bounces and terminal second bounces can still be ranked incorrectly. Existing labels were not silently changed to fit the convention. Review unmarked Julian points first, then unmarked Lester and Yu points, to measure results beyond the original 50.
