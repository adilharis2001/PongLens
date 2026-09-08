# Worker final-review correction

Date: 2026-09-07. Baseline inspected: `acf6e202`. Worktree: `codex/match-processing-feedback`.

## Changes

- Derived highlight selection, placement generation/retry/backfill, reclip targets/tail inputs, diagnostic backfill and side-change enrichment read the job's processing version explicitly. Privileged database connections do not rely on RLS for this boundary.
- Current-match export writes use the match lock also taken by publish/restore, plus an attempt timestamp. Old completion/error writes cannot replace a newer version's export request. Export media reads use the original version's stored cut even if publication precedes the read.
- Export attempts and recut clips have version-bound, immutable output names. Failed/stale output cleanup checks current and retained references and reverses only the unused object's storage receipt. Reclip compare-and-save and follow-up enqueue remain inside the version guard.
- Placement enqueue stamps the owned active version. The migration recovers only queued/processing attempts still recorded on that match; older unidentifiable derived jobs fail closed instead of binding to a later cut. Placement reads, writes, verification and compensation carry the version identity.
- Candidate release comes from the running process's startup-captured code identity, never the source version or requested job label. An unknown running release remains null. Settings record the configuration actually passed to detection/assembly, normalized strictness/placement, crop, serve thresholds, trim and native model runtime settings. The assembler's reported pipeline/cut mode/options are recorded separately, including a v2-configured run that actually fell back to v1.
- The focused placement suite exposed an existing one-field drift: reconstruction omitted `rally_end_cut_s` from its artifact allowlist while its preservation guard already required it. The allowlist now preserves that existing timeline field. Existing dispatch mocks were updated for the already-shipped database claim and explicit version contract.

No UI or copy changed. The main checkout's unrelated serve/highlight work and `supabase/.temp/cli-latest` were not edited or staged.

## RED evidence

The first tests used real privileged SQL with an active version, a retained version and a candidate carrying the same point index. Before fixes:

- Automatic highlights returned the two non-active point IDs.
- Placement and placement backfill rejected valid cross-version duplicate indices.
- Reclip cleared edited flags in all three versions.
- Candidate provenance reported `source-old-release` instead of `executing-worker-release`; unknown execution also inherited the source label.
- Highlight diagnostic backfill modified non-active receipts; valid old side-change evidence overwrote the new active match's structure.
- A client-supplied placement version was not replaced with the owned active version at enqueue.

Four deterministic race tests were also rerun against the unchanged `acf6e202` worker loaded in memory from `git show`, without replacing working files. All four failed on their behavioral assertions: old points fetched `new-cut.mp4`; an old encoding failure changed the new queued export to failed; repeated same-version exports reused the retained key; and an old reclip still saved after publication.

The race fixture marks an in-flight derived job cancelled before publishing. This models a stale worker tail without weakening the existing activation gate, which correctly refuses a job still recorded as queued/processing.

## Final checks

| Check | Result |
| --- | --- |
| `unittest`: match reprocess, placement retry/generation, placement reconstruction, raw retention, reclip source suites | **107 passed**, 0 failures/errors/skips; exit 0 |
| `pytest`: worker automatic-highlight, highlight backfill, backfill runner, highlights, automatic render suites | **44 passed**, exit 0 |
| Apply `20260907221000_derived_job_versions.sql` to local disposable feature DB | **Passed**: function, revoke, trigger created; recovery update matched 0 existing jobs |
| `git diff --check` | **Passed**, exit 0 |
| Full web build, Xcode, fresh full migration-chain replay | **Not rerun in this worker-only correction**; coordinator owns integrated verification. Earlier documented release blockers are not declared resolved. |
| Staging/production lifecycle, real R2, detector/model execution, real ffmpeg encoding | **Not run** |

All database regressions use the fixed loopback fixture endpoint `127.0.0.1:55322`, fixture accounts and two connections. Encoder/storage/model boundaries create local fixture bytes only. No customer data or real provider credentials were used.

### Reproduction

Use inert fixture environment values for `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`; set `MATCH_ISSUES_LOCAL_DB_TEST=1`. Database tests intentionally use only the fixed local endpoint.

