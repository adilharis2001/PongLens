import unittest
from pathlib import Path
import tempfile

import numpy as np

from worker.train_audio_impacts import (
    AUDIO_IMPACT_CLASSES,
    build_grouped_folds,
    evaluate_predictions,
    fetch_frozen_media,
    fixed_audio_window,
    normalize_research_export,
    prepare_gold_examples,
    require_cnn_dependency,
    score_sealed,
    train_linear_experiment,
    validate_sealed_artifact,
)


def event(
    event_id,
    kind,
    *,
    recording="recording-a",
    source="source-a",
    venue="PingPod",
    round_name="A",
):
    return {
        "event_id": event_id,
        "kind": kind,
        "time_s": 1.0,
        "source_id": source,
        "source_recording_id": recording,
        "venue": venue,
        "round": round_name,
        "media_path": f"{source}.mp4",
        "human_gold": True,
    }


class FixedWindowTests(unittest.TestCase):
    def test_resamples_to_an_exact_200_ms_window_at_48_khz(self):
        samples = np.linspace(-1.0, 1.0, 44_100, dtype=np.float32)

        window = fixed_audio_window(samples, event_time_s=0.5, source_rate=44_100)

        self.assertEqual(window.samples.shape, (9_600,))
        self.assertEqual(window.sample_rate, 48_000)
        self.assertEqual(window.left_padding, 0)
        self.assertEqual(window.right_padding, 0)

    def test_zero_pads_boundary_windows_explicitly(self):
        samples = np.ones(4_800, dtype=np.float32)

        left = fixed_audio_window(samples, event_time_s=0.0, source_rate=48_000)
        right = fixed_audio_window(samples, event_time_s=0.1, source_rate=48_000)

        self.assertEqual(left.left_padding, 4_800)
        self.assertTrue(np.all(left.samples[:4_800] == 0))
        self.assertEqual(right.right_padding, 4_800)
        self.assertTrue(np.all(right.samples[4_800:] == 0))


class LeakageGuardTests(unittest.TestCase):
    def test_unsure_is_excluded_and_round_c_is_never_development_input(self):
        rows = [
            event("p", "paddle"),
            event("u", "unsure"),
            event("sealed", "table", recording="recording-c", source="source-c", round_name="C"),
        ]

        development = prepare_gold_examples(rows, partition="development")
        sealed = prepare_gold_examples(rows, partition="sealed")

        self.assertEqual([item["event_id"] for item in development], ["p"])
        self.assertEqual([item["event_id"] for item in sealed], ["sealed"])

    def test_grouped_folds_never_split_a_recording(self):
        rows = []
        for recording in ("a", "b", "c", "d"):
            rows.extend(
                event(f"{recording}-{index}", "paddle", recording=recording, source=f"source-{recording}")
                for index in range(3)
            )

        folds = build_grouped_folds(rows, fold_count=3)

        for fold in folds:
            train_recordings = {rows[index]["source_recording_id"] for index in fold["train_indices"]}
            validation_recordings = {rows[index]["source_recording_id"] for index in fold["validation_indices"]}
            self.assertTrue(validation_recordings)
            self.assertTrue(train_recordings.isdisjoint(validation_recordings))

    def test_sealed_scorer_rejects_training_source_leakage(self):
        artifact = {
            "artifact_schema_version": 1,
            "training_source_ids": ["source-a", "source-c"],
            "model_sha256": "a" * 64,
            "threshold_sha256": "b" * 64,
        }
        sealed = [event("sealed", "table", recording="recording-c", source="source-c", round_name="C")]

        with self.assertRaisesRegex(ValueError, "Round C"):
            validate_sealed_artifact(artifact, sealed)

    def test_round_c_cannot_enter_the_linear_fit(self):
        sealed = [event("sealed", "table", round_name="C")]

        with self.assertRaisesRegex(ValueError, "Round C"):
            train_linear_experiment(sealed, np.ones((1, 4)))


