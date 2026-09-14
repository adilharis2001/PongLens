# Combined cuts worker candidate

The reviewed combined policy now runs before the real worker exporter, with only three preparation-only prefixes removed from the reviewed proposal. Nine cached full-recording replays preserve every other reviewed window within 0.03 seconds of frame rounding, and disabling the option reproduces all previous exported point records exactly. This branch is a local release candidate; three corrected examples still need owner review before deployment.

| Recording | Previous cards | Candidate |
| --- | ---: | ---: |
| 19a1efc7 | 114 | 124 |
| 50caea29 | 86 | 88 |
| 6d55dfb7 | 57 | 69 |
| 8cb54f9f | 106 | 111 |
| 9e15ed10 | 66 | 67 |
| 9ef09000 | 65 | 78 |
| d59d7610 | 90 | 94 |
| eabb4fc2 | 50 | 64 |
| fa96cd0e | 61 | 64 |

## Runtime contract

| Area | Behavior |
| --- | --- |
| Activation | Explicit job option `combined_cuts: true`, forwarded only for bodies with both edge options; default unchanged. Combined policy includes the previously reviewed net split policy. |
| Evidence | Existing detector tracks, calibrated table, body response, V3 kept and weaker restart candidates, low-bounce episodes, and four-second seed assembly. No score/tap fields or per-match overrides reach the policy. |
| Preparation fix | Drop only the first newly isolated fragment at most three seconds long, with body play response below 0.9 and no own held service attempt of at least 0.5 seconds. Never apply this to a whole original card. |
| Timing | Frame-normalized production baseline enters the reviewed policy; the ordinary exporter rebuilds final cut clocks, padding, highlights, suggestions and placement. |
| Serve metadata | Each split suffix/middle child gets its own preceding split's serve; an old parent's end observation cannot stop an earlier child. |
| Private winners | Every final point has a validated sidecar row. The selected terminal episode is retained beyond visible trimming for the existing winner guards; unavailable/ambiguous evidence abstains. Existing whole-point analysis is retained for unchanged cards. No owner score is changed. |
| Failure | Optional restart extraction cannot discard ordinary V3 results. Missing/failed combined evidence retains prior body cards and predictions. |
| Surfaces | Shared worker pipeline changes only; no native, desktop-web or mobile-web application UI change. Local review artifact reuses the owner-approved combined review layout. |

## Checks and release gate

| Check | Result |
| --- | --- |
| Owner-labelled fixtures | 20 real windows; initial three failures became passing after the targeted preparation rule. |
| Worker tests | 146 passed, plus 7 subtests; three existing NumPy missing-data warnings. |
| Independent review | Optional detector failure and lost winner confirmation fixed; 87 focused tests passed on re-review. |
| Full export replay | 9 recordings, option on and off, 695 → 759 cards; 759 valid private prediction records, 53 predicted and remainder abstained. Source ball/player inference was cached, not rerun. |
| Application | Real `npm run build` passed in isolated worktree. Initial sandbox build could not fetch existing Google fonts; network-enabled retry passed. |
| Review UI | Desktop1280×720 and mobile393×660; three updated clips stop at their final endpoints; separate feedback saves after reload. |
| Limits | Yilin has no usable cached video/tracking and is not verified. The previously accepted missed short service fault in Julian3 remains bundled. |
| Owner feedback | Chris44 was explicitly accepted; an earlier visual suspicion is not treated as a confirmed missed point. The three preparation-only prefixes are the only changed visual decisions. |
| Remaining | Owner reviews corrected3, then reconcile against current live worker revision before merge/build. Validate sealed bundle imports, offline side-change inference and integrity; activate and reprocess selected matches using the explicit option. Do not roll back newer unrelated worker work. |

Review: http://127.0.0.1:61927/ponglens-combined-worker-review/

Full numeric results are in `verification.json`; real fixtures are under `worker/tests/fixtures/combined_cuts`. The exported candidate match/prediction bundles are archived in the local artifact's `evidence/exports`; source video remains shared with prior reviews.
