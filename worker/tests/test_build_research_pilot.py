import unittest

from worker.build_research_pilot import (
    EXCLUDED_MATCH_IDS,
    PILOT_POINT_PLAN,
    fuse_candidates,
    relative_visual_candidates,
)


class PilotPlanTests(unittest.TestCase):
    def test_plan_has_20_unique_sources_and_excludes_vaibhav_2022(self):
        pairs = [(item["match_id"], item["point_idx"]) for item in PILOT_POINT_PLAN]
        self.assertEqual(len(pairs), 20)
        self.assertEqual(len(set(pairs)), 20)
        self.assertTrue(EXCLUDED_MATCH_IDS.isdisjoint({match_id for match_id, _ in pairs}))

    def test_visual_times_are_rebased_to_frozen_clip(self):
        point = {
            "t0": 21.0,
            "cut_t0": 99.0,
            "tight_start": False,
            "placement": {
                "v": 3,
                "candidates": [
                    {
                        "id": "candidate-1",
                        "t": 21.25,
                        "kind": "bounce",
                        "kinds": ["table_bounce"],
                        "x": 320,
                        "y": 180,
                        "u": 0.4,
                        "v": 1.1,
                        "visual_confidence": 0.9,
                    }
                ],
            },
        }
        result = relative_visual_candidates(
            point, duration_s=4.0, width=640, height=360, pre_s=1.0
        )
        self.assertEqual(result[0]["time_s"], 1.25)
        self.assertEqual(result[0]["x_norm"], 0.5)
        self.assertEqual(result[0]["y_norm"], 0.5)

    def test_fusion_aligns_nearby_audio_and_visual_without_dropping_either(self):
        audio = [
            {"id": "a1", "time_s": 1.0, "confidence": 2.0},
            {"id": "a2", "time_s": 2.0, "confidence": 1.5},
        ]
        visual = [
            {"id": "v1", "time_s": 1.06, "kind": "contact"},
            {"id": "v2", "time_s": 3.0, "kind": "bounce"},
        ]
        markers = fuse_candidates(audio, visual, tolerance_s=0.08)
        self.assertEqual([marker["origin"] for marker in markers], [
            "both",
            "audio",
            "blurball",
        ])
        self.assertEqual(markers[0]["audio_id"], "a1")
        self.assertEqual(markers[0]["visual_id"], "v1")


if __name__ == "__main__":
    unittest.main()
