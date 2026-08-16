"""Shape ranking, tested against quads made by projecting a known table."""
import math
import unittest

import numpy as np

from worker import vision_table_calibration as vtc

W, H, FOCAL = 1600, 900, 1400.0


def project(length_m, width_m=1.525, dist_m=4.2, height_m=2.0, side_m=1.6):
    """Corners of a length x width rectangle seen by a camera above and
    behind one end, principal point at the image centre."""
    half_w, half_l = width_m / 2.0, length_m / 2.0
    world = np.array([
        [-half_w, -half_l, 0.0],
        [half_w, -half_l, 0.0],
        [half_w, half_l, 0.0],
        [-half_w, half_l, 0.0],
    ])
    centre = np.array([side_m, -dist_m, height_m])
    forward = -centre / np.linalg.norm(centre)
    right = np.cross(forward, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(forward, right)
    rot = np.stack([right, down, forward])
    cam = (rot @ (world - centre).T).T
    if np.any(cam[:, 2] <= 0.01):
        raise ValueError("behind camera")
    return [[FOCAL * x / z + W / 2.0, FOCAL * y / z + H / 2.0]
            for x, y, z in cam]


class ShapeSelectionTests(unittest.TestCase):
    def test_a_real_table_recovers_its_own_ratio(self):
        quad = project(vtc.TABLE_LENGTH_M)
        err = vtc.shape_error(quad, W, H)
        self.assertIsNotNone(err)
        # Recovered ratio within a few percent of 1.7967.
        self.assertLess(err, 0.05, f"log error {err}")

    def test_a_square_table_scores_far_worse(self):
        table = vtc.shape_error(project(vtc.TABLE_LENGTH_M), W, H)
        square = vtc.shape_error(project(1.525), W, H)
        self.assertIsNotNone(square)
        self.assertGreater(square, table * 3)

    def test_a_degenerate_quad_scores_none_rather_than_lying(self):
        self.assertIsNone(
            vtc.shape_error([[0, 0], [100, 0], [200, 0], [300, 0]], W, H))
        self.assertIsNone(vtc.shape_error([[0, 0], [1, 1]], W, H))

    def test_selection_prefers_the_most_table_shaped_trial(self):
        good = project(vtc.TABLE_LENGTH_M)
        bad = project(0.9)
        picked = vtc.select_by_shape(
            [{"accepted": True, "corners": bad},
             {"accepted": True, "corners": good}], W, H)
        self.assertTrue(picked["accepted"])
        self.assertEqual(picked["corners"], good)

    def test_rejected_trials_are_never_selected(self):
        picked = vtc.select_by_shape(
            [{"accepted": False, "corners": project(vtc.TABLE_LENGTH_M)}], W, H)
        self.assertFalse(picked["accepted"])
        self.assertEqual(picked["reason"], "no_valid_trials")

    def test_one_valid_trial_is_enough(self):
        # The agreement rule needed a PAIR and abandoned the match here,
        # sending it to a paid escalation for no reason.
        picked = vtc.select_by_shape(
            [{"accepted": True, "corners": project(vtc.TABLE_LENGTH_M)}], W, H)
        self.assertTrue(picked["accepted"])

    def test_a_head_on_view_is_undefined_not_wrong(self):
        # Camera square behind the end line puts both end lines parallel in
        # the image, so their vanishing point is at infinity and the aspect
        # cannot be recovered. This is why shape RANKS and never GATES:
        # roughly a third of real uploads sit near this degeneracy, and the
        # owner's own marks fail a generous ratio band 29% of the time for
        # exactly this reason.
        self.assertIsNone(vtc.shape_error(project(2.740, side_m=0.0), W, H))

    def test_all_degenerate_falls_back_to_agreement(self):
        flat = [[0, 0], [100, 0], [200, 0], [300, 0]]
        picked = vtc.select_by_shape(
            [{"accepted": True, "corners": flat},
             {"accepted": True, "corners": flat}], W, H)
        self.assertIn("accepted", picked)


if __name__ == "__main__":
    unittest.main()
