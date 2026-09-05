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
            self.digest.count("any(%s::uuid[])"), 3,
            "every stamping update must cast its bound list to uuid[]: "
            "feedback_items, qa_bugs, and qa_bug_messages",
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
        self.assertIn("qa digest stamp for %s failed", body)


class CommentsRideTheSameDailyEmail(unittest.TestCase):
    """Thread replies go in the digest, not out on their own (128).

    An email per comment is the shape that sent 120 copies of one message,
    so replies are folded into the mail that already exists. Everything
    here is about the folding staying safe.
    """

    def _body(self, name):
        from pathlib import Path
        text = (Path(__file__).resolve().parents[1] / "worker.py").read_text()
        start = text.index(f"def {name}")
        return text[start:text.index("\ndef ", start + 10)]

    def setUp(self):
        self.digest = self._body("maybe_send_qa_closed_digest")

    def test_replies_are_gated_on_their_own_stamp(self):
        self.assertIn("m.digest_notified_at is null", self.digest)
        self.assertIn(
            "set digest_notified_at = now()", self.digest,
            "a reply that is mailed must be stamped, or it mails again",
        )

    def test_the_reply_stamp_casts_to_uuid(self):
        self.assertIn(
            '"where id = any(%s::uuid[])",', self.digest)
        self.assertEqual(
            self.digest.count("any(%s::uuid[])"), 3,
            "feedback, bugs and now messages all bind uuid lists",
        )

    def test_a_tester_is_never_mailed_their_own_words(self):
        self.assertIn(
            "m.author_id is distinct from b.reporter_id", self.digest,
            "only the other side's replies are news to the reporter",
        )

    def test_nothing_pending_sends_nothing_and_still_claims_the_day(self):
        i = self.digest.index("if not pending and not replies:")
        tail = self.digest[i:i + 320]
        self.assertIn("set_config", tail)
        self.assertIn("return", tail)

    def test_one_recipient_gets_one_mail_for_both_halves(self):
        # A single send_email call inside the loop, fed both lists.
        self.assertEqual(self.digest.count("send_email("), 1)
        self.assertIn("qa_digest_message(",
                      self.digest)


class DigestSubjectLine(unittest.TestCase):
    def test_counts_both_halves(self):
        import importlib.util
        from pathlib import Path
        src = Path(__file__).resolve().parents[1] / "worker.py"
        text = src.read_text()
        start = text.index("def qa_digest_subject")
        ns = {}
        exec(text[start:text.index("\ndef ", start + 10)], ns)
        subject = ns["qa_digest_subject"]
        self.assertEqual(subject(7, 2), "9 updates to your PongLens reports")
        self.assertEqual(subject(0, 1), "1 update to your PongLens reports")
        self.assertEqual(subject(1, 0), "1 update to your PongLens reports")
        self.assertEqual(subject(3, 0), "3 updates to your PongLens reports")
