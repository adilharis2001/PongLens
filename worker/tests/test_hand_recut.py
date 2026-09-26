"""Cutting a processed match again by hand, replacing it (2026-09-25).

Design: docs/superpowers/specs/2026-09-25-cut-again-design.md. The
database half (the candidate version, its publication and activation) is
proved on a real Postgres by supabase/tests/cut_again.sql; this is the hand
lane's half:

- a re-cut (a candidate version) writes ONLY the candidate: its cut under
  results/<user>/<match>/versions/<version>.mp4, its clips and match.json
  under points/<user>/<match>/versions/<version>/, its points on the
  candidate version, and publishes through publish_hand_recut, never
  through the ordinary publication that rewrites the match row;
- a failed re-cut discards the candidate and hands the marks back, and
  nothing it runs can touch the live match, its points or its files; an
  ordinary hand cut's rollback deletes only its own version's points and
  never undoes a published match;
- a candidate published while its match has other work running is made
  live by a short retry or, later, by the hand lane's sweep, which then
  sends the ready email and queues the analysis;
- every published hand cut queues its detailed analysis and, where the
  match can have them, its highlights, as its owner.
"""
import json
import unittest
import uuid
from pathlib import Path
from unittest import mock

import hand_cut_device as hcd
import worker.worker as worker
from worker.tests.test_hand_cut_device import FakeR2, live_marks

USER = "11111111-1111-4111-8111-111111111111"
MATCH = "22222222-2222-4222-8222-222222222222"
JOB = "33333333-3333-4333-8333-333333333333"
VERSION = "44444444-4444-4444-8444-444444444444"
SOURCE = "55555555-5555-4555-8555-555555555555"
RAW = f"r2://ponglens-raw/{USER}/source.mov"
DURATION = 236.3233


def receipt(activated=True, points=20):
    return {"ok": True, "contractVersion": 1, "matchId": MATCH, "jobId": JOB,
            "processingVersionId": VERSION, "pointCount": points,
            "observationCount": 2 * points, "missingClipCount": 0,
            "activated": activated,
            "scoreRevision": 3 if activated else None,
            "scoreProjectionStatus": "current" if activated else None}


class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.result = None
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        sql = " ".join(query.split())
        self.conn.calls.append((sql, params))
        self.result = None
        if self.conn.fail_on and self.conn.fail_on in sql:
            raise RuntimeError(f"database refused: {self.conn.fail_on}")
        if "from public.matches m join public.hand_cut_drafts" in sql:
            self.result = (USER, RAW, 236.0, None, self.conn.marks,
                           "2026-09-25T10:00:00Z")
        elif sql.startswith("select options from public.jobs"):
            self.result = (self.conn.options,)
        elif "from public.match_processing_versions v join public.matches m" in sql:
            self.result = self.conn.candidate
        elif sql.startswith("select status, job_id::text from public.matches"):
            self.result = self.conn.published
        elif sql.startswith("select job_id::text, status, active_processing_version_id"):
            self.result = self.conn.match_row
        elif sql.startswith("insert into public.points"):
            self.result = (str(uuid.uuid4()),)
        elif "public.publish_hand_recut(" in sql:
            self.result = (self.conn.receipts.pop(0),)
        elif "public.activate_hand_recut(" in sql:
            self.result = (self.conn.receipts.pop(0),)
        elif "public.activate_pending_hand_recuts()" in sql:
            self.result = (self.conn.pending,)
        elif sql.startswith("select user_id::text, status, raw_path, placement_status"):
            self.result = self.conn.analysis_match
        elif "highlight_generation_eligibility" in sql:
            self.result = (self.conn.eligible,)
        elif sql.startswith("select status from public.match_reels"):
            self.result = self.conn.reel
        elif sql.startswith("select p.deleted, p.edited"):
            self.result = None
        elif "public.request_placement_generation(" in sql:
            self.result = ("66666666-6666-4666-8666-666666666666",)
        elif sql.startswith("select value from public.app_config"):
            self.result = (self.conn.highlights_enabled,)

    def fetchone(self):
        return self.result

    def fetchall(self):
        if self.conn.calls and self.conn.calls[-1][0].startswith(
                "select p.deleted, p.edited"):
            return self.conn.points
        return []


