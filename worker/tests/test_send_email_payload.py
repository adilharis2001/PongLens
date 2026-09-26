"""send_email_payload finishes cleanly once Resend accepts the message.

It used to count recipients through a name that only exists in send_email,
so it raised NameError after the provider had already accepted the mail:
every worker email was recorded as failed and the cost alert re-sent daily.
"""
import unittest
from unittest import mock

import worker.worker as worker


class SendEmailPayloadTest(unittest.TestCase):
    def _send(self, payload):
        response = mock.Mock(status_code=200)
        response.json.return_value = {"id": "provider-1"}
        meter = mock.Mock()
        with mock.patch.object(worker.requests, "post", return_value=response):
            result = worker.send_email_payload(
                payload, idempotency_key="k", cost_meter=meter)
        return result, meter

    def test_accepted_mail_returns_the_provider_id(self):
        result, meter = self._send({"to": ["a@example.test"], "subject": "S"})
        self.assertEqual(result, "provider-1")
        meter.email_event.assert_called_once_with("provider-1", recipients=1)

    def test_bcc_recipients_are_counted_from_the_payload(self):
        _, meter = self._send({"to": ["a@example.test"], "subject": "S",
                               "bcc": ["b@example.test", "c@example.test"]})
        meter.email_event.assert_called_once_with("provider-1", recipients=3)


if __name__ == "__main__":
    unittest.main()
