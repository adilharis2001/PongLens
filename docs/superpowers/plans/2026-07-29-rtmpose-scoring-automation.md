# RTMPose Scoring Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run detector-free RTMPose once during match processing, persist high-precision first-server and player-end evidence separately from user decisions, and simplify Keep Score, Point Detail, and Match Overview around automatic results with one-tap Undo.

**Architecture:** Promote the measured evaluator into a fail-open production subprocess with a versioned JSON contract. Store the evidence on the match, resolve it through pure Python and TypeScript precedence functions, and make every match surface consume the same resolved first server and game boundaries. The browser never runs pose inference; it only folds stored evidence, scores, and user overrides.

**Tech Stack:** Python 3.12, OpenCV, NumPy, `rtmlib==0.0.15`, ONNX Runtime, official RTMPose-M COCO-17 ONNX checkpoint, PostgreSQL/Supabase, TypeScript, React 19, Next.js 15, Node test runner.

## Global Constraints

- Use official RTMPose-M checkpoint SHA-256 `5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c`.
- Use calibration-guided near/far regions without a person detector or any YOLO-family dependency.
- Run pose inference only in the background worker, never in the browser or a Keep Score request.
- Use the measured `sparse-3` profile: frames at 20%, 50%, and 80% of every eligible point.
- Require at least two consistent high-confidence first-server votes from the first three eligible points.
- Require two persistent high-confidence contradictory player assignments before emitting an end change.
- Preserve raw/model evidence separately from `matches.first_server`, `points.server_override`, and `points.game_end_override`.
- Existing non-null `matches.first_server` values migrate as user-authoritative.
- User decisions always outrank detected evidence and are never overwritten by reprocessing.
- Missing calibration, model, runtime, frames, or confidence must withhold or fail open; the match still becomes ready.
- Feature flags independently gate worker generation, first-server application, and boundary application.
- Precision is more important than coverage.

---

### Task 1: Carry forward the audited PongLens YOLO purge

**Files:**
- Delete: `scripts/demos/blur.py`
- Delete: `scripts/demos/blur_video.py`
- Delete: `scripts/demos/assets/sign.png`
- Delete: `scripts/demos/assets/tv.png`
- Modify: `scripts/demos/chapters.sh`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: reviewed commit `5a46ab8` from `codex/rtmpose-production-serve`.
- Produces: a PongLens tree with no executable Ultralytics demo or tracked YOLO-only assets.

- [ ] **Step 1: Record the currently failing executable audit**

Run:

```bash
rg -n 'from ultralytics|import ultralytics|YOLO\(' \
  scripts/demos
```

Expected: matches in `blur.py` and `blur_video.py`.

- [ ] **Step 2: Apply the previously reviewed purge**

Run:

```bash
git cherry-pick 5a46ab8
```

Expected: commit `Remove unused YOLO demo blurring` applies without unrelated files.

- [ ] **Step 3: Verify the executable audit is clean**

Run:

```bash
if rg -n 'from ultralytics|import ultralytics|YOLO\(' scripts/demos; then
  exit 1
fi
```

Expected: exit 0 and no matches.

### Task 2: Promote pure RTMPose evidence logic

**Files:**
- Create: `worker/match_structure.py`
- Create: `worker/tests/test_match_structure.py`
- Create: `worker/requirements-rtmpose.txt`

**Interfaces:**
- Consumes: plain mappings containing table corners, COCO-17 keypoints, torso signatures, and per-point serve calls.
- Produces:
  - `build_player_regions(corners, width, height) -> dict[str, list[float]]`
  - `encode_players(keypoints, scores, sides) -> list[dict]`
  - `torso_signature(image, player) -> list[float] | None`
  - `assign_anonymous_players(signatures, margin_threshold=0.08) -> dict[int, dict]`
  - `detect_end_changes(assignments, confirmations=2) -> list[dict]`
  - `detect_server_side(detections, poses, fps) -> dict`
  - `aggregate_first_server(calls) -> dict`
  - constants `ALGORITHM_VERSION`, `EXPECTED_CHECKPOINT_SHA256`.

- [ ] **Step 1: Write failing tests for the frozen precision gates**

Create `worker/tests/test_match_structure.py` with literal expectations:

```python
import unittest

import numpy as np

from worker.match_structure import (
    aggregate_first_server,
    assign_anonymous_players,
    build_player_regions,
    detect_end_changes,
    torso_signature,
)


class FirstServerTests(unittest.TestCase):
    def test_requires_two_consistent_aab_adjusted_votes(self):
        calls = [
            {"position": 1, "idx": 11, "side": "near",
             "status": "high_confidence"},
            {"position": 2, "idx": 12, "side": "near",
             "status": "high_confidence"},
            {"position": 3, "idx": 13, "side": "far",
             "status": "high_confidence"},
        ]
        result = aggregate_first_server(calls)
        self.assertEqual(result["side"], "near")
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["usable_points"], [11, 12, 13])

    def test_withholds_one_usable_vote(self):
        result = aggregate_first_server([
            {"position": 1, "idx": 11, "side": "near",
             "status": "high_confidence"},
            {"position": 2, "idx": 12, "side": None,
             "status": "needs_review"},
            {"position": 3, "idx": 13, "side": None,
             "status": "unavailable"},
        ])
        self.assertIsNone(result["side"])
        self.assertEqual(result["status"], "withheld")


class EndChangeTests(unittest.TestCase):
    def test_one_contradiction_does_not_change_state(self):
        assignments = {
            1: {"state": "direct", "status": "high_confidence"},
            2: {"state": "swapped", "status": "high_confidence"},
            3: {"state": "direct", "status": "high_confidence"},
        }
        self.assertEqual(detect_end_changes(assignments), [])

    def test_two_contradictions_emit_stable_interval(self):
        assignments = {
            1: {"state": "direct", "status": "high_confidence"},
            2: {"state": "direct", "status": "high_confidence"},
            4: {"state": "swapped", "status": "high_confidence"},
            5: {"state": "swapped", "status": "high_confidence"},
        }
        self.assertEqual(detect_end_changes(assignments), [{
            "after_idx": 2,
            "before_idx": 4,
            "confirmed_at_idx": 5,
            "old_state": "direct",
            "new_state": "swapped",
            "confirmations": 2,
            "kind": "end_change",
        }])


class AppearanceTests(unittest.TestCase):
    def test_assigns_swapped_players_only_above_frozen_margin(self):
        result = assign_anonymous_players({
            1: {"near": [0.1, 0.2, 0.3], "far": [0.8, 0.7, 0.6]},
            2: {"near": [0.79, 0.69, 0.61], "far": [0.11, 0.19, 0.31]},
        })
        self.assertEqual(result[2]["state"], "swapped")
        self.assertEqual(result[2]["status"], "high_confidence")

    def test_torso_signature_requires_three_confident_joints(self):
        image = np.full((40, 40, 3), 128, dtype=np.uint8)
        player = {"kpts": [[0, 0, 0]] * 17}
        self.assertIsNone(torso_signature(image, player))


class RegionTests(unittest.TestCase):
    def test_calibration_builds_two_bounded_regions(self):
        regions = build_player_regions({
            "near_left": [100, 350], "near_right": [500, 350],
            "far_left": [200, 150], "far_right": [400, 150],
        }, 640, 480)
        self.assertEqual(set(regions), {"near", "far"})
        for box in regions.values():
            self.assertEqual(len(box), 4)
            self.assertGreater(box[2], box[0])
            self.assertGreater(box[3], box[1])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest worker.tests.test_match_structure -v
```

