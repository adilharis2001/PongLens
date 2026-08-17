"""The two rules that decide a table, tested against the cases that set them.

Both come from the 660-frame convergence study; see
docs/research/2026-08-16-table-detection/CONVERGENCE_FINDINGS.md. The point
of these tests is not coverage — it is that neither rule can be quietly
dropped, because each one is the only thing standing between production and
a specific failure that really happened.
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import table_keypoint_fit as F  # noqa: E402


def quad_at(x, y, width=400.0, height=220.0):
    """A plausible table quad: near edge wider than far, as perspective does."""
    inset = width * 0.12
    return [
        [x, y + height],                       # A near left
        [x + width, y + height],               # B near right
        [x + width - inset, y],                # C far right
        [x + inset, y],                        # D far left
    ]


def result(quad, weight=9.0, tables=1):
    return {"quad": quad, "weight": weight, "tables_seen": tables,
            "homography": None}


class FrameVerdictTest(unittest.TestCase):
    FRAME = (1920, 1080)

    def test_a_good_quad_is_kept(self):
        keep, reason = F.frame_verdict(result(quad_at(700, 500)), *self.FRAME)
        self.assertTrue(keep, reason)

    def test_no_fit_is_not_a_silent_pass(self):
        keep, _reason = F.frame_verdict(None, *self.FRAME)
        self.assertFalse(keep)

    def test_weak_support_is_refused(self):
        """Under six inlier channels' worth of activation, the fit is
        explaining noise rather than a table."""
        keep, reason = F.frame_verdict(
            result(quad_at(700, 500), weight=F.MIN_INLIER_WEIGHT - 0.1),
            *self.FRAME)
        self.assertFalse(keep)
        self.assertIn("weak support", reason)

    def test_a_corner_far_outside_the_picture_is_refused(self):
        """The cb0e7027 signature. Eight of its twenty frames landed on the
        NEIGHBOURING table and agreed with each other to 0.16% — tighter
        than the five correct frames, so a vote returns a confident 40%
        error. Every one of those eight put a corner 21-29% outside the
        frame, and this is the only test that sees it."""
        keep, reason = F.frame_verdict(
            result(quad_at(-500, 500)), *self.FRAME)
        self.assertFalse(keep)
        self.assertIn("outside the picture", reason)

    def test_a_sliver_is_refused(self):
        """A quad stitched across two tables comes out long and thin. The
        fitter's own limit of 12 exists so a real table survives every
        camera angle during hypothesis generation; as a JUDGEMENT it is far
        too loose."""
        keep, reason = F.frame_verdict(
            result(quad_at(700, 500, width=900.0, height=40.0)), *self.FRAME)
        self.assertFalse(keep)
        self.assertIn("edge ratio", reason)

    def test_the_edge_ratio_limit_is_tighter_than_the_fitters(self):
        self.assertLess(F.MAX_EDGE_RATIO, 12)


class PoolFramesTest(unittest.TestCase):
    def test_too_few_frames_is_a_refusal_not_a_guess(self):
        pooled, reason = F.pool_frames([result(quad_at(700, 500))] * 2)
        self.assertIsNone(pooled)
        self.assertIn("need 3", reason)

    def test_agreeing_frames_produce_one_answer(self):
        frames = [result(quad_at(700 + n, 500 + n)) for n in range(6)]
        pooled, _reason = F.pool_frames(frames)
        self.assertIsNotNone(pooled)
        self.assertEqual(pooled["frames_used"], 6)
        self.assertEqual(pooled["agreement"], 1.0)

    def test_a_dead_heat_refuses(self):
        """Three frames on one table and three on another is not evidence
        for either, and answering anyway is how a placement map ends up on
        the wrong table while looking perfectly normal. A tie clears the
        half-share bar on its own, so it needs its own rule."""
        frames = ([result(quad_at(300, 500)) for _ in range(3)]
                  + [result(quad_at(1300, 500)) for _ in range(3)])
        pooled, reason = F.pool_frames(frames)
        self.assertIsNone(pooled)
        self.assertIn("split evenly", reason)

    def test_a_plurality_short_of_half_refuses(self):
        frames = ([result(quad_at(300, 500)) for _ in range(3)]
                  + [result(quad_at(1300, 500)) for _ in range(2)]
                  + [result(quad_at(800, 100)) for _ in range(2)])
        pooled, reason = F.pool_frames(frames)
        self.assertIsNone(pooled)
        self.assertIn("disagree", reason)

    def test_the_largest_agreeing_group_wins_not_the_middle(self):
        """A plain medoid over all frames never converges, because a medoid
        over a bimodal set is tie-broken toward the failures. Nine frames on
        the real table and four on a neighbour must answer with the real
        one, not with something between them."""
        real = quad_at(1200, 500)
        neighbour = quad_at(200, 500)
        frames = ([result(real) for _ in range(9)]
                  + [result(neighbour) for _ in range(4)])
        pooled, _reason = F.pool_frames(frames)
        self.assertIsNotNone(pooled)
        self.assertEqual(pooled["frames_used"], 9)
        self.assertAlmostEqual(pooled["quad"][0][0], real[0][0], places=3)

    def test_the_winner_must_hold_half(self):
        frames = ([result(quad_at(1200, 500)) for _ in range(4)]
                  + [result(quad_at(200, 500)) for _ in range(3)]
                  + [result(quad_at(700, 100)) for _ in range(3)])
        pooled, reason = F.pool_frames(frames)
        self.assertIsNone(pooled)
        self.assertIn("disagree", reason)

    def test_the_answer_is_an_observation_not_an_average(self):
        """The medoid is a frame that really happened. An average of two
        tables is a table nobody played on."""
        frames = [result(quad_at(700, 500 + 6 * n)) for n in range(5)]
        pooled, reason = F.pool_frames(frames)
        self.assertIsNotNone(pooled, reason)
        self.assertIn(pooled["quad"], [f["quad"] for f in frames])


class GeometryTest(unittest.TestCase):
    def test_convexity_survives_numpy_2(self):
        """NumPy 2 removed the 2-D cross product. The ValueError that
        change caused killed an entire blind run before anyone saw it."""
        self.assertTrue(F.is_convex(quad_at(0, 0)))
        bowtie = [[0, 0], [100, 0], [0, 100], [100, 100]]
        self.assertFalse(F.is_convex(bowtie))

    def test_the_model_table_is_the_real_one(self):
        self.assertAlmostEqual(F.TABLE_LENGTH_M, 2.740)
        self.assertAlmostEqual(F.TABLE_WIDTH_M, 1.525)
        self.assertAlmostEqual(
            F.TABLE_LENGTH_M / F.TABLE_WIDTH_M, 1.7967, places=3)

    def test_the_corner_channels_run_once_round_the_table(self):
        """A near/far/near/far ordering would describe a bowtie, and the
        canonicaliser downstream trusts that slots 0 and 1 are one edge."""
        near_left, near_right, far_right, far_left = (
            F.WORLD[c] for c in F.CORNERS)
        self.assertEqual(near_left[0], near_right[0])     # one end line
        self.assertEqual(far_left[0], far_right[0])       # the other
        self.assertNotEqual(near_left[0], far_left[0])
        self.assertAlmostEqual(
            math.dist(near_left, near_right), F.TABLE_WIDTH_M, places=6)
        self.assertAlmostEqual(
            math.dist(near_left, far_left), F.TABLE_LENGTH_M, places=6)

    def test_only_in_plane_keypoints_are_fitted(self):
        """Channels 9 and 10 are the net's TOP corners, 0.1525 m above the
        table. A plane-to-image homography cannot explain them and would be
        dragged out of true by trying."""
        self.assertNotIn(9, F.WORLD)
        self.assertNotIn(10, F.WORLD)
        self.assertEqual(len(F.IN_PLANE), 11)


if __name__ == "__main__":
    unittest.main()