```sh
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_match_reprocess worker.tests.test_placement_retry_job \
  worker.tests.test_placement_backfill_reconstruction worker.tests.test_raw_retention \
  worker.tests.test_reclip_sources

PYTHONPATH=worker /Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m pytest \
  worker/tests/test_worker.py worker/tests/test_highlight_backfill.py \
  worker/tests/test_highlight_backfill_runner.py worker/tests/test_highlights.py \
  worker/tests/test_auto_highlight_render.py -q
```

The suites use two existing import conventions. Combining the package-style reclip suite with the top-level `PYTHONPATH=worker` pytest group first produced a collection error; the final commands above run each in its intended import context and both exit successfully.

## Files and rollout rulings

- `worker/worker.py`: explicit version reads, guarded derived writes/media/cleanup, runtime provenance.
- `worker/highlight_backfill.py`: frozen version/diagnostic path, locked receipt and reel invalidation.
- `worker/placement_backfill.py`: preserve the existing rally-end timeline field.
- `worker/tests/test_match_reprocess.py`: real multi-version database and deterministic race/provenance regressions.
- `worker/tests/test_placement_retry_job.py`, `worker/tests/test_worker.py`: explicit-version and claim fixtures; existing behavior assertions retained.
- `supabase/migrations/20260907221000_derived_job_versions.sql`: enqueue identity and conservative queued-attempt recovery.

Apply the additive migration before deploying the worker. Do not infer a release from source history when startup identity is unavailable. Do not remove the existing unfinished-derived-work activation gate as part of this correction. Real processing/provider parity remains a separate release check.

## Fresh-review fix round: ordinary redelivery and highlight cleanup

Date: 2026-09-07. Worker baseline: `572e460c`; the coordinator's separate SQL provenance commit `6e10d9b2` landed while this correction was running. No migration was added in this round.

### Findings and changes

- **P1:** ordinary `deadspace_cut`/`youtube_import` deliveries now reject completed, cancelled, refunded, exhausted and stale claims before media work. A library claim freezes its originating processing version and upload/import job while the match is still unfinished. A newer ordinary claim cannot be displaced by an unversioned old delivery.
- The same match-row lock used by publish/restore revalidates ownership before any ordinary output upload and remains held through point replacement and match completion. `create_match(existing=True)` independently repeats the guard and deletes only the still-owned version's points. A late result cannot overwrite retained media before its database write is rejected. Publication during compute leaves the already-completed job at 100% and preserves all three versions.
- **P2:** unused automatic-highlight output cleanup runs independently of the failure-state write. Rejecting both ready and failed bookkeeping still produces exactly one upload, one object deletion and one reversing storage receipt.
- The new ordinary publication transaction exposed an existing autocommit assumption in optional SQL. Savepoints isolate best-effort accounting, configuration reads, nested highlight writes and cleanup reference checks. Optional SQL rejection leaves the surrounding match publication usable. A core point SQL failure rolls the publication back and reaches the existing job failure/retry handler; it cannot silently roll back and then mark the job done.

The lock is acquired after normal detection, assembly and cutting. It covers the existing output-publication path, including optional highlight rendering and the legacy point fallback when used; competing publication or row saves can wait for that phase. Media and database writes are not a distributed transaction. No new UI, stage, pipeline or release setting was introduced.

### RED → GREEN evidence

Before implementation, all five requested behavioral regressions failed: completed ordinary redelivery reached storage; stale direct retry deleted points; valid retry deleted points in retained/candidate versions; publication during compute still uploaded old results; dual highlight bookkeeping rejection uploaded once and cleaned up zero objects.

Further real-DB regressions reproduced a poisoned outer transaction after a ledger FK error and rejected highlight SQL, a falsely completed job after core point SQL failure, and progress falling from 100% to 60% after another delivery completed. The final highlight SQL fixture forces actual PostgreSQL status-constraint failures on both terminal writes. Replaying it in memory with savepoint isolation disabled again failed with `InFailedSqlTransaction`; no working file was reverted. One intermediate test run had a weak highlight fixture that selected no rally; it was corrected to exercise rendering, ready rejection and failed rejection explicitly.

