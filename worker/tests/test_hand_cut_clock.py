"""A Mac hand cut publishes the cut video's MEASURED clock, not the plan's.

cmd_cut encodes each kept segment on its own and joins the parts, and each
part comes out a few milliseconds longer than its window (a last frame, an
AAC packet). Summing the planned lengths therefore falls further behind the
real video with every segment: on the live 86-segment hand cut the last
point was published 0.6 s early (docs/research/2026-09-25-hand-cut-clock).
cmd_cut measures where every part landed and rewrites match.json; these
tests run process_hand_cut end to end with parts that run long, through the
real cut_timeline measurement, and check that every published cut_t0, every
clip encode window and the uploaded match.json follow the measured clock.
"""
import json
import unittest
from pathlib import Path
from unittest import mock

import hand_cut_device as hcd
import worker.worker as worker
from worker.tests.test_hand_cut_device import (
    JOB, MATCH, USER, Conn, FakeR2, live_marks)

DURATION = 1455.67          # the live 9acef67c original, 86 segments
PART_EXCESS = (0.0213, 0.0067, 0.0104)   # AAC packet, part of a frame, ...


def physical(spans):
    """cmd_cut's own rounding of the spans it hands the encoder."""
    return [[float(f"{a:.2f}"), round(float(f"{a:.2f}") + float(f"{b - a:.2f}"), 2)]
            for a, b in spans]


