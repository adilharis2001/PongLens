import unittest

from worker.serve_detection import (
    aggregate_first_server,
    expected_server,
    select_server_hypothesis,
)


def _hypothesis(
    side,
    score,
    *,
    status="ready",
    first_v=None,
    second_v=None,
    bounce_confidence=0.9,
    hard_reasons=None,
):
    if first_v is None:
        first_v = 0.7 if side == "near" else 2.05
    if second_v is None:
        second_v = 2.05 if side == "near" else 0.7
    return {
        "serverSide": side,
        "server_side": side,
        "status": status,
        "confidence": 0.9 if status == "ready" else 0.6,
        "score": score,
        "reasons": [],
        "hard_reasons": list(hard_reasons or []),
        "shots": [
            {
                "phase": "serve",
                "hitter_side": side,
                "contact": None,
                "serve_first_bounce": {
                    "event_id": f"{side}-bounce-1",
                    "t": 4.2,
                    "u": 0.75,
                    "v": first_v,
                    "confidence": bounce_confidence,
                },
                "landing": {
                    "event_id": f"{side}-bounce-2",
                    "t": 4.55,
                    "u": 0.8,
                    "v": second_v,
                    "confidence": bounce_confidence,
                },
                "confidence": 0.9,
            },
            {
                "phase": "rally",
                "hitter_side": "far" if side == "near" else "near",
                "contact": {
                    "event_id": f"{side}-return",
                    "t": 4.75,
                    "confidence": 0.8,
                },
                "landing": {
                    "event_id": f"{side}-rally-bounce",
                    "t": 5.05,
                    "u": 0.6,
                    "v": first_v,
                    "confidence": 0.8,
                },
                "confidence": 0.8,
            },
        ],
        "used_event_ids": [],
    }


def _reconstruction(
    near_score,
    far_score,
    *,
    near=None,
    far=None,
    candidates=None,
):
    return {
        "v": 3,
        "status": "ready",
        "candidates": candidates
        or [
            {
                "id": "serve-contact",
                "kind": "contact",
                "t": 4.0,
                "side": "near",
                "visual_confidence": 0.8,
                "audio_confidence": 0.7,
            }
        ],
        "hypotheses": {
            "near": near or _hypothesis("near", near_score),
            "far": far or _hypothesis("far", far_score),
        },
    }


class SelectorTests(unittest.TestCase):
    def test_selects_clear_two_bounce_server_hypothesis(self):
        result = select_server_hypothesis(_reconstruction(7.2, 2.1))

        self.assertEqual(result["server_side"], "near")
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["serve"]["first_bounce"]["v"], 0.7)
        self.assertEqual(result["serve"]["second_bounce"]["v"], 2.05)
        self.assertEqual(result["serve"]["contact_t"], 4.0)

    def test_withholds_close_hypotheses(self):
        result = select_server_hypothesis(_reconstruction(6.1, 5.8))

        self.assertIsNone(result["server_side"])
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["reason"], "hypothesis_margin_too_small")

    def test_withholds_same_half_serve_bounces(self):
        near = _hypothesis("near", 8.0, second_v=0.95)
        result = select_server_hypothesis(
            _reconstruction(8.0, 2.0, near=near)
        )

        self.assertIsNone(result["server_side"])
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["reason"], "selected_serve_geometry_invalid")

    def test_withholds_low_confidence_bounces(self):
        near = _hypothesis("near", 8.0, bounce_confidence=0.2)
        result = select_server_hypothesis(
            _reconstruction(8.0, 2.0, near=near)
        )

        self.assertIsNone(result["server_side"])
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["reason"], "selected_bounce_evidence_weak")

    def test_contact_prefers_latest_supported_event_before_first_bounce(self):
        candidates = [
            {
                "id": "walking-noise",
                "kind": "impact",
                "t": 1.0,
                "audio_confidence": 4.0,
            },
            {
                "id": "serve-contact",
                "kind": "contact",
                "t": 4.05,
                "side": "near",
                "visual_confidence": 0.85,
                "audio_confidence": 0.6,
            },
        ]

        result = select_server_hypothesis(
            _reconstruction(7.2, 2.1, candidates=candidates)
        )

        self.assertEqual(result["serve"]["contact_t"], 4.05)


class RotationTests(unittest.TestCase):
    def test_expected_server_switches_every_two_points_before_deuce(self):
        self.assertEqual(expected_server("near", 1, 0), "near")
        self.assertEqual(expected_server("near", 1, 1), "near")
        self.assertEqual(expected_server("near", 1, 2), "far")
        self.assertEqual(expected_server("near", 1, 3), "far")

    def test_expected_server_switches_every_point_at_deuce(self):
        self.assertEqual(expected_server("near", 1, 20), "near")
        self.assertEqual(expected_server("near", 1, 21), "far")
        self.assertEqual(expected_server("near", 1, 22), "near")

    def test_first_server_alternates_between_games(self):
        self.assertEqual(expected_server("near", 1, 0), "near")
        self.assertEqual(expected_server("near", 2, 0), "far")
        self.assertEqual(expected_server("near", 3, 0), "near")

    def test_aggregate_uses_every_high_confidence_call(self):
        calls = [
            {
                "idx": 1,
                "game_number": 1,
                "points_played": 0,
                "server_side": "near",
                "status": "high_confidence",
            },
            {
                "idx": 2,
                "game_number": 1,
                "points_played": 1,
                "server_side": "near",
                "status": "high_confidence",
            },
            {
                "idx": 3,
                "game_number": 1,
                "points_played": 2,
                "server_side": "far",
                "status": "high_confidence",
            },
        ]

        result = aggregate_first_server(calls)

        self.assertEqual(result["side"], "near")
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["votes"], {"near": 3, "far": 0})
        self.assertEqual(result["usable_points"], [1, 2, 3])

    def test_aggregate_withholds_a_one_vote_margin(self):
        calls = [
            {
                "idx": 1,
                "game_number": 1,
                "points_played": 0,
                "server_side": "near",
                "status": "high_confidence",
            },
            {
                "idx": 2,
                "game_number": 1,
                "points_played": 2,
                "server_side": "near",
                "status": "high_confidence",
            },
            {
                "idx": 3,
                "game_number": 1,
                "points_played": 4,
                "server_side": "near",
                "status": "high_confidence",
            },
        ]

        result = aggregate_first_server(calls)

        self.assertIsNone(result["side"])
        self.assertEqual(result["status"], "withheld")
        self.assertEqual(result["votes"], {"near": 2, "far": 1})


if __name__ == "__main__":
    unittest.main()
