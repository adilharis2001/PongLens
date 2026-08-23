"""One failed upload, one email.

A rejected upload used to send two: the content check failed with "this
doesn't look like table tennis" (uploader email plus a separate admin
copy), and when processing had been claimed, the deadspace job then died
on the deleted row and emailed again. send_failure_emails now owns the
decision: the uploader hears once, the admin rides that email's bcc, and
the separate admin copy is reserved for what the uploader email can't
carry — a crash's real error, or a failure that reached no inbox.
"""
import html
import unittest
from unittest import mock

import worker.worker as worker


class ScriptedCursor:
    """Context-manager cursor answering fetchone() from a script."""

    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.calls.append((normalized, params))
        self._result = self.connection.results.pop(0)

    def fetchone(self):
        return self._result


class ScriptedConnection:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def cursor(self):
        return ScriptedCursor(self)


class SendFailureEmailsTests(unittest.TestCase):
    def sent(self, e, kind, uploader_sends=True):
        """Run send_failure_emails; return (uploader_called, admin_called)."""
        with mock.patch.object(worker, "notify_upload_failed",
                               return_value=uploader_sends) as uploader, \
             mock.patch.object(worker, "notify_job_failed") as admin:
            worker.send_failure_emails(
                object(), e, "job-1", kind, "user-1", str(e)[:300])
        return uploader.called, admin.called

    def test_content_check_rejection_sends_one_email(self):
        uploader, admin = self.sent(
            worker.UserFacingError(worker.CONTENT_CHECK_REJECT_MSG),
            "content_check")
        self.assertTrue(uploader)
        self.assertFalse(admin)

    def test_broadcast_rejection_sends_one_email(self):
        for kind in ("content_check", "youtube_import", "deadspace_cut"):
            with self.subTest(kind=kind):
                uploader, admin = self.sent(
                    worker.UserFacingError(worker.BROADCAST_REJECT_MSG), kind)
                self.assertTrue(uploader)
                self.assertFalse(admin)

    def test_echo_failure_sends_nothing(self):
        uploader, admin = self.sent(
            worker.UserFacingError(worker.CONTENT_CHECK_REJECT_MSG,
                                   already_reported=True),
            "deadspace_cut")
        self.assertFalse(uploader)
        self.assertFalse(admin)

    def test_a_crash_still_reaches_both(self):
        uploader, admin = self.sent(RuntimeError("boom"), "deadspace_cut")
        self.assertTrue(uploader)
        self.assertTrue(admin)

    def test_no_uploader_inbox_keeps_the_admin_copy(self):
        uploader, admin = self.sent(
            worker.UserFacingError("That video is private or unavailable."),
            "youtube_import", uploader_sends=False)
        self.assertTrue(uploader)   # attempted, found no address
        self.assertTrue(admin)

    def test_background_kinds_stay_admin_only(self):
        uploader, admin = self.sent(RuntimeError("boom"), "placement_generate")
        self.assertFalse(uploader)
        self.assertTrue(admin)


