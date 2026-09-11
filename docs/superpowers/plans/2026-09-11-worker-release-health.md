# Worker release and health implementation plan

> For agentic workers: use superpowers:subagent-driven-development for bounded implementation and independent review. Track completion in the plan ledger.

**Goal:** Isolate production from development and make body degradation visible.

**Architecture:** A sealed Mac release supplies fixed source/model/runtime paths. Additive processing-attempt and incident records carry execution identity and health independently of successful video delivery.

**Tech Stack:** Python, PostgreSQL, Next.js, launchd.

**Spec:** `docs/superpowers/specs/2026-09-11-worker-release-health.md`

## Global Constraints

- Preserve the captured current worker's point/card/scoring semantics and fallback.
- Work only in this worktree; no root runtime edits, process restarts, database writes, cloud activation or deployment by subagents.
- No Scorekeeper, native iOS, shared score state, clip timing, or other chats' files.
- New operational data is admin-only. Raw errors, secrets, paths and user media must not enter notifications.
- Unknown telemetry is not a successful body pass. Monitoring cannot fail video processing.
- UI reference is the shipped `/admin/processing`; inspect before changing, render desktop and 393x660, obtain screenshot approval before publication.
- Explicit file paths when committing. Baseline snapshot and implementation must be distinguishable.

### Task 1: Fixed release packaging and runtime verification

**Files:** create `worker/match_release/` package and `worker/tests/test_match_release.py`; release runbook `worker/match_release/README.md`.

**Interface:** provide build/verify/runner commands; manifest is JSON with `schema`, `release_id`, `source_commit`, `files`, `runtime` and `body_model` identities. Runner sets `PONGLENS_MATCH_RELEASE`, `PONGLENS_WORKER_PY`, `PONGLENS_PIPELINE_PY`, `PONGLENS_BLURBALL_INFER`, `PONGLENS_RTMPOSE_PY`, `PONGLENS_RTMPOSE_MODEL`, `PONGLENS_RTMPOSE_DET_MODEL`, `PONGLENS_TABLE_KEYPOINT_HOME`, `PONGLENS_TABLE_KEYPOINT_PY`, `PONGLENS_BODY_MODEL`, and fixed media executable paths. Parent owns edits to worker.py / points_pipeline.py / table_keypoints.py / extract_players_rtmpose.py.

- [ ] Capture and verify baseline source. Build from committed files, detect changes during collection, include body model data and Core ML helper.
- [ ] Write tests that reject changed/missing/extra files and symlink escapes, retain unchanged output when the source checkout changes, reject missing models/runtime, and guarantee children use the resolved release directory.
- [ ] Implement content-addressed build and verification, adapting existing release machinery where useful. Include external detector source/weights and exact dependencies; do not silently use the current TTVid checkout after sealing. Separate writable cache/log/work paths.
- [ ] Implement stage-only installation and a runtime runner that verifies before starting, with explicit rollback targets. No live launchd operations.
- [ ] Run focused tests and report CLI commands for preparing a real package and smoke check. Commit owned files only.

### Task 2: Durable execution outcomes and operational health

**Files:** create `worker/processing_outcome.py`, `worker/processing_health.py`, corresponding tests and `supabase/migrations/20260911143000_worker_processing_health.sql`; modify narrow integration in `worker/worker.py`, `worker/points_pipeline.py`, `worker/body_points.py`, pose/table runtime path selection.

**Interface:** `match.json.processing` is an additive versioned object; attempt UUID created once at job start. Database table `worker_processing_runs` stores attempt_key/job_id/release_id/requested_pipeline/delivered_pipeline/status/reason_code/details/start/end. `worker_processing_incidents` holds deduplicated active/recovered operational incidents. Admin RPC returns recent attempts/incidents and missing-telemetry coverage.

- [ ] Write behavior tests for successful bodies, expected refusal, model mismatch/programming failure, failed pose child, failed second pass, outer legacy rebuild, V3-only degradation, missing telemetry and retry-safe persistence.
- [ ] Carry requested configuration through every fallback; persist structured final facts from the output actually published. Snapshot release/model/config information. Do not infer success from nonempty points.
- [ ] Add start/final records with failure-isolated persistence and retry spool outside the payload. Add incident aggregation, deduplication, recovery and an independently executable monitor. Keep existing result completion and emails unchanged.
- [ ] Test migration in isolated PostgreSQL if available, including admin-only access and retry idempotency. Run focused worker tests plus frozen parity.

### Task 3: Admin visibility, documentation and rollout

**Files:** admin processing components/types/tests, worker runbook, CLAUDE.md; rollout record under `docs/research/2026-09-11-worker-release-health/`.

- [ ] Inspect rendered shipped processing screen and source. Add release identity, requested/delivered body outcome, plain-language fallback reason, incident/recovery display and missing reporting state in the existing layout.
- [ ] Render success, expected refusal, operational fallback and unknown states on desktop and 393x660 mobile. Full `npm run build` in this worktree. Prepare screenshots for approval.
- [ ] Record concrete baseline, build ID, environment inventory, smoke/parity results and rollback command. Add CLAUDE.md guidance for all future chats, clearly distinguishing staged and active status.
- [ ] Independent review of changed runtime and health paths, then packaged representative processing and rollback rehearsal.
- [ ] Recheck concurrent root edits and queue/launcher state before drain and activation. Apply only additive operational migration after validation. Switch verified main/fast release at a job boundary. Keep hand and lesson lanes untouched unless their dependencies require an explicit coordinated release.
- [ ] Verify live pulse identity and attempt reporting. UI publishing awaits screenshot approval; document any remaining rollout gate precisely.
