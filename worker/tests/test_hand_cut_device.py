"""A hand cut made on the iPhone, checked and published by the Mac.

Contract: docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md.

Three things are proved here:

- the plan is one statement of the rules: the Mac's own hand cut, the check
  of a phone's cut and the iPhone planner's parity fixture all read
  hand_cut_device.plan_hand_cut, and it reproduces what the Mac published
  on the eight live hand cuts;
- the check refuses every way a phone's cut can disagree with the marks or
  with itself, and when it holds the Mac publishes its OWN reading of every
  position, not the phone's;
- any disagreement becomes a Mac cut of the same marks in the same run,
  while a network problem is retried rather than blamed on the phone.
"""
import copy
import io
import json
import os
import unittest
from pathlib import Path
from unittest import mock

from botocore.exceptions import ClientError

import hand_cut_device as hcd
import worker.worker as worker

REPO = Path(__file__).resolve().parents[2]
LIVE = REPO / "worker/tests/fixtures/hand_cut_live_marks.json"
FIXTURE = REPO / "ios/Tests/fixtures/cut-plan-parity.json"

USER = "11111111-1111-4111-8111-111111111111"
MATCH = "22222222-2222-4222-8222-222222222222"
JOB = "33333333-3333-4333-8333-333333333333"
RAW = f"r2://ponglens-raw/{USER}/source.mov"


def live_matches():
    return json.loads(LIVE.read_text())["matches"]


def live_marks(prefix="04f1b393"):
    row = next(m for m in live_matches() if m["match"] == prefix)
    return [{"t0": a, "t1": b, "w": "user", "let": False, "star": i == 0}
            for i, (a, b) in enumerate(row["marks"])]


def phone_manifest(marks, duration, **changes):
    """What a correct iPhone uploads for these marks."""
    plan = hcd.plan_hand_cut(marks, duration)
    manifest = {
        "schema": 1, "pipeline": "hand-v1", "cutter": "device",
        "job_id": JOB, "match_id": MATCH,
        "source": {"duration": duration, "fps": 29.97, "width": 1920,
                   "height": 1080},
        "clip_pads": {"pre": 1.2, "post": 1.3},
        "cut_segments": copy.deepcopy(plan.cut_segments),
        "cut_segment_offsets": list(plan.offsets),
        "points": [dict(p) for p in plan.points],
    }
    manifest.update(changes)
    return manifest