Green coverage additionally verifies the real upload-job → processing-job ownership transition and a valid retry, conservative rejection of an unversioned older claim, and an actual second-connection publish RPC blocked by the output transaction. Existing first-server backfill assertions remain intact with the new locked-row fixture.

### Final checks for this round

| Check | Result |
| --- | --- |
| Match reprocess/multi-version DB, placement retry, placement reconstruction, raw retention, reclip source, upload first-server unittest suites | **126 passed**, no failures/errors/skips; exit 0 |
| Serve-motif settings, match structure, uploaded metadata, failure email, placement notification unittest suites | **46 passed**, no failures/errors/skips; exit 0 |
| Automatic-highlight worker, highlight backfill/runner, selector, render pytest suites | **45 passed**, exit 0 |
| `git diff --check` | **Passed**, exit 0 |
| Full web/native builds, full migration replay, staging/production, real provider storage or encoding | **Not run in this worker-only fix round**; coordinator owns integrated verification |

The first unittest command above gains `worker.tests.test_upload_first_server`. The additional adjacent check is:

```sh
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest \
  worker.tests.test_serve_motif_tolerances worker.tests.test_match_structure \
  worker.tests.test_uploaded_match_meta worker.tests.test_failure_emails \
  worker.tests.test_placement_notifications
```

All commands use the same inert environment and fixed isolated local database described above. New regression fixtures use three coexisting versions, real privileged SQL, real SQL failures and a second connection; only media/provider boundaries use local synthetic bytes.

Files in this round: `worker/worker.py`, `worker/tests/test_match_reprocess.py`, `worker/tests/test_worker.py`, `worker/tests/test_upload_first_server.py`, and this evidence document. SDD progress/report were appended separately. `supabase/.temp/cli-latest` remains untouched and unstaged. Earlier release findings remain explicit; these focused results are not a global release approval.

## Follow-up: terminal bookkeeping, claim ownership and metering

Date: 2026-09-07. Baseline: `75bf8a71`. This round addresses the three freshly reproduced P2 findings without UI or migration changes.

- Early ordinary delivery exits now reconcile the authoritative ready/deleted match under match → job locks before queue archive. A ready match's own unfinished job receives its stored cut, `done` and 100% progress without reprocessing or refunding completed work. A deleted library match's unfinished job is cancelled and its personal spend refunded. Bookkeeping and queue archive commit together; a failed refund leaves both the queued job and the actual pgmq message retryable.
- The direct worker refund helper now mirrors the existing server RPC: each refund names its original spend through `reverses_id`, and the existing unique index makes retries and partially refunded jobs idempotent. The deleted-match fixture exposed the stale worker SQL that had omitted this receipt identity.
- A newer ordinary job only blocks a claim when it belongs to the same user. The regression inserts a spoofed match ID through the real `authenticated` role and verifies the legitimate owner's claim continues while the other user's job remains unchanged.
- `CostMeter.record` now uses the existing savepoint helper on shared non-autocommit connections. The helper moved to the already-used `cost_meter` module and is imported by both worker entry conventions; metering and other optional SQL share one implementation. A genuine invalid-timestamp database rejection leaves earlier publication writes intact and `finish_match` succeeds.

RED: all four initial behavioral assertions failed against `75bf8a71`: ready job remained `processing` with no result; deleted job remained `queued`; another user's spoofed options blocked the claim; metering left transaction status `INERROR`. The deleted-job receipt then reproduced the direct refund helper's missing spend identity before that helper was aligned with the existing RPC. GREEN coverage includes duplicate deliveries, no refund for a ready result, exactly one +11-minute reversal after deletion, recovery after a real SQL failure with real queue state, partial-refund idempotency and all earlier publication protections.

Final focused checks: **188 unittest tests passed** (the prior 172 group plus six new DB tests and the ten cost-meter tests), **45 pytest tests passed**, and `git diff --check` passed. No failures, errors or skips in the successful runs. The combined unittest command is the prior core/adjacent commands with `worker.tests.test_cost_meter` appended; the pytest command is unchanged.

All DB tests use the same fixed isolated loopback database and synthetic accounts. Only the synthetic queue message created by the new queue test is removed in its cleanup. No provider media, real encoding, customer data, full web/native build or migration replay was used in this correction. Prior release checks and the ordinary output-lock duration tradeoff remain unchanged.