class Conn:
    def __init__(self, marks=None, options=None, candidate=None):
        self.marks = marks or []
        self.options = options or {"match_id": MATCH}
        self.candidate = candidate
        self.published = None
        self.match_row = None
        self.receipts = []
        self.pending = []
        self.analysis_match = None
        self.eligible = True
        self.reel = None
        self.points = []
        self.highlights_enabled = "on"
        self.fail_on = None
        self.calls = []
        self.autocommit = True
        self.closed = False
        self.commits = 0
        self.rollbacks = 0

    def cursor(self, **kwargs):
        return Cursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def sql(self, fragment):
        return [c for c in self.calls if fragment in c[0]]


def candidate_row(status="candidate", source_active=True, active=False):
    return (MATCH, USER, VERSION, SOURCE, status, source_active, active)


def recut(status="candidate"):
    return worker.HandRecutDestination(
        match_id=MATCH, user_id=USER, job_id=JOB,
        processing_version_id=VERSION, source_version_id=SOURCE,
        status=status, source_active=True, active=False)


# ---------------------------------------------------------------------------
# Where a re-cut writes
# ---------------------------------------------------------------------------
class PathTests(unittest.TestCase):
    def test_a_recut_writes_where_support_candidates_write(self):
        support = worker.MatchProcessingDestination(
            match_id=MATCH, user_id=USER, job_id=JOB, source_path=RAW,
            options={}, match_state={}, issue_id="i", source_version_id=SOURCE,
            processing_version_id=VERSION)
        mine = recut()
        self.assertEqual(mine.storage_prefix, support.storage_prefix)
        self.assertEqual(mine.cut_key, support.cut_key)
        self.assertEqual(mine.r2_prefix, support.r2_prefix)
        self.assertEqual(mine.storage_prefix,
                         f"points/{USER}/{MATCH}/versions/{VERSION}")
        self.assertEqual(mine.cut_key,
                         f"results/{USER}/{MATCH}/versions/{VERSION}.mp4")

    def test_the_candidate_is_read_from_the_version_row(self):
        conn = Conn(candidate=candidate_row())
        got = worker.load_hand_recut_destination(conn, JOB)
        self.assertEqual(got, recut())
        sql, params = conn.sql("from public.match_processing_versions v")[0]
        self.assertEqual(params, (JOB,))
        for guard in ("v.job_id = %s", "j.kind = 'hand_cut'",
                      "v.issue_id is null",
                      "v.source_version_id is not null",
                      "j.options->>'processing_version_id' = v.id::text"):
            self.assertIn(guard, sql)
        self.assertIsNone(worker.load_hand_recut_destination(Conn(), JOB))


