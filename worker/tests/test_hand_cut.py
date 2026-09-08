"""Hand-cut segment arithmetic: the one number that can be wrong silently.

`cut_t0` is where a point's padded clip starts inside the cut video, and
every chip, every seek and every share link is built on it. Get it wrong
and the match still plays, still looks normal, and lands every rally at the
wrong second.

So the mapping is checked two ways here, exactly as the worker checks it
before publishing: once through points_pipeline's own
play_cut_segments / segment_cut_offsets / cut_position (which is what the
automatic pipeline uses), and once through worker._CutMap.locate (which is
what every later re-cut uses). Two independent implementations agreeing is
the only evidence worth having.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from points_pipeline import (                                  # noqa: E402
    SEGMENT_PADS,
    cut_position,
    hand_cut_length_tolerance,
    play_cut_segments,
    segment_cut_offsets,
)

PRE, POST = 1.2, 1.3


def build(marks, dur):
    """The worker's _hand_cut_segments, restated so the test does not need
    a database connection to exercise the arithmetic."""
    head, tail = SEGMENT_PADS["normal"]
    windows = [
        (max(0.0, t0 - PRE), min(dur, t1 + POST)) for t0, t1 in marks
    ]
    segments = play_cut_segments(windows, dur, head, tail)
    offsets = segment_cut_offsets(segments)
    anchors = [
        round(cut_position(segments, offsets, max(0.0, t0 - PRE)), 2)
        for t0, _ in marks
    ]
    return segments, offsets, anchors


class _CutMapLike:
    """worker._CutMap's constructor and locate(), copied so this test does
    not import worker.py (which pulls boto3, psycopg2 and a live config).
    If the real one changes, this must change with it."""

    def __init__(self, mj):
        segs = (mj or {}).get("cut_segments") or []
        self.segments = [(float(a), float(b)) for a, b in segs]
        self.offsets = []
        acc = 0.0
        for s0, s1 in self.segments:
            self.offsets.append(acc)
            acc += s1 - s0

    def locate(self, c0, c1):
        for (s0, s1), off in zip(self.segments, self.offsets):
            if c0 >= s0 - 0.01 and c1 <= s1 + 0.01:
                return off + (max(c0, s0) - s0)
        return None


class HandCutSegments(unittest.TestCase):
    def test_anchors_agree_with_the_recut_lookup(self):
        """The publish-time tripwire, as a test."""
        dur = 600.0
        marks = [(12.0, 26.0), (44.0, 58.0), (70.0, 79.0),
                 (95.0, 118.0), (300.0, 322.5)]
        segments, _, anchors = build(marks, dur)
        cm = _CutMapLike({"cut_segments": [[a, b] for a, b in segments]})
        for (t0, t1), anchor in zip(marks, anchors):
            c0 = max(0.0, t0 - PRE)
            c1 = min(dur, t1 + POST)
            got = cm.locate(c0, c1)
            self.assertIsNotNone(got, f"{t0}-{t1} not inside any segment")
            self.assertAlmostEqual(
                got, anchor, delta=0.05,
                msg=f"cut_t0 disagreement on {t0}-{t1}")

    def test_the_cut_keeps_only_the_marked_rallies(self):
        dur = 600.0
        marks = [(12.0, 26.0), (300.0, 322.0)]
        segments, _, _ = build(marks, dur)
        kept = sum(b - a for a, b in segments)
        # Two rallies of 14s and 22s, each padded 1.2 before and 1.3 after,
        # plus the 0.15 segment whisker on each edge. Nothing else.
        self.assertAlmostEqual(kept, (14 + 22) + 2 * (1.2 + 1.3 + 0.3),
                               delta=0.05)
        self.assertLess(kept, dur / 5, "dead time should be gone")

    def test_the_first_anchor_is_inside_its_segment_not_on_the_edge(self):
        """Why SEGMENT_PADS is passed as head/tail rather than the clip pads.

        The clip anchor must sit strictly inside the kept span, or an ffmpeg
        seek at the very first frame can shave the front of the pre pad.
        """
        segments, _, anchors = build([(12.0, 26.0)], 600.0)
        self.assertGreater(anchors[0], 0.0)
        self.assertAlmostEqual(anchors[0], SEGMENT_PADS["normal"][0],
                               delta=0.01)

    def test_two_rallies_close_together_merge_into_one_segment(self):
        """Otherwise the same footage is concatenated twice and every
        anchor after the overlap is wrong."""
        segments, _, anchors = build([(10.0, 20.0), (21.0, 30.0)], 600.0)
        self.assertEqual(len(segments), 1, "near-touching windows merge")
        cm = _CutMapLike({"cut_segments": [[a, b] for a, b in segments]})
        for (t0, t1), anchor in zip([(10.0, 20.0), (21.0, 30.0)], anchors):
            got = cm.locate(max(0.0, t0 - PRE), t1 + POST)
            self.assertAlmostEqual(got, anchor, delta=0.05)

    def test_a_rally_at_the_very_start_clamps_to_zero(self):
        segments, _, anchors = build([(0.4, 9.0)], 600.0)
        self.assertEqual(segments[0][0], 0.0)
        self.assertAlmostEqual(anchors[0], 0.0, delta=0.01)

    def test_a_rally_running_to_the_end_is_clamped_to_the_duration(self):
        dur = 100.0
        segments, _, _ = build([(90.0, 99.8)], dur)
        self.assertLessEqual(segments[-1][1], dur + 1e-6)


class LengthToleranceTests(unittest.TestCase):
    """The publish tripwire compares the encoded cut's length with the
    segments' arithmetic. Every segment is encoded on its own, so the
    allowance has to grow with how many there are."""

    def test_small_matches_keep_the_two_second_floor(self):
        self.assertEqual(hand_cut_length_tolerance(1), 2.0)
        self.assertEqual(hand_cut_length_tolerance(40), 2.0)

    def test_heavily_marked_matches_get_room_to_round(self):
        self.assertAlmostEqual(hand_cut_length_tolerance(100), 5.0)
        self.assertAlmostEqual(hand_cut_length_tolerance(400), 20.0)

    def test_never_below_the_floor(self):
        self.assertEqual(hand_cut_length_tolerance(0), 2.0)


if __name__ == "__main__":
    unittest.main()
