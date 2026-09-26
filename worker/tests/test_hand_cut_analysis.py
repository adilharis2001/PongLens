"""Detailed analysis and highlights for hand-marked matches (spec 2026-09-24,
section 5). Every rule here is branched on the match being a hand cut, so
most tests below check two things: the hand-cut branch does what the spec
asks, and the automatic branch is byte-for-byte what it was.
"""
import copy
import gzip
import inspect
import json
import math
import os
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import blurball_windowed
import hand_cut_analysis as hca
import highlight_backfill
import highlights
import placement_backfill
from email_templates import match_ready_message, render_email
from worker import worker

from worker.tests.test_placement_retry_job import (
    JOB_ID,
    MATCH_ID,
    USER_ID,
    FakeMutationConnection,
    generation_record,
    placement_fixture,
    retry_record,
)

REPO = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Windows and the saved tracking
# ---------------------------------------------------------------------------
class WindowTests(unittest.TestCase):
    def test_clip_windows_pad_clamp_and_merge_where_they_touch(self):
        points = [
            {"t0": 0.5, "t1": 4.0},          # clamps at 0
            {"t0": 6.0, "t1": 9.0},          # 4.8 .. 10.3, touches the first
            {"t0": 20.0, "t1": 25.0},
            {"t0": 98.0, "t1": 99.5},        # clamps at the duration
        ]
        self.assertEqual(
            hca.clip_windows(points, 100.0, 1.2, 1.3),
            [[0.0, 10.3], [18.8, 26.3], [96.8, 100.0]],
        )

    def test_database_numerics_are_times(self):
        # points.t0/t1 are numeric columns, so psycopg2 hands them back as
        # Decimal. The first hand-cut highlights job in production refused
        # every point as unmarked because only int and float counted.
        from decimal import Decimal
        points = [{"t0": Decimal("20.00"), "t1": Decimal("25.00")}]
        self.assertEqual(
            hca.clip_windows(points, Decimal("100.0"), 1.2, 1.3), [[18.8, 26.3]])
        self.assertFalse(hca._finite(Decimal("NaN")))
        self.assertFalse(hca._finite(True))

    def test_deleted_and_untimed_points_are_not_tracked(self):
        points = [{"t0": 10, "t1": 12, "deleted": True}, {"t0": None, "t1": 3}]
        self.assertEqual(hca.clip_windows(points, 50, 1.2, 1.3), [])

    def test_windows_cover(self):
        saved = [[0, 10], [20, 30]]
        self.assertTrue(hca.windows_cover(saved, [[1, 9], [21, 29.999]]))
        self.assertFalse(hca.windows_cover(saved, [[5, 25]]))
        self.assertFalse(hca.windows_cover([], [[1, 2]]))

    def test_clip_pads_prefer_the_column_then_match_json(self):
        self.assertEqual(hca.clip_pads(None, {"pre": 1.0, "post": 2.0}), (1.0, 2.0))
        self.assertEqual(
            hca.clip_pads({"options": {"clip_pads": {"pre": 0.9, "post": 1.1}}}),
            (0.9, 1.1))
        self.assertEqual(hca.clip_pads({}), (1.2, 1.3))

    def test_point_clip_start_follows_adjust_point(self):
        self.assertAlmostEqual(hca.point_clip_start({"t0": 20}, 1.2), 18.8)
        self.assertAlmostEqual(
            hca.point_clip_start({"t0": 20, "tight_start": True}, 1.2), 19.7)
        self.assertEqual(hca.point_clip_start({"t0": 0.5}, 1.2), 0.0)


class TrackingBundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.detections = self.root / "det.jsonl"
        self.detections.write_text(
            '{"f": 0, "x": null, "y": null, "conf": 0.0, "c": []}\n'
            '{"f": 1, "x": 1.0, "y": 2.0, "conf": 0.9, "c": [[1.0, 2.0, 0.9]]}\n')
        self.frames = {"v": 1, "frame_count": 2, "frame_times": [0.0, 0.0333],
                       "windows": [[0.0, 5.0]]}

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_keeps_every_detection_line(self):
        bundle = hca.write_tracking_bundle(
            self.root / "b.jsonl.gz", detections_path=self.detections,
            frames=self.frames, header={"raw_path": "r2://raw/a.mov"})
        header = hca.read_tracking_bundle(
            bundle, self.root / "out.jsonl", self.root / "out.frames.json")
        self.assertEqual((self.root / "out.jsonl").read_text(),
                         self.detections.read_text())
        self.assertEqual(json.loads((self.root / "out.frames.json").read_text()),
                         self.frames)
        self.assertTrue(hca.tracking_usable(
            header, raw_path="r2://raw/a.mov", needed=[[1.0, 4.0]]))
        self.assertFalse(hca.tracking_usable(
            header, raw_path="r2://raw/other.mov", needed=[[1.0, 4.0]]))
        self.assertFalse(hca.tracking_usable(
            header, raw_path="r2://raw/a.mov", needed=[[1.0, 6.0]]))

    def test_a_truncated_bundle_is_refused(self):
        bundle = self.root / "bad.jsonl.gz"
        with gzip.open(bundle, "wt") as out:
            out.write(json.dumps({"v": 1, "kind": "hand-cut-tracking",
                                  "frames": dict(self.frames, frame_count=3)}) + "\n")
            out.write(self.detections.read_text())
        with self.assertRaises(ValueError):
            hca.read_tracking_bundle(bundle, self.root / "o.jsonl",
                                     self.root / "o.json")


