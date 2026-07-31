# Temporal Serve-Detection Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a read-only 500–1,000-point experiment that learns first-server evidence from both players' RTMPose sequences and validates it on match-separated holdout data including the newest Chris match.

**Architecture:** A deterministic manifest builder seals eligible production matches and rotation truth before feature extraction. A cached RTMPose feature extractor produces blinded paired-player sequences, a compact bidirectional GRU learns weakly supervised serve likelihoods, and a separate fusion/decoder layer combines those likelihoods with existing ball, bounce, audio, and ITTF-rotation evidence. Training, development, and holdout matches never overlap.

**Tech Stack:** Python 3.12, PyTorch 2.4.1, RTMPose/MMPose 1.3.2, OpenCV, NumPy, existing BlurBall/placement reconstruction, `unittest`, Supabase REST, R2-compatible object storage.

## Global Constraints

- This is research-only and read-only; do not mutate production matches, points, scores, first-server values, or user experience.
- Target 500–1,000 scored point clips from at least 30 matches; fewer matches make the result preliminary.
- Split whole matches 50% training, 20% development, and 30% sealed holdout with at least ten holdout matches.
- The newest eligible Chris-labelled match uploaded on July 30, 2026 is a holdout canary.
- RTMPose/MMPose is the only pose dependency; do not add YOLO, Ultralytics, OpenPose, AGPL code, weights, or services.
- Do not use OpenTTGames, P2ANet footage/weights, or another dataset without documented commercial permission and source provenance.
- Feature tensors must not contain score, winner, player identity, first-server truth, reviewer labels, or future point calls.
- Run all model commands with `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python`.
- Keep generated media, feature caches, checkpoints, and reports outside git under `/Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731`.

---

### Task 1: Seal the expanded match-level cohort

**Files:**
- Create: `worker/temporal_serve_manifest.py`
- Create: `worker/tests/test_temporal_serve_manifest.py`

**Interfaces:**
- Consumes: production REST rows for matches, points, jobs, and immutable clip paths.
- Produces: `build_manifest(production, *, target_points: int, minimum_matches: int, chris_date: str) -> dict[str, Any]`, `write_manifest_atomic(path: Path, manifest: Mapping[str, Any]) -> None`, and `validate_manifest(manifest: Mapping[str, Any]) -> None`.

- [ ] **Step 1: Write failing eligibility, rotation, split, and Chris-canary tests**

```python
class ManifestTests(unittest.TestCase):
    def test_split_is_by_match_and_chris_is_holdout(self):
        manifest = build_manifest(
            FakeProduction(matches=eligible_matches(30)),
            target_points=600,
            minimum_matches=30,
            chris_date="2026-07-30",
        )
        splits = {
            split: {row["match_id"] for row in manifest["splits"][split]}
            for split in ("train", "development", "holdout")
        }
        self.assertFalse(splits["train"] & splits["development"])
        self.assertFalse(splits["train"] & splits["holdout"])
        self.assertFalse(splits["development"] & splits["holdout"])
        self.assertIn("new-chris", splits["holdout"])

    def test_manifest_rejects_truth_inside_model_input(self):
        manifest = manifest_fixture()
        manifest["splits"]["train"][0]["points"][0]["model_input"] = {
            "first_server": "near"
        }
        with self.assertRaisesRegex(ValueError, "forbidden model input"):
            validate_manifest(manifest)
```

- [ ] **Step 2: Run the tests and verify the new module is missing**

Run: `python3 -m unittest worker.tests.test_temporal_serve_manifest -v`

Expected: FAIL with `ModuleNotFoundError: worker.temporal_serve_manifest`.

- [ ] **Step 3: Implement immutable records, eligibility, truth walking, deterministic capped sampling, and match-only splits**

```python
FORBIDDEN_INPUT_KEYS = {
    "first_server", "scored_server_side", "winner", "score",
    "human_label", "reviewer_id", "player_identity",
}

@dataclass(frozen=True)
class SealedPoint:
    point_id: str
    point_idx: int
    clip_uri: str
    clip_sha256: str
    expected_server_side: str

def build_manifest(
    production: ProductionReader,
    *,
    target_points: int = 1000,
    minimum_matches: int = 30,
    chris_date: str = "2026-07-30",
) -> dict[str, Any]:
    matches = eligible_matches(production)
    canary = newest_named_match(matches, "chris", chris_date)
    splits = deterministic_match_split(matches, forced_holdout={canary.id})
    return seal_points_and_hashes(production, splits, target_points)
```