Expected: import failure for `worker.match_structure`.

- [ ] **Step 3: Implement the pure module from the validated evaluator**

Create `worker/match_structure.py`. Port the validated function bodies from
`codex/vaibhab-capability-eval` without evaluation I/O. The public contract
starts with:

```python
from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import numpy as np

ALGORITHM_VERSION = "rtmpose-match-structure-v1"
EXPECTED_CHECKPOINT_SHA256 = (
    "5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c"
)
MARGIN_THRESHOLD = 0.08
CONFIRMATIONS_REQUIRED = 2


def first_server_vote(position: int, side: str | None) -> str | None:
    if side not in {"near", "far"}:
        return None
    if position in (1, 2):
        return side
    if position == 3:
        return "far" if side == "near" else "near"
    raise ValueError("first-server votes are limited to positions 1-3")


def aggregate_first_server(calls: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    votes = {"near": 0, "far": 0}
    usable = []
    for call in calls:
        if call.get("status") != "high_confidence":
            continue
        vote = first_server_vote(int(call["position"]), call.get("side"))
        if vote is None:
            continue
        votes[vote] += 1
        usable.append(int(call["idx"]))
    side = None
    if votes["near"] >= 2 and votes["near"] > votes["far"]:
        side = "near"
    elif votes["far"] >= 2 and votes["far"] > votes["near"]:
        side = "far"
    return {
        "side": side,
        "status": "high_confidence" if side else "withheld",
        "votes": votes,
        "usable_points": usable,
    }
```

Keep the measured gates verbatim:

```python
high_confidence = (
    best_score >= 2.5
    and best_score - other_score >= 1.0
    and ratio >= 1.35
    and samples[best] >= 4
)
```

Use `margin_threshold=0.08` and `confirmations=2` as defaults. Do not import
database, R2, command-line, or ONNX code into this module.

- [ ] **Step 4: Pin the isolated runtime**

Create `worker/requirements-rtmpose.txt`:

```text
numpy==2.4.1
opencv-python==4.13.0.90
onnxruntime==1.28.0
rtmlib==0.0.15
```

- [ ] **Step 5: Run the focused and worker suites**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest worker.tests.test_match_structure -v
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest discover -s worker/tests -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add worker/match_structure.py worker/tests/test_match_structure.py \
  worker/requirements-rtmpose.txt
git commit -m "Add production match structure logic"
```

### Task 3: Build the fail-closed evidence command

**Files:**
- Create: `worker/extract_match_structure_rtmpose.py`
- Create: `worker/bootstrap_rtmpose.py`
- Create: `worker/tests/test_extract_match_structure.py`
- Create: `worker/tests/test_bootstrap_rtmpose.py`

**Interfaces:**
- Consumes:
  - point clip directory;
  - point-pipeline `match.json` or a blind point manifest;
  - per-point BlurBall JSONL directory for the first three points;
  - exact RTMPose checkpoint path;
  - backend and device.
- Produces: atomic version-1 evidence JSON with `status`, `first_server`,
  `points`, `end_changes`, `model`, and `compute`.
- The command exits nonzero on invalid provenance or inference failure. The
  caller, not this command, owns fail-open match behavior.

- [ ] **Step 1: Write failing tests for frame selection and evidence validation**

Create `worker/tests/test_extract_match_structure.py`:

```python
import unittest

from worker.extract_match_structure_rtmpose import (
    point_sample_frames,
    rebase_point_detections,
    validate_evidence,
)


class FrameSelectionTests(unittest.TestCase):
    def test_sparse_three_uses_twenty_fifty_eighty_percent(self):
        self.assertEqual(point_sample_frames(frame_count=101), [20, 50, 80])

    def test_duplicate_rounded_frames_are_deduplicated(self):
        self.assertEqual(point_sample_frames(frame_count=2), [0, 1])

    def test_global_blurball_frames_rebase_into_the_point_clip(self):
        detections = {
            250: (10.0, 20.0),
            275: (11.0, 21.0),
            400: (12.0, 22.0),
        }
        point = {"clip_t0": 10.0, "clip_t1": 12.0}
        self.assertEqual(
            rebase_point_detections(
                detections,
                point,
                source_fps=25.0,
                clip_fps=25.0,
            ),
            {0: (10.0, 20.0), 25: (11.0, 21.0)},
        )


