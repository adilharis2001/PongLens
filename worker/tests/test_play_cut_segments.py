import unittest

from worker.points_pipeline import (
    CLIP_PADS,
    SEGMENT_PADS,
    cut_position,
    play_cut_segments,
    segment_cut_offsets,
)


class SegmentPadInvariant(unittest.TestCase):
    def test_segment_pads_cover_clip_pads_at_every_strictness(self):
        """THE load-bearing invariant of cut mode 'plays'.

        Per-point clips are cut from the ORIGINAL video at t0-clip_pre,
        and cut_t0 anchors seeks and reel segments at that same padded
        start. If a segment pad were ever smaller than the clip pad, the
        clip's opening frames would not exist in the cut video and every
        seek would land early or in a removed gap.
        """
        for name, (head, tail) in SEGMENT_PADS.items():
            clip_pre, clip_post = CLIP_PADS[name]
            self.assertGreaterEqual(head, clip_pre, name)
            self.assertGreaterEqual(tail, clip_post, name)


class PlayCutSegments(unittest.TestCase):
    def test_far_apart_windows_stay_separate(self):
        segs = play_cut_segments([(10, 14), (30, 33)], 100, 1.0, 1.0)
        self.assertEqual(segs, [(9.0, 15.0), (29.0, 34.0)])

    def test_near_windows_merge_so_the_cut_never_stutters(self):
        # padded gap 0.3s < merge 0.5 -> bridged; a sub-half-second jump
        # cut removes nothing worth removing
        segs = play_cut_segments([(10, 30.2), (32.5, 40)], 100, 1.0, 1.0)
        self.assertEqual(segs, [(9.0, 41.0)])

    def test_wider_gaps_are_cut_not_bridged(self):
        # round 5a: pads+merge measured 22.4% of a real source — real
        # between-point gaps must actually be removed
        segs = play_cut_segments([(10, 30), (33, 40)], 100, 1.0, 1.0)
        self.assertEqual(segs, [(9.0, 31.0), (32.0, 41.0)])

    def test_clamped_to_video_bounds(self):
        segs = play_cut_segments([(0.3, 5), (94, 99.8)], 100, 1.0, 1.0)
        self.assertEqual(segs, [(0.0, 6.0), (93.0, 100.0)])

    def test_input_order_does_not_matter(self):
        a = play_cut_segments([(30, 33), (10, 14)], 100, 1.0, 1.0)
        b = play_cut_segments([(10, 14), (30, 33)], 100, 1.0, 1.0)
        self.assertEqual(a, b)

    def test_every_window_is_inside_a_segment(self):
        wins = [(5, 8), (8.2, 9.1), (40, 41), (60, 75), (75.5, 76)]
        segs = play_cut_segments(wins, 200, 1.0, 1.0)
        for a, b in wins:
            self.assertTrue(
                any(s0 <= a and b <= s1 for s0, s1 in segs), (a, b))

    def test_empty_and_degenerate_windows(self):
        self.assertEqual(play_cut_segments([], 100, 1.0, 1.0), [])
        self.assertEqual(play_cut_segments([(5, 5)], 100, 1.0, 1.0), [])


class CutPosition(unittest.TestCase):
    SEGS = [(9.0, 15.0), (29.0, 34.0), (50.0, 60.0)]

    def setUp(self):
        self.offs = segment_cut_offsets(self.SEGS)

    def test_offsets_accumulate_kept_time(self):
        self.assertEqual(self.offs, [0.0, 6.0, 11.0])

    def test_inside_a_segment(self):
        self.assertEqual(cut_position(self.SEGS, self.offs, 9.0), 0.0)
        self.assertEqual(cut_position(self.SEGS, self.offs, 12.5), 3.5)
        self.assertEqual(cut_position(self.SEGS, self.offs, 30.0), 7.0)
        self.assertEqual(cut_position(self.SEGS, self.offs, 55.0), 16.0)

    def test_a_gap_clamps_to_the_next_kept_edge(self):
        # can't happen for clip anchors (pad invariant above) but must
        # still be defined: a gap time maps to the following segment.
        self.assertEqual(cut_position(self.SEGS, self.offs, 20.0), 6.0)

    def test_past_the_end_clamps_to_cut_length(self):
        self.assertEqual(cut_position(self.SEGS, self.offs, 99.0), 21.0)

    def test_empty_segments(self):
        self.assertEqual(cut_position([], [], 5.0), 0.0)


if __name__ == "__main__":
    unittest.main()


class ServeHeadStart(unittest.TestCase):
    """Round 5b: the serve rides BEFORE t0 as contiguous fast motion, and a
    fixed head pad sliced it mid-stream (seen on a real user's match)."""

    FPS = 60.0
    FAST = 8.0

    def dets(self, fast_frames):
        """A det dict where the ball advances 10px/frame over the listed
        frames (fast steps) and is absent (still) everywhere else."""
        det = {}
        for f in fast_frames:
            det[f - 1] = ((f - 1) * 10.0, 100.0)
            det[f] = (f * 10.0, 100.0)
        return det

    def test_still_start_extends_by_nothing(self):
        from worker.points_pipeline import serve_head_start
        t = serve_head_start({}, 6000, self.FPS, self.FAST)
        self.assertEqual(t, 100.0)  # f0/fps — no motion, no extension

    def test_contiguous_serve_chain_is_covered(self):
        from worker.points_pipeline import serve_head_start
        # fast motion 3s before t0 (dribble+toss+serve), then stillness
        det = self.dets(range(5820, 6000))
        t = serve_head_start(det, 6000, self.FPS, self.FAST)
        self.assertLessEqual(t, 5821 / self.FPS)

    def test_small_gaps_do_not_break_the_chain(self):
        from worker.points_pipeline import serve_head_start
        # two bursts separated by a 0.5s pause (toss apex) — one chain
        det = self.dets(list(range(5880, 5920)) + list(range(5950, 6000)))
        t = serve_head_start(det, 6000, self.FPS, self.FAST)
        self.assertLessEqual(t, 5881 / self.FPS)

    def test_a_long_stillness_stops_the_walk(self):
        from worker.points_pipeline import serve_head_start
        # old motion 2s before t0 with a 1.5s still gap: NOT the serve chain
        det = self.dets(list(range(5760, 5820)) + list(range(5970, 6000)))
        t = serve_head_start(det, 6000, self.FPS, self.FAST)
        self.assertGreaterEqual(t, 5960 / self.FPS)

    def test_the_cap_bounds_a_neverending_chain(self):
        from worker.points_pipeline import serve_head_start
        det = self.dets(range(4000, 6000))   # 33s of continuous motion
        t = serve_head_start(det, 6000, self.FPS, self.FAST)
        self.assertGreaterEqual(t, (6000 - 6.0 * self.FPS - 1) / self.FPS)
