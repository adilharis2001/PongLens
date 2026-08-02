import copy
import contextlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

from worker import worker


MATCH_ID = "10000000-0000-0000-0000-000000000001"
JOB_ID = "20000000-0000-0000-0000-000000000002"
OTHER_JOB_ID = "30000000-0000-0000-0000-000000000003"
USER_ID = "40000000-0000-0000-0000-000000000004"


def placement_fixture(*, drawable):
    shot = {
        "id": "shot-1",
        "seq": 1,
        "phase": "serve",
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
        "placement_generation_job_id": None,
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


def generation_record(**overrides):
    record = retry_record(
        placement_status="processing",
        placement_retry_count=0,
        placement_retry_job_id=None,
        placement_generation_job_id=JOB_ID,
    )
    record.update(overrides)
    return record


def reconstruction_output(*, drawable):
    placement = placement_fixture(drawable=drawable)
    return {
        "placements": {"1": placement},
        "match": {
            "version": 3,
            "source": {"width": 1920, "height": 1080, "fps": 30},
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
            worker.load_placement_attempt_record(
                conn,
                JOB_ID,
                USER_ID,
                MATCH_ID,
                worker.STRONGER_PLACEMENT_ATTEMPT,
            )


class PlacementGenerationAuthorizationTests(unittest.TestCase):
    def test_rejects_job_not_recorded_as_generation_job(self):
        conn = AuthorizationConnection(
            generation_record(placement_generation_job_id=OTHER_JOB_ID)
        )
        with self.assertRaisesRegex(
            RuntimeError, "authorized generation job"
        ):
            worker.load_placement_attempt_record(
                conn,
                JOB_ID,
                USER_ID,
                MATCH_ID,
                worker.NORMAL_PLACEMENT_ATTEMPT,
            )


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
                result = worker.run_placement_calibration(
                    root / "source.mp4",
                    root / "blurball.jsonl",
                    root,
                    strategy="stronger",
                    command_runner=runner,
                )

            self.assertFalse(result["ok"])
            self.assertNotIn("top-secret", " ".join(captured["command"]))
            self.assertEqual(captured["env"]["OPENAI_API_KEY"], "top-secret")
            self.assertEqual(
                captured["command"][
                    captured["command"].index("--strategy") + 1
                ],
                "stronger",
            )

    def test_normal_strategy_cannot_access_openai_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            captured = {}

            def runner(command, **kwargs):
                captured["command"] = command
                captured["env"] = kwargs["env"]
                output = Path(command[command.index("--output") + 1])
                output.write_text(json.dumps({
                    "ok": False,
                    "code": "deterministic_calibration_failed",
                    "calibration": None,
                }))

            with patch("worker.worker.OPENAI_API_KEY", "top-secret"):
                result = worker.run_placement_calibration(
                    root / "source.mp4",
                    root / "blurball.jsonl",
                    root,
                    strategy="deterministic",
                    command_runner=runner,
                )

            self.assertFalse(result["ok"])
            self.assertEqual(captured["env"]["OPENAI_API_KEY"], "")
            self.assertNotIn("--model", captured["command"])
            self.assertEqual(
                captured["command"][
                    captured["command"].index("--strategy") + 1
                ],
                "deterministic",
            )

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
                result = worker.run_placement_calibration(
                    root / "source.mp4",
                    root / "blurball.jsonl",
                    root,
                    strategy="stronger",
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
                "worker.worker.load_placement_attempt_record",
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
                "worker.worker.run_placement_calibration",
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
            patch("worker.worker.verify_placement_attempt"),
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
        result = worker.placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            worker.STRONGER_PLACEMENT_ATTEMPT,
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
        result = worker.placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            worker.STRONGER_PLACEMENT_ATTEMPT,
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.failure_code, "no_mappable_points")
        self.assertEqual(self.connection.point_updates, [])
        self.mocks[5].assert_not_called()

    def test_success_updates_only_placement_and_lifecycle(self):
        result = worker.placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            worker.STRONGER_PLACEMENT_ATTEMPT,
        )
        self.assertTrue(result.succeeded)
        self.assertEqual(result.terminal_status, "ready")
        self.assertEqual(result.mapped_points, 1)
        self.assertEqual(self.connection.lifecycle["placement_status"], "ready")
        self.assertEqual(self.connection.point_updates, [(MATCH_ID, 1)])
        self.mocks[5].assert_called_once()
        self.mocks[6].assert_called_once()

    def test_source_expiry_is_final_without_compute(self):
        self.record["source_expired"] = True
        result = worker.placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            worker.STRONGER_PLACEMENT_ATTEMPT,
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
        result = worker.placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            worker.STRONGER_PLACEMENT_ATTEMPT,
        )
        self.assertTrue(result.already_terminal)
        self.mocks[1].assert_not_called()
        self.assertEqual(self.connection.commits, 0)

    def test_transient_compute_error_leaves_match_retrying(self):
        self.mocks[2].side_effect = RuntimeError("gpu unavailable")
        with self.assertRaisesRegex(RuntimeError, "gpu unavailable"):
            worker.placement_for_match(
                self.connection,
                JOB_ID,
                USER_ID,
                MATCH_ID,
                worker.STRONGER_PLACEMENT_ATTEMPT,
            )
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retrying",
        )
        self.assertEqual(self.connection.commits, 0)

    def test_verification_failure_restores_points_lifecycle_and_document(self):
        self.mocks[6].side_effect = RuntimeError("verification mismatch")
        with self.assertRaisesRegex(RuntimeError, "verification mismatch"):
            worker.placement_for_match(
                self.connection,
                JOB_ID,
                USER_ID,
                MATCH_ID,
                worker.STRONGER_PLACEMENT_ATTEMPT,
            )
        self.assertIsNone(self.connection.points[1])
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retrying",
        )
        self.mocks[7].assert_called_once()


class PlacementGenerationOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = PlacementRetryOutcomeTests(
            "test_success_updates_only_placement_and_lifecycle"
        )
        self.fixture.setUp()
        self.connection = self.fixture.connection
        self.record = self.fixture.record
        self.mocks = self.fixture.mocks
        self.record.clear()
        self.record.update(generation_record())
        self.connection.lifecycle["placement_status"] = "processing"
        self.connection.pending_lifecycle = copy.deepcopy(
            self.connection.lifecycle
        )

    def tearDown(self):
        self.fixture.tearDown()

    def run_attempt(self):
        return worker.placement_for_match(
            self.connection,
            JOB_ID,
            USER_ID,
            MATCH_ID,
            worker.NORMAL_PLACEMENT_ATTEMPT,
        )

    def test_normal_success_updates_only_placement_and_lifecycle(self):
        result = self.run_attempt()
        self.assertTrue(result.succeeded)
        self.assertEqual(result.terminal_status, "ready")
        self.assertEqual(result.mapped_points, 1)
        self.assertEqual(self.connection.point_updates, [(MATCH_ID, 1)])

    def test_normal_calibration_failure_exposes_stronger_retry(self):
        self.mocks[3].return_value = {
            "ok": False,
            "code": "deterministic_calibration_failed",
            "calibration": None,
        }
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "retry_available")
        self.assertEqual(result.failure_code, "deterministic_calibration_failed")
        self.assertEqual(self.connection.point_updates, [])
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retry_available",
        )

    def test_calibration_failure_does_not_expose_retry_after_lock_expiry(self):
        locked = generation_record(source_expired=True)
        self.mocks[0].side_effect = [
            copy.deepcopy(self.record),
            locked,
        ]
        self.mocks[3].return_value = {
            "ok": False,
            "code": "deterministic_calibration_failed",
            "calibration": None,
        }
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "final_failed")
        self.assertEqual(result.failure_code, "source_expired")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )

    def test_normal_zero_drawable_output_exposes_stronger_retry(self):
        self.mocks[4].return_value = reconstruction_output(drawable=False)
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "retry_available")
        self.assertEqual(result.failure_code, "no_mappable_points")
        self.assertEqual(self.connection.point_updates, [])

    def test_zero_map_failure_does_not_expose_retry_after_lock_expiry(self):
        locked = generation_record(source_expired=True)
        self.mocks[0].side_effect = [
            copy.deepcopy(self.record),
            locked,
        ]
        self.mocks[4].return_value = reconstruction_output(drawable=False)
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "final_failed")
        self.assertEqual(result.failure_code, "source_expired")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )
        self.assertEqual(self.connection.point_updates, [])

    def test_non_placement_match_json_changes_are_rejected_before_mutation(self):
        output = reconstruction_output(drawable=True)
        output["match"]["source"]["width"] = 1
        self.mocks[4].return_value = output
        with self.assertRaisesRegex(ValueError, "non-placement match data"):
            self.run_attempt()
        self.assertEqual(self.connection.point_updates, [])
        self.assertEqual(self.connection.commits, 0)
        self.mocks[5].assert_not_called()

    def test_missing_source_is_final_failed_without_compute(self):
        self.record["input_path"] = None
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "final_failed")
        self.assertEqual(result.failure_code, "source_missing")
        self.mocks[1].assert_not_called()

    def test_deleted_r2_source_is_final_failed_not_poison(self):
        self.mocks[1].side_effect = ClientError(
            {
                "Error": {
                    "Code": "NoSuchKey",
                    "Message": "The specified key does not exist.",
                }
            },
            "GetObject",
        )
        result = self.run_attempt()
        self.assertFalse(result.succeeded)
        self.assertEqual(result.terminal_status, "final_failed")
        self.assertEqual(result.failure_code, "source_missing")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )
        self.assertEqual(self.connection.point_updates, [])

    def test_terminal_redelivery_is_a_noop(self):
        self.record.update(
            placement_status="retry_available",
            placement_failure_code="no_mappable_points",
        )
        result = self.run_attempt()
        self.assertTrue(result.already_terminal)
        self.assertEqual(result.terminal_status, "retry_available")
        self.mocks[1].assert_not_called()
        self.assertEqual(self.connection.commits, 0)

    def test_transient_compute_error_leaves_match_processing(self):
        self.mocks[2].side_effect = RuntimeError("gpu unavailable")
        with self.assertRaisesRegex(RuntimeError, "gpu unavailable"):
            self.run_attempt()
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "processing",
        )
        self.assertEqual(self.connection.commits, 0)

    def test_verification_failure_restores_generation_state_and_document(self):
        self.mocks[6].side_effect = RuntimeError("verification mismatch")
        with self.assertRaisesRegex(RuntimeError, "verification mismatch"):
            self.run_attempt()
        self.assertIsNone(self.connection.points[1])
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "processing",
        )
        self.mocks[7].assert_called_once()


class PlacementPoisonOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeMutationConnection()
        self.connection.lifecycle["placement_status"] = "processing"
        self.connection.pending_lifecycle = copy.deepcopy(
            self.connection.lifecycle
        )

    def finalize(self, record):
        with patch(
            "worker.worker.load_placement_attempt_record",
            return_value=copy.deepcopy(record),
        ):
            return worker.finalize_poisoned_placement_attempt(
                self.connection,
                JOB_ID,
                USER_ID,
                MATCH_ID,
                worker.NORMAL_PLACEMENT_ATTEMPT,
            )

    def test_generation_poison_while_source_live_exposes_stronger_retry(self):
        outcome = self.finalize(generation_record(source_expired=False))
        self.assertEqual(outcome, "retry_available")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "retry_available",
        )

    def test_generation_poison_after_expiry_is_final_failed(self):
        outcome = self.finalize(generation_record(source_expired=True))
        self.assertEqual(outcome, "final_failed")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )

    def test_generation_poison_with_missing_source_is_final_failed(self):
        outcome = self.finalize(generation_record(input_path=None))
        self.assertEqual(outcome, "final_failed")
        self.assertEqual(
            self.connection.lifecycle["placement_status"],
            "final_failed",
        )


class PlacementGenerationDispatchTests(unittest.TestCase):
    def dispatch(self, terminal_status, sender):
        """Run one placement_generate job to completion, capturing emails."""
        result = Mock(
            match_id=MATCH_ID,
            terminal_status=terminal_status,
            already_terminal=False,
            succeeded=terminal_status == "ready",
            mapped_points=0,
        )
        meter = Mock()
        meter.timed_stage.return_value = contextlib.nullcontext()
        message = {
            "msg_id": 7,
            "read_ct": 1,
            "message": {
                "job_id": JOB_ID,
                "user_id": USER_ID,
                "input_path": "unused",
                "kind": "placement_generate",
                "options": {"match_id": MATCH_ID},
            },
        }
        with (
            patch("worker.worker.COST_METER", meter),
            patch("worker.worker.update_job"),
            patch("worker.worker.archive_message"),
            patch(
                "worker.worker.process_placement_generation",
                return_value=result,
            ),
            patch("worker.worker.send_email", side_effect=sender),
        ):
            worker.process_job(Mock(), message)
        return meter

    def test_process_job_uses_the_generation_cost_stage(self):
        meter = self.dispatch("retry_available", Mock())
        meter.timed_stage.assert_called_once_with(
            "placement_generate_compute",
            f"{JOB_ID}:1",
        )

    def test_no_outcome_email_for_any_terminal_status(self):
        """Placement is beta: neither outcome earns a place in the inbox.

        Every terminal status is covered, including the 'ready' one that
        used to send "Your placement maps are ready" — a claim the table
        calibration cannot always stand behind.
        """
        for status in ("ready", "retry_available", "final_failed"):
            with self.subTest(status=status):
                sent = Mock()
                self.dispatch(status, sent)
                sent.assert_not_called()


if __name__ == "__main__":
    unittest.main()
