import unittest

import worker.worker as worker


class CutMapTests(unittest.TestCase):
    """Where a re-cut window lives in the cut video, or that it does not."""

    def test_plays_mode_window_inside_a_kept_segment_is_located(self):
        mj = {"cut_segments": [[10.0, 40.0], [100.0, 130.0]], "points": []}
        cm = worker._CutMap(mj)
        # second segment starts at cut second 30 (first was 30s long)
        self.assertAlmostEqual(cm.locate(7, 105.0, 120.0), 35.0)
        self.assertAlmostEqual(cm.locate(1, 10.0, 12.0), 0.0)

    def test_window_reaching_removed_dead_space_goes_nowhere(self):
        mj = {"cut_segments": [[10.0, 40.0], [100.0, 130.0]], "points": []}
        cm = worker._CutMap(mj)
        self.assertIsNone(cm.locate(1, 38.0, 45.0))     # runs past a segment
        self.assertIsNone(cm.locate(1, 60.0, 70.0))     # in the hole
        self.assertIsNone(cm.locate(1, 35.0, 105.0))    # straddles the hole

    def test_spans_mode_uses_the_birth_window_only(self):
        mj = {"points": [
            {"idx": 3, "t0": 50.0, "t1": 60.0,
             "clip_t0": 49.0, "clip_t1": 61.3, "cut_t0": 200.0},
        ]}
        cm = worker._CutMap(mj)
        self.assertAlmostEqual(cm.locate(3, 49.5, 61.0), 200.5)
        self.assertIsNone(cm.locate(3, 47.0, 61.0))     # widened past birth
        self.assertIsNone(cm.locate(9, 49.5, 61.0))     # no birth record
        self.assertAlmostEqual(cm.born_post(3), 1.3)
        self.assertIsNone(cm.born_post(9))

    def test_no_match_json_locates_nothing(self):
        cm = worker._CutMap(None)
        self.assertIsNone(cm.locate(1, 0.0, 1.0))
        self.assertFalse(cm.dynamic_tails)

    def test_v2_pipeline_has_flat_tails(self):
        self.assertFalse(worker._CutMap({"pipeline": "v2"}).dynamic_tails)
        self.assertTrue(worker._CutMap({"pipeline": "v1"}).dynamic_tails)


class RecutKeyTests(unittest.TestCase):
    def test_only_recut_objects_are_deleted_never_originals(self):
        m = worker.R2_MEDIA_BUCKET
        self.assertIsNotNone(worker._RECUT_KEY_RE.match(
            f"r2://{m}/points/u1/m1/07-1a2b3c4d.mp4"))
        self.assertIsNone(worker._RECUT_KEY_RE.match(
            f"r2://{m}/points/u1/m1/07.mp4"))
        self.assertIsNone(worker._RECUT_KEY_RE.match(
            f"r2://ponglens-raw/u1/m1/07-1a2b3c4d.mp4"))


if __name__ == "__main__":
    unittest.main()
