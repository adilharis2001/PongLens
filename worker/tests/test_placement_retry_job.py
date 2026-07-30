import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from worker.worker import (
    load_placement_retry_record,
    retry_placement_for_match,
    run_retry_calibration,
)


MATCH_ID = "10000000-0000-0000-0000-000000000001"
JOB_ID = "20000000-0000-0000-0000-000000000002"
OTHER_JOB_ID = "30000000-0000-0000-0000-000000000003"
USER_ID = "40000000-0000-0000-0000-000000000004"


def placement_fixture(*, drawable):
    shot = {
        "id": "shot-1",
        "seq": 1,
        "phase": "rally",
        "hitter_side": "near",
        "contact_t": None,
        "contact": None,
        "serve_first_bounce": None,
        "landing": (
            {
                "event_id": "bounce-1",
                "u": 0.5,
                "v": 2.0,
                "confidence": 0.8,
            }
            if drawable
            else None
        ),
        "terminal": None,
        "confidence": 0.8,
    }
    status = "ready" if drawable else "unavailable"
    hypotheses = {}
    for side in ("near", "far"):
        hypotheses[side] = {
            "serverSide": side,
            "server_side": side,
            "status": status,
            "confidence": 0.8 if drawable else 0.0,
            "score": 1.0 if drawable else 0.0,
            "reasons": [],
            "hard_reasons": [],
            "shots": [copy.deepcopy(shot)] if side == "near" else [],
            "used_event_ids": ["bounce-1"] if drawable and side == "near" else [],
        }
    return {
        "v": 3,
        "status": status,
        "candidates": [],
        "hypotheses": hypotheses,
    }


def retry_record(**overrides):
    record = {
        "match_id": MATCH_ID,
        "user_id": USER_ID,
        "status": "ready",
        "placement_status": "retrying",
        "placement_retry_count": 1,
        "placement_mapped_points": 0,
        "placement_failure_code": None,
        "placement_retry_expires_at": "2026-08-01T00:00:00+00:00",
        "placement_retry_job_id": JOB_ID,
        "source_expired": False,
        "input_path": "r2://ponglens-raw/user/source.mp4",
        "match_json_path": "r2://ponglens-media/points/user/match.json",
        "points": [
            {
                "idx": 1,
                "t0": 1.0,
                "t1": 2.0,
                "placement": None,
                "suggestion": None,
            }
        ],
    }
    record.update(overrides)
    return record


def reconstruction_output(*, drawable):
    placement = placement_fixture(drawable=drawable)
    return {
        "placements": {"1": placement},
        "match": {
            "version": 3,
            "calibration": {"ok": True},
            "points": [{"idx": 1, "placement": placement}],
        },
    }


class FakeMutationCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params):
        normalized = " ".join(query.split())
        if normalized.startswith("update public.points set placement"):
            payload, match_id, index = params
            self.connection.point_updates.append((match_id, int(index)))
            self.connection.pending_points[int(index)] = (
                None if payload is None else json.loads(payload)
            )
            self.rowcount = 1
            return
        if normalized.startswith("update public.matches set placement_status"):
            status, mapped, failure, match_id, retry_job_id = params
            self.rowcount = int(
                match_id == MATCH_ID and retry_job_id == JOB_ID
            )
            if self.rowcount:
                self.connection.pending_lifecycle = {
                    "placement_status": status,
                    "placement_mapped_points": mapped,
                    "placement_failure_code": failure,
                }
            return
        raise AssertionError(f"unexpected SQL: {normalized}")


class FakeMutationConnection:
    def __init__(self):
        self.autocommit = True
        self.points = {1: None}
        self.pending_points = copy.deepcopy(self.points)
        self.lifecycle = {
            "placement_status": "retrying",
            "placement_mapped_points": 0,
            "placement_failure_code": None,
        }
        self.pending_lifecycle = copy.deepcopy(self.lifecycle)
        self.point_updates = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self, **kwargs):
        return FakeMutationCursor(self)

    def commit(self):
        self.points = copy.deepcopy(self.pending_points)
        self.lifecycle = copy.deepcopy(self.pending_lifecycle)
        self.commits += 1

    def rollback(self):
        self.pending_points = copy.deepcopy(self.points)
        self.pending_lifecycle = copy.deepcopy(self.lifecycle)
        self.rollbacks += 1


class AuthorizationCursor:
    def __init__(self, record):
        self.record = record
        self.query_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params):
        self.query_count += 1

    def fetchone(self):
        return self.record

    def fetchall(self):
        return [{"point": retry_record()["points"][0]}]


class AuthorizationConnection:
    def __init__(self, record):
        self.record = record

    def cursor(self, **kwargs):
        return AuthorizationCursor(self.record)


class PlacementRetryAuthorizationTests(unittest.TestCase):
    def test_rejects_job_that_is_not_the_match_recorded_retry_job(self):
        record = retry_record(placement_retry_job_id=OTHER_JOB_ID)
        conn = AuthorizationConnection(record)
        with self.assertRaisesRegex(RuntimeError, "authorized retry job"):
            load_placement_retry_record(conn, JOB_ID, USER_ID, MATCH_ID)


