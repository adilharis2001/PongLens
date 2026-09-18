import copy
import unittest

from worker import placement_reconstruction as placement


def bounce(event_id, t, v, u=0.7, confidence=0.9):
    return {
        "id": event_id,
        "t": t,
        "kind": "bounce",
        "u": u,
        "v": v,
        "x": 100.0,
        "y": 100.0,
        "visual_confidence": confidence,
        "audio_confidence": 0.0,
    }


def contact(event_id, t, side, confidence=0.9):
    return {
        "id": event_id,
        "t": t,
        "kind": "contact",
        "side": side,
        "visual_confidence": confidence,
        "audio_confidence": 0.0,
    }


def hypothesis(server, first, landing, *, status="review", hard=None):
    return {
        "serverSide": server,
        "server_side": server,
        "status": status,
        "confidence": 0.69,
        "score": 1.0,
        "reasons": list(hard or []),
        "hard_reasons": list(hard or []),
        "shots": [{
            "id": "shot-1",
            "seq": 1,
            "phase": "serve",
            "hitter_side": server,
            "contact": None,
            "contact_t": None,
            "serve_first_bounce": first,
            "landing": landing,
            "terminal": None,
            "confidence": 0.25 if hard else 0.9,
        }],
        "used_event_ids": [
            event["event_id"]
            for event in (first, landing)
            if event is not None
        ],
    }


def reference(event):
    return {
        "event_id": event["id"],
        "id": event["id"],
        "t": event["t"],
        "u": event.get("u"),
        "v": event.get("v"),
        "confidence": event.get("visual_confidence", 0.9),
    }


class ReviewedSecondBounceRecoveryTests(unittest.TestCase):
    def test_chris_point_5_recovers_far_bounce_before_far_return(self):
        recovered = bounce("true-second", 39.0315, 2.3911, u=-0.0013)
        receiver_hit = contact("far-return", 39.2650, "far", 0.6243)
        late_first = bounce("late-first", 39.8655, 0.7190)
        late_second = bounce("late-second", 39.9990, 0.5688)
        current = hypothesis(
            "near",
            reference(late_first),
            reference(late_second),
            hard=["serve_second_bounce_on_server_half"],
        )

        result = placement.recover_second_bounce(
            current,
            [recovered, receiver_hit, late_first, late_second],
            "near",
            38.22,
        )

        self.assertEqual(result["status"], "ready")
        self.assertGreaterEqual(result["confidence"], 0.7)
        self.assertEqual(result["hard_reasons"], [])
        self.assertEqual(len(result["shots"]), 1)
        self.assertIsNone(result["shots"][0]["serve_first_bounce"])
        self.assertEqual(
            result["shots"][0]["landing"]["event_id"],
            "true-second",
        )
        self.assertIn("serve_first_bounce_missing", result["reasons"])

    def test_chris_point_14_replaces_later_legal_rally_pair(self):
        recovered = bounce("true-second", 130.3385, 2.4426, u=1.1208)
        receiver_hit = contact("far-return", 130.4720, "far")
        rally_near = bounce("rally-near", 130.9057, 0.5255, u=0.2898)
        rally_far = bounce("rally-far", 131.6062, 2.6741, u=0.5040)
        current = hypothesis(
            "near",
            reference(rally_near),
            reference(rally_far),
        )

        result = placement.recover_second_bounce(
            current,
            [recovered, receiver_hit, rally_near, rally_far],
            "near",
            129.19,
            suggestion={"n_hits": 5},
        )

        self.assertEqual(
            result["shots"][0]["landing"]["event_id"],
            "true-second",
        )
        self.assertEqual(result["used_event_ids"], ["true-second", "far-return"])

    def test_christine_point_30_stays_withheld_without_receiver_contact(self):
        occluded_candidate = bounce("wrong-ball", 465.4833, 0.7647, u=1.0296)
        current = hypothesis("far", None, None, status="unavailable")
        before = copy.deepcopy(current)

        result = placement.recover_second_bounce(
            current,
            [occluded_candidate],
            "far",
            464.59,
        )

        self.assertEqual(result, before)

    def test_service_error_without_receiver_half_bounce_stays_withheld(self):
        server_half_net_ball = bounce("net-ball", 184.947, 2.4349, u=1.3008)
        current = hypothesis("far", None, None, status="unavailable")
        before = copy.deepcopy(current)

        result = placement.recover_second_bounce(
            current,
            [server_half_net_ball],
            "far",
            184.11,
        )

        self.assertEqual(result, before)

    def test_existing_earlier_valid_landing_is_never_replaced(self):
        first = bounce("first", 10.5, 0.7)
        existing = bounce("existing-second", 10.9, 2.2)
        later = bounce("later-second", 11.0, 2.4)
        receiver_hit = contact("far-return", 11.15, "far")
        current = hypothesis(
            "near",
            reference(first),
            reference(existing),
            status="ready",
        )
        before = copy.deepcopy(current)

        result = placement.recover_second_bounce(
            current,
            [first, existing, later, receiver_hit],
            "near",
            10.0,
        )

        self.assertEqual(result, before)

    def test_single_hit_dead_play_does_not_become_a_ready_serve(self):
        passed_ball = bounce("passed-ball", 25.5340, 2.20)
        receiver_reversal = contact("far-reversal", 25.6673, "far")
        later_first = bounce("later-first", 26.0007, 0.18)
        later_second = bounce("later-second", 26.4674, 2.70)
        current = hypothesis(
            "near",
            reference(later_first),
            reference(later_second),
            status="review",
        )
        before = copy.deepcopy(current)

        result = placement.recover_second_bounce(
            current,
            [passed_ball, receiver_reversal, later_first, later_second],
            "near",
            24.69,
            suggestion={"n_hits": 1},
        )

        self.assertEqual(result, before)

    def test_ready_later_landing_is_not_replaced(self):
        recovered = bounce("earlier-bounce", 20.8, 2.2)
        receiver_hit = contact("far-return", 21.0, "far")
        later_first = bounce("later-first", 21.1, 0.4)
        later_second = bounce("later-second", 21.4, 2.4)
        current = hypothesis(
            "near",
            reference(later_first),
            reference(later_second),
            status="ready",
        )
        before = copy.deepcopy(current)

        result = placement.recover_second_bounce(
            current,
            [recovered, receiver_hit, later_first, later_second],
            "near",
            20.0,
            suggestion={"n_hits": 4},
        )

        self.assertEqual(result, before)


if __name__ == "__main__":
    unittest.main()
