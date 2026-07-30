import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from worker.run_service_motion_experiment import (
    _align_hypothesis_times,
    _automatic_motion,
    _compute_totals,
    _safe_player_regions,
    _validate_or_write_stage_c_manifest,
    run_experiment,
    validate_export,
)


def export_fixture(count: int = 42) -> dict:
    assignments = []
    for index in range(count):
        side = "near" if index % 2 == 0 else "far"
        assignments.append(
            {
                "source_id": f"source-{index:03d}",
                "source_match_id": f"match-{index % 5}",
                "source_point_id": f"point-{index:03d}",
                "source_point_idx": index + 1,
                "submitted_at": "2026-07-30T00:00:00Z",
                "proposal": {
                    "detector": {
                        "status": "high_confidence",
                        "server_side": side,
                        "confidence": 0.96,
                    }
                },
                "human_label": {
                    "actual_serve_contact_s": 0.7,
                    "no_observable_serve": None,
                    "followup": {
                        "submitted_at": "2026-07-30T00:00:00Z",
                        "first_bounce": {
                            "status": "exact",
                            "time_s": 1.0,
                        },
                        "second_bounce": {
                            "status": "exact",
                            "time_s": 1.4,
                        },
                    },
                },
                "gold": {"scored_server_side": side},
            }
        )
    return {
        "schema_version": 2,
        "batch": {"slug": "serve-detection-cross-match-v1"},
        "assignments": assignments,
    }


class FakeProduction:
    def __init__(self, assignments):
        self.sources = {}
        for assignment in assignments:
            source_id = assignment["source_id"]
            payload = f"sealed:{source_id}".encode()
            self.sources[source_id] = {
                "source_id": source_id,
                "source_match_id": assignment["source_match_id"],
                "source_point_id": assignment["source_point_id"],
                "source_point_idx": assignment["source_point_idx"],
                "match_key": assignment["source_match_id"],
                "media_bytes": payload,
                "media_sha256": hashlib.sha256(payload).hexdigest(),
                "video": {
                    "fps": 30.0,
                    "frame_count": 90,
                    "duration_s": 3.0,
                },
                "placement": {
                    "hypotheses": [],
                    "candidates": [],
                },
                "calibration": {
                    "table_corners_px": {
                        "near_left": [0, 100],
                        "near_right": [200, 100],
                        "far_left": [40, 20],
                        "far_right": [160, 20],
                    }
                },
            }

    def materialize_research_source(self, assignment, cache_dir):
        del cache_dir
        return dict(self.sources[assignment["source_id"]])

    def first_retained_points(self, match_ids, limit):
        del match_ids, limit
        return []

    def first_server_truth(self, match_ids):
        return {
            match_id: ("near" if index % 2 == 0 else "far")
            for index, match_id in enumerate(sorted(match_ids))
        }


class FakePose:
    model_sha256 = "pose-model-sha"

    def __init__(self, calls):
        self.calls = calls
        self.seen = []

    def analyze(self, detector_input, first_bounce_t):
        self.seen.append(json.loads(json.dumps(detector_input)))
        side = self.calls.get(detector_input["source_id"])
        return {
            "version": 1,
            "status": "high_confidence" if side else "withheld",
            "side": side,
            "onset_t": max(0.0, first_bounce_t - 0.6),
            "contact_t": max(0.0, first_bounce_t - 0.1),
            "confidence": 0.98 if side else 0.0,
            "scores": {"near": 4.0, "far": 1.0},
            "features": {},
            "reason": "synthetic",
            "compute": {
                "decoded_frames": 17,
                "posed_frames": 34,
                "inference_s": 0.01,
                "elapsed_s": 0.02,
                "peak_rss_mb": 100.0,
            },
        }


