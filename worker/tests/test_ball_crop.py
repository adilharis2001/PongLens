"""The table crop for ball detection: the box, and the shift back.

Both halves fail quietly when they fail. A box that reaches across the
frame pulls in a neighbouring court, which is the exact thing the crop
exists to remove; and a shift that misses half the file leaves the
candidate cloud in crop coordinates while the chosen ball is in full-frame
ones, which reads downstream as a tracker that has lost its mind.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import points_endon as EO                                     # noqa: E402
import points_v2 as V2                                        # noqa: E402

# Real calibrated corners, straight off the matches named in each test.
KYLE = {'A_near_1': [1146.3, 594.6], 'B_near_2': [1298.4, 506.8],
        'C_far_2': [907.2, 450.6], 'D_far_1': [722.4, 487.4]}
TERRY = {'A_near_1': [868.2, 741.3], 'B_near_2': [1260.3, 699.9],
         'C_far_2': [1036.1, 604.4], 'D_far_1': [804.9, 621.0]}
JOSE = {'A_near_1': [314.0, 624.9], 'B_near_2': [615.1, 644.2],
        'C_far_2': [891.2, 565.1], 'D_far_1': [672.7, 555.3]}
ALL = {"kyle": KYLE, "terry": TERRY, "jose": JOSE}


class BallCropBox(unittest.TestCase):

    def test_the_table_is_inside_the_box(self):
        """A crop that clips the table is worse than no crop at all."""
        for name, cor in ALL.items():
            with self.subTest(name):
                bx, by, bw, bh = EO.ball_crop_box(cor)
                for x, y in cor.values():
                    self.assertTrue(bx <= x <= bx + bw, f"{name} x")
                    self.assertTrue(by <= y <= by + bh, f"{name} y")

    def test_the_box_stays_on_the_frame_and_is_even(self):
        for name, cor in ALL.items():
            with self.subTest(name):
                bx, by, bw, bh = EO.ball_crop_box(cor)
                self.assertGreaterEqual(bx, 0)
                self.assertGreaterEqual(by, 0)
                self.assertLessEqual(bx + bw, 1920)
                self.assertLessEqual(by + bh, 1080)
                # libx264 refuses odd dimensions, and this runs unattended
                self.assertEqual(bw % 2, 0)
                self.assertEqual(bh % 2, 0)

    def test_the_box_actually_shrinks_the_picture(self):
        """No shrink, no bigger ball — the whole point of the exercise."""
        for name, cor in ALL.items():
            with self.subTest(name):
                _, _, bw, bh = EO.ball_crop_box(cor)
                self.assertLess(bw, 1920)
                self.assertLess(bh, 1080)

    def test_end_on_gets_a_real_crop_not_the_whole_frame(self):
        """Terry is the case the first version of this rule got wrong.

        Holding 16:9 by WIDENING produced 1776x1000 on this camera — the
        table is squashed flat, so the 1.6 m of air above it dominates the
        prism and the box grew to almost the entire frame. The metric side
        pad costs some of the old 2.5x gain, but the box must stay a real
        crop.
        """
        bw = EO.ball_crop_box(TERRY)[2]
        self.assertLess(bw, 1300, f"end-on crop went slack again: {bw}px")
        self.assertGreater(1920 / bw, 1.45,
                           "under 1.45x is not worth an extra encode")

    @staticmethod
    def _side_room_m(cor):
        """(left, right) metres between the table's edge and the box's."""
        bx, _, bw, _ = EO.ball_crop_box(cor)
        near = sorted((p for n, p in cor.items() if "near" in n),
                      key=lambda p: p[0])
        A, B = near
        ppm = ((B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2) ** 0.5 / 1.525
        left_x = min(x for x, _ in cor.values())
        right_x = max(x for x, _ in cor.values())
        return (left_x - bx) / ppm, (bx + bw - right_x) / ppm

    def test_every_server_gets_real_side_room(self):
        """The side pad is metres, not a fraction of the hull.

        A fraction of the hull's width gave Terry's servers 0.61 m where
        Kyle's got 1.75 m, and 13 of the 18 serves the first crop
        genuinely cut left through the sides (82% real, per the labelled
        12-match corpus of 2026-09-01). Every match with a sideways cut
        had under 1.1 m of room; none with 1.3 m or more had any.

        A SIDE-ON TABLE STILL GETS THAT ROOM AND AN END-ON ONE DOES NOT,
        deliberately (2026-09-10). CROP_SIDE_MAX_W bounds the metre rule,
        because on a camera behind the players the near end line — the
        scale the metre is converted at — is the closest thing in the
        picture and the margin becomes the box. The bound is set so it
        bites on nothing that crops correctly today: every side-on quad in
        the frozen corpus keeps its 1.30 m to the pixel. Terry drops to
        1.05, and his comparison is not against 1.30 m, it is against the
        full frame, because until this change he was not cropped at all.
        """
        for name, cor in ALL.items():
            with self.subTest(name):
                left_m, right_m = self._side_room_m(cor)
                _, shape = EO.crop_allowed(cor)
                floor = 1.2 if shape >= 0.40 else 1.0
                # a table against the frame edge is allowed less on that side
                self.assertGreater(
                    max(left_m, right_m), floor,
                    f"{name}: {left_m:.2f} m left, {right_m:.2f} m right")

    def test_the_bound_does_not_touch_a_side_on_table(self):
        """The safety property that makes CROP_SIDE_MAX_W shippable.

        The bound exists for Terry and Koko. If it also moved a table that
        crops correctly today, this change would be trading one regression
        for another — so assert directly that it cannot: on a side-on quad
        the metre rule must still be what wins, to the pixel.
        """
        for name, cor in (("kyle", KYLE), ("jose", JOSE)):
            with self.subTest(name):
                bounded = EO.ball_crop_box(cor)
                saved = EO.CROP_SIDE_MAX_W
                EO.CROP_SIDE_MAX_W = 10.0          # a bound that cannot bind
                try:
                    unbounded = EO.ball_crop_box(cor)
                finally:
                    EO.CROP_SIDE_MAX_W = saved
                self.assertEqual(bounded, unbounded, f"{name} moved")

    def test_the_room_goes_above_the_table_not_below_it(self):
        """The rally happens over the surface. Under it is floor.

        Terry shipped once with 26px of air above his table and 273px of
        his floor below it, because the trim was anchored to the PADDED
        bottom rather than the table. His serves went 13 -> 4. Whatever
        else changes, the box must keep more room above than below.
        """
        for name, cor in ALL.items():
            with self.subTest(name):
                _, by, _, bh = EO.ball_crop_box(cor)
                top = min(y for _, y in cor.values())
                bottom = max(y for _, y in cor.values())
                above, floor = top - by, (by + bh) - bottom
                self.assertGreater(
                    above, floor,
                    f"{name}: {above:.0f}px above vs {floor:.0f}px of floor")

    def test_a_table_at_the_frame_edge_does_not_reach_across_the_room(self):
        """Jose's table sits against the left edge.

        The margin it cannot take on the left must NOT be taken on the
        right; that is how a neighbouring court ended up inside the crop
        that was meant to exclude one.
        """
        bx, _, bw, _ = EO.ball_crop_box(JOSE)
        table_right = max(x for x, _ in JOSE.values())
        self.assertLess(bx + bw - table_right, 700)

    def test_no_box_when_the_crop_would_be_the_whole_frame(self):
        """An encode that buys nothing should not run."""
        huge = {'A_near_1': [10, 1070], 'B_near_2': [1910, 1070],
                'C_far_2': [1910, 10], 'D_far_1': [10, 10]}
        self.assertIsNone(EO.ball_crop_box(huge))


class ShiftDetections(unittest.TestCase):

    def test_it_moves_the_ball_and_the_candidates(self):
        """Miss either and half the file is in the wrong frame."""
        with tempfile.TemporaryDirectory() as d:
            src, dst = os.path.join(d, "in.jsonl"), os.path.join(d, "out.jsonl")
            with open(src, "w") as fh:
                fh.write(json.dumps({"f": 0, "x": 10.0, "y": 20.0, "conf": 5,
                                     "c": [[10.0, 20.0, 5], [30.0, 40.0, 2]]})
                         + "\n")
                fh.write(json.dumps({"f": 1, "x": None, "y": None,
                                     "conf": 0, "c": []}) + "\n")
            n = V2.shift_detections(src, dst, 100.0, 200.0)
            with open(dst) as fh:
                rows = [json.loads(x) for x in fh.read().splitlines()]
        self.assertEqual(n, 1)
        self.assertEqual((rows[0]["x"], rows[0]["y"]), (110.0, 220.0))
        self.assertEqual(rows[0]["c"], [[110.0, 220.0, 5], [130.0, 240.0, 2]])
        # an empty frame stays empty rather than becoming a ball at (dx, dy)
        self.assertIsNone(rows[1]["x"])
        self.assertEqual(rows[1]["c"], [])

    def test_the_result_still_loads_as_ordinary_detections(self):
        """The file the rest of the pipeline reads must be
        indistinguishable from a full-frame one, or nothing downstream
        could have stayed unchanged."""
        with tempfile.TemporaryDirectory() as d:
            src, dst = os.path.join(d, "in.jsonl"), os.path.join(d, "out.jsonl")
            with open(src, "w") as fh:
                for i in range(3):
                    fh.write(json.dumps({"f": i, "x": 5.0, "y": 6.0, "conf": 9,
                                         "c": [[5.0, 6.0, 9]]}) + "\n")
            V2.shift_detections(src, dst, 50.0, 60.0)
            cand = V2.load_multi(dst)
        self.assertIsNotNone(cand)
        self.assertEqual(cand[0], [(55.0, 66.0, 9)])


if __name__ == "__main__":
    unittest.main()


class CropGate(unittest.TestCase):
    """An end-on table IS cropped now (2026-09-10, was the reverse).

    The 0.40 gate was set on 2026-09-06 to protect three rallies whose ball
    left the box sideways, measured against the ball pipeline. The body
    pipeline shipped on 09-08 and the serve/rally edge rules on 09-09, so
    that trade was priced against a system that no longer exists. Scored on
    09-10 against Adil's own scorekeeper taps, the gate costs Terry 22 of
    his 46 rallies and Koko 18 of 44 — and those two are the only matches
    in the set whose activity gate lands off their own table (0% and 11%
    overlap against 100% everywhere else). Rowel sits just the other side
    of the old line at 0.46, keeps its crop, and loses nothing at all.

    What survives is a floor for a quad too degenerate to trust its scale.
    """

    def test_an_end_on_table_is_cropped(self):
        allowed, shape = EO.crop_allowed(TERRY)
        self.assertTrue(allowed, "the end-on gate is back, Terry loses 22 rallies")
        self.assertLess(shape, 0.40, "TERRY is meant to be the end-on fixture")
        self.assertGreaterEqual(shape, EO.CROP_MIN_SHAPE)

    def test_a_quad_too_flat_to_trust_is_still_refused(self):
        """The floor. A quad this squashed has no scale worth cropping to."""
        flat = {'A_near_1': [800.0, 700.0], 'B_near_2': [1260.0, 700.0],
                'C_far_2': [1240.0, 690.0], 'D_far_1': [820.0, 690.0]}
        allowed, shape = EO.crop_allowed(flat)
        self.assertLess(shape, EO.CROP_MIN_SHAPE)
        self.assertFalse(allowed)

    def test_side_on_tables_are_cropped(self):
        for name, cor in (("kyle", KYLE), ("jose", JOSE)):
            with self.subTest(name):
                allowed, shape = EO.crop_allowed(cor)
                self.assertTrue(allowed)
                self.assertGreaterEqual(shape, EO.CROP_MIN_SHAPE)

    def test_an_unreadable_quad_is_left_to_the_box_rule(self):
        self.assertEqual(EO.crop_allowed(None), (True, None))
        self.assertEqual(EO.crop_allowed({"A_near_1": [1, 2]}), (True, None))