# ---------------------------------------------------------------------------
# The cut, end to end
# ---------------------------------------------------------------------------
class RecutRunTests(unittest.TestCase):
    """process_hand_cut with only media faked: ffmpeg, R2 and the cut's
    part timings. The database is the recording Conn above."""

    def setUp(self):
        self.marks = live_marks("04f1b393")
        self.plan = hcd.plan_hand_cut(self.marks, DURATION)
        self.encodes = []
        self.ledger = []
        self.negated = []
        self.sleeps = []

    def fake_cmd_cut(self, cmd, **kwargs):
        segments_path = cmd[cmd.index("--segments") + 1]
        out = cmd[cmd.index("--out") + 1]
        spans = [tuple(s) for s in json.loads(
            Path(segments_path).read_text())["cut_segments"]]
        parts = [f"{out}.parts/part_{i:03d}.mp4" for i in range(len(spans))]
        durations = {part: (b - a) for part, (a, b) in zip(parts, spans)}
        total = sum(durations.values())
        self.cut_seconds = total
        physical = [[float(f"{a:.2f}"),
                     round(float(f"{a:.2f}") + float(f"{b - a:.2f}"), 2)]
                    for a, b in spans]
        timeline_module = worker.cut_timeline
        with mock.patch.object(timeline_module, "_probe",
                               side_effect=lambda p: (0.0, durations.get(p, total), 0.0)):
            timeline = timeline_module.measure(parts, physical, out)
        timeline_module.write_json(out + ".timeline.json", timeline)
        timeline_module.reconcile_file(segments_path, out + ".timeline.json")
        Path(out).write_bytes(b"cut")

    def run_job(self, conn, *, download=None, reuse=None):
        fake_r2 = FakeR2({})
        self.r2 = fake_r2

        def fetch(path, local):
            if download is not None:
                raise download
            Path(local).write_bytes(b"original")

        def probe(path):
            if str(path).endswith("result.mp4"):
                return self.cut_seconds
            return DURATION

        def encode(src, seek, span, out):
            self.encodes.append(seek)
            Path(out).write_bytes(b"clip")
            return True

        def thumb(src, out, seek):
            Path(out).write_bytes(b"webp")
            return True

        patches = [
            mock.patch.object(worker, "r2", lambda: fake_r2),
            mock.patch.object(worker, "_download_backfill_object",
                              side_effect=fetch),
            mock.patch.object(worker, "probe_duration_s", side_effect=probe),
            mock.patch.object(worker, "video_source_geometry",
                              return_value={"fps": 29.97, "width": 1920,
                                            "height": 1080}),
            mock.patch.object(worker.subprocess, "run",
                              side_effect=self.fake_cmd_cut),
            mock.patch.object(worker, "_presigned_get",
                              return_value="https://r2.test/cut"),
            mock.patch.object(worker, "_encode_clip", side_effect=encode),
            mock.patch.object(worker, "extract_thumb", side_effect=thumb),
            mock.patch.object(worker, "ledger_append",
                              side_effect=lambda *a: self.ledger.append(a)),
            mock.patch.object(worker, "ledger_negate_keys",
                              side_effect=lambda c, keys: self.negated.append(list(keys))),
            mock.patch.object(worker, "update_job"),
            mock.patch.object(worker.time, "sleep",
                              side_effect=lambda s: self.sleeps.append(s)),
            mock.patch.object(worker, "_publish_hand_cut",
                              side_effect=AssertionError(
                                  "a re-cut must not publish over the match")),
            mock.patch.object(worker, "create_match",
                              side_effect=AssertionError(
                                  "a re-cut must not touch the match row")),
        ]
        if reuse is not None:
            patches.append(mock.patch.object(worker, "reuse_prior_table",
                                             side_effect=reuse))
        for p in patches:
            p.start()
        try:
            return worker.process_hand_cut(
                conn, JOB, USER, {"options": {"match_id": MATCH}}, f"{JOB}:1")
        finally:
            for p in reversed(patches):
                p.stop()

    def recut_conn(self, *receipts):
        conn = Conn([dict(m) for m in self.marks],
                    {"match_id": MATCH, "recut": "replace",
                     "processing_version_id": VERSION},
                    candidate=candidate_row())
        conn.receipts = list(receipts)
        return conn

    def test_a_recut_writes_only_the_candidate_and_goes_live(self):
        conn = self.recut_conn(receipt(True, len(self.plan.points)))
        self.assertIs(self.run_job(conn), True)
        keys = [key for _, key, _ in self.r2.uploads]
        prefix = f"points/{USER}/{MATCH}/versions/{VERSION}/"
        cut_key = f"results/{USER}/{MATCH}/versions/{VERSION}.mp4"
        self.assertIn(cut_key, keys)
        self.assertIn(prefix + "match.json", keys)
        self.assertIn(prefix + "01.mp4", keys)
        # Nothing at the live match's own names.
        for key in keys:
            self.assertTrue(key == cut_key or key.startswith(prefix), key)
        # Storage rows on the candidate's objects, against the match.
        self.assertEqual(
            {(row[2], row[4], row[5]) for row in self.ledger},
            {("cut", f"r2://ponglens-media/{cut_key}", MATCH),
             ("clip", f"r2://ponglens-media/{prefix[:-1]}/", MATCH)})
        # Points on the candidate version, publication through the re-cut
        # function with the candidate's objects, nothing that edits the
        # match row.
        inserts = conn.sql("insert into public.points")
        self.assertEqual(len(inserts), len(self.plan.points))
        self.assertTrue(all(params[2] == VERSION for _, params in inserts))
        self.assertTrue(all(params[6].startswith(f"r2://ponglens-media/{prefix}")
                            for _, params in inserts))
        (sql, params), = conn.sql("public.publish_hand_recut(")
        self.assertEqual(params[:5], (
            MATCH, JOB, f"r2://ponglens-media/{cut_key}",
            f"r2://ponglens-media/{prefix}thumb-{JOB}.webp",
            f"r2://ponglens-media/{prefix}match.json"))
        self.assertEqual(json.loads(params[5]), {"pre": 1.2, "post": 1.3})
        (sql, params), = conn.sql("delete from public.points")
        self.assertEqual(params, (MATCH, VERSION))
        self.assertIn("processing_version_id = %s", sql)
        self.assertEqual(conn.sql("update public.matches"), [])
        self.assertEqual(conn.commits, 1)
        self.assertEqual(self.negated, [])
        # The owner's calls ride along onto the candidate's points.
        winners = conn.sql("update public.points set confirmed_winner")
        self.assertEqual(len(winners), len(self.plan.points))

    def uploaded_match_json(self):
        key = f"points/{USER}/{MATCH}/versions/{VERSION}/match.json"
        (body,) = [data for _, k, data in self.r2.uploads if k == key]
        return json.loads(body)

    def test_a_recut_carries_the_table_of_the_cut_it_replaces(self):
        """Audit D: the hand Replace's match.json holds the table the
        replaced version found, so the admin page shows it and detailed
        analysis starts from it, even after the old version is swept."""
        table = {"ok": True, "source": "vision",
                 "table_corners_px": {"A_near_1": [841.2, 576.0],
                                      "B_near_2": [1017.6, 612.0],
                                      "C_far_2": [1137.6, 580.8],
                                      "D_far_1": [976.8, 553.2]},
                 "note": "vision-proposed quad; reused from the cut this one replaced",
                 "reused_from": {"relation": "replaced",
                                 "processing_version_id": SOURCE}}
        asked = []

        def reuse(conn, **kwargs):
            asked.append(kwargs)
            return table

        conn = self.recut_conn(receipt(True, len(self.plan.points)))
        self.assertIs(self.run_job(conn, reuse=reuse), True)
        (kwargs,) = asked
        self.assertEqual(kwargs["match_id"], MATCH)
        self.assertEqual(kwargs["processing_version_id"], VERSION)
        self.assertEqual(kwargs["raw_path"], RAW)
        self.assertTrue(str(kwargs["video_path"]).endswith("source.mp4"))
        self.assertEqual((kwargs["geometry"]["width"], kwargs["geometry"]["height"]),
                         (1920, 1080))
        written = self.uploaded_match_json()
        self.assertEqual(written["calibration"], table)
        self.assertIn("table: reused from an earlier cut of this upload (vision, "
                      "same original and frame size)", written["notes"])
        self.assertEqual(written["pipeline"], "hand-v1")

    def test_a_recut_with_no_trusted_table_writes_none(self):
        conn = self.recut_conn(receipt(True, len(self.plan.points)))
        self.assertIs(self.run_job(conn, reuse=lambda conn, **k: None), True)
        self.assertNotIn("calibration", self.uploaded_match_json())

    def test_the_lookup_can_never_fail_a_cut(self):
        """Unpatched: the real lookup meets this fake database, which
        answers none of its questions, and the cut publishes regardless."""
        conn = self.recut_conn(receipt(True, len(self.plan.points)))
        self.assertIs(self.run_job(conn), True)
        self.assertNotIn("calibration", self.uploaded_match_json())
        self.assertTrue(conn.sql("with recursive chain"))

    def test_a_recut_waits_then_goes_live_on_the_retry(self):
        conn = self.recut_conn(receipt(False), receipt(False), receipt(True))
        self.assertIs(self.run_job(conn), True)
        self.assertEqual(len(conn.sql("public.activate_hand_recut(")), 2)
        self.assertEqual(self.sleeps, [worker.HAND_RECUT_ACTIVATE_WAIT_S] * 2)
        # Published storage is the candidate's for good: nothing undone.
        self.assertEqual(self.negated, [])

    def test_a_recut_left_waiting_is_published_for_the_sweep(self):
        waits = [receipt(False)] * worker.HAND_RECUT_ACTIVATE_TRIES
        conn = self.recut_conn(*waits)
        self.assertIs(self.run_job(conn), False)
        self.assertEqual(len(conn.sql("public.activate_hand_recut(")),
                         worker.HAND_RECUT_ACTIVATE_TRIES - 1)
        self.assertEqual(conn.sql("update public.match_processing_versions"), [])
        self.assertEqual(self.negated, [])

    def test_a_failed_recut_leaves_the_live_match_alone(self):
        conn = self.recut_conn()
        with self.assertRaises(worker.UserFacingError):
            self.run_job(conn, download=RuntimeError("404 Not Found"))
        # Discarded: the candidate's points (none were written), the
        # candidate itself, the marks handed back.
        deletes = conn.sql("delete from public.points")
        self.assertEqual(len(deletes), 1)
        self.assertIn("processing_version_id = %s", deletes[0][0])
        self.assertEqual(deletes[0][1][:3], (MATCH, VERSION, JOB))
        failed = conn.sql("update public.match_processing_versions set status = 'failed'")
        self.assertEqual(failed[0][1], (VERSION, JOB))
        self.assertEqual(len(conn.sql("update public.hand_cut_drafts set submitted_at = null")), 1)
        self.assertEqual(conn.sql("update public.matches"), [])
        self.assertEqual(conn.sql("delete from public.points where match_id = %s"), [])

    def test_a_retryable_failure_keeps_the_marks_frozen(self):
        conn = self.recut_conn()
        conn.fail_on = "public.publish_hand_recut("
        with self.assertRaises(RuntimeError):
            self.run_job(conn)
        self.assertEqual(conn.rollbacks, 1)
        self.assertEqual(conn.sql("update public.match_processing_versions"), [])
        self.assertEqual(conn.sql("update public.hand_cut_drafts"), [])
        self.assertEqual(conn.sql("update public.matches"), [])
        # Its own storage rows, nothing else.
        self.assertEqual(len(self.negated), 1)
        self.assertTrue(all(f"/versions/{VERSION}" in key
                            for key in self.negated[0]))

    def test_a_published_candidate_only_needs_making_live(self):
        conn = self.recut_conn(receipt(True))
        conn.candidate = candidate_row("ready")
        self.assertIs(self.run_job(conn), True)
        self.assertEqual(self.r2.uploads, [])
        self.assertEqual(len(conn.sql("public.activate_hand_recut(")), 1)

    def test_a_candidate_already_live_does_nothing(self):
        conn = self.recut_conn()
        conn.candidate = candidate_row("active", source_active=False, active=True)
        self.assertIs(self.run_job(conn), True)
        self.assertEqual(self.r2.uploads, [])

    def test_a_discarded_candidate_is_not_cut(self):
        for row in (candidate_row("failed"), None,
                    candidate_row(source_active=False)):
            conn = self.recut_conn()
            conn.candidate = row
            with self.assertRaises(worker.UserFacingError):
                self.run_job(conn)
            self.assertEqual(self.r2.uploads, [])

    def test_an_ordinary_cut_already_published_is_not_redone(self):
        conn = Conn([dict(m) for m in self.marks], {"match_id": MATCH})
        conn.published = ("ready", JOB)
        self.assertIsNone(self.run_job(conn))
        self.assertEqual(self.r2.uploads, [])


