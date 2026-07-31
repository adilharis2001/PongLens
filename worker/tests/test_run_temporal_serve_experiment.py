import json
import tempfile
import unittest
from pathlib import Path

from worker.run_temporal_serve_experiment import run_experiment
from worker.temporal_serve_features import PAIRED_FEATURE_WIDTH


def manifest_fixture():
    def match(split, match_id, expected):
        point_id = f"{match_id}-point"
        return {
            "match_id": match_id,
            "match_label": match_id,
            "created_at": "2026-07-30T12:00:00Z",
            "points": [
                {
                    "source_id": f"temporal:{match_id}:{point_id}",
                    "source_point_id": point_id,
                    "source_point_idx": 1,
                    "model_input": {
                        "source_id": f"temporal:{match_id}:{point_id}",
                        "source_match_id": match_id,
                        "source_point_id": point_id,
                        "source_point_idx": 1,
                        "clip_uri": f"r2://media/{point_id}.mp4",
                        "media_sha256": (split[0] * 64),
                        "placement": {},
                        "calibration": {"ok": True, "table_corners_px": {}},
                    },
                    "evaluation": {
                        "expected_server_side": expected,
                        "server_source": "rotation",
                        "game_number": 1,
                    },
                }
            ],
        }

    return {
        "schema_version": 1,
        "experiment": "temporal-serve-scale-v1",
        "status": "preliminary",
        "target_points": 3,
        "minimum_matches": 3,
        "holdout_canaries": ["holdout-match"],
        "splits": {
            "train": [match("train", "train-match", "near")],
            "development": [match("development", "dev-match", "far")],
            "holdout": [match("holdout", "holdout-match", "near")],
        },
        "counts": {
            "matches": 3,
            "points": 3,
            "by_split": {
                split: {"matches": 1, "points": 1}
                for split in ("train", "development", "holdout")
            },
        },
        "manifest_sha256": "f" * 64,
    }


class RecordingExtractor:
    def __init__(self):
        self.inputs = []

    def __call__(self, point, materialized=None):
        del materialized
        self.inputs.append(point)
        side_hint = 1.0 if "train" in point["source_id"] else 0.0
        return {
            "schema_version": 1,
            "extractor_version": "runner-test-v1",
            "source_id": point["source_id"],
            "media_sha256": point["media_sha256"],
            "model_sha256": "m" * 64,
            "sample_fps": 15.0,
            "times_s": [0.0, 0.1],
            "features": [
                [side_hint] + [0.0] * (PAIRED_FEATURE_WIDTH - 1),
                [0.0] * PAIRED_FEATURE_WIDTH,
            ],
            "mask": [1.0, 1.0],
            "ball_events": [],
            "audio_events": [],
            "compute": {"elapsed_s": 0.01},
        }


class FakeTrainer:
    def fit(self, dataset, output_dir=None):
        self.dataset = dataset
        self.output_dir = output_dir
        return {"checkpoint_sha256": "c" * 64, "best_epoch": 1}

    def infer(self, training, feature):
        del training
        near = 0.95 if "train" in feature["source_id"] else 0.08
        return {"near": near, "far": 1.0 - near, "onset_t": 0.1}


class RunnerTests(unittest.TestCase):
    def test_runner_never_passes_truth_to_extractor_or_model_features(self):
        recorder = RecordingExtractor()
        trainer = FakeTrainer()
        with tempfile.TemporaryDirectory() as directory:
            result = run_experiment(
                manifest_fixture(),
                extractor=recorder,
                trainer=trainer,
                output_dir=Path(directory),
            )

        serialized_inputs = json.dumps(recorder.inputs)
        self.assertNotIn("expected_server_side", serialized_inputs)
        self.assertNotIn("first_server", serialized_inputs)
        serialized_features = json.dumps(
            {
                split: [row["features"] for row in rows]
                for split, rows in trainer.dataset.items()
                if split in {"train", "development"}
            }
        )
        self.assertNotIn("expected_server_side", serialized_features)
        self.assertEqual(len(result["predictions"]["holdout"]), 1)

    def test_runner_resumes_completed_feature_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            first = RecordingExtractor()
            run_experiment(
                manifest_fixture(),
                extractor=first,
                trainer=FakeTrainer(),
                output_dir=output,
            )
            second = RecordingExtractor()
            run_experiment(
                manifest_fixture(),
                extractor=second,
                trainer=FakeTrainer(),
                output_dir=output,
            )

            self.assertEqual(len(first.inputs), 3)
            self.assertEqual(second.inputs, [])

    def test_holdout_open_timestamp_is_written_once(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            first = run_experiment(
                manifest_fixture(),
                extractor=RecordingExtractor(),
                trainer=FakeTrainer(),
                output_dir=output,
            )
            second = run_experiment(
                manifest_fixture(),
                extractor=RecordingExtractor(),
                trainer=FakeTrainer(),
                output_dir=output,
            )
            self.assertEqual(
                first["holdout_opened_at"], second["holdout_opened_at"]
            )


if __name__ == "__main__":
    unittest.main()
