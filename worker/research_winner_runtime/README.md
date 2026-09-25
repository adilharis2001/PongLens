# Copied-worker winner runtime

This package performs inference from copied machine observations, without importing research scripts or reading files, labels, scorecards, owner taps or network services. It recomputes the contact classifier, robust trajectory, competing rally histories, 66-feature hybrid score and outgoing-flight score. It is an offline research boundary, not a deployed match-worker feature or a complete raw-video pipeline.

## Worker boundary

Call `score_point(input, artifact, baseline, allow_evaluation=False)`. The package depends on NumPy only. `python -B -m research_winner_runtime` reads one JSON object with those three named objects from stdin; `--allow-evaluation` is required for held-recording fixtures. The subprocess returns a separate result contract; do not label it `net_low_bounces` or send it through the existing net-only publisher.

`input` is explicitly allowlisted:

| Field | Contract |
| --- | --- |
| `features.start`, `features.end` | Immutable point window, seconds on original source clock. |
| `features.width`, `height`, `fps` | Original image dimensions and original nominal feature FPS. FPS is used only by the inherited feature rules; source observation times are not replaced by frame/FPS. |
| `features.track` | Chronological, unique `[source_seconds, x / width, y / height, detector_confidence?]`. Coordinates normalized once. Confidence retains the source detector's scale; it is not required to be a probability. |
| `features.candidates` | Chronological machine events. `kind` is bounce/contact; `t` is source seconds; `x,y` are source pixels; optional `side` is camera near/far. Optional `u,v` retain physical table metres, 1.525 by 2.74, with near half at `v <= 1.37`. `visual_confidence` retains the original event confidence. |
| `contacts` | Chronological machine paddle hypotheses **after upstream recovery and geometry analysis**, in the same event schema. Raw contact candidates are not an equivalent replacement. |
| `corners` | Source pixel pairs keyed `A_near_1, B_near_2, C_far_2, D_far_1`. |
| `serve_s` | Optional machine-estimated serve time on the same source clock; never owner-confirmed serving identity or tap time. |

The runtime does not sort, repair coordinates, offset clocks, widen windows, or recover contacts. Unknown metadata is discarded before feature extraction. Invalid required input or absent track yields explicit abstention. Missing upstream branch outputs cannot silently become negative evidence.

`baseline` requires `existing_net`, `legacy`, `new_net_association` (each camera near/far or explicit null), boolean `net_veto`, and nonempty `provenance`. The original branch priority is **existing net → newly computed outgoing → legacy legal/exit → new net association → hybrid → abstain**. Existing net and net-veto states gate outgoing inference exactly as before. Legacy includes the original same-shot/frame-exit result; it is not a truth label.

Upstream obligations remain: ball detector and candidate extraction; machine contact recovery; full-recording net sequences/crossings and their rule decisions; correct table corners, source clock and immutable point windows. Passing frozen upstream decisions verifies this boundary but does not prove fresh whole-pipeline parity. The caller is responsible for supplying machine provenance honestly; strings cannot authenticate how evidence was produced.

## Exact feature and model contract

`contact.py` exposes the ordered 21 `BOUNCE_NAMES`. Contact logistic scores use the unchanged `>= 0.1` keep rule. The reference side is the latest geometrically eligible machine contact, otherwise latest on-table bounce candidate (before classifier rejection).

The ordered hybrid input is:

| Zero-based indices | Values |
| --- | --- |
| 0–4 | Has latest eligible contact; contact count; kept event count; kept on-table count; rejected event count. |
| 5–19 | Last three kept bounce events, newest first: reference-relative side, outside distance, distance to net, age to window end, delay from latest contact. Missing events contribute five nulls. |
| 20–27 | Last two eligible contacts, newest first: reference-relative side, visual confidence, age to end, delay from latest kept bounce. Missing contacts contribute four nulls. |
| 28–30 | After-contact kept bounce counts: receiving side inside, same side inside, outside. Null without contact. |
| 31–49 | Ordered 19 `flight.NAMES`, with rejected bounce candidates removed and unchanged machine contacts. Null when no eligible connected flight. |
| 50–53 | Rejected bounce count and latest age for reference side, then opposing side. |
| 54–65 | Ordered 12 `history.NAMES`, multiplied by +1 for near reference and −1 for far reference. |

The trajectory is recomputed from time and observed source pixel positions, without events, point end, serve, score or annotation inputs. History uses the frozen trajectory/event interpretation and beam constants. This contract uses no pose; the original Julian pose-assisted branch is not covered by the 122-point parity claim.

Logistic preprocessing replaces missing/nonfinite features with frozen medians, appends one missingness indicator per original feature, standardizes with frozen means/scales, then applies frozen coefficients/intercept and sigmoid (or a frozen constant model). `raw_score` estimates the model's reference-side class, and `decision_score = max(raw_score, 1-raw_score)` is compared to the frozen hybrid threshold. Neither this number nor the outgoing score is a calibrated probability of the final branch decision. Baseline calls can win even when the hybrid disagrees.

Artifacts must specify contract `copied-worker-winner-v1`, purpose, provenance, pose `none`, 21-feature `contact_model`, 66-feature `winner_model`, `selection.threshold`, and `outgoing.model` (19 features) plus `outgoing.selection.threshold`. There is no fit or threshold selection implementation here. `held_recording_evaluation` requires explicit opt-in; `unseen_recording_research` marks a separately supplied research model and does not grant deployment approval.

## Extraction provenance and remaining release work

Pure functions/constants were extracted from these existing research sources, with local imports replacing research imports. The history track array now explicitly selects time/x/y so optional per-observation confidence cannot create a ragged array; all numerical history rules remain unchanged:

- `2026-09-16-out-ball-endings/same_shot_v1_1.py`: geometry.
- `2026-09-16-out-ball-endings/long_out_confidence_v1.py`: outgoing-flight extraction; fitting and threshold tuning omitted.
- `2026-09-22-contact-informed-scoring/experiment.py`: contact and 54-feature sequence extraction; all private-file access and experiment driver omitted.
- `2026-09-23-rally-continuity/trajectory.py`: trajectory reconstruction.
- `2026-09-23-rally-continuity/sequence_model.py`: history decoder and 12-feature summary.

Source hashes, original 122-point machine fixtures, models, expected results and replay evidence stay in the private pilot directory, not this package. The Ishan/Prabhas artifacts excluded their respective recordings and must not be selected for arbitrary new recordings. An earlier all-six transfer research fit exists separately; this extraction neither creates nor certifies a general production artifact. General artifact packaging/training provenance, fresh upstream parity, worker integration, publication semantics, additional-recording validation and normal Mac/cloud release gates remain separate work.
