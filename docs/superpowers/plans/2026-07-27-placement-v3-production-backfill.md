# Placement v3 Production Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct placement v3 for all 20 existing production matches without changing match segmentation, point identity, scoring, clips, edits, or metadata.

**Architecture:** A focused reconstruction module computes and validates v3 payloads from Postgres-authoritative point ranges, existing match metadata, and fresh BlurBall detections. A worker-side orchestration function downloads one match’s retained inputs, reuses or recomputes table calibration, computes all placements before mutation, updates only `public.points.placement` in one transaction, synchronizes the existing `match.json`, and verifies both stores. An administrator CLI runs one explicit canary match before sequentially processing all remaining eligible matches, without creating job rows or queue messages.

**Tech Stack:** Python 3.12, unittest, psycopg2, boto3/R2, OpenCV/NumPy, existing BlurBall inference, Supabase Postgres, Next.js 15.

## Global Constraints

- Do not create duplicate matches, new point rows, public job rows, queue messages, backup R2 objects, or temporary R2 objects.
- Do not change point IDs, indices, times, clips, servers, scores, edits, suggestions, notes, match metadata, or storage-ledger rows.
- Compute and validate every placement before mutating production.
- Require exactly one placement with `placement["v"] == 3` for every existing point index.
- Treat Postgres point indices and `t0`/`t1` ranges as authoritative; do not discard split points absent from the stored `match.json`.
- Recompute failed saved calibration; if recalibration fails, write an honest v3 `unavailable` payload instead of fabricated trajectory data.
- A canary failure stops the rollout; later match failures are reported without corrupting or blocking independent matches.
- Temporary local files must be removed on both success and failure.

---

### Task 1: Pure Existing-Match Reconstruction

**Files:**
- Create: `worker/placement_backfill.py`
- Create: `worker/tests/test_placement_backfill_reconstruction.py`
- Modify: `worker/eval/render_placement_match.py`

**Interfaces:**
- Consumes: `worker.points_pipeline.Px`, `fit_play`; `worker.placement_reconstruction.reconstruct_placement`.
- Produces: `reconstruct_existing_match(match: Mapping[str, Any], points: Sequence[Mapping[str, Any]], detections: Mapping[int, tuple[float, float]], calibration: Mapping[str, Any] | None, audio_impacts: Sequence[Mapping[str, Any]] = ()) -> dict[int, dict[str, Any]]`; `merge_match_placements(match: Mapping[str, Any], points: Sequence[Mapping[str, Any]], placements: Mapping[int, Mapping[str, Any]]) -> dict[str, Any]`; `validate_placements(point_indices: Sequence[int], placements: Mapping[int, Mapping[str, Any]]) -> None`.

- [ ] **Step 1: Write failing validation and reconstruction tests**

```python
MATCH_FIXTURE = {
    "source": {"fps": 30.0, "width": 1920},
    "points": [{"idx": 1, "t0": 1.0, "t1": 2.0}],
}
VALID_CALIBRATION = {
    "table_corners_px": {
        "A_near_1": [0.0, 100.0],
        "B_near_2": [100.0, 100.0],
        "C_far_2": [100.0, 0.0],
        "D_far_1": [0.0, 0.0],
    },
    "length_axis": [0.0, 1.0],
}


class PlacementValidationTests(unittest.TestCase):
    def test_rejects_missing_duplicate_and_non_v3_outputs(self):
        with self.assertRaisesRegex(ValueError, "point indices"):
            validate_placements([1, 2], {1: {"v": 3}})
        with self.assertRaisesRegex(ValueError, "v=3"):
            validate_placements([1], {1: {"v": 2}})

    def test_merge_changes_only_placement_and_returns_a_copy(self):
        match = {"version": 2, "points": [
            {"idx": 1, "t0": 1.0, "server": "user", "placement": {"v": 2}}
        ]}
        points = [{"idx": 1, "t0": 1.0, "server": "user"}]
        merged = merge_match_placements(match, points, {1: {"v": 3}})
        self.assertEqual(merged["points"][0]["placement"], {"v": 3})
        self.assertEqual(merged["points"][0]["t0"], 1.0)
        self.assertEqual(match["points"][0]["placement"], {"v": 2})

    @patch("worker.placement_backfill.reconstruct_placement")
    @patch("worker.placement_backfill.fit_play")
    def test_reconstructs_against_existing_point_ranges(self, fit, reconstruct):
        fit.return_value = {"segments": [], "bounces": [], "hits": []}
        reconstruct.return_value = {"v": 3, "hypotheses": {}}
        result = reconstruct_existing_match(
            MATCH_FIXTURE,
            [{"idx": 1, "t0": 1.0, "t1": 2.0}],
            {30: (10.0, 10.0), 31: (11.0, 11.0)},
            VALID_CALIBRATION,
        )
        self.assertEqual(result, {1: {"v": 3, "hypotheses": {}}})
        self.assertEqual(reconstruct.call_args.args[5:7], (30, 61))
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_placement_backfill_reconstruction -v`

