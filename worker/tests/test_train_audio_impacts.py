import unittest
from copy import deepcopy
import json
from pathlib import Path
import tempfile

import numpy as np

from worker.train_audio_impacts import (
    AUDIO_IMPACT_CLASSES,
    build_grouped_folds,
    compare_cnn_to_linear,
    evaluate_predictions,
    fetch_frozen_media,
    freeze_and_unlock_payload,
    log_spectrogram,
    feature_definition_sha256,
    fixed_audio_window,
    normalize_research_export,
    pool_acquisition_components,
    prepare_gold_examples,
    require_cnn_dependency,
    recover_pending_sealed_report,
    score_sealed,
    sealed_label_snapshot,
    scored_state_payload,
    train_linear_experiment,
    validate_export_bindings,
    validate_sealed_artifact,
    canonical_hash,
)


class TaxonomyTests(unittest.TestCase):
    def test_shoe_squeak_and_stomp_are_distinct_trainable_classes(self):
        self.assertEqual(
            AUDIO_IMPACT_CLASSES,
            (
                "paddle",
                "table",
                "floor",
                "shoe",
                "shoe_squeak",
                "stomp",
                "net",
                "background",
                "other",
                "no_impact",
            ),
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
            "feature_definition_sha256": feature_definition_sha256(),
            "cohort_manifest_sha256": "c" * 64,
        }
        sealed = [event("sealed", "table", recording="recording-c", source="source-c", round_name="C")]
        sealed[0]["cohort_manifest_sha256"] = "c" * 64

        with self.assertRaisesRegex(ValueError, "Round C"):
            validate_sealed_artifact(
                artifact,
                sealed,
                sealed_bindings={
                    "cohort_manifest_sha256": "c" * 64,
                    "frozen_model_sha256": "a" * 64,
                    "frozen_threshold_sha256": "b" * 64,
                },
            )

    def test_round_c_cannot_enter_the_linear_fit(self):
        sealed = [event("sealed", "table", round_name="C")]

        with self.assertRaisesRegex(ValueError, "Round C"):
            train_linear_experiment(sealed, np.ones((1, 4)))


