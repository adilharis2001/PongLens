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
    def sent(self, e, kind, uploader_sends=True, terminal=True):
        """Run send_failure_emails; return (uploader_called, admin_called)."""
        with mock.patch.object(worker, "notify_upload_failed",
                               return_value=uploader_sends) as uploader, \
             mock.patch.object(worker, "notify_job_failed") as admin:
            worker.send_failure_emails(
                object(), e, "job-1", kind, "user-1", str(e)[:300],
                terminal=terminal)
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
                               side_effect=lambda to, rendered, **kwargs:
                               sent.update(to=to, subject=rendered.subject,
                                           body=rendered.html,
                                           text=rendered.text)), \
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
            for kind, subject in (("content_check", "We couldn't process your video"),
                                  ("youtube_import", "We couldn't process your video")):
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


# ---------------------------------------------------------------------------
# A failure nobody is left to hear about (audit C, 2026-09-26)
# ---------------------------------------------------------------------------
JOB = "33333333-3333-4333-8333-333333333333"
USER = "11111111-1111-4111-8111-111111111111"
MATCH = "22222222-2222-4222-8222-222222222222"


class JobDbCursor:
    def __init__(self, db):
        self.db = db
        self.result = None
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        sql = " ".join(query.split())
        self.db.calls.append((sql, params))
        self.result = None
        if self.db.broken:
            raise RuntimeError("connection lost")
        if sql.startswith("select status, kind, options from public.jobs"):
            self.result = (self.db.status, self.db.kind, self.db.options)
        elif sql.startswith("select options from public.jobs"):
            self.result = (self.db.options,)
        elif sql.startswith("select 1 from public.matches where id"):
            self.result = (1,) if self.db.match_exists else None
        elif sql.startswith("update public.jobs set status = 'cancelled'"):
            self.rowcount = int(self.db.status != "cancelled")
            if self.rowcount:
                self.db.status = "cancelled"
                self.db.error = params[0]

    def fetchone(self):
        return self.result


class JobDb:
    """One jobs row and whether its match still exists: the two facts the
    silent path reads before anything is recorded or sent."""

    def __init__(self, kind="hand_cut", *, status="processing",
                 match_exists=True, options=None, broken=False):
        self.kind = kind
        self.status = status
        self.match_exists = match_exists
        self.options = {"match_id": MATCH} if options is None else options
        self.broken = broken
        self.error = None
        self.calls = []
        self.autocommit = True

    def cursor(self, **kwargs):
        return JobDbCursor(self)

    def sql(self, fragment):
        return [c for c in self.calls if fragment in c[0]]


class SilentFailureTests(unittest.TestCase):
    """A job whose match the player deleted, or that was cancelled, fails
    without a word: no email to the player, no "[Action needed]" to the
    admin, no bell (the bell rides the row turning 'failed', which it never
    does), and no retries, because nothing can bring the match back."""

    def fail(self, db, error=None, *, read_ct=1):
        msg = {"msg_id": 5, "read_ct": read_ct, "message": {
            "job_id": JOB, "user_id": USER, "kind": db.kind,
            "options": dict(db.options)}}
        error = error or RuntimeError("placement attempt match not found")
        with mock.patch.object(worker, "archive_message") as archive, \
             mock.patch.object(worker, "update_job") as update, \
             mock.patch.object(worker, "send_email") as send, \
             mock.patch.object(worker, "hand_cut_release") as release, \
             mock.patch.object(worker, "refund_processing_spend_direct") as refund, \
             mock.patch.object(worker, "finalize_poisoned_placement_attempt") as finalize, \
             mock.patch.object(worker, "mark_library_match_failed") as library, \
             mock.patch.object(worker, "get_user_email",
                               return_value="player@example.com"), \
             mock.patch.object(worker, "get_job_match_id", return_value=MATCH):
            worker.record_job_failure(db, msg, error)
        return dict(archive=archive, update=update, send=send, release=release,
                    refund=refund, finalize=finalize, library=library)

    def test_every_match_job_ends_silently_when_its_match_was_deleted(self):
        for kind in sorted(worker.MATCH_BOUND_KINDS):
            for read_ct, error in ((1, RuntimeError("no match_reels row")),
                                   (worker.MAX_READ_CT, RuntimeError("gone")),
                                   (1, worker.UserFacingError(
                                       "The marks for this match could not be found."))):
                with self.subTest(kind=kind, read_ct=read_ct, error=str(error)):
                    db = JobDb(kind, match_exists=False)
                    out = self.fail(db, error, read_ct=read_ct)
                    out["send"].assert_not_called()
                    out["update"].assert_not_called()   # never 'failed'
                    out["archive"].assert_called_once_with(db, 5)
                    out["finalize"].assert_not_called()
                    self.assertEqual(db.status, "cancelled")
                    self.assertIn("deleted", db.error)
                    (sql, params), = db.sql("update public.jobs set status = 'cancelled'")
                    self.assertIn("progress = 100", sql)
                    self.assertIn("status <> 'cancelled'", sql)
                    self.assertEqual(params[1], JOB)

    def test_a_deleted_hand_cut_hands_its_marks_back(self):
        out = self.fail(JobDb("hand_cut", match_exists=False))
        out["release"].assert_called_once_with(mock.ANY, JOB, {"options": {"match_id": MATCH}})
        out["refund"].assert_not_called()

    def test_a_deleted_automatic_replace_gets_its_minutes_back(self):
        db = JobDb("match_reprocess", match_exists=False,
                   options={"match_id": MATCH, "recut": "replace"})
        out = self.fail(db)
        out["refund"].assert_called_once_with(db, JOB)
        out["release"].assert_not_called()
        # Support's reprocessing charges no personal minutes.
        db = JobDb("match_reprocess", match_exists=False,
                   options={"match_id": MATCH, "issue_id": "i"})
        self.fail(db)["refund"].assert_not_called()

    def test_a_cancelled_job_stays_cancelled_and_quiet(self):
        for kind in ("hand_cut", "deadspace_cut", "reel", "placement_generate"):
            with self.subTest(kind=kind):
                db = JobDb(kind, status="cancelled", match_exists=True)
                out = self.fail(db, worker.UserFacingError("anything"))
                out["send"].assert_not_called()
                out["update"].assert_not_called()
                out["library"].assert_not_called()
                out["archive"].assert_called_once()
                self.assertEqual(db.status, "cancelled")
                self.assertIsNone(db.error, "a cancelled row is left as it is")

    def test_a_live_match_is_still_reported(self):
        db = JobDb("hand_cut", match_exists=True)
        out = self.fail(db, worker.UserFacingError(
            "The original video could not be read."))
        out["update"].assert_called_once()
        self.assertEqual(out["update"].call_args.kwargs["status"], "failed")
        out["send"].assert_called_once()     # the player's email
        self.assertEqual(db.status, "processing")

    def test_a_deleted_upload_keeps_its_own_rule(self):
        """Processing an upload whose row was deleted is still reported
        (check_match_row_alive): only a job ABOUT an existing match is
        moot by its match's absence."""
        db = JobDb("deadspace_cut", match_exists=False)
        out = self.fail(db, worker.UserFacingError(
            "This video was removed before processing started."))
        out["update"].assert_called_once()
        out["send"].assert_called()

    def test_a_reel_with_no_match_is_not_moot_by_absence(self):
        db = JobDb("reel", match_exists=False, options={"scope": "v:selection"})
        self.assertIsNone(worker.moot_job(db, JOB))

    def test_the_check_fails_open(self):
        """A lookup that breaks must never swallow a real failure."""
        self.assertIsNone(worker.moot_job(JobDb(broken=True), JOB))
        self.assertIsNone(worker.moot_job(object(), JOB))
        self.assertIsNone(worker.moot_job(JobDb(), None))

    def test_moot_reasons(self):
        self.assertEqual(worker.moot_job(JobDb(status="cancelled"), JOB)["reason"],
                         "cancelled")
        self.assertEqual(worker.moot_job(JobDb(match_exists=False), JOB)["reason"],
                         "match_deleted")
        self.assertIsNone(worker.moot_job(JobDb(), JOB))
        self.assertIsNone(worker.moot_job(
            JobDb(match_exists=False, options={"match_id": "not-a-uuid"}), JOB))