class EvidenceValidationTests(unittest.TestCase):
    def test_rejects_forbidden_model_provenance(self):
        evidence = {
            "version": 1,
            "status": "ready",
            "algorithm": "rtmpose-match-structure-v1",
            "model": {
                "family": "YOLO",
                "checkpoint_sha256": "a" * 64,
                "profile": "sparse-3",
            },
            "first_server": {"status": "withheld", "side": None},
            "points": [],
            "end_changes": [],
            "coverage": {"total": 0, "high_confidence": 0,
                         "needs_review": 0, "unavailable": 0},
            "compute": {"elapsed_s": 0.1},
        }
        with self.assertRaisesRegex(ValueError, "forbidden"):
            validate_evidence(evidence)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/adil/Library/Caches/PongLens/rtmpose-poc/venv/bin/python \
  -m unittest worker.tests.test_extract_match_structure -v
```

Expected: import failure for `worker.extract_match_structure_rtmpose`.

- [ ] **Step 3: Implement deterministic sampling and atomic output**

Create `worker/extract_match_structure_rtmpose.py` with:

```python
def point_sample_frames(frame_count: int) -> list[int]:
    if frame_count <= 0:
        return []
    last = frame_count - 1
    return sorted({
        min(last, max(0, int(round(last * fraction))))
        for fraction in (0.2, 0.5, 0.8)
    })


def atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)
```

The command must:

1. validate checkpoint SHA-256 before model creation;
2. load calibration from `match_json["calibration"]["table_corners_px"]`
   or the blind benchmark calibration file;
3. build two fixed player regions;
4. decode only sparse-three frames from each point clip for appearance;
5. decode only early ball-observed frames for the first three eligible points;
6. aggregate torso signatures, anonymous identities, end changes, and
   first-server votes through `worker.match_structure`;
7. keep point indices and `t0`/`t1` in command output; and
8. atomically publish only a validated artifact.

`validate_evidence()` rejects model provenance matching
`re.compile(r"ultralytics|yolo", re.I)`, an unexpected checkpoint hash,
duplicate point indices, non-finite compute values, and end-change references
outside the point set.

The CLI accepts either `--blurball-dir` for the blind benchmark or
`--blurball` for production. Production uses
`rebase_point_detections(global_detections, point, source_fps, clip_fps)` to
translate original-video frames through `point.clip_t0` into point-clip
frames; benchmark mode reads its already point-local JSONL files. Both modes
call the same `extract_evidence()` implementation.

- [ ] **Step 4: Add fake-model integration coverage**

Extend the test file with a fake returning literal COCO-17 arrays. Call the
module-level `extract_evidence()` with a temporary point-clip directory,
per-point BlurBall directory, and literal match JSON. Pass
`pose_model=fake_model`. Assert:

```python
self.assertEqual(result["model"]["family"], "RTMPose")
self.assertEqual(result["model"]["profile"], "sparse-3")
self.assertNotIn("poses", result)
self.assertNotIn("frames", result)
self.assertTrue(output_path.is_file())
self.assertFalse(output_path.with_suffix(".json.tmp").exists())
```

The production change caught is accidental persistence of raw skeleton/frame
data or non-atomic output.

- [ ] **Step 5: Run RED, implement the extractor seam, and verify GREEN**

Run the new fake-model test before adding `extract_evidence`; expect an
attribute/import failure. Implement this exact public signature:

```python
def extract_evidence(
    clips_dir: Path,
    blurball_dir: Path,
    match_json_path: Path,
    output_path: Path,
    model_path: Path,
    backend: str,
    device: str,
    pose_model: Any | None = None,
) -> dict[str, Any]:
```

Then run:

```bash
/Users/adil/Library/Caches/PongLens/rtmpose-poc/venv/bin/python \
  -m unittest worker.tests.test_extract_match_structure -v
```

Expected: all focused tests pass.

- [ ] **Step 6: Verify the real Vaibhav artifact path**

Before the real run, write a failing bootstrap test:

```python
from worker.bootstrap_rtmpose import verify_checkpoint


def test_wrong_checkpoint_never_replaces_active_model(self):
    active = self.root / "active.onnx"
    active.write_bytes(b"known-good")
    candidate = self.root / "candidate.onnx"
    candidate.write_bytes(b"wrong")
    with self.assertRaisesRegex(ValueError, "SHA-256"):
        verify_checkpoint(candidate, "0" * 64)
    self.assertEqual(active.read_bytes(), b"known-good")
```

Run it and expect an import failure. Implement an idempotent bootstrap command
that:

1. creates the target virtual environment;
2. installs `worker/requirements-rtmpose.txt`;
3. downloads the official RTMPose zip to a temporary file;
4. extracts `end2end.onnx` into a temporary directory;
5. verifies the exact checkpoint SHA-256;
6. atomically replaces the active model only after verification; and
7. exits without reinstalling when the environment and active hash already
   match.

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest worker.tests.test_bootstrap_rtmpose -v
```

Expected: all bootstrap tests pass.

Run the production command against the already-materialized Vaibhav source
inputs and checkpoint:

```bash
/Users/adil/Library/Caches/PongLens/rtmpose-poc/venv/bin/python \
  worker/extract_match_structure_rtmpose.py \
  --clips-dir /Users/adil/Desktop/PongLens-Reports/vaibhav-match-structure-20260729/clips \
  --blurball-dir /Users/adil/Desktop/PongLens-Reports/vaibhav-match-structure-20260729/serve/blurball \
  --manifest /Users/adil/Desktop/PongLens-Reports/vaibhav-match-structure-20260729/match-structure-manifest.json \
  --calibration /Users/adil/Desktop/PongLens-Reports/vaibhav-match-structure-20260729/calibration.json \
  --output /private/tmp/ponglens-production-match-structure.json \
  --model /Users/adil/Desktop/PongLens-Reports/vaibhav-match-structure-20260729/models/rtmpose-m-end2end.onnx \
  --backend onnxruntime \
  --device mps
```

Validate output with the command's `--validate-only` mode. The input manifest
contains no score, winner, boundary, server, side, grading, or note fields.

- [ ] **Step 7: Commit**

```bash
git add worker/extract_match_structure_rtmpose.py \
  worker/bootstrap_rtmpose.py worker/tests/test_extract_match_structure.py \
  worker/tests/test_bootstrap_rtmpose.py
git commit -m "Extract production RTMPose match evidence"
```

### Task 4: Persist versioned evidence without overwriting users

