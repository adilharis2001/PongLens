# Service-Motion First-Server Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a read-only experiment that detects genuine service-motion onset, attributes the motion to the initiating physical player, and decodes several point calls into a high-precision first-server result.

**Architecture:** Add three pure analytical layers—service-motion scoring, bounce-chain selection, and missing-point-tolerant first-server decoding—then drive them through a bounded RTMPose experiment runner using the existing 100-source research batch plus the actual first five retained points from each source match. First evaluate pose with human first-bounce timestamps used only as oracle window boundaries; proceed to automatic bounce selection only if initiating-player precision clears the frozen gate. Extend the protected research page with a frozen onset-review mode containing only non-null model proposals after thresholds are frozen, without changing any production scoring behavior.

**Tech Stack:** Python 3.12; `unittest`; NumPy/OpenCV; official MMPose RTMPose-M PyTorch checkpoint; existing BlurBall and `hf10k_ema_v1` audio extraction; Supabase/Postgres JSONB and RLS; Next.js 15; React 19; TypeScript; Node test runner; Vercel.

## Global Constraints

- The target output is service-motion onset plus initiating physical player; bounce and audio evidence are confirmation signals.
- Do not read scored-server truth, first-server choice, winner, or reviewer labels while ranking candidates.
- Stage A may use the human first-bounce time only as an oracle window boundary, never as player identity or score.
- Stop before Stage B when oracle-anchored initiating-player precision is below 90%.
- Automatic first-server requires at least 95% leave-one-match-out precision and no match below 90%; 90–95% is prefill-only; below 90% is research-only.
- Use at most a 1.1-second pose interval sampled at 15 FPS for each of no more than three candidate chains per point.
- Process at most the first five eligible points for match-level first-server decoding.
- Use the actual first five retained chronological point clips from each
  source match; never treat the sampled research assignments as consecutive.
- Allow at most one missing early source point in the ITTF rotation decoder.
- Do not use the existing Body7 checkpoint.
- Do not install, import, invoke, or bundle YOLO or any AGPL component.
- Pin the official RTMPose-M checkpoint URL and record its SHA-256 and upstream provenance before inference.
- Keep raw pose arrays and decoded frames ephemeral.
- Do not mutate production match, point, placement, score, first-server, job, or match-structure records.
- Do not activate production first-server automation or modify Keep Score in this experiment.
- Preserve all existing 100 original labels and 42 follow-up labels.

---

### Task 1: Pure service-motion feature analyzer

**Files:**
- Create: `worker/service_motion.py`
- Create: `worker/tests/test_service_motion.py`

**Interfaces:**
- Consumes:
  - `detections: Mapping[int, Sequence[float]]` in clip-frame pixel coordinates;
  - `poses: Mapping[int, Mapping[str, Mapping[str, Any]]]` using the existing COCO-17 `kpts` shape from `worker.match_structure`;
  - `first_bounce_t: float`, `fps: float`, and optional `{t, confidence}` audio candidates.
- Produces:
  - `ServiceMotionThresholds`;
  - `analyze_service_motion(detections, poses, fps, first_bounce_t, audio_candidates=(), thresholds=DEFAULT_SERVICE_MOTION_THRESHOLDS) -> dict[str, Any]`.
- The returned mapping contains `version`, `status`, `side`, `onset_t`, `contact_t`, `confidence`, `scores`, `features`, `reason`, and serialized `thresholds`.

- [ ] **Step 1: Write failing tests for initiating-player attribution**

Create synthetic 30 FPS sequences where the near player’s toss wrist rises,
their racket wrist accelerates, and the ball leaves the wrist before a first
bounce at 1.0 seconds. Add a mirrored far-player case and an ambiguous case:

```python
result = analyze_service_motion(
    detections=near_serve_ball_track(),
    poses=near_serve_poses(),
    fps=30.0,
    first_bounce_t=1.0,
    audio_candidates=[{"t": 0.91, "confidence": 2.2}],
)
self.assertEqual(result["status"], "high_confidence")
self.assertEqual(result["side"], "near")
self.assertLess(result["onset_t"], result["contact_t"])
self.assertLess(result["contact_t"], 1.0)

ambiguous = analyze_service_motion(
    detections=stationary_ball_track(),
    poses=both_players_raise_one_wrist(),
    fps=30.0,
    first_bounce_t=1.0,
)
self.assertEqual(ambiguous["status"], "withheld")
self.assertIsNone(ambiguous["side"])
```

Also assert invariance when every coordinate is translated and scaled by the
same factor.

- [ ] **Step 2: Run the analyzer tests and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest worker.tests.test_service_motion -v
```

Expected: import failure because `worker.service_motion` does not exist.

- [ ] **Step 3: Implement normalized per-player motion features**

Use COCO indices shoulders `5,6`, elbows `7,8`, and wrists `9,10`. For each
side and frame:

```python
torso_scale = max(
    24.0,
    shoulder_distance,
    abs(mean_hip_y - mean_shoulder_y),
)
normalized_wrist_y = (wrist_y - shoulder_y) / torso_scale
normalized_wrist_speed = delta(wrist_y) * fps / torso_scale
normalized_ball_distance = hypot(ball_x - wrist_x, ball_y - wrist_y) / torso_scale
```

Aggregate:

- upward wrist displacement and velocity;
- racket-wrist acceleration;
- elbow-angle extension;
- shoulder-relative wrist height;
- torso lean/recovery;
- nearest ball-to-wrist distance;
- ball rise and departure from the player; and
- audio support within 120 ms of inferred contact.

Define onset as the first of at least three consecutive sampled frames with
two independent motion families active. Do not let audio or one close-ball
frame create onset alone.

- [ ] **Step 4: Add abstention and evidence serialization**

Return `high_confidence` only when the best player score is at least `3.0`,
the best-minus-other margin is at least `1.1`, and at least four valid pose
samples contribute. Otherwise return `withheld` with both player scores and a
stable reason. Persist only summaries, never `poses` or frame pixels.

- [ ] **Step 5: Run the focused tests and commit**

Run:

```bash
worker/venv/bin/python -m unittest worker.tests.test_service_motion -v
git add worker/service_motion.py worker/tests/test_service_motion.py
git commit -m "feat: add service-motion feature analyzer"
```

Expected: all service-motion tests pass.

---

### Task 2: Legal bounce-chain enumeration and fusion

**Files:**
- Create: `worker/service_motion_chains.py`
- Create: `worker/tests/test_service_motion_chains.py`
- Read only: `worker/serve_detection.py`
- Read only: `worker/placement_reconstruction.py`

**Interfaces:**
- Consumes the existing side-neutral placement reconstruction containing
  `hypotheses` and `candidates`.
- Produces:
  - `ServeChainThresholds`;
  - `enumerate_serve_chains(reconstruction, thresholds=DEFAULT_SERVE_CHAIN_THRESHOLDS) -> list[dict[str, Any]]`;
  - `fuse_chain_and_motion(chain, motion) -> dict[str, Any]`.
- A chain contains `server_hypothesis`, `first_bounce`, `second_bounce`,
  `geometry_score`, `trajectory_score`, `audio_score`, and `rank`.

- [ ] **Step 1: Write failing chain tests**

Cover:

```python
chains = enumerate_serve_chains(two_legal_hypotheses_fixture())
self.assertEqual(len(chains), 2)
self.assertEqual(chains[0]["first_bounce"]["half"], "near")
self.assertEqual(chains[0]["second_bounce"]["half"], "far")

self.assertEqual(
    enumerate_serve_chains(same_half_fixture()),
    [],
)
self.assertEqual(
    enumerate_serve_chains(separation_fixture(0.29)),
    [],
)
self.assertEqual(
    enumerate_serve_chains(separation_fixture(0.63)),
    [],
)
```

Add a test proving that audio raises corroboration but cannot make an illegal
chain eligible.

- [ ] **Step 2: Run the chain tests and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest worker.tests.test_service_motion_chains -v
```