Expected: FAIL because `worker.placement_backfill` does not exist.

- [ ] **Step 3: Implement the pure reconstruction boundary**

Create `worker/placement_backfill.py` with:

```python
def validate_placements(point_indices, placements):
    expected = [int(idx) for idx in point_indices]
    actual = sorted(int(idx) for idx in placements)
    if len(expected) != len(set(expected)) or sorted(expected) != actual:
        raise ValueError("placement point indices do not match existing points")
    if any(payload.get("v") != 3 for payload in placements.values()):
        raise ValueError("every placement payload must have v=3")


def merge_match_placements(match, points, placements):
    merged = copy.deepcopy(match)
    validate_placements(
        [point["idx"] for point in points],
        placements,
    )
    stored_by_idx = {
        int(point["idx"]): point for point in merged.get("points", [])
    }
    merged["points"] = []
    for database_point in points:
        idx = int(database_point["idx"])
        point = copy.deepcopy(stored_by_idx.get(idx, {}))
        point.update(copy.deepcopy(database_point))
        point["placement"] = copy.deepcopy(placements[idx])
        merged["points"].append(point)
    merged["version"] = max(int(merged.get("version") or 0), 3)
    return merged
```

Implement `reconstruct_existing_match` using the passed Postgres point list,
not `match["points"]`. Rebuild the supplied calibration homography, use each
database point’s `t0`/`t1` to select frames, call `fit_play`, and call
`reconstruct_placement`. Audio inputs are filtered to the point time range; an
empty sequence preserves the current visual-only production behavior. When
calibration is absent, return `unavailable_placement("calibration_failed")` for
every point; this payload contains `v: 3`, empty candidates, and both near/far
hypotheses with unavailable status and no shots.

Move `calibration_matrix` and detection loading imports in
`render_placement_match.py` to the focused module so the report and production
backfill use the same math.

- [ ] **Step 4: Run focused and regression tests**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_placement_backfill_reconstruction -v
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_placement_reconstruction -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/placement_backfill.py worker/eval/render_placement_match.py worker/tests/test_placement_backfill_reconstruction.py
git commit -m "feat: reconstruct placement for existing matches"
```

---

### Task 2: Transactional Single-Match Backfill

**Files:**
- Modify: `worker/worker.py`
- Create: `worker/tests/test_worker_backfill.py`

**Interfaces:**
- Consumes: the `worker/placement_backfill.py reconstruct` command, existing `r2()`, `parse_r2_path()`, `storage_download()`, `VENV_PY`, and `BLURBALL_INFER`.
- Produces: `backfill_placement_for_match(conn, match_id: str, *, command_runner=subprocess.run) -> BackfillResult`; `BackfillResult(match_id: str, point_count: int, ready: int, review: int, unavailable: int)`.

- [ ] **Step 1: Write failing orchestration tests**

Use a fake connection/cursor plus patched storage and inference boundaries:

```python
def test_backfill_updates_only_placement_and_commits_after_validation(self):
    conn = FakeConnection(match_row=MATCH_ROW, point_rows=POINT_ROWS)
    with (
        patch("worker.worker.download_match_inputs") as download,
        patch("worker.worker.run_blurball_only") as infer,
        patch("worker.worker.reconstruct_existing_match",
              return_value={1: READY_V3, 2: REVIEW_V3}),
        patch("worker.worker.upload_match_json") as upload,
    ):
        download.return_value = (VIDEO_PATH, MATCH_PATH)
        infer.return_value = BLURBALL_PATH
        result = backfill_placement_for_match(conn, MATCH_ID)
    self.assertEqual(result.point_count, 2)
    self.assertEqual(conn.updated_columns, {"placement"})
    self.assertEqual(conn.commits, 1)
    upload.assert_called_once()