**Files:**
- Create: `supabase/migrations/051_match_structure_evidence.sql`
- Modify: `worker/worker.py`
- Modify: `worker/tests/test_worker_backfill.py`
- Modify: `src/lib/types.ts`
- Modify: `worker/README.md`

**Interfaces:**
- Consumes: command evidence keyed by worker point index.
- Produces:
  - `matches.match_structure jsonb`;
  - `matches.first_server_source = user | detected | null`;
  - DB evidence whose point references include stable UUIDs and timestamps;
  - fail-open worker behavior.

- [ ] **Step 1: Write migration contract tests**

Create `src/lib/research/matchStructureMigration.test.ts`:

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/051_match_structure_evidence.sql",
  "utf8"
);

test("existing first servers become user authoritative", () => {
  assert.match(
    sql,
    /update public\.matches[\s\S]*first_server_source = 'user'[\s\S]*first_server is not null/i
  );
});

test("match structure and source values are constrained", () => {
  assert.match(sql, /add column if not exists match_structure jsonb/i);
  assert.match(sql, /first_server_source in \('user', 'detected'\)/i);
});
```

Add `"test:match-structure"` to `package.json`:

```json
"test:match-structure": "node --test --experimental-strip-types src/app/match/\\[id\\]/matchStructure.test.ts src/lib/research/matchStructureMigration.test.ts"
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
npm run test:match-structure
```

Expected: missing migration file.

- [ ] **Step 3: Add the migration**

Create `supabase/migrations/051_match_structure_evidence.sql`:

```sql
alter table public.matches
  add column if not exists match_structure jsonb,
  add column if not exists first_server_source text
    check (first_server_source in ('user', 'detected'));

update public.matches
set first_server_source = 'user'
where first_server is not null
  and first_server_source is null;

grant update (first_server, first_server_source)
  on public.matches to authenticated;

comment on column public.matches.match_structure is
  'Versioned RTMPose first-server and persistent player-end evidence. Raw evidence is separate from user score overrides.';
comment on column public.matches.first_server_source is
  'Authority for first_server: user values are never overwritten by worker detection; detected values may be refreshed.';
```

- [ ] **Step 4: Write failing worker persistence tests**

Add tests that call new pure helpers:

```python
from worker.worker import (
    map_structure_point_ids,
    resolved_detected_first_server,
)


def test_evidence_maps_indices_to_stable_ids(self):
    evidence = {
        "points": [{"idx": 3, "assignment": {"status": "unavailable"}}],
        "end_changes": [{
            "after_idx": 3, "before_idx": 4, "confirmed_at_idx": 5
        }],
    }
    mapped = map_structure_point_ids(
        evidence,
        {
            3: {"id": "p3", "t0": 10.0, "t1": 11.0},
            4: {"id": "p4", "t0": 12.0, "t1": 13.0},
            5: {"id": "p5", "t0": 14.0, "t1": 15.0},
        },
    )
    self.assertEqual(mapped["points"][0]["point_id"], "p3")
    self.assertEqual(mapped["end_changes"][0]["after_point_id"], "p3")
    self.assertEqual(mapped["end_changes"][0]["before_point_id"], "p4")


def test_detected_first_server_maps_through_user_side(self):
    evidence = {
        "first_server": {
            "status": "high_confidence",
            "side": "near",
        }
    }
    self.assertEqual(
        resolved_detected_first_server(evidence, "near"),
        "user",
    )
    self.assertEqual(
        resolved_detected_first_server(evidence, "far"),
        "opponent",
    )
```

- [ ] **Step 5: Run the focused worker tests and verify RED**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest worker.tests.test_worker_backfill -v
```

Expected: missing helper imports.

- [ ] **Step 6: Implement fail-open worker orchestration**

Add constants:

```python
MATCH_STRUCTURE_ENABLED = (
    os.environ.get("PONGLENS_RTMPOSE_STRUCTURE_ENABLED") == "true"
)
RTMPOSE_PY = os.environ.get(
    "PONGLENS_RTMPOSE_PY",
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python",
)
RTMPOSE_MODEL = os.environ.get(
    "PONGLENS_RTMPOSE_MODEL",
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx",
)
```

Implement:

```python
def run_match_structure_stage(
    blurball_out: str,
    match_json_path: str,
    clips_dir: str,
    workdir: str,
) -> dict | None:
    if not MATCH_STRUCTURE_ENABLED:
        return None
    output = os.path.join(workdir, "match-structure.json")
    try:
        subprocess.run(
            [
                RTMPOSE_PY,
                MATCH_STRUCTURE_SCRIPT,
                "--clips-dir", clips_dir,
                "--blurball", blurball_out,
                "--match-json", match_json_path,
                "--output", output,
                "--model", RTMPOSE_MODEL,
                "--backend", "onnxruntime",
                "--device", "mps",
            ],
            check=True,
            timeout=20 * 60,
        )
        with open(output) as source:
            return json.load(source)
    except Exception:
        log.exception("  match structure withheld; normal processing continues")
        return {"version": 1, "status": "failed",
                "algorithm": "rtmpose-match-structure-v1"}
```

Change `insert_points()` to generate/insert UUIDs and return:

```python
{
    int(point["idx"]): {
        "id": point_id,
        "t0": float(point["t0"]),
        "t1": float(point["t1"]),
    }
}
```

Run the structure stage after `match.json` is created and before upload.
When generation is enabled, `create_match()` inserts:

```json
{
  "version": 1,
  "status": "pending",
  "algorithm": "rtmpose-match-structure-v1"
}
```

When generation is disabled it inserts `NULL`, which distinguishes historical
matches from genuinely in-progress detection. A failed command replaces
`pending` with the fail-open `failed` artifact before the match becomes ready.

After point insertion, map indices to stable IDs and update the match in one
transaction:

```sql
update public.matches
set match_structure = %s,
    first_server = case
      when first_server_source = 'user' then first_server
      else coalesce(%s, first_server)
    end,
    first_server_source = case
      when first_server_source = 'user' then 'user'
      when %s is not null then 'detected'
      else first_server_source
    end
where id = %s
```

The helper must return `None` unless evidence is high confidence and
`user_side` is `near` or `far`.

- [ ] **Step 7: Extend TypeScript match types**

Add typed structures to `src/lib/types.ts`:

```typescript
export type MatchStructureStatus =
  | "pending"
  | "ready"
  | "withheld"
  | "failed";

export interface MatchEndChangeEvidence {
  after_point_id: string | null;
  before_point_id: string | null;
  confirmed_at_point_id: string | null;
  after_idx: number;
  before_idx: number;
  confirmed_at_idx: number;
  old_state: "direct" | "swapped";
  new_state: "direct" | "swapped";
  confirmations: number;
  kind: "end_change";
}

export interface MatchStructureEvidence {
  version: 1;
  status: MatchStructureStatus;
  algorithm: "rtmpose-match-structure-v1";
  first_server?: {
    status: "high_confidence" | "withheld" | "unavailable";
    side: "near" | "far" | null;
    usable_points?: number[];
  };
  end_changes?: MatchEndChangeEvidence[];
  coverage?: {
    total: number;
    high_confidence: number;
    needs_review: number;
    unavailable: number;
  };
}
```

Add to `Match`:

```typescript
first_server_source: "user" | "detected" | null;
match_structure: MatchStructureEvidence | null;
```

- [ ] **Step 8: Verify worker fail-open behavior and commit**

Run:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest discover -s worker/tests -v
npm run test:match-structure
```

Expected: all tests pass.

Commit:

```bash
git add package.json src/lib/types.ts worker/worker.py worker/README.md \
  worker/tests/test_worker_backfill.py \
  src/lib/research/matchStructureMigration.test.ts \
  supabase/migrations/051_match_structure_evidence.sql
git commit -m "Persist RTMPose match structure evidence"
```

### Task 5: Build the single TypeScript resolution authority

**Files:**
- Create: `src/app/match/[id]/matchStructure.ts`
- Create: `src/app/match/[id]/matchStructure.test.ts`
- Modify: `src/app/match/[id]/gameScore.ts`
- Modify: `src/app/match/[id]/serving.ts`
- Modify: `src/app/match/[id]/matchStats.ts`
- Modify: `src/app/match/[id]/matchAnalysis.ts`

**Interfaces:**
- Consumes: visible points, match evidence, first-server value/source, and
  feature gates.
- Produces:
  - `resolveFirstServer(match, enabled) -> ResolvedFirstServer`
  - `resolveMatchBoundaries(points, evidence, enabled) -> ResolvedBoundaries`
  - `computeMatchScore(points, detectedOverrides?)`
  - `computeServing(points, firstServer, detectedOverrides?)`.

- [ ] **Step 1: Write failing resolver tests**

Create literal point fixtures with IDs `p1` through `p25`. Cover:

```typescript
test("user first server outranks opposite detection", () => {
  const result = resolveFirstServer({
    first_server: "opponent",
    first_server_source: "user",
    user_side: "near",
    match_structure: evidenceWithFirstServer("near"),
  }, true);
  assert.deepEqual(result, { server: "opponent", source: "user" });
});

test("high-confidence near maps through a far user side", () => {
  const result = resolveFirstServer({
    first_server: null,
    first_server_source: null,
    user_side: "far",
    match_structure: evidenceWithFirstServer("near"),
  }, true);
  assert.deepEqual(result, { server: "opponent", source: "detected" });
});

test("detected exact boundary suppresses an earlier score boundary", () => {
  const points = scoredPointsEndingAt("p18");
  const result = resolveMatchBoundaries(
    points,
    evidenceWithChange("p20", "p21", "p22"),
    true
  );
  assert.equal(result.effectiveOverrides.get("p18"), "continue");
  assert.equal(result.effectiveOverrides.get("p20"), "end");
  assert.equal(result.provenance.get("p20"), "detected");
});

test("score boundary inside a bracket resolves without moving", () => {
  const points = scoredPointsEndingAt("p20");
  const result = resolveMatchBoundaries(
    points,
    evidenceWithChange("p19", "p21", "p22"),
    true
  );
  assert.equal(result.effectiveOverrides.size, 0);
  assert.equal(result.provenance.get("p20"), "score-confirmed");
});

test("explicit user end wins over detected boundary", () => {
  const points = scoredPointsEndingAt("p18");
  points.find((point) => point.id === "p19")!.game_end_override = "end";
  const result = resolveMatchBoundaries(
    points,
    evidenceWithChange("p20", "p21", "p22"),
    true
  );
  assert.equal(result.effectiveOverrides.get("p19"), undefined);
  assert.equal(result.boundaryAfter.has("p19"), true);
});

test("low coverage withholds boundary application", () => {
  const evidence = evidenceWithChange("p20", "p21", "p22");
  evidence.coverage = {
    total: 25, high_confidence: 10, needs_review: 10, unavailable: 5
  };
  const result = resolveMatchBoundaries(scoredPointsEndingAt("p18"), evidence, true);
  assert.equal(result.effectiveOverrides.size, 0);
  assert.equal(result.unresolved.length, 1);
});
```

Use hand-derived winners in fixtures; do not compute expected boundaries with
the production resolver.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run:

```bash
npm run test:match-structure
```

Expected: missing `matchStructure.ts`.

- [ ] **Step 3: Implement first-server and evidence validation**

Create:

```typescript
export interface ResolvedFirstServer {
  server: MatchServer | null;
  source: "user" | "detected" | "unknown";
}