# ---------------------------------------------------------------------------
# Frame clock
# ---------------------------------------------------------------------------
class FrameClockTests(unittest.TestCase):
    def test_constant_rate_reproduces_the_automatic_arithmetic(self):
        fps = 30000 / 1001
        clock = hca.FrameClock([i / fps for i in range(20000)], fps)
        rng = random.Random(7)
        checked = 0
        for _ in range(5000):
            t = rng.uniform(0, 600)
            position = t * fps
            if abs(position - round(position)) < 1e-6:
                continue
            self.assertEqual(clock.frame_at_or_before(t), math.floor(position))
            self.assertEqual(clock.frame_at_or_after(t), math.ceil(position))
            checked += 1
        self.assertGreater(checked, 4900)

    def test_variable_rate_finds_the_frame_actually_shown(self):
        fps = 30.0
        # 300 frames at 30 fps, then a 2-second stall, then 300 more.
        times = [i / fps for i in range(300)] + [12.0 + i / fps for i in range(300)]
        clock = hca.FrameClock(times, fps)
        # A mark at 13 s: the 330th frame shown, frame 330. Seconds x rate
        # would say 390, two seconds later in the rally.
        self.assertEqual(clock.frame_at_or_before(13.0), 330)
        self.assertEqual(math.floor(13.0 * fps), 390)
        self.assertAlmostEqual(clock.real_from_nominal(330 / fps), 13.0)
        self.assertAlmostEqual(clock.nominal_from_real(13.0), 330 / fps)

    def test_nominal_and_real_round_trip(self):
        fps = 59.94
        times = [i / 60.0 + (0.004 if i % 7 == 0 else 0.0) for i in range(3000)]
        times.sort()
        clock = hca.FrameClock(times, fps)
        for frame in (0, 1, 17, 1234, 2999):
            nominal = frame / fps
            self.assertAlmostEqual(clock.real_from_nominal(nominal), times[frame])
            self.assertAlmostEqual(
                clock.nominal_from_real(times[frame]), nominal, places=9)

    def test_placement_times_move_to_the_real_clock_and_nothing_else_does(self):
        fps = 30.0
        clock = hca.FrameClock([0.0, 0.5, 1.0, 1.5], fps)
        payload = {
            "candidates": [{"frame": 2, "t": round(2 / fps, 4), "x": 3.0}],
            "hypotheses": {"near": {"shots": [{"contact_t": round(1 / fps, 4),
                                               "landing": {"t": round(3 / fps, 4),
                                                           "u": 0.5}}]}},
            "audio_t": 0.25,
        }
        moved = hca.placement_on_real_clock(copy.deepcopy(payload), clock)
        self.assertEqual(moved["candidates"][0]["t"], 1.0)
        self.assertEqual(moved["candidates"][0]["x"], 3.0)
        shot = moved["hypotheses"]["near"]["shots"][0]
        self.assertEqual(shot["contact_t"], 0.5)
        self.assertEqual(shot["landing"]["t"], 1.5)
        self.assertEqual(moved["audio_t"], 0.25)


# ---------------------------------------------------------------------------
# Placement reconstruction
# ---------------------------------------------------------------------------
class ReconstructionWindowTests(unittest.TestCase):
    """reconstruct_existing_match's frame windows, observed directly."""

    def run_reconstruction(self, points, **kwargs):
        seen = []

        def fake_placement(det, H, e, track, suggestion, f0, f1, fps, width,
                           audio=None, serve_s=None):
            seen.append((f0, f1))
            payload = placement_fixture(drawable=True)
            payload["candidates"] = [{"kind": "bounce", "frame": f0,
                                      "t": round(f0 / fps, 4)}]
            return payload

        match = {"source": {"fps": 30.0, "width": 1920, "height": 1080}}
        calibration = {"H": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                       "e": [0.0, -1.0]}
        with patch.object(placement_backfill, "fit_play", return_value=None), \
                patch.object(placement_backfill, "reconstruct_placement",
                             side_effect=fake_placement):
            placements = placement_backfill.reconstruct_existing_match(
                match, points, {}, calibration, **kwargs)
        return seen, placements

    def test_automatic_matches_keep_seconds_times_rate(self):
        seen, _ = self.run_reconstruction([{"idx": 1, "t0": 10.0, "t1": 12.5}])
        self.assertEqual(seen, [(300, 376)])

    def test_a_constant_rate_clock_without_padding_is_the_same_window(self):
        clock = hca.FrameClock([i / 30.0 for i in range(1000)], 30.0)
        seen, placements = self.run_reconstruction(
            [{"idx": 1, "t0": 10.01, "t1": 12.49}], frame_clock=clock,
            clip_pre=0.0)
        legacy, _ = self.run_reconstruction([{"idx": 1, "t0": 10.01, "t1": 12.49}])
        self.assertEqual(seen, legacy)
        self.assertEqual(placements[1]["candidates"][0]["t"],
                         round(seen[0][0] / 30.0, 4))

    def test_a_hand_cut_is_read_from_its_clip_start(self):
        clock = hca.FrameClock([i / 30.0 for i in range(1000)], 30.0)
        seen, _ = self.run_reconstruction(
            [{"idx": 1, "t0": 10.0, "t1": 12.5}], frame_clock=clock, clip_pre=1.2)
        self.assertEqual(seen, [(264, 376)])

    def test_a_variable_rate_hand_cut_finds_its_frames_by_real_time(self):
        times = [i / 30.0 for i in range(300)] + [12.0 + i / 30.0 for i in range(300)]
        clock = hca.FrameClock(times, 30.0)
        seen, placements = self.run_reconstruction(
            [{"idx": 1, "t0": 13.2, "t1": 14.0}], frame_clock=clock, clip_pre=1.2)
        self.assertEqual(seen, [(300, 361)])
        # The payload's times are back on the video's clock: frame 300 was
        # shown at 12.0 s, not at 10.0 s.
        self.assertEqual(placements[1]["candidates"][0]["t"], 12.0)

    def test_the_subprocess_passes_the_clock_only_when_asked(self):
        source = inspect.getsource(placement_backfill.reconstruct_files)
        self.assertIn("if frame_times_path is not None", source)
        args = placement_backfill.parse_args([
            "reconstruct", "--match-json", "m", "--points-json", "p",
            "--blurball", "b", "--video", "v", "--output", "o"])
        self.assertIsNone(args.frame_times)
        self.assertIsNone(args.clip_pre)


class ReconstructionCommandTests(unittest.TestCase):
    def capture(self, **kwargs):
        calls = []
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "placement-backfill.json"

            def runner(command, **_kwargs):
                calls.append(command)
                output.write_text(json.dumps({"placements": {}, "match": {}}))

            worker.run_placement_reconstruction(
                "m.json", "v.mp4", "b.jsonl", [{"idx": 1}], root,
                command_runner=runner, **kwargs)
        return calls[0]

    def test_automatic_command_is_unchanged(self):
        command = self.capture()
        self.assertEqual(command[-2:], ["--output", command[-1]])
        self.assertNotIn("--frame-times", command)
        self.assertNotIn("--clip-pre", command)

    def test_hand_cut_command_adds_the_clock_and_the_pad(self):
        command = self.capture(frame_times_path="f.json", clip_pre=1.2)
        self.assertEqual(command[-4:], ["--frame-times", "f.json", "--clip-pre", "1.2"])


