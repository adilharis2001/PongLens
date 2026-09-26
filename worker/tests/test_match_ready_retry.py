"""A retry of a match-ready email that Resend already accepted is delivered.

On 2026-09-26 every ready email since 09-16 (29 of them) had reached the
player on the first try and was then retried 24 times, each retry refused,
and the row ended "expired" with last_error "RuntimeError". The first send
was accepted; a worker bug made it look failed. Each retry read the frozen
payload back from jsonb, which reorders keys, so the body bytes differed
from the accepted request and Resend refused the reused idempotency key
(409 invalid_idempotent_request) instead of answering with the original id.

FakeResend below applies Resend's documented rule to the raw body.
"""
import json as jsonlib
import unittest
from unittest import mock

import worker.worker as worker
from worker import match_ready_delivery as delivery

CONFLICT = ("This idempotency key has already been used on a request that had "
            "a different payload. Retrying this request is useless without "
            "changing the idempotency key or payload.")


def ready_payload():
    """match_ready_payload's own field order, as the first send builds it."""
    return {
        "from": "PongLens <support@ponglens.com>",
        "to": ["player@example.test"],
        "reply_to": "support@ponglens.com",
        "subject": "Your PongLens match is ready",
        "html": "<p>Your match “Sunday” is ready</p>",
        "text": "Your match is ready",
        "headers": {
            "X-PongLens-Template-Id": "match.ready",
            "X-PongLens-Template-Version": "1",
        },
    }


def jsonb_order(value):
    """What a jsonb column hands back: keys ordered by length, then bytes."""
    if isinstance(value, dict):
        return {key: jsonb_order(value[key]) for key in
                sorted(value, key=lambda k: (len(k.encode()), k.encode()))}
    if isinstance(value, list):
        return [jsonb_order(item) for item in value]
    return value


def response(status, body):
    reply = mock.Mock(status_code=status, text=jsonlib.dumps(body))
    reply.json.return_value = body
    return reply


class FakeResend:
    """Remembers each idempotency key with the exact body it arrived with."""

    def __init__(self):
        self.keys = {}
        self.delivered = []

    def post(self, _url, *, headers, data=None, json=None, timeout=None):
        body = data if data is not None else jsonlib.dumps(json).encode()
        key = headers.get("Idempotency-Key")
        if key in self.keys:
            accepted_body, message_id = self.keys[key]
            if accepted_body == body:
                return response(200, {"id": message_id})
            return response(409, {"statusCode": 409, "message": CONFLICT,
                                  "name": "invalid_idempotent_request"})
        message_id = f"email-{len(self.delivered) + 1}"
        self.delivered.append(body)
        self.keys[key] = (body, message_id)
        return response(200, {"id": message_id})


class RequestBodyTests(unittest.TestCase):
    def test_a_payload_read_back_from_jsonb_is_the_same_request(self):
        original = ready_payload()
        stored = jsonb_order(original)
        # The cause: serialised as it comes out of jsonb, the body differs.
        self.assertNotEqual(jsonlib.dumps(stored), jsonlib.dumps(original))
        # The fix: both write the same bytes...
        self.assertEqual(worker.resend_request_body(stored),
                         worker.resend_request_body(original))
        # ...and they are the bytes requests' json= sent before, so a row
        # whose first send predates this change still matches on retry.
        self.assertEqual(worker.resend_request_body(original),
                         jsonlib.dumps(original, allow_nan=False).encode())

    def test_send_email_order_is_unchanged(self):
        # send_email builds bcc last; the fixed order keeps it there.
        payload = {"from": "a", "to": ["b"], "reply_to": "c", "subject": "d",
                   "html": "e", "text": "f", "headers": {"X": "1"},
                   "bcc": ["g"]}
        self.assertEqual(worker.resend_request_body(payload),
                         jsonlib.dumps(payload).encode())


class RetryAfterAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.resend = FakeResend()
        patches = [
            mock.patch.object(worker, "RESEND_API_KEY", "re_test_key_not_real"),
            mock.patch.object(worker.requests, "post", side_effect=self.resend.post),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def send(self, payload, key="match-ready/job-1"):
        return worker.send_email_payload(payload, idempotency_key=key,
                                         cost_meter=mock.Mock(),
                                         require_provider_id=True)

    def test_retry_from_the_outbox_gets_the_original_message_id(self):
        first = self.send(ready_payload())
        retry = self.send(jsonb_order(ready_payload()))
        self.assertEqual(retry, first)
        self.assertEqual(len(self.resend.delivered), 1)

    def test_a_reused_key_refusal_says_it_was_already_accepted(self):
        self.resend.keys["match-ready/job-1"] = (b"{}", "email-0")
        with self.assertRaises(worker.ResendError) as caught:
            self.send(ready_payload())
        refusal = caught.exception
        self.assertTrue(refusal.already_accepted)
        self.assertIsInstance(refusal, RuntimeError)
        self.assertTrue(refusal.summary.startswith(
            "Resend 409 invalid_idempotent_request: This idempotency key"))
        self.assertEqual(self.resend.delivered, [])

    def test_other_refusals_are_not_mistaken_for_delivery(self):
        cases = [
            (response(409, {"name": "concurrent_idempotent_requests",
                            "message": "Another request is in progress."}),
             "Resend 409 concurrent_idempotent_requests: Another request is in progress."),
            (response(422, {"name": "validation_error",
                            "message": "Invalid `to` field."}),
             "Resend 422 validation_error: Invalid `to` field."),
        ]
        plain = mock.Mock(status_code=502, text="<html>Bad gateway</html>")
        plain.json.side_effect = ValueError("not json")
        cases.append((plain, "Resend 502 error: <html>Bad gateway</html>"))
        for reply, summary in cases:
            with self.subTest(summary=summary), \
                    mock.patch.object(worker.requests, "post", return_value=reply):
                with self.assertRaises(worker.ResendError) as caught:
                    self.send(ready_payload())
                self.assertFalse(caught.exception.already_accepted)
                self.assertEqual(caught.exception.summary, summary)
                self.assertNotIn("re_test_key_not_real", str(caught.exception))


class DeliverOneTests(unittest.TestCase):
    """deliver_one's decision, with its three database steps stubbed."""

    def setUp(self):
        self.item = {"job_id": "job-1", "payload": ready_payload(),
                     "attempts": 3, "lease_token": "lease"}
        self.finish = mock.Mock()
        patches = [
            mock.patch.object(delivery, "_claim", return_value=self.item),
            mock.patch.object(delivery, "_may_send", return_value=True),
            mock.patch.object(delivery, "_finish", self.finish),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def deliver(self, send):
        return delivery.deliver_one(object(), lambda *_: None, send,
                                    lambda _address: False)

    def finished_as(self):
        args, kwargs = self.finish.call_args
        return args[2], kwargs

    def test_already_accepted_is_recorded_as_sent_with_the_reason(self):
        def refused(_payload, _key):
            raise worker.ResendError(409, "invalid_idempotent_request", CONFLICT)
        with self.assertLogs(delivery.log, level="INFO") as logs:
            self.assertTrue(self.deliver(refused))
        state, kwargs = self.finished_as()
        self.assertEqual(state, "sent")
        self.assertIsNone(kwargs.get("provider_id"))
        self.assertTrue(kwargs["error"].startswith(
            "Resend 409 invalid_idempotent_request: This idempotency key"))
        self.assertIn("already accepted", logs.output[0])

    def test_a_real_refusal_stays_pending_and_keeps_resends_words(self):
        def refused(_payload, _key):
            raise worker.ResendError(422, "validation_error", "Invalid `to` field.")
        with self.assertLogs(delivery.log, level="WARNING"):
            self.assertFalse(self.deliver(refused))
        state, kwargs = self.finished_as()
        self.assertEqual(state, "pending")
        self.assertEqual(kwargs["error"],
                         "Resend 422 validation_error: Invalid `to` field.")

    def test_other_failures_keep_type_and_message_with_credentials_masked(self):
        cases = [
            (TimeoutError("read timed out"), "TimeoutError: read timed out"),
            (RuntimeError(), "RuntimeError"),
            (RuntimeError("header Bearer re_abcdef123456 was rejected"),
             "RuntimeError: header [redacted] was rejected"),
            (ValueError("key re_Live_0123456789 is wrong"),
             "ValueError: key [redacted] is wrong"),
        ]
        for error, stored in cases:
            with self.subTest(stored=stored):
                def failing(_payload, _key):
                    raise error
                with self.assertLogs(delivery.log, level="WARNING"):
                    self.assertFalse(self.deliver(failing))
                state, kwargs = self.finished_as()
                self.assertEqual(state, "pending")
                self.assertEqual(kwargs["error"], stored)

    def test_the_stored_reason_is_bounded(self):
        def failing(_payload, _key):
            raise RuntimeError("x" * 1000)
        with self.assertLogs(delivery.log, level="WARNING"):
            self.deliver(failing)
        self.assertEqual(len(self.finished_as()[1]["error"]), 300)

    def test_a_confirmed_send_is_unchanged(self):
        self.assertTrue(self.deliver(lambda _payload, _key: "email-9"))
        self.finish.assert_called_once_with(mock.ANY, self.item, "sent",
                                            provider_id="email-9")


class WorkerRetryTests(unittest.TestCase):
    """retry_match_ready end to end over FakeResend, database steps stubbed."""

    def setUp(self):
        self.resend = FakeResend()
        self.finish = mock.Mock()
        self.item = {"job_id": "job-1", "payload": jsonb_order(ready_payload()),
                     "attempts": 2, "lease_token": "lease"}
        patches = [
            mock.patch.object(worker, "RESEND_API_KEY", "re_test_key_not_real"),
            mock.patch.object(worker.requests, "post", side_effect=self.resend.post),
            mock.patch.object(worker, "address_suppressed", return_value=False),
            mock.patch.object(worker.CostMeter, "record"),
            mock.patch.object(delivery, "_claim", return_value=self.item),
            mock.patch.object(delivery, "_may_send", return_value=True),
            mock.patch.object(delivery, "_finish", self.finish),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_lost_reply_case_ends_sent_with_the_original_id(self):
        # The first attempt, before this change: accepted, reply lost.
        self.resend.post("https://api.resend.com/emails",
                         headers={"Idempotency-Key": "match-ready/job-1"},
                         json=ready_payload())
        self.assertTrue(worker.retry_match_ready(mock.MagicMock(), "job-1"))
        self.finish.assert_called_once_with(mock.ANY, self.item, "sent",
                                            provider_id="email-1")
        self.assertEqual(len(self.resend.delivered), 1)

    def test_an_unmatched_earlier_request_is_not_sent_twice(self):
        self.resend.keys["match-ready/job-1"] = (b"{\"older\": true}", "email-0")
        self.assertTrue(worker.retry_match_ready(mock.MagicMock(), "job-1"))
        args, kwargs = self.finish.call_args
        self.assertEqual(args[2], "sent")
        self.assertIn("invalid_idempotent_request", kwargs["error"])
        self.assertEqual(self.resend.delivered, [])


if __name__ == "__main__":
    unittest.main()
