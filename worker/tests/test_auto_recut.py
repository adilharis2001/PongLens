"""Cutting a processed match again automatically, replacing it (Cut again,
phase 2, 2026-09-25).

Design: docs/superpowers/specs/2026-09-25-cut-again-design.md (items 6-sweep,
12, 13). The database half (the claim, the charge and refund, publication,
the swap, the sweep's selection and its never-delete rules) is proved on a
real Postgres by supabase/tests/cut_again_auto.sql; this is the main lane's
half:

- a player's automatic Replace runs the pipeline a fresh upload runs, the
  body-first assembler included, reports the ordinary stages, and writes
  ONLY its candidate (the cut under results/<user>/<match>/versions/,
  clips and match.json under points/<user>/<match>/versions/<version>/),
  counted in the player's storage, published through publish_auto_recut;
- support's reprocessing candidates get the body-first assembler too;
- on success the ordinary ready email goes out once, from whoever made the
  new cut live (this run, its short retry, or the lanes' sweep);
- on failure only the candidate fails, the minutes come back, and the
  player is told the match is unchanged; nothing is sent when there was no
  candidate left to fail;
- the retired-version sweep removes a replaced cut's files and nothing
  that anything else still uses, and never the original.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import worker.worker as worker
from worker.email_templates import auto_recut_failed_message, render_email

USER = "11111111-1111-4111-8111-111111111111"
MATCH = "22222222-2222-4222-8222-222222222222"
JOB = "33333333-3333-4333-8333-333333333333"
VERSION = "44444444-4444-4444-8444-444444444444"
SOURCE = "55555555-5555-4555-8555-555555555555"
RAW = f"r2://ponglens-raw/{USER}/source.mov"
PREFIX = f"points/{USER}/{MATCH}/versions/{VERSION}"
CUT_KEY = f"results/{USER}/{MATCH}/versions/{VERSION}.mp4"


def receipt(activated=True, live=None, points=4):
    live = activated if live is None else live
    return {"ok": True, "contractVersion": 1, "matchId": MATCH, "jobId": JOB,
            "processingVersionId": VERSION, "pointCount": points,
            "activated": activated, "live": live,
            "scoreRevision": 7 if activated else None,
            "scoreProjectionStatus": "current" if activated else None}


def destination(**overrides):
    values = dict(
        match_id=MATCH, user_id=USER, job_id=JOB, source_path=RAW,
        options={"match_id": MATCH, "strictness": "normal", "placement": True,
                 "points": True, "trim_start_s": 0, "trim_end_s": 300,
                 "recut": "replace"},
        match_state={"status": "ready", "first_server": "user"},
        source_version_id=SOURCE, processing_version_id=VERSION,
        player_recut=True,
    )
    values.update(overrides)
    return worker.MatchProcessingDestination(**values)


class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.result = None
        self.results = []
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        sql = " ".join(query.split())
        self.conn.calls.append((sql, params))
        self.result, self.results = None, []
        for needle, error in self.conn.fail_on.items():
            if needle in sql:
                raise error
        for needle, value in self.conn.answers.items():
            if needle in sql:
                value = value(params) if callable(value) else value
                if isinstance(value, list):
                    self.results = value
                else:
                    self.result = value
                return
        if "public.matches" in sql and sql.lstrip().startswith(("update", "insert", "delete")):
            raise AssertionError("an automatic re-cut must never write the match row")

    def fetchone(self):
        return self.result

    def fetchall(self):
        return self.results


class Conn:
    def __init__(self, answers=None, fail_on=None):
        self.calls = []
        self.answers = dict(answers or {})
        self.fail_on = dict(fail_on or {})
        self.autocommit = True
        self.commits = 0
        self.rollbacks = 0

    def cursor(self, **kwargs):
        return Cursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def sql(self, needle):
        return [c for c in self.calls if needle in c[0]]


class DestinationTests(unittest.TestCase):
    def test_a_players_candidate_needs_no_support_request(self):
        d = destination()
        self.assertFalse(d.activates_match)
        self.assertTrue(d.full_pipeline)
        self.assertEqual(d.storage_prefix, PREFIX)
        self.assertEqual(d.cut_key, CUT_KEY)

    def test_support_candidates_keep_their_request_and_their_stages(self):
        d = destination(player_recut=False, issue_id="66666666-6666-4666-8666-666666666666")
        self.assertFalse(d.full_pipeline)
        with self.assertRaisesRegex(ValueError, "candidate destination"):
            destination(player_recut=False)
        with self.assertRaisesRegex(ValueError, "no support request"):
            destination(issue_id="66666666-6666-4666-8666-666666666666")
        with self.assertRaisesRegex(ValueError, "never the active match"):
            destination(activates_match=True)

    def test_the_publication_holder_is_shared_by_the_workflows_copies(self):
        d = destination()
        copy = worker.replace(d, release_id="r", effective_settings={"a": 1})
        copy.publication["receipt"] = receipt()
        self.assertIs(d.publication, copy.publication)
        self.assertEqual(d, worker.replace(d))

    def test_the_candidate_is_read_from_the_version_row(self):
        record = {"match_id": MATCH, "user_id": USER, "job_id": JOB,
                  "source_version_id": SOURCE, "processing_version_id": VERSION,
                  "raw_path": RAW, "options": {"match_id": MATCH},
                  "match_state": {"status": "ready"}}
        conn = Conn({"jsonb_build_object": (record,)})
        d = worker.load_auto_recut_destination(conn, JOB)
        self.assertTrue(d.player_recut)
        self.assertIsNone(d.issue_id)
        self.assertEqual((d.match_id, d.processing_version_id, d.source_path),
                         (MATCH, VERSION, RAW))
        sql = conn.calls[0][0]
        for clause in ("v.status = 'candidate'", "m.status = 'ready'",
                       "m.active_processing_version_id = v.source_version_id",
                       "v.issue_id is null", "not (j.options ? 'issue_id')",
                       "j.kind = 'match_reprocess'"):
            self.assertIn(clause, sql)
        with self.assertRaisesRegex(RuntimeError, "no longer has its candidate"):
            worker.load_auto_recut_destination(Conn({"jsonb_build_object": None}), JOB)

    def test_status_says_whose_job_it_is(self):
        self.assertEqual(worker.auto_recut_status(
            Conn({"select v.status": ("ready",)}), JOB), "ready")
        self.assertIsNone(worker.auto_recut_status(
            Conn({"select v.status": None}), JOB))


class FakeR2:
    def __init__(self):
        self.uploads = []
        self.downloads = []

    def download_file(self, bucket, key, path):
        self.downloads.append((bucket, key))
        Path(path).write_bytes(b"raw")

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.uploads.append(key)


class WorkflowTests(unittest.TestCase):
    """run_match_processing_workflow with the media boundaries replaced."""

    def run_workflow(self, d, pipeline="bodies"):
        r2 = FakeR2()
        stages = []
        ledger = []
        conn = Conn()
        settings = (False, None, {"pipeline": pipeline, "attempt_key": "a"},
                    {"requested_pipeline": pipeline, "pipeline": pipeline})
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(worker, "processing_pipeline_settings", return_value=settings), \
                mock.patch.object(worker, "publish_processing_run"), \
                mock.patch.object(worker, "r2", return_value=r2), \
                mock.patch.object(worker, "detect_ball", return_value="blurball.json"), \
                mock.patch.object(worker, "run_points_subprocess", return_value=directory), \
                mock.patch.object(worker, "run_body_points_pass", return_value=directory) as bodies, \
                mock.patch.object(worker, "run_cut", return_value=str(Path(directory) / "cut.mp4")), \
                mock.patch.object(worker.cut_timeline, "reconcile_file"), \
                mock.patch.object(worker, "run_match_structure_stage", return_value=None), \
                mock.patch.object(worker, "extract_thumb", return_value=False), \
                mock.patch.object(worker, "merge_card_audio"), \
                mock.patch.object(worker, "publish_card_diagnosis", return_value=0), \
                mock.patch.object(worker, "update_job"), \
                mock.patch.object(worker, "pulse_stage", side_effect=lambda s, *a, **k: stages.append(s)), \
                mock.patch.object(worker, "_record_video_profile",
                                  side_effect=AssertionError("a re-cut is not an upload profile")), \
                mock.patch.object(worker, "ledger_append",
                                  side_effect=lambda *a, **k: ledger.append(a)), \
                mock.patch.object(worker, "insert_points",
                                  return_value={1: {"id": "p1"}}) as points, \
                mock.patch.object(worker, "finalize_auto_recut_success") as publish, \
                mock.patch.object(worker, "finalize_match_reprocess_success") as support:
            Path(directory, "cut.mp4").write_bytes(b"cut")
            Path(directory, "match.json").write_text(json.dumps({
                "points": [{"idx": 1, "t0": 1, "t1": 2, "clip": "01.mp4", "cut_t0": 0}],
                "options": {"clip_pads": {"pre": 1, "post": 2}}}))
            Path(directory, "01.mp4").write_bytes(b"clip")
            worker.run_match_processing_workflow(conn, d, "input.mov", directory,
                                                 attempt_key="a")
        return dict(r2=r2, stages=stages, ledger=ledger, bodies=bodies,
                    publish=publish, support=support, conn=conn, points=points)

    def test_a_replace_runs_the_upload_pipeline_into_its_candidate(self):
        out = self.run_workflow(destination())
        out["bodies"].assert_called_once()
        for stage in ("ball", "points", "cut", "upload", "publish"):
            self.assertIn(stage, out["stages"])
        self.assertFalse([s for s in out["stages"] if s and s.startswith("candidate_")])
        self.assertIn(CUT_KEY, out["r2"].uploads)
        self.assertIn(f"{PREFIX}/01.mp4", out["r2"].uploads)
        self.assertIn(f"{PREFIX}/match.json", out["r2"].uploads)
        self.assertFalse([k for k in out["r2"].uploads
                          if k.startswith(f"points/{USER}/{MATCH}/")
                          and "/versions/" not in k])
        out["support"].assert_not_called()
        self.assertEqual(out["points"].call_args.kwargs["processing_version_id"], VERSION)
        kwargs = out["publish"].call_args.kwargs
        self.assertEqual(kwargs["cut_path"], f"r2://{worker.R2_MEDIA_BUCKET}/{CUT_KEY}")
        self.assertEqual(kwargs["match_json_path"],
                         f"r2://{worker.R2_MEDIA_BUCKET}/{PREFIX}/match.json")
        self.assertEqual(kwargs["point_indices"], [1])
        self.assertEqual(kwargs["match_state"]["clip_pads"], {"pre": 1, "post": 2})

    def test_its_files_count_in_the_players_storage(self):
        ledger = self.run_workflow(destination())["ledger"]
        kinds = {(row[2], row[4], row[5] if len(row) > 5 else None) for row in ledger}
        self.assertIn(("cut", f"r2://{worker.R2_MEDIA_BUCKET}/{CUT_KEY}", MATCH), kinds)
        self.assertIn(("clip", f"r2://{worker.R2_MEDIA_BUCKET}/{PREFIX}/", MATCH), kinds)
        self.assertIn(("other", f"r2://{worker.R2_MEDIA_BUCKET}/{PREFIX}/", MATCH), kinds)

    def test_support_candidates_get_the_body_first_assembler_too(self):
        out = self.run_workflow(destination(
            player_recut=False, issue_id="66666666-6666-4666-8666-666666666666"))
        out["bodies"].assert_called_once()
        self.assertIn("candidate_points", out["stages"])
        out["support"].assert_called_once()
        out["publish"].assert_not_called()
        self.assertEqual(out["ledger"], [])

    def test_the_body_pass_only_runs_when_the_pipeline_asks(self):
        self.run_workflow(destination(), pipeline="v2")["bodies"].assert_not_called()


class FinalizeTests(unittest.TestCase):
    def test_publication_is_one_transaction_and_keeps_the_receipt(self):
        conn = Conn({"publish_auto_recut": (receipt(),)})
        d = worker.replace(destination(), release_id="rel", effective_settings={"x": 1})
        value = worker.finalize_auto_recut_success(
            conn, d, cut_path="r2://c", thumb_path=None, match_json_path="r2://j",
            match_state={"status": "ready"}, point_indices=[1, 2])
        self.assertEqual(value, receipt())
        self.assertEqual(destination().publication, {})
        self.assertIs(d.publication["receipt"], value)
        self.assertEqual(conn.commits, 1)
        self.assertTrue(conn.autocommit)
        delete, publish = conn.calls
        self.assertIn("match_id = %s and processing_version_id = %s", delete[0])
        self.assertEqual(delete[1], (MATCH, VERSION, [1, 2]))
        self.assertEqual(publish[1][0], JOB)
        self.assertEqual(json.loads(publish[1][5]), {"x": 1})
        self.assertEqual(publish[1][6], "rel")

    def test_a_bad_receipt_rolls_back(self):
        conn = Conn({"publish_auto_recut": ({"ok": True},)})
        with self.assertRaisesRegex(RuntimeError, "receipt"):
            worker.finalize_auto_recut_success(
                conn, destination(), cut_path="r2://c", thumb_path=None,
                match_json_path="r2://j", match_state={}, point_indices=[1])
        self.assertEqual((conn.commits, conn.rollbacks), (0, 1))
        self.assertTrue(conn.autocommit)


class GoingLiveTests(unittest.TestCase):
    def test_the_retry_stops_when_live_and_says_who_made_it_live(self):
        answers = iter([receipt(False), receipt(True)])
        conn = Conn({"activate_auto_recut": lambda p: (next(answers),)})
        with mock.patch.object(worker.time, "sleep"), \
                mock.patch.object(worker, "pulse_stage") as pulse:
            self.assertTrue(worker._make_auto_recut_live(conn, JOB))
        pulse.assert_called_with("recut_activate")
        self.assertEqual(len(conn.sql("activate_auto_recut")), 2)

    def test_live_by_someone_else_is_not_ours_to_announce(self):
        conn = Conn({"activate_auto_recut": (receipt(False, live=True),)})
        with mock.patch.object(worker.time, "sleep"), mock.patch.object(worker, "pulse_stage"):
            self.assertFalse(worker._make_auto_recut_live(conn, JOB))

    def test_still_waiting_is_left_to_the_sweep_and_never_raises(self):
        conn = Conn(fail_on={"activate_auto_recut": RuntimeError("deadlock")})
        with mock.patch.object(worker.time, "sleep"), mock.patch.object(worker, "pulse_stage"):
            self.assertFalse(worker._make_auto_recut_live(conn, JOB))
        self.assertEqual(len(conn.calls), worker.AUTO_RECUT_ACTIVATE_TRIES - 1)

    def test_the_sweep_emails_what_it_made_live(self):
        made = [{"job_id": JOB, "user_id": USER, "match_id": MATCH}]
        conn = Conn({"activate_pending_auto_recuts": (made,)})
        with mock.patch.object(worker, "notify_job_done") as email:
            self.assertEqual(worker.activate_pending_auto_recuts(conn), made)
        email.assert_called_once_with(conn, JOB, USER)

    def test_the_sweep_never_raises(self):
        conn = Conn(fail_on={"activate_pending_auto_recuts": RuntimeError("down")})
        self.assertEqual(worker.activate_pending_auto_recuts(conn), [])

    def test_both_match_lanes_sweep_and_the_hand_lane_does_not(self):
        source = Path(worker.__file__).read_text()
        self.assertIn('auto_recut_sweep = LANE in ("main", "fast")', source)
        self.assertIn("activate_pending_auto_recuts(conn)  # never raises", source)


class RunTests(unittest.TestCase):
    """process_auto_recut and run_auto_recut_job with the workflow replaced."""

    def process(self, publication, *, trim=(0, 300), duration=300.0):
        d = destination(options={**destination().options,
                                 "trim_start_s": trim[0], "trim_end_s": trim[1]})
        r2 = FakeR2()

        def workflow(conn, dest, local_input, workdir, **kwargs):
            dest.publication["receipt"] = publication
            workflow.kwargs = kwargs
            workflow.local_input = local_input

        with mock.patch.object(worker, "r2", return_value=r2), \
                mock.patch.object(worker, "update_job"), \
                mock.patch.object(worker, "pulse_stage"), \
                mock.patch.object(worker, "probe_duration_s", return_value=duration), \
                mock.patch.object(worker, "apply_trim", return_value="trimmed.mov") as trim_call, \
                mock.patch.object(worker, "run_match_processing_workflow", side_effect=workflow), \
                mock.patch.object(worker, "_make_auto_recut_live", return_value=True) as retry, \
                mock.patch.object(worker, "notify_job_done") as email, \
                mock.patch.object(worker, "run_side_change_stage") as sides:
            live = worker.process_auto_recut(Conn(), JOB, "a", d)
        return dict(live=live, r2=r2, trim=trim_call, retry=retry, email=email,
                    sides=sides, workflow=workflow)

    def test_made_live_at_once_sends_the_ready_email_and_runs_side_changes(self):
        out = self.process(receipt(True))
        self.assertTrue(out["live"])
        self.assertEqual(out["r2"].downloads, [("ponglens-raw", f"{USER}/source.mov")])
        out["retry"].assert_not_called()
        out["email"].assert_called_once_with(mock.ANY, JOB, USER)
        out["sides"].assert_called_once()
        out["trim"].assert_not_called()

    def test_the_claimed_window_is_cut_first(self):
        out = self.process(receipt(True), trim=(30, 150))
        out["trim"].assert_called_once_with(mock.ANY, mock.ANY, 30.0, 150.0)
        self.assertEqual(out["workflow"].local_input, "trimmed.mov")
        self.assertEqual(out["workflow"].kwargs["profile_offset_s"], 30.0)

    def test_waiting_retries_then_emails_only_if_this_run_made_it_live(self):
        out = self.process(receipt(False))
        out["retry"].assert_called_once()
        out["email"].assert_called_once()

    def test_live_by_the_sweep_first_sends_nothing_here(self):
        out = self.process(receipt(False, live=True))
        out["retry"].assert_not_called()
        out["email"].assert_not_called()
        out["sides"].assert_not_called()
        self.assertFalse(out["live"])

    def msg(self, read_ct=1):
        return {"msg_id": 9, "read_ct": read_ct,
                "message": {"job_id": JOB, "user_id": "queue-user-does-not-matter",
                            "kind": "match_reprocess", "input_path": "r2://x/y"}}

    def job(self, status="candidate", *, process=None, fail=True, read_ct=1):
        conn = Conn({"fail_auto_recut": (fail,),
                     "select user_id::text from public.jobs": (USER,)})
        with mock.patch.object(worker, "load_auto_recut_destination",
                               return_value=destination()), \
                mock.patch.object(worker, "process_auto_recut",
                                  side_effect=process or (lambda *a: True)), \
                mock.patch.object(worker, "archive_message") as archive, \
                mock.patch.object(worker, "notify_auto_recut_failed") as player, \
                mock.patch.object(worker, "notify_job_failed") as admin, \
                mock.patch.object(worker, "activate_auto_recut",
                                  return_value=receipt(True)) as swap, \
                mock.patch.object(worker, "notify_job_done") as ready:
            worker.run_auto_recut_job(conn, self.msg(read_ct), JOB, "a", status)
        return dict(conn=conn, archive=archive, player=player, admin=admin,
                    swap=swap, ready=ready)

    def test_success_archives_and_sends_no_failure(self):
        out = self.job()
        out["archive"].assert_called_once()
        out["player"].assert_not_called()
        self.assertFalse(out["conn"].sql("fail_auto_recut"))

    def test_a_failure_fails_only_the_candidate_refunds_and_says_so(self):
        out = self.job(process=RuntimeError("decoder stopped"))
        (sql, params), = out["conn"].sql("fail_auto_recut")
        self.assertEqual(params, (JOB, "decoder stopped"))
        out["archive"].assert_called_once()
        out["player"].assert_called_once_with(mock.ANY, USER, JOB)
        out["admin"].assert_called_once_with(mock.ANY, JOB, "decoder stopped")

    def test_nothing_left_to_fail_sends_nothing(self):
        out = self.job(process=RuntimeError("after publication"), fail=False)
        out["archive"].assert_called_once()
        out["player"].assert_not_called()
        out["admin"].assert_not_called()

    def test_failed_bookkeeping_leaves_the_message_for_another_delivery(self):
        conn = Conn(fail_on={"fail_auto_recut": RuntimeError("db gone")})
        with mock.patch.object(worker, "load_auto_recut_destination",
                               side_effect=RuntimeError("x")), \
                mock.patch.object(worker, "archive_message") as archive, \
                mock.patch.object(worker, "notify_auto_recut_failed") as player:
            worker.run_auto_recut_job(conn, self.msg(), JOB, "a", "candidate")
        archive.assert_not_called()
        player.assert_not_called()

    def test_a_job_that_keeps_dying_gives_up_refunded(self):
        out = self.job(read_ct=worker.MAX_READ_CT + 1,
                       process=AssertionError("must not run again"))
        self.assertTrue(out["conn"].sql("fail_auto_recut"))
        out["player"].assert_called_once()

    def test_a_published_candidate_only_needs_the_swap(self):
        out = self.job("ready", process=AssertionError("must not rebuild"))
        out["swap"].assert_called_once()
        out["ready"].assert_called_once_with(mock.ANY, JOB, USER)
        out["archive"].assert_called_once()
        for status in ("active", "failed", "superseded"):
            out = self.job(status, process=AssertionError("must not rebuild"))
            out["swap"].assert_not_called()
            out["archive"].assert_called_once()


class DispatchTests(unittest.TestCase):
    def dispatch(self, status):
        msg = {"msg_id": 3, "read_ct": 1,
               "message": {"job_id": JOB, "user_id": USER, "kind": "match_reprocess",
                           "input_path": RAW}}
        conn = Conn({"set status = 'processing'": (JOB,), "select v.status": status})
        with mock.patch.object(worker, "ProcessingTelemetry",
                               side_effect=RuntimeError("no telemetry"), create=True), \
                mock.patch.object(worker, "pulse_job"), \
                mock.patch.object(worker, "run_auto_recut_job") as recut, \
                mock.patch.object(worker, "load_match_reprocess_destination",
                                  side_effect=RuntimeError("support path")) as support, \
                mock.patch.object(worker, "archive_message"):
            try:
                worker.process_job(conn, msg)
            except RuntimeError as error:
                self.assertEqual(str(error), "support path")
        return recut, support

    def test_a_players_replace_goes_to_its_own_handler(self):
        recut, support = self.dispatch(("candidate",))
        recut.assert_called_once_with(mock.ANY, mock.ANY, JOB, mock.ANY, "candidate")
        support.assert_not_called()

    def test_support_reprocessing_is_unchanged(self):
        recut, support = self.dispatch(None)
        recut.assert_not_called()
        support.assert_called_once()


class FailureEmailTests(unittest.TestCase):
    def test_the_email_says_the_match_is_unchanged_and_the_minutes_are_back(self):
        rendered = render_email(auto_recut_failed_message(
            "https://www.ponglens.com/match/preview"))
        self.assertEqual(rendered.subject, "The new cut of your match didn't finish")
        self.assertIn("Your match hasn't changed.", rendered.text)
        self.assertIn("minutes for the new cut are back", rendered.text)
        for word in ("marks", "free", "Mac", "iPhone", "phone", "version", "AI", "—"):
            self.assertNotIn(word, rendered.subject + rendered.text.split("Questions?")[0])

    def test_notify_sends_it_to_the_player(self):
        sent = []
        with mock.patch.object(worker, "get_user_email", return_value="p@example.com"), \
                mock.patch.object(worker, "get_job_match_id", return_value=MATCH), \
                mock.patch.object(worker, "send_email",
                                  side_effect=lambda to, r: sent.append((to, r))):
            self.assertTrue(worker.notify_auto_recut_failed(Conn(), USER, JOB))
        self.assertEqual(sent[0][0], "p@example.com")
        self.assertIn(f"/match/{MATCH}", sent[0][1].text)
        self.assertFalse(worker.notify_auto_recut_failed(Conn(), None, JOB))


class ListingR2:
    def __init__(self, objects):
        self.objects = objects
        self.deleted = []
        self.pages = []

    def get_paginator(self, name):
        outer = self

        class Paginator:
            def paginate(self, Bucket, Prefix, Delimiter=None):
                outer.pages.append((Bucket, Prefix, Delimiter))
                keys = [k for k in outer.objects if k.startswith(Prefix)]
                if Delimiter:
                    keys = [k for k in keys if Delimiter not in k[len(Prefix):]]
                return [{"Contents": [{"Key": k} for k in keys]}]

        return Paginator()

    def delete_objects(self, Bucket, Delete):
        self.deleted.extend((Bucket, o["Key"]) for o in Delete["Objects"])


class RetiredVersionSweepTests(unittest.TestCase):
    FOLDER = f"points/{USER}/{MATCH}/"
    OLD = "77777777-7777-4777-8777-777777777777"

    def sweep(self, claim, in_use=()):
        objects = [
            f"{self.FOLDER}01.mp4", f"{self.FOLDER}02.mp4", f"{self.FOLDER}match.json",
            f"{self.FOLDER}01-deadbeef.mp4",
            f"{self.FOLDER}versions/{self.OLD}/03.mp4",
            f"{self.FOLDER}versions/{VERSION}/01.mp4",
            f"{self.FOLDER}versions/{VERSION}/match.json",
        ]
        r2 = ListingR2(objects)
        in_use = list(in_use)
        conn = Conn({"claim_retired_version_sweep": (claim,),
                     "media_keys_in_use": [(k,) for k in in_use]})
        with mock.patch.object(worker, "r2", return_value=r2), \
                mock.patch.object(worker, "ledger_negate_keys") as negate:
            count = worker._sweep_retired_version(conn, self.OLD)
        return dict(count=count, r2=r2, conn=conn, negate=negate)

    def claim(self, first_cut=True):
        return {"version_id": self.OLD, "match_id": MATCH, "user_id": USER,
                "cut_path": f"r2://ponglens-media/results/{USER}/old.mp4",
                "first_cut": first_cut, "reel_keys": ["reels/old-highlights.mp4"]}

    def test_nothing_happens_unless_the_database_hands_it_over(self):
        out = self.sweep(None)
        self.assertEqual(out["count"], 0)
        self.assertEqual(out["r2"].pages, [])
        self.assertEqual(out["r2"].deleted, [])

    def test_a_first_cut_takes_its_own_files_and_nothing_still_used(self):
        live_reclip = f"r2://ponglens-media/{self.FOLDER}01-deadbeef.mp4"
        tagged = f"r2://ponglens-media/{self.FOLDER}02.mp4"
        out = self.sweep(self.claim(), in_use=[live_reclip, tagged])
        deleted = {key for _, key in out["r2"].deleted}
        self.assertEqual(deleted, {
            f"{self.FOLDER}01.mp4", f"{self.FOLDER}match.json",
            f"{self.FOLDER}versions/{self.OLD}/03.mp4",
            f"results/{USER}/old.mp4", "reels/old-highlights.mp4"})
        self.assertEqual({b for b, _ in out["r2"].deleted}, {"ponglens-media"})
        # The later cuts' folders are never listed as this one's.
        self.assertFalse([k for k in deleted if f"/versions/{VERSION}/" in k])
        (sql, params), = out["conn"].sql("media_keys_in_use")
        self.assertEqual(params[1], [self.OLD])
        self.assertIn(live_reclip, params[0])
        negated = [k for call in out["negate"].call_args_list for k in call.args[1]]
        self.assertIn("r2://ponglens-media/reels/old-highlights.mp4", negated)
        self.assertEqual(out["count"], 5)

    def test_a_later_cut_only_takes_its_own_folder(self):
        out = self.sweep(self.claim(first_cut=False))
        deleted = {key for _, key in out["r2"].deleted}
        self.assertEqual(deleted, {
            f"{self.FOLDER}versions/{self.OLD}/03.mp4",
            f"results/{USER}/old.mp4", "reels/old-highlights.mp4"})

    def test_the_original_is_never_a_candidate(self):
        claim = self.claim()
        claim["cut_path"] = RAW
        out = self.sweep(claim)
        self.assertNotIn(("ponglens-raw", f"{USER}/source.mov"), out["r2"].deleted)

    def test_the_tier_runs_before_the_orphan_cut_tier(self):
        source = Path(worker.__file__).read_text()
        self.assertLess(source.index('("r2-retired-versions"'),
                        source.index('("r2-results"'))
        self.assertEqual(worker.RETIRED_VERSION_DAYS, 30)

    def test_one_version_failing_does_not_stop_the_rest(self):
        conn = Conn({"retired_processing_versions": [(self.OLD,), (VERSION,)]})
        with mock.patch.object(worker, "_sweep_retired_version",
                               side_effect=[RuntimeError("r2 down"), 3]) as one:
            worker.retired_version_sweep(conn)
        self.assertEqual(one.call_count, 2)

    def test_a_swept_versions_cut_is_no_longer_protected_by_the_orphan_tier(self):
        conn = Conn({"select cut_path from public.matches": []})
        worker._referenced_cut_paths(conn)
        self.assertIn("media_swept_at is null", conn.calls[0][0])


if __name__ == "__main__":
    unittest.main()
