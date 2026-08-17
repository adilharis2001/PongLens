import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import cv2
import numpy as np

from worker.placement_backfill import (
    calibration_matrix,
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
    def test_calibration_matrix_canonicalizes_reversed_winding(self):
        forward = {
            "table_corners_px": {
                "A_near_1": [100.0, 300.0],
                "B_near_2": [500.0, 300.0],
                "C_far_2": [420.0, 100.0],
                "D_far_1": [180.0, 100.0],
            }
        }
        reversed_winding = {
            "table_corners_px": {
                "A_near_1": [500.0, 300.0],
                "B_near_2": [100.0, 300.0],
                "C_far_2": [180.0, 100.0],
                "D_far_1": [420.0, 100.0],
            }
        }
        point = np.asarray([[[250.0, 210.0]]], dtype=np.float32)

        expected = cv2.perspectiveTransform(
            point,
            calibration_matrix(forward),
        )
        actual = cv2.perspectiveTransform(
            point,
            calibration_matrix(reversed_winding),
        )

        np.testing.assert_allclose(actual, expected)

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
        # Both points exist in the artifact: match.json owns which points
        # there ARE, the points table owns what they say. A database row
        # with no artifact point is a loud failure downstream, not a silent
        # addition — see MergeKeepsTheArtifactAnArtifactTest.
        match = copy.deepcopy(MATCH)
        match["points"].append({
            "idx": 2, "t0": 2.0, "t1": 3.0, "clip": "points/02.mp4",
            "server": "user", "placement": {"v": 2, "bounces": []},
        })
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

        merged = merge_match_placements(match, database_points, placements)

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

    @patch("worker.placement_backfill.keypoint_calibrate")
    def test_failed_saved_calibration_is_recomputed(self, keypoint_calibrate):
        """Recomputed with the keypoint detector, not the pink-rim one.

        A backfill exists to repair matches whose quads were wrong, and the
        pink calibrator is what got most of them wrong — 3.50% median corner
        error, 20 gross failures in 50. Recomputing with it would reproduce
        the defect the backfill is there to fix.
        """
        recovered = {
            "H": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            "e": [0.0, 1.0],
            "corners_px": VALID_CALIBRATION["table_corners_px"],
            "note": "recovered",
        }
        keypoint_calibrate.return_value = recovered

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
            two_point_match = copy.deepcopy(MATCH)
            two_point_match["points"].append({
                "idx": 2, "t0": 2.0, "t1": 3.0, "clip": "points/02.mp4",
                "server": "user", "placement": {"v": 2, "bounces": []},
            })
            match_path.write_text(json.dumps(two_point_match))
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


class MergeKeepsTheArtifactAnArtifactTest(unittest.TestCase):
    """match.json is the pipeline's output, not a copy of the points table.

    merge_match_placements used to copy the whole database row over each
    point, which wrote two dozen app-owned columns — deleted, starred,
    confirmed_winner, scored_at_cut_s — into the artifact. The
    placement-only guard in worker.py then refused the result, correctly,
    because the points had changed outside placement, and every placement
    generation and retry failed from the day the points table outgrew
    match.json's own fields.
    """

    def test_database_only_columns_stay_out_of_the_artifact(self):
        database_points = [{
            "idx": 1, "t0": 1.25, "t1": 2.25, "server": "opponent",
            "deleted": False, "starred": True, "confirmed_winner": "user",
            "scored_at_cut_s": 12.5, "warmup": False, "clip_path": "x.mp4",
        }]
        merged = merge_match_placements(
            MATCH, database_points, {1: {"v": 3, "status": "ready"}})
        point = merged["points"][0]
        for column in ("deleted", "starred", "confirmed_winner",
                       "scored_at_cut_s", "warmup", "clip_path"):
            self.assertNotIn(column, point, column)

    def test_the_merged_point_survives_the_placement_only_guard(self):
        """The guard is the thing that was firing; pin it directly."""
        from worker.worker import validate_placement_only_match_update

        database_points = [{
            "idx": 1, "t0": 1.25, "t1": 2.25, "server": "opponent",
            "deleted": False, "starred": True, "scored_at_cut_s": 4.5,
        }]
        merged = merge_match_placements(
            MATCH, database_points, {1: {"v": 3, "status": "ready"}})

        original = copy.deepcopy(MATCH)
        # The database's own timings win, so mirror them into the artifact
        # before comparing — that part is intended and is not what broke.
        for point, row in zip(original["points"], database_points):
            point.update({k: v for k, v in row.items() if k in point})
        validate_placement_only_match_update(original, merged)

    def test_the_database_still_wins_on_shared_fields(self):
        database_points = [{
            "idx": 1, "t0": 9.75, "t1": 11.5, "server": "opponent",
            "deleted": False,
        }]
        merged = merge_match_placements(
            MATCH, database_points, {1: {"v": 3, "status": "ready"}})
        self.assertEqual(merged["points"][0]["t0"], 9.75)
        self.assertEqual(merged["points"][0]["server"], "opponent")
        # and a field only match.json has is still there
        self.assertEqual(merged["points"][0]["clip"], "points/01.mp4")

    def test_the_version_may_rise_to_three_but_not_beyond_or_back(self):
        """Writing v3 placement into a v2 match legitimately raises the
        document version, and the guard used to refuse that too — so an
        older match could never be given placement maps at all."""
        from worker.worker import validate_placement_only_match_update

        v2 = {"version": 2, "points": []}
        validate_placement_only_match_update(v2, {"version": 3, "points": []})
        validate_placement_only_match_update(v2, {"version": 2, "points": []})
        with self.assertRaisesRegex(ValueError, "version"):
            validate_placement_only_match_update(
                {"version": 3, "points": []}, {"version": 2, "points": []})
        with self.assertRaisesRegex(ValueError, "version"):
            validate_placement_only_match_update(v2, {"version": 9, "points": []})

    def test_an_edited_away_point_keeps_its_place_in_the_artifact(self):
        """Extending a point over its neighbour merges the two, and the
        swallowed one leaves the points table while match.json goes on
        listing it. Rebuilding the artifact's point list from the database
        dropped it — a change well outside a placement job's remit, and the
        guard said so, which is why no match the owner had edited that way
        could be given placement maps.
        """
        from worker.worker import validate_placement_only_match_update

        match = copy.deepcopy(MATCH)
        match["points"].append({
            "idx": 2, "t0": 3.0, "t1": 4.0, "clip": "points/02.mp4",
            "server": "user", "placement": {"v": 2, "bounces": []},
        })
        # Point 2 was absorbed by an edit and no longer has a row.
        database_points = [{"idx": 1, "t0": 1.0, "t1": 2.0, "server": "user",
                            "deleted": False}]

        merged = merge_match_placements(
            match, database_points, {1: {"v": 3, "status": "ready"}})

        self.assertEqual([p["idx"] for p in merged["points"]], [1, 2])
        self.assertEqual(merged["points"][0]["placement"]["v"], 3)
        # untouched, still carrying whatever it had
        self.assertEqual(
            merged["points"][1]["placement"], {"v": 2, "bounces": []})
        validate_placement_only_match_update(match, merged)

    def test_a_retimed_point_may_sync_but_the_clip_may_not_move(self):
        """The points table owns the window; the pipeline owns the clip."""
        from worker.worker import validate_placement_only_match_update

        database_points = [{"idx": 1, "t0": 9.75, "t1": 11.5,
                            "server": "opponent", "deleted": False}]
        merged = merge_match_placements(
            MATCH, database_points, {1: {"v": 3, "status": "ready"}})
        validate_placement_only_match_update(MATCH, merged)

        tampered = copy.deepcopy(merged)
        tampered["points"][0]["clip"] = "points/99.mp4"
        with self.assertRaisesRegex(ValueError, "non-placement"):
            validate_placement_only_match_update(MATCH, tampered)

    def test_the_two_field_lists_have_not_drifted(self):
        """The guard must ignore exactly what the merge syncs, no more."""
        from worker.placement_backfill import ARTIFACT_POINT_FIELDS
        from worker.worker import DATABASE_SYNCED_POINT_FIELDS

        self.assertTrue(DATABASE_SYNCED_POINT_FIELDS < ARTIFACT_POINT_FIELDS)
        self.assertEqual(
            ARTIFACT_POINT_FIELDS - DATABASE_SYNCED_POINT_FIELDS,
            {"idx", "clip", "clip_t0", "clip_t1", "server_side"},
        )