class ExportValidationTests(unittest.TestCase):
    def test_stage_c_manifest_seals_point_selection_and_media_hash(self):
        entries = [
            {
                "source_match_id": "match-1",
                "source_point_id": "point-1",
                "source_point_idx": 1,
                "clip_path": "r2://bucket/point-1.mp4",
                "media_sha256": "a" * 64,
            }
        ]
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "stage-c-manifest.json"
            _validate_or_write_stage_c_manifest(path, entries)
            _validate_or_write_stage_c_manifest(path, entries)
            changed = [{**entries[0], "media_sha256": "b" * 64}]
            with self.assertRaisesRegex(RuntimeError, "sealed"):
                _validate_or_write_stage_c_manifest(path, changed)

    def test_aligns_nested_hypothesis_events_to_point_clip(self):
        placement = {
            "candidates": [
                {
                    "id": "candidate-1",
                    "source_t": 101.2,
                    "t": 1.2,
                },
                {
                    "id": "candidate-2",
                    "source_t": 101.6,
                    "t": 1.6,
                },
            ],
            "hypotheses": {
                "near": {
                    "shots": [
                        {
                            "phase": "serve",
                            "serve_first_bounce": {
                                "event_id": "candidate-1",
                                "t": 101.2,
                            },
                            "landing": {
                                "event_id": "candidate-2",
                                "t": 101.6,
                            },
                        }
                    ]
                }
            },
        }

        aligned = _align_hypothesis_times(placement)
        serve = aligned["hypotheses"]["near"]["shots"][0]

        self.assertEqual(serve["serve_first_bounce"]["t"], 1.2)
        self.assertEqual(serve["serve_first_bounce"]["source_t"], 101.2)
        self.assertEqual(serve["landing"]["t"], 1.6)
        self.assertEqual(serve["landing"]["source_t"], 101.6)

    def test_rejects_wrong_batch(self):
        payload = export_fixture()
        payload["batch"]["slug"] = "other"
        with self.assertRaisesRegex(ValueError, "batch"):
            validate_export(payload)

    def test_side_view_calibration_falls_back_to_two_frame_ends(self):
        regions = _safe_player_regions(
            {
                "A_near_1": [0, 405],
                "B_near_2": [0, 181],
                "C_far_2": [719, 223],
                "D_far_1": [719, 405],
            },
            720,
            406,
        )

        self.assertEqual(regions["near"], [0.0, 0.0, 396.0, 406.0])
        self.assertEqual(regions["far"], [324.0, 0.0, 720.0, 406.0])

    def test_rejects_wrong_followup_count(self):
        with self.assertRaisesRegex(ValueError, "42"):
            validate_export(export_fixture(41))

    def test_rejects_missing_followup_submission(self):
        payload = export_fixture()
        payload["assignments"][0]["human_label"]["followup"][
            "submitted_at"
        ] = None
        with self.assertRaisesRegex(ValueError, "submitted"):
            validate_export(payload)

    def test_rejects_duplicate_source_ids(self):
        payload = export_fixture()
        payload["assignments"][1]["source_id"] = payload["assignments"][0][
            "source_id"
        ]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_export(payload)