class ExportTests(unittest.TestCase):
    def test_flattens_only_completed_submitted_human_labels(self):
        payload = {
            "batch": {"slug": "audio-impact-labeling-recent-v1"},
            "assignments": [
                {
                    "status": "submitted",
                    "source_id": "source-a",
                    "source_match_id": "recording-a",
                    "prefill": {"round": "A", "venue_category": "pingpod"},
                    "human_label": {
                        "sequence_complete": True,
                        "events": [{"id": "hit", "kind": "paddle", "time_s": 1.25}],
                    },
                },
                {
                    "status": "in_progress",
                    "source_id": "source-b",
                    "prefill": {"round": "B"},
                    "human_label": {
                        "sequence_complete": False,
                        "events": [{"id": "draft", "kind": "table", "time_s": 2}],
                    },
                },
            ],
        }

        rows = normalize_research_export(payload, media_dir=Path("/frozen"))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_id"], "hit")
        self.assertEqual(rows[0]["venue"], "pingpod")
        self.assertEqual(rows[0]["media_path"], "/frozen/source-a.mp4")

    def test_fetches_each_frozen_source_once_from_the_research_namespace(self):
        calls = []

        class FakeR2:
            def download_file(self, bucket, key, destination):
                calls.append((bucket, key, destination))

        payload = {
            "batch": {"slug": "audio-impact-labeling-recent-v1"},
            "assignments": [
                {"source_id": "source-a"},
                {"source_id": "source-a"},
                {"source_id": "source-b"},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            fetched = fetch_frozen_media(
                payload,
                output,
                production=type("Production", (), {"r2": FakeR2()})(),
                exists=lambda _path: False,
            )

        self.assertEqual(fetched, 2)
        self.assertEqual(
            calls[0],
            (
                "ponglens-media",
                "research/audio-impacts/v1/sources/source-a.mp4",
                str(output / "source-a.mp4"),
            ),
        )


class MetricTests(unittest.TestCase):
    def test_reports_abstention_coverage_and_per_venue_class_metrics(self):
        truth = [
            event("1", "paddle", venue="PingPod"),
            event("2", "table", venue="PingPod"),
            event("3", "paddle", venue="Westchester"),
            event("4", "table", venue="Westchester"),
        ]

        report = evaluate_predictions(
            truth,
            predictions=["paddle", None, "table", "table"],
            partition="sealed",
            probabilities=np.asarray(
                [
                    [0.9, 0.1, 0, 0, 0, 0, 0, 0],
                    [0.4, 0.6, 0, 0, 0, 0, 0, 0],
                    [0.3, 0.7, 0, 0, 0, 0, 0, 0],
                    [0.1, 0.9, 0, 0, 0, 0, 0, 0],
                ]
            ),
        )

        self.assertEqual(report["coverage"], 0.75)
        self.assertEqual(report["venues"]["PingPod"]["coverage"], 0.5)
        self.assertEqual(report["venues"]["Westchester"]["classes"]["table"]["true_positive"], 1)
        self.assertEqual(report["classes"]["paddle"]["sealed_count"], 2)
        self.assertEqual(report["classes"]["paddle"]["status"], "data_insufficient")
        self.assertEqual(set(report["classes"]), set(AUDIO_IMPACT_CLASSES))
        self.assertAlmostEqual(report["paddle_table_roc_auc"], 0.75)
        self.assertIn("recording-a", report["recordings"])

    def test_development_and_sealed_sufficiency_thresholds_are_distinct(self):
        development = [event(str(index), "paddle") for index in range(30)]
        sealed = [event(str(index), "paddle", round_name="C") for index in range(15)]

        dev_report = evaluate_predictions(development, ["paddle"] * 30, partition="development")
        sealed_report = evaluate_predictions(sealed, ["paddle"] * 15, partition="sealed")

        self.assertEqual(dev_report["classes"]["paddle"]["status"], "sufficient")
        self.assertEqual(sealed_report["classes"]["paddle"]["status"], "sufficient")


class OptionalCnnTests(unittest.TestCase):
    def test_missing_cnn_dependency_has_a_precise_install_message(self):
        def missing_import(_name):
            raise ModuleNotFoundError("No module named 'torch'")

        with self.assertRaisesRegex(RuntimeError, "pip install.*torch"):
            require_cnn_dependency(import_module=missing_import)


class LinearExperimentTests(unittest.TestCase):
    def test_freezes_model_and_threshold_hashes_and_scores_sealed_once(self):
        development = []
        feature_rows = []
        for recording_index in range(6):
            kind = "paddle" if recording_index % 2 == 0 else "table"
            for sample_index in range(3):
                development.append(
                    event(
                        f"d-{recording_index}-{sample_index}",
                        kind,
                        recording=f"recording-{recording_index}",
                        source=f"source-{recording_index}",
                    )
                )
                feature_rows.append(
                    [
                        1.0 if kind == "paddle" else -1.0,
                        recording_index / 10,
                        sample_index / 10,
                        0.5,
                    ]
                )

        artifact, development_report = train_linear_experiment(
            development,
            np.asarray(feature_rows),
        )
        sealed = [
            event("c-p", "paddle", recording="sealed-r", source="sealed-s", round_name="C"),
            event("c-t", "table", recording="sealed-r", source="sealed-s", round_name="C"),
        ]
        sealed_report = score_sealed(
            artifact,
            sealed,
            np.asarray([[1.0, 0.1, 0.1, 0.5], [-1.0, 0.1, 0.1, 0.5]]),
        )

        self.assertEqual(len(artifact["model_sha256"]), 64)
        self.assertEqual(len(artifact["threshold_sha256"]), 64)
        self.assertEqual(development_report["validation"], "source_recording_grouped")
        self.assertEqual(sealed_report["model_sha256"], artifact["model_sha256"])


if __name__ == "__main__":
    unittest.main()
