import unittest

import numpy as np

from worker.match_structure import (
    aggregate_first_server,
    assign_anonymous_players,
    build_player_regions,
    detect_end_changes,
    torso_signature,
)


class FirstServerTests(unittest.TestCase):
    def test_requires_two_consistent_aab_adjusted_votes(self):
        calls = [
            {
                "position": 1,
                "idx": 11,
                "side": "near",
                "status": "high_confidence",
            },
            {
                "position": 2,
                "idx": 12,
                "side": "near",
                "status": "high_confidence",
            },
            {
                "position": 3,
                "idx": 13,
                "side": "far",
                "status": "high_confidence",
            },
        ]

        result = aggregate_first_server(calls)

        self.assertEqual(result["side"], "near")
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["usable_points"], [11, 12, 13])

    def test_withholds_one_usable_vote(self):
        result = aggregate_first_server(
            [
                {
                    "position": 1,
                    "idx": 11,
                    "side": "near",
                    "status": "high_confidence",
                },
                {
                    "position": 2,
                    "idx": 12,
                    "side": None,
                    "status": "needs_review",
                },
                {
                    "position": 3,
                    "idx": 13,
                    "side": None,
                    "status": "unavailable",
                },
            ]
        )

        self.assertIsNone(result["side"])
        self.assertEqual(result["status"], "withheld")


class EndChangeTests(unittest.TestCase):
    def test_one_contradiction_does_not_change_state(self):
        assignments = {
            1: {"state": "direct", "status": "high_confidence"},
            2: {"state": "swapped", "status": "high_confidence"},
            3: {"state": "direct", "status": "high_confidence"},
        }

        self.assertEqual(detect_end_changes(assignments), [])

    def test_two_contradictions_emit_stable_interval(self):
        assignments = {
            1: {"state": "direct", "status": "high_confidence"},
            2: {"state": "direct", "status": "high_confidence"},
            4: {"state": "swapped", "status": "high_confidence"},
            5: {"state": "swapped", "status": "high_confidence"},
        }

        self.assertEqual(
            detect_end_changes(assignments),
            [
                {
                    "after_idx": 2,
                    "before_idx": 4,
                    "confirmed_at_idx": 5,
                    "old_state": "direct",
                    "new_state": "swapped",
                    "confirmations": 2,
                    "kind": "end_change",
                }
            ],
        )


class AppearanceTests(unittest.TestCase):
    def test_assigns_swapped_players_only_above_frozen_margin(self):
        result = assign_anonymous_players(
            {
                1: {
                    "near": [0.1, 0.2, 0.3],
                    "far": [0.8, 0.7, 0.6],
                },
                2: {
                    "near": [0.79, 0.69, 0.61],
                    "far": [0.11, 0.19, 0.31],
                },
            }
        )

        self.assertEqual(result[2]["state"], "swapped")
        self.assertEqual(result[2]["status"], "high_confidence")

    def test_torso_signature_requires_three_confident_joints(self):
        image = np.full((40, 40, 3), 128, dtype=np.uint8)
        player = {"kpts": [[0, 0, 0]] * 17}

        self.assertIsNone(torso_signature(image, player))


class RegionTests(unittest.TestCase):
    def test_calibration_builds_two_bounded_regions(self):
        regions = build_player_regions(
            {
                "near_left": [100, 350],
                "near_right": [500, 350],
                "far_left": [200, 150],
                "far_right": [400, 150],
            },
            640,
            480,
        )

        self.assertEqual(set(regions), {"near", "far"})
        for box in regions.values():
            self.assertEqual(len(box), 4)
            self.assertGreater(box[2], box[0])
            self.assertGreater(box[3], box[1])


if __name__ == "__main__":
    unittest.main()
