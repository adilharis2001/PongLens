import copy
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from worker.worker import (
    backfill_placement_for_match,
    map_structure_point_ids,
    resolved_detected_first_server,
    run_match_structure_stage,
    run_blurball_only,
    run_placement_reconstruction,
    validate_backfill_output,
    validate_stored_match,
)


MATCH_ID = "10000000-0000-0000-0000-000000000001"


def placement_fixture(status):
    hypotheses = {}
    for side in ("near", "far"):
        hypotheses[side] = {
            "serverSide": side,
            "server_side": side,
            "status": status,
            "confidence": 0.8 if status == "ready" else 0.6,
            "score": 1.0,
            "reasons": [],
            "hard_reasons": [],
            "shots": [],
            "used_event_ids": [],
        }
    return {
        "v": 3,
        "status": status,
        "candidates": [],
        "hypotheses": hypotheses,
    }


READY = placement_fixture("ready")
REVIEW = placement_fixture("review")


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
    ready = copy.deepcopy(READY)
    review = copy.deepcopy(REVIEW)
    return {
        "placements": {"1": ready, "2": review},
        "match": {
            "version": 3,
            "points": [
                {"idx": 1, "t0": 1.0, "placement": ready},
                {"idx": 2, "t0": 3.0, "placement": review},
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
        self.connection.placement_binds.append(
            (payload, match_id, int(index))
        )
        self.rowcount = 0
        if match_id == MATCH_ID and int(index) in self.connection.pending:
            self.connection.pending[int(index)]["placement"] = (
                None if payload is None else json.loads(payload)
            )
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
        self.placement_binds = []

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.points = copy.deepcopy(self.pending)
        self.commits += 1

    def rollback(self):
        self.pending = copy.deepcopy(self.points)
        self.rollbacks += 1


class MatchStructurePersistenceTests(unittest.TestCase):
    def test_evidence_maps_indices_to_stable_ids(self):
        evidence = {
            "points": [
                {
                    "idx": 3,
                    "assignment": {"status": "unavailable"},
                }
            ],
            "end_changes": [
                {
                    "after_idx": 3,
                    "before_idx": 4,
                    "confirmed_at_idx": 5,
                }
            ],
        }

        mapped = map_structure_point_ids(
            evidence,
            {
                3: {"id": "p3", "t0": 10.0, "t1": 11.0},
                4: {"id": "p4", "t0": 12.0, "t1": 13.0},
                5: {"id": "p5", "t0": 14.0, "t1": 15.0},
            },
        )

        self.assertEqual(mapped["points"][0]["point_id"], "p3")
        self.assertEqual(
            mapped["end_changes"][0]["after_point_id"],
            "p3",
        )
        self.assertEqual(
            mapped["end_changes"][0]["before_point_id"],
            "p4",
        )
        self.assertEqual(
            mapped["end_changes"][0]["confirmed_at_point_id"],
            "p5",
        )

    def test_detected_first_server_maps_through_user_side(self):
        evidence = {
            "first_server": {
                "status": "high_confidence",
                "side": "near",
            }
        }

        self.assertEqual(
            resolved_detected_first_server(evidence, "near"),
            "user",
        )
        self.assertEqual(
            resolved_detected_first_server(evidence, "far"),
            "opponent",
        )

    def test_withheld_server_never_creates_a_match_anchor(self):
        evidence = {
            "first_server": {
                "status": "withheld",
                "side": None,
            }
        }

        self.assertIsNone(
            resolved_detected_first_server(evidence, "near")
        )

    @patch("worker.worker.MATCH_STRUCTURE_ENABLED", False)
    def test_disabled_structure_stage_does_nothing(self):
        self.assertIsNone(
            run_match_structure_stage(
                "ball.jsonl",
                "match.json",
                "points-out",
                "work",
            )
        )

    @patch("worker.worker.MATCH_STRUCTURE_ENABLED", True)
    @patch("worker.worker.subprocess.run")
    def test_structure_command_failure_is_fail_open(self, run):
        run.side_effect = RuntimeError("model missing")

        result = run_match_structure_stage(
            "ball.jsonl",
            "match.json",
            "points-out",
            "work",
        )

        self.assertEqual(result["status"], "failed")
        self.assertEqual(
            result["algorithm"],
            "rtmpose-match-structure-v1",
        )


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


class OutputSchemaTests(unittest.TestCase):
    @staticmethod
    def valid_event(event_id, *, u, v):
        return {
            "event_id": event_id,
            "confidence": 0.8,
            "t": 1.0,
            "u": u,
            "v": v,
        }

    @classmethod
    def add_valid_shots(cls, payload):
        for server_side in ("near", "far"):
            receiver_side = "far" if server_side == "near" else "near"
            own_v = 0.6 if server_side == "near" else 2.1
            receiver_v = 2.1 if server_side == "near" else 0.6
            payload["hypotheses"][server_side]["shots"] = [
                {
                    "id": f"{server_side}-shot-1",
                    "seq": 1,
                    "phase": "serve",
                    "hitter_side": server_side,
                    "contact_t": 0.8,
                    "confidence": 0.8,
                    "contact": None,
                    "serve_first_bounce": cls.valid_event(
                        f"{server_side}-first",
                        u=0.5,
                        v=own_v,
                    ),
                    "landing": cls.valid_event(
                        f"{server_side}-second",
                        u=0.7,
                        v=receiver_v,
                    ),
                    "terminal": None,
                },
                {
                    "id": f"{server_side}-shot-2",
                    "seq": 2,
                    "phase": "rally",
                    "hitter_side": receiver_side,
                    "contact_t": 1.4,
                    "confidence": 0.8,
                    "contact": None,
                    "serve_first_bounce": None,
                    "landing": cls.valid_event(
                        f"{server_side}-return",
                        u=0.8,
                        v=own_v,
                    ),
                    "terminal": None,
                },
            ]

    def test_rejects_v3_marker_without_both_hypotheses(self):
        record = record_fixture()
        malformed = output_fixture()
        malformed["placements"]["1"] = {
            "v": 3,
            "status": "ready",
            "candidates": [],
            "hypotheses": {"near": {}},
        }
        malformed["match"]["points"][0]["placement"] = malformed[
            "placements"
        ]["1"]

        with self.assertRaisesRegex(ValueError, "near and far hypotheses"):
            validate_backfill_output(record, malformed)

    def test_rejects_malformed_candidate(self):
        record = record_fixture()
        malformed = output_fixture()
        malformed["placements"]["1"]["candidates"] = [{"id": "candidate-1"}]
        malformed["match"]["points"][0]["placement"] = malformed[
            "placements"
        ]["1"]

        with self.assertRaisesRegex(ValueError, "candidate"):
            validate_backfill_output(record, malformed)

    def test_rejects_non_finite_or_out_of_range_trust_confidence(self):
        for field_path, invalid in (
            (("hypotheses", "near", "confidence"), float("nan")),
            (("hypotheses", "near", "confidence"), 1.01),
            (("hypotheses", "near", "shots", 0, "confidence"), -0.01),
            (
                (
                    "hypotheses",
                    "near",
                    "shots",
                    0,
                    "landing",
                    "confidence",
                ),
                float("inf"),
            ),
        ):
            with self.subTest(field_path=field_path, invalid=invalid):
                record = record_fixture()
                malformed = output_fixture()
                self.add_valid_shots(malformed["placements"]["1"])
                target = malformed["placements"]["1"]
                for part in field_path[:-1]:
                    target = target[part]
                target[field_path[-1]] = invalid
                malformed["match"]["points"][0]["placement"] = malformed[
                    "placements"
                ]["1"]

                with self.assertRaisesRegex(ValueError, "confidence"):
                    validate_backfill_output(record, malformed)

    def test_rejects_landing_outside_the_table(self):
        record = record_fixture()
        malformed = output_fixture()
        self.add_valid_shots(malformed["placements"]["1"])
        malformed["placements"]["1"]["hypotheses"]["near"]["shots"][1][
            "landing"
        ]["u"] = 1.526
        malformed["match"]["points"][0]["placement"] = malformed[
            "placements"
        ]["1"]

        with self.assertRaisesRegex(ValueError, "landing.*table"):
            validate_backfill_output(record, malformed)

    def test_rejects_non_contiguous_or_side_inconsistent_shot_sequences(self):
        for mutation, message in (
            (
                lambda shots: shots[1].update(seq=3),
                "contiguous",
            ),
            (
                lambda shots: shots[1].update(hitter_side="near"),
                "hitter side",
            ),
            (
                lambda shots: shots[0].update(phase="rally"),
                "first shot.*serve",
            ),
        ):
            with self.subTest(message=message):
                record = record_fixture()
                malformed = output_fixture()
                self.add_valid_shots(malformed["placements"]["1"])
                mutation(
                    malformed["placements"]["1"]["hypotheses"]["near"][
                        "shots"
                    ]
                )
                malformed["match"]["points"][0]["placement"] = malformed[
                    "placements"
                ]["1"]

                with self.assertRaisesRegex(ValueError, message):
                    validate_backfill_output(record, malformed)

    def test_rejects_serve_second_bounce_on_the_servers_half(self):
        record = record_fixture()
        malformed = output_fixture()
        self.add_valid_shots(malformed["placements"]["1"])
        malformed["placements"]["1"]["hypotheses"]["near"]["shots"][0][
            "landing"
        ]["v"] = 0.9
        malformed["match"]["points"][0]["placement"] = malformed[
            "placements"
        ]["1"]

        with self.assertRaisesRegex(ValueError, "serve landing.*receiver"):
            validate_backfill_output(record, malformed)

    def test_terminal_out_coordinates_are_not_forced_onto_the_table(self):
        record = record_fixture()
        output = output_fixture()
        self.add_valid_shots(output["placements"]["1"])
        output["placements"]["1"]["hypotheses"]["near"]["shots"][1][
            "terminal"
        ] = {
            **self.valid_event("out", u=3.0, v=5.0),
            "kind": "out",
            "direction": {"du": 1.0, "dv": 1.0},
        }
        output["match"]["points"][0]["placement"] = output["placements"]["1"]

        validate_backfill_output(record, output)

    def test_review_hypotheses_keep_raw_rejected_geometry_for_diagnostics(self):
        record = record_fixture()
        output = output_fixture()
        self.add_valid_shots(output["placements"]["1"])
        hypothesis = output["placements"]["1"]["hypotheses"]["near"]
        hypothesis["status"] = "review"
        hypothesis["confidence"] = 0.69
        hypothesis["shots"][0]["landing"]["u"] = -0.1
        hypothesis["shots"][0]["landing"]["v"] = 0.4
        hypothesis["shots"][1]["hitter_side"] = "near"
        output["match"]["points"][0]["placement"] = output["placements"]["1"]

        validate_backfill_output(record, output)

    def test_stored_match_verification_rejects_non_placement_change(self):
        expected = output_fixture()["match"]
        stored = copy.deepcopy(expected)
        expected["source"] = {"fps": 30.0, "width": 1920}
        stored["source"] = {"fps": 30.0, "width": 1280}

        with self.assertRaisesRegex(RuntimeError, "full document"):
            validate_stored_match(expected, stored)


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
            patch("worker.worker.restore_match_json"),
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

    def test_r2_upload_finishes_before_database_transaction_begins(self):
        def require_short_transaction(*args, **kwargs):
            self.assertTrue(self.connection.autocommit)

        self.mocks[4].side_effect = require_short_transaction

        backfill_placement_for_match(self.connection, MATCH_ID)

        self.assertEqual(self.connection.commits, 1)

    def test_concurrent_point_change_aborts_before_upload(self):
        changed = copy.deepcopy(self.record)
        changed["points"][0]["t0"] = 1.5
        self.mocks[0].side_effect = [self.record, changed]

        with self.assertRaisesRegex(RuntimeError, "changed during reconstruction"):
            backfill_placement_for_match(self.connection, MATCH_ID)

        self.mocks[4].assert_not_called()
        self.assertEqual(self.connection.commits, 0)

    def test_concurrent_placement_change_does_not_block_authorized_replacement(self):
        changed = copy.deepcopy(self.record)
        changed["points"][0]["placement"] = {"v": 3, "status": "review"}
        self.mocks[0].side_effect = [self.record, changed]

        result = backfill_placement_for_match(self.connection, MATCH_ID)

        self.assertEqual(result.point_count, 2)
        self.assertEqual(self.connection.points[1]["placement"], READY)
        self.assertEqual(self.connection.commits, 1)

    def test_database_commit_failure_never_uploads_new_match_json(self):
        def fail_commit():
            raise RuntimeError("commit failed")

        self.connection.commit = fail_commit

        with self.assertRaisesRegex(RuntimeError, "commit failed"):
            backfill_placement_for_match(self.connection, MATCH_ID)

        self.mocks[4].assert_not_called()

    def test_post_commit_verification_failure_restores_original_placements(self):
        self.mocks[5].side_effect = RuntimeError("verification mismatch")
        before = copy.deepcopy(self.connection.points)

        with self.assertRaisesRegex(RuntimeError, "verification mismatch"):
            backfill_placement_for_match(self.connection, MATCH_ID)

        self.assertEqual(self.connection.points, before)
        self.mocks[6].assert_called_once()
        self.assertEqual(
            self.mocks[6].call_args.args[0],
            self.record["match_json_path"],
        )
        self.assertEqual(
            self.mocks[6].call_args.args[1],
            Path("match.json"),
        )
        self.assertIn(
            (None, MATCH_ID, 2),
            self.connection.placement_binds,
            "compensation must bind SQL NULL, not the JSON string 'null'",
        )

    def test_r2_compensation_failure_remains_a_hard_consistency_error(self):
        self.mocks[5].side_effect = RuntimeError("verification mismatch")
        self.mocks[6].side_effect = RuntimeError("restore failed")

        with self.assertRaisesRegex(
            RuntimeError,
            "match.json restore failed: restore failed",
        ):
            backfill_placement_for_match(self.connection, MATCH_ID)


if __name__ == "__main__":
    unittest.main()
