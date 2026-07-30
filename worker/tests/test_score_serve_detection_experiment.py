import json
import tempfile
import unittest
from pathlib import Path

from worker.eval.score_serve_detection_experiment import (
    contact_is_correct,
    evaluate_gates,
    freeze_reference_hash,
    score_points,
    wilson_interval,
)


def _prediction(
    key,
    *,
    side=None,
    status="needs_review",
    contact_t=None,
):
    return {
        "point_key": key,
        "status": status,
        "server_side": side,
        "serve": {"contact_t": contact_t},
    }


def _reference(
    key,
    *,
    side="near",
    visibility="observable",
    contact_t=4.2,
    hard_negatives=None,
):
    return {
        "point_key": key,
        "serve_contact_t": contact_t,
        "server_side": side,
        "visibility": visibility,
        "first_bounce_visible": True,
        "second_bounce_visible": True,
        "hard_negatives": list(hard_negatives or []),
        "note": "",
    }


class MetricTests(unittest.TestCase):
    def test_abstention_reduces_coverage_not_precision(self):
        predictions = [
            _prediction(
                "p1",
                side="near",
                status="high_confidence",
                contact_t=4.2,
            ),
            _prediction("p2"),
        ]
        references = [
            _reference("p1", side="near"),
            _reference("p2", side="far"),
        ]

        metrics = score_points(predictions, references)

        self.assertEqual(metrics["precision"], 1.0)
        self.assertEqual(metrics["coverage"], 0.5)
        self.assertEqual(metrics["automated"], 1)
        self.assertEqual(metrics["observable"], 2)

    def test_unobservable_points_are_excluded_from_denominator(self):
        predictions = [_prediction("p1")]
        references = [
            _reference(
                "p1",
                side=None,
                visibility="serve_missing",
                contact_t=None,
            )
        ]

        metrics = score_points(predictions, references)

        self.assertEqual(metrics["observable"], 0)
        self.assertIsNone(metrics["precision"])
        self.assertIsNone(metrics["coverage"])

    def test_wrong_confident_side_reduces_precision(self):
        predictions = [
            _prediction(
                "p1",
                side="near",
                status="high_confidence",
                contact_t=4.2,
            ),
            _prediction(
                "p2",
                side="near",
                status="high_confidence",
                contact_t=4.2,
            ),
        ]
        references = [
            _reference("p1", side="near"),
            _reference("p2", side="far"),
        ]

        metrics = score_points(predictions, references)

        self.assertEqual(metrics["precision"], 0.5)
        self.assertEqual(metrics["correct"], 1)

    def test_hard_negative_false_selection_requires_wrong_event(self):
        predictions = [
            _prediction(
                "p1",
                side="near",
                status="high_confidence",
                contact_t=1.0,
            )
        ]
        references = [
            _reference(
                "p1",
                side="near",
                contact_t=4.2,
                hard_negatives=["ball_pass"],
            )
        ]

        metrics = score_points(predictions, references)

        self.assertEqual(metrics["hard_negative_false_selections"], 1)

    def test_contact_is_correct_within_four_hundred_ms(self):
        self.assertTrue(contact_is_correct(4.20, 4.59))
        self.assertFalse(contact_is_correct(4.20, 4.61))
        self.assertFalse(contact_is_correct(None, 4.2))

    def test_wilson_interval_contains_the_point_estimate(self):
        low, high = wilson_interval(98, 100)

        self.assertLess(low, 0.98)
        self.assertGreater(high, 0.98)


class GateTests(unittest.TestCase):
    def test_all_high_precision_gates_can_pass(self):
        gates = evaluate_gates(
            {
                "precision": 0.99,
                "coverage": 0.65,
                "hard_negative_false_selections": 0,
            },
            {
                "decided_matches": 6,
                "correct_matches": 6,
                "accuracy": 1.0,
            },
            {
                "quiet": {"count": 30, "precision": 1.0},
                "noisy": {"count": 20, "precision": 0.95},
            },
        )

        self.assertTrue(all(gate["status"] == "passed" for gate in gates))

    def test_small_match_sample_is_unproven(self):
        gates = evaluate_gates(
            {
                "precision": 1.0,
                "coverage": 1.0,
                "hard_negative_false_selections": 0,
            },
            {
                "decided_matches": 4,
                "correct_matches": 4,
                "accuracy": 1.0,
            },
            {},
        )

        first_server = next(
            gate for gate in gates if gate["name"] == "first_server_accuracy"
        )
        self.assertEqual(first_server["status"], "unproven")


class ReferenceLockTests(unittest.TestCase):
    def test_reference_lock_rejects_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            references_path = root / "references.json"
            lock_path = root / "reference-lock.json"
            references_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "prediction_sha256": "a" * 64,
                        "points": [_reference("p1")],
                    }
                )
            )

            first = freeze_reference_hash(references_path, lock_path)
            changed = json.loads(references_path.read_text())
            changed["points"][0]["server_side"] = "far"
            references_path.write_text(json.dumps(changed))

            with self.assertRaisesRegex(ValueError, "references changed"):
                freeze_reference_hash(references_path, lock_path)
            self.assertEqual(
                json.loads(lock_path.read_text())["sha256"],
                first,
            )


if __name__ == "__main__":
    unittest.main()
