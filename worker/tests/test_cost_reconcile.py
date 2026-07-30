import unittest
from datetime import datetime, timezone
from unittest.mock import Mock

from worker.cost_reconcile import (
    daily_period,
    parse_cloudflare_usage,
    parse_deepgram_usage,
    parse_openai_cost,
    parse_supabase_usage,
    parse_vercel_cost,
    record_r2_storage_snapshot,
    run_daily_reconciliation,
)


class CostReconciliationTests(unittest.TestCase):
    def test_daily_period_is_previous_complete_utc_day(self):
        start, end = daily_period(
            datetime(2026, 7, 29, 18, 30, tzinfo=timezone.utc)
        )
        self.assertEqual(start.isoformat(), "2026-07-28T00:00:00+00:00")
        self.assertEqual(end.isoformat(), "2026-07-29T00:00:00+00:00")

    def test_openai_cost_parser_sums_paginated_cost_buckets(self):
        payloads = [
            {
                "data": [
                    {
                        "results": [
                            {"amount": {"value": 1.23, "currency": "usd"}},
                            {"amount": {"value": "0.07", "currency": "usd"}},
                        ]
                    }
                ]
            },
            {
                "data": [
                    {
                        "results": [
                            {"amount": {"value": 0.20, "currency": "usd"}}
                        ]
                    }
                ]
            },
        ]
        self.assertEqual(parse_openai_cost(payloads), 1.50)

    def test_usage_parsers_keep_only_aggregate_billing_dimensions(self):
        deepgram = parse_deepgram_usage(
            {
                "results": [
                    {"hours": 1.5, "total_hours": 1.75, "requests": 4},
                    {"hours": 0.5, "total_hours": 0.5, "requests": 2},
                ]
            }
        )
        cloudflare = parse_cloudflare_usage(
            {
                "data": {
                    "viewer": {
                        "accounts": [
                            {
                                "r2OperationsAdaptiveGroups": [
                                    {
                                        "sum": {"requests": 8},
                                        "dimensions": {"actionType": "PutObject"},
                                    },
                                    {
                                        "sum": {"requests": 12},
                                        "dimensions": {"actionType": "GetObject"},
                                    },
                                ],
                                "r2StorageAdaptiveGroups": [
                                    {
                                        "max": {
                                            "objectCount": 20,
                                            "payloadSize": 1234,
                                            "metadataSize": 56,
                                        }
                                    }
                                ],
                            }
                        ]
                    }
                }
            }
        )
        supabase = parse_supabase_usage(
            {
                "result": [
                    {
                        "timestamp": "private-not-retained",
                        "total_auth_requests": 2,
                        "total_realtime_requests": 3,
                        "total_rest_requests": 5,
                        "total_storage_requests": 7,
                    }
                ]
            }
        )
        self.assertEqual(
            deepgram,
            {"billable_hours": 2.0, "total_hours": 2.25, "requests": 6},
        )
        self.assertEqual(
            cloudflare,
            {
                "operations": {"GetObject": 12, "PutObject": 8},
                "operation_requests": 20,
                "storage_bytes": 1290,
                "objects": 20,
            },
        )
        self.assertEqual(
            supabase,
            {
                "auth_requests": 2,
                "realtime_requests": 3,
                "rest_requests": 5,
                "storage_requests": 7,
            },
        )

    def test_vercel_cost_prefers_billed_cost_and_does_not_double_count(self):
        self.assertEqual(
            parse_vercel_cost(
                {
                    "charges": [
                        {
                            "BilledCost": "2.50",
                            "EffectiveCost": "2.25",
                            "ListCost": "3.00",
                        },
                        {"billedCost": 0.75, "effectiveCost": 0.70},
                    ]
                }
            ),
            3.25,
        )

    def test_storage_snapshot_records_bytes_and_prorated_gb_month(self):
        meter = Mock()
        paginator = Mock()
        paginator.paginate.side_effect = [
            [{"Contents": [{"Size": 1_000_000_000}, {"Size": 500_000_000}]}],
            [{"Contents": [{"Size": 500_000_000}]}],
        ]
        client = Mock()
        client.get_paginator.return_value = paginator

        result = record_r2_storage_snapshot(
            meter,
            client,
            ("raw", "media"),
            datetime(2026, 7, 29, tzinfo=timezone.utc),
        )

        self.assertEqual(result, {"storage_bytes": 2_000_000_000, "objects": 3})
        events = meter.record.call_args.args[0]
        self.assertEqual(events[0]["unit"], "storage_byte_snapshot")
        self.assertEqual(events[0]["quantity"], 2_000_000_000)
        self.assertAlmostEqual(events[1]["quantity"], 2 / 31)
        self.assertEqual(events[1]["unit"], "gb_month")
        self.assertNotIn("raw", str(events))
        self.assertNotIn("media", str(events))

    def test_missing_optional_credentials_make_no_http_calls(self):
        conn = connection()
        http = Mock()
        result = run_daily_reconciliation(
            conn,
            config={},
            http=http,
            now=datetime(2026, 7, 29, 18, tzinfo=timezone.utc),
        )
        http.request.assert_not_called()
        self.assertEqual(result, {})
        conn.cursor_value.execute.assert_not_called()

    def test_provider_error_is_saved_as_sanitized_snapshot(self):
        conn = connection()
        http = Mock()
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError(
            "401 secret-token-was-rejected"
        )
        http.request.return_value = response

        result = run_daily_reconciliation(
            conn,
            config={"openai_admin_key": "secret-token"},
            http=http,
            now=datetime(2026, 7, 29, 18, tzinfo=timezone.utc),
        )

        self.assertEqual(result["OpenAI"], "error")
        params = conn.cursor_value.execute.call_args.args[1]
        self.assertEqual(params[5], "error")
        self.assertEqual(params[6], "RuntimeError")
        self.assertNotIn("secret-token", str(params))

    def test_vercel_focus_jsonl_is_parsed_with_exclusive_date_range(self):
        conn = connection()
        http = Mock()
        response = Mock()
        response.text = (
            '{"BilledCost":0.25,"EffectiveCost":0.20}\n'
            '{"BilledCost":0.75,"EffectiveCost":0.70}\n'
        )
        response.raise_for_status.return_value = None
        http.request.return_value = response

        result = run_daily_reconciliation(
            conn,
            config={
                "vercel_access_token": "token",
                "vercel_team_id": "team",
            },
            http=http,
            now=datetime(2026, 7, 29, 18, tzinfo=timezone.utc),
        )

        self.assertEqual(result["Vercel"], "success")
        url = http.request.call_args.args[1]
        self.assertIn("from=2026-07-28T00%3A00%3A00Z", url)
        self.assertIn("to=2026-07-29T00%3A00%3A00Z", url)
        params = conn.cursor_value.execute.call_args.args[1]
        self.assertEqual(params[3], 1.0)


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
