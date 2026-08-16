import json
import math
import unittest
from unittest.mock import Mock

from worker.cost_meter import CostMeter, stable_key


class CostMeterTests(unittest.TestCase):
    def test_openai_usage_separates_cached_input(self):
        meter = CostMeter(None)
        events = meter.openai_usage_events(
            {
                "id": "chatcmpl-1",
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 20,
                    "prompt_tokens_details": {"cached_tokens": 40},
                },
            },
            model="gpt-5-nano",
            operation="video_content_validation",
            idempotency_key="openai:chatcmpl-1:video",
        )
        self.assertEqual(
            [(event["unit"], event["quantity"]) for event in events],
            [
                ("input_token", 60.0),
                ("cached_input_token", 40.0),
                ("output_token", 20.0),
            ],
        )

    def test_five_six_cache_miss_bills_as_a_cache_write(self):
        # The vision calibration prompt is three large image frames sent
        # three times over. OpenAI writes the cache on the first trial and
        # charges 1.25x for it, on a line the meter had no unit for.
        meter = CostMeter(None)
        events = meter.openai_usage_events(
            {
                "id": "resp-1",
                "usage": {
                    "input_tokens": 5000,
                    "output_tokens": 500,
                    "input_tokens_details": {"cached_tokens": 4000},
                },
            },
            model="gpt-5.6-sol",
            operation="table_vision_calibration",
            idempotency_key="openai:resp-1:points-vision",
        )
        self.assertEqual(
            [(event["unit"], event["quantity"]) for event in events],
            [
                ("cache_write_token", 1000.0),
                ("cached_input_token", 4000.0),
                ("output_token", 500.0),
            ],
        )

    def test_prompt_below_the_caching_floor_stays_plain_input(self):
        meter = CostMeter(None)
        events = meter.openai_usage_events(
            {"usage": {"input_tokens": 400, "output_tokens": 50}},
            model="gpt-5.6-sol",
            operation="table_vision_calibration",
            idempotency_key="openai:resp-2:points-vision",
        )
        self.assertEqual(events[0]["unit"], "input_token")

    def test_models_without_a_write_premium_stay_plain_input(self):
        meter = CostMeter(None)
        events = meter.openai_usage_events(
            {"usage": {"input_tokens": 9000, "output_tokens": 100}},
            model="gpt-5-nano",
            operation="video_content_validation",
            idempotency_key="openai:resp-3:video",
        )
        self.assertEqual(events[0]["unit"], "input_token")

    def test_metadata_allowlist_drops_identifying_fields(self):
        conn = connection()
        meter = CostMeter(conn)
        meter.record([
            {
                "provider": "OpenAI",
                "service": "AI",
                "operation": "test",
                "sku": "gpt-5-nano",
                "quantity": 1,
                "unit": "request",
                "idempotency_key": "safe",
                "metadata": {
                    "stage": "content_check",
                    "user_id": "private",
                    "email": "private@example.com",
                    "prompt": "private",
                },
            }
        ])
        payload = conn.cursor_value.execute.call_args.args[1][0]
        metadata = json.loads(payload)[0]["metadata"]
        self.assertEqual(metadata, {"stage": "content_check"})

    def test_nonfinite_and_negative_quantities_are_rejected(self):
        conn = connection()
        meter = CostMeter(conn)
        meter.record([
            event(quantity=math.nan, key="nan"),
            event(quantity=math.inf, key="inf"),
            event(quantity=-1, key="negative"),
        ])
        conn.cursor_value.execute.assert_not_called()

    def test_database_failure_is_logged_and_swallowed(self):
        conn = connection()
        conn.cursor_value.execute.side_effect = RuntimeError("offline")
        logger = Mock()
        meter = CostMeter(conn, logger=logger)
        meter.record([event(quantity=1, key="one")])
        logger.warning.assert_called_once()

    def test_timed_stage_records_elapsed_compute_seconds(self):
        conn = connection()
        clock = Mock(side_effect=[10.0, 12.5])
        meter = CostMeter(conn, clock=clock)
        with meter.timed_stage("blurball_inference", "job-hash"):
            pass
        payload = conn.cursor_value.execute.call_args.args[1][0]
        recorded = json.loads(payload)[0]
        self.assertEqual(recorded["quantity"], 2.5)
        self.assertEqual(recorded["metadata"]["stage"], "blurball_inference")
        self.assertNotIn("job-hash", payload)

    def test_stable_key_is_repeatable_and_hides_source_values(self):
        first = stable_key("job-id", "blurball")
        second = stable_key("job-id", "blurball")
        self.assertEqual(first, second)
        self.assertNotIn("job-id", first)
        self.assertEqual(len(first), 64)

    def test_r2_and_email_helpers_emit_anonymous_billing_events(self):
        meter = CostMeter(None)
        r2_event = meter.r2_operation_event(
            "upload_file", "provider-request-1", assumed=False
        )
        email_event = meter.email_event(
            "resend-message-1", recipients=2
        )
        self.assertEqual(r2_event["unit"], "class_a_operation")
        self.assertEqual(r2_event["metadata"], {"storage_class": "standard"})
        self.assertEqual(email_event["quantity"], 2)
        self.assertNotIn("provider-request-1", r2_event["idempotency_key"])


def event(*, quantity, key):
    return {
        "provider": "Local",
        "service": "Compute",
        "operation": "test",
        "sku": "mac-studio",
        "quantity": quantity,
        "unit": "compute_second",
        "idempotency_key": key,
    }


def connection():
    cursor = Mock()
    context = Mock()
    context.__enter__ = Mock(return_value=cursor)
    context.__exit__ = Mock(return_value=False)
    conn = Mock()
    conn.cursor_value = cursor
    conn.cursor.return_value = context
    return conn


if __name__ == "__main__":
    unittest.main()
