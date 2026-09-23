# Offline review suggestions

The generator produces separate, tentative machine suggestions for all 479 research points and every detected bounce marker. It excludes the entire target recording from all training and never changes a human answer. These new ending and contact annotations have not been accuracy-validated; the earlier winner-scoring percentages do not measure their quality.

| Output from the frozen September 22 snapshot | Count |
| --- | ---: |
| Points represented | 479 |
| Detected markers represented | 3,604 |
| Tentative ending reasons | 410 |
| Unresolved ending reasons | 69 |
| Tentative marker categories | 3,086 |
| Unresolved marker categories | 518 |
| Tentative last paddle sides | 447 |
| Tentative detected last table bounces | 476 |

| Suggested ending | Count |
| --- | ---: |
| Long | 183 |
| Net | 122 |
| Missed return or winner | 105 |

| Suggested marker category | Count |
| --- | ---: |
| Table | 2,411 |
| Other table | 310 |
| Floor | 204 |
| Paddle | 113 |
| Non-rally | 43 |
| Other non-bounce | 4 |
| Ball handling | 1 |

| Decision | Implementation and limitation |
| --- | --- |
| Inputs | Frozen machine trajectories, existing detected events, machine paddle contacts, machine serve estimate, approved table corners and historical point windows |
| Excluded inputs | Saved winners, scorekeeper taps, notes, custom text, owner side labels, owner endings and owner last-bounce marks from the target recording |
| Ending model | New one-versus-rest classifiers over the existing raw 54-value sequence features; the previous experiment predicted winners, not ending causes |
| Event model | New one-versus-rest classifiers over the existing 21 motion/geometry features; explicit detected-event category labels only |
| Table terminology | Table, serve and rally labels collapse to table because the human labels were used interchangeably |
| Fitting | Existing unweighted logistic implementation with ridge penalty 0.1; all preprocessing and category support counts use training recordings only |
| Category support | At least five examples across at least two training recordings; unsupported known categories remain negative examples but cannot be suggested |
| Abstention | Highest raw model strength at least 0.35 and at least 0.05 above the next supported category; these fixed review heuristics are not calibrated probabilities or accuracy targets |
| Last paddle | Latest actual machine paddle candidate passing the existing table-position filter; never a bounce fallback. Missing final strokes and post-rally activity remain possible |
| Last bounce | Separate 26-feature selector: the 21 event features plus window-end age, earlier/later marker counts, time from last plausible paddle and marker count. Trained on the 37 owner-selected detected last bounces, excluding the target recording; each annotated point supplies one positive and its other detected markers as negatives |
| Last-bounce selection | Highest selector score among markers tentatively classified as table. No calibrated confidence threshold; a wrong table category or missed bounce can make this wrong |
| Added bounces | Five manually added last marks and all other added events are excluded from detected-event training. The generator does not create missing markers |
| Marker sides | Table-half projection for table, non-rally, net or paddle suggestions; null for floor, other-table, handling and unresolved categories |
| Human answers | Predictions are a separate payload without notes. Insertion must skip the entire previously touched point; accepting or correcting remains a review action |
| Surfaces | Offline script only. No worker, web, iOS, database, media or production changes in this generator |

| Verification | Result |
| --- | --- |
| Algorithm and contract tests | Eight tests passed: geometric learning, unsupported classes, abstention, real-paddle-only selection, index alignment, metadata exclusion, whole-recording training exclusion and reference validation |
| Target-label perturbation | For each of six recordings, poisoned every target ending, note, last paddle and last bounce/event label, then refit. Predictions and full fitted states remained identical |
| Metadata perturbation | Poisoned winner, tap, note and previous-result fields; machine features remained identical |
| Evidence identity | All 3,604 markers uniquely matched frozen machine candidates by timestamp and pixel coordinates; output references preserve the stored evidence array's indices |
| File integrity | SHA-256 hashes of frozen input files and feature/model source unchanged after generation |
| Not verified | New annotation accuracy, missing-event recovery, physical point-end timing, deployment behavior or external-recording performance |

| Private artifact | Purpose |
| --- | --- |
| `out-ball-private/review-suggestions-20260922/predictions.json` | Array of `{point_id, payload}` for the review importer |
| `out-ball-private/review-suggestions-20260922/folds.json` | Exact training point/event IDs, recording exclusions, support counts and fitted models |
| `out-ball-private/review-suggestions-20260922/verification.json` | Input/source hashes, exclusion tests and prediction digest |
| `out-ball-private/review-suggestions-20260922/summary.json` | Counts only; no accuracy claim |

```sh
python -B scripts/research/generate-point-ending-suggestions.py \
  --experiment /path/to/frozen/contact-informed-scoring/experiment.py \
  --snapshot /private/path/label-followup-20260922/latest.json \
  --inputs /private/path/long-out-confidence-v1/inputs.json \
  --output /private/path/new-review-suggestions

PONGLENS_EXPERIMENT=/path/to/frozen/contact-informed-scoring/experiment.py \
  python -B scripts/research/test_point_ending_suggestions.py
```

| Reproduction rule | Requirement |
| --- | --- |
| Python runtime | Use the existing TTVid virtual environment with NumPy/SciPy; always `-B` |
| Output | Must be a new private directory; the script refuses any existing output directory |
| Publication | Commit code and this method record only; never commit the private snapshots, predictions or fold files |
