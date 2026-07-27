import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from worker.placement_backfill import (
    load_detections,
    merge_match_placements,
    recover_calibration,
    reconstruct_files,
    reconstruct_existing_match,
    unavailable_placement,
    validate_placements,
)


VALID_CALIBRATION = {
    "ok": True,
    "table_corners_px": {
        "A_near_1": [0.0, 100.0],
        "B_near_2": [100.0, 100.0],
        "C_far_2": [100.0, 0.0],
        "D_far_1": [0.0, 0.0],
    },
    "length_axis": [0.0, 1.0],
}

MATCH = {
    "version": 2,
    "source": {"fps": 30.0, "width": 1920},
    "side_mapping": {"user": "near"},
    "calibration": VALID_CALIBRATION,
    "points": [
        {
            "idx": 1,
            "t0": 1.0,
            "t1": 2.0,
            "clip": "points/01.mp4",
            "server": "user",
            "placement": {"v": 2, "bounces": []},
        }
    ],
}


class PlacementValidationTests(unittest.TestCase):
    def test_rejects_missing_point_index(self):
        with self.assertRaisesRegex(ValueError, "point indices"):
            validate_placements([1, 2], {1: {"v": 3}})

    def test_rejects_duplicate_existing_point_index(self):
        with self.assertRaisesRegex(ValueError, "point indices"):
            validate_placements([1, 1], {1: {"v": 3}})

    def test_rejects_non_v3_payload(self):
        with self.assertRaisesRegex(ValueError, "v=3"):
            validate_placements([1], {1: {"v": 2}})

    def test_merge_uses_database_points_and_preserves_json_only_fields(self):
        database_points = [
            {
                "idx": 1,
                "t0": 1.25,
                "t1": 2.25,
                "server": "opponent",
                "deleted": False,
            },
            {
                "idx": 2,
                "t0": 2.5,
                "t1": 3.5,
                "server": None,
                "deleted": False,
            },
        ]
        placements = {
            1: {"v": 3, "status": "ready"},
            2: {"v": 3, "status": "review"},
        }

        merged = merge_match_placements(MATCH, database_points, placements)

        self.assertEqual([point["idx"] for point in merged["points"]], [1, 2])
        self.assertEqual(merged["points"][0]["clip"], "points/01.mp4")
        self.assertEqual(merged["points"][0]["t0"], 1.25)
        self.assertEqual(merged["points"][0]["server"], "opponent")
        self.assertEqual(merged["points"][1]["placement"]["status"], "review")
        self.assertEqual(MATCH["points"][0]["t0"], 1.0)
        self.assertEqual(MATCH["points"][0]["placement"]["v"], 2)

    def test_unavailable_payload_is_valid_for_both_server_sides(self):
        placement = unavailable_placement("calibration_failed")

        validate_placements([4], {4: placement})
        self.assertEqual(placement["status"], "unavailable")
        self.assertEqual(set(placement["hypotheses"]), {"near", "far"})
        for side, hypothesis in placement["hypotheses"].items():
            self.assertEqual(hypothesis["serverSide"], side)
            self.assertEqual(hypothesis["server_side"], side)
            self.assertEqual(hypothesis["status"], "unavailable")
            self.assertEqual(hypothesis["shots"], [])
            self.assertEqual(hypothesis["used_event_ids"], [])
            self.assertIn("calibration_failed", hypothesis["hard_reasons"])