def check(manifest, marks, *, probe=236.32, row=236.0, geometry=None):
    return hcd.check_manifest(
        manifest, job_id=JOB, match_id=MATCH, marks=marks,
        duration_probe=probe, duration_row=row, cut_map=worker._CutMap,
        mac_geometry=geometry)


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------
class PlanTests(unittest.TestCase):
    def legacy(self, marks, dur, pre=1.2, post=1.3):
        """process_hand_cut's arithmetic before 2026-09-25, verbatim."""
        from points_pipeline import (SEGMENT_PADS, cut_position,
                                     play_cut_segments, segment_cut_offsets)
        marks = [dict(t0=a, t1=b) for a, b in marks]
        marks = [m for m in marks if m["t0"] < dur]
        for m in marks:
            m["t1"] = min(m["t1"], dur)
        head, tail = SEGMENT_PADS["normal"]
        windows = [(max(0.0, m["t0"] - pre), min(dur, m["t1"] + post))
                   for m in marks]
        segments = play_cut_segments(windows, dur, head, tail)
        offsets = segment_cut_offsets(segments)
        anchors = [round(cut_position(segments, offsets,
                                      max(0.0, m["t0"] - pre)), 2)
                   for m in marks]
        return segments, anchors

    def test_the_mac_publishes_the_same_positions_on_every_live_hand_cut(self):
        for row in live_matches():
            plan = hcd.plan_hand_cut(
                [{"t0": a, "t1": b} for a, b in row["marks"]],
                row["duration_s"])
            segments, anchors = self.legacy(row["marks"], row["duration_s"])
            self.assertEqual(plan.cut_segments,
                             [[round(a, 2), round(b, 2)] for a, b in segments])
            for p, anchor, published in zip(plan.points, anchors,
                                            row["published"]):
                self.assertAlmostEqual(p["t0"], published[1], places=6)
                self.assertAlmostEqual(p["t1"], published[2], places=6)
                # Two-decimal marks give the old anchor exactly. The one
                # three-decimal mark in production (06deeba4, 1039.465)
                # moves its own and the later positions by one hundredth,
                # because the video is cut from two-decimal segments.
                self.assertLessEqual(abs(p["cut_t0"] - anchor), 0.0100001,
                                     row["match"])
                self.assertLessEqual(abs(p["cut_t0"] - published[3]),
                                     0.0100001, row["match"])
                if row["match"] != "06deeba4":
                    self.assertEqual(p["cut_t0"], anchor, row["match"])

    def test_positions_agree_with_the_recut_lookup(self):
        for row in live_matches():
            plan = hcd.plan_hand_cut(
                [{"t0": a, "t1": b} for a, b in row["marks"]],
                row["duration_s"])
            lookup = worker._CutMap({"cut_segments": plan.cut_segments,
                                     "points": []})
            for p in plan.points:
                got = lookup.locate(p["idx"], p["clip_t0"], p["clip_t1"])
                self.assertIsNotNone(got)
                self.assertAlmostEqual(got, p["cut_t0"], delta=0.005)

    def test_a_mark_after_the_end_is_dropped_and_an_end_past_it_clamped(self):
        plan = hcd.plan_hand_cut(
            [{"t0": 10.0, "t1": 20.0}, {"t0": 49.5, "t1": 51.0},
             {"t0": 50.2, "t1": 50.9}], 50.0)
        self.assertEqual(plan.dropped, 1)
        self.assertEqual([p["t1"] for p in plan.points], [20.0, 50.0])
        self.assertEqual(plan.marked[1], (49.5, 51.0))
        self.assertEqual(plan.cut_segments[-1][1], 50.0)

    def test_clip_names_follow_the_mac(self):
        self.assertEqual(hcd.clip_name(1), "01.mp4")
        self.assertEqual(hcd.clip_name(99), "99.mp4")
        self.assertEqual(hcd.clip_name(100), "100.mp4")

    def test_either_stored_form_of_a_mark_plans_the_same(self):
        short = [{"t0": 12.0, "t1": 20.0, "w": "user", "let": False}]
        long = [{"id": "a", "t0": 12.0, "t1": 20.0, "winner": "user",
                 "isLet": False, "starred": False, "tap": 12.9, "rate": 1.5},
                {"id": "b", "t0": 30.0, "t1": None}]
        self.assertEqual(hcd.plan_hand_cut(short, 100).points,
                         hcd.plan_hand_cut(long, 100).points)


class FixtureTests(unittest.TestCase):
    def test_the_committed_fixture_is_what_the_rules_produce(self):
        """The iPhone is tested against this file, so it must never drift
        from the Python it claims to come from. Regenerate with the
        command in its generated_by field."""
        live = json.loads(LIVE.read_text())
        self.assertEqual(FIXTURE.read_text(),
                         hcd.render_fixture(hcd.build_fixture(live)))

    def test_the_fixture_covers_the_edges(self):
        fixture = json.loads(FIXTURE.read_text())
        names = [c["name"] for c in fixture["cases"]]
        self.assertEqual(sum(n.startswith("live ") for n in names), 8)
        by_name = {c["name"]: c["expected"] for c in fixture["cases"]}
        self.assertEqual(len(by_name["gap under 0.5 s merges"]["cut_segments"]), 1)
        self.assertEqual(
            len(by_name["gap of 0.5 s stays apart (float edge)"]["cut_segments"]), 2)
        self.assertEqual(by_name["clamp at zero"]["cut_segments"][0][0], 0.0)
        self.assertEqual(by_name["clamp at the duration"]["cut_segments"][0][1], 100.0)
        self.assertEqual(by_name["start after the end is dropped"]["dropped"], 1)
        self.assertEqual(by_name["three-digit clip names"]["points"][-1]["clip"],
                         "105.mp4")
        rounding = {r["x"]: r["r2"] for r in fixture["rounding"]}
        self.assertEqual(rounding[2.675], 2.67)
        self.assertEqual(rounding[0.125], 0.12)