The manifest stores truth under an `evaluation` object separate from the `model_input` object. Apply the existing independent ITTF walker semantics for game alternation, deuce, lets, explicit server overrides, and deleted retained clips. Cap each match at `ceil(target_points / eligible_match_count * 1.5)` points.

- [ ] **Step 4: Run manifest tests**

Run: `python3 -m unittest worker.tests.test_temporal_serve_manifest -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit the sealed-manifest component**

```bash
git add worker/temporal_serve_manifest.py worker/tests/test_temporal_serve_manifest.py
git commit -m "feat: seal temporal serve experiment cohort"
```

### Task 2: Extract and cache blinded paired-player temporal features

**Files:**
- Create: `worker/temporal_serve_features.py`
- Create: `worker/tests/test_temporal_serve_features.py`
- Modify: `worker/extract_service_motion_rtmpose.py`

**Interfaces:**
- Consumes: one sealed point `model_input`, materialized MP4, table calibration, BlurBall detections, audio candidates, and a callable RTMPose model.
- Produces: `extract_feature_record(...) -> dict[str, Any]`, `feature_cache_key(point, extractor_version, model_sha256) -> str`, and `validate_feature_record(record) -> None`.

- [ ] **Step 1: Write failing normalization, masking, cache, and leakage tests**

```python
class FeatureTests(unittest.TestCase):
    def test_normalizes_pose_to_torso_and_table_axes(self):
        record = extract_feature_record(
            point=sealed_point_fixture(),
            media_path=fixture_video(),
            pose_model=FakePoseModel(),
            blurball=FakeBallDetector(),
            audio=[{"time_s": 1.2, "confidence": 2.0}],
            sample_fps=15.0,
            maximum_seconds=12.0,
        )
        self.assertEqual(record["feature_shape"][1], PAIRED_FEATURE_WIDTH)
        self.assertAlmostEqual(record["sample_fps"], 15.0)
        self.assertNotIn("expected_server_side", json.dumps(record))

    def test_cache_key_changes_with_media_or_model(self):
        left = feature_cache_key(point_fixture("a" * 64), "v1", "m1")
        right = feature_cache_key(point_fixture("b" * 64), "v1", "m1")
        self.assertNotEqual(left, right)
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `python3 -m unittest worker.tests.test_temporal_serve_features -v`

Expected: FAIL with `ModuleNotFoundError: worker.temporal_serve_features`.

- [ ] **Step 3: Generalize bounded RTMPose frame extraction without changing the existing experiment behavior**

Add to `worker/extract_service_motion_rtmpose.py`:

```python
def sampled_frame_indices(
    start_s: float,
    end_s: float,
    fps: float,
    frame_count: int,
    sample_fps: float,
) -> list[int]:
    """Return stable source-frame indices for a bounded temporal window."""
```

Keep `window_frame_indices()` as a compatibility wrapper and retain its current output exactly.

- [ ] **Step 4: Implement paired features and atomic NPZ/JSON caching**

```python
EXTRACTOR_VERSION = "temporal-serve-paired-v1"
POSE_JOINTS = (5, 6, 7, 8, 9, 10, 11, 12)

def extract_feature_record(...):
    indices = sampled_frame_indices(0.0, bounded_end_s, fps, frames, 15.0)
    poses, compute = extract_pose_window(media_path, indices, regions, pose_model)
    tensor, mask = paired_pose_tensor(poses, ball, table_transform, indices)
    return {
        "schema_version": 1,
        "extractor_version": EXTRACTOR_VERSION,
        "source_id": point["source_id"],
        "media_sha256": point["media_sha256"],
        "sample_fps": 15.0,
        "times_s": times,
        "features": tensor.tolist(),
        "mask": mask.tolist(),
        "ball_events": blinded_ball_events,
        "audio_events": blinded_audio_events,
        "compute": compute,
    }
```

Normalize x/y by calibrated table axes and torso scale; include keypoint confidence, velocity, acceleration, visibility, ball velocity, ball-to-wrist distance, and event proximity. Missing joints remain zero with explicit masks. Reject every forbidden key recursively before writing.

- [ ] **Step 5: Run feature and compatibility tests**

Run: `python3 -m unittest worker.tests.test_temporal_serve_features worker.tests.test_extract_service_motion_rtmpose -v`

Expected: all tests PASS.

- [ ] **Step 6: Commit temporal feature extraction**