class ExperimentOrchestrationTests(unittest.TestCase):
    def test_automatic_motion_retains_chain_timing_and_all_compute(self):
        placement = {
            "hypotheses": {
                "near": {
                    "server_side": "near",
                    "score": 8.0,
                    "hard_reasons": [],
                    "shots": [
                        {
                            "phase": "serve",
                            "serve_first_bounce": {
                                "event_id": "first",
                                "t": 1.0,
                                "v": 0.7,
                                "confidence": 0.9,
                            },
                            "landing": {
                                "event_id": "second",
                                "t": 1.4,
                                "v": 2.0,
                                "confidence": 0.9,
                            },
                        }
                    ],
                }
            }
        }
        pose = FakePose({"source": "near"})
        result = _automatic_motion(
            {
                "source_id": "source",
                "placement": placement,
            },
            pose,
        )

        self.assertEqual(result["first_bounce"]["t"], 1.0)
        self.assertEqual(result["second_bounce"]["t"], 1.4)
        self.assertEqual(result["compute"]["posed_frames"], 34)

    def test_compute_totals_separates_every_experiment_stage(self):
        cases = [
            {
                "oracle_motion": {
                    "compute": {
                        "decoded_frames": 10,
                        "posed_frames": 20,
                        "inference_s": 1.0,
                        "elapsed_s": 2.0,
                        "peak_rss_mb": 100,
                    }
                },
                "detected_motion": {
                    "compute": {
                        "decoded_frames": 30,
                        "posed_frames": 60,
                        "inference_s": 3.0,
                        "elapsed_s": 4.0,
                        "peak_rss_mb": 120,
                    }
                },
            }
        ]
        early_calls = {
            "match": [
                {
                    "compute": {
                        "decoded_frames": 50,
                        "posed_frames": 100,
                        "inference_s": 5.0,
                        "elapsed_s": 6.0,
                        "peak_rss_mb": 140,
                    }
                }
            ]
        }

        totals = _compute_totals(cases, early_calls)

        self.assertEqual(totals["stage_a"]["posed_frames"], 20)
        self.assertEqual(totals["stage_b"]["posed_frames"], 60)
        self.assertEqual(totals["stage_c"]["posed_frames"], 100)
        self.assertEqual(totals["total"]["posed_frames"], 180)
        self.assertEqual(totals["total"]["peak_rss_mb"], 140)

    def test_runs_blinded_oracle_stage_and_writes_results(self):
        payload = export_fixture()
        calls = {
            item["source_id"]: item["gold"]["scored_server_side"]
            for item in payload["assignments"]
        }
        pose = FakePose(calls)
        production = FakeProduction(payload["assignments"])
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw)
            result = run_experiment(
                export_payload=payload,
                output_dir=output,
                production=production,
                pose_model=pose,
                blurball_runner=lambda _case: {},
            )

            self.assertEqual(result["cohorts"]["anchor_rich"], 42)
            self.assertEqual(result["ablations"][0]["name"], "unanchored_pose")
            self.assertEqual(result["stage_a"]["precision"], 1.0)
            self.assertEqual(result["stage_b"]["status"], "completed")
            self.assertEqual(
                set(result["stage_c"]["truth"]),
                {f"match-{index}" for index in range(5)},
            )
            self.assertTrue((output / "results.json").is_file())
            self.assertNotIn(
                "scored_server_side",
                result["cases"][0]["detector_input"],
            )
            serialized = json.dumps(pose.seen)
            self.assertNotIn("scored_server_side", serialized)
            self.assertNotIn("reviewer_id", serialized)

    def test_stage_b_stops_below_frozen_precision_gate(self):
        payload = export_fixture()
        calls = {
            item["source_id"]: item["gold"]["scored_server_side"]
            for item in payload["assignments"]
        }
        calls[payload["assignments"][0]["source_id"]] = "far"
        production = FakeProduction(payload["assignments"])
        with tempfile.TemporaryDirectory() as raw:
            result = run_experiment(
                export_payload=payload,
                output_dir=Path(raw),
                production=production,
                pose_model=FakePose(calls),
                blurball_runner=lambda _case: {},
                stage_a_minimum_precision=0.99,
            )

        self.assertEqual(result["stage_b"]["status"], "skipped_gate")

    def test_rejects_downloaded_media_that_breaks_stored_digest(self):
        payload = export_fixture()
        production = FakeProduction(payload["assignments"])
        production.sources[payload["assignments"][0]["source_id"]][
            "media_sha256"
        ] = "0" * 64
        calls = {
            item["source_id"]: item["gold"]["scored_server_side"]
            for item in payload["assignments"]
        }

        with tempfile.TemporaryDirectory() as raw:
            with self.assertRaisesRegex(RuntimeError, "media SHA"):
                run_experiment(
                    export_payload=payload,
                    output_dir=Path(raw),
                    production=production,
                    pose_model=FakePose(calls),
                    blurball_runner=lambda _case: {},
                )


if __name__ == "__main__":
    unittest.main()
