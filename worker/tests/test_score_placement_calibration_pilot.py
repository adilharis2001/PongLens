import unittest

from worker.score_placement_calibration_pilot import score_labels


def row(
    *,
    truth=(0.4, 2.0),
    blind_truth=None,
    canonical=(0.5, 2.0),
    openai=(0.4, 2.1),
    result="landed",
    confidence="certain",
    edited=False,
    exclusion_reason=None,
    stratum="match-1",
):
    blind_truth = truth if blind_truth is None else blind_truth
    label = {
        "result": result,
        "table_u": truth[0] if truth else None,
        "table_v": truth[1] if truth else None,
        "confidence": confidence if truth else None,
        "visibility": "clear" if truth else None,
        "exclusion_reason": exclusion_reason,
        "blind_snapshot": {
            "result": result,
            "table_u": blind_truth[0] if blind_truth else None,
            "table_v": blind_truth[1] if blind_truth else None,
            "confidence": confidence if blind_truth else None,
            "visibility": "clear" if blind_truth else None,
        },
        "revealed_at": "2026-07-30T00:00:00Z",
        "post_reveal_edited": edited,
    }
    prediction = lambda value: (
        {"u": value[0], "v": value[1], "zone": "medium_left"}
        if value
        else None
    )
    return {
        "is_repeat": False,
        "duplicate_group": None,
        "human_label": label,
        "proposal": {
            "predictions": {
                "legacy_current": None,
                "canonical_current": prediction(canonical),
                "openai": prediction(openai),
            }
        },
        "stratum": stratum,
    }


class PlacementPilotScoringTests(unittest.TestCase):
    def test_scores_latest_landings_in_centimeters_and_reports_coverage(self):
        result = score_labels(
            [
                row(),
                row(canonical=None, openai=(0.6, 2.0)),
                row(result="not_visible", truth=None),
            ]
        )

        self.assertEqual(
            result["arms"]["canonical_current"]["coverage"],
            {"numerator": 1, "denominator": 2},
        )
        self.assertEqual(
            result["arms"]["openai"]["coverage"],
            {"numerator": 2, "denominator": 2},
        )
        self.assertEqual(
            result["arms"]["canonical_current"]["distance_cm"]["median"],
            10.0,
        )
        self.assertEqual(result["observability"]["not_visible"], 1)

    def test_latest_answer_overrides_blind_snapshot_and_edit_is_eligible(self):
        result = score_labels(
            [
                row(
                    truth=(0.8, 2.0),
                    blind_truth=(0.4, 2.0),
                    edited=True,
                ),
            ]
        )

        self.assertEqual(result["eligible_landings"], 1)
        self.assertEqual(
            result["arms"]["canonical_current"]["distance_cm"]["median"],
            30.0,
        )
        self.assertNotIn("post_reveal_edited", result["exclusions"])

    def test_unsure_answers_are_excluded(self):
        result = score_labels([row(confidence="unsure")])

        self.assertEqual(result["eligible_landings"], 0)
        self.assertEqual(result["exclusions"]["unsure"], 1)

    def test_excluded_sources_leave_every_denominator(self):
        result = score_labels(
            [
                row(
                    truth=None,
                    result="excluded",
                    exclusion_reason="not_a_point",
                )
            ]
        )

        self.assertEqual(result["eligible_landings"], 0)
        self.assertEqual(result["observability"], {})
        self.assertEqual(result["exclusions"]["not_a_point"], 1)
        self.assertEqual(
            result["arms"]["canonical_current"]["coverage"],
            {"numerator": 0, "denominator": 0},
        )


if __name__ == "__main__":
    unittest.main()
