"""The calibration ladder: a quad has to survive a health check now.

Of the 33 table quads production shipped on 2026-08-13, only 10 were
correct — the pink-rim calibrator returns a plausible quad built from
whatever else in the hall is magenta, and because it returns SOMETHING the
vision fallback never ran. These tests pin the gate that stops that, and
the two things most likely to break quietly: a numpy frame leaking into
match.json, and the vision gate defaulting on.
"""
import os
import sys
import unittest
from unittest import mock

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import points_pipeline as pp                                  # noqa: E402
import quad_health as qh                                      # noqa: E402


def table_frame(w=1920, h=1080):
    """A dark frame with a bright table rectangle — four real edges."""
    img = np.full((h, w, 3), 30, np.uint8)
    img[400:900, 500:1500] = 200
    return img


TABLE_QUAD = {
    "A_near_1": [500.0, 900.0], "B_near_2": [1500.0, 900.0],
    "C_far_2": [1500.0, 400.0], "D_far_1": [500.0, 400.0],
}
# same shape, dragged onto blank floor: no gradient under any side
FLOOR_QUAD = {
    "A_near_1": [200.0, 1000.0], "B_near_2": [1200.0, 1000.0],
    "C_far_2": [1200.0, 500.0], "D_far_1": [200.0, 500.0],
}


class HealthCheckTest(unittest.TestCase):
    def test_a_quad_on_the_table_is_healthy(self):
        h = qh.quad_health(TABLE_QUAD, table_frame(), None, 1920, 1080)
        self.assertTrue(h["healthy"], h["reasons"])
        self.assertGreaterEqual(h["score"], 0.9)

    def test_a_quad_on_blank_floor_is_not(self):
        h = qh.quad_health(FLOOR_QUAD, table_frame(), None, 1920, 1080)
        self.assertFalse(h["healthy"])

    def test_no_background_fails_closed(self):
        # deliberately the opposite of the email-suppression convention:
        # an unverified quad is worse than no quad, because the split ROI
        # and the crossing rule believe whatever they are handed.
        h = qh.quad_health(TABLE_QUAD, None, None, 1920, 1080)
        self.assertFalse(h["healthy"])

    def test_it_reads_no_labels(self):
        """Runs at upload time, before anything is scored."""
        with_det = qh.quad_health(TABLE_QUAD, table_frame(),
                                  {1: (100.0, 100.0)}, 1920, 1080)
        without = qh.quad_health(TABLE_QUAD, table_frame(), None, 1920, 1080)
        self.assertEqual(with_det["healthy"], without["healthy"])
        self.assertEqual(with_det["score"], without["score"])


class BackgroundHandoffTest(unittest.TestCase):
    def test_calibrate_hands_back_a_background(self):
        """The health check must not pay for a second decode."""
        import inspect
        src = inspect.getsource(pp.calibrate)
        self.assertIn('"bg": bg', src)

    def test_the_frame_cannot_reach_match_json(self):
        """A numpy array in the artifact would crash json.dump.

        Two independent guards, and this pins both: every path that can
        hold a calib dict pops the frame, AND the artifact writer
        whitelists the calibration keys it emits rather than spreading
        the dict.

        Only the retired pink calibrator ever handed a frame back, so the
        pops are now belt-and-braces on the two vision branches. The
        whitelist is the guard that actually matters and it is the one
        checked below in full.
        """
        import inspect
        src = inspect.getsource(pp.cmd_points)
        self.assertEqual(src.count('calib.pop("bg", None)'), 2)

        artifact = src.split('"calibration":')[1][:400]
        for key in ("table_corners_px", "length_axis", "note"):
            self.assertIn(key, artifact)
        self.assertNotIn("**calib", artifact)   # never spread the dict
        self.assertNotIn('"bg"', artifact)

    def test_median_background_needs_enough_frames(self):
        with mock.patch.object(pp, "__name__", pp.__name__):
            self.assertIsNone(pp.median_background("/nonexistent.mp4"))


