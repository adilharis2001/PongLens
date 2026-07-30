import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from worker.cost_alerts import CostAlert, deliver_cost_alerts


class FakeStore:
    def __init__(self, alerts):
        self.alerts = list(alerts)
        self.sent = []
        self.released = []

    def claim(self):
        return self.alerts.pop(0) if self.alerts else None

    def mark_sent(self, delivery_id):
        self.sent.append(delivery_id)

    def release(self, delivery_id, error_code):
        self.released.append((delivery_id, error_code))


class Logger:
    def __init__(self):
        self.warnings = []

    def warning(self, message, *args):
        self.warnings.append(message % args)


class CostAlertDeliveryTests(unittest.TestCase):
    def test_sends_each_claimed_threshold_once(self):
        store = FakeStore([alert("one", 100, 215), alert("two", 200, 215)])
        messages = []

        def send_email(to, subject, body, *, idempotency_key):
            messages.append((to, subject, body, idempotency_key))

        delivered = deliver_cost_alerts(
            store,
            send_email,
            "adilharis2001@gmail.com",
            "https://www.ponglens.com/admin",
            Logger(),
        )

        self.assertEqual(delivered, 2)
        self.assertEqual(store.sent, ["one", "two"])
        self.assertEqual(store.released, [])
        self.assertEqual(len(messages), 2)
        self.assertIn("$100", messages[0][1])
        self.assertIn("$200", messages[1][1])
        self.assertEqual(
            messages[0][3],
            "ponglens-cost/2026-07-01/100",
        )

    def test_failed_delivery_is_released_for_retry(self):
        store = FakeStore([alert("one", 100, 105)])
        logger = Logger()

        def fail(*args, **kwargs):
            raise RuntimeError("provider unavailable")

        delivered = deliver_cost_alerts(
            store,
            fail,
            "adilharis2001@gmail.com",
            "https://www.ponglens.com/admin",
            logger,
        )

        self.assertEqual(delivered, 0)
        self.assertEqual(store.sent, [])
        self.assertEqual(store.released, [("one", "RuntimeError")])
        self.assertEqual(len(logger.warnings), 1)
        self.assertNotIn("provider unavailable", logger.warnings[0])

    def test_email_contains_total_vendor_breakdown_and_admin_link(self):
        store = FakeStore(
            [
                CostAlert(
                    delivery_id="one",
                    period_start=date(2026, 7, 1),
                    threshold_usd=Decimal("100"),
                    observed_cost_usd=Decimal("123.456"),
                    provider_costs={
                        "OpenAI": Decimal("80.25"),
                        "Cloudflare": Decimal("43.206"),
                    },
                    attempts=1,
                )
            ]
        )
        messages = []

        def send_email(to, subject, body, *, idempotency_key):
            messages.append(body)

        deliver_cost_alerts(
            store,
            send_email,
            "adilharis2001@gmail.com",
            "https://www.ponglens.com/admin",
            Logger(),
        )

        body = messages[0]
        self.assertIn("$123.46", body)
        self.assertIn("OpenAI", body)
        self.assertIn("$80.25", body)
        self.assertIn("Cloudflare", body)
        self.assertIn("https://www.ponglens.com/admin", body)
        self.assertIn("July 2026", body)

    def test_worker_checks_alerts_every_minute_without_blocking_jobs(self):
        source = (
            Path(__file__).resolve().parents[1] / "worker.py"
        ).read_text()

        self.assertIn("COST_ALERT_CHECK_EVERY_S = 60", source)
        self.assertIn("def maybe_send_cost_alerts():", source)
        self.assertIn("def start_cost_alert_monitor():", source)
        self.assertIn("threading.Thread(", source)
        self.assertIn("daemon=True", source)
        self.assertIn("start_cost_alert_monitor()", source)
        self.assertIn("cost alert check failed (non-fatal)", source)
        self.assertIn('"Idempotency-Key": idempotency_key', source)


def alert(delivery_id, threshold, total):
    return CostAlert(
        delivery_id=delivery_id,
        period_start=date(2026, 7, 1),
        threshold_usd=Decimal(str(threshold)),
        observed_cost_usd=Decimal(str(total)),
        provider_costs={"OpenAI": Decimal(str(total))},
        attempts=1,
    )


if __name__ == "__main__":
    unittest.main()
