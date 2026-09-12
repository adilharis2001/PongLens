# Rally-preserving worker release

This release ports the owner-reviewed rally rules without changing their thresholds or model weights, and corrects the exported video's card clock. All 14 cached recordings reproduce the frozen candidate boundaries exactly, including Brian's reviewed long rallies. Package preparation is authorized; production activation is a separate step and the 20-minute whole-match target remains unverified.

| Contract | Implementation / required evidence |
| --- | --- |
| Candidate | `agreement_plus_table_supported_continuation_v2`, reviewed in four video batches; no new tuning |
| Internal serve cut | V2's existing internal split must have a V3 contact within 0.5 s |
| Continuation | Frozen narrow seam rule requires body activity, both observed players, continuous ball evidence, no nearby dead-ball run, and consecutive nearby table bounces straddling the seam |
| Preserve | Outside source edges, first serve, final card's ending evidence; no refinement after a join |
| Missing evidence | Missing V3 serves or dead runs is not a successful empty detector; keep previous rules. Policy is limited to frozen body model v2 |
| Provenance | `match.json.processing.rally_policy` records whether the new rule ran and its join count |
| Known tradeoff | Net-roll/repeated-bounce endings can still combine distinct points. Owner accepted some additional Split work in return for intact rallies; do not call every merge correct |
| Media fix | Per-part actual container duration and initial mux offset determine `cut_segment_offsets`; source cut segments and source card boundaries do not move |
| Consumers | Initial `cut_t0`, `rally_end_cut_s`, worker `_CutMap` reclips, and rally-ending backfill use the same measured offsets |
| Legacy JSON | Absence of the new offsets retains the old interpretation; invalid present offsets must not silently become an old guessed clock |
| Fallback export | Cutter writes an atomic `result.mp4.timeline.json`; publication reconciles again, including points created after a legacy span cut |
| Atomicity | A failed map write leaves the previous complete JSON, never a partial document; missing timeline blocks point publication rather than guessing |
| Test evidence | Real FFmpeg 30 fps/audio, 60 fps/no-audio and variable-timestamp exports compare card clocks against identical encoded packet payloads; sub-millisecond tolerance accounts for timebase rescaling |
| No changes | Model files, loaders, dependency environments, database schema, Scorekeeper UI and edit operations, existing scored matches, hand/lesson launchers, disabled match cloud |
| Rollback | Explicit previously verified release `beb02a6c1002577ec521d2dce12916cdd9f8cbba3dbd640ea7dec7014c3bcf9b`; reverify before switching |
| Release mechanics | [Fixed-release instructions](../worker/match_release/README.md); build from this branch's explicit commit, stage by immutable ID, keep caches outside the bundle, run every required offline smoke including repeated side changes |
| Source integration | Branch starts from `04421389`, the corrected sealed baseline. Do not merge this captured baseline wholesale over newer main or overwrite another chat's worker edits |
| Research handoff | Root `docs/research/2026-09-11-rally-preserving-worker/`; initial full-video validation and frozen owner reviews remain separate from this release's verification |
| Local verification workspace | `/private/tmp/ponglens-rally-release-checks-gwWyGB`; large videos stay outside Git |

| Preparation gate | Current state |
| --- | --- |
| Frozen-rule port and 14-recording exact replay | Passed |
| Synthetic output-clock / reclip checks | Passed |
| Independent code review | In progress |
| Complete Brian clips + full cut + measured packet audit | In progress |
| Final committed package / all native smoke modes / both lane checks | Pending |
| Production activation | Not performed |

| Primary technical reference | Use |
| --- | --- |
| [FFmpeg concat documentation](https://ffmpeg.org/ffmpeg-formats.html#concat) | Concat advances by input file durations and adjusts timestamps; kept source durations alone are not a measured output clock |
