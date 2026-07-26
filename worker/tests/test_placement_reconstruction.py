import unittest

import numpy as np

from worker.placement_reconstruction import (
    extract_candidates,
    split_track_chunks,
)


class CandidateExtractionTests(unittest.TestCase):
    def test_impossible_jump_is_removed_without_destroying_neighboring_track(self):
        detections = {
            0: (100.0, 100.0),
            1: (108.0, 103.0),
            2: (116.0, 106.0),
            3: (124.0, 109.0),
            4: (900.0, 800.0),
            5: (132.0, 112.0),
            6: (140.0, 115.0),
            7: (148.0, 118.0),
            8: (156.0, 121.0),
        }

        chunks = split_track_chunks(
            detections,
            f0=0,
            f1=9,
            width=1000,
            min_points=3,
        )
        kept_frames = [frame for chunk in chunks for frame in chunk]

        self.assertNotIn(4, kept_frames)
        self.assertEqual(kept_frames, [0, 1, 2, 3, 5, 6, 7, 8])

    def test_close_contact_and_bounce_remain_distinct_candidates(self):
        detections = {
            0: (10.0, 10.0),
            1: (20.0, 12.0),
            2: (30.0, 14.0),
            3: (40.0, 17.0),
            4: (50.0, 21.0),
            5: (40.0, 25.0),
            6: (30.0, 20.0),
            7: (20.0, 16.0),
            8: (10.0, 13.0),
            9: (0.0, 11.0),
        }
        fps = 30.0

        candidates = extract_candidates(
            detections,
            H=np.eye(3, dtype=np.float32),
            e=(1.0, 0.0),
            f0=0,
            f1=10,
            fps=fps,
            width=1000,
            audio_impacts=[{"t": 4 / fps, "confidence": 0.9}],
        )
        contacts = [event for event in candidates if event["kind"] == "contact"]
        bounces = [event for event in candidates if event["kind"] == "bounce"]

        self.assertEqual(len(contacts), 1)
        self.assertEqual(len(bounces), 1)
        self.assertNotEqual(contacts[0]["t"], bounces[0]["t"])
        self.assertLess(abs(contacts[0]["t"] - bounces[0]["t"]), 0.09)
        self.assertGreater(contacts[0]["audio_confidence"], 0.0)


if __name__ == "__main__":
    unittest.main()
