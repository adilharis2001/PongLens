import json
import tempfile
import unittest
from pathlib import Path

from worker.train_temporal_serve import train_model, validate_training_splits


def synthetic_dataset():
    def rows(split, match_prefix, count):
        result = []
        for index in range(count):
            target = index % 2
            features = []
            for frame in range(8):
                row = [0.0] * 6
                if frame in (2, 3):
                    row[target] = 3.0
                    row[2 + target] = 1.5
                features.append(row)
            result.append(
                {
                    "source_id": f"{split}-{index}",
                    "match_id": f"{match_prefix}-{index // 2}",
                    "features": features,
                    "mask": [1] * 8,
                    "target_side": target,
                }
            )
        return result

    return {
        "train": rows("train", "train-match", 6),
        "development": rows("development", "dev-match", 4),
        "holdout": [
            {
                "source_id": "holdout-secret",
                "match_id": "holdout-match",
                "features": [[0.0] * 6] * 8,
                "mask": [1] * 8,
                "target_side": 1,
            }
        ],
        "metadata": {
            "manifest_sha256": "a" * 64,
            "extractor_version": "test-v1",
            "rtmpose_checkpoint_sha256": "b" * 64,
        },
    }


class TrainingTests(unittest.TestCase):
    def test_training_is_reproducible_on_synthetic_features(self):
        first = train_model(synthetic_dataset(), seed=731, epochs=3, patience=3)
        second = train_model(synthetic_dataset(), seed=731, epochs=3, patience=3)

        self.assertEqual(first["best_epoch"], second["best_epoch"])
        self.assertAlmostEqual(
            first["development_loss"], second["development_loss"], places=7
        )
        self.assertEqual(first["checkpoint_sha256"], second["checkpoint_sha256"])

    def test_training_rejects_overlapping_match_ids(self):
        with self.assertRaisesRegex(ValueError, "match leakage"):
            validate_training_splits(
                {"train": ["m1", "m2"], "development": ["m1"], "holdout": ["m3"]}
            )

    def test_artifacts_exclude_holdout_labels_and_record_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            result = train_model(
                synthetic_dataset(),
                seed=731,
                epochs=2,
                patience=2,
                output_dir=Path(directory),
            )
            training = json.loads((Path(directory) / "training.json").read_text())
            provenance = json.loads((Path(directory) / "provenance.json").read_text())

            self.assertTrue((Path(directory) / "checkpoint.pt").is_file())
            self.assertEqual(training["checkpoint_sha256"], result["checkpoint_sha256"])
            self.assertEqual(provenance["seed"], 731)
            self.assertEqual(provenance["manifest_sha256"], "a" * 64)
            self.assertIn("holdout-match", provenance["split_match_ids"]["holdout"])
            serialized = json.dumps({"training": training, "provenance": provenance})
            self.assertNotIn("holdout-secret", serialized)
            self.assertNotIn('"target_side"', serialized)

    def test_training_requires_nonempty_train_and_development_sets(self):
        dataset = synthetic_dataset()
        dataset["development"] = []
        with self.assertRaisesRegex(ValueError, "development split is empty"):
            train_model(dataset, epochs=1)


if __name__ == "__main__":
    unittest.main()
