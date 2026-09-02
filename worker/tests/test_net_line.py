"""The net's image comes from the calibration, never from pixel averages.

The rule is checked as a property, not an echo: whatever pixels the
construction returns must project back onto the table's actual midline.
An echo test passed for months while every drawn net sat a third of a
metre into the near half — the placement mirror taught the same lesson.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import points_v2 as V2                                        # noqa: E402
from research_serve_misses import net_segment                 # noqa: E402

# Real calibrated corners from the matches named — both end-on cameras,
# where the perspective compression (and so the old error) is largest.
TERRY = {'A_near_1': [866.4, 740.9], 'B_near_2': [1259.2, 698.9],
         'C_far_2': [1038.6, 608.7], 'D_far_1': [808.2, 623.7]}
KOKO = {'A_near_1': [836.1, 822.9], 'B_near_2': [1307.6, 747.5],
        'C_far_2': [975.1, 631.6], 'D_far_1': [697.5, 658.9]}
ALL = {"terry": TERRY, "koko": KOKO}


class NetSegment(unittest.TestCase):

    def test_the_endpoints_sit_on_the_tables_midline(self):
        """Project the answer back: it must land at v = L/2 exactly, one
        endpoint on each sideline (u = 0 and u = W)."""
        for name, cor in ALL.items():
            with self.subTest(name):
                H = V2.homography_from_corners(cor)
                e1, e2 = net_segment(H)
                u1, v1 = V2.project(H, *e1)
                u2, v2 = V2.project(H, *e2)
                self.assertAlmostEqual(v1, V2.L_M / 2, places=4)
                self.assertAlmostEqual(v2, V2.L_M / 2, places=4)
                self.assertAlmostEqual(u1, 0.0, places=4)
                self.assertAlmostEqual(u2, V2.W_M, places=4)

    def test_the_pixel_midpoint_is_not_the_net(self):
        """The signature of the old bug, kept as a tripwire: the sideline
        pixel midpoints project a third of a metre into the NEAR half.
        If this ever fails, the camera geometry assumptions changed."""
        for name, cor in ALL.items():
            with self.subTest(name):
                H = V2.homography_from_corners(cor)
                a, b = cor["A_near_1"], cor["B_near_2"]
                c, d = cor["C_far_2"], cor["D_far_1"]
                m1 = ((a[0] + d[0]) / 2, (a[1] + d[1]) / 2)
                m2 = ((b[0] + c[0]) / 2, (b[1] + c[1]) / 2)
                v_mid = (V2.project(H, *m1)[1] + V2.project(H, *m2)[1]) / 2
                self.assertLess(v_mid, V2.L_M / 2 - 0.25,
                                f"{name}: pixel midpoint at v={v_mid:.2f}")


if __name__ == "__main__":
    unittest.main()
