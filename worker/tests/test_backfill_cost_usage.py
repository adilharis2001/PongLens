import unittest
from datetime import date, datetime, timezone

from worker.backfill_cost_usage import (
    ai_request_events,
    parse_worker_token_events,
    storage_events,
)


class CostBackfillTests(unittest.TestCase):
    def test_current_r2_size_corrects_latest_ledger_balance_without_adding_it(self):
        events = storage_events(
            [
                {"day": date(2026, 7, 27), "bytes": 1_000_000_000},
                {"day": date(2026, 7, 28), "bytes": 500_000_000},
            ],
            start=date(2026, 7, 27),
            end=date(2026, 7, 29),
            current_r2_bytes=2_000_000_000,
        )
        accruals = [event for event in events if event["unit"] == "gb_month"]
        snapshots = [
            event for event in events
            if event["unit"] == "storage_byte_snapshot"
        ]
        self.assertAlmostEqual(accruals[0]["quantity"], 1 / 31)
        self.assertAlmostEqual(accruals[1]["quantity"], 2 / 31)
        self.assertEqual(snapshots[0]["quantity"], 2_000_000_000)

    def test_ai_counts_are_assumed_requests_and_never_fabricated_tokens(self):
        events = ai_request_events([
            {
                "day": date(2026, 7, 28),
                "ocr_pages": 3,
                "image_checks": 2,
            }
        ])
        self.assertEqual(
            [(event["operation"], event["quantity"]) for event in events],
            [("journal_ocr", 3), ("entry_image_validation", 2)],
        )
        self.assertTrue(all(event["unit"] == "request" for event in events))
        self.assertTrue(all(event["source"] == "assumed" for event in events))
        self.assertFalse(any("token" in event["unit"] for event in events))

    def test_parseable_worker_lines_create_deduplicated_aggregate_tokens(self):
        line = (
            "2026-07-28 11:52:56,304 INFO   content check: 12/12 frames "
            "positive (model=gpt-5-nano, 2698 prompt + 98 completion tokens)"
        )
        events = parse_worker_token_events(
            "\n".join([
                line,
                line,
                (
                    "2026-07-28 20:47:40,363 INFO content check: 12/12 "
                    "frames positive (model=gpt-5-nano, 2698 prompt + "
                    "34 completion tokens)"
                ),
                "2026-07-28 21:00:00 INFO unrelated private text",
            ]),
            start=date(2026, 7, 28),
            end=date(2026, 7, 29),
        )
        self.assertEqual(
            [(event["unit"], event["quantity"]) for event in events],
            [("input_token", 5396), ("output_token", 132)],
        )
        self.assertTrue(all(event["source"] == "backfill" for event in events))

    def test_rerunning_produces_identical_keys_and_no_source_identifiers(self):
        rows = [{"day": date(2026, 7, 28), "ocr_pages": 1, "image_checks": 0}]
        first = ai_request_events(rows)
        second = ai_request_events(rows)
        self.assertEqual(
            [event["idempotency_key"] for event in first],
            [event["idempotency_key"] for event in second],
        )
        serialized = str(first)
        self.assertNotIn("user_id", serialized)
        self.assertNotIn("match_id", serialized)
        self.assertNotIn("email", serialized)

    def test_storage_event_time_is_utc_and_range_is_end_exclusive(self):
        events = storage_events(
            [{"day": date(2026, 7, 27), "bytes": 100}],
            start=date(2026, 7, 27),
            end=date(2026, 7, 28),
            current_r2_bytes=100,
        )
        self.assertEqual(len(events), 2)
        occurred = datetime.fromisoformat(events[0]["occurred_at"])
        self.assertEqual(occurred.tzinfo, timezone.utc)


if __name__ == "__main__":
    unittest.main()