# ---------------------------------------------------------------------------
# The check
# ---------------------------------------------------------------------------
class CheckManifestTests(unittest.TestCase):
    def setUp(self):
        self.marks = live_marks()
        self.duration = 236.3233

    def test_a_faithful_cut_passes(self):
        verified = check(phone_manifest(self.marks, self.duration), self.marks)
        plan = hcd.plan_hand_cut(self.marks, self.duration)
        self.assertEqual([p["cut_t0"] for p in verified.points],
                         [p["cut_t0"] for p in plan.points])
        self.assertLess(verified.max_position_error_s, 1e-6)
        self.assertEqual(verified.source, {"duration": 236.32, "fps": 29.97,
                                           "width": 1920, "height": 1080})

    def test_the_mac_publishes_its_own_reading_of_the_measured_clock(self):
        manifest = phone_manifest(self.marks, self.duration)
        manifest["cut_segment_offsets"][2] += 0.02
        verified = check(manifest, self.marks)
        lookup = worker._CutMap({"cut_segments": manifest["cut_segments"],
                                 "cut_segment_offsets": manifest["cut_segment_offsets"]})
        for p in verified.points:
            self.assertEqual(p["cut_t0"], round(
                lookup.locate(p["idx"], p["clip_t0"], p["clip_t1"]), 2))
        self.assertAlmostEqual(verified.max_position_error_s, 0.02, delta=1e-6)
        mj = hcd.device_match_json(verified, cut_duration=150.0)
        self.assertEqual(mj["cut_segment_offsets"][2],
                         round(manifest["cut_segment_offsets"][2], 6))
        self.assertEqual(mj["pipeline"], "hand-v1")
        self.assertEqual(mj["points"][0]["clip"], "01.mp4")

    def assertMismatch(self, manifest, marks=None, **kwargs):
        with self.assertRaises(hcd.DeviceCutMismatch) as caught:
            check(manifest, self.marks if marks is None else marks, **kwargs)
        return str(caught.exception)

    def test_another_jobs_manifest(self):
        self.assertIn("another job", self.assertMismatch(
            phone_manifest(self.marks, self.duration, job_id=MATCH)))

    def test_a_segment_the_marks_do_not_make(self):
        manifest = phone_manifest(self.marks, self.duration)
        manifest["cut_segments"][1][1] += 0.02
        self.assertIn("segment 2", self.assertMismatch(manifest))

    def test_a_point_missing(self):
        manifest = phone_manifest(self.marks, self.duration)
        manifest["points"].pop()
        self.assertIn("points", self.assertMismatch(manifest))

    def test_the_draft_changed_under_the_phone(self):
        manifest = phone_manifest(self.marks, self.duration)
        edited = copy.deepcopy(self.marks)
        edited[3]["t1"] += 0.4
        self.assertMismatch(manifest, marks=edited)

    def test_a_position_the_cut_does_not_hold(self):
        manifest = phone_manifest(self.marks, self.duration)
        manifest["points"][5]["cut_t0"] += 0.1
        self.assertIn("point 6", self.assertMismatch(manifest))

    def test_a_segment_placed_off_its_plan(self):
        manifest = phone_manifest(self.marks, self.duration)
        manifest["cut_segment_offsets"][3] += 0.1
        self.assertIn("segment 4", self.assertMismatch(manifest))

    def test_a_first_frame_far_from_its_offset(self):
        manifest = phone_manifest(self.marks, self.duration)
        manifest["cut_first_frame_s"] = [v + 0.2 for v in manifest["cut_segment_offsets"]]
        self.assertIn("first frame", self.assertMismatch(manifest))

    def test_the_phone_read_a_different_length(self):
        manifest = phone_manifest(self.marks, self.duration)
        self.assertIn("the Mac as", self.assertMismatch(manifest, probe=237.0))

    def test_without_the_macs_probe_the_match_row_decides(self):
        manifest = phone_manifest(self.marks, self.duration)
        check(manifest, self.marks, probe=None, row=236.0)
        self.assertIn("match row", self.assertMismatch(manifest, probe=None,
                                                       row=238.0))

    def test_a_mark_the_publish_rule_would_refuse(self):
        marks = copy.deepcopy(self.marks)
        marks[-1]["t1"] = self.duration + 0.5
        manifest = phone_manifest(marks, self.duration)
        self.assertIn("from its mark", self.assertMismatch(manifest, marks=marks))

    def test_a_mark_after_the_phones_end(self):
        marks = copy.deepcopy(self.marks) + [{"t0": 236.5, "t1": 237.2}]
        manifest = phone_manifest(self.marks, self.duration)
        self.assertIn("after the end", self.assertMismatch(manifest, marks=marks))

    def test_the_macs_reading_of_the_frame_wins(self):
        verified = check(phone_manifest(self.marks, self.duration), self.marks,
                         geometry={"fps": 59.94, "width": 3840, "height": 2160})
        self.assertEqual(verified.source["width"], 3840)
        self.assertEqual(verified.source["fps"], 59.94)
        self.assertTrue(any("Mac's probe" in n for n in verified.notes))

    def test_unreadable_manifests(self):
        for body in (b"{not json", b"[1, 2]",
                     b" " * (hcd.MANIFEST_MAX_BYTES + 1)):
            with self.assertRaises(hcd.DeviceCutMismatch):
                hcd.parse_manifest(body)