class ExportTests(unittest.TestCase):
    def test_flattens_only_completed_submitted_human_labels(self):
        payload = {
            "batch": {"slug": "audio-impact-labeling-recent-v1"},
            "exported_rounds": ["A"],
            "study_state": {
                "phase": "development_a",
                "cohort_manifest_sha256": "c" * 64,
                "detector_manifest_sha256": "d" * 64,
            },
            "assignments": [
                {
                    "status": "submitted",
                    "source_id": "source-a",
                    "source_match_id": "recording-a",
                    "media_sha256": "e" * 64,
                    "detector_manifest_sha256": "f" * 64,
                    "prefill": {
                        "round": "A",
                        "venue_category": "pingpod",
                        "cohort_manifest_sha256": "c" * 64,
                    },
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
        self.assertEqual(rows[0]["media_sha256"], "e" * 64)

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

    def test_sealed_export_requires_all_thirty_completed_round_c_assignments(self):
        payload = {
            "batch": {"slug": "audio-impact-labeling-recent-v1"},
            "exported_rounds": ["A", "B", "C"],
            "study_state": {
                "phase": "sealed_labeling",
                "cohort_manifest_sha256": "c" * 64,
                "detector_manifest_sha256": "d" * 64,
            },
            "assignments": [
                {
                    "status": "submitted",
                    "source_id": "source-c",
                    "media_sha256": "e" * 64,
                    "detector_manifest_sha256": "f" * 64,
                    "prefill": {
                        "round": "C",
                        "source_recording_id": "recording-c",
                        "cohort_manifest_sha256": "c" * 64,
                    },
                    "human_label": {
                        "sequence_complete": True,
                        "events": [
                            {"id": "event-c", "kind": "paddle", "time_s": 1}
                        ],
                    },
                }
            ],
        }
        rows = normalize_research_export(payload, media_dir=Path("/frozen"))

        with self.assertRaisesRegex(ValueError, "all 30"):
            validate_export_bindings(payload, rows, partition="sealed")


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
                    [0.9, 0.1, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0.4, 0.6, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0.3, 0.7, 0, 0, 0, 0, 0, 0, 0, 0],
                    [0.1, 0.9, 0, 0, 0, 0, 0, 0, 0, 0],
                ]
            ),
        )

        self.assertEqual(report["coverage"], 0.75)
        self.assertAlmostEqual(report["selective_accuracy"], 2 / 3)
        self.assertAlmostEqual(report["selective_paddle_table_balanced_accuracy"], 0.75)
        self.assertEqual(report["venues"]["PingPod"]["coverage"], 0.5)
        self.assertIn("macro_f1", report["venues"]["PingPod"])
        self.assertIn("selective_macro_f1", report["venues"]["PingPod"])
        self.assertIn("selective_classes", report["venues"]["PingPod"])
        self.assertIn("confusion_matrix", report["venues"]["PingPod"])
        self.assertIn("selective_accuracy", report["venues"]["PingPod"])
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
    def test_cnn_uses_a_fixed_small_log_spectrogram(self):
        samples = np.sin(
            2 * np.pi * 1_000 * np.arange(9_600, dtype=np.float64) / 48_000
        ).astype(np.float32)

        image = log_spectrogram(samples)

        self.assertEqual(image.shape, (96, 36))
        self.assertTrue(np.isfinite(image).all())

    def test_missing_cnn_dependency_has_a_precise_install_message(self):
        def missing_import(_name):
            raise ModuleNotFoundError("No module named 'torch'")

        with self.assertRaisesRegex(RuntimeError, "pip install.*torch"):
            require_cnn_dependency(import_module=missing_import)

    def test_cnn_is_accepted_only_for_material_cross_venue_improvement(self):
        linear = {
            "selective_macro_f1": 0.70,
            "development_export_sha256": "1" * 64,
            "cohort_manifest_sha256": "2" * 64,
            "detector_manifest_sha256": "3" * 64,
            "venues": {
                "pingpod": {"selective_accuracy": 0.80},
                "westchester": {"selective_accuracy": 0.70},
            },
        }
        accepted = {
            "selective_macro_f1": 0.74,
            "development_export_sha256": "1" * 64,
            "cohort_manifest_sha256": "2" * 64,
            "detector_manifest_sha256": "3" * 64,
            "venues": {
                "pingpod": {"selective_accuracy": 0.79},
                "westchester": {"selective_accuracy": 0.72},
            },
        }
        regressed = {
            **accepted,
            "venues": {
                **accepted["venues"],
                "westchester": {"selective_accuracy": 0.67},
            },
        }

        self.assertTrue(compare_cnn_to_linear(accepted, linear)["accept_cnn_complexity"])
        self.assertFalse(compare_cnn_to_linear(regressed, linear)["accept_cnn_complexity"])


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
            bindings={
                "export_sha256": "1" * 64,
                "cohort_manifest_sha256": "2" * 64,
                "detector_manifest_sha256": "3" * 64,
            },
        )
        sealed = [
            event("c-p", "paddle", recording="sealed-r", source="sealed-s", round_name="C"),
            event("c-t", "table", recording="sealed-r", source="sealed-s", round_name="C"),
        ]
        for row in sealed:
            row["cohort_manifest_sha256"] = "2" * 64
        sealed_report = score_sealed(
            artifact,
            sealed,
            np.asarray([[1.0, 0.1, 0.1, 0.5], [-1.0, 0.1, 0.1, 0.5]]),
            sealed_bindings={
                "cohort_manifest_sha256": "2" * 64,
                "frozen_model_sha256": artifact["model_sha256"],
                "frozen_threshold_sha256": artifact["threshold_sha256"],
                "sealed_label_snapshot_sha256": "9" * 64,
            },
        )

        self.assertEqual(len(artifact["model_sha256"]), 64)
        self.assertEqual(len(artifact["threshold_sha256"]), 64)
        self.assertEqual(development_report["validation"], "source_recording_grouped")
        self.assertEqual(sealed_report["model_sha256"], artifact["model_sha256"])
        self.assertEqual(artifact["feature_definition_sha256"], feature_definition_sha256())
        self.assertEqual(len(artifact["split_definition_sha256"]), 64)
        self.assertEqual(len(artifact["development_report_sha256"]), 64)

    def test_round_b_acquisition_combines_model_uncertainty_and_low_band_confounds(self):
        probabilities = np.asarray(
            [
                [0.51, 0.49, 0, 0, 0, 0, 0, 0, 0, 0],
                [0.9, 0.1, 0, 0, 0, 0, 0, 0, 0, 0],
            ]
        )
        candidates = [
            {
                "detector_origins": ["high_frequency", "low_frequency"],
                "detector_scores": {"low_frequency": 5.0},
            },
            {
                "detector_origins": ["low_frequency"],
                "detector_scores": {"low_frequency": 2.5},
            },
        ]
        low_threshold = [
            {"time_s": time_s, "detector_origins": ["low_frequency"]}
            for time_s in (0.1, 0.3, 0.5, 0.9)
        ]

        components = pool_acquisition_components(
            probabilities,
            candidates,
            low_threshold_candidates=low_threshold,
            duration_s=1.0,
        )

        self.assertAlmostEqual(components["uncertainty"], 0.295)
        self.assertEqual(components["low_frequency_strength"], 0.75)
        self.assertEqual(components["event_density"], 1.0)
        self.assertEqual(components["floor_tail_density"], 0.25)
        self.assertEqual(components["confound_novelty"], 0.5)

    def test_round_b_acquisition_treats_squeaks_and_stomps_as_confounds(self):
        components = pool_acquisition_components(
            np.asarray([[0, 0, 0, 0, 0.4, 0.6, 0, 0, 0, 0]]),
            [{"detector_origins": [], "detector_scores": {}}],
            duration_s=1.0,
        )

        self.assertEqual(components["confound_probability"], 1.0)

    def test_freeze_unlock_and_score_transitions_persist_exact_artifact_hashes(self):
        export = {
            "batch": {"id": "batch", "slug": "audio-impact-labeling-recent-v1"},
            "exported_rounds": ["A", "B"],
            "study_state": {
                "phase": "development_b",
                "cohort_manifest_sha256": "2" * 64,
                "detector_manifest_sha256": "3" * 64,
            },
            "assignments": [
                {
                    "status": "submitted",
                    "source_id": f"source-{round_name}-{index}",
                    "prefill": {"round": round_name},
                    "human_label": {"sequence_complete": True},
                }
                for round_name in ("A", "B")
                for index in range(30)
            ],
        }
        artifact = {
            "development_export_sha256": "",
            "cohort_manifest_sha256": "2" * 64,
            "detector_manifest_sha256": "3" * 64,
            "model_sha256": "4" * 64,
            "threshold_sha256": "5" * 64,
            "training_data_sha256": "6" * 64,
            "feature_definition_sha256": feature_definition_sha256(),
            "split_definition_sha256": "8" * 64,
        }
        from worker.train_audio_impacts import canonical_hash
        artifact["development_export_sha256"] = canonical_hash(export)

        unlocked = freeze_and_unlock_payload(export, artifact, unlocked_at="2026-09-01T12:00:00Z")
        sealed_assignments = [
            {
                "assignment_id": f"assignment-c-{index}",
                "status": "submitted",
                "source_id": f"source-c-{index}",
                "updated_at": f"2026-09-02T12:{index:02d}:00+00:00",
                "prefill": {"round": "C"},
                "human_label": {"sequence_complete": True},
            }
            for index in range(30)
        ]
        snapshot = sealed_label_snapshot(sealed_assignments)
        scored = scored_state_payload(
            unlocked,
            {
                "model_sha256": "4" * 64,
                "threshold_sha256": "5" * 64,
                "coverage": 0.75,
                "sealed_label_snapshot_sha256": snapshot["sha256"],
            },
            sealed_assignments,
            scored_at="2026-09-02T12:00:00Z",
        )

        self.assertEqual(unlocked["phase"], "sealed_labeling")
        self.assertEqual(unlocked["development_model_sha256"], "4" * 64)
        self.assertEqual(scored["phase"], "scored")
        self.assertEqual(len(scored["sealed_report_sha256"]), 64)
        self.assertEqual(
            scored["sealed_label_snapshot_sha256"],
            snapshot["sha256"],
        )
        with self.assertRaisesRegex(ValueError, "already been scored"):
            scored_state_payload(scored, {}, sealed_assignments, scored_at="later")

    def test_sealed_label_snapshot_changes_when_any_assignment_version_changes(self):
        assignments = [
            {
                "assignment_id": f"assignment-{index}",
                "source_id": f"source-{index}",
                "updated_at": f"2026-09-02T12:{index:02d}:00+00:00",
                "status": "submitted",
                "prefill": {"round": "C"},
                "human_label": {"sequence_complete": True},
            }
            for index in range(30)
        ]

        original = sealed_label_snapshot(assignments)
        changed = deepcopy(assignments)
        changed[7]["updated_at"] = "2026-09-02T14:00:00+00:00"

        self.assertNotEqual(original["sha256"], sealed_label_snapshot(changed)["sha256"])
        self.assertEqual(len(original["assignments"]), 30)

    def test_ambiguous_score_response_can_promote_a_matching_pending_report(self):
        assignments = [
            {
                "assignment_id": f"assignment-{index}",
                "source_id": f"source-{index}",
                "updated_at": f"2026-09-02T12:{index:02d}:00+00:00",
                "prefill": {"round": "C"},
            }
            for index in range(30)
        ]
        snapshot = sealed_label_snapshot(assignments)
        report = {
            "model_sha256": "4" * 64,
            "sealed_label_snapshot_sha256": snapshot["sha256"],
        }

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return [
                    {
                        "phase": "scored",
                        "sealed_label_snapshot_sha256": snapshot["sha256"],
                        "sealed_report_sha256": canonical_hash(report),
                    }
                ]

        production = type(
            "Production",
            (),
            {"supabase_url": "https://example.test", "headers": {"apikey": "test"}},
        )()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            export_path = root / "sealed-export.json"
            report_out = root / "sealed-report.json"
            export_path.write_text(
                json.dumps({"batch": {"id": "batch-id"}, "assignments": assignments})
            )
            report_out.with_suffix(".json.pending").write_text(json.dumps(report))

            recovered = recover_pending_sealed_report(
                production,
                export_path,
                report_out,
                request_get=lambda *_args, **_kwargs: Response(),
            )

            self.assertEqual(recovered, report_out)
            self.assertEqual(json.loads(report_out.read_text()), report)
            self.assertFalse(report_out.with_suffix(".json.pending").exists())

    def test_recovery_retains_pending_report_when_database_hash_differs(self):
        assignments = [
            {
                "assignment_id": f"assignment-{index}",
                "source_id": f"source-{index}",
                "updated_at": f"2026-09-02T12:{index:02d}:00+00:00",
                "prefill": {"round": "C"},
            }
            for index in range(30)
        ]
        snapshot = sealed_label_snapshot(assignments)
        report = {
            "model_sha256": "4" * 64,
            "sealed_label_snapshot_sha256": snapshot["sha256"],
        }

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return [
                    {
                        "phase": "scored",
                        "sealed_label_snapshot_sha256": snapshot["sha256"],
                        "sealed_report_sha256": "f" * 64,
                    }
                ]

        production = type(
            "Production",
            (),
            {"supabase_url": "https://example.test", "headers": {"apikey": "test"}},
        )()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            export_path = root / "sealed-export.json"
            report_out = root / "sealed-report.json"
            pending = report_out.with_suffix(".json.pending")
            export_path.write_text(
                json.dumps({"batch": {"id": "batch-id"}, "assignments": assignments})
            )
            pending.write_text(json.dumps(report))

            with self.assertRaisesRegex(RuntimeError, "hash differs"):
                recover_pending_sealed_report(
                    production,
                    export_path,
                    report_out,
                    request_get=lambda *_args, **_kwargs: Response(),
                )

            self.assertTrue(pending.exists())
            self.assertFalse(report_out.exists())


if __name__ == "__main__":
    unittest.main()