Owned files: `worker/worker.py`, `worker/cost_meter.py`, `worker/tests/test_match_reprocess.py`, this evidence document, and the ignored SDD ledger/report. The coordinator's main verification document and `supabase/.temp/cli-latest` are unrelated and must remain unstaged.

## Follow-up: exhausted attempts and main-loop reconciliation retry

Date: 2026-09-07. Baseline: `4fed8918`.

At `read_ct = MAX_READ_CT + 1`, an unfinished ordinary job now receives the existing terminal failure outcome before archive: exact idempotent personal refund, failed job with completed progress, and failed match only while that job still owns the unfinished version and no newer same-owner claim exists. Prior diagnostic text is retained. Ready results and already-done jobs remain charged and unchanged; no media or point work reopens.

Terminal bookkeeping failures now raise `OrdinaryReconciliationRetry`. The real worker loop handles that separately from processing failures, so a failed archive cannot turn a ready result into a failed/refunded job or force a second archive. Refund, state changes and pgmq archive share the existing transaction; rollback, including failure after the queue write, leaves the delivery retryable even beyond the compute attempt limit.

RED: both starting statuses (`processing` and `failed`) retained 70% progress and the -11-minute debit instead of completing terminal bookkeeping. A third regression ran the real `main()` handler with one bounded delivery and an actual SQL failure after pgmq archive; it changed the previously-ready job to failed through generic failure handling. All three failed before implementation.

GREEN: six new real-DB tests cover both exhausted statuses, duplicate-delivery refund idempotency, archive-failure rollback/retry, completed-result/charge preservation, a newer claim's match remaining in progress, and ready-result preservation through the real main handler. They assert exact spend receipt identity, real queued/archive rows and unchanged point IDs. The existing deleted-job rollback test now checks the dedicated retry exception and its original SQL cause.

Final commands are unchanged from the previous combined verification: **194 unittest tests passed** in 11.205s, **45 pytest tests passed** in 2.11s, no failures/errors/skips; `git diff --check` passed. Fixtures remain exclusively local synthetic accounts, queue messages and media. Full web/native builds, migration replay, real provider/encoding/staging/production checks were not run in this worker-only correction. No UI or migration files changed. Owned files are the worker, match-reprocess DB tests and this evidence document; SDD ledger/report are appended separately.

## Follow-up: superseded claim refund inside the retry budget

Date: 2026-09-07. Baseline: `20dde4e9`.

A proven newer ordinary claim by the same owner now terminalizes and exact-refunds the unfinished older job before archive, regardless of its remaining attempt budget. The old job remains failed with its prior diagnostic and completed progress. This branch changes neither the match nor the newer job. Existing ready-result/completed-job precedence, same-owner validation, receipt idempotency and reconciliation-retry handling remain intact.

RED: two actual `authenticated` `claim_processing` RPC calls each charged a synthetic QA user 10 minutes. After the first attempt failed and the second was queued, delivery of the old message at `MAX_READ_CT` left its ledger at -10 with zero refunds. Both the direct replay test and the archive-failure/retry test failed with that exact assertion before implementation.

GREEN: the two new real-DB regressions verify one +10-minute refund naming the original spend, duplicate-delivery idempotency, old-job terminal progress, the new job's unchanged -10-minute charge and queued message, and unchanged full match/new-job/point snapshots. A real SQL error after actual pgmq archive rolls back the refund, job progress and archive together; the later retry completes once. Neither case enters media work.

Final focused rerun: **196 unittest tests passed** in 11.442s and **45 pytest tests passed** in 2.14s, no failures/errors/skips; `git diff --check` passed. Commands and inert local environment are unchanged. Tests use only the fixed isolated database, synthetic QA accounts, actual local RPCs and their queue messages. No UI/migration changes, real providers/encoding, staging/production, full web/native builds or full-chain replay were performed in this correction. Owned tracked files are `worker/worker.py`, `worker/tests/test_match_reprocess.py` and this document. The coordinator's main verification document and Supabase temp remain unrelated and unstaged.