class CutProbeTests(unittest.TestCase):
    SEGMENTS = [[10.0, 20.0], [30.0, 45.0]]

    def probe(self, codec="h264", duration="25.02"):
        return {"streams": [{"codec_type": "audio", "codec_name": "aac"},
                            {"codec_type": "video", "codec_name": codec,
                             "width": 1920, "height": 1080}],
                "format": {"duration": duration}}

    def test_an_h264_cut_of_the_right_length(self):
        duration, note = hcd.check_cut_probe(self.probe(), self.SEGMENTS)
        self.assertAlmostEqual(duration, 25.02)
        self.assertIn("h264", note)

    def test_hevc_is_refused(self):
        with self.assertRaises(hcd.DeviceCutMismatch):
            hcd.check_cut_probe(self.probe(codec="hevc"), self.SEGMENTS)

    def test_a_short_cut_is_refused(self):
        with self.assertRaises(hcd.DeviceCutMismatch):
            hcd.check_cut_probe(self.probe(duration="21.0"), self.SEGMENTS)

    def test_no_picture_is_refused(self):
        with self.assertRaises(hcd.DeviceCutMismatch):
            hcd.check_cut_probe({"streams": [], "format": {"duration": "25"}},
                                self.SEGMENTS)


# ---------------------------------------------------------------------------
# The worker's branch
# ---------------------------------------------------------------------------
class Cursor:
    def __init__(self, conn):
        self.conn = conn
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, query, params=None):
        sql = " ".join(query.split())
        self.conn.calls.append((sql, params))
        self.result = None
        if "from public.matches m join public.hand_cut_drafts" in sql:
            self.result = (USER, RAW, 236.0, None, self.conn.marks,
                           "2026-09-25T10:00:00Z")
        elif sql.startswith("select options from public.jobs"):
            self.result = (self.conn.options,)
        elif sql.startswith("update public.jobs set options = options ||"):
            self.conn.options = {**self.conn.options, "updated": params[0]}

    def fetchone(self):
        return self.result


class Conn:
    def __init__(self, marks, options):
        self.marks = marks
        self.options = options
        self.calls = []
        self.autocommit = True
        self.closed = False

    def cursor(self, **kwargs):
        return Cursor(self)

    def sql(self, fragment):
        return [c for c in self.calls if fragment in c[0]]


class FakeR2:
    def __init__(self, objects):
        self.objects = objects
        self.uploads = []
        self.head_error = None

    def head_object(self, Bucket, Key):
        if self.head_error:
            raise self.head_error
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": len(self.objects[(Bucket, Key)])}

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def generate_presigned_url(self, method, Params, ExpiresIn):
        return f"https://r2.test/{Params['Bucket']}/{Params['Key']}"

    def upload_file(self, local, bucket, key, ExtraArgs=None):
        with open(local, "rb") as handle:
            self.uploads.append((bucket, key, handle.read()))


class MacCutStarted(Exception):
    """Raised by the Mac path's first step, to prove it started."""