export function resolveFirstServer(
  match: Pick<
    Match,
    "first_server" | "first_server_source" | "user_side" | "match_structure"
  >,
  enabled: boolean
): ResolvedFirstServer {
  if (match.first_server_source === "user" && match.first_server) {
    return { server: match.first_server, source: "user" };
  }
  const detected = match.match_structure?.first_server;
  if (
    enabled &&
    detected?.status === "high_confidence" &&
    detected.side &&
    match.user_side
  ) {
    return {
      server: detected.side === match.user_side ? "user" : "opponent",
      source: "detected",
    };
  }
  if (match.first_server) {
    return {
      server: match.first_server,
      source:
        match.first_server_source === "detected" ? "detected" : "user",
    };
  }
  return { server: null, source: "unknown" };
}
```

- [ ] **Step 4: Implement boundary reconciliation**

Define:

```typescript
export interface ResolvedBoundaries {
  effectiveOverrides: Map<string, GameEndOverride>;
  provenance: Map<string, "user" | "detected" | "score-confirmed">;
  boundaryAfter: Set<string>;
  unresolved: MatchEndChangeEvidence[];
}
```

Rules in `resolveMatchBoundaries()`:

1. return no detected overrides when disabled, evidence is not `ready`, or
   high-confidence coverage is below 90%;
2. preserve any explicit user `end`/`continue`;
3. use the existing score walk to find provisional score boundaries;
4. resolve a bracket to the provisional score boundary when it lies after
   `after_point_id` and before `before_point_id`;
5. accept an exact candidate only when `after_point_id` immediately precedes
   `before_point_id` among visible points;
6. pair accepted candidates and provisional score boundaries in chronology;
7. when a paired score boundary is earlier, add detected `continue` there and
   detected `end` at the accepted candidate;
8. when the accepted candidate is earlier, add detected `end` there;
9. do not apply a candidate whose running score at the interval is a tied-game
   five-point pattern: completed games tied and either player has exactly five
   while both are below eleven; and
10. return all withheld candidates in `unresolved`.

After building `effectiveOverrides`, call `computeMatchScore()` once with that
map and derive `boundaryAfter`.

- [ ] **Step 5: Thread effective overrides through score and serve**

Change signatures:

```typescript
export function computeMatchScore(
  orderedPoints: Point[],
  detectedOverrides: ReadonlyMap<string, GameEndOverride> = new Map()
): MatchScore

export function computeServing(
  visiblePoints: Point[],
  firstServer: MatchServer | null,
  detectedOverrides: ReadonlyMap<string, GameEndOverride> = new Map()
): Map<string, ServeInfo>
```

At every walk:

```typescript
const override =
  p.game_end_override ?? detectedOverrides.get(p.id) ?? null;
```

Apply the same parameter to `computeMatchStats()` and
`computeMatchAnalysis()`. Explicit user overrides remain first by the
nullish-coalescing order.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm run test:match-structure
npm run test:placement
```

Expected: all tests pass.

Commit:

```bash
git add 'src/app/match/[id]/matchStructure.ts' \
  'src/app/match/[id]/matchStructure.test.ts' \
  'src/app/match/[id]/gameScore.ts' \
  'src/app/match/[id]/serving.ts' \
  'src/app/match/[id]/matchStats.ts' \
  'src/app/match/[id]/matchAnalysis.ts'
git commit -m "Resolve detected scoring structure"
```

### Task 6: Simplify Keep Score around precomputed evidence

**Files:**
- Modify: `src/lib/flags.ts`
- Create: `src/lib/structureTelemetry.ts`
- Modify: `src/app/match/[id]/MatchView.tsx`
- Modify: `src/app/match/[id]/Player.tsx`
- Modify: `src/app/match/[id]/ScoreBug.tsx`

**Interfaces:**
- Consumes: resolved first server, resolved boundaries, provenance, and flags.
- Produces: non-blocking scoring entry, ordinary server display, detected
  boundary notification, and one-tap Undo.

- [ ] **Step 1: Add pure setup-decision tests**

Add to `matchStructure.test.ts`:

```typescript
test("ready detected server bypasses the serve setup sheet", () => {
  assert.equal(
    keepScoreServeSetup({
      firstServer: { server: "user", source: "detected" },
      evidenceStatus: "ready",
      enabled: true,
    }),
    "skip"
  );
});

test("pending evidence starts scoring without a blocking sheet", () => {
  assert.equal(
    keepScoreServeSetup({
      firstServer: { server: null, source: "unknown" },
      evidenceStatus: "pending",
      enabled: true,
    }),
    "detecting"
  );
});

test("withheld evidence asks at the first pause", () => {
  assert.equal(
    keepScoreServeSetup({
      firstServer: { server: null, source: "unknown" },
      evidenceStatus: "withheld",
      enabled: true,
    }),
    "ask-at-pause"
  );
});
```

The helper returns `"skip" | "detecting" | "ask-at-pause" | "ask-now"`.

Also test the telemetry allowlist:

```typescript
test("structure telemetry excludes match and player identifiers", () => {
  assert.deepEqual(
    structureEventPayload("boundary_applied", {
      confidence: "high",
      arrival: "before_entry",
      matchId: "must-not-leak",
    }),
    {
      event: "boundary_applied",
      confidence: "high",
      arrival: "before_entry",
    }
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run test:match-structure
```

Expected: missing `keepScoreServeSetup`.

- [ ] **Step 3: Add independent application flags**

In `src/lib/flags.ts`:

```typescript
export const RTMPOSE_FIRST_SERVER_ENABLED =
  process.env.NEXT_PUBLIC_RTMPOSE_FIRST_SERVER_ENABLED === "true";
export const RTMPOSE_BOUNDARIES_ENABLED =
  process.env.NEXT_PUBLIC_RTMPOSE_BOUNDARIES_ENABLED === "true";
```

Create `src/lib/structureTelemetry.ts` as the only client analytics adapter.
It accepts these event names:

```typescript
type StructureEvent =
  | "first_server_applied"
  | "first_server_corrected"
  | "fallback_question_shown"
  | "boundary_agreed"
  | "boundary_applied"
  | "boundary_undone"
  | "boundary_edited";
```

It forwards only `confidence`, `arrival`, `evidenceStatus`, and
`coverageBucket` to `track()` from `@vercel/analytics`; match IDs, point IDs,
names, scores, and timestamps are discarded.

- [ ] **Step 4: Compute resolution once in MatchView**

Add local state for evidence that can finish after first open:

```typescript
const [firstServerSource, setFirstServerSource] = useState(
  match.first_server_source
);
const [matchStructure, setMatchStructure] = useState(match.match_structure);

const resolvedFirstServer = useMemo(
  () => resolveFirstServer({
    first_server: firstServer,
    first_server_source: firstServerSource,
    user_side: userSide,
    match_structure: matchStructure,
  }, RTMPOSE_FIRST_SERVER_ENABLED),
  [firstServer, firstServerSource, userSide, matchStructure]
);
const resolvedBoundaries = useMemo(
  () => resolveMatchBoundaries(
    visiblePoints,
    matchStructure,
    RTMPOSE_BOUNDARIES_ENABLED
  ),
  [visiblePoints, matchStructure]
);
```

