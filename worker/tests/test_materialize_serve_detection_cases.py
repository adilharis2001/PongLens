import json
import tempfile
import unittest
from pathlib import Path

from worker.eval.materialize_serve_detection_cases import (
    freeze_input_hash,
    materialize_cases,
    resolve_inside,
)


def _write_fixture(root: Path) -> None:
    case_root = root / "cases" / "private-match-id"
    clips = case_root / "clips"
    clips.mkdir(parents=True)
    (clips / "point-001.mp4").write_bytes(b"fake clip bytes")
    (case_root / "blurball.jsonl").write_text(
        "\n".join(
            [
                json.dumps(
                    {"f": 59, "x": 900.0, "y": 500.0, "conf": 2.0}
                ),
                json.dumps(
                    {"f": 60, "x": 960.0, "y": 540.0, "conf": 5.0}
                ),
                json.dumps(
                    {"f": 75, "x": 1200.0, "y": 600.0, "conf": 4.0}
                ),
                json.dumps(
                    {"f": 91, "x": 1000.0, "y": 550.0, "conf": 3.0}
                ),
            ]
        )
        + "\n"
    )
    (case_root / "match.json").write_text(
        json.dumps(
            {
                "source": {
                    "fps": 30.0,
                    "width": 1920,
                    "height": 1080,
                    "duration": 100.0,
                },
                "points": [
                    {
                        "idx": 1,
                        "t0": 2.2,
                        "t1": 2.8,
                        "clip_t0": 2.0,
                        "clip_t1": 3.0,
                    }
                ],
            }
        )
    )
    (root / "cases.json").write_text(
        json.dumps(
            {
                "version": 1,
                "cases": [
                    {
                        "match_id": "private-match-id",
                        "root": "cases/private-match-id",
                        "source_size": [1920, 1080],
                        "image_size": [1600, 900],
                        "blurball": "blurball.jsonl",
                        "clips": "clips",
                        "match_json": "match.json",
                        "truth": {
                            "first_server": "user",
                            "user_side": "near",
                        },
                        "points": [
                            {
                                "idx": 1,
                                "t0": 2.2,
                                "t1": 2.8,
                                "confirmed_winner": "user",
                            }
                        ],
                    }
                ],
            }
        )
    )
    (root / "evaluated-results.json").write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "match_id": "private-match-id",
                        "calibration": {
                            "accepted": True,
                            "corners": [
                                [400.0, 500.0],
                                [700.0, 600.0],
                                [1000.0, 400.0],
                                [800.0, 350.0],
                            ],
                        },
                    }
                ]
            }
        )
    )


class PathTests(unittest.TestCase):
    def test_rejects_paths_outside_the_experiment_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            with self.assertRaisesRegex(ValueError, "escapes"):
                resolve_inside(root, "../private.mp4")


class MaterializerTests(unittest.TestCase):
    def test_scales_calibration_and_localizes_ball_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "table"
            output = Path(directory) / "serve"
            root.mkdir()
            _write_fixture(root)

            result = materialize_cases(
                root,
                output,
                probe_clip=lambda _path: {
                    "fps": 30.0,
                    "frame_count": 30,
                    "width": 1280,
                    "height": 720,
                    "duration": 1.0,
                },
                audio_runner=lambda _path: [
                    {"t": 0.2, "confidence": 4.0}
                ],
            )

            point = result["cases"][0]["points"][0]
            ball_path = output / point["ball_path"]
            ball = [
                json.loads(line)
                for line in ball_path.read_text().splitlines()
            ]
            audio = json.loads(
                (output / point["audio_path"]).read_text()
            )
            clip_exists = (output / point["clip_path"]).is_file()

        self.assertEqual(point["calibration_size"], [1280, 720])
        self.assertEqual(
            point["table_corners"][0],
            [320.0, 400.0],
        )
        self.assertEqual([row["f"] for row in ball], [0, 15])
        self.assertEqual(ball[0]["x"], 640.0)
        self.assertEqual(ball[0]["y"], 360.0)
        self.assertEqual(audio, [{"t": 0.2, "confidence": 4.0}])
        self.assertTrue(clip_exists)

    def test_manifest_and_reference_template_hide_scoring_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "table"
            output = Path(directory) / "serve"
            root.mkdir()
            _write_fixture(root)

            result = materialize_cases(
                root,
                output,
                probe_clip=lambda _path: {
                    "fps": 30.0,
                    "frame_count": 30,
                    "width": 1280,
                    "height": 720,
                    "duration": 1.0,
                },
                audio_runner=lambda _path: [],
            )
            serialized = json.dumps(result)
            reference = json.loads(
                (output / "references.template.json").read_text()
            )

        self.assertNotIn("private-match-id", serialized)
        self.assertNotIn("first_server", serialized)
        self.assertNotIn("confirmed_winner", serialized)
        self.assertNotIn("user_side", serialized)
        self.assertEqual(result["cases"][0]["case_key"], "case-001")
        self.assertEqual(
            reference["points"][0],
            {
                "point_key": "case-001-point-001",
                "serve_contact_t": None,
                "server_side": None,
                "visibility": None,
                "first_bounce_visible": None,
                "second_bounce_visible": None,
                "hard_negatives": [],
                "note": "",
            },
        )

    def test_input_lock_rejects_a_mutated_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "serve-cases.json"
            lock = root / "serve-input-lock.json"
            manifest.write_text('{"version":1}\n')

            first = freeze_input_hash(manifest, lock)
            manifest.write_text('{"version":2}\n')

            with self.assertRaisesRegex(ValueError, "inputs changed"):
                freeze_input_hash(manifest, lock)
            self.assertEqual(
                json.loads(lock.read_text())["sha256"],
                first,
            )


if __name__ == "__main__":
    unittest.main()
