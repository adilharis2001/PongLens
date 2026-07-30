import json
import tempfile
import unittest
from pathlib import Path

from worker.eval.run_serve_detection_experiment import (
    run_experiment,
    run_point,
)


def _point(root: Path):
    ball = root / "ball.jsonl"
    ball.write_text(
        "\n".join(
            [
                json.dumps({"f": 2, "x": 30.0, "y": 40.0}),
                json.dumps({"f": 3, "x": 34.0, "y": 44.0}),
                json.dumps({"f": 4, "x": 38.0, "y": 40.0}),
            ]
        )
        + "\n"
    )
    audio = root / "audio.json"
    audio.write_text(
        json.dumps([{"t": 0.2, "confidence": 4.0}])
    )
    return {
        "point_key": "case-001-point-001",
        "idx": 1,
        "clip_path": "clip.mp4",
        "ball_path": "ball.jsonl",
        "audio_path": "audio.json",
        "fps": 30.0,
        "frame_count": 90,
        "duration": 3.0,
        "calibration_size": [1280, 720],
        "table_corners": [
            [320.0, 400.0],
            [560.0, 480.0],
            [800.0, 320.0],
            [640.0, 280.0],
        ],
        "homography": [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        "length_axis": [0.0, -1.0],
    }


def _empty_reconstruction(**_kwargs):
    return {
        "v": 3,
        "status": "unavailable",
        "candidates": [],
        "hypotheses": {
            "near": {
                "server_side": "near",
                "status": "unavailable",
                "score": -4.0,
                "reasons": ["serve_incomplete"],
                "hard_reasons": ["serve_incomplete"],
                "shots": [],
            },
            "far": {
                "server_side": "far",
                "status": "unavailable",
                "score": -4.0,
                "reasons": ["serve_incomplete"],
                "hard_reasons": ["serve_incomplete"],
                "shots": [],
            },
        },
    }


class PointRunnerTests(unittest.TestCase):
    def test_geometry_arm_uses_the_full_clip_and_no_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            point = _point(root)
            captured = {}

            def reconstruct(**kwargs):
                captured.update(kwargs)
                return _empty_reconstruction()

            result = run_point(
                point,
                root,
                arm="geometry",
                track_runner=lambda *_args, **_kwargs: {
                    "segments": [],
                    "bounces": [],
                    "hits": [],
                },
                reconstruction_runner=reconstruct,
            )

        self.assertEqual(result["frame_window"], [0, 90])
        self.assertEqual(result["audio_impact_count"], 0)
        self.assertEqual(captured["f0"], 0)
        self.assertEqual(captured["f1"], 90)
        self.assertEqual(captured["audio_impacts"], [])

    def test_audio_arm_passes_impacts_to_reconstruction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            point = _point(root)
            captured = {}

            def reconstruct(**kwargs):
                captured.update(kwargs)
                return _empty_reconstruction()

            result = run_point(
                point,
                root,
                arm="geometry_audio",
                track_runner=lambda *_args, **_kwargs: {
                    "segments": [],
                    "bounces": [],
                    "hits": [],
                },
                reconstruction_runner=reconstruct,
            )

        expected = [{"t": 0.2, "confidence": 4.0}]
        self.assertEqual(captured["audio_impacts"], expected)
        self.assertEqual(result["audio_impact_count"], 1)

    def test_motion_arm_cannot_claim_motion_before_it_is_available(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            point = _point(root)

            result = run_point(
                point,
                root,
                arm="geometry_audio_motion",
                track_runner=lambda *_args, **_kwargs: {
                    "segments": [],
                    "bounces": [],
                    "hits": [],
                },
                reconstruction_runner=_empty_reconstruction,
            )

        self.assertEqual(result["motion_status"], "not_implemented")
        self.assertFalse(result["motion_changed_decision"])


class ExperimentRunnerTests(unittest.TestCase):
    def test_run_id_cannot_overwrite_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases_path = root / "serve-cases.json"
            output_path = root / "serve-results-v1.json"
            cases_path.write_text(
                json.dumps({"version": 1, "cases": []})
            )
            output_path.write_text("{}")

            with self.assertRaises(FileExistsError):
                run_experiment(
                    cases_path,
                    output_path,
                    run_id="v1",
                )

    def test_experiment_records_all_local_ablation_arms(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            point = _point(root)
            cases_path = root / "serve-cases.json"
            output_path = root / "serve-results-v1.json"
            cases_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "cases": [
                            {
                                "case_key": "case-001",
                                "points": [point],
                            }
                        ],
                    }
                )
            )

            result = run_experiment(
                cases_path,
                output_path,
                run_id="v1",
                point_runner=lambda point, root, arm: {
                    "point_key": point["point_key"],
                    "arm": arm,
                    "status": "needs_review",
                    "server_side": None,
                    "wall_s": 0.01,
                },
                git_revision="a" * 40,
            )
            output_exists = output_path.is_file()

        self.assertEqual(
            set(result["arms"]),
            {
                "wrist_baseline",
                "geometry",
                "geometry_audio",
                "geometry_audio_motion",
            },
        )
        self.assertEqual(result["git_commit"], "a" * 40)
        self.assertEqual(result["run_id"], "v1")
        self.assertTrue(output_exists)


if __name__ == "__main__":
    unittest.main()