class SilentNotifyTests(unittest.TestCase):
    """The three senders ask again themselves, so no caller can reach a
    player or the admin about a match that no longer exists."""

    def send(self, fn, db, *args):
        with mock.patch.object(worker, "send_email") as send, \
             mock.patch.object(worker, "get_user_email",
                               return_value="player@example.com"), \
             mock.patch.object(worker, "get_job_match_id", return_value=MATCH):
            fn(db, *args)
        return send

    def test_nothing_is_sent_about_a_deleted_match(self):
        cases = (
            (worker.notify_hand_cut_failed, "hand_cut", (USER, JOB, "x")),
            (worker.notify_auto_recut_failed, "match_reprocess", (USER, JOB)),
            (worker.notify_job_failed, "reel", (JOB, "no match_reels row")),
        )
        for fn, kind, args in cases:
            with self.subTest(fn=fn.__name__):
                self.send(fn, JobDb(kind, match_exists=False), *args).assert_not_called()
                self.send(fn, JobDb(kind, status="cancelled"), *args).assert_not_called()
                self.send(fn, JobDb(kind), *args).assert_called_once()

    def test_send_failure_emails_stops_before_either_email(self):
        with mock.patch.object(worker, "notify_hand_cut_failed") as player, \
             mock.patch.object(worker, "notify_job_failed") as admin:
            worker.send_failure_emails(
                JobDb("hand_cut", match_exists=False), RuntimeError("x"), JOB,
                "hand_cut", USER, None, terminal=True)
        player.assert_not_called()
        admin.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class RetryNoiseTests(unittest.TestCase):
    """An attempt that will run again is not news (2026-09-09).

    A missing upload used to send four emails for one event: the player and
    the admin, twice each, thirty minutes apart, because every attempt spoke
    for itself.
    """

    def test_a_failure_that_will_be_retried_emails_nobody(self):
        for kind in ("deadspace_cut", "youtube_import", "content_check",
                     "hand_cut", "placement_generate"):
            with self.subTest(kind=kind):
                uploader, admin = SendFailureEmailsTests().sent(
                    RuntimeError("404 HeadObject: Not Found"), kind,
                    terminal=False)
                self.assertFalse(uploader)
                self.assertFalse(admin)

    def test_the_last_attempt_still_tells_both(self):
        uploader, admin = SendFailureEmailsTests().sent(
            RuntimeError("404 HeadObject: Not Found"), "content_check",
            uploader_sends=True, terminal=True)
        self.assertTrue(uploader)
        self.assertTrue(admin, "a crash the uploader email withholds still "
                               "needs the admin's copy")

    def test_a_deterministic_failure_is_terminal_on_its_first_attempt(self):
        """The private-video and wrong-sport messages must not wait for a
        retry that will never happen."""
        uploader, admin = SendFailureEmailsTests().sent(
            worker.UserFacingError(worker.CONTENT_CHECK_REJECT_MSG),
            "content_check", terminal=True)
        self.assertTrue(uploader)
        self.assertFalse(admin)