```bash
git add worker/temporal_serve_features.py worker/extract_service_motion_rtmpose.py worker/tests/test_temporal_serve_features.py
git commit -m "feat: extract blinded temporal serve features"
```

### Task 3: Add the weakly supervised paired-player GRU

**Files:**
- Create: `worker/temporal_serve_model.py`
- Create: `worker/tests/test_temporal_serve_model.py`

**Interfaces:**
- Consumes: padded feature tensors `[batch, time, width]`, masks, and train-only near/far targets supplied separately from feature records.
- Produces: `PairedServeGRU(feature_width: int)`, `multiple_instance_loss(output, target_side, clean_negative_mask=None)`, and `decode_point_likelihood(output, times_s) -> dict[str, Any]`.

- [ ] **Step 1: Write failing shape, loss-direction, masking, and serialization tests**

```python
class ModelTests(unittest.TestCase):
    def test_forward_returns_two_player_window_scores(self):
        model = PairedServeGRU(feature_width=48)
        output = model(torch.zeros(2, 72, 48), torch.ones(2, 72))
        self.assertEqual(tuple(output["logits"].shape), (2, 72, 2))

    def test_loss_rewards_the_true_server_peak(self):
        output = {"logits": torch.tensor([[[4.0, -2.0], [3.0, -1.0]]])}
        correct = multiple_instance_loss(output, torch.tensor([0]))
        reversed_loss = multiple_instance_loss(output, torch.tensor([1]))
        self.assertLess(float(correct), float(reversed_loss))
```

- [ ] **Step 2: Run model tests in the isolated pose environment**

Run: `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_temporal_serve_model -v`

Expected: FAIL with `ModuleNotFoundError: worker.temporal_serve_model`.

- [ ] **Step 3: Implement the exact model architecture and MIL loss**

```python
class PairedServeGRU(nn.Module):
    def __init__(self, feature_width: int):
        super().__init__()
        self.gru = nn.GRU(
            feature_width, 64, num_layers=2, batch_first=True,
            bidirectional=True, dropout=0.2,
        )
        self.attention = nn.Linear(128, 1)
        self.serve_head = nn.Linear(128, 2)

    def forward(self, features, mask):
        hidden, _ = self.gru(features)
        logits = self.serve_head(hidden)
        attention = self.attention(hidden).squeeze(-1).masked_fill(~mask.bool(), -1e9)
        return {"logits": logits, "attention": attention}
```

Use log-sum-exp pooling over overlapping 36-frame neighborhoods for the true side, a paired margin against the receiver side, and binary suppression on explicit clean-negative frames. The decoder returns raw near/far likelihood curves and never reads the target.

- [ ] **Step 4: Run model tests**

Run: `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_temporal_serve_model -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit the temporal model**

```bash
git add worker/temporal_serve_model.py worker/tests/test_temporal_serve_model.py
git commit -m "feat: add paired-player temporal serve model"
```

### Task 4: Train reproducibly without match leakage

**Files:**
- Create: `worker/train_temporal_serve.py`
- Create: `worker/tests/test_train_temporal_serve.py`
- Modify: `worker/requirements-service-motion-rtmpose.txt`

**Interfaces:**
- Consumes: sealed manifest, cached feature directory, training targets, development targets, random seed, and output directory.
- Produces: `train_model(...) -> dict[str, Any]`, `checkpoint.pt`, `training.json`, and `provenance.json`.

- [ ] **Step 1: Write failing deterministic-training and split-leakage tests**

```python
class TrainingTests(unittest.TestCase):
    def test_training_is_reproducible_on_synthetic_features(self):
        first = train_model(synthetic_dataset(), seed=731, epochs=3)
        second = train_model(synthetic_dataset(), seed=731, epochs=3)
        self.assertEqual(first["best_epoch"], second["best_epoch"])
        self.assertAlmostEqual(first["development_loss"], second["development_loss"], places=6)

    def test_training_rejects_overlapping_match_ids(self):
        with self.assertRaisesRegex(ValueError, "match leakage"):
            validate_training_splits({"train": ["m1"], "development": ["m1"]})