class PlacementRetrySubprocessTests(unittest.TestCase):
    def test_api_key_is_passed_only_through_the_child_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            captured = {}

            def runner(command, **kwargs):
                captured["command"] = command
                captured["env"] = kwargs["env"]
                output = Path(command[command.index("--output") + 1])
                output.write_text(
                    json.dumps(
                        {
                            "ok": False,
                            "code": "vision_calibration_rejected",
                            "calibration": None,
                        }
                    )
                )

            with patch("worker.worker.OPENAI_API_KEY", "top-secret"):
                result = run_retry_calibration(
                    root / "source.mp4",
                    root / "blurball.jsonl",
                    root,
                    command_runner=runner,
                )

            self.assertFalse(result["ok"])
            self.assertNotIn("top-secret", " ".join(captured["command"]))
            self.assertEqual(captured["env"]["OPENAI_API_KEY"], "top-secret")

    def test_aggregate_openai_usage_sidecar_is_metered_and_not_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def runner(command, **kwargs):
                output = Path(command[command.index("--output") + 1])
                output.write_text(json.dumps({
                    "ok": False,
                    "code": "vision_calibration_rejected",
                    "calibration": None,
                }))
                usage_output = Path(
                    kwargs["env"]["PONGLENS_COST_USAGE_OUTPUT"]
                )
                usage_output.write_text(json.dumps({
                    "response_id": "resp-placement-1",
                    "model": "gpt-5.6-sol",
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 20,
                    },
                }))

            meter = Mock()
            meter.openai_usage_events.return_value = [{"safe": "event"}]
            with patch("worker.worker.COST_METER", meter):
                result = run_retry_calibration(
                    root / "source.mp4",
                    root / "blurball.jsonl",
                    root,
                    command_runner=runner,
                )

            self.assertEqual(
                set(result), {"ok", "code", "calibration"}
            )
            meter.openai_usage_events.assert_called_once()
            call = meter.openai_usage_events.call_args
            self.assertEqual(
                call.args[0]["usage"],
                {"input_tokens": 100, "output_tokens": 20},
            )
            self.assertEqual(
                call.kwargs["operation"],
                "placement_retry_validation",
            )
            self.assertNotIn(
                "resp-placement-1", call.kwargs["idempotency_key"]
            )
            meter.record.assert_called_once_with([{"safe": "event"}])


class PlacementRetryOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeMutationConnection()
        self.record = retry_record()
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.source = self.root / "source.mp4"
        self.source.write_bytes(b"source")
        self.match = self.root / "match.json"
        self.match.write_text(
            json.dumps(
                {
                    "version": 3,
                    "source": {"width": 1920, "height": 1080, "fps": 30},
                    "calibration": {"ok": False},
                    "points": [{"idx": 1, "placement": None}],
                }
            )
        )
        self.blurball = self.root / "blurball.jsonl"
        self.blurball.write_text("")
        self.patches = [
            patch(
                "worker.worker.load_placement_retry_record",
                side_effect=lambda *args, **kwargs: copy.deepcopy(self.record),
            ),
            patch(
                "worker.worker.download_backfill_inputs",
                return_value=(self.source, self.match),
            ),
            patch(
                "worker.worker.run_blurball_only",
                return_value=self.blurball,
            ),
            patch(
                "worker.worker.run_retry_calibration",
                return_value={
                    "ok": True,
                    "code": None,
                    "calibration": {
                        "ok": True,
                        "table_corners_px": {},
                        "length_axis": [0.0, -1.0],
                        "note": "retry",
                    },
                },
            ),
            patch(
                "worker.worker.run_placement_reconstruction",
                return_value=reconstruction_output(drawable=True),
            ),
            patch("worker.worker.upload_match_json"),
            patch("worker.worker.verify_placement_retry"),
            patch("worker.worker.restore_match_json"),
        ]
        self.mocks = [item.start() for item in self.patches]

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.tempdir.cleanup()

    def test_expected_calibration_exhaustion_is_final_not_poison(self):
        self.mocks[3].return_value = {
            "ok": False,
            "code": "vision_calibration_rejected",
            "calibration": None,
        }
        result = retry_placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.failure_code, "vision_calibration_rejected")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )
        self.assertEqual(self.connection.point_updates, [])

    def test_zero_drawable_outputs_do_not_mutate_points(self):
        self.mocks[4].return_value = reconstruction_output(drawable=False)
        result = retry_placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.failure_code, "no_mappable_points")
        self.assertEqual(self.connection.point_updates, [])
        self.mocks[5].assert_not_called()

    def test_success_updates_only_placement_and_lifecycle(self):
        result = retry_placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
        )
        self.assertTrue(result.succeeded)
        self.assertEqual(result.mapped_points, 1)
        self.assertEqual(self.connection.lifecycle["placement_status"], "ready")
        self.assertEqual(self.connection.point_updates, [(MATCH_ID, 1)])
        self.mocks[5].assert_called_once()
        self.mocks[6].assert_called_once()

    def test_source_expiry_is_final_without_compute(self):
        self.record["source_expired"] = True
        result = retry_placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.failure_code, "source_expired")
        self.mocks[1].assert_not_called()
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )

    def test_terminal_redelivery_is_a_noop(self):
        self.record.update(
            placement_status="final_failed",
            placement_failure_code="no_mappable_points",
        )
        result = retry_placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
        )
        self.assertTrue(result.already_terminal)
        self.mocks[1].assert_not_called()
        self.assertEqual(self.connection.commits, 0)

    def test_transient_compute_error_leaves_match_retrying(self):
        self.mocks[2].side_effect = RuntimeError("gpu unavailable")
        with self.assertRaisesRegex(RuntimeError, "gpu unavailable"):
            retry_placement_for_match(
                self.connection,
                JOB_ID,
                USER_ID,
                MATCH_ID,
            )
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retrying",
        )
        self.assertEqual(self.connection.commits, 0)

    def test_verification_failure_restores_points_lifecycle_and_document(self):
        self.mocks[6].side_effect = RuntimeError("verification mismatch")
        with self.assertRaisesRegex(RuntimeError, "verification mismatch"):
            retry_placement_for_match(
                self.connection,
                JOB_ID,
                USER_ID,
                MATCH_ID,
            )
        self.assertIsNone(self.connection.points[1])
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retrying",
        )
        self.mocks[7].assert_called_once()


if __name__ == "__main__":
    unittest.main()
