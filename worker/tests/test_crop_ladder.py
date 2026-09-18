"""The crop ladder: tightest view first, widening only on a refusal.

The failure it exists for is match 3794e632 — eight tables in a tournament
hall, and the per-frame rule chose an EMPTY one 68% of the way to the right
edge in sixteen frames of sixteen. Ranking candidates by centrality was tried
and rejected on measurement; see the note on CROP_LADDER.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import table_keypoint_fit as F  # noqa: E402
import table_keypoints as TK    # noqa: E402


def quad_at(x, y, width=400.0, height=220.0):
    inset = width * 0.12
    return [[x, y + height], [x + width, y + height],
            [x + width - inset, y], [x + inset, y]]


class FakeImage:
    """Just enough of a numpy image for the crop arithmetic."""

    def __init__(self, width, height):
        self.shape = (height, width, 3)

    def __getitem__(self, key):
        _rows, cols = key
        return FakeImage(cols.stop - cols.start, self.shape[0])


class FakeDetector:
    """Answers with whatever the test says is visible at each crop width."""

    def __init__(self, by_width):
        self.by_width = by_width
        self.widths_seen = []

    def candidates(self, image):
        width = image.shape[1]
        self.widths_seen.append(width)
        return [dict(t) for t in self.by_width.get(width, [])]


def table(quad, weight=9.0):
    return {"quad": quad, "weight": weight, "tables_seen": 1,
            "homography": None, "plausible": True, "area": 1.0,
            "inliers": 9, "used": {}, "residuals": [1.0],
            "camera_height": 2.0}


class CropLadderTest(unittest.TestCase):
    FRAMES = [(i, FakeImage(1000, 1080)) for i in range(6)]

    def test_the_tightest_crop_that_finds_a_table_wins(self):
        centred = table(quad_at(300, 400))
        detector = FakeDetector({800: [centred]})
        kept, _ = TK._detect_at_crop(detector, self.FRAMES, 0.80, False)
        self.assertEqual(len(kept), 6)
        # The quad comes back in FULL-frame coordinates, not the crop's.
        self.assertEqual(kept[0]["quad"][0][0], 300 + 100)

    def test_it_widens_when_the_tight_crop_finds_nothing(self):
        """A crop that clips the real table must refuse, not name another one,
        or the ladder would never widen. frame_verdict does that for us."""
        wide_only = table(quad_at(60, 400))
        detector = FakeDetector({900: [wide_only], 1000: [wide_only]})
        kept, _ = TK._detect_at_crop(detector, self.FRAMES, 0.80, False)
        self.assertEqual(kept, [])
        kept, _ = TK._detect_at_crop(detector, self.FRAMES, 1.00, False)
        self.assertEqual(len(kept), 6)

    def test_the_ladder_is_tight_to_wide(self):
        self.assertEqual(list(TK.CROP_LADDER), sorted(TK.CROP_LADDER))
        self.assertEqual(TK.CROP_LADDER[-1], 1.00,
                         "the ladder must end at the full frame, or a match "
                         "that only works uncropped would newly refuse")

    def test_a_full_frame_pass_does_not_move_the_quad(self):
        centred = table(quad_at(300, 400))
        detector = FakeDetector({1000: [centred]})
        kept, _ = TK._detect_at_crop(detector, self.FRAMES, 1.00, False)
        self.assertEqual(kept[0]["quad"][0][0], 300)


if __name__ == "__main__":
    unittest.main()
