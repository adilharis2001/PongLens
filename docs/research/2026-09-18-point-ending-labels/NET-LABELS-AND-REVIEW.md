# Net labels and annotation checkpoint

Net clipping labels contact with the net; Net bounce labels table bounces after a failed net shot has ended play, as the owner clarified. Table bounce is the general in-play contact category, with serve detail optional; existing rally labels remain valid but the redundant choice is hidden for new annotations. The September 22 snapshot supports focused tests and a smaller labeling request, not a new scoring-accuracy claim.

| Match | Ending labels | Points with contact annotations | Contact annotations | Both last table bounce and last paddle side |
| --- | ---: | ---: | ---: | ---: |
| Lester | 51 | 25 | 74 | 4 |
| Prabhas | 17 | 12 | 74 | 7 |
| Yu Yu Lin | 25 | 16 | 105 | 5 |
| Other three matches | 14 | 0 | 0 | 0 |
| Total | 107 | 53 | 253 | 16 |

| Observed in owner-selected annotations | Interpretation / test |
| --- | --- |
| 46 other-table events, 30 Yu Yu Lin and 16 Prabhas | Test target-table and ball-path continuity before interpreting endings; 2D table membership alone does not establish contact |
| 18 paddle events across 13 points; 15/17 with a preceding detected marker within 0.4s | Short-gap signal worth testing with same-side geometry and continuous ball path. These measurements are not yet restricted to same-side pairs |
| 20/81 explicitly labeled table/serve detections with a preceding marker also within 0.4s | A timing-only paddle rule would reject genuine contacts |
| 21/26 labeled floor events before end tap | Tap is not a hard rally-end boundary; floor contact precedes the delayed tap in these cases |
| 32 manually added table/serve contacts; 30 have a stored track sample within one frame | Test local contact classification, without assuming a nearby sample belongs to the correct ball |
| 10 table/serve annotations later than marked last bounce across 5 points | Review semantics with new net/non-rally labels: Lester3; Prabhas1,4,9,13. Preserve current labels until owner review |
| Prabhas4 note: marker3 net contact, marker4 legitimate table contact after clip; Prabhas11 note: marker7 net clip followed by long ball | Net clipping alone must not imply the point ended or change its ending reason |
| 33 ending-labeled points in existing 146-point strong-path, unscored pool: 15 long, 10 missed return, 7 net, 1 custom | Existing labels already support a final-exchange evaluation; do not divert into service-fault edge cases |

| Next labeling checkpoint | Request |
| --- | --- |
| Budget | 20 already ending-labeled points: 10 Prabhas and 10 Yu Yu Lin lacking either last-table-bounce or last-paddle-side detail |
| Prabhas candidates | 1, 2, 3, 5, 6, 10, 17, 24, 36, 55 (display point numbers, not contiguous corpus indices) |
| Yu Yu Lin candidates | 1, 2, 5, 6, 7, 8, 9, 10, 14, 15 |
| Required for useful checkpoint, optional in UI | Add those two final-exchange details when visible; skip uncertainty |
| Additional work | Only correct/add misleading contacts around the final exchange; no exhaustive relabeling of every serve or rally bounce |
| Freeze | Analyze a revisioned snapshot after this batch; retain subsequent corrections for the next snapshot |
| Evaluation | Report selective winner accuracy, accepted coverage and endpoint error per match on held-out data, not annotation-frequency percentages |

| Release check | Evidence |
| --- | --- |
| Storage | New `net_clip`, `net_bounce`; existing optional JSON/revision/history; neither can be last rally bounce; no automatic cause edits |
| Compatibility | `rally` preserved for old records/clients, selectable when already present; table/serve/rally remain accepted table-contact family |
| Tests/build | 247 research tests passed and full build passed; extended enum test failed before code change |
| Review | Independent review and ESLint passed without actionable findings |
| Browser | Same shipped BounceDetails styling; mobile393×660 and desktop1024×900; 44px fields, no overflow; new net labels save/reload independently of ending cause; table/serve help and preserved legacy rally rendered; local fixture saves with media disabled |
| Scope | No production annotation rewrites, worker changes or native iOS changes; video playback not reverified |

Private snapshot, analysis script output and annotation notes are stored outside the repository under `out-ball-private/label-review-20260922`. Counts describe selected annotations, not prevalence across all points or model accuracy. The 107 ending labels are a separate population from the older 107 automated suggestions.
