import unittest


class DigestStampingSql(unittest.TestCase):
    """The digest's bookkeeping, which is what stops it repeating.

    Both id columns are uuid, and psycopg2 adapts a list of Python strings
    to text[]. `uuid = any(text[])` has no operator, so the stamping query
    raised every time it ran, which meant closed_notified_at was never
    written and the same digest went out on every worker cycle. One tester
    received 120 copies of one email over thirty hours.

    Asserted as text rather than executed because these are the only two
    places in the worker that compare a uuid column against a bound list,
    and the failure is invisible until real rows are closed.
    """

    def setUp(self):
        from pathlib import Path
        source = Path(__file__).resolve().parents[1] / "worker.py"
        self.text = source.read_text()
        start = self.text.index("def maybe_send_qa_closed_digest")
        self.digest = self.text[start:self.text.index("\ndef ", start + 10)]

    def test_uuid_columns_are_compared_against_a_cast_array(self):
        for table in ("public.feedback_items", "public.qa_bugs"):
            with self.subTest(table=table):
                self.assertIn(table, self.digest)
        self.assertEqual(
            self.digest.count("any(%s::uuid[])"), 2,
            "both stamping updates must cast the bound list to uuid[]",
        )
        self.assertNotIn(
            "where id = any(%s)", self.digest,
            "an uncast list adapts to text[] and cannot match a uuid column",
        )

    def test_ids_are_stringified_before_binding(self):
        self.assertIn('str(i["id"])', self.digest)


class DigestRunsAtMostOncePerDay(unittest.TestCase):
    """The day guard has to survive whatever happens after it.

    It used to be written only once the send loop had finished cleanly, so
    any exception in that loop skipped it and the next cycle fifteen
    minutes later started over. Claiming the day first caps a broken run at
    one attempt instead of ninety-six.
    """

    def _body(self, name):
        from pathlib import Path
        text = (Path(__file__).resolve().parents[1] / "worker.py").read_text()
        start = text.index(f"def {name}")
        return text[start:text.index("\ndef ", start + 10)]

    def test_qa_digest_claims_the_day_before_sending(self):
        body = self._body("maybe_send_qa_closed_digest")
        claim = body.index('set_config(conn, "qa_closed_digest_last_sent", today)\n\n        for email')
        send = body.index("send_email(")
        self.assertLess(claim, send, "the day must be claimed before any send")

    def test_feedback_digest_claims_the_day_before_sending(self):
        body = self._body("maybe_send_feedback_digest")
        self.assertLess(
            body.index('set_config(conn, "digest_last_sent", today)'),
            body.index("send_email("),
            "same trap, same guard: a throwing send must not replay tomorrow's"
            " chance at it every quarter hour",
        )

    def test_a_stamp_failure_cannot_take_out_the_other_recipients(self):
        body = self._body("maybe_send_qa_closed_digest")
        self.assertIn("qa closed digest stamp for %s failed", body)