Expected: import failure for `worker.service_motion_chains`.

- [ ] **Step 3: Implement deterministic chain enumeration**

Read each hypothesis’s `phase == "serve"` shot, derive table halves from
`v < 1.37`, and retain only opposite-half pairs separated by `0.30–0.62`
seconds. Rank without using the hypothesis’s selected server truth:

```python
rank = (
    0.45 * geometry_score
    + 0.35 * trajectory_score
    + 0.20 * audio_score
)
```

Return at most the strongest three unique time pairs, deterministically sorted
by descending rank and then ascending first-bounce time.

- [ ] **Step 4: Implement motion fusion and disagreement handling**

`fuse_chain_and_motion()` must:

- prefer the player supported by pose;
- lower confidence when the pose side conflicts with the chain hypothesis;
- withhold when the fused side margin is below the analyzer threshold; and
- include chain and pose component scores for ablation reporting.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_service_motion_chains \
  worker.tests.test_serve_detection -v
git add worker/service_motion_chains.py \
  worker/tests/test_service_motion_chains.py
git commit -m "feat: fuse legal serve chains with service motion"
```

Expected: chain and existing serve-detection tests pass unchanged.

---

### Task 3: Missing-point-tolerant first-server decoder

**Files:**
- Create: `worker/first_server_decoder.py`
- Create: `worker/tests/test_first_server_decoder.py`
- Read only: `worker/match_structure.py`

**Interfaces:**
- Consumes point calls shaped as:

```python
{
    "idx": int,
    "position": int,
    "side": "near" | "far" | None,
    "status": "high_confidence" | "withheld" | "unavailable",
    "confidence": float,
}
```

- Produces:
  - `decode_first_server(calls, max_missing=1, minimum_calls=3, minimum_confidence=0.95) -> dict[str, Any]`;
  - `score_rotation_alignment(calls, first_side, skipped_position=None) -> dict[str, Any]`.
- Output contains `side`, `status`, `confidence`, `alignment`, `usable_points`,
  `alternatives`, and `reason`.

- [ ] **Step 1: Write failing decoder tests**

Test the `A,A,B,B,A` pattern, abstentions, contradiction, and one omitted
source point:

```python
result = decode_first_server(calls("near", "near", "far", "far", "near"))
self.assertEqual(result["side"], "near")
self.assertGreaterEqual(result["confidence"], 0.95)

missing = decode_first_server(calls("near", "far", "far", "near"))
self.assertEqual(missing["side"], "near")
self.assertEqual(missing["alignment"]["missing_points"], 1)

contradictory = decode_first_server(calls("near", "far", "near"))
self.assertEqual(contradictory["status"], "withheld")
```

Add leave-one-call-out tests proving that fewer than three contributing calls
always withhold.

- [ ] **Step 2: Run decoder tests and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest worker.tests.test_first_server_decoder -v
```

Expected: import failure for `worker.first_server_decoder`.

- [ ] **Step 3: Implement explicit alignment enumeration**

Enumerate the two possible first sides and either no skip or one skipped
position among the first five logical points. Score agreement using each
call’s confidence and ignore withheld calls. Convert the best-vs-runner-up
margin to a bounded confidence; do not use reviewer truth.

- [ ] **Step 4: Enforce high-precision withholding**

Require:

- at least three usable calls;
- best alignment confidence at least `0.95`;
- best score strictly above the opposite-first-server alignment; and
- no equally scoring missing-point explanation for the opposite side.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_first_server_decoder \
  worker.tests.test_match_structure -v
git add worker/first_server_decoder.py \
  worker/tests/test_first_server_decoder.py
