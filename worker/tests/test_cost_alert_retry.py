"""A retried cost alert is the first attempt's email, and is never sent twice.

Each claim recomputes the month's cost, so a retry used to render a new
total into the same email under the same Resend idempotency key. Resend
refuses a reused key whose body differs, and after 24 hours, when it has
forgotten the key, the retry is delivered as a second email: the $300
alert went out once a day from 09-19 to 09-26 (10,339 attempts on one row).
"""
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest import mock

import requests
from psycopg2 import errors as pg_errors

import worker.worker as worker
from worker import cost_alerts
from worker.cost_alerts import CostAlert, PostgresCostAlertStore, deliver_cost_alerts
from worker.tests.test_match_ready_retry import FakeResend

ROOT = Path(__file__).resolve().parents[2]
KEY = "ponglens-cost/2026-09-01/300"


def alert(total):
    return CostAlert(
        delivery_id="row-300",
        period_start=date(2026, 9, 1),
        threshold_usd=Decimal("300"),
        observed_cost_usd=Decimal(str(total)),
        provider_costs={"OpenAI": Decimal(str(total))},
        attempts=1,
    )


class Store:
    """One delivery row, claimed once per total, with the migration's column."""

    def __init__(self, totals, *, has_column=True):
        self.claims = [alert(total) for total in totals]
        self.sent, self.released = [], []
        self.stored = None
        if has_column:
            self.freeze = self._freeze

    def claim(self):
        return self.claims.pop(0) if self.claims else None

    def _freeze(self, delivery_id, body):
        assert delivery_id == "row-300"
        self.stored = self.stored or body     # coalesce: the first one wins
        return self.stored

    def mark_sent(self, delivery_id):
        self.sent.append(delivery_id)

    def release(self, delivery_id, code):
        self.released.append((delivery_id, code))


class Logger:
    def __init__(self):
        self.lines = []

    def info(self, message, *args):
        self.lines.append(("info", message % args))

    def warning(self, message, *args):
        self.lines.append(("warning", message % args))