class VisionGateDefaultTest(unittest.TestCase):
    def test_the_vision_gate_is_off_unless_asked(self):
        """On vision output this check is weak evidence (0.735 accuracy,
        against clean separation on pink-rim output), so it ships behind a
        flag."""
        import inspect
        src = inspect.getsource(pp.cmd_points)
        self.assertIn('PONGLENS_VISION_HEALTH_GATE', src)
        self.assertIn('== "1"', src)

    def test_the_keypoint_quad_is_not_health_checked(self):
        """The keypoint detector's own frame gate and agreement rule are
        sharper than quad_health and were measured on its output. A second
        opinion from a weaker test could only subtract, so the primary
        branch runs the detector and nothing else."""
        import inspect
        src = inspect.getsource(pp.cmd_points)
        primary = src.split("calib = keypoint_calibrate")[1].split(
            "if calib is None:")[1].split("vision_calibrate")[0]
        self.assertNotIn("quad_health", primary)


class CalibrationLadderTest(unittest.TestCase):
    """The order is measured, not incidental: 0.27% median corner error for
    the keypoint detector against 2.40% for Luna, over 62 hand-marked
    matches. See docs/research/2026-08-16-table-detection/."""

    def test_keypoints_run_before_any_paid_model(self):
        import inspect
        src = inspect.getsource(pp.cmd_points)
        self.assertLess(src.index("keypoint_calibrate"),
                        src.index("vision_calibrate"))

    def test_the_pink_calibrator_is_out_of_the_upload_path(self):
        """It scored 3.50% median with 20 gross failures in 50 and stays in
        the module only for placement_backfill and its own tests."""
        import inspect
        import re
        code = "\n".join(
            line.split("#")[0]
            for line in inspect.getsource(pp.cmd_points).splitlines()
        )
        # A bare `calibrate(` — not keypoint_calibrate or vision_calibrate.
        self.assertIsNone(re.search(r"(?<![\w_])calibrate\s*\(", code))

    def test_the_keypoint_quad_is_canonicalised_like_every_other(self):
        """The network's own corner labels name the FAR end line 'close' on
        17 of the 62 marked frames. Deriving near/far from image position
        instead brought the winding into agreement on all 62."""
        import inspect
        src = inspect.getsource(pp.keypoint_calibrate)
        self.assertIn("_canonical_calibration_geometry", src)

    def test_the_keypoint_quad_uses_the_playing_surface_pads(self):
        """It fits the surface, not the rim, so it needs the wider vision
        pads — the rim pads clip a deep return and fragment the rally."""
        import inspect
        src = inspect.getsource(pp.keypoint_calibrate)
        self.assertIn("VISION_ROI_PAD", src)


if __name__ == "__main__":
    unittest.main()


class NearFarOrientationTest(unittest.TestCase):
    """canonicalize_table_quad trusts its near_pair; a straight near/far
    swap is a valid convex quad and used to invert the table silently."""

    NL, NR, FR, FL = (400, 900), (1500, 900), (1200, 500), (700, 500)

    def _near_v(self, quad):
        src, H, _e, _r = pp._canonical_calibration_geometry(
            np.asarray(quad, np.float32))
        x, y = 950.0, 900.0                 # midpoint of the TRUE near edge
        w = H[2, 0] * x + H[2, 1] * y + H[2, 2]
        return (H[1, 0] * x + H[1, 1] * y + H[1, 2]) / w

    def test_a_correct_quad_is_untouched(self):
        self.assertAlmostEqual(
            self._near_v([self.NL, self.NR, self.FR, self.FL]), 0.0, places=2)

    def test_a_swapped_quad_is_repaired(self):
        self.assertAlmostEqual(
            self._near_v([self.FL, self.FR, self.NR, self.NL]), 0.0, places=2)

    def test_it_uses_image_y_not_edge_length(self):
        """The edge-length rule was measured and is FALSE: 12 of 44
        verified-correct quads have a near edge shorter than their far
        edge. Flipping on length would invert a quarter of them."""
        short_near = [(700, 900), (1200, 900), (1500, 500), (400, 500)]
        out = pp._orient_near_far(np.asarray(short_near, np.float32))
        self.assertTrue(np.allclose(np.asarray(out, np.float32),
                                    np.asarray(short_near, np.float32)))

    def test_malformed_input_is_passed_through(self):
        junk = np.asarray([[0, 0], [1, 1]], np.float32)
        self.assertIs(pp._orient_near_far(junk), junk)