git commit -m "feat: decode first server with missing-point tolerance"
```

Expected: new decoder and existing match-structure tests pass.

---

### Task 4: Commercially pinned bounded RTMPose extractor

**Files:**
- Create: `worker/bootstrap_service_motion_rtmpose.py`
- Create: `worker/extract_service_motion_rtmpose.py`
- Create: `worker/requirements-service-motion-rtmpose.txt`
- Create: `worker/tests/test_bootstrap_service_motion_rtmpose.py`
- Create: `worker/tests/test_extract_service_motion_rtmpose.py`
- Read only: `worker/extract_match_structure_rtmpose.py`

**Interfaces:**
- Produces:
  - `MODEL_URL` equal to the approved official MMPose catalogue URL;
  - `resolve_model(root: Path, url: str = MODEL_URL) -> tuple[Path, dict[str, Any]]`;
  - `create_pose_model(config_path: Path, checkpoint_path: Path) -> Any`;
  - `window_frame_indices(first_bounce_t, fps, frame_count, sample_fps=15.0) -> list[int]`;
  - `extract_pose_window(video_path, frame_indices, regions, pose_model) -> tuple[dict, dict]`.
- The second item from `extract_pose_window` is compute metadata containing
  decoded frames, posed frames, inference seconds, elapsed seconds, and peak
  RSS.

- [ ] **Step 1: Write failing provenance tests**

Use an injected downloader and tiny fake checkpoint:

```python
model, provenance = resolve_model(
    root,
    url="https://download.openmmlab.test/model.pth",
    downloader=fake_downloader,
)
self.assertEqual(provenance["sha256"], sha256(model))
self.assertEqual(provenance["license"], "Apache-2.0")

model.write_bytes(b"changed")
with self.assertRaisesRegex(ValueError, "digest"):
    resolve_model(root, downloader=fake_downloader)
```

Also assert that the module contains no `yolo` import or command token.

- [ ] **Step 2: Write failing bounded-frame extraction tests**

At 30 FPS with first bounce `2.0`, assert that indices span only
`1.0–2.1` seconds, are sampled at 15 FPS, and remain in bounds. Inject a fake
pose model into a synthetic clip and assert that no raw frames are returned or
written.

- [ ] **Step 3: Run both test modules and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_bootstrap_service_motion_rtmpose \
  worker.tests.test_extract_service_motion_rtmpose -v
```

Expected: import failures for the new modules.

- [ ] **Step 4: Implement model provenance and isolated requirements**

Set:

```python
MODEL_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/"
    "rtmpose-m_simcc-coco_pt-aic-coco_420e-256x192-"
    "d8dd5ca4_20230127.pth"
)
```

`resolve_model()` writes `model.pth` and `provenance.json` atomically. On the
first run it records SHA-256, URL, retrieval time, MMPose catalogue URL,
MMPose license URL, and the OpenMMLab commercial-use clarification URL.
Later runs require the recorded digest.

Use this exact isolated Python 3.12 requirements file:

```text
numpy==1.26.4
opencv-python==4.10.0.84
torch==2.4.1
torchvision==0.19.1
mmengine==0.10.7
mmcv==2.2.0
mmpose==1.3.2
psutil==6.1.1
```

Download the MMPose `v1.3.2` source archive from
`https://github.com/open-mmlab/mmpose/archive/refs/tags/v1.3.2.tar.gz`,
record its SHA-256 in the same provenance file, and resolve
`configs/body_2d_keypoint/rtmpose/coco/rtmpose-m_8xb256-420e_coco-256x192.py`
from that pinned archive. Do not modify `worker/requirements-rtmpose.txt` or
the dormant production RTMPose cache.

- [ ] **Step 5: Implement fixed-region PyTorch inference**

Use the existing table-derived near/far bounding boxes. Decode only requested
frames, run top-down RTMPose independently for each box, and convert results to
the existing `{"bbox": ..., "kpts": [[x, y, score], ...]}` structure. Measure
with `time.perf_counter()` and `resource.getrusage()`; never serialize images
or raw pose arrays.

- [ ] **Step 6: Verify the exact environment and commit**

Run:

```bash
/opt/homebrew/bin/python3.12 worker/bootstrap_service_motion_rtmpose.py \
  --root /Users/adil/Library/Caches/PongLens/service-motion-rtmpose

/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python \
  -m unittest \
  worker.tests.test_bootstrap_service_motion_rtmpose \
  worker.tests.test_extract_service_motion_rtmpose -v

git add worker/bootstrap_service_motion_rtmpose.py \
  worker/extract_service_motion_rtmpose.py \
  worker/requirements-service-motion-rtmpose.txt \
  worker/tests/test_bootstrap_service_motion_rtmpose.py \
  worker/tests/test_extract_service_motion_rtmpose.py
git commit -m "feat: add bounded commercial RTMPose experiment runtime"
```

Expected: the official asset is pinned, tests pass, and provenance contains no
Body7 or YOLO reference.

---

### Task 5: Read-only oracle and end-to-end experiment runner

**Files:**
- Create: `worker/run_service_motion_experiment.py`
- Create: `worker/tests/test_run_service_motion_experiment.py`
- Reuse: `worker/build_research_pilot.py`
- Reuse: `worker/build_winner_constrained_ending_research.py`
- Reuse: `worker/research_audio_candidates.py`

**Interfaces:**
- Consumes:
  - `/Users/adil/Downloads/ponglens-serve-detection-research (1).json`;
  - the existing research batch’s protected media;
  - the actual first five retained chronological point clips from each of the
    five source matches;
  - production `points.placement` and `matches.match_json_path` through
    read-only requests;
  - the existing BlurBall runner and `hf10k_ema_v1`.
- Produces:
  - `run_experiment(export_payload, output_dir, production, pose_model, blurball_runner) -> dict[str, Any]`;
  - `<output>/results.json`;
  - resumable `<output>/cache/` artifacts keyed by source media SHA and model
    SHA.

- [ ] **Step 1: Write failing export validation tests**

Assert rejection when:

- the batch slug is not `serve-detection-cross-match-v1`;
- follow-up count is not exactly 42;
- any included follow-up lacks `submitted_at`;
- source IDs are duplicated;
- a source media SHA differs from production; or
- detector input contains scored-server or reviewer fields.

- [ ] **Step 2: Write failing orchestration tests with fakes**

With fake production, pose, BlurBall, and audio adapters, assert:

```python
result = run_experiment(
    export_payload=fixture,
    output_dir=output,
    production=fake_production,
    pose_model=fake_pose,
    blurball_runner=fake_blurball,
)
self.assertEqual(result["cohorts"]["anchor_rich"], 42)
self.assertEqual(result["ablations"][0]["name"], "unanchored_pose")
self.assertNotIn("scored_server_side", result["cases"][0]["detector_input"])
self.assertTrue((output / "results.json").is_file())
```

Verify that Stage B is skipped when the synthetic Stage A precision is
`0.899`, and runs when it is `0.900`.

- [ ] **Step 3: Run runner tests and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_run_service_motion_experiment -v
```

Expected: import failure for `worker.run_service_motion_experiment`.

- [ ] **Step 4: Implement immutable input materialization**

For each source:

1. query only research source metadata, source point placement, and the
   match’s retained `match.json`;
2. download the frozen research MP4 and verify its stored SHA;
3. obtain table corners from `match.json`;
4. run or resume cached BlurBall detections;
5. run or resume cached `hf10k_ema_v1` audio candidates; and
6. retain gold/reviewer fields in a separate evaluation object never passed
   into candidate generation.

Separately query the first five non-deleted chronological points from each
configured source match for Stage C. Treat these 25 or fewer point clips as a
sealed chronological cohort, cache their media hashes, and never replace them
with the first five randomly sampled research assignments.

- [ ] **Step 5: Implement the six blinded ablations**

Generate:

1. current unanchored pose baseline;
2. bounce geometry only;
3. oracle first bounce plus pose;
4. detected bounce plus pose;
5. detected bounce plus pose and audio; and
6. complete point calls plus five-point decoder.

Stage A uses only the human first-bounce timestamp to choose frame indices.
After Stage A is scored, write `stage_b.status = "skipped_gate"` and stop when
precision is below `0.90`.

- [ ] **Step 6: Record compute and privacy invariants**

Aggregate decoded/posed frames, inference seconds, wall time, peak RSS,
seconds per source-video minute, and first-five-point cost. Assert before
writing JSON that no case contains keys named `poses`, `frames`, `image`,
`first_server`, `winner`, or `reviewer_id` inside `detector_input`.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_run_service_motion_experiment \
  worker.tests.test_build_serve_detection_research \
  worker.tests.test_service_motion \
  worker.tests.test_service_motion_chains \
  worker.tests.test_first_server_decoder -v
git add worker/run_service_motion_experiment.py \
  worker/tests/test_run_service_motion_experiment.py
git commit -m "feat: add service-motion experiment runner"
```