# ---------------------------------------------------------------------------
# The worker's placement job on a hand cut
# ---------------------------------------------------------------------------
class HandCutPlacementJobTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeMutationConnection()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.mp4"
        self.source.write_bytes(b"video")
        self.match = self.root / "match.json"
        # A hand cut from before 2026-09-24: no fps, width or height.
        self.match.write_text(json.dumps({
            "version": 3, "pipeline": "hand-v1",
            "source": {"duration": 236.32},
            "options": {"clip_pads": {"pre": 1.2, "post": 1.3}},
            "points": [{"idx": 1, "t0": 1.0, "t1": 2.0, "placement": None}],
        }))
        self.frames = self.root / "blurball.jsonl.frames.json"
        self.frames.write_text("{}")
        self.blurball = self.root / "blurball.jsonl"
        self.blurball.write_text("")
        self.reconstruct_calls = []

        def reconstruct(match_path, video, blurball, points, workdir, **kwargs):
            self.reconstruct_calls.append(kwargs)
            match = json.loads(Path(match_path).read_text())
            placement = placement_fixture(drawable=True)
            merged = copy.deepcopy(match)
            merged["points"][0]["placement"] = placement
            return {"placements": {"1": placement}, "match": merged}

        self.patches = [
            patch("worker.worker.load_placement_attempt_record",
                  side_effect=lambda *a, **k: generation_record(cut_source="manual")),
            patch("worker.worker.download_backfill_inputs",
                  return_value=(self.source, self.match)),
            patch("worker.worker.run_blurball_only"),
            patch("worker.worker.ensure_hand_cut_tracking",
                  return_value=(self.blurball, self.frames, {})),
            patch("worker.worker.video_source_geometry",
                  return_value={"fps": 30000 / 1001, "width": 1920, "height": 1080}),
            patch("worker.worker.run_placement_calibration",
                  return_value={"ok": True, "code": None, "calibration": {
                      "ok": True, "table_corners_px": {}, "length_axis": [0.0, -1.0]}}),
            patch("worker.worker.run_placement_reconstruction", side_effect=reconstruct),
            patch("worker.worker.upload_match_json"),
            patch("worker.worker.verify_placement_attempt"),
            patch("worker.worker.restore_match_json"),
        ]
        self.mocks = {p.attribute: p.start() for p in self.patches}

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def test_hand_cut_is_tracked_inside_its_marks_and_read_by_real_times(self):
        result = worker.placement_for_match(
            self.connection, JOB_ID, USER_ID, MATCH_ID,
            worker.NORMAL_PLACEMENT_ATTEMPT)
        self.assertTrue(result.succeeded)
        self.mocks["run_blurball_only"].assert_not_called()
        tracking = self.mocks["ensure_hand_cut_tracking"].call_args
        self.assertEqual(tracking.kwargs["raw_path"], generation_record()["input_path"])
        self.assertEqual(self.reconstruct_calls, [
            {"frame_times_path": self.frames, "clip_pre": 1.2}])
        uploaded = self.mocks["upload_match_json"].call_args.args[1]
        self.assertEqual(uploaded["source"],
                         {"duration": 236.32, "fps": 29.97, "width": 1920,
                          "height": 1080})

    def test_an_automatic_match_runs_exactly_as_before(self):
        self.mocks["load_placement_attempt_record"].side_effect = (
            lambda *a, **k: generation_record(cut_source="auto"))
        self.mocks["run_blurball_only"].return_value = self.blurball
        self.match.write_text(json.dumps({
            "version": 3, "source": {"duration": 10, "fps": 30, "width": 1920,
                                     "height": 1080},
            "points": [{"idx": 1, "placement": None}]}))
        result = worker.placement_for_match(
            self.connection, JOB_ID, USER_ID, MATCH_ID,
            worker.NORMAL_PLACEMENT_ATTEMPT)
        self.assertTrue(result.succeeded)
        self.mocks["ensure_hand_cut_tracking"].assert_not_called()
        self.mocks["video_source_geometry"].assert_not_called()
        self.assertEqual(self.reconstruct_calls, [{}])


class SourceGeometryTests(unittest.TestCase):
    def test_probe_reads_the_first_video_stream_like_points_pipeline(self):
        streams = {"streams": [
            {"codec_type": "audio"},
            {"codec_type": "video", "avg_frame_rate": "2125200/70897",
             "width": 1920, "height": 1080}]}
        with patch.object(worker, "_ffprobe_streams", return_value=streams):
            geometry = worker.video_source_geometry("x.mov")
        self.assertAlmostEqual(geometry["fps"], 2125200 / 70897)
        streams["streams"][1]["avg_frame_rate"] = "0/0"
        with patch.object(worker, "_ffprobe_streams", return_value=streams):
            self.assertEqual(worker.video_source_geometry("x.mov")["fps"], 29.97)

    def test_existing_values_are_never_touched(self):
        match = {"source": {"duration": 5, "fps": 60, "width": 3840, "height": 2160}}
        with patch.object(worker, "video_source_geometry") as probe:
            self.assertFalse(worker.fill_missing_source_geometry(match, "v"))
        probe.assert_not_called()

    def test_new_hand_cuts_record_frame_rate_and_size(self):
        self.assertEqual(
            worker.hand_cut_match_source(
                236.3233, {"fps": 2125200 / 70897, "width": 1920, "height": 1080}),
            {"duration": 236.32, "fps": 29.976, "width": 1920, "height": 1080})
        self.assertEqual(worker.hand_cut_match_source(10.0, None), {"duration": 10.0})