```

- [ ] **Step 2: Run training tests and verify failure**

Run: `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_train_temporal_serve -v`

Expected: FAIL with `ModuleNotFoundError: worker.train_temporal_serve`.

- [ ] **Step 3: Pin the training runtime and implement deterministic training**

Keep the existing PyTorch pin. Add only `scikit-learn==1.5.2` if isotonic calibration is used; otherwise make no dependency change. Set Python, NumPy, and PyTorch seeds to `731`, disable nondeterministic algorithms where supported, use AdamW at `1e-3`, batch size 16, at most 40 epochs, and early stopping after six development epochs without improvement.

```python
def train_model(dataset, *, seed=731, epochs=40, patience=6):
    set_deterministic_seed(seed)
    validate_training_splits(dataset.match_ids)
    model = PairedServeGRU(dataset.feature_width)
    # train only on train; select epoch and confidence threshold only on development
    return save_checkpoint_and_provenance(model, metrics, dataset)
```

Checkpoint provenance includes git commit, manifest SHA-256, feature extractor version, RTMPose checkpoint SHA-256, dependency versions, seed, split match IDs, and training timestamp. Never serialize holdout labels into training artifacts.

- [ ] **Step 4: Run training and existing bootstrap tests**

Run: `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_train_temporal_serve worker.tests.test_bootstrap_service_motion_rtmpose -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit reproducible training**

```bash
git add worker/train_temporal_serve.py worker/tests/test_train_temporal_serve.py worker/requirements-service-motion-rtmpose.txt
git commit -m "feat: train temporal serve model reproducibly"
```

### Task 5: Fuse temporal, bounce, ball, and audio evidence and add soft rotation decoding

**Files:**
- Create: `worker/temporal_serve_fusion.py`
- Create: `worker/tests/test_temporal_serve_fusion.py`
- Modify: `worker/first_server_decoder.py`
- Modify: `worker/tests/test_first_server_decoder.py`

**Interfaces:**
- Consumes: one temporal model result plus existing legal chains and audio/ball summaries.
- Produces: `fuse_temporal_evidence(...) -> dict[str, Any]` and `decode_first_server_soft(calls, *, max_missing=1, minimum_margin=...) -> dict[str, Any]`.

- [ ] **Step 1: Write failing fusion and soft-decoder tests**

```python
def test_strong_pose_survives_missing_bounce_chain():
    result = fuse_temporal_evidence(
        temporal={"near": 0.97, "far": 0.08, "onset_t": 1.2},
        chains=[], audio=[], thresholds=fusion_thresholds(),
    )
    self.assertEqual(result["side"], "near")

def test_contradictory_chain_forces_abstention_at_small_pose_margin():
    result = fuse_temporal_evidence(
        temporal={"near": 0.72, "far": 0.35},
        chains=[chain_fixture(server_side="far", rank=0.9)], audio=[],
        thresholds=fusion_thresholds(),
    )
    self.assertEqual(result["status"], "withheld")

def test_soft_rotation_combines_subthreshold_consistent_points():
    result = decode_first_server_soft(soft_calls(near_pattern=[.72, .70, .68, .71, .69]))
    self.assertEqual(result["side"], "near")
```

- [ ] **Step 2: Run fusion/decoder tests and verify failure**

Run: `python3 -m unittest worker.tests.test_temporal_serve_fusion worker.tests.test_first_server_decoder -v`

Expected: FAIL because the fusion module and soft decoder do not exist.

- [ ] **Step 3: Implement explicit calibrated fusion and likelihood rotation scoring**

```python
def fuse_temporal_evidence(temporal, chains, audio, thresholds):
    pose_side, pose_margin = ranked_temporal_side(temporal)
    chain = chains[0] if chains else None
    if chain and chain["server_hypothesis"] != pose_side and pose_margin < thresholds.override_margin:
        return withheld("temporal_chain_disagreement")
    support = chain_support(chain, pose_side) + audio_support(audio, temporal.get("onset_t"))
    return calibrated_call(pose_side, pose_margin, support, thresholds)
```

`decode_first_server_soft` scores both `A,A,B,B,A` hypotheses using log likelihood, evaluates at most one skipped position, and returns a side only when the development-selected likelihood margin is exceeded. Preserve the existing hard decoder unchanged for the baseline.

- [ ] **Step 4: Run fusion and decoder tests**