class RetriedAlertTests(unittest.TestCase):
    def setUp(self):
        self.resend = FakeResend()
        self.lose_next_reply = False
        real_post = self.resend.post

        def post(*args, **kwargs):
            reply = real_post(*args, **kwargs)
            if self.lose_next_reply:
                self.lose_next_reply = False
                raise requests.ReadTimeout("read timed out")
            return reply

        patches = [
            mock.patch.object(worker, "RESEND_API_KEY", "re_test_key_not_real"),
            mock.patch.object(worker, "address_suppressed", return_value=False),
            mock.patch.object(worker.requests, "post", side_effect=post),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def run_once(self, store, logger):
        def send(to, message, *, idempotency_key, freeze=None):
            return worker.send_email(to, message, idempotency_key=idempotency_key,
                                     cost_meter=mock.Mock(), freeze=freeze)
        return deliver_cost_alerts(store, send, "admin@example.test",
                                   "https://www.ponglens.com/admin", logger,
                                   max_alerts=1)

    def test_the_retry_sends_the_first_attempts_email_and_gets_its_id(self):
        store = Store([426.26, 431.90])
        logger = Logger()
        self.lose_next_reply = True
        self.assertEqual(self.run_once(store, logger), 0)
        self.assertEqual(store.released, [("row-300", "ReadTimeout")])
        self.assertEqual(self.run_once(store, logger), 1)
        self.assertEqual(store.sent, ["row-300"])
        self.assertEqual(len(self.resend.delivered), 1)
        self.assertIn(b"$426.26", self.resend.delivered[0])
        self.assertNotIn(b"$431.90", store.stored.encode())

    def test_without_the_column_a_refused_retry_is_still_not_sent_twice(self):
        store = Store([426.26, 431.90], has_column=False)
        logger = Logger()
        self.lose_next_reply = True
        self.run_once(store, logger)
        # The new total makes a different body: Resend refuses the key.
        self.assertEqual(self.run_once(store, logger), 1)
        self.assertEqual(store.sent, ["row-300"])
        self.assertEqual(len(self.resend.delivered), 1)
        self.assertEqual(logger.lines[-1][0], "info")
        self.assertIn("already accepted", logger.lines[-1][1])

    def test_other_refusals_are_released_with_resends_status_and_name(self):
        store = Store([426.26])
        refusal = worker.ResendError(422, "validation_error", "Invalid `to` field.")
        with mock.patch.object(worker, "send_email_payload", side_effect=refusal):
            self.assertEqual(self.run_once(store, Logger()), 0)
        self.assertEqual(store.released,
                         [("row-300", "ResendError 422 validation_error")])
        self.assertEqual(store.sent, [])


class SendEmailFreezeTests(unittest.TestCase):
    def setUp(self):
        self.payloads = []
        patches = [
            mock.patch.object(worker, "RESEND_API_KEY", "re_test_key_not_real"),
            mock.patch.object(worker, "address_suppressed", return_value=False),
            mock.patch.object(worker, "send_email_payload",
                              side_effect=lambda payload, **_: self.payloads.append(payload)),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_stored_body_is_what_goes_out(self):
        first = worker.resend_request_body({"from": "a", "to": ["b"], "subject": "Old"})
        seen = []
        worker.send_email("b", "New", "<p>New</p>", idempotency_key="k",
                          freeze=lambda body: seen.append(body) or first.decode())
        self.assertEqual(self.payloads, [{"from": "a", "to": ["b"], "subject": "Old"}])
        self.assertIn('"subject": "New"', seen[0])

    def test_nothing_stored_sends_this_attempts_body(self):
        worker.send_email("b", "New", "<p>New</p>", idempotency_key="k",
                          freeze=lambda body: None)
        self.assertEqual(self.payloads[0]["subject"], "New")

    def test_a_suppressed_address_stores_nothing(self):
        with mock.patch.object(worker, "address_suppressed", return_value=True):
            worker.send_email("b", "New", "<p>New</p>", idempotency_key="k",
                              freeze=lambda body: self.fail("froze a skipped send"))
        self.assertEqual(self.payloads, [])


class Cursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.connection.statements.append(sql)
        if "send_payload" in sql and self.connection.missing_column:
            raise pg_errors.UndefinedColumn('column "send_payload" does not exist')

    def fetchone(self):
        return ("stored body",)


class Connection:
    def __init__(self, *, autocommit=True, missing_column=False):
        self.autocommit = autocommit
        self.missing_column = missing_column
        self.statements = []

    def cursor(self):
        return Cursor(self)


class PostgresStoreTests(unittest.TestCase):
    def test_freeze_keeps_the_first_body_and_returns_it(self):
        connection = Connection()
        self.assertEqual(PostgresCostAlertStore(connection).freeze("row", "new body"),
                         "stored body")
        self.assertIn("coalesce(send_payload, %s)", connection.statements[0])
        self.assertIn("status = 'sending'", connection.statements[0])

    def test_before_the_migration_it_answers_nothing_and_stops_asking(self):
        connection = Connection(missing_column=True)
        store = PostgresCostAlertStore(connection)
        self.assertIsNone(store.freeze("row", "body"))
        self.assertIsNone(store.freeze("row", "body"))
        self.assertEqual(len(connection.statements), 1)

    def test_inside_a_transaction_the_missing_column_does_not_abort_it(self):
        connection = Connection(autocommit=False, missing_column=True)
        self.assertIsNone(PostgresCostAlertStore(connection).freeze("row", "body"))
        self.assertEqual(connection.statements[0], "savepoint cost_alert_freeze")
        self.assertEqual(connection.statements[-1],
                         "rollback to savepoint cost_alert_freeze")


class MigrationTests(unittest.TestCase):
    def test_the_claim_changes_only_the_two_amounts(self):
        """The new function is the live one (identical to 055) with only
        the two amount assignments changed, so nothing else drifts."""
        def claim_function(text):
            start = text.index("create or replace function public.claim_platform_cost_alert(")
            return text[start:text.index("$$;", start) + 3]

        migration = (ROOT / "supabase/migrations/"
                     "20260926163411_cost_alert_frozen_payload.sql").read_text()
        original = (ROOT / "supabase/migrations/055_platform_cost_alerts.sql").read_text()
        self.assertIn("add column if not exists send_payload text", migration)
        changed = """      -- Once an attempt has stored its email, the amounts it showed stay:
      -- the row records what was sent, not the latest total.
      observed_cost_usd = case when delivery.send_payload is null
        then v_total else delivery.observed_cost_usd end,
      provider_costs = case when delivery.send_payload is null
        then v_provider_costs else delivery.provider_costs end,
"""
        before = """      observed_cost_usd = v_total,
      provider_costs = v_provider_costs,
"""
        self.assertIn(changed, migration)
        self.assertEqual(claim_function(migration).replace(changed, before),
                         claim_function(original))

    def test_the_store_names_the_migration_that_adds_its_column(self):
        self.assertIn("20260926163411", PostgresCostAlertStore.freeze.__doc__)
        self.assertTrue((ROOT / "supabase/migrations/"
                         "20260926163411_cost_alert_frozen_payload.sql").exists())


class ErrorCodeTests(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(cost_alerts._error_code(RuntimeError("provider unavailable")),
                         "RuntimeError")
        self.assertEqual(cost_alerts._error_code(
            worker.ResendError(503, "application_error", "try later")),
            "ResendError 503 application_error")


if __name__ == "__main__":
    unittest.main()
