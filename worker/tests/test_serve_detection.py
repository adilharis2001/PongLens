import unittest

from worker.serve_detection import select_server_hypothesis


def _hypothesis(
    side: str,
    *,
    score: float,
    first_v: float,
    second_v: float,
    hard_reasons: list[str] | None = None,
) -> dict:
    return {
        "server_side": side,
        "score": score,
        "status": "ready",
        "reasons": [],
        "hard_reasons": hard_reasons or [],
        "shots": [
            {
                "phase": "serve",
                "serve_first_bounce": {
                    "t": 1.2,
                    "v": first_v,
                    "confidence": 0.82,
                },
                "landing": {
                    "t": 1.55,
                    "v": second_v,
                    "confidence": 0.76,
                },
            }
        ],
    }


def valid_near_fixture(
    *,
    near_score: float = 6.4,
    far_score: float = 3.9,
) -> dict:
    return {
        "hypotheses": {
            "near": _hypothesis(
                "near",
                score=near_score,
                first_v=0.7,
                second_v=2.1,
            ),
            "far": _hypothesis(
                "far",
                score=far_score,
                first_v=2.1,
                second_v=0.7,
            ),
        },
        "candidates": [
            {
                "kind": "impact",
                "t": 0.88,
                "side": "far",
                "visual_confidence": 0.3,
                "audio_confidence": 0.2,
            },
            {
                "kind": "contact",
                "t": 1.02,
                "side": "near",
                "visual_confidence": 0.9,
                "audio_confidence": 0.8,
            },
        ],
    }


class ServeDetectionTest(unittest.TestCase):
    def test_selects_only_a_separated_legal_serve(self) -> None:
        result = select_server_hypothesis(valid_near_fixture())

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["server_side"], "near")
        self.assertEqual(result["serve"]["contact_t"], 1.02)
        self.assertEqual(result["serve"]["first_bounce"]["t"], 1.2)
        self.assertEqual(result["serve"]["second_bounce"]["t"], 1.55)
        self.assertGreater(result["confidence"], 0.8)

    def test_withholds_close_hypotheses(self) -> None:
        result = select_server_hypothesis(
            valid_near_fixture(near_score=6.0, far_score=5.0)
        )

        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["server_side"])
        self.assertEqual(result["reason"], "hypothesis_margin_too_small")

    def test_withholds_same_half_bounce_geometry(self) -> None:
        fixture = valid_near_fixture()
        fixture["hypotheses"]["near"]["shots"][0]["landing"]["v"] = 0.9

        result = select_server_hypothesis(fixture)

        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["reason"], "selected_serve_geometry_invalid")

    def test_requires_both_physical_server_hypotheses(self) -> None:
        fixture = valid_near_fixture()
        del fixture["hypotheses"]["far"]

        result = select_server_hypothesis(fixture)

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "both_server_hypotheses_required")

    def test_withholds_hard_contradictions(self) -> None:
        fixture = valid_near_fixture()
        fixture["hypotheses"]["near"]["hard_reasons"] = ["bounce_before_contact"]

        result = select_server_hypothesis(fixture)

        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(
            result["reason"],
            "selected_hypothesis_has_hard_contradiction",
        )

    def test_ignores_unrelated_match_truth_fields(self) -> None:
        fixture = valid_near_fixture()
        first = select_server_hypothesis(fixture)
        fixture["first_server"] = "opponent"
        fixture["winner"] = "user"
        fixture["scored_server"] = "far"

        self.assertEqual(select_server_hypothesis(fixture), first)


if __name__ == "__main__":
    unittest.main()
