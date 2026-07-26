import unittest

import numpy as np

from worker.placement_reconstruction import (
    extract_candidates,
    reconstruct_placement,
    solve_hypothesis,
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
        self.assertIsNone(contacts[0]["u"])
        self.assertIsNone(contacts[0]["v"])
        self.assertEqual(contacts[0]["side"], "far")


class ReconstructionTests(unittest.TestCase):
    @staticmethod
    def event(event_id, t, kind, u=None, v=None, side=None):
        return {
            "id": event_id,
            "t": t,
            "kind": kind,
            "u": u,
            "v": v,
            "side": side,
            "visual_confidence": 0.9,
            "audio_confidence": 0.0,
        }

    def test_serve_second_bounce_must_be_on_receiver_half(self):
        candidates = [
            self.event("e1", 1.0, "bounce", u=0.4, v=2.2),
            self.event("e2", 1.3, "bounce", u=0.7, v=0.6),
        ]

        far = solve_hypothesis(candidates, "far", None, [])
        near = solve_hypothesis(candidates, "near", None, [])

        self.assertEqual(far["shots"][0]["phase"], "serve")
        self.assertEqual(far["shots"][0]["landing"]["event_id"], "e2")
        self.assertIn("serve_second_bounce_on_server_half", near["reasons"])
        self.assertNotEqual(near["status"], "ready")

    def test_terminal_out_belongs_to_last_contact_not_previous_landing(self):
        candidates = [
            self.event("s1", 1.0, "bounce", u=0.4, v=2.2),
            self.event("s2", 1.3, "bounce", u=0.7, v=0.6),
            self.event("r1", 1.7, "contact", side="near"),
            self.event("r2", 2.0, "bounce", u=0.8, v=2.1),
            self.event("x1", 2.4, "contact", side="far"),
            self.event("x2", 2.8, "out", side="far"),
        ]

        result = solve_hypothesis(candidates, "far", None, [])

        self.assertEqual(result["shots"][-1]["hitter_side"], "far")
        self.assertEqual(result["shots"][-1]["terminal"]["kind"], "out")
        self.assertIsNone(result["shots"][-1]["landing"])

    def test_reconstruction_keeps_both_physical_server_hypotheses(self):
        detections = {
            0: (10.0, 10.0),
            1: (20.0, 12.0),
            2: (30.0, 18.0),
            3: (40.0, 12.0),
            4: (50.0, 10.0),
        }

        placement = reconstruct_placement(
            detections,
            H=np.eye(3, dtype=np.float32),
            e=(1.0, 0.0),
            track={"segments": []},
            suggestion=None,
            f0=0,
            f1=5,
            fps=30.0,
            width=1000,
        )

        self.assertEqual(placement["v"], 3)
        self.assertEqual(set(placement["hypotheses"]), {"near", "far"})


if __name__ == "__main__":
    unittest.main()