# ---------------------------------------------------------------------------
# Rollbacks
# ---------------------------------------------------------------------------
class RollbackTests(unittest.TestCase):
    def test_an_ordinary_rollback_deletes_only_its_own_version(self):
        conn = Conn()
        conn.match_row = (JOB, "processing", SOURCE)
        worker._hand_cut_rollback(conn, MATCH, JOB, release=True)
        (sql, params), = conn.sql("delete from public.points")
        self.assertIn("processing_version_id = %s", sql)
        self.assertEqual(params, (MATCH, SOURCE))
        self.assertEqual(len(conn.sql("update public.matches")), 2)

    def test_a_published_match_is_never_undone(self):
        conn = Conn()
        conn.match_row = (JOB, "ready", SOURCE)
        worker._hand_cut_rollback(conn, MATCH, JOB, release=True)
        self.assertEqual(conn.sql("delete from public.points"), [])
        self.assertEqual(conn.sql("update public.matches"), [])

    def test_a_terminal_failure_routes_a_recut_to_its_candidate(self):
        conn = Conn(candidate=candidate_row())
        conn.match_row = (JOB, "processing", SOURCE)
        worker.hand_cut_release(conn, JOB, {"options": {"match_id": MATCH}})
        self.assertEqual(conn.sql("update public.matches"), [])
        self.assertEqual(conn.sql("select job_id::text, status"), [])
        (sql, params), = conn.sql("update public.match_processing_versions")
        self.assertIn("status in ('candidate', 'ready')", sql)
        self.assertEqual(params, (VERSION, JOB))

    def test_an_ordinary_terminal_failure_still_hands_back(self):
        conn = Conn()
        conn.match_row = (JOB, "processing", SOURCE)
        worker.hand_cut_release(conn, JOB, {"options": {"match_id": MATCH}})
        self.assertEqual(len(conn.sql("update public.hand_cut_drafts")), 1)
        self.assertEqual(conn.sql("update public.match_processing_versions"), [])