def test_backfill_rolls_back_and_never_uploads_on_invalid_output(self):
    conn = FakeConnection(match_row=MATCH_ROW, point_rows=POINT_ROWS)
    with (
        patch("worker.worker.reconstruct_existing_match",
              return_value={1: READY_V3}),
        patch("worker.worker.upload_match_json") as upload,
    ):
        with self.assertRaisesRegex(ValueError, "point indices"):
            backfill_placement_for_match(conn, MATCH_ID)
    self.assertEqual(conn.rollbacks, 1)
    upload.assert_not_called()
```

Also test owner/source readiness checks, unavailable raw input, idempotent v3
replacement, temporary-directory cleanup, recovery of a split database point
missing from stored JSON, saved-calibration fallback, recalibration failure,
and preservation of a full non-placement point snapshot.

- [ ] **Step 2: Run the new orchestration tests and confirm RED**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_worker_backfill -v`

Expected: FAIL because `backfill_placement_for_match` and its boundaries are
not defined.

- [ ] **Step 3: Implement storage, inference, transaction, and verification**

In `worker/worker.py`, do not import NumPy/OpenCV reconstruction modules into
the daemon. Run them through `VENV_PY` as a subprocess:

```python
@dataclass(frozen=True)
class BackfillResult:
    match_id: str
    point_count: int
    ready: int
    review: int
    unavailable: int


def run_blurball_only(input_video, workdir, command_runner=subprocess.run):
    output = os.path.join(workdir, "blurball.jsonl")
    command_runner(
        [VENV_PY, BLURBALL_INFER, "--video", input_video, "--out", output],
        check=True, cwd=workdir, timeout=4 * 3600,
    )
    if not os.path.isfile(output):
        raise RuntimeError("BlurBall inference produced no detections file")
    return output
```

Write the Postgres point rows to a temporary JSON file and invoke:

```bash
"$VENV_PY" worker/placement_backfill.py reconstruct \
  --match-json match.json --points-json points.json \
  --blurball blurball.jsonl --video source.mp4 --output placements.json
```

Implement the single-match operation with `conn.autocommit = False` only for
the short mutation phase. Load rows with parameterized SQL; require `ready`
status, source video, stored `match.json`, unique database point indices, and
valid database point ranges. Use all Postgres point rows, including deleted
rows, so every existing row receives the same placement schema. Reuse a valid
saved calibration; otherwise call the existing `calibrate` function with the
retained video and fresh detections. Compute and validate before mutation.
Update rows with:

```sql
update public.points
set placement = %s::jsonb
where match_id = %s and idx = %s
```

Require `cursor.rowcount == 1` for every point. Upload the fully merged
`match.json`, commit, re-read both Postgres and R2, and compare placements by
index. Roll back on any exception and restore the original autocommit setting.
Always remove the temporary directory in `finally`.

- [ ] **Step 4: Run the focused tests and full Python suite**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_worker_backfill -v
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_placement_backfill_reconstruction worker.tests.test_placement_reconstruction -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/worker.py worker/tests/test_worker_backfill.py
git commit -m "feat: backfill one match placement transactionally"
```

---

### Task 3: Canary-Gated Administrative Runner

**Files:**
- Create: `worker/backfill_placement_v3.py`
- Create: `worker/tests/test_backfill_runner.py`
- Modify: `worker/README.md`

**Interfaces:**
- Consumes: `worker.connect()`, `worker.backfill_placement_for_match()`.
- Produces: `snapshot_match(conn, match_id: str) -> MatchInvariantSnapshot`; `run_rollout(conn, canary_match_id: str, all_matches: bool) -> RolloutSummary`; CLI flags `--canary-match-id UUID`, `--all-after-canary`, and `--dry-run`.

- [ ] **Step 1: Write failing canary-gate tests**

```python
def test_rollout_stops_before_other_matches_when_canary_fails(self):
    backfill = Mock(side_effect=RuntimeError("canary failed"))
    with self.assertRaisesRegex(RuntimeError, "canary failed"):
        run_rollout(CONN, CANARY_ID, True, backfill=backfill)
    backfill.assert_called_once_with(CONN, CANARY_ID)


def test_rollout_processes_remaining_matches_only_after_invariants_pass(self):
    backfill = Mock(return_value=RESULT)
    verify = Mock(return_value=None)
    summary = run_rollout(
        CONN, CANARY_ID, True, backfill=backfill, verifier=verify
    )
    self.assertEqual(
        [call.args[1] for call in backfill.call_args_list],
        [CANARY_ID, OTHER_ID],
    )
    self.assertEqual(summary.succeeded, 2)


def test_dry_run_never_calls_backfill(self):
    backfill = Mock()
    summary = run_rollout(
        CONN, CANARY_ID, True, dry_run=True, backfill=backfill
    )
    backfill.assert_not_called()
    self.assertEqual(summary.eligible, 2)
