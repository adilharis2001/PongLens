import unittest

from worker.score_placement_calibration_pilot import score_labels


def row(
    *,
    truth=(0.4, 2.0),
    canonical=(0.5, 2.0),
    openai=(0.4, 2.1),
    result="landed",
    confidence="certain",
    edited=False,
    stratum="match-1",
):
    label = {
        "result": result,
        "table_u": truth[0] if truth else None,
        "table_v": truth[1] if truth else None,
        "confidence": confidence if truth else None,
        "blind_snapshot": {
            "result": result,
            "table_u": truth[0] if truth else None,
            "table_v": truth[1] if truth else None,
            "confidence": confidence if truth else None,
            "visibility": "clear" if truth else None,
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
    def test_scores_blind_landings_in_centimeters_and_reports_coverage(self):
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

    def test_post_reveal_edits_and_unsure_answers_are_excluded(self):
        result = score_labels(
            [
                row(edited=True),
                row(confidence="unsure"),
            ]
        )

        self.assertEqual(result["eligible_blind_landings"], 0)
        self.assertEqual(result["exclusions"]["post_reveal_edited"], 1)
        self.assertEqual(result["exclusions"]["unsure"], 1)


if __name__ == "__main__":
    unittest.main()
