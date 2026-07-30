import unittest

from worker.winner_constrained_endings import (
    analyze_point_ending,
    consolidate_winner_consistent_families,
)


CALIBRATION = {
    "table_corners_px": {
        "A_near_left": [0, -20],
        "B_near_right": [0, 20],
        "C_far_right": [100, 20],
        "D_far_left": [100, -20],
    }
}


def context(*, winner="user", rally_start_s=None):
    value = {
        "confirmed_winner": winner,
        "server": "user",
        "server_side": "near",
        "side_to_player": {"near": "user", "far": "opponent"},
        "player_to_side": {"user": "near", "opponent": "far"},
        "fps": 30.0,
        "calibration": CALIBRATION,
    }
    if rally_start_s is not None:
        value["rally_start_s"] = rally_start_s
    return value


def point(candidates):
    return {
        "idx": 1,
        "duration_s": 12.0,
        "placement": {"candidates": candidates},
        "diagnostics": {"track": {"hits": [], "bounces": []}},
    }


class WinnerConstrainedEndingTests(unittest.TestCase):
    def test_clean_winner_and_complete_miss_share_one_terminal_family_margin(self):
        decision = consolidate_winner_consistent_families(
            {
                "terminal_features": {"attempted_return": False},
                "candidates": [
                    {
                        "family": "clean_winner",
                        "score": 3.0,
                        "winner_consistent": True,
                    },
                    {
                        "family": "complete_miss",
                        "score": 2.8,
                        "winner_consistent": True,
                    },
                    {
                        "family": "long_error",
                        "score": 1.1,
                        "winner_consistent": True,
                    },
                ],
            }
        )

        self.assertEqual(decision["ending_family"], "clean_winner")
        self.assertAlmostEqual(decision["confidence_margin"], 1.9)

    def test_sideways_net_death_is_a_net_error_by_confirmed_loser(self):
        result = analyze_point_ending(
            point([
                {
                    "kind": "contact",
                    "t": 0.5,
                    "side": "far",
                    "x": 95,
                    "y": 0,
                }
            ]),
            {
                17: (75, 0),
                18: (65, 0),
                19: (56, 0),
                20: (51, 2),
                21: (50, 9),
                22: (50, 18),
            },
            [{"time_s": 0.67, "confidence": 4.0}],
            context(winner="user"),
        )

        self.assertEqual(result["ending_family"], "net")
        self.assertEqual(result["net_behavior"], "died_stuck_lateral")
        self.assertEqual(result["final_hitter"], "opponent")
        self.assertEqual(result["implied_winner"], "user")

    def test_clean_crossing_is_not_mislabeled_as_a_net_death(self):
        result = analyze_point_ending(
            point([
                {
                    "kind": "contact",
                    "t": 0.5,
                    "side": "far",
                    "x": 95,
                    "y": 0,
                }
            ]),
            {
                17: (76, 0),
                18: (66, 0),
                19: (56, 0),
                20: (46, 4),
                21: (20, 7),
                22: (-12, 9),
            },
            [],
            context(winner="user"),
        )

        self.assertNotEqual(result["ending_family"], "net")
        self.assertFalse(
            result["features"]["net_normal_stall_or_reversal"],
        )

    def test_serve_boundary_excludes_pre_serve_bouncing_and_contacts(self):
        sample = point([
            {"kind": "bounce", "t": 1.0, "side": "near", "x": 10, "y": 0},
            {"kind": "contact", "t": 1.4, "side": "far", "x": 90, "y": 0},
            {"kind": "contact", "t": 2.0, "side": "near", "x": 10, "y": 0},
            {"kind": "contact", "t": 9.4, "side": "far", "x": 90, "y": 0},
        ])
        without = analyze_point_ending(
            sample,
            {},
            [
                {"time_s": 1.4, "confidence": 5.0},
                {"time_s": 2.0, "confidence": 5.0},
                {"time_s": 9.4, "confidence": 5.0},
            ],
            context(),
        )
        with_boundary = analyze_point_ending(
            sample,
            {},
            [
                {"time_s": 1.4, "confidence": 5.0},
                {"time_s": 2.0, "confidence": 5.0},
                {"time_s": 9.4, "confidence": 5.0},
            ],
            context(rally_start_s=9.0),
        )

        self.assertGreater(
            without["observed_contact_count"],
            with_boundary["observed_contact_count"],
        )
        self.assertEqual(with_boundary["rally_start_s"], 9.0)

    def test_no_winner_consistent_evidence_abstains(self):
        result = analyze_point_ending(
            point([]),
            {},
            [],
            context(winner="opponent"),
        )

        self.assertEqual(result["ending_family"], "unsure")
        self.assertEqual(result["status"], "abstained")


if __name__ == "__main__":
    unittest.main()
