# Combined rally rules and whole-clip cleanup

Both approved improvements now run together before the normal exporter, and the nine-recording replay removes exactly the four approved dead clips without changing any retained source interval.
Publication now preserves applied-rule records and reports a requested rule that failed or did not run, rather than silently calling the complete request successful.
This is deployed as sealed release `44cfebbf…`; read `RELEASE.md` for exact identity and pilot status. Table-calibration rejection and the broad global ball filter are excluded.

| Recording | Combined candidate | With cleanup | Approved exports removed |
| --- | ---: | ---: | --- |
| Julian reference 19a1efc7 | 124 | 122 | 40.65–43.55; 665.62–674.46s |
| Chris 50caea29 | 88 | 86 | 1011.07–1013.60; 1021.94–1028.25s |
| Julian 6d55dfb7 | 69 | 69 | None |
| Brian 8cb54f9f | 111 | 111 | None |
| Prabhas 9e15ed10 | 67 | 67 | None |
| Tomo 9ef09000 | 78 | 78 | None |
| Ishan d59d7610 | 94 | 94 | None |
| Julian eabb4fc2 | 64 | 64 | None |
| Kyle fa96cd0e | 64 | 64 | None |
| Total | 759 | 755 | Four whole exports, 20.58 seconds |

## Integration contracts

| Area | Contract |
| --- | --- |
| Enablement | Literal `combined_cuts: true` and `whole_clip_cleanup: true` job options, bodies with both edge rules. No global defaults changed; an installed package alone does not enable a pilot. |
| Original evidence | Unchanged. Filtered track is a separate `Evidence` instance, used only after combined assembly; no global track monkeypatch or altered body inputs. |
| Removal | Every member of a connected export must have original table/crossing evidence that disappears, no retained table/crossing evidence, and no original/new serve or stamped serve. Missing observations alone never authorize removal. |
| Failure | No real calibration, combined policy not used, unavailable/failed evidence or removing every card preserves the original result. No table classifier, refusal, refund, new email or per-match override introduced. |
| Retained timing | Original assembler records retained unchanged. Ordinary exporter regenerates numbering, placement, highlight evidence, clip names and cut clocks. Private predictions are looked up by retained start frame, then finalized to the new point index. |
| Table eligibility decision | Initial research used owner table labels to gate inputs. Re-evaluating all 28 inputs without that gate selected exactly the same four approved removals. Pilot uses actual calibration and conservative evidence safeguards, not hardcoded source IDs or a claim that calibration is universally correct. |
| Publication bug fixed | `ProcessingRun.attach` previously discarded `combined_cuts`, `net_endings` and cleanup records. Preserve these known records on repeated attachment; bounded summaries enter processing-run details. An unmet requested policy is degraded while usable fallback clips remain deliverable. |
| Admin summary fixed | The existing admin parser reads body totals from a note. Finalize total and serve-stamped counts against retained evidence cards and final exported points; preserve the remainder of the note and all ball-router evidence. |
| Surfaces | Common Mac/cloud worker source only; no web/mobile-web/native UI changes or independent hand-worker changes. No stage or job type added. |

## Evidence

| Check | Result |
| --- | --- |
| Final worker regression | 213 passed plus seven subtests; three existing NumPy missing-data warnings. Suites: combined cuts, whole-clip cleanup, processing outcome/health, body parity/edges, V3 parity, reviewed net splits, net endings, private predictions and job options. |
| Full composed replay | Nine cached full recordings; all retained export intervals exact, all retained point metadata exact except intended index/file/cut-clock remapping. |
| Private records | All 755 pass production validator; each retained prediction unchanged except its new index. |
| Publication | All nine outputs survive actual parent attachment twice with both applied records and point data intact. |
| Disabled cleanup | Fresh Chris replay exactly matches all 88 approved combined point records, export segments and private records. |
| Added cleanup work | 2.93–14.11 seconds in the final cached replay while other checks ran; not a complete production runtime/cost measurement. No new model inference or paid calls. |
| App build | Real `npm run build` passed in this isolated worktree with existing warnings. No app source changed or deployed. |
| Package regression tests | 25 unittest checks passed. Running that namespace-package suite in the same pytest invocation as tests that prepend worker/ causes an import-name collision; use its documented unittest command, not dummy credentials. |
| Independent review | One Important stale-admin-total finding reproduced and fixed with failing/passing tests. Narrow re-review has no remaining Critical, Important or Minor findings. |
| Fresh live baseline | Read-only main/fast pulses report sealed `b8e07c891509bf9031a56c12ea532ae4d31b990478e39845c984055dc720c988`, fresh and idle at check time. Recheck before switching. |
| Reproduction | `reconcile_replay.py SOURCE --out NEW_DIRECTORY`; refuses overwritten evidence. `verify_reconciled.py` checks exact outputs and actual parent publication. |
| Local results | Committed `reconciled-verification.json` records the final numerical and publication checks. Final summary-fix replays: `/private/tmp/ponglens-reconciled-cleanup-final-20260914/`; original evidence was not overwritten. |
| Known limitation | Existing missed short service fault in Julian3 remains bundled; Yilin was not replayed. This cleanup is modest dead-play removal, not general ball identity recovery. |

## Release checklist

| Gate | State |
| --- | --- |
| Owner review | Complete for inherited final three corrections and all four cleanup removals |
| Code integration / numerical replay | Implemented; independent review clear; fresh nine-replay checks pass including final admin totals, cut clocks, exact retained metadata and private predictions |
| Packaging | Sealed `44cfebbf…`, source `9e19096a`; all eight offline inference/import/linkage/parity checks passed, including repeated side changes and post-inference integrity; both staged lanes verified |
| Activation | Fresh main/fast accepting new release and monitor verified at 21:25:37 UTC. No active jobs interrupted; whole signed b8 rollback retained. See `RELEASE.md`. |
| Account pilot | See `RELEASE.md` for queue status; explicitly enable both options and verify published `processing.combined_cuts.status` and `processing.whole_clip_cleanup.status` are `used`; preserve scored originals and reuse source assets |