```

- [ ] **Step 2: Run the runner tests and confirm RED**

Run: `/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_backfill_runner -v`

Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement the explicit admin CLI**

The CLI must require an explicit canary UUID, enumerate only `ready` matches
with non-null source and `match_json_path`, process the canary first, compare
before/after invariant snapshots, and then process remaining IDs in
`created_at` order. It must never insert/update `public.jobs`, call
`pgmq.send`, or alter queue state. Per-match failures after the canary are
collected and printed; the process exits nonzero when any match fails.

Document exact dry-run and rollout commands in `worker/README.md`:

```bash
worker/venv/bin/python worker/backfill_placement_v3.py \
  --canary-match-id "$CANARY_MATCH_ID" --all-after-canary --dry-run
worker/venv/bin/python worker/backfill_placement_v3.py \
  --canary-match-id "$CANARY_MATCH_ID" --all-after-canary
```

- [ ] **Step 4: Run focused tests, CLI help, and dry-run against production**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_backfill_runner -v
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python worker/backfill_placement_v3.py --help
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python worker/backfill_placement_v3.py \
  --canary-match-id "$CANARY_MATCH_ID" --all-after-canary --dry-run
```

Expected: tests PASS; help lists all three flags; dry-run reports 20 eligible
matches and 1,109 points with zero writes.

- [ ] **Step 5: Commit**

```bash
git add worker/backfill_placement_v3.py worker/tests/test_backfill_runner.py worker/README.md
git commit -m "feat: add canary-gated placement backfill runner"
```

---

### Task 4: Full Verification, Deployment, and Production Rollout

**Files:**
- Modify only if verification uncovers a defect in files from Tasks 1-3.

**Interfaces:**
- Consumes: the canary-gated runner and merged placement v3 UI.
- Produces: deployed PongLens `main`, restarted production worker, and verified v3 placement for all production points.

- [ ] **Step 1: Run all automated verification**

Run:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m unittest worker.tests.test_placement_reconstruction worker.tests.test_placement_backfill_reconstruction -v
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python -m unittest worker.tests.test_worker_backfill worker.tests.test_backfill_runner -v
npm run test:placement
npx tsc --noEmit
npm run lint -- --ignore-pattern '.worktrees/**'
npm run build
git diff --check
git status --short
```

Expected: all tests and checks PASS; worktree is clean.

- [ ] **Step 2: Push PongLens main and verify the remote revision**

Run:

```bash
git push origin main
git ls-remote --heads origin main
```

Expected: the remote main hash equals local `git rev-parse HEAD`.

- [ ] **Step 3: Restart and inspect the production worker**

Run:

```bash
launchctl kickstart -k gui/501/com.adil.ponglens-worker
launchctl print gui/501/com.adil.ponglens-worker |
  rg 'state =|pid =|last exit code ='
```

Expected: state is running and a PID is present. Never print inherited
environment variables or Keychain values.

- [ ] **Step 4: Resolve and dry-run the Vaibhab canary**

Use a read-only parameterized query to locate the intended Vaibhab match and
require exactly one result. Set `CANARY_MATCH_ID` only in the local shell, then
run the documented `--dry-run` command.

Expected: exactly 20 eligible matches, 1,109 points, no writes, empty pgmq
queue.

- [ ] **Step 5: Run the production rollout**

Run:

```bash
worker/venv/bin/python worker/backfill_placement_v3.py \
  --canary-match-id "$CANARY_MATCH_ID" --all-after-canary
```

Expected: canary passes its invariant check before any other match begins; the
summary reports 20 succeeded, 0 failed, and 1,109 updated placements.

- [ ] **Step 6: Verify production state independently**

Run a read-only production query that checks:

```sql
select
  count(distinct m.id) as matches,
  count(p.id) as points,
  count(*) filter (where (p.placement->>'v')::int = 3) as placement_v3
from public.matches m
join public.points p on p.match_id = m.id
where m.status = 'ready';
```

Also verify every stored `match.json` has the same point indices and placement
payloads as Postgres, and confirm `pgmq.metrics('jobs').queue_length = 0`.

Expected: 20 matches, 1,109 points, 1,109 v3 placements, 20 matching JSON
objects, and no queued backfill artifacts.

- [ ] **Step 7: Commit any verification-only correction and report**

If no correction was needed, do not create an empty commit. Report the deployed
commit, canary result, final production counts, any failed match IDs, and the
fact that no job rows, queue messages, or backup objects were created.