# ---------------------------------------------------------------------------
# What a published hand cut queues by itself
# ---------------------------------------------------------------------------
class QueueAnalysisTests(unittest.TestCase):
    def conn(self, *, match_type="match", eligible=True, placement="not_requested",
             raw=RAW, reel=None, enabled="on", points=None):
        conn = Conn()
        conn.analysis_match = (USER, "ready", raw, placement, None, 0, match_type)
        conn.eligible = eligible
        conn.reel = reel
        conn.highlights_enabled = enabled
        conn.points = points if points is not None else [
            (False, False, False, "user", f"r2://ponglens-media/points/{USER}/{MATCH}/01.mp4", None),
            (False, False, True, None, f"r2://ponglens-media/points/{USER}/{MATCH}/02.mp4", None),
        ]
        return conn

    def calls(self, conn):
        """The two owner calls, in order, each with the claim before it."""
        out = []
        claim = None
        for sql, params in conn.calls:
            if "set_config('request.jwt.claims'" in sql:
                claim = json.loads(params[0])
            elif "request_placement_generation" in sql:
                out.append(("placement", claim, params))
            elif "enqueue_reel" in sql:
                out.append(("highlights", claim, params))
        return out

    def test_publish_queues_detailed_analysis_then_highlights(self):
        conn = self.conn()
        got = worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertEqual(got["placement"], "66666666-6666-4666-8666-666666666666")
        self.assertEqual(got["highlights"], "highlights")
        calls = self.calls(conn)
        self.assertEqual([c[0] for c in calls], ["placement", "highlights"])
        for _, claim, _ in calls:
            self.assertEqual(claim, {"sub": USER, "role": "authenticated"})
        self.assertEqual(calls[0][2], (MATCH,))
        manifest = json.loads(calls[1][2][1])
        self.assertEqual(calls[1][2][0], MATCH)
        self.assertEqual(manifest, {
            "v": 2, "rule": "quality-first-v2", "max_seconds": 150,
            "points_revision": "", "duration_s": 0, "scored_only": True,
            "points": [], "refresh_evidence": True})
        self.assertEqual(conn.commits, 2)

    def test_only_detailed_analysis_when_under_three_quarters_scored(self):
        conn = self.conn(eligible=False)
        got = worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertEqual([c[0] for c in self.calls(conn)], ["placement"])
        self.assertIsNone(got["highlights"])

    def test_no_highlights_for_practice_or_drills(self):
        for kind in ("practice", "drills"):
            conn = self.conn(match_type=kind)
            got = worker.queue_hand_cut_analysis(conn, MATCH, USER)
            self.assertEqual([c[0] for c in self.calls(conn)], ["placement"])
            self.assertIsNone(got["highlights"])
            self.assertEqual(conn.sql("highlight_generation_eligibility"), [])

    def test_highlights_follow_the_rollout_switch(self):
        conn = self.conn(enabled="off")
        worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertEqual([c[0] for c in self.calls(conn)], ["placement"])

    def test_evidence_is_only_refreshed_when_a_scored_point_lacks_it(self):
        clip = f"r2://ponglens-media/points/{USER}/{MATCH}/01.mp4"
        conn = self.conn(points=[(False, False, False, "user", clip, {"v": 2})])
        worker.queue_hand_cut_analysis(conn, MATCH, USER)
        manifest = json.loads(self.calls(conn)[1][2][1])
        self.assertNotIn("refresh_evidence", manifest)

    def test_highlights_wait_for_clips_being_cut_again(self):
        clip = f"r2://ponglens-media/points/{USER}/{MATCH}/01.mp4"
        conn = self.conn(points=[(False, True, False, "user", None, None),
                                 (False, False, False, "user", clip, None)])
        worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertEqual([c[0] for c in self.calls(conn)], ["placement"])

    def test_nothing_twice(self):
        conn = self.conn(placement="processing", reel=("queued",))
        got = worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertEqual(self.calls(conn), [])
        self.assertEqual(got, {"placement": None, "highlights": None})

    def test_no_detailed_analysis_without_the_original(self):
        conn = self.conn(raw=None)
        worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertEqual([c[0] for c in self.calls(conn)], ["highlights"])

    def test_a_refusal_never_fails_the_cut(self):
        conn = self.conn()
        conn.fail_on = "request_placement_generation"
        got = worker.queue_hand_cut_analysis(conn, MATCH, USER)
        self.assertIsNone(got["placement"])
        self.assertEqual(got["highlights"], "highlights")
        self.assertEqual(conn.rollbacks, 1)
        conn = self.conn()
        conn.fail_on = "select user_id::text, status, raw_path"
        self.assertEqual(worker.queue_hand_cut_analysis(conn, MATCH, USER),
                         {"placement": None, "highlights": None})


