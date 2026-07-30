import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

from worker.eval.materialize_table_calibration_cases import (
    EXPERIMENT_MATCH_IDS,
    _placement_activity_core,
    _write_placement_activity_detections,
    choose_control_match,
    load_match_truth,
    load_pricing_snapshot,
    materialize_case,
    prepare_explicit_cases,
    validate_control_case,
)


class PlacementActivityCoreTests(unittest.TestCase):
    def test_core_uses_left_right_top_bottom_contract(self):
        match = {
            "points": [
                {
                    "placement": {
                        "candidates": [
                            {"x": x, "y": y}
                            for x, y in (
                                (100, 300),
                                (120, 280),
                                (140, 260),
                                (160, 240),
                                (180, 220),
                            )
                        ]
                    }
                }
            ]
        }

        left, right, top, bottom = _placement_activity_core(match)

        self.assertLess(left, right)
        self.assertLess(top, bottom)
        self.assertLess(right, top)

    def test_stored_candidates_can_back_spatial_validation(self):
        match = {
            "points": [
                {
                    "placement": {
                        "candidates": [
                            {"x": 101, "y": 202},
                            {"x": None, "y": 9},
                        ]
                    }
                }
            ]
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "activity.jsonl"

            self.assertTrue(
                _write_placement_activity_detections(match, output)
            )
            self.assertEqual(
                json.loads(output.read_text().strip()),
                {"f": 0, "x": 101.0, "y": 202.0},
            )


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.sql = ""
        self.parameters = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, parameters=None):
        self.sql = " ".join(sql.split())
        self.parameters = parameters

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _Connection:
    def __init__(self, rows):
        self.cursor_instance = _Cursor(rows)
        self.commit = Mock()

    def cursor(self, **_kwargs):
        return self.cursor_instance


class ControlSelectionTests(unittest.TestCase):
    def test_explicit_control_must_be_ready_and_visually_distinct(self):
        failed = {
            "match_id": "failed",
            "images": [{"sha256": "same"}],
            "truth": {"existing_structure": {"status": "failed"}},
        }
        control = {
            "match_id": "control",
            "images": [{"sha256": "same"}],
            "truth": {"existing_structure": {"status": "ready"}},
        }

        with self.assertRaisesRegex(RuntimeError, "distinct"):
            validate_control_case([failed, control], "control")

        control["images"][0]["sha256"] = "different"
        validate_control_case([failed, control], "control")

        control["truth"]["existing_structure"]["status"] = "failed"
        with self.assertRaisesRegex(RuntimeError, "RTMPose-ready"):
            validate_control_case([failed, control], "control")

    def test_control_requires_recent_retained_ready_structure_match(self):
        connection = _Connection([("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",)])

        selected = choose_control_match(connection, EXPERIMENT_MATCH_IDS)

        self.assertEqual(
            selected,
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        )
        sql = connection.cursor_instance.sql
        self.assertIn("match_structure->>'status' = 'ready'", sql)
        self.assertIn("j.created_at >= now() - interval '7 days'", sql)
        self.assertIn("j.input_path is not null", sql)
        self.assertEqual(
            connection.cursor_instance.parameters,
            (list(EXPERIMENT_MATCH_IDS),),
        )
        connection.commit.assert_not_called()

    def test_script_runs_directly_without_importing_worker_daemon(self):
        script = (
            Path(__file__).resolve().parents[1]
            / "eval"
            / "materialize_table_calibration_cases.py"
        )

        result = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("prepare", result.stdout)


class PricingTests(unittest.TestCase):
    def test_pricing_snapshot_requires_all_three_token_rates(self):
        rows = [
            (
                "input_token",
                0.000005,
                "2026-07-01T00:00:00+00:00",
                "https://example.test/input",
                "input price",
            ),
            (
                "cached_input_token",
                0.0000005,
                "2026-07-01T00:00:00+00:00",
                "https://example.test/cached",
                "cached price",
            ),
            (
                "output_token",
                0.00003,
                "2026-07-01T00:00:00+00:00",
                "https://example.test/output",
                "output price",
            ),
        ]
        connection = _Connection(rows)

        snapshot = load_pricing_snapshot(connection, "gpt-5.6-sol")

        self.assertEqual(snapshot["model"], "gpt-5.6-sol")
        self.assertEqual(snapshot["rates"]["input_token"]["price"], 0.000005)
        self.assertEqual(
            set(snapshot["rates"]),
            {"input_token", "cached_input_token", "output_token"},
        )
        connection.commit.assert_not_called()


class MatchTruthTests(unittest.TestCase):
    def test_match_truth_is_read_without_identity_fields(self):
        connection = _Connection(
            [
                (
                    "user",
                    "user",
                    "near",
                    {
                        "status": "ready",
                        "first_server": {
                            "status": "high_confidence",
                            "side": "near",
                        },
                    },
                )
            ]
        )

        truth = load_match_truth(connection, EXPERIMENT_MATCH_IDS[0])

        self.assertEqual(
            truth,
            {
                "first_server": "user",
                "first_server_source": "user",
                "user_side": "near",
                "existing_structure": {
                    "status": "ready",
                    "first_server": {
                        "status": "high_confidence",
                        "side": "near",
                    },
                },
            },
        )
        connection.commit.assert_not_called()