Expected: all experiment and existing serve-research tests pass.

---

### Task 6: Scoring, leave-one-match-out evaluation, and onset subset

**Files:**
- Create: `worker/score_service_motion_experiment.py`
- Create: `worker/tests/test_score_service_motion_experiment.py`

**Interfaces:**
- Produces:
  - `score_experiment(results, export_payload) -> dict[str, Any]`;
  - `leave_one_match_out(cases, threshold_grid) -> dict[str, Any]`;
  - `choose_onset_review_subset(cases) -> list[dict[str, Any]]`;
  - `render_markdown_report(score) -> str`.
- Writes `<output>/score.json`, `<output>/report.md`, and
  `<output>/onset-review.json`.

- [ ] **Step 1: Write failing metric tests**

Use fixtures proving:

- challenge-set and full-batch denominators remain separate;
- precision, coverage, abstention, and per-match worst case are correct;
- oracle and automatic stages are not combined;
- the first-server gate reports `automatic`, `prefill_only`, or
  `research_only` at the frozen boundaries;
- a threshold trained without Gui is scored on Gui without refitting; and
- synthetic one-point deletion is evaluated separately.

- [ ] **Step 2: Write failing onset-selection tests**

Assert exactly 20 unique sources:

```python
selected = choose_onset_review_subset(cases)
self.assertEqual(len(selected), 20)
self.assertEqual(len({item["source_id"] for item in selected}), 20)
self.assertEqual(Counter(item["stratum"] for item in selected), {
    "visible": 8,
    "occluded": 8,
    "prior_wrong_server": 4,
})
```

Selection must be stable under input reordering and balanced across matches
where the available strata permit.