class HandCutTrackingTests(unittest.TestCase):
    """ensure_hand_cut_tracking: reuse what is saved, track what is not."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = {}
        store = self.store

        class FakeR2:
            def download_file(self, bucket, key, destination):
                if (bucket, key) not in store:
                    raise FileNotFoundError(key)
                Path(destination).write_bytes(store[(bucket, key)])

            def upload_file(self, source, bucket, key, ExtraArgs=None):
                store[(bucket, key)] = Path(source).read_bytes()

        self.r2 = patch.object(worker, "r2", return_value=FakeR2())
        self.r2.start()
        self.probe = patch.object(worker, "probe_duration_s", return_value=100.0)
        self.probe.start()
        self.runs = []

        def windowed(video, workdir, windows):
            self.runs.append(windows)
            out = Path(workdir) / "blurball.jsonl"
            out.write_text('{"f": 0, "x": null, "y": null, "conf": 0.0, "c": []}\n')
            frames = Path(str(out) + ".frames.json")
            frames.write_text(json.dumps({"v": 1, "frame_count": 1,
                                          "frame_times": [0.0], "windows": windows}))
            return out, frames

        self.windowed = patch.object(worker, "run_blurball_windowed", side_effect=windowed)
        self.windowed.start()

    def tearDown(self):
        self.windowed.stop()
        self.probe.stop()
        self.r2.stop()
        self.tmp.cleanup()

    def ensure(self, points, workdir):
        return worker.ensure_hand_cut_tracking(
            "source.mp4", workdir,
            match_json_path="r2://ponglens-media/points/u/m/match.json",
            raw_path="r2://ponglens-raw/u/raw.mov", points=points,
            match_doc={"options": {"clip_pads": {"pre": 1.2, "post": 1.3}}})

    def test_first_run_tracks_the_clip_windows_and_saves_them(self):
        first = self.root / "a"
        first.mkdir()
        self.ensure([{"t0": 10, "t1": 12}, {"t0": 40, "t1": 44}], first)
        self.assertEqual(self.runs, [[[8.8, 13.3], [38.8, 45.3]]])
        self.assertIn(("ponglens-media", "points/u/m/hand-tracking.jsonl.gz"), self.store)

    def test_a_second_job_reuses_the_saved_tracking(self):
        for name in ("a", "b"):
            (self.root / name).mkdir()
        self.ensure([{"t0": 10, "t1": 12}], self.root / "a")
        detections, frames, header = self.ensure([{"t0": 10, "t1": 12}], self.root / "b")
        self.assertEqual(len(self.runs), 1)
        self.assertTrue(detections.is_file())
        self.assertEqual(json.loads(frames.read_text())["frame_times"], [0.0])
        self.assertEqual(header["raw_path"], "r2://ponglens-raw/u/raw.mov")

    def test_a_point_moved_outside_the_saved_windows_is_tracked_again(self):
        for name in ("a", "b"):
            (self.root / name).mkdir()
        self.ensure([{"t0": 10, "t1": 12}], self.root / "a")
        self.ensure([{"t0": 10, "t1": 20}], self.root / "b")
        self.assertEqual(len(self.runs), 2)


# ---------------------------------------------------------------------------
# Highlights
# ---------------------------------------------------------------------------
END_CASES = json.loads(
    (REPO / "src/app/api/highlights/fixtures/hand-cut-end-cases.json").read_text())


class HighlightEndParityTests(unittest.TestCase):
    def test_segment_end_matches_the_shared_fixture(self):
        self.assertGreaterEqual(len(END_CASES["cases"]), 7)
        for case in END_CASES["cases"]:
            bounds = highlights._segment_bounds(case["point"], case["clip_pre"])
            self.assertIsNotNone(bounds, case["name"])
            self.assertAlmostEqual(bounds[1], case["expected_end"], places=9,
                                   msg=case["name"])

    def test_without_a_pad_the_rule_is_the_established_expression(self):
        point = {"t0": 20.0, "cut_t0": 10.0, "scored_at_cut_s": None,
                 "rally_end_cut_s": None, "tight_start": True,
                 "highlight_evidence": {"observed_end_s": 27.0}}
        self.assertEqual(highlights._segment_bounds(point),
                         (10.0, 10.0 + 27.0 - 20.0 + highlights.DETECTOR_END_TAIL_S))

    def test_a_hand_cut_manifest_ends_each_rally_a_pad_later(self):
        point = {
            "id": "p1", "idx": 1, "t0": 20.0, "t1": 28.0, "cut_t0": 10.0,
            "scored_at_cut_s": None, "rally_end_cut_s": None,
            "confirmed_winner": "user", "clip_path": "r2://m/p1.mp4",
            "deleted": False, "edited": False, "is_let": False,
            "highlight_evidence": {"v": 2, "status": "ready", "n_hits": None,
                                   "connected_crossings": 6,
                                   "alternating_table_landings": 2,
                                   "table_bounces": 3, "observed_end_s": 27.0},
        }
        automatic = highlights.build_manifest([point])
        hand_cut = highlights.build_manifest([point], clip_pre=1.2)
        self.assertEqual(automatic["points"][0]["cut_end_s"], 17.25)
        self.assertEqual(hand_cut["points"][0]["cut_end_s"], 18.45)
        self.assertEqual(automatic["points_revision"], hand_cut["points_revision"])


class HighlightReceiptTests(unittest.TestCase):
    def point(self, **overrides):
        point = {"id": "p1", "idx": 1, "t0": 10.0, "t1": 20.0, "cut_t0": 4.0,
                 "rally_end_cut_s": None, "scored_at_cut_s": None,
                 "suggestion": None}
        point.update(overrides)
        return point

    def diagnostic(self):
        return {"cards": [{"t0": 10.0, "t1": 20.0,
                           "crossings": [11.0, 12.0, 13.0, 14.0, 15.0],
                           "bounces": []}],
                "meta": {"route": "serve"}}

    def test_a_constant_rate_clock_changes_nothing(self):
        clock = hca.FrameClock([i / 30.0 for i in range(1000)], 30.0)
        plain = highlight_backfill.build_receipts_from_diagnostic(
            [self.point()], self.diagnostic())
        clocked = highlight_backfill.build_receipts_from_diagnostic(
            [self.point()], self.diagnostic(), frame_clock=clock, clip_pre=1.2)
        self.assertEqual(plain, clocked)

    def test_a_variable_rate_receipt_is_matched_and_reported_on_real_time(self):
        # The detector's clock says 10..20 s; the video shows those frames
        # 2 s later because of a stall at 5 s.
        times = [i / 30.0 for i in range(150)] + [7.0 + i / 30.0 for i in range(800)]
        clock = hca.FrameClock(times, 30.0)
        receipts = highlight_backfill.build_receipts_from_diagnostic(
            [self.point(t0=12.0, t1=22.0)], self.diagnostic(),
            frame_clock=clock, clip_pre=1.2)
        receipt = receipts["p1"]
        self.assertEqual(receipt["status"], "ready")
        self.assertEqual(receipt["connected_crossings"], 5)
        self.assertEqual(receipt["last_crossing_s"], 17.0)

    def test_a_scoring_tap_on_a_hand_cut_is_read_from_the_padded_start(self):
        point = self.point(cut_t0=4.0, scored_at_cut_s=12.0)
        automatic = highlight_backfill._source_rally_end(point)
        hand_cut = highlight_backfill._source_rally_end(point, 1.2)
        self.assertEqual(automatic, (18.0, "tap"))
        self.assertAlmostEqual(hand_cut[0], 16.8)


class HighlightRefreshRoutingTests(unittest.TestCase):
    def test_the_refresh_no_longer_skips_hand_cuts(self):
        source = inspect.getsource(worker._prepare_automatic_highlight_manifest)
        self.assertNotIn("not hand_cut", source)
        self.assertIn("hand_cut_clip_pre(conn, match_id)", source)

    def test_the_hand_lane_dispatch_does_not_filter_kinds(self):
        self.assertNotIn("LANE", inspect.getsource(worker.process_job))


# ---------------------------------------------------------------------------
# Ready email
# ---------------------------------------------------------------------------
class ReadyEmailTests(unittest.TestCase):
    def test_a_scored_hand_cut_is_not_asked_to_score(self):
        rendered = render_email(match_ready_message(
            "Julian.mov", "https://www.ponglens.com/match/preview", scored=True))
        self.assertNotIn("Score it", rendered.text)
        self.assertIn("with the score you called while marking", rendered.text)
        self.assertNotIn("—", rendered.text)

    def test_every_other_match_keeps_the_approved_sentence(self):
        rendered = render_email(match_ready_message(
            "Julian.mov", "https://www.ponglens.com/match/preview"))
        self.assertIn("Julian.mov is ready to watch point by point. Score it, "
                      "add notes, or share it with your coach.", rendered.text)

    def test_the_scored_check_never_raises(self):
        self.assertFalse(worker.hand_cut_submitted_scored(None, JOB_ID))
        self.assertFalse(worker.hand_cut_submitted_scored(object(), JOB_ID))

    def test_the_scored_check_needs_every_point_called(self):
        class Cursor:
            def __init__(self, row):
                self.row = row

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def execute(self, query, params):
                self.query = query

            def fetchone(self):
                return self.row

        class Connection:
            autocommit = True

            def __init__(self, row):
                self.row = row

            def cursor(self):
                return Cursor(self.row)

        self.assertTrue(worker.hand_cut_submitted_scored(Connection((9, 9, 10)), JOB_ID))
        self.assertFalse(worker.hand_cut_submitted_scored(Connection((9, 8, 10)), JOB_ID))
        self.assertFalse(worker.hand_cut_submitted_scored(Connection((0, 0, 0)), JOB_ID))


# ---------------------------------------------------------------------------
# blurball_windowed.py planning (the inference itself is proven on real
# footage; see docs/research/2026-09-24-hand-cut-analysis)
# ---------------------------------------------------------------------------
class WindowedPlanningTests(unittest.TestCase):
    def test_batches_are_whole_and_aligned_to_the_full_run(self):
        times = [i / 30.0 for i in range(3000)]
        blocks = blurball_windowed.plan_blocks(times, [[10.0, 11.0]], [3.0], 3000)
        # 7 s is frame 210 (block 8), 11 s is frame 330 (block 13).
        self.assertEqual(blocks, set(range(8, 14)))
        last_resort = blurball_windowed.plan_blocks(times, [[10.0, 11.0]], [None], 3000)
        self.assertEqual(last_resort, set(range(0, 14)))

    def test_a_window_settles_only_after_an_empty_frame(self):
        times = [i / 30.0 for i in range(3000)]
        window = [10.0, 11.0]            # frames 300..330
        computed = set(range(8, 14))     # frames 192..335
        busy = {frame: [{"score": 1.0}] for frame in range(192, 336)}
        self.assertFalse(blurball_windowed.converged(times, window, computed, busy))
        busy[250] = []
        self.assertTrue(blurball_windowed.converged(times, window, computed, busy))
        # A batch missing inside the window is never settled.
        self.assertFalse(blurball_windowed.converged(
            times, window, computed - {12}, busy))
        # Computed from frame 0 is the full run itself.
        self.assertTrue(blurball_windowed.converged(
            times, window, set(range(0, 14)), {f: [1] for f in range(336)}))

    def test_the_release_rewrite_of_the_wrapper_hashes_the_same(self):
        original = "x = 1\n" + blurball_windowed.ORIGINAL_REPO_LINE + "\ny = 2\n"
        released = original.replace(blurball_windowed.ORIGINAL_REPO_LINE,
                                    blurball_windowed.RELEASE_REPO_LINE)
        self.assertEqual(blurball_windowed.wrapper_digest(original),
                         blurball_windowed.wrapper_digest(released))

    @unittest.skipUnless(os.path.exists(blurball_windowed.DEFAULT_WRAPPER),
                         "TTVid wrapper not on this machine")
    def test_the_reviewed_hash_is_the_wrapper_on_this_machine(self):
        text = Path(blurball_windowed.DEFAULT_WRAPPER).read_text()
        self.assertEqual(blurball_windowed.wrapper_digest(text),
                         blurball_windowed.REVIEWED_WRAPPER_SHA256)

    def test_the_worker_calls_the_windowed_runner_with_the_sealed_wrapper(self):
        calls = []

        def runner(command, **kwargs):
            calls.append(command)
            out = Path(command[command.index("--out") + 1])
            out.write_text("")
            Path(str(out) + ".frames.json").write_text("{}")

        with tempfile.TemporaryDirectory() as root:
            worker.run_blurball_windowed("v.mp4", root, [[1.0, 2.0]],
                                         command_runner=runner)
            self.assertEqual(json.loads((Path(root) / "tracking-windows.json")
                                        .read_text()), [[1.0, 2.0]])
        command = calls[0]
        self.assertEqual(command[1], worker.BLURBALL_WINDOWED)
        self.assertEqual(command[command.index("--wrapper") + 1], worker.BLURBALL_INFER)


# ---------------------------------------------------------------------------
# Reusing the table the upload already has (audit D, 2026-09-26)
# ---------------------------------------------------------------------------
FIXTURE_636F = json.loads(
    (Path(__file__).parent / "fixtures" / "prior-table-636f3f37.json").read_text())
RAW = "r2://ponglens-raw/owner/original.mov"
HAND_VERSION = "19bf2994-0000-4000-8000-000000000000"
AUTO_VERSION = "8bdf5aad-0000-4000-8000-000000000000"
AUTO_MATCH_JSON = "r2://ponglens-media/points/owner/match/match.json"


def automatic_doc(**calibration_changes):
    doc = copy.deepcopy(FIXTURE_636F["automatic"])
    doc["calibration"].update(calibration_changes)
    return doc


class ReusableTableTests(unittest.TestCase):
    """The trust rules, one refusal each."""

    def ask(self, document, *, document_raw=RAW, raw=RAW, size=(1920, 1080)):
        return hca.reusable_table(document, document_raw_path=document_raw,
                                  raw_path=raw, width=size[0], height=size[1])

    def test_a_vision_or_keypoint_table_of_the_same_upload_is_reused(self):
        table, why = self.ask(automatic_doc())
        self.assertEqual(why, "ok")
        self.assertEqual(table["source"], "vision")
        self.assertEqual(table["table_corners_px"],
                         FIXTURE_636F["automatic"]["calibration"]["table_corners_px"])
        table, _ = self.ask(automatic_doc(source="keypoints"))
        self.assertEqual(table["source"], "keypoints")

    def test_an_older_document_is_trusted_only_when_its_note_names_the_detector(self):
        for note, expected in (
                ("keypoint detector (tt-keypoints), 14/16 frames agree", "keypoints"),
                ("vision-proposed quad (gpt-5.6-sol), 3 trials", "vision"),
                ("auto pink-rim median-background calibration", None),
                ("a table from somewhere", None)):
            with self.subTest(note=note):
                doc = automatic_doc(note=note)
                doc["calibration"].pop("source")
                table, why = self.ask(doc)
                self.assertEqual(table and table["source"], expected, why)

    def test_never_the_pink_rim(self):
        table, why = self.ask(automatic_doc(source="pink_rim"))
        self.assertIsNone(table)
        self.assertEqual(why, "found by pink_rim")

    def test_never_another_upload(self):
        for document_raw, raw in (("r2://ponglens-raw/owner/other.mov", RAW),
                                  (None, RAW), (RAW, None)):
            with self.subTest(document_raw=document_raw, raw=raw):
                table, why = self.ask(automatic_doc(), document_raw=document_raw,
                                      raw=raw)
                self.assertIsNone(table)
                self.assertEqual(why, "made from another upload")

    def test_never_across_a_frame_size_change(self):
        table, why = self.ask(automatic_doc(), size=(1280, 720))
        self.assertIsNone(table)
        self.assertIn("1920x1080", why)
        for size in ((None, None), (0, 1080), (1920.5, 1080)):
            with self.subTest(size=size):
                self.assertIsNone(self.ask(automatic_doc(), size=size)[0])
        unknown = automatic_doc()
        unknown["source"] = {"duration": 964.42}
        self.assertEqual(self.ask(unknown), (None, "its frame size is unknown"))
        outside = automatic_doc()
        outside["calibration"]["table_corners_px"] = dict(
            outside["calibration"]["table_corners_px"], C_far_2=[1930.0, 580.8])
        self.assertEqual(self.ask(outside), (None, "a corner lies outside the frame"))

    def test_nothing_found_is_nothing_reused(self):
        cases = {
            "no document": None,
            "no calibration": FIXTURE_636F["hand"],
            "declined": dict(automatic_doc(), calibration={"ok": False}),
            "missing corner": automatic_doc(table_corners_px={
                "A_near_1": [1, 2], "B_near_2": [3, 4], "C_far_2": [5, 6]}),
            "not a number": automatic_doc(table_corners_px={
                "A_near_1": [1, 2], "B_near_2": [3, 4], "C_far_2": [5, 6],
                "D_far_1": [float("nan"), 6]}),
        }
        for name, document in cases.items():
            with self.subTest(name):
                self.assertIsNone(self.ask(document)[0])


class PriorTableConn:
    """Answers the two lookups prior_table_candidates makes."""

    def __init__(self, chain=(), siblings=()):
        self.chain = list(chain)
        self.siblings = list(siblings)
        self.calls = []
        self.autocommit = True

    def cursor(self, **kwargs):
        conn = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, query, params=None):
                self.sql = " ".join(query.split())
                conn.calls.append((self.sql, params))

            def fetchall(self):
                if self.sql.startswith("with recursive chain"):
                    return conn.chain
                if "from public.matches pm" in self.sql:
                    return conn.siblings
                return []

        return Cursor()


class PriorTableR2:
    def __init__(self, objects):
        self.objects = objects
        self.downloads = []

    def head_object(self, Bucket, Key):
        from botocore.exceptions import ClientError
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": len(self.objects[(Bucket, Key)])}

    def download_file(self, bucket, key, destination):
        self.downloads.append(key)
        Path(destination).write_bytes(self.objects[(bucket, key)])


def r2_objects(**documents):
    return {("ponglens-media", path.split("ponglens-media/", 1)[1]):
            json.dumps(document).encode() for path, document in documents.items()}


def run_reuse_command(size=(1920, 1080)):
    """A command runner that runs placement_retry_calibration's reuse
    command in this process, against a probe that reports `size`."""
    from worker import placement_retry_calibration as prc

    calls = []

    def runner(command, **kwargs):
        calls.append(command)
        assert command[0] == worker.VENV_PY
        assert command[1] == worker.PLACEMENT_RETRY_CALIBRATION
        with patch.object(prc, "probe", return_value={
                "width": size[0], "height": size[1], "fps": 59.947,
                "duration": 964.42}), \
                patch("sys.argv", ["placement_retry_calibration.py", *command[2:]]):
            assert prc.main() == 0

    return runner, calls


class PriorTableLookupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.runner, self.commands = run_reuse_command()
        real = worker.canonical_prior_table
        self.canonical = patch.object(
            worker, "canonical_prior_table",
            side_effect=lambda stored, video, root: real(
                stored, video, root, command_runner=self.runner))
        self.canonical.start()

    def tearDown(self):
        self.canonical.stop()
        self.tmp.cleanup()

    def reuse(self, conn, objects, *, raw=RAW, own=None, size=(1920, 1080)):
        fake = PriorTableR2(objects)
        with patch.object(worker, "r2", lambda: fake):
            table = worker.reuse_prior_table(
                conn, match_id=MATCH_ID, processing_version_id=HAND_VERSION,
                raw_path=raw, video_path=self.root / "source.mp4",
                geometry={"width": size[0], "height": size[1]},
                workdir=self.root, own_document=own)
        return table, fake

    def test_636f3f37_gets_the_table_its_replaced_version_found(self):
        conn = PriorTableConn(chain=[(AUTO_VERSION, RAW, AUTO_MATCH_JSON)])
        table, fake = self.reuse(conn, r2_objects(**{AUTO_MATCH_JSON: automatic_doc()}),
                                 own=FIXTURE_636F["hand"])
        self.assertEqual(table["source"], "vision")
        self.assertEqual(table["reused_from"], {
            "relation": "replaced", "match_id": MATCH_ID,
            "processing_version_id": AUTO_VERSION,
            "match_json_path": AUTO_MATCH_JSON})
        self.assertEqual(table["table_corners_px"],
                         FIXTURE_636F["automatic"]["calibration"]["table_corners_px"])
        self.assertEqual(len(self.commands), 1)
        # The chain starts at the version being analysed and stays on its match.
        chain_sql, params = conn.calls[0]
        self.assertTrue(chain_sql.startswith("with recursive chain"))
        self.assertEqual(params[:3], (HAND_VERSION, MATCH_ID, MATCH_ID))

    def test_the_cuts_own_carried_table_comes_first(self):
        own = copy.deepcopy(FIXTURE_636F["hand"])
        own["calibration"] = automatic_doc(source="keypoints")["calibration"]
        conn = PriorTableConn(chain=[(AUTO_VERSION, RAW, AUTO_MATCH_JSON)])
        table, fake = self.reuse(conn, {}, own=own)
        self.assertEqual(table["source"], "keypoints")
        self.assertEqual(fake.downloads, [])

    def test_a_keep_copy_reuses_its_originals_table(self):
        original = "r2://ponglens-media/points/owner/original/match.json"
        conn = PriorTableConn(siblings=[("orig-match", "orig-version", RAW, original)])
        table, _ = self.reuse(conn, r2_objects(**{original: automatic_doc()}))
        self.assertEqual(table["reused_from"]["relation"], "copied")
        self.assertTrue(table["note"].endswith(
            "reused from the match this one was copied from"))
        sibling_sql, params = conn.calls[1]
        self.assertIn("pm.raw_path = %s", sibling_sql)
        self.assertIn("owner.user_id", sibling_sql)
        self.assertEqual(params[:3], (MATCH_ID, MATCH_ID, RAW))

    def test_a_refused_candidate_falls_through_to_the_next(self):
        pink = "r2://ponglens-media/points/owner/match/versions/pink/match.json"
        other = "r2://ponglens-media/points/owner/match/versions/other/match.json"
        swept = "r2://ponglens-media/points/owner/match/versions/swept/match.json"
        conn = PriorTableConn(chain=[
            ("swept", RAW, swept),                        # files swept: unreadable
            ("pink", RAW, pink),                          # pink rim
            ("other", "r2://ponglens-raw/owner/other.mov", other),  # other upload
            (AUTO_VERSION, RAW, AUTO_MATCH_JSON)])
        table, fake = self.reuse(conn, r2_objects(**{
            pink: automatic_doc(source="pink_rim"),
            other: automatic_doc(),
            AUTO_MATCH_JSON: automatic_doc()}))
        self.assertEqual(table["reused_from"]["processing_version_id"], AUTO_VERSION)
        # Another upload's match.json is never even read.
        self.assertEqual(fake.downloads, [
            pink.split("ponglens-media/")[1],
            AUTO_MATCH_JSON.split("ponglens-media/")[1]])
        self.assertEqual(len(self.commands), 1)

    def test_every_refusal_ends_in_detecting_as_before(self):
        cases = {
            "absent": (PriorTableConn(), {}, RAW, (1920, 1080)),
            "pink rim": (PriorTableConn(chain=[(AUTO_VERSION, RAW, AUTO_MATCH_JSON)]),
                         r2_objects(**{AUTO_MATCH_JSON: automatic_doc(source="pink_rim")}),
                         RAW, (1920, 1080)),
            "other upload": (PriorTableConn(chain=[
                (AUTO_VERSION, "r2://ponglens-raw/owner/other.mov", AUTO_MATCH_JSON)]),
                r2_objects(**{AUTO_MATCH_JSON: automatic_doc()}), RAW, (1920, 1080)),
            "frame size": (PriorTableConn(chain=[(AUTO_VERSION, RAW, AUTO_MATCH_JSON)]),
                           r2_objects(**{AUTO_MATCH_JSON: automatic_doc()}),
                           RAW, (1280, 720)),
            "no original": (PriorTableConn(chain=[(AUTO_VERSION, RAW, AUTO_MATCH_JSON)]),
                            r2_objects(**{AUTO_MATCH_JSON: automatic_doc()}),
                            None, (1920, 1080)),
        }
        for name, (conn, objects, raw, size) in cases.items():
            with self.subTest(name):
                table, _ = self.reuse(conn, objects, raw=raw, size=size)
                self.assertIsNone(table)
        self.assertEqual(self.commands, [], "nothing refused reaches the canonicaliser")

    def test_the_canonicaliser_has_the_last_word(self):
        """The worker's reading of the frame agrees but the pipeline
        interpreter's own probe does not: refused."""
        self.canonical.stop()
        runner, commands = run_reuse_command(size=(1280, 720))
        real = worker.canonical_prior_table
        self.canonical = patch.object(
            worker, "canonical_prior_table",
            side_effect=lambda stored, video, root: real(
                stored, video, root, command_runner=runner))
        self.canonical.start()
        conn = PriorTableConn(chain=[(AUTO_VERSION, RAW, AUTO_MATCH_JSON)])
        table, _ = self.reuse(conn, r2_objects(**{AUTO_MATCH_JSON: automatic_doc()}))
        self.assertIsNone(table)
        self.assertEqual(len(commands), 1)

    def test_it_never_raises(self):
        class Broken:
            autocommit = True

            def cursor(self, **kwargs):
                raise RuntimeError("database gone")

        table, _ = self.reuse(Broken(), {})
        self.assertIsNone(table)


