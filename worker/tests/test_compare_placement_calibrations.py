import unittest

from worker.eval.compare_placement_calibrations import (
    calibration_from_consensus,
    compare_placements,
    freeze_event_candidates,
    landing_zone,
)


def placement(
    *,
    server_side="near",
    u=0.40,
    v=2.00,
    status="ready",
    confidence=0.90,
    shot_seq=1,
):
    return {
        "v": 3,
        "hypotheses": {
            server_side: {
                "server_side": server_side,
                "status": status,
                "confidence": confidence,
                "shots": [
                    {
                        "seq": shot_seq,
                        "phase": "serve",
                        "hitter_side": server_side,
                        "landing": {
                            "u": u,
                            "v": v,
                            "confidence": confidence,
                        },
                    }
                ],
            }
        },
    }


class CalibrationConversionTests(unittest.TestCase):
    def test_consensus_is_scaled_to_source_and_builds_length_axis(self):
        case = {
            "source_size": [640, 360],
            "image_size": [320, 180],
        }
        result = {
            "consensus": {"accepted": True},
            "calibration": {
                "accepted": True,
                "corners": [
                    [130.0, 116.0],
                    [96.0, 96.0],
                    [179.0, 77.0],
                    [221.0, 83.0],
                ],
            },
        }

        calibration = calibration_from_consensus(case, result)

        self.assertEqual(
            calibration["table_corners_px"],
            {
                "A_near_1": [192.0, 192.0],
                "B_near_2": [260.0, 232.0],
                "C_far_2": [442.0, 166.0],
                "D_far_1": [358.0, 154.0],
            },
        )
        self.assertEqual(calibration["orientation"], "canonical-v1")
        self.assertTrue(calibration["legacy_reordered"])
        self.assertAlmostEqual(
            sum(value * value for value in calibration["length_axis"]),
            1.0,
        )

    def test_withheld_consensus_does_not_create_a_calibration(self):
        self.assertIsNone(
            calibration_from_consensus(
                {"source_size": [640, 360], "image_size": [320, 180]},
                {
                    "consensus": {"accepted": False},
                    "calibration": {"accepted": False},
                },
            )
        )


class LandingComparisonTests(unittest.TestCase):
    def test_landing_zone_uses_receiver_relative_thirds(self):
        self.assertEqual(
            landing_zone({"u": 0.40, "v": 2.00}, "far"),
            "medium_left",
        )
        self.assertEqual(
            landing_zone({"u": 0.40, "v": 0.74}, "near"),
            "medium_right",
        )

    def test_full_identity_match_reports_displacement_and_zone_flip(self):
        current = {18: placement(u=0.49)}
        proposed = {18: placement(u=0.59)}

        result = compare_placements(current, proposed, "m1")

        self.assertEqual(result["matched_landings"], 1)
        self.assertEqual(result["current_only_landings"], 0)
        self.assertEqual(result["proposed_only_landings"], 0)
        self.assertEqual(result["displacement_cm"]["median"], 10.0)
        self.assertEqual(result["displacement_cm"]["p90"], 10.0)
        self.assertEqual(result["displacement_cm"]["maximum"], 10.0)
        self.assertEqual(result["lateral_flips"], 1)
        self.assertEqual(result["depth_flips"], 0)
        self.assertEqual(result["zone_flips"], 1)
        self.assertEqual(
            result["changed_points"][0]["identity"],
            {
                "match_id": "m1",
                "point_idx": 18,
                "server_side": "near",
                "shot_seq": 1,
                "phase": "serve",
                "hitter_side": "near",
            },
        )
        self.assertEqual(
            result["changed_points"][0]["current"]["zone"],
            "medium_left",
        )
        self.assertEqual(
            result["changed_points"][0]["proposed"]["zone"],
            "medium_middle",
        )

    def test_same_shot_number_in_another_hypothesis_never_matches(self):
        current = {18: placement(server_side="far", v=0.74)}
        proposed = {18: placement(server_side="near", v=2.00)}

        result = compare_placements(current, proposed, "m1")

        self.assertEqual(result["matched_landings"], 0)
        self.assertEqual(result["current_only_landings"], 1)
        self.assertEqual(result["proposed_only_landings"], 1)
        self.assertEqual(result["zone_flips"], 0)

    def test_untrusted_landing_is_counted_only_in_the_trusted_arm(self):
        current = {18: placement(confidence=0.69)}
        proposed = {18: placement(confidence=0.90)}

        result = compare_placements(current, proposed, "m1")

        self.assertEqual(result["matched_landings"], 0)
        self.assertEqual(result["current_only_landings"], 0)
        self.assertEqual(result["proposed_only_landings"], 1)

    def test_boundary_transition_is_reported(self):
        current = {18: placement(u=0.40)}
        proposed = {18: placement(u=0.49)}

        result = compare_placements(current, proposed, "m1")

        self.assertEqual(result["boundary_entries"], 1)
        self.assertEqual(result["boundary_exits"], 0)
        self.assertEqual(result["zone_flips"], 0)

    def test_event_candidates_keep_agreements_and_one_arm_abstentions(self):
        legacy = {
            18: placement(u=1.10),
            19: placement(u=0.20),
        }
        canonical = {
            18: placement(u=0.40),
            19: placement(u=0.30),
        }
        openai = {
            18: placement(u=0.42),
        }

        events = freeze_event_candidates(
            legacy,
            canonical,
            openai,
            "m1",
        )

        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["comparison_class"], "agreement")
        self.assertEqual(events[0]["legacy_current"]["u"], 1.10)
        self.assertEqual(events[0]["canonical_current"]["u"], 0.40)
        self.assertEqual(events[0]["openai"]["u"], 0.42)
        self.assertEqual(
            events[1]["comparison_class"],
            "one_arm_abstention",
        )
        self.assertIsNone(events[1]["openai"])


if __name__ == "__main__":
    unittest.main()