class GateRefusalReachesTheUploader(unittest.TestCase):
    """A refusal the uploader never reads is a video that vanished.

    notify_upload_failed passes the message straight through, so a new gate
    needs no email work of its own — but only as long as it refuses with a
    UserFacingError whose text is the thing to say. This renders the real
    email for every registered gate message and looks for that text in it.
    """

    def _render(self, message, kind):
        sent = {}
        with mock.patch.object(worker, "send_email",
                               side_effect=lambda to, subj, body, bcc=None:
                               sent.update(to=to, subject=subj, body=body)), \
             mock.patch.object(worker, "get_user_email",
                               return_value="player@example.com"), \
             mock.patch.object(worker, "failure_watchers", return_value=[]):
            ok = worker.notify_upload_failed(None, "u1", kind, message)
        return ok, sent

    def test_every_gate_message_reaches_the_uploader(self):
        # The card escapes what it is given, which is why the body is
        # unescaped before looking for the message: the assertion is about
        # what the reader sees, not how it is encoded. Without this, a
        # message is only findable when it happens to contain no
        # apostrophe, which the table tennis one does.
        for message in worker.GATE_REJECT_MSGS:
            for kind, subject in (("content_check", "Upload failed"),
                                  ("youtube_import", "Import failed")):
                with self.subTest(kind=kind, message=message[:40]):
                    ok, sent = self._render(message, kind)
                    self.assertTrue(ok)
                    self.assertEqual(sent["subject"], subject)
                    self.assertIn(message, html.unescape(sent["body"]))
                    self.assertIn("/upload", sent["body"])

    def test_the_message_is_escaped_on_the_way_in(self):
        """The uploader's own words never reach this email, but the escaping
        is what makes that safe to keep assuming."""
        ok, sent = self._render("<script>x</script> & 'quoted'",
                                "content_check")
        self.assertTrue(ok)
        self.assertNotIn("<script>", sent["body"])

    def test_a_refusal_with_no_uploader_on_file_is_not_an_error(self):
        with mock.patch.object(worker, "get_user_email", return_value=None), \
             mock.patch.object(worker, "send_email") as send:
            self.assertFalse(worker.notify_upload_failed(
                None, "u1", "content_check", worker.BROADCAST_REJECT_MSG))
        send.assert_not_called()


class ContentCheckEchoDetectionTests(unittest.TestCase):
    """The deadspace job asks whether the content check killed its work.

    The ORDER of the two lookups is load-bearing and these scripted
    connections pin it. Rejection is asked FIRST, row existence second,
    because a rejected match now keeps its row (127) so the uploader can
    open it and read why. Asking "does the row exist" first would answer
    yes and let this job march on to download a raw that was deleted
    seconds earlier.
    """

    MATCH = "65d330ab-3d8d-4101-b259-2eb5bf26e901"

    def test_rejected_match_raises_the_flagged_error(self):
        conn = ScriptedConnection(  # rejection found; row never asked
            [(worker.CONTENT_CHECK_REJECT_MSG,)])
        with self.assertRaises(worker.UserFacingError) as ctx:
            worker.check_match_row_alive(conn, self.MATCH)
        self.assertTrue(ctx.exception.already_reported)
        self.assertEqual(str(ctx.exception), worker.CONTENT_CHECK_REJECT_MSG)
        self.assertEqual(len(conn.calls), 1,
                         "a known rejection short-circuits the row lookup")

    def test_a_broadcast_rejection_echoes_its_own_words(self):
        """The lookup used to match one literal message, so a broadcast
        rejection went unrecognised: this job would have failed as an
        ordinary error and emailed the uploader a second refusal for the
        same upload. It reads back whichever message the gate used."""
        conn = ScriptedConnection([(worker.BROADCAST_REJECT_MSG,)])
        with self.assertRaises(worker.UserFacingError) as ctx:
            worker.check_match_row_alive(conn, self.MATCH)
        self.assertTrue(ctx.exception.already_reported)
        self.assertEqual(str(ctx.exception), worker.BROADCAST_REJECT_MSG)

    def test_every_gate_message_is_recognised(self):
        """A new gate that forgets to register its message here is a
        duplicate email to the uploader, which is why the list is asserted
        rather than the two members."""
        for message in worker.GATE_REJECT_MSGS:
            with self.subTest(message=message[:40]):
                conn = ScriptedConnection([(message,)])
                with self.assertRaises(worker.UserFacingError) as ctx:
                    worker.check_match_row_alive(conn, self.MATCH)
                self.assertEqual(str(ctx.exception), message)
                self.assertTrue(ctx.exception.already_reported)

    def test_user_deleted_match_stays_a_reported_failure(self):
        conn = ScriptedConnection([None, None])  # no rejection, row gone
        with self.assertRaises(worker.UserFacingError) as ctx:
            worker.check_match_row_alive(conn, self.MATCH)
        self.assertFalse(ctx.exception.already_reported)

    def test_live_match_passes(self):
        conn = ScriptedConnection([None, (1,)])  # no rejection, row present
        worker.check_match_row_alive(conn, self.MATCH)
        self.assertEqual(len(conn.calls), 2)


if __name__ == "__main__":
    unittest.main()
