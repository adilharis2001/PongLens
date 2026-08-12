"""The vetoed-play rescue: crossing evidence keeps a play, noise does not.

Synthetic homography maps pixels to metres directly (u = x/100, v = y/100),
so the table corridor is x in [-70, 222], the net line sits at y = 137 and
the far zone starts at y = 200.
"""
import unittest

import numpy as np

from worker.points_pipeline import Px, rescue_evidence

H = np.array([[0.01, 0.0, 0.0],
              [0.0, 0.01, 0.0],
              [0.0, 0.0, 1.0]])
FPS = 30.0
PX = Px(1920)          # px.fast = 8


class RescueEvidenceTest(unittest.TestCase):
    def test_a_low_crossing_rescues(self):
        # ball travels from the near side (v 0.6) over the net to the far
        # side (v 2.0) in continuous, dwell-satisfying steps
        det = {f: (100.0, 60.0 + 12.0 * f) for f in range(13)}
        self.assertEqual(rescue_evidence(det, H, 0, 12, FPS, PX), "crossing")

    def test_a_fast_far_side_run_rescues(self):
        # the netted-long-serve signature: the near half of the flight is
        # occluded, but the ball lands deep on the far side at speed
        det = {f: (60.0 + 20.0 * f, 220.0) for f in range(6)}
        self.assertEqual(rescue_evidence(det, H, 0, 5, FPS, PX), "far run")

    def test_a_slow_far_side_lob_does_not(self):
        # a lobbed handover drifts far-side too, but slowly (steps under
        # px.fast) — it must stay vetoed
        det = {f: (100.0 + 3.0 * f, 220.0) for f in range(8)}
        self.assertIsNone(rescue_evidence(det, H, 0, 7, FPS, PX))

    def test_one_sided_bouncing_does_not(self):
        # pre-serve bouncing: plenty of motion, never leaves the near side
        det = {f: (100.0, 60.0 + (10.0 if f % 2 else 0.0)) for f in range(20)}
        self.assertIsNone(rescue_evidence(det, H, 0, 19, FPS, PX))

    def test_no_calibration_means_no_rescue(self):
        det = {f: (100.0, 60.0 + 12.0 * f) for f in range(13)}
        self.assertIsNone(rescue_evidence(det, None, 0, 12, FPS, PX))

    def test_track_gaps_break_the_crossing(self):
        # near-side flight, then a 0.4s hole (12 frames > the 0.35s
        # teleport rule), then a slow far-side drift: the disconnected
        # halves must not count as a crossing, and the drift is too slow
        # for the far-run clause
        det = {f: (100.0, 60.0 + 12.0 * f) for f in range(4)}
        det.update({f: (100.0 + 3.0 * (f - 16), 220.0)
                    for f in range(16, 20)})
        self.assertIsNone(rescue_evidence(det, H, 0, 19, FPS, PX))


if __name__ == "__main__":
    unittest.main()


class SpanVetoTest(unittest.TestCase):
    """The span-level gate veto reports what it drops instead of silence."""

    def test_vetoed_spans_are_surfaced(self):
        from worker.points_pipeline import activity_spans

        # fast motion entirely OUTSIDE the gate: forms a span, gets vetoed
        det = {f: (1500.0 + 20.0 * (f % 2), 300.0) for f in range(0, 150)}
        gate = (0.0, 1000.0, 0.0, 1080.0)          # x0, x1, y0, y1
        vetoed = []
        spans = activity_spans(det, 10.0, 30.0, 0.5, 1.0, 1.5, PX,
                               gate=gate, vetoed_out=vetoed)
        self.assertEqual(spans, [])
        self.assertEqual(len(vetoed), 1)
        self.assertLess(vetoed[0][0], 1.0)

    def test_in_gate_spans_still_pass(self):
        from worker.points_pipeline import activity_spans

        det = {f: (500.0 + 20.0 * (f % 2), 300.0) for f in range(0, 150)}
        gate = (0.0, 1000.0, 0.0, 1080.0)
        vetoed = []
        spans = activity_spans(det, 10.0, 30.0, 0.5, 1.0, 1.5, PX,
                               gate=gate, vetoed_out=vetoed)
        self.assertEqual(len(spans), 1)
        self.assertEqual(vetoed, [])


class CrossingSweepTest(unittest.TestCase):
    """Unclaimed crossing clusters become candidate plays; claimed ones
    and blips do not."""

    FPS = 30.0

    def _serve_flight(self, f0):
        # a one-way fast flight from near (v 0.6) to far (v 2.6): crosses
        # once with dwell on both sides
        return {f0 + i: (100.0 + 12.0 * i, 60.0 + 12.0 * i)
                for i in range(18)}

    def test_unclaimed_serve_is_minted(self):
        from worker.points_pipeline import crossing_sweep
        det = self._serve_flight(300)          # t ~10.0-10.6, no plays
        out = crossing_sweep(det, H, self.FPS, PX, [], 60.0)
        self.assertEqual(len(out), 1)
        w0, w1, n = out[0]
        self.assertLessEqual(w0, 10.0)
        self.assertGreaterEqual(w1, 10.6)

    def test_claimed_crossing_is_not(self):
        from worker.points_pipeline import crossing_sweep
        det = self._serve_flight(300)
        plays = [(295, 320, 0)]                # a play owns this window
        self.assertEqual(crossing_sweep(det, H, self.FPS, PX, plays, 60.0),
                         [])

    def test_stationary_blip_is_not(self):
        from worker.points_pipeline import crossing_sweep
        # two detections either side of the net with no flight around them
        det = {300: (100.0, 110.0), 301: (100.0, 112.0),
               302: (100.0, 160.0), 303: (100.0, 162.0)}
        self.assertEqual(crossing_sweep(det, H, self.FPS, PX, [], 60.0), [])

    def test_no_calibration_no_sweep(self):
        from worker.points_pipeline import crossing_sweep
        det = self._serve_flight(300)
        self.assertEqual(crossing_sweep(det, None, self.FPS, PX, [], 60.0),
                         [])