Run: `python3 -m unittest worker.tests.test_temporal_serve_fusion worker.tests.test_first_server_decoder -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit fusion and sequence decoding**

```bash
git add worker/temporal_serve_fusion.py worker/first_server_decoder.py worker/tests/test_temporal_serve_fusion.py worker/tests/test_first_server_decoder.py
git commit -m "feat: fuse temporal serve evidence"
```

### Task 6: Orchestrate the blinded large-scale experiment

**Files:**
- Create: `worker/run_temporal_serve_experiment.py`
- Create: `worker/tests/test_run_temporal_serve_experiment.py`

**Interfaces:**
- Consumes: sealed manifest, production credentials, R2 credentials, pose runtime/checkpoint, cache root, and output root.
- Produces: `run_experiment(...) -> dict[str, Any]`, per-split predictions, baseline calls, ablations, compute totals, and immutable run metadata.

- [ ] **Step 1: Write failing orchestration, resume, and blinding tests**

```python
class RunnerTests(unittest.TestCase):
    def test_runner_never_passes_truth_to_extractor_or_model(self):
        recorder = RecordingExtractor()
        run_experiment(manifest_fixture(), extractor=recorder, trainer=FakeTrainer())
        serialized = json.dumps(recorder.inputs)
        self.assertNotIn("expected_server_side", serialized)
        self.assertNotIn("first_server", serialized)

    def test_runner_resumes_completed_feature_hashes(self):
        extractor = CountingExtractor(existing_cache={"source-1"})
        run_experiment(manifest_fixture(), extractor=extractor, trainer=FakeTrainer())
        self.assertNotIn("source-1", extractor.calls)
```

- [ ] **Step 2: Run orchestration tests and verify failure**

Run: `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_run_temporal_serve_experiment -v`

Expected: FAIL with `ModuleNotFoundError: worker.run_temporal_serve_experiment`.

- [ ] **Step 3: Implement resumable stages and CLI**

```python
def run_experiment(manifest, *, production, extractor, trainer, output_dir):
    validate_manifest(manifest)
    features = extract_missing_features(manifest, extractor, output_dir / "features")
    training = trainer.fit(features.for_splits("train", "development"))
    predictions = infer_all_splits(training.checkpoint, features)
    return write_results_atomic(manifest, training, predictions, output_dir)
```

CLI stages are `manifest`, `features`, `train`, `infer`, and `all`. Every stage writes atomically, validates upstream hashes, and can resume. Run the frozen deterministic detector on the same points as a baseline. Holdout predictions are created once after development thresholds are frozen and carry a `holdout_opened_at` timestamp.

- [ ] **Step 4: Run orchestration and previous experiment tests**

Run: `/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest worker.tests.test_run_temporal_serve_experiment worker.tests.test_run_service_motion_experiment -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit the experiment runner**

```bash
git add worker/run_temporal_serve_experiment.py worker/tests/test_run_temporal_serve_experiment.py
git commit -m "feat: orchestrate temporal serve experiment"
```

### Task 7: Score results, enforce production gates, and select focused review cases

**Files:**
- Create: `worker/score_temporal_serve_scale.py`
- Create: `worker/tests/test_score_temporal_serve_scale.py`

**Interfaces:**
- Consumes: sealed manifest, predictions, baseline results, training provenance, and compute records.
- Produces: `score_run(...) -> dict[str, Any]`, `select_active_review(...) -> list[dict[str, Any]]`, `score.json`, `report.md`, and `active-review.json` with at most 60 items.

- [ ] **Step 1: Write failing metric, gate, canary, and review-selection tests**

```python
class ScoringTests(unittest.TestCase):
    def test_automatic_requires_precision_coverage_and_ten_decisions(self):
        score = score_run(run_fixture(correct=9, decided=9, eligible=10))
        self.assertEqual(score["recommendation"], "research_only")

    def test_active_review_is_bounded_and_prioritizes_contradictions(self):
        selected = select_active_review(case_fixtures(100), limit=60)
        self.assertLessEqual(len(selected), 60)
        self.assertEqual(selected[0]["reason"], "confident_truth_contradiction")

    def test_report_names_chris_holdout_canary(self):
        score = score_run(run_fixture(chris_match_id="new-chris"))
        self.assertIn("new-chris", score["holdout_canaries"])
```

- [ ] **Step 2: Run scoring tests and verify failure**

Run: `python3 -m unittest worker.tests.test_score_temporal_serve_scale -v`

Expected: FAIL with `ModuleNotFoundError: worker.score_temporal_serve_scale`.

- [ ] **Step 3: Implement metrics, ablations, gates, compute projection, and report rendering**

```python
def recommendation(metrics):
    match = metrics["holdout"]["first_server"]
    if match["decided"] >= 10 and match["precision"] >= .95 and match["coverage"] >= .60:
        return "automatic"
    if match["decided"] >= 10 and match["precision"] >= .90:
        return "prefill_only"
    return "research_only"
```

