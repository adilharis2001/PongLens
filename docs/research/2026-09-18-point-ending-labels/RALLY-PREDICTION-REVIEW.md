# Review trajectory last-bounce predictions

Every study point has a separate frozen experiment record, with a last-bounce suggestion where the sequence can supply a frame. Human marks remain unchanged until an explicit correction or confirmation. Winner confidence is shown as an uncalibrated model score with its cutoff, not a probability of correctness.

| Corpus | Result |
| --- | --- |
| Private immutable run | `rally-review-20260923-v1`, 479 records |
| Detected last-bounce proposals | 374 |
| Trajectory frames without matching detected marker | 89 |
| No last-bounce proposal | 16 |
| Hybrid winner model | 273 calls; 478 available scores; one unavailable |
| Combined with the preserved earlier scorer | 297 calls; earlier decisions take precedence |
| Human labels at import | 115 ending labels; every research/history row preserved |

| Review action | Behavior |
| --- | --- |
| Open a point | No label write; show the experiment beside existing answers |
| Confirm detected last bounce | Save only last-bounce choice and new-run review provenance |
| Confirm inferred bounce | Add that frame as a table bounce and set it as last, explicitly |
| Existing human last-bounce mark | Confirmation cannot replace it; keep it or use the existing bounce editor to correct it |
| Choose a different bounce | Open existing optional bounce editor |
| Cannot identify | Mark this experiment reviewed without adding a last-bounce label |
| Correct a mark | Preserve original prediction; record human choice in normal revision history |
| Older category contradicts saved last bounce | Suppress the conflicting pending category and its confirmation action |
| Last bounce to review | Filter and next-point navigation include already-labeled points |
| Older tab saves | Preserve new optional review metadata when omitted; normal revision conflicts remain enforced |

| Confidence | Meaning |
| --- | --- |
| Winner model score | Frozen hybrid logistic score and recording-held-out cutoff |
| Last-bounce sequence agreement | Retained sequence weight choosing a bounce within two frames; not calibrated accuracy |
| Earlier scorer | Separate prediction displayed in explanation; never given the hybrid model's confidence |
| Production scoring | No user scores or cuts changed; research review only |

| Verification | Result |
| --- | --- |
| Frozen lineage | All 479 source/evidence records equal experiment snapshot |
| Application payload validation | All 479 pass; detected IDs and raw clock mapping checked |
| Mapping tests | 5 passed, including raw offset, unresolved landing time, out-of-window rejection and metadata poisoning |
| Research tests | 264 passed |
| Mounted form/performance tests | 4 passed; explicit saves, human mark preservation, conflicting old category, idle playback work unchanged |
| Independent review | One UI conflict fixed; no remaining important findings |
| Full build | Passed on current main `833a31fe` plus this change; existing unrelated lint warnings |
| Browser | Desktop 1365×900 and mobile 393×660; confirmation, inferred frame, existing mark, unresolved candidate, correction and reload checked |
| Phone | No page overflow; new action buttons 327×44 pixels |
| Not verified in local form preview | Media playback disabled; native iOS unaffected |
| Database | Import committed 479 rows; exact label/history digest and previous suggestions unchanged; no migration needed |
| UI release | Prepared; awaiting required screenshot approval |

Private inputs, predictions, import verification and review previews remain outside the public repository. Do not treat the model's proposals or assisted confirmations as independent blind ground truth in later accuracy evaluations.
