import copy
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from worker.worker import (
    backfill_placement_for_match,
    run_blurball_only,
    run_placement_reconstruction,
)


MATCH_ID = "10000000-0000-0000-0000-000000000001"
READY = {
    "v": 3,
    "status": "ready",
    "candidates": [],
    "hypotheses": {},
}
REVIEW = {
    "v": 3,
    "status": "review",
    "candidates": [],
    "hypotheses": {},
}


def record_fixture():
    return {
        "match_id": MATCH_ID,
        "status": "ready",
        "input_path": "r2://ponglens-raw/user/source.mp4",
        "match_json_path": "r2://ponglens-media/points/user/match.json",
        "points": [
            {
                "idx": 1,
                "t0": 1.0,
                "t1": 2.0,
                "server": "user",
                "confirmed_winner": "user",
                "clip_path": "r2://ponglens-media/points/user/01.mp4",
                "placement": {"v": 2},
            },
            {
                "idx": 2,
                "t0": 3.0,
                "t1": 4.0,
                "server": "opponent",
                "confirmed_winner": None,
                "clip_path": "r2://ponglens-media/points/user/02.mp4",
                "placement": None,
            },
        ],
    }


def output_fixture():
    return {
        "placements": {"1": READY, "2": REVIEW},
        "match": {
            "version": 3,
            "points": [
                {"idx": 1, "t0": 1.0, "placement": READY},
                {"idx": 2, "t0": 3.0, "placement": REVIEW},
            ],
        },
    }


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params):
        normalized = " ".join(query.split())
        if not normalized.startswith("update public.points set placement"):
            raise AssertionError(f"unexpected SQL: {normalized}")
        payload, match_id, index = params
        self.rowcount = 0
        if match_id == MATCH_ID and int(index) in self.connection.pending:
            self.connection.pending[int(index)]["placement"] = json.loads(payload)
            self.rowcount = 1


class FakeConnection:
    def __init__(self, points):
        self.autocommit = True
        self.points = {
            int(point["idx"]): copy.deepcopy(point) for point in points
        }
        self.pending = copy.deepcopy(self.points)
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.points = copy.deepcopy(self.pending)
        self.commits += 1

    def rollback(self):
        self.pending = copy.deepcopy(self.points)
        self.rollbacks += 1


class SubprocessBoundaryTests(unittest.TestCase):
    def test_blurball_requires_the_output_file(self):
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "detections file"):
                run_blurball_only(
                    "source.mp4",
                    directory,
                    command_runner=lambda *args, **kwargs: None,
                )

    def test_reconstruction_subprocess_receives_authoritative_points(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            match_path = root / "match.json"
            video_path = root / "source.mp4"
            blurball_path = root / "blurball.jsonl"
            match_path.write_text("{}")
            video_path.write_bytes(b"source")
            blurball_path.write_text("")
            points = record_fixture()["points"]

            def fake_runner(command, **kwargs):
                points_path = Path(
                    command[command.index("--points-json") + 1]
                )
                self.assertEqual(
                    [point["idx"] for point in json.loads(points_path.read_text())],
                    [1, 2],
                )
                output_path = Path(command[command.index("--output") + 1])
                output_path.write_text(json.dumps(output_fixture()))

            result = run_placement_reconstruction(
                match_path,
                video_path,
                blurball_path,
                points,
                directory,
                command_runner=fake_runner,
            )

            self.assertEqual(set(result["placements"]), {"1", "2"})


class SingleMatchBackfillTests(unittest.TestCase):
    def setUp(self):
        self.record = record_fixture()
        self.connection = FakeConnection(self.record["points"])
        self.patches = [
            patch("worker.worker.load_backfill_record", return_value=self.record),
            patch(
                "worker.worker.download_backfill_inputs",
                return_value=(Path("source.mp4"), Path("match.json")),
            ),
            patch(
                "worker.worker.run_blurball_only",
                return_value=Path("blurball.jsonl"),
            ),
            patch(
                "worker.worker.run_placement_reconstruction",
                return_value=output_fixture(),
            ),
            patch("worker.worker.upload_match_json"),
            patch("worker.worker.verify_backfill"),
        ]
        self.mocks = [item.start() for item in self.patches]

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()

    def test_updates_only_placement_and_preserves_other_point_fields(self):
        before = copy.deepcopy(self.connection.points)

        result = backfill_placement_for_match(self.connection, MATCH_ID)

        self.assertEqual(result.point_count, 2)
        self.assertEqual(result.ready, 1)
        self.assertEqual(result.review, 1)
        self.assertEqual(result.unavailable, 0)
        self.assertEqual(self.connection.commits, 1)
        self.assertEqual(self.connection.points[1]["placement"], READY)
        self.assertEqual(self.connection.points[2]["placement"], REVIEW)
        for index in (1, 2):
            without_placement = {
                key: value
                for key, value in self.connection.points[index].items()
                if key != "placement"
            }
            expected = {
                key: value
                for key, value in before[index].items()
                if key != "placement"
            }
            self.assertEqual(without_placement, expected)

    def test_invalid_output_never_mutates_or_uploads(self):
        self.mocks[3].return_value = {
            "placements": {"1": READY},
            "match": {"version": 3, "points": [{"idx": 1}]},
        }
        before = copy.deepcopy(self.connection.points)

        with self.assertRaisesRegex(ValueError, "point indices"):
            backfill_placement_for_match(self.connection, MATCH_ID)

        self.assertEqual(self.connection.points, before)
        self.assertEqual(self.connection.commits, 0)
        self.mocks[4].assert_not_called()

    def test_upload_failure_rolls_back_database_placements(self):
        self.mocks[4].side_effect = RuntimeError("upload failed")
        before = copy.deepcopy(self.connection.points)

        with self.assertRaisesRegex(RuntimeError, "upload failed"):
            backfill_placement_for_match(self.connection, MATCH_ID)

        self.assertEqual(self.connection.points, before)
        self.assertEqual(self.connection.commits, 0)
        self.assertEqual(self.connection.rollbacks, 1)


if __name__ == "__main__":
    unittest.main()
