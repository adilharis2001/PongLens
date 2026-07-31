import unittest

from worker.temporal_serve_fusion import (
    FusionThresholds,
    fuse_temporal_evidence,
)


class TemporalFusionTests(unittest.TestCase):
    def setUp(self):
        self.thresholds = FusionThresholds()

    def test_strong_pose_survives_missing_bounce_chain(self):
        result = fuse_temporal_evidence(
            temporal={"near": 0.97, "far": 0.08, "onset_t": 1.2},
            chains=[],
            audio=[],
            thresholds=self.thresholds,
        )
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertEqual(result["reason"], "strong_temporal_evidence")

    def test_contradictory_chain_forces_abstention_at_small_pose_margin(self):
        result = fuse_temporal_evidence(
            temporal={"near": 0.72, "far": 0.35, "onset_t": 1.0},
            chains=[{"server_hypothesis": "far", "rank": 0.9}],
            audio=[],
            thresholds=self.thresholds,
        )
        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])
        self.assertEqual(result["reason"], "temporal_chain_disagreement")

    def test_matching_chain_and_nearby_audio_support_a_moderate_call(self):
        result = fuse_temporal_evidence(
            temporal={"near": 0.78, "far": 0.43, "onset_t": 1.0},
            chains=[{"server_hypothesis": "near", "rank": 0.82}],
            audio=[{"time_s": 1.05, "confidence": 2.0}],
            thresholds=self.thresholds,
        )
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertEqual(result["reason"], "supported_temporal_evidence")

    def test_ambiguous_temporal_scores_are_withheld(self):
        result = fuse_temporal_evidence(
            temporal={"near": 0.64, "far": 0.58, "onset_t": 1.0},
            chains=[],
            audio=[{"time_s": 1.01, "confidence": 4.0}],
            thresholds=self.thresholds,
        )
        self.assertEqual(result["status"], "withheld")
        self.assertEqual(result["reason"], "temporal_margin_too_small")

    def test_invalid_temporal_values_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "near and far"):
            fuse_temporal_evidence(
                temporal={"near": 0.9},
                chains=[],
                audio=[],
                thresholds=self.thresholds,
            )


if __name__ == "__main__":
    unittest.main()