class DeviceBranchTests(unittest.TestCase):
    def setUp(self):
        self.marks = live_marks()
        self.duration = 236.3233
        self.manifest = phone_manifest(self.marks, self.duration)
        self.keys = hcd.device_keys(USER, JOB, MATCH)
        self.cut_seconds = hcd.plan_hand_cut(self.marks, self.duration).kept
        self.published = []
        self.ledger = []
        self.rollbacks = []

    def run_job(self, *, manifest=None, drop=(), cut_codec="h264",
                head_error=None, stop_mac_at_download=True):
        manifest = self.manifest if manifest is None else manifest
        objects = {("ponglens-media", self.keys["manifest"]):
                   json.dumps(manifest).encode(),
                   ("ponglens-media", self.keys["cut"]): b"x" * 5000}
        for p in manifest["points"]:
            key = f"{self.keys['clip_prefix']}/{p['clip']}"
            objects[("ponglens-media", key)] = b"c" * (100 + p["idx"])
        for key in drop:
            objects.pop(("ponglens-media", key), None)
        fake_r2 = FakeR2(objects)
        fake_r2.head_error = head_error
        self.r2 = fake_r2
        cut_seconds = self.cut_seconds

        def ffprobe(url):
            if "ponglens-raw" in url:
                return {"streams": [{"codec_type": "video",
                                     "avg_frame_rate": "30000/1001",
                                     "width": 1920, "height": 1080}],
                        "format": {"duration": "236.32"}}
            return {"streams": [{"codec_type": "video",
                                 "codec_name": cut_codec,
                                 "width": 1920, "height": 1080}],
                    "format": {"duration": str(cut_seconds + 0.04)}}

        def thumb(src, out, seek):
            Path(out).write_bytes(b"webp")
            return True

        def publish(conn, **kwargs):
            self.published.append(kwargs)
            return {"scoreRevision": 7}

        conn = Conn([dict(m) for m in self.marks],
                    {"match_id": MATCH, "cutter": "device", "phase": "verify"})
        self.conn = conn
        patches = [
            mock.patch.object(worker, "r2", lambda: fake_r2),
            mock.patch.object(worker, "_ffprobe_streams", side_effect=ffprobe),
            mock.patch.object(worker, "extract_thumb", side_effect=thumb),
            mock.patch.object(worker, "_publish_hand_cut", side_effect=publish),
            mock.patch.object(worker, "ledger_append",
                              side_effect=lambda *a: self.ledger.append(a)),
            mock.patch.object(worker, "ledger_negate_keys"),
            mock.patch.object(worker, "update_job"),
            mock.patch.object(worker, "_hand_cut_rollback",
                              side_effect=lambda *a, **k: self.rollbacks.append((a, k))),
        ]
        if stop_mac_at_download:
            patches.append(mock.patch.object(
                worker, "_download_backfill_object",
                side_effect=MacCutStarted("mac cut")))
        for p in patches:
            p.start()
        try:
            worker.process_hand_cut(
                conn, JOB, USER,
                {"options": {"match_id": MATCH}}, f"{JOB}:1")
        finally:
            for p in reversed(patches):
                p.stop()

    def fallback_reason(self):
        switches = self.conn.sql("jsonb_build_object('cutter', 'mac'")
        self.assertEqual(len(switches), 1, "the job switches to the Mac once")
        return switches[0][1][0]

    def test_a_good_phone_cut_is_published_without_touching_the_original(self):
        self.run_job()
        self.assertEqual(len(self.published), 1)
        call = self.published[0]
        self.assertEqual(call["result_path"],
                         f"r2://ponglens-media/{self.keys['cut']}")
        self.assertEqual(call["r2_prefix"],
                         f"r2://ponglens-media/{self.keys['clip_prefix']}")
        plan = hcd.plan_hand_cut(self.marks, self.duration)
        self.assertEqual([p["cut_t0"] for p in call["points"]],
                         [p["cut_t0"] for p in plan.points])
        self.assertEqual(call["points"][0]["clip"], "01.mp4")
        self.assertEqual(call["failed_clips"], set())
        # Winners, lets and stars ride the plan's marks, in point order.
        self.assertTrue(call["marks"][0]["star"])
        self.assertEqual(call["thumb_path"],
                         f"r2://ponglens-media/{self.keys['clip_prefix']}/thumb-{JOB}.webp")
        # Storage from R2's own sizes: the cut, then clips plus the poster.
        clip_total = sum(100 + p["idx"] for p in self.manifest["points"]) + 4
        self.assertEqual([(row[2], row[3]) for row in self.ledger],
                         [("cut", 5000), ("clip", clip_total)])
        uploaded = {key: body for _, key, body in self.r2.uploads}
        mj = json.loads(uploaded[f"{self.keys['clip_prefix']}/match.json"])
        self.assertEqual(mj["pipeline"], "hand-v1")
        self.assertEqual(mj["source"]["fps"], 29.97)
        self.assertEqual(mj["cut_segments"], self.manifest["cut_segments"])
        self.assertIn("cut_segment_offsets", mj)
        self.assertEqual(self.conn.sql("jsonb_build_object('cutter', 'mac'"), [])
        self.assertEqual(self.rollbacks, [])

    def assertFallsBackToTheMac(self, **kwargs):
        with self.assertRaises(MacCutStarted):
            self.run_job(**kwargs)
        self.assertEqual(self.published, [])
        self.assertEqual(self.ledger, [], "nothing was booked for the phone")
        return self.fallback_reason()

    def test_no_manifest_means_a_mac_cut(self):
        self.assertIn("manifest was not uploaded",
                      self.assertFallsBackToTheMac(drop=[self.keys["manifest"]]))

    def test_a_manifest_that_disagrees_with_the_draft_means_a_mac_cut(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["points"][2]["t1"] += 0.3
        self.assertIn("point 3", self.assertFallsBackToTheMac(manifest=manifest))

    def test_a_wrong_position_means_a_mac_cut(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["points"][7]["cut_t0"] -= 0.2
        self.assertIn("point 8", self.assertFallsBackToTheMac(manifest=manifest))

    def test_a_cut_in_the_wrong_codec_means_a_mac_cut(self):
        self.assertIn("not h264", self.assertFallsBackToTheMac(cut_codec="hevc"))

    def test_a_missing_cut_means_a_mac_cut(self):
        self.assertIn("cut was not uploaded",
                      self.assertFallsBackToTheMac(drop=[self.keys["cut"]]))

    def test_a_missing_clip_means_a_mac_cut(self):
        clip = f"{self.keys['clip_prefix']}/05.mp4"
        self.assertIn("05.mp4", self.assertFallsBackToTheMac(drop=[clip]))

    def test_the_mac_cut_names_why_in_its_match_notes(self):
        seen = {}

        def encode(cmd, **kwargs):
            seen["mj"] = json.loads(
                Path(cmd[cmd.index("--segments") + 1]).read_text())
            raise MacCutStarted("encoding")

        with mock.patch.object(worker, "_download_backfill_object"), \
                mock.patch.object(worker, "probe_duration_s",
                                  return_value=236.32), \
                mock.patch.object(worker, "video_source_geometry",
                                  return_value=None), \
                mock.patch.object(worker.subprocess, "run",
                                  side_effect=encode):
            with self.assertRaises(MacCutStarted):
                self.run_job(drop=[self.keys["cut"]],
                             stop_mac_at_download=False)
        self.assertIn("iPhone cut not used", self.fallback_reason())
        notes = seen["mj"]["notes"]
        self.assertTrue(notes[0].startswith("hand cut v1: 20 points"))
        self.assertIn("cut on the Mac: the iPhone's cut was not used "
                      "(the cut was not uploaded)", notes)
        # The Mac's own plan, the same numbers the phone was checked against.
        plan = hcd.plan_hand_cut(self.marks, 236.32)
        self.assertEqual([p["cut_t0"] for p in seen["mj"]["points"]],
                         [p["cut_t0"] for p in plan.points])

    def test_a_clip_the_phone_could_not_encode_is_recut_later(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["points"][4]["clip"] = None
        self.run_job(manifest=manifest)
        self.assertEqual(self.published[0]["failed_clips"], {5})

    def test_a_network_problem_is_retried_not_blamed_on_the_phone(self):
        error = ClientError({"Error": {"Code": "InternalError"}}, "HeadObject")
        with self.assertRaises(ClientError):
            self.run_job(head_error=error)
        self.assertEqual(self.conn.sql("jsonb_build_object('cutter', 'mac'"), [])
        self.assertEqual(self.published, [])

    def test_an_ordinary_hand_cut_never_reads_a_manifest(self):
        conn_options = {"match_id": MATCH}
        with mock.patch.object(worker, "get_job_options",
                               return_value=conn_options), \
                mock.patch.object(worker, "_verify_device_hand_cut") as verify:
            with self.assertRaises(MacCutStarted):
                self.run_job()
        verify.assert_not_called()


class LaneTests(unittest.TestCase):
    def test_the_pickup_never_claims_a_job_the_phone_holds(self):
        source = Path(worker.__file__).read_text()
        self.assertIn("and not (kind = 'hand_cut' ", source)
        self.assertIn("coalesce(options->>'phase', '') in ('device', 'released'))",
                      source)

    def test_the_sweep_counts_and_never_raises(self):
        class SweepCursor(Cursor):
            def execute(self, query, params=None):
                self.conn.calls.append((query, params))
                if self.conn.fail:
                    raise RuntimeError("function does not exist")
                self.result = (2,)

        class SweepConn(Conn):
            fail = False

            def cursor(self, **kwargs):
                return SweepCursor(self)

        conn = SweepConn([], {})
        self.assertEqual(worker.release_stale_device_hand_cuts(conn), 2)
        conn.fail = True
        self.assertEqual(worker.release_stale_device_hand_cuts(conn), 0)

    def test_only_the_hand_lane_sweeps(self):
        source = Path(worker.__file__).read_text()
        self.assertIn('device_sweep = LANE == "hand"', source)


if __name__ == "__main__":
    unittest.main()