Report point and match precision/coverage, confidence intervals, per-match and worst-match results, skipped-point robustness, onset error on the 42 labeled points, visible/occluded/long-preparation slices, all specified ablations, feature/model compute, peak memory, cache size, and projected worker cost. Label any cohort with fewer than ten holdout matches `preliminary` regardless of score.

- [ ] **Step 4: Run scoring and prior scoring tests**

Run: `python3 -m unittest worker.tests.test_score_temporal_serve_scale worker.tests.test_score_service_motion_experiment -v`

Expected: all tests PASS.

- [ ] **Step 5: Commit scoring and active-review selection**

```bash
git add worker/score_temporal_serve_scale.py worker/tests/test_score_temporal_serve_scale.py
git commit -m "feat: score temporal serve scale experiment"
```

### Task 8: Verify code, run the production-data experiment, and publish the research report

**Files:**
- Modify only if verification exposes a defect in Tasks 1–7.
- Generate outside git: `/Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/**`

**Interfaces:**
- Consumes: completed CLI, production environment variables already used by the prior research runner, pinned RTMPose runtime, and newest eligible production matches.
- Produces: a sealed manifest, cached features, checkpoint, full predictions, report, score, compute ledger, and active-review export.

- [ ] **Step 1: Run the complete focused Python test suite**

Run:

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python -m unittest \
  worker.tests.test_temporal_serve_manifest \
  worker.tests.test_temporal_serve_features \
  worker.tests.test_temporal_serve_model \
  worker.tests.test_train_temporal_serve \
  worker.tests.test_temporal_serve_fusion \
  worker.tests.test_first_server_decoder \
  worker.tests.test_run_temporal_serve_experiment \
  worker.tests.test_score_temporal_serve_scale -v
```

Expected: all tests PASS.

- [ ] **Step 2: Run regression, compilation, and forbidden-dependency checks**

Run:

```bash
python3 -m unittest discover -s worker/tests -p 'test_*.py'
python3 -m compileall -q worker
rg -n -i 'ultralytics|from yolo|import yolo|openpose|agpl' \
  worker/temporal_serve_*.py worker/train_temporal_serve.py \
  worker/requirements-service-motion-rtmpose.txt
git diff --check
```

Expected: tests and compilation pass; the dependency scan has no matches; `git diff --check` is silent.

- [ ] **Step 3: Build and inspect the sealed manifest before expensive inference**

Run:

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python \
  -m worker.run_temporal_serve_experiment manifest \
  --target-points 1000 \
  --minimum-matches 30 \
  --chris-date 2026-07-30 \
  --output /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731
```

Expected: manifest validation succeeds, the newest eligible Chris match appears only under holdout, match sets do not overlap, and the report states whether the 30-match target was available.

- [ ] **Step 4: Extract cached features with progress and compute logging**

Run:

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python \
  -m worker.run_temporal_serve_experiment features \
  --output /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731 \
  --pose-root /Users/adil/Library/Caches/PongLens/service-motion-rtmpose
```

Expected: every eligible source has a validated feature cache or an explicit failure reason; the command can be rerun without reprocessing completed hashes.

- [ ] **Step 5: Train, freeze development thresholds, and infer the untouched holdout**

Run:

```bash
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python \
  -m worker.run_temporal_serve_experiment train \
  --output /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731 \
  --seed 731
/Users/adil/Library/Caches/PongLens/service-motion-rtmpose/venv/bin/python \
  -m worker.run_temporal_serve_experiment infer \
  --output /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731
```

Expected: training provenance contains only train/development IDs; holdout inference occurs after threshold freeze and records one opening timestamp.

- [ ] **Step 6: Score and render the final report**

Run:

```bash
python3 -m worker.score_temporal_serve_scale \
  --run /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/results.json \
  --manifest /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731/manifest.json \
  --output /Users/adil/Desktop/PongLens-Reports/temporal-serve-scale-20260731
```

Expected: `score.json`, `report.md`, and at most 60 `active-review.json` cases are written atomically. The recommendation is derived solely from the documented gates.

- [ ] **Step 7: Perform final evidence review and commit any verified fixes**

Confirm the report explicitly states cohort size, match count, split count, Chris-canary outcome, baseline versus temporal results, point and match coverage, skipped-point behavior, compute, licensing provenance, and whether results are preliminary. If implementation fixes were required after Task 7, stage only those files and commit:

```bash
git add worker docs/superpowers/plans/2026-07-31-temporal-serve-detection-scale.md
git commit -m "fix: verify temporal serve scale experiment"
```

If no code changes remain, do not create an empty commit.