While `matchStructure?.status === "pending"`, poll only the current match row
every five seconds for `match_structure,first_server,first_server_source`.
Stop on `ready`, `withheld`, `failed`, unmount, or owner navigation. Apply a
detected first server only when the returned source is not `user`.

Use `resolvedFirstServer.server` and
`resolvedBoundaries.effectiveOverrides` for `computeServing`,
`computeMatchScore`, stats, analysis, and Player props.

Change `saveFirstServer()` to update both fields:

```typescript
.update({ first_server: value, first_server_source: "user" })
```

and update optimistic `match.first_server_source`.

After `handleSetUserSide()` succeeds, resolve the stored high-confidence
near/far result through the new side. If no user-sourced first server exists,
persist:

```typescript
{
  first_server: detectedSide === selectedSide ? "user" : "opponent",
  first_server_source: "detected",
}
```

The update predicate must exclude rows whose current
`first_server_source === "user"`.

- [ ] **Step 5: Make Keep Score entry non-blocking**

Pass to Player:

```typescript
firstServerSource={resolvedFirstServer.source}
matchStructureStatus={match.match_structure?.status ?? null}
detectedGameOverrides={resolvedBoundaries.effectiveOverrides}
detectedBoundaryProvenance={resolvedBoundaries.provenance}
automationEnabled={RTMPOSE_BOUNDARIES_ENABLED}
```

In `openScore()`, use `keepScoreServeSetup()`:

- `"skip"`: never open `serveSheet`;
- `"detecting"`: start playback and show `Detecting first server…`;
- `"ask-at-pause"`: set a ref and open the sheet only after the first
  automatic rally pause;
- `"ask-now"`: preserve the pre-flag behavior.

Names remain a separate setup sheet and may still start playback from Done.

- [ ] **Step 6: Replace boundary prompts with auto-correction feedback**

When automation is enabled:

- suppress the primary “Didn’t end?”, “Game ended here?”, and inline “End
  game” controls;
- when a scored point crosses a detected boundary whose provenance is
  `detected`, show:

```text
Game {nextGame} started after Point {displayNumber} · Undo
```

- Undo calls `onSetGameEnd(point, "continue")` when rejecting the detected
  boundary, or restores the prior user boundary payload when one exists;
- push the same action into Player's existing undo stack;
- do not show a toast when detected evidence merely confirms the score
  boundary.

When the flag is off, preserve the existing manual controls exactly.

Emit telemetry when detection is applied, the fallback question appears, an
automatic boundary agrees/moves, Undo is tapped, or a user correction is
saved. The worker logs generation status, elapsed/inference time, coverage
counts, and withholding/failure reason in its existing structured log; it
never logs pose arrays or frames.

- [ ] **Step 7: Run tests, lint, and build**

Run:

```bash
npm run test:match-structure
npm run lint
npm run build
```

Expected: tests pass, lint has no new errors/warnings, build exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/lib/flags.ts \
  src/lib/structureTelemetry.ts \
  'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/Player.tsx' \
  'src/app/match/[id]/ScoreBug.tsx' \
  'src/app/match/[id]/matchStructure.ts' \
  'src/app/match/[id]/matchStructure.test.ts'
git commit -m "Automate Keep Score match setup"
```

### Task 7: Integrate Point Detail and Match Overview

**Files:**
- Modify: `src/app/match/[id]/PointDetail.tsx`
- Modify: `src/app/match/[id]/PointScorecard.tsx`
- Modify: `src/app/match/[id]/MatchView.tsx`

**Interfaces:**
- Consumes: resolved server/boundary values and provenance.
- Produces: quiet resolved facts, correction controls, no success banner, and
  an unresolved-only review notice.

- [ ] **Step 1: Add pure presentation-state tests**

Add:

```typescript
test("point structure labels detection without confidence jargon", () => {
  assert.deepEqual(
    pointStructurePresentation({
      server: "user",
      serverSource: "detected",
      endsHere: true,
      boundarySource: "detected",
      userLabel: "Adil",
      opponentLabel: "Vaibhav",
    }),
    {
      serverLabel: "Adil served",
      serverDetail: "Detected",
      gameLabel: "Game ended after this point",
      gameDetail: "Detected from player positions",
    }
  );
});