# ---------------------------------------------------------------------------
# The dispatcher, the sweep and the failure email
# ---------------------------------------------------------------------------
class DispatchTests(unittest.TestCase):
    def dispatch(self, live):
        conn = Conn()
        msg = {"msg_id": 7, "read_ct": 1, "message": {
            "job_id": JOB, "user_id": USER, "kind": "hand_cut",
            "input_path": RAW, "options": {"match_id": MATCH}}}

        class Claim(Cursor):
            def execute(self, query, params=None):
                super().execute(query, params)
                if "set status = 'processing'" in " ".join(query.split()):
                    self.result = (JOB,)

        conn.cursor = lambda **kwargs: Claim(conn)
        with mock.patch.object(worker, "ProcessingTelemetry",
                               side_effect=RuntimeError("no telemetry")), \
             mock.patch.object(worker, "process_hand_cut", return_value=live), \
             mock.patch.object(worker, "update_job"), \
             mock.patch.object(worker, "archive_message") as archive, \
             mock.patch.object(worker, "notify_job_done") as email, \
             mock.patch.object(worker, "queue_hand_cut_analysis") as queue:
            worker.process_job(conn, msg)
        archive.assert_called_once()
        return email, queue

    def test_a_published_cut_emails_then_queues_its_analysis(self):
        for live in (None, True):
            email, queue = self.dispatch(live)
            email.assert_called_once_with(mock.ANY, JOB, USER)
            queue.assert_called_once_with(mock.ANY, MATCH, USER)

    def test_a_recut_waiting_to_go_live_leaves_both_to_the_sweep(self):
        email, queue = self.dispatch(False)
        email.assert_not_called()
        queue.assert_not_called()

    def test_the_sweep_emails_and_queues_what_it_made_live(self):
        conn = Conn()
        conn.pending = [{"job_id": JOB, "user_id": USER, "match_id": MATCH}]
        with mock.patch.object(worker, "notify_job_done") as email, \
             mock.patch.object(worker, "queue_hand_cut_analysis") as queue:
            self.assertEqual(worker.activate_pending_hand_recuts(conn),
                             conn.pending)
        email.assert_called_once_with(conn, JOB, USER)
        queue.assert_called_once_with(conn, MATCH, USER)

    def test_the_sweep_never_raises(self):
        conn = Conn()
        conn.fail_on = "activate_pending_hand_recuts"
        self.assertEqual(worker.activate_pending_hand_recuts(conn), [])

    def test_only_the_hand_lane_sweeps(self):
        source = Path(worker.__file__).read_text()
        self.assertIn("activate_pending_hand_recuts(conn)  # never raises", source)
        self.assertIn('device_sweep = LANE == "hand"', source)

    def test_a_failed_recut_email_says_the_match_is_unchanged(self):
        sent = []
        for options, subject in (
                ({"match_id": MATCH, "recut": "replace"},
                 "The new cut of your match didn't finish"),
                ({"match_id": MATCH},
                 "We couldn't finish cutting your match")):
            conn = Conn(options=options)
            with mock.patch.object(worker, "get_user_email",
                                   return_value="p@example.com"), \
                 mock.patch.object(worker, "get_job_match_id",
                                   return_value=MATCH), \
                 mock.patch.object(worker, "send_email",
                                   side_effect=lambda to, r: sent.append(r)):
                self.assertTrue(worker.notify_hand_cut_failed(
                    conn, USER, JOB, "The original video could not be read."))
            self.assertEqual(sent[-1].subject, subject)
        self.assertNotIn("could not be read", sent[0].text)


if __name__ == "__main__":
    unittest.main()
