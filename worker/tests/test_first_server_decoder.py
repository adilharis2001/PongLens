import unittest

from worker.first_server_decoder import (
    decode_first_server,
    decode_first_server_soft,
    score_rotation_alignment,
)


def calls(*sides: str | None, confidence: float = 0.99) -> list[dict]:
    return [
        {
            "idx": 100 + position,
            "position": position,
            "side": side,
            "status": (
                "high_confidence" if side is not None else "withheld"
            ),
            "confidence": confidence if side is not None else 0.0,
        }
        for position, side in enumerate(sides, start=1)
    ]


class RotationAlignmentTests(unittest.TestCase):
    def test_scores_the_standard_aabb_pattern(self):
        result = score_rotation_alignment(
            calls("near", "near", "far", "far", "near"),
            "near",
        )

        self.assertEqual(result["agreement"], 1.0)
        self.assertEqual(result["expected"], [
            "near",
            "near",
            "far",
            "far",
            "near",
        ])
        self.assertEqual(result["missing_points"], 0)

    def test_a_single_skip_shifts_only_later_observations(self):
        result = score_rotation_alignment(
            calls("near", "far", "far", "near"),
            "near",
            skipped_position=2,
        )

        self.assertEqual(result["agreement"], 1.0)
        self.assertEqual(result["logical_positions"], [1, 3, 4, 5])
        self.assertEqual(result["missing_points"], 1)


class FirstServerDecoderTests(unittest.TestCase):
    def test_decodes_a_perfect_five_point_sequence(self):
        result = decode_first_server(
            calls("near", "near", "far", "far", "near")
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertGreaterEqual(result["confidence"], 0.95)
        self.assertEqual(result["usable_points"], [101, 102, 103, 104, 105])

    def test_decodes_one_missing_early_point(self):
        result = decode_first_server(
            calls("near", "far", "far", "near")
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertEqual(result["alignment"]["missing_points"], 1)
        self.assertIn(result["alignment"]["skipped_position"], {1, 2})

    def test_withholds_contradictory_three_point_sequence(self):
        result = decode_first_server(calls("near", "far", "near"))

        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])

    def test_withholds_fewer_than_three_usable_calls(self):
        result = decode_first_server(
            calls("near", None, "far", None, None)
        )

        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])
        self.assertEqual(result["reason"], "insufficient_usable_calls")

    def test_withheld_calls_do_not_count_as_contradictions(self):
        result = decode_first_server(
            calls("far", "far", None, "near", "far")
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "far")
        self.assertEqual(result["usable_points"], [101, 102, 104, 105])


class SoftFirstServerDecoderTests(unittest.TestCase):
    def test_combines_subthreshold_consistent_points(self):
        probabilities = [0.72, 0.70, 0.32, 0.29, 0.69]
        soft_calls = [
            {
                "idx": position,
                "position": position,
                "near": probability,
                "far": 1.0 - probability,
            }
            for position, probability in enumerate(probabilities, start=1)
        ]

        result = decode_first_server_soft(
            soft_calls, max_missing=0, minimum_margin=1.0
        )

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["side"], "near")
        self.assertGreater(result["likelihood_margin"], 1.0)

    def test_soft_decoder_can_account_for_one_removed_point(self):
        probabilities = [0.82, 0.20, 0.18, 0.79]
        soft_calls = [
            {
                "idx": position,
                "position": position,
                "near": probability,
                "far": 1.0 - probability,
            }
            for position, probability in enumerate(probabilities, start=1)
        ]

        result = decode_first_server_soft(
            soft_calls, max_missing=1, minimum_margin=1.0
        )

        self.assertEqual(result["side"], "near")
        self.assertEqual(result["alignment"]["missing_points"], 1)

    def test_soft_decoder_withholds_an_ambiguous_sequence(self):
        result = decode_first_server_soft(
            [
                {"idx": index, "near": 0.51, "far": 0.49}
                for index in range(1, 6)
            ],
            minimum_margin=1.0,
        )

        self.assertEqual(result["status"], "withheld")
        self.assertIsNone(result["side"])

    def test_hard_decoder_behavior_remains_unchanged(self):
        result = decode_first_server(
            calls("near", "near", "far", "far", "near")
        )
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["side"], "near")


if __name__ == "__main__":
    unittest.main()