- [ ] **Step 3: Run scorer tests and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_score_service_motion_experiment -v
```

Expected: import failure for the scorer module.

- [ ] **Step 4: Implement blinded scoring and decision language**

Join results to truth only by `source_id` after inference is complete. Report:

- initiating-player precision/recall/coverage;
- bounce and contact-window errors;
- visible, occluded, prior-wrong, per-match, and worst-match slices;
- first-server accuracy, decision point count, and missing-point robustness;
- compute totals and per-match projection; and
- the exact production recommendation gate.

Do not claim onset timing accuracy until onset labels are submitted.

- [ ] **Step 5: Implement stable onset-review selection and report**

Freeze thresholds and write the selected sources with:

```json
{
  "source_id": "...",
  "order": 1,
  "stratum": "occluded",
  "proposal": {
    "status": "high_confidence",
    "side": "far",
    "onset_t": 2.1667,
    "contact_t": 2.9333,
    "first_bounce_t": 3.0333,
    "second_bounce_t": 3.4333
  }
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_score_service_motion_experiment -v
git add worker/score_service_motion_experiment.py \
  worker/tests/test_score_service_motion_experiment.py
git commit -m "feat: score service-motion first-server experiment"
```

Expected: scorer tests pass and fixtures produce stable reports.

---

### Task 7: Backward-compatible hosted onset review

**Files:**
- Modify: `src/lib/research/serveDetection.ts`
- Modify: `src/lib/research/serveDetection.test.ts`
- Modify: `src/app/research/serve-detection/types.ts`
- Modify: `src/app/research/serve-detection/serveDetectionView.ts`
- Modify: `src/app/research/serve-detection/serveDetectionView.test.ts`
- Modify: `src/app/research/serve-detection/ServeDetectionLabeler.tsx`
- Modify: `worker/build_serve_detection_research.py`
- Modify: `worker/tests/test_build_serve_detection_research.py`

**Interfaces:**
- Adds `ServeOnsetLabel`:

```typescript
interface ServeOnsetLabel {
  status: "unmarked" | "exact" | "not_visible";
  time_s: number | null;
  submitted_at: string | null;
}
```

- Adds `human_label.onset`, `prefill.onset_v3`, and
  `proposal.service_motion`.
- Adds review mode `"onset"` while preserving `"original"` and `"followup"`.
- Adds worker commands:
  - `seed-onset --results <onset-review.json>`;
  - `audit-onset`.

- [ ] **Step 1: Write failing additive label tests**

Prove version-two labels hydrate with an unmarked onset, exact onset rounds to
four decimals, `not_visible` clears time, changing an onset clears only onset
completion, and completing onset does not alter original or follow-up
completion.

- [ ] **Step 2: Write failing queue/view tests**

Assert that onset mode contains exactly `prefill.onset_v3.included` sources,
sorts by its order, starts playback at the proposed onset, and advances to the
next source lacking `human_label.onset.submitted_at`.

- [ ] **Step 3: Write failing seed/audit tests**

With fake production requests, assert that seeding:

- patches only `research_sources.proposal` and `research_sources.prefill`;
- preserves existing detector, likely actions, and follow-up metadata;
- never updates `research_assignments.human_label`;
- marks exactly 20 unique sources; and
- rejects a result from another batch or model SHA.

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/research/serveDetection.test.ts \
  src/app/research/serve-detection/serveDetectionView.test.ts

worker/venv/bin/python -m unittest \
  worker.tests.test_build_serve_detection_research -v
```

Expected: failures because onset types, mode, and worker commands do not exist.

- [ ] **Step 5: Implement the additive label contract and mode helpers**

Hydrate absent onset data to:

```typescript
{ status: "unmarked", time_s: null, submitted_at: null }
```

Add `setServeMotionOnset()`, `setServeMotionOnsetNotVisible()`,
`completeServeMotionOnset()`, `onsetServeAssignments()`,
`serveOnsetProgress()`, and `nextIncompleteOnsetIndex()`.

- [ ] **Step 6: Implement the focused onset UI**

Reuse the single mounted video, quarter-speed default, and existing frame
controls. Show:

- `Jump to proposed motion start`;
- `Mark actual motion start here`;
- `Motion start is not observable`;
- exact proposed contact/first-bounce/second-bounce jump buttons; and
- one `Save and next` action.

Do not show model confidence before submission. Preserve playback position
while marking and do not reset video after save.

- [ ] **Step 7: Implement idempotent research-only seeding**

Add stable `onset_v3` metadata and `service_motion` proposal data to the
existing 20 sources. The audit re-reads sources, checks order `1..20`, validates
model SHA equality, and verifies every original/follow-up label still exists.
No SQL migration is required because these fields are existing JSONB and the
admin export already serializes them.

- [ ] **Step 8: Run tests, lint, and commit**

Run:

```bash
node --test --experimental-strip-types \
  src/lib/research/serveDetection.test.ts \
  src/app/research/serve-detection/serveDetectionView.test.ts
npm run test:research
npm run lint -- \
  src/lib/research/serveDetection.ts \
  src/app/research/serve-detection
worker/venv/bin/python -m unittest \
  worker.tests.test_build_serve_detection_research -v

git add src/lib/research/serveDetection.ts \
  src/lib/research/serveDetection.test.ts \
  src/app/research/serve-detection \
  worker/build_serve_detection_research.py \
  worker/tests/test_build_serve_detection_research.py
git commit -m "feat: add hosted service-motion onset review"
```

Expected: all focused tests and lint pass.

---

### Task 8: Execute the experiment and publish only the research review

**Files:**
- Create locally: `/Users/adil/Desktop/PongLens-Reports/service-motion-first-server-20260730/`
- Modify only if verification exposes an in-scope defect in Tasks 1–7.

**Interfaces:**
- Consumes the completed export at
  `/Users/adil/Downloads/ponglens-serve-detection-research (1).json`.
- Produces the experiment JSON, score, Markdown report, compute/provenance
  record, and—only after the Stage A gate passes—the 17-point onset queue at
  `https://www.ponglens.com/research/serve-detection`.

- [ ] **Step 1: Run the full automated verification suite**

Run:

```bash
worker/venv/bin/python -m unittest \
  worker.tests.test_service_motion \
  worker.tests.test_service_motion_chains \
  worker.tests.test_first_server_decoder \
  worker.tests.test_bootstrap_service_motion_rtmpose \
  worker.tests.test_extract_service_motion_rtmpose \
  worker.tests.test_run_service_motion_experiment \
  worker.tests.test_score_service_motion_experiment \
  worker.tests.test_build_serve_detection_research -v

npm run test:research
npm run lint
npm run build
```

Expected: all tests, lint, and production build pass.

- [ ] **Step 2: Run Stage A against the completed anchor-rich cohort**

Run:

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python \
  worker/run_service_motion_experiment.py \
  --labels "/Users/adil/Downloads/ponglens-serve-detection-research (1).json" \
  --output "/Users/adil/Desktop/PongLens-Reports/service-motion-first-server-20260730"
```

Expected: `results.json` records 42 completed follow-up sources, 39
first-bounce-exact sources eligible for oracle Stage A, three unavailable
oracle anchors, initiating-player metrics, compute, and model provenance.

- [ ] **Step 3: Enforce the Stage A gate**

Run:

```bash
worker/venv/bin/python worker/score_service_motion_experiment.py \
  --results "/Users/adil/Desktop/PongLens-Reports/service-motion-first-server-20260730/results.json" \
  --labels "/Users/adil/Downloads/ponglens-serve-detection-research (1).json" \
  --output "/Users/adil/Desktop/PongLens-Reports/service-motion-first-server-20260730"
```

If oracle initiating-player precision is below `0.90`, stop. Deliver the
research-only report and do not seed or deploy onset review. If it is at least
`0.90`, confirm Stage B, Stage C, `onset-review.json`, and leave-one-match-out
results exist.

- [ ] **Step 4: Seed and audit the onset queue after a passing gate**

Run:

```bash
worker/venv/bin/python worker/build_serve_detection_research.py \
  seed-onset \
  --results "/Users/adil/Desktop/PongLens-Reports/service-motion-first-server-20260730/onset-review.json"

worker/venv/bin/python worker/build_serve_detection_research.py audit-onset
```

Expected: exactly 20 ordered onset sources and unchanged original/follow-up
labels.

- [ ] **Step 5: Review the protected route locally**

Run:

```bash
npm run dev
```

Verify in the signed-in route:

- only one video is mounted;
- quarter-speed and frame controls work;
- the proposed onset jump is exact;
- marking does not reset playback;
- model confidence stays hidden before submission; and
- original and follow-up queues remain complete.

- [ ] **Step 6: Integrate and deploy only after all gates pass**

Use `superpowers:requesting-code-review`, fix verified findings, then use
`superpowers:finishing-a-development-branch`. Merge the experiment and
research-page changes to `main`, push, and deploy the web application through
the repository’s established production path. Do not deploy worker automation,
database migrations, Keep Score changes, or first-server application.

- [ ] **Step 7: Final production audit**

Open:

`https://www.ponglens.com/research/serve-detection`

Confirm authentication, 17 onset-review assignments, exact jumps, autosave,
export compatibility, and unchanged production match behavior. Record the
deployed commit and experiment recommendation in `report.md`.