class MacHandCutClockTests(unittest.TestCase):
    def setUp(self):
        self.marks = live_marks("9acef67c")
        self.plan = hcd.plan_hand_cut(self.marks, DURATION)
        self.published = []
        self.encodes = []
        self.rollbacks = []
        self.state = {}

    def excess(self, i):
        return PART_EXCESS[i % len(PART_EXCESS)]

    def measured_offsets(self):
        offsets, total = [], 0.0
        for i, (a, b) in enumerate(self.plan.cut_segments):
            offsets.append(total)
            total += (b - a) + self.excess(i)
        return offsets, total

    def fake_cmd_cut(self, cmd, **kwargs):
        """cmd_cut's tail, verbatim: measure the parts, write the timeline
        beside the cut, reconcile match.json. Only ffprobe is faked, as
        parts that each run self.excess(i) past their window."""
        segments_path = cmd[cmd.index("--segments") + 1]
        out = cmd[cmd.index("--out") + 1]
        spans = [tuple(s) for s in json.loads(
            Path(segments_path).read_text())["cut_segments"]]
        parts = [f"{out}.parts/part_{i:03d}.mp4" for i in range(len(spans))]
        durations = {part: (b - a) + self.excess(i)
                     for i, (part, (a, b)) in enumerate(zip(parts, spans))}
        total = sum(durations.values())
        self.state["cut_seconds"] = total

        def probe(path):
            if path in durations:
                return (0.0, durations[path], 0.0)
            return (0.0, total, 0.0)

        timeline_module = worker.cut_timeline
        with mock.patch.object(timeline_module, "_probe", side_effect=probe):
            timeline = timeline_module.measure(parts, physical(spans), out)
        timeline_module.write_json(out + ".timeline.json", timeline)
        if not self.state.get("drop_timeline"):
            timeline_module.reconcile_file(segments_path, out + ".timeline.json")
        else:
            Path(out + ".timeline.json").unlink()
        Path(out).write_bytes(b"cut")

    def run_job(self):
        fake_r2 = FakeR2({})
        self.r2 = fake_r2

        def download(path, local):
            Path(local).write_bytes(b"original")

        def probe_duration(path):
            if str(path).endswith("result.mp4"):
                return self.state.get("probe_cut") or self.state["cut_seconds"]
            return DURATION

        def encode_clip(src, seek, span, out):
            self.encodes.append((seek, span))
            Path(out).write_bytes(b"clip")
            return True

        def thumb(src, out, seek):
            Path(out).write_bytes(b"webp")
            return True

        def publish(conn, **kwargs):
            self.published.append(kwargs)
            return {"scoreRevision": 1}

        conn = Conn([dict(m) for m in self.marks], {"match_id": MATCH})
        patches = [
            mock.patch.object(worker, "r2", lambda: fake_r2),
            mock.patch.object(worker, "_download_backfill_object",
                              side_effect=download),
            mock.patch.object(worker, "probe_duration_s",
                              side_effect=probe_duration),
            mock.patch.object(worker, "video_source_geometry",
                              return_value={"fps": 59.94, "width": 1920,
                                            "height": 1080}),
            mock.patch.object(worker.subprocess, "run",
                              side_effect=self.fake_cmd_cut),
            mock.patch.object(worker, "_presigned_get",
                              return_value="https://r2.test/cut"),
            mock.patch.object(worker, "_encode_clip", side_effect=encode_clip),
            mock.patch.object(worker, "extract_thumb", side_effect=thumb),
            mock.patch.object(worker, "_publish_hand_cut", side_effect=publish),
            mock.patch.object(worker, "ledger_append"),
            mock.patch.object(worker, "ledger_negate_keys"),
            mock.patch.object(worker, "update_job"),
            mock.patch.object(worker, "_hand_cut_rollback",
                              side_effect=lambda *a, **k: self.rollbacks.append(k)),
        ]
        for p in patches:
            p.start()
        try:
            worker.process_hand_cut(conn, JOB, USER,
                                    {"options": {"match_id": MATCH}}, f"{JOB}:1")
        finally:
            for p in reversed(patches):
                p.stop()

    def expected_positions(self):
        """Each point on the measured clock: its segment's measured start
        plus how far into the segment its padded clip opens."""
        offsets, _ = self.measured_offsets()
        out = []
        for p in self.plan.points:
            for (a, b), off in zip(self.plan.cut_segments, offsets):
                if a - 0.01 <= p["clip_t0"] <= b + 0.01:
                    out.append(off + (p["clip_t0"] - a))
                    break
        return out

    def test_published_positions_follow_the_measured_clock(self):
        self.run_job()
        self.assertEqual(len(self.published), 1)
        points = self.published[0]["points"]
        self.assertEqual(len(points), 99)
        expected = self.expected_positions()
        for p, want in zip(points, expected):
            self.assertAlmostEqual(float(p["cut_t0"]), want, delta=1e-5,
                                   msg=f"point {p['idx']}")
        # The case the plan got wrong: by the last point the parts' extra
        # milliseconds add up to more than half a second.
        planned_last = self.plan.points[-1]["cut_t0"]
        self.assertGreater(float(points[-1]["cut_t0"]) - planned_last, 0.5)

    def test_every_clip_is_cut_from_the_measured_position(self):
        self.run_job()
        expected = self.expected_positions()
        self.assertEqual(len(self.encodes), 99)
        for (seek, span), want, p in zip(self.encodes, expected,
                                         self.plan.points):
            self.assertAlmostEqual(seek, want, delta=1e-5)
            self.assertAlmostEqual(span, p["clip_t1"] - p["clip_t0"], delta=1e-9)

    def test_the_uploaded_match_json_carries_the_measured_clock(self):
        self.run_job()
        uploaded = {key: body for _, key, body in self.r2.uploads}
        mj = json.loads(uploaded[f"points/{USER}/{MATCH}/match.json"])
        offsets, _ = self.measured_offsets()
        self.assertEqual(mj["cut_segments"], self.plan.cut_segments)
        self.assertEqual(len(mj["cut_segment_offsets"]), 86)
        for got, want in zip(mj["cut_segment_offsets"], offsets):
            self.assertAlmostEqual(got, want, delta=1e-5)
        self.assertEqual(mj["cut_timing"]["method"], "mp4-concat-measured-v1")
        self.assertEqual([p["cut_t0"] for p in mj["points"]],
                         [p["cut_t0"] for p in self.published[0]["points"]])
        self.assertEqual(mj["points"][0]["clip"], "01.mp4")
        # A later re-cut reads this file through _CutMap and lands on the
        # same frames the published cut_t0 names.
        lookup = worker._CutMap(mj)
        for p in mj["points"]:
            self.assertAlmostEqual(
                lookup.locate(p["idx"], p["clip_t0"], p["clip_t1"]),
                p["cut_t0"], delta=1e-5)

    def test_parts_that_come_out_exact_publish_the_plan(self):
        self.excess = lambda i: 0.0
        self.run_job()
        for p, want in zip(self.published[0]["points"], self.plan.points):
            self.assertAlmostEqual(float(p["cut_t0"]), want["cut_t0"],
                                   delta=0.0051)

    def test_a_cut_without_a_measured_timeline_is_not_published(self):
        self.state["drop_timeline"] = True
        with self.assertRaises(FileNotFoundError):
            self.run_job()
        self.assertEqual(self.published, [])
        self.assertEqual(self.encodes, [])
        # Retryable: the draft stays frozen for the queue's next attempt.
        self.assertEqual(self.rollbacks, [{"release": False,
                                           "ledger_keys": []}])

    def test_a_measured_clock_far_from_the_plan_is_refused(self):
        # One part five seconds long: more than a whole cut may differ,
        # with a length probe that happens to agree with the plan.
        self.excess = lambda i: 5.0 if i == 3 else 0.0
        self.state["probe_cut"] = self.plan.kept
        with self.assertRaises(RuntimeError) as caught:
            self.run_job()
        self.assertIn("from its planned place", str(caught.exception))
        self.assertEqual(self.published, [])


if __name__ == "__main__":
    unittest.main()