test("user corrections are labeled as corrected", () => {
  const result = pointStructurePresentation({
    server: "opponent",
    serverSource: "user",
    endsHere: false,
    boundarySource: "user",
    userLabel: "Adil",
    opponentLabel: "Vaibhav",
  });
  assert.equal(result.serverDetail, "Corrected by you");
  assert.equal(result.gameDetail, "Corrected by you");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run test:match-structure
```

Expected: missing `pointStructurePresentation`.

- [ ] **Step 3: Wire Point Detail**

Pass `serve.source`, resolved `gameEnd`, and boundary provenance into
PointDetail/PointScorecard. Render two compact rows:

```text
Server      Adil served
            Detected

Game        Game ended after this point
            Detected from player positions
```

Tapping Server uses the existing `server_override` write. Tapping Game uses
the existing `game_end_override` write. Use “Corrected by you” when the
explicit override is present. Do not render model name or confidence number.

- [ ] **Step 4: Simplify Match Overview**

- hide the large first-server banner whenever the resolved first server is
  detected or user-sourced;
- add a Tools-row value `Adil served first` that opens the same correction
  control;
- make timeline game dividers consume the resolved score;
- render no success banner;
- while `match_structure.status === "pending"`, show the quiet, non-blocking
  Tools-row status `Analyzing players and game structure`; remove it when the
  evidence becomes ready, withheld, or failed;
- when `resolvedBoundaries.unresolved.length > 0`, render one quiet card:

```text
One game boundary may need review
Review points {afterDisplay}–{beforeDisplay}
```

The link selects the first point in the interval.

- [ ] **Step 5: Verify UI code and commit**

Run:

```bash
npm run test:match-structure
npm run lint
npm run build
```

Expected: all commands exit 0 with no new warnings.

Commit:

```bash
git add 'src/app/match/[id]/PointDetail.tsx' \
  'src/app/match/[id]/PointScorecard.tsx' \
  'src/app/match/[id]/MatchView.tsx' \
  'src/app/match/[id]/matchStructure.ts' \
  'src/app/match/[id]/matchStructure.test.ts'
git commit -m "Show resolved match structure across point views"
```

### Task 8: Make exports and aggregate consumers agree

**Files:**
- Modify: `src/app/api/reel/route.ts`
- Modify: `src/app/dashboard/shared.tsx`
- Modify: `src/app/matches/MatchLibrary.tsx`
- Modify: `src/app/stats/useAggregate.ts`
- Modify: `src/app/stats/aggregate.ts`

**Interfaces:**
- Consumes: match-level structure evidence alongside point rows.
- Produces: the same resolved game partition in reels, dashboard scores,
  match-library summaries, and aggregate stats.

- [ ] **Step 1: Add a cross-consumer fixture test**

Extend the TypeScript suite with a single hand-authored match/evidence fixture
and assert that:

```typescript
const resolved = resolveMatchBoundaries(points, evidence, true);
const score = computeMatchScore(points, resolved.effectiveOverrides);
assert.deepEqual(score.games.map((game) => [game.you, game.them]), [
  [11, 6],
  [11, 9],
]);
assert.deepEqual([...score.boundaryAfter.keys()], ["p17", "p37"]);
```

The production mutation caught is any consumer dropping the detected override
map and returning the earlier provisional boundary.

- [ ] **Step 2: Select match evidence where summaries are computed**

Update match queries to include:

```text
first_server,first_server_source,user_side,match_structure
```

Use `resolveFirstServer()` and `resolveMatchBoundaries()` before calling
`computeServing()` or `computeMatchScore()`.

In the reel route, fetch the match row in the existing match authorization
query and pass resolved overrides into its game walk.

- [ ] **Step 3: Run aggregate and API checks**

Run:

```bash
npm run test:match-structure
npm run test:auth
npm run test:placement
npm run test:research
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/reel/route.ts src/app/dashboard/shared.tsx \
  src/app/matches/MatchLibrary.tsx src/app/stats/useAggregate.ts \
  src/app/stats/aggregate.ts
git commit -m "Use resolved structure in match summaries"
```

### Task 9: Validate the production flow and create a review build

**Files:**
- Modify: `worker/README.md`
- Create: `docs/operations/rtmpose-match-structure.md`
- Create outside Git:
  `/Users/adil/Desktop/PongLens-Reports/rtmpose-scoring-automation-20260729/`

**Interfaces:**
- Consumes: the production worker command, reviewed Vaibhav fixture, and
  frontend flags.
- Produces: measured evidence, a local reviewable application, and a complete
  operational runbook.

- [ ] **Step 1: Document exact runtime and flags**

Document:

```text
PONGLENS_RTMPOSE_STRUCTURE_ENABLED=true
PONGLENS_RTMPOSE_PY=/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python
PONGLENS_RTMPOSE_MODEL=/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
NEXT_PUBLIC_RTMPOSE_FIRST_SERVER_ENABLED=true
NEXT_PUBLIC_RTMPOSE_BOUNDARIES_ENABLED=true
```

Include checkpoint hash verification:

```bash
shasum -a 256 /Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
```

and worker rollback:

```text
Set PONGLENS_RTMPOSE_STRUCTURE_ENABLED=false and restart the worker.
Set each NEXT_PUBLIC flag false and redeploy the app.
Stored user overrides remain authoritative and readable.
```

- [ ] **Step 2: Run the production extractor on the blind Vaibhav fixture**

Write its output and compute metadata under the report directory. Verify:

- model family is RTMPose;
- checkpoint hash is exact;
- first server is high confidence;
- no raw pose arrays or video frames are persisted;
- all candidate references map to stable point IDs in the database-shaped
  fixture; and
- processing time is recorded separately for inference and post-processing.

- [ ] **Step 3: Start a local review server**

Run:

```bash
NEXT_PUBLIC_RTMPOSE_FIRST_SERVER_ENABLED=true \
NEXT_PUBLIC_RTMPOSE_BOUNDARIES_ENABLED=true \
npm run dev -- --hostname 127.0.0.1 --port 8769
```

Open the Vaibhav match fixture/review route and verify:

1. Keep Score opens without asking who served first;
2. the server indicator is correct and tappable;
3. detected game dividers match the six reviewed boundaries;
4. a detected correction shows Undo;
5. Point Detail shows resolved server and game state;
6. Match Overview has no first-server banner; and
7. disabling both public flags restores the old manual behavior.

- [ ] **Step 4: Run the complete verification suite**

Run fresh:

```bash
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python \
  -m unittest discover -s worker/tests -v
npm run test:auth
npm run test:learn
npm run test:placement
npm run test:research
npm run test:match-structure
npm run lint
npm run build
git diff --check
```

Expected: every test passes, lint/build exit 0, and the only accepted lint
warning is the pre-existing `Annotator.tsx` unused `MAX_SAVE_W` warning.

- [ ] **Step 5: Run the license and model audit**

Run:

```bash
if rg -n 'from ultralytics|import ultralytics|YOLO\(' \
  . --hidden --glob '!.git/**' --glob '!node_modules/**' \
  --glob '!docs/**' --glob '!**/__pycache__/**'; then
  exit 1
fi
find . -path '*/.git' -prune -o \
  \( -iname 'yolo*.pt' -o -iname 'yolo*.onnx' -o \
     -path '*/site-packages/ultralytics' \) -print
```

Expected: no executable/model matches in this worktree. Historical docs may
record the prohibition/removal.

- [ ] **Step 6: Commit operational documentation**

```bash
git add worker/README.md docs/operations/rtmpose-match-structure.md
git commit -m "Document RTMPose scoring automation operations"
```

- [ ] **Step 7: Inspect final history and status**

Run:

```bash
git log --oneline --decorate -12
git status --short --branch
```

Expected: the feature branch contains only the design, plan, audited purge,
implementation, tests, and operations commits; worktree is clean.