class ExistingMatchReconstructionTests(unittest.TestCase):
    def test_missing_calibration_suppresses_every_point(self):
        points = [
            {"idx": 1, "t0": 1.0, "t1": 2.0},
            {"idx": 2, "t0": 3.0, "t1": 4.0},
        ]

        placements = reconstruct_existing_match(
            MATCH,
            points,
            detections={},
            calibration=None,
        )

        self.assertEqual(set(placements), {1, 2})
        self.assertTrue(
            all(item["status"] == "unavailable" for item in placements.values())
        )

    @patch("worker.placement_backfill.reconstruct_placement")
    @patch("worker.placement_backfill.fit_play")
    def test_uses_database_range_and_point_scoped_audio(
        self,
        fit_play,
        reconstruct_placement,
    ):
        fit_play.return_value = {"segments": [], "bounces": [], "hits": []}
        reconstruct_placement.return_value = {
            "v": 3,
            "status": "ready",
            "candidates": [],
            "hypotheses": {},
        }
        database_points = [
            {
                "idx": 7,
                "t0": 1.0,
                "t1": 2.0,
                "suggestion": {"winner": "user"},
            }
        ]
        detections = {
            29: (1.0, 1.0),
            30: (10.0, 10.0),
            59: (20.0, 20.0),
            61: (30.0, 30.0),
        }
        impacts = [
            {"t": 0.9, "confidence": 0.9},
            {"t": 1.5, "confidence": 0.8},
            {"t": 2.1, "confidence": 0.7},
        ]

        placements = reconstruct_existing_match(
            MATCH,
            database_points,
            detections,
            VALID_CALIBRATION,
            impacts,
        )

        self.assertEqual(placements[7]["v"], 3)
        point_detections = fit_play.call_args.args[0]
        self.assertEqual(set(point_detections), {30, 59})
        call = reconstruct_placement.call_args
        self.assertEqual(call.args[5:7], (30, 61))
        self.assertEqual(call.args[4], {"winner": "user"})
        self.assertEqual(call.args[9], [{"t": 1.5, "confidence": 0.8}])

    @patch("worker.placement_backfill.calibrate")
    def test_failed_saved_calibration_is_recomputed(self, calibrate):
        recovered = {
            "H": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            "e": [0.0, 1.0],
            "corners_px": VALID_CALIBRATION["table_corners_px"],
            "note": "recovered",
        }
        calibrate.return_value = recovered

        result = recover_calibration(
            {"source": MATCH["source"], "calibration": {"ok": False}},
            "source.mp4",
            {1: (10.0, 20.0)},
            "workdir",
        )

        self.assertIs(result.runtime, recovered)
        self.assertEqual(result.stored["ok"], True)
        self.assertEqual(result.stored["length_axis"], [0.0, 1.0])
        self.assertEqual(
            result.stored["table_corners_px"],
            VALID_CALIBRATION["table_corners_px"],
        )

    @patch("worker.placement_backfill.reconstruct_existing_match")
    def test_reconstruct_files_writes_database_authoritative_result(
        self,
        reconstruct,
    ):
        placement = unavailable_placement("test")
        reconstruct.return_value = {1: placement, 2: placement}
        with TemporaryDirectory() as directory:
            root = Path(directory)
            match_path = root / "match.json"
            points_path = root / "points.json"
            blurball_path = root / "blurball.jsonl"
            output_path = root / "result.json"
            video_path = root / "source.mp4"
            match_path.write_text(json.dumps(MATCH))
            points_path.write_text(
                json.dumps(
                    [
                        {"idx": 1, "t0": 1.0, "t1": 2.0},
                        {"idx": 2, "t0": 2.0, "t1": 3.0},
                    ]
                )
            )
            blurball_path.write_text("")
            video_path.write_bytes(b"source")

            reconstruct_files(
                match_path,
                points_path,
                blurball_path,
                video_path,
                output_path,
            )

            result = json.loads(output_path.read_text())
            self.assertEqual(set(result["placements"]), {"1", "2"})
            self.assertEqual(
                [point["idx"] for point in result["match"]["points"]],
                [1, 2],
            )
            self.assertEqual(result["match"]["points"][1]["placement"]["v"], 3)


class DetectionLoadingTests(unittest.TestCase):
    def test_load_detections_ignores_records_without_coordinates(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "blurball.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps({"f": 1, "x": 10, "y": 20}),
                        json.dumps({"f": 2, "x": None, "y": None}),
                    ]
                )
                + "\n"
            )

            self.assertEqual(load_detections(path), {1: (10.0, 20.0)})


if __name__ == "__main__":
    unittest.main()