class HandCutPlacementReuseTests(unittest.TestCase):
    """placement_for_match on 636f3f37's shape: a hand Replace of an
    automatic version whose table the vision rung found."""

    def setUp(self):
        self.connection = FakeMutationConnection()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.mp4"
        self.source.write_bytes(b"video")
        self.match = self.root / "match.json"
        hand = copy.deepcopy(FIXTURE_636F["hand"])
        hand["points"] = [{"idx": 1, "t0": 1.0, "t1": 2.0, "placement": None}]
        self.match.write_text(json.dumps(hand))
        self.frames = self.root / "blurball.jsonl.frames.json"
        self.frames.write_text("{}")
        self.blurball = self.root / "blurball.jsonl"
        self.blurball.write_text("")
        self.reconstructed = []

        def reconstruct(match_path, video, blurball, points, workdir, **kwargs):
            match = json.loads(Path(match_path).read_text())
            self.reconstructed.append(match)
            placement = placement_fixture(drawable=True)
            merged = copy.deepcopy(match)
            merged["points"][0]["placement"] = placement
            return {"placements": {"1": placement}, "match": merged}

        runner, self.commands = run_reuse_command()
        real = worker.canonical_prior_table
        fake_r2 = PriorTableR2(r2_objects(**{AUTO_MATCH_JSON: automatic_doc()}))
        self.record = lambda attempt: (generation_record if attempt == "normal"
                                       else retry_record)(
            cut_source="manual", raw_path=RAW, processing_version_id=HAND_VERSION,
            job_processing_version_id=HAND_VERSION)
        self.patches = [
            patch("worker.worker.load_placement_attempt_record",
                  side_effect=lambda *a, **k: self.record(a[4].name)),
            patch("worker.worker.download_backfill_inputs",
                  return_value=(self.source, self.match)),
            patch("worker.worker.ensure_hand_cut_tracking",
                  return_value=(self.blurball, self.frames, {})),
            patch("worker.worker.video_source_geometry",
                  return_value={"fps": 59.947, "width": 1920, "height": 1080}),
            patch("worker.worker.run_placement_calibration"),
            patch("worker.worker.prior_table_candidates", return_value=[{
                "relation": "replaced", "match_id": MATCH_ID,
                "processing_version_id": AUTO_VERSION, "raw_path": RAW,
                "match_json_path": AUTO_MATCH_JSON}]),
            patch("worker.worker.canonical_prior_table",
                  side_effect=lambda stored, video, root: real(
                      stored, video, root, command_runner=runner)),
            patch("worker.worker.r2", lambda: fake_r2),
            patch("worker.worker.run_placement_reconstruction", side_effect=reconstruct),
            patch("worker.worker.upload_match_json"),
            patch("worker.worker.verify_placement_attempt"),
            patch("worker.worker.restore_match_json"),
            patch("worker.worker._update_placement_lifecycle"),
            patch("worker.worker._update_backfill_rows"),
        ]
        self.mocks = {p.attribute: p.start() for p in self.patches}

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.tmp.cleanup()

    def test_the_replaced_versions_table_is_used_before_detecting(self):
        for attempt in (worker.NORMAL_PLACEMENT_ATTEMPT,
                        worker.STRONGER_PLACEMENT_ATTEMPT):
            with self.subTest(attempt=attempt.name):
                self.reconstructed.clear()
                result = worker.placement_for_match(
                    self.connection, JOB_ID, USER_ID, MATCH_ID, attempt)
                self.assertTrue(result.succeeded)
                self.mocks["run_placement_calibration"].assert_not_called()
                table = self.reconstructed[0]["calibration"]
                self.assertEqual(table["source"], "vision")
                self.assertEqual(table["reused_from"]["processing_version_id"],
                                 AUTO_VERSION)
                self.assertEqual(
                    table["table_corners_px"],
                    FIXTURE_636F["automatic"]["calibration"]["table_corners_px"])
                uploaded = self.mocks["upload_match_json"].call_args.args[1]
                self.assertEqual(uploaded["calibration"], table)

    def test_without_one_it_detects_as_before(self):
        self.mocks["prior_table_candidates"].return_value = []
        self.mocks["run_placement_calibration"].return_value = {
            "ok": True, "code": None, "calibration": {
                "ok": True, "table_corners_px": {}, "length_axis": [0.0, -1.0]}}
        result = worker.placement_for_match(
            self.connection, JOB_ID, USER_ID, MATCH_ID,
            worker.NORMAL_PLACEMENT_ATTEMPT)
        self.assertTrue(result.succeeded)
        self.mocks["run_placement_calibration"].assert_called_once()
        self.assertEqual(self.commands, [])

    def test_an_automatic_match_never_looks(self):
        self.record = lambda attempt: generation_record(
            cut_source="auto", raw_path=RAW, processing_version_id=HAND_VERSION,
            job_processing_version_id=HAND_VERSION)
        self.mocks["run_placement_calibration"].return_value = {
            "ok": True, "code": None, "calibration": {
                "ok": True, "table_corners_px": {}, "length_axis": [0.0, -1.0]}}
        with patch("worker.worker.run_blurball_only", return_value=self.blurball), \
                patch("worker.worker.reuse_prior_table") as reuse:
            worker.placement_for_match(
                self.connection, JOB_ID, USER_ID, MATCH_ID,
                worker.NORMAL_PLACEMENT_ATTEMPT)
        reuse.assert_not_called()
        self.mocks["run_placement_calibration"].assert_called_once()



class PlacementRecordRawPathTests(unittest.TestCase):
    def test_the_record_carries_the_matchs_own_original(self):
        queries = []
        record = generation_record(raw_path=RAW)

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, query, params=None):
                queries.append(" ".join(query.split()))

            def fetchone(self):
                return record

            def fetchall(self):
                return [{"point": record["points"][0]}]

        class Connection:
            def cursor(self, **kwargs):
                return Cursor()

        got = worker.load_placement_attempt_record(
            Connection(), JOB_ID, USER_ID, MATCH_ID,
            worker.NORMAL_PLACEMENT_ATTEMPT)
        self.assertIn("m.raw_path from public.matches m", queries[0])
        self.assertEqual(got["raw_path"], RAW)


if __name__ == "__main__":
    unittest.main()
