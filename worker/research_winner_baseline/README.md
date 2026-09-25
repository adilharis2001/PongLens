# Fresh machine winner baseline

This isolated package recomputes the existing net, legal-shot/frame-exit and net-association decisions from machine observations. It supplies the upstream fields required by `research_winner_runtime`; it does not fit models, score outgoing flight, publish winners, change clips or run a live worker. The initial parity check reproduces all four upstream fields on 122 stored machine inputs.

## Boundary

```python
from research_winner_baseline import decide
baseline = decide(row, corpus)
```

| Input | Required meaning |
| --- | --- |
| `row.features` | Same original-source `start`, `end`, `width`, `height`, `fps`, chronological normalized `track` and machine `candidates` as the winner runtime. Optional boolean `placement_available` defaults to true. |
| `row.corners` | Pixel corners `A_near_1`, `B_near_2`, `C_far_2`, `D_far_1`. |
| `row.serve_s` | Optional machine-estimated source-clock serve time. No owner tap or serving identity. |
| `corpus.sequences` | Known net-sequence list, in chronological order, from the recording-wide machine detector. A sequence carries `first`, `last`, integer `n_bounces`, camera `half`, `bounces`, `arcs`, and nullable `net_motion`. |
| `corpus.crossings` | Known chronological recording-wide source-clock crossing seconds. |
| `corpus.provenance` | Nonempty description of machine evidence origin and coverage. The caller owns its accuracy. |

Each bounce requires `t`, table-metres `v`, and camera `half`; pixel `xy`, table-metres `u` and source `f` are retained only when supplied. Each arc contains `gap` and `rise_w`. Non-null net motion requires `t`, `in_wps`, `out_wps`, boolean `absorbed` and `reversed`; optional table-metres `u,v` are retained. Counts and sequence times must agree with their bounce records.

Known empty lists are valid negative evidence. Missing/malformed corpus, event input or calibration returns `status='unavailable'` without the five required baseline fields, so the downstream scorer abstains instead of interpreting missing context as negative evidence. Available results contain `existing_net`, `legacy`, `new_net_association`, `net_veto`, `provenance` and machine-only `diagnostics`.

Contact recovery uses `research_contact_recovery.recover` directly, followed by the original same-shot analysis. The supplied `row.contacts` is not trusted or used. Point IDs, scores, winners, labels and unknown metadata are discarded; `idx=0` is a constant needed only by the extracted diagnostic schema. As in the original fresh baseline, recording `serves` are **not used**; only `row.serve_s` gates early sequence timing. No missing clocks, corners, contacts or model artifacts are inferred.

## Frozen extraction

| Module | Original pure definitions |
| --- | --- |
| `reversal.py` | `reversal_baseline.CONFIG`, `predict` |
| `stroke.py` | `stroke_boundary_v1.predict`, importing portable recovery |
| `same_shot.py` | `same_shot_v1_1.CONFIG`, `connection`, `analyze`, importing identical portable geometry |
| `phase.py` | `phase_gate_v1.CONFIG`, `decide` |
| `priority.py` | `run_same_shot_v1_1.NET_VETOES`, `predict` |
| `frame_exit.py` | `frame_exit_v1.CONFIG`, `departure`, `additional` |
| `association.py` | `net_event_association.CONFIG`, `decide` |
| `net.py` | Existing cloud-twin `net_endings` winner constants, timestamp validator, sequence eligibility, proposal selection and winner prediction; no tracking or card-mutating functions |

The eight pure modules comprise 444 lines. Functions/constants are AST-identical to their sources; imports are portable and the new public boundary validates/allowlists inputs. NumPy, `research_contact_recovery`, and the winner runtime's input normalizer are dependencies. There are no private-path imports, filesystem/network calls, database clients, fits or threshold selection.

The orchestration follows the fresh `terry_detector_transfer.evaluate.baseline` rule path, with outgoing model inference left to the existing downstream scorer. `legacy` intentionally includes the existing-net winner when that branch wins, matching the original contract. `net_veto` preserves the three original reason strings and controls outgoing eligibility downstream.

## Verification and limits

| Check | Result |
| --- | --- |
| Synthetic tests | 8 pass: net award, stale-net crossing veto, known-empty versus unavailable input, nested validation, calibration failure, frame departure, metadata exclusion and immutability. |
| Fresh original function parity | 122/122 exact for `existing_net`, `legacy`, `new_net_association`, `net_veto`. |
| Stored historical baseline comparison | All four upstream fields match on these same 122 inputs. |
| Models fitted or thresholds selected | None. |
| Live integration or release | Not performed. |

The private parity harness separately loads only the original pure AST definitions, bypassing research imports/drivers and their side effects. Source hashes, symbol proofs, inputs and results remain in the private pilot `baseline-runtime` directory. Historical equality here covers these recordings and stored contexts only; it does not establish full-detector parity on fresh videos or equivalence for other cached baseline versions. Caller-supplied whole-recording sequences/crossings remain an upstream dependency; a union of selected point windows must be identified as partial context.
