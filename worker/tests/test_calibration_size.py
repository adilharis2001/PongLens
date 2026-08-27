"""The corner-scaling trap, which cost a review round on 2026-08-27.

Table corners are stored in the SOURCE video's pixels. The per-point
clips are re-encoded much smaller — 720x406 against 1920x1080 across most
of the research corpus — and `_scaled_corners` rescales between the two,
but only when the calibration records the size it was marked at. Fifty of
the sixty-two calibrated matches in that corpus do not.

Its fallback is to assume the clip IS the source. Nothing raises: the
quad simply keeps its 1920-wide coordinates on a 720-wide frame and lands
off the edge of the picture. `choose_players` then finds nobody within
reach of the table, every frame reports no players, and the output is
indistinguishable from a detector that cannot see people. That is exactly
how it was read, on eight cases, before anyone measured it.
"""
import unittest

from worker.extract_side_changes_rtmpose import calibration_with_size
from worker.extract_match_structure_rtmpose import _scaled_corners


SOURCE_CORNERS = {
    "A_near_1": [400.0, 900.0], "B_near_2": [1500.0, 900.0],
    "C_far_2": [1200.0, 500.0], "D_far_1": [700.0, 500.0],
}
MATCH = {
    "source": {"width": 1920, "height": 1080},
    "calibration": {"table_corners_px": SOURCE_CORNERS},
}
CLIP_W, CLIP_H = 720, 406


class CalibrationWithSize(unittest.TestCase):
    def test_the_source_size_is_supplied_when_missing(self):
        self.assertEqual(
            calibration_with_size(MATCH, CLIP_W, CLIP_H)["size"],
            [1920, 1080])

    def test_a_recorded_size_is_left_alone(self):
        match = {**MATCH, "calibration": {**MATCH["calibration"],
                                          "size": [1280, 720]}}
        self.assertEqual(
            calibration_with_size(match, CLIP_W, CLIP_H)["size"], [1280, 720])

    def test_the_clip_is_the_last_resort(self):
        match = {"calibration": {"table_corners_px": SOURCE_CORNERS}}
        self.assertEqual(
            calibration_with_size(match, CLIP_W, CLIP_H)["size"],
            [CLIP_W, CLIP_H])

    def test_the_quad_lands_on_the_clip(self):
        corners = _scaled_corners(
            calibration_with_size(MATCH, CLIP_W, CLIP_H), CLIP_W, CLIP_H)
        for name, (x, y) in corners.items():
            self.assertTrue(0 <= x <= CLIP_W, f"{name} x={x} off the clip")
            self.assertTrue(0 <= y <= CLIP_H, f"{name} y={y} off the clip")

    def test_without_the_patch_it_falls_off_the_clip(self):
        """The failure this exists to prevent, asserted rather than described."""
        corners = _scaled_corners(MATCH["calibration"], CLIP_W, CLIP_H)
        self.assertTrue(
            any(x > CLIP_W for x, _ in corners.values()),
            "expected the unpatched quad to run off a 720-wide frame")


if __name__ == "__main__":
    unittest.main()
