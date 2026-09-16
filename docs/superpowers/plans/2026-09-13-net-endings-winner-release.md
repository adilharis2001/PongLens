# Net endings and private winner predictions implementation plan

> Use the testing and independent review skills for each bounded deliverable.

**Goal:** Deliver owner-reviewed net ending improvements and private prediction observations for newly processed points, while preserving scores and continuous-rally joins.

**Architecture:** Run a pure end-only postprocessor after the existing body assembly and guarded openings. Persist independent physical near/far prediction attempts in a private related table, with explicit abstention, source bounds and method provenance. Existing suggestion and confirmed_winner remain unchanged.

**Spec:** Owner instructions in this task on 2026-09-13; frozen research in /private/tmp/ponglens-net-ending-20260913; audits in /private/tmp/ponglens-net-production-20260913. Baseline f9aad58d, installed e9c3cd9c; current web/iOS are newer and must not be replaced by worker-branch app code.

## Constraints
- No new splits or joins in this release. Card count, order, openings, serve stamps and continuation decisions unchanged.
- Frozen extractor chooses closest motion before slowdown eligibility; preserve maximal-chain dedup, v1 eligibility before any padding change and first-proposal choice. A later crossing always vetoes an ending-only trim.
- Missing or malformed track/calibration leaves cuts unchanged and logs abstention/error separately.
- Preserve existing .4s export padding and measured source-to-cut mappings. Verify end_evidence_s UI consumers independently.
- Use the more-room tested end (max(first+.8, second+.2)) for initial release because owner explicitly preferred it on some cases; retain shortest option for later measured refinement. Do not imply all shortest variants were approved.
- Prediction calculation never reads scores, first server, or user-side metadata. Whole-card winner must abstain on detected multi-rally ambiguity; terminal-event hypothesis may be stored as evidence only. No invented numeric confidence.
- New private prediction record for every worker-produced point; no existing-match backfill or UI changes. Legacy guess may be recorded as a separate weak hypothesis if useful, never promoted to net precision.
- Additive migration first; live drain/restart only after full tests, package smokes and independent review. Exact fallback is current e9, preserving mail capture and all current availability behavior.

## Task 1: End-only algorithm and frozen corpus parity
Files: worker/net_endings.py; worker/tests/test_net_endings.py; worker/tests/fixtures/net_endings/*.json; worker/points_pipeline.py.
- [ ] Add independent synthetic and frozen observation fixtures; run tests expecting missing module failure, then implement.
- [ ] Interface extract_sequences(track, corners, fps, width, crossings) -> sequence dictionaries with first/last/bounces/half/net_motion; exact reviewed geometry and ordering.
- [ ] Interface refine_endings(cards, sequences, crossings, serves) -> copied cards and diagnostics, with per-card terminal evidence. Reject any splitting or later continuation; keep card identity/order/start.
- [ ] Test no track, invalid geometry, late crossing, later serve/new rally, long-card minimum duration, v1-only eligibility, no mutation of input, correct source half on named corners, and threshold boundaries.
- [ ] Replay all8sources, compare event IDs and v1 ending values to frozen proposals, confirm all3splits remain unchanged. Replay contextual samples as overlapping validation, not independent holdout.
- [ ] Invoke after body assemble, before evidence dump/export; full cached pipeline smoke verifies starts/count and cut-clock endpoint metadata.

## Task 2: Prediction contract and private persistence
Files: worker/point_winner_predictions.py; worker/worker.py; worker/tests/test_point_winner_predictions.py; supabase/migrations/20260913*_point_winner_predictions.sql; actual PostgreSQL tests.
- [ ] Define versioned payload with status predicted/abstained/error, nullable winner_side near/far, method, evaluated source bounds, release provenance, evidence and reason. Only video evidence creates prediction.
- [ ] One immutable row per point/method/input, private grants/RLS. Derive point processing_version_id via real FK relation rather than index. Preserve original window so timing edits can be detected as stale without deleting prediction history.
- [ ] Insert in same transaction as points; never assign confirmed_winner. Keep prediction payload out of owner-accessible match JSON; write a server-local sidecar consumed only by worker insertion.
- [ ] Real PostgreSQL checks: worker write, client read/write denial, score-only correction invariance, changed-window applicability, separate versions same idx, deletion cascade, rollback atomicity.
- [ ] Add terminal-event attribution/ambiguity guards based on new owner fixtures; preserve Tomo23 as wrong/uncertain evidence, not silently relabel it.

## Task 3: Integrated verification and deployment
Files: docs/research/2026-09-13-net-endings-winner/release.md; local release rollout recipe and rollback evidence.
- [ ] Run full relevant worker/availability suites; real npm run build in isolated worktree; no native UI build needed.
- [ ] Independent code/security review and resolve findings. Commit only explicit source/tests/docs; no private match data or media.
- [ ] Inspect/build sealed package from committed source with current e9 runtime/model/behavior inputs. All8 offline smokes and post-inference integrity required.
- [ ] Verify live schema and apply only additive prediction migration. Stage candidate, preflight main/fast. Capture signed e9 fallback apps/plists.
- [ ] Drain current main/fast; finish active jobs; verified stop/install/start-paused/monitor/resume. Preserve hand/lesson/cloud and current mail state.
- [ ] Verify exact new release pulses and prediction persistence on naturally arriving jobs; distinguish running from an actually processed match. Publish authorized source branch without deploying older app code.