class MaterializationTests(unittest.TestCase):
    def test_explicit_preparation_deduplicates_and_preserves_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            connection = Mock()
            runtime = Mock()
            runtime.connect.return_value = connection

            def fake_case(_connection, match_id, output_dir):
                self.assertIs(_connection, connection)
                Path(output_dir).mkdir(parents=True, exist_ok=True)
                return {
                    "match_id": match_id,
                    "source_size": [640, 360],
                    "image_size": [320, 180],
                    "images": [
                        {"path": f"images/{index}.jpg", "sha256": str(index)}
                        for index in range(3)
                    ],
                }

            with (
                patch(
                    "worker.eval.materialize_table_calibration_cases."
                    "_default_runtime",
                    return_value=runtime,
                ),
                patch(
                    "worker.eval.materialize_table_calibration_cases."
                    "materialize_case",
                    side_effect=fake_case,
                ),
                patch(
                    "worker.eval.materialize_table_calibration_cases."
                    "load_pricing_snapshot",
                    return_value={"model": "gpt-5.6-sol", "rates": {}},
                ),
                patch(
                    "worker.eval.materialize_table_calibration_cases."
                    "choose_control_match",
                ) as choose_control,
            ):
                payload = prepare_explicit_cases(
                    root,
                    ["m-chris-1", "m-chris-2", "m-chris-1"],
                    model="gpt-5.6-sol",
                )

            self.assertEqual(
                [case["match_id"] for case in payload["cases"]],
                ["m-chris-1", "m-chris-2"],
            )
            self.assertEqual(payload["selection"], "explicit")
            self.assertEqual(
                [case["role"] for case in payload["cases"]],
                ["paired_target", "paired_target"],
            )
            self.assertEqual(
                json.loads((root / "cases.json").read_text()),
                payload,
            )
            choose_control.assert_not_called()
            connection.close.assert_called_once_with()

    def test_explicit_preparation_rejects_an_empty_match_list(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "at least one"):
                prepare_explicit_cases(Path(directory), [])

    def test_materialization_is_local_and_omits_identity_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = {
                "match_id": EXPERIMENT_MATCH_IDS[0],
                "user_id": "private-user",
                "status": "ready",
                "input_path": "r2://raw/source.mp4",
                "match_json_path": "r2://media/match.json",
                "points": [
                    {
                        "id": "point-1",
                        "idx": 1,
                        "t0": 1.0,
                        "t1": 2.0,
                        "clip_path": "r2://media/01.mp4",
                        "confirmed_winner": "user",
                        "is_let": False,
                        "game_end_override": None,
                        "server_override": None,
                        "opponent_name": "private-opponent",
                    }
                ],
            }

            def download_inputs(_record, output):
                output = Path(output)
                source = output / "source.mp4"
                source.write_bytes(b"source")
                match = output / "match.json"
                match.write_text(
                    json.dumps(
                        {
                            "source": {
                                "width": 640,
                                "height": 360,
                                "fps": 30,
                            },
                            "points": [{"idx": 1, "t0": 1.0, "t1": 2.0}],
                        }
                    )
                )
                return source, match

            def download_object(uri, destination):
                self.assertEqual(uri, "r2://media/01.mp4")
                Path(destination).write_bytes(b"clip")

            def blurball_runner(_source, output):
                path = Path(output) / "blurball.jsonl"
                path.write_text('{"f":1,"x":150,"y":90}\n')
                return path

            def frame_selector(_source, output):
                paths = []
                for name in (
                    "background.jpg",
                    "representative-1.jpg",
                    "representative-2.jpg",
                ):
                    path = Path(output) / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(
                        str(path),
                        np.zeros((180, 320, 3), dtype=np.uint8),
                    )
                    paths.append(path)
                return paths

            connection = _Connection([])
            manifest = materialize_case(
                connection,
                EXPERIMENT_MATCH_IDS[0],
                root,
                load_record=lambda _conn, _match_id: record,
                download_inputs=download_inputs,
                download_object=download_object,
                blurball_runner=blurball_runner,
                frame_selector=frame_selector,
                truth_loader=lambda _conn, _match_id: {
                    "first_server": "user",
                    "first_server_source": "user",
                    "user_side": "near",
                    "existing_structure": {"status": "failed"},
                },
            )

            serialized = json.dumps(manifest)
            self.assertNotIn("private-user", serialized)
            self.assertNotIn("private-opponent", serialized)
            self.assertNotIn("r2://", serialized)
            self.assertEqual(manifest["source_size"], [640, 360])
            self.assertEqual(manifest["image_size"], [320, 180])
            self.assertEqual(
                manifest["points"],
                [
                    {
                        "idx": 1,
                        "id": "point-1",
                        "t0": 1.0,
                        "t1": 2.0,
                        "confirmed_winner": "user",
                        "is_let": False,
                        "game_end_override": None,
                        "server_override": None,
                    }
                ],
            )
            self.assertEqual(len(manifest["images"]), 3)
            self.assertEqual(manifest["truth"]["first_server"], "user")
            for image in manifest["images"]:
                path = root / image["path"]
                self.assertEqual(
                    image["sha256"],
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
            self.assertTrue((root / "clips" / "point-001.mp4").is_file())
            connection.commit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
