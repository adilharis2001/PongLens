"""Behavioral contract for private predictions; no scores enter these helpers."""
import json
import tempfile
import unittest
from pathlib import Path

import point_winner_predictions as predictions


POINTS = [{"idx": 7, "t0": 10.12, "t1": 15.35}, {"idx": 8, "t0": 20.0, "t1": 26.0}]


def call(idx=7, **changes):
    value = {"idx": idx, "method": "net_low_bounces", "method_version": "net-endings-v1",
             "status": "predicted", "winner_side": "far", "reason": "terminal_net_sequence",
             "evaluated_t0": 10.123, "evaluated_t1": 15.349,
             "evidence": {"confirming_bounce_s": 14.3}}
    value.update(changes)
    return value


class PredictionContractTests(unittest.TestCase):
    def read(self, document, points=POINTS):
        with tempfile.TemporaryDirectory() as root:
            if document is not None:
                Path(root, "point_winner_predictions.json").write_text(json.dumps(document))
            return predictions.load_predictions(root, points)

    def test_missing_sidecar_records_each_unevaluated_card_without_guess(self):
        rows = self.read(None)
        self.assertEqual([r["idx"] for r in rows], [7, 8])
        self.assertEqual([(r["status"], r["winner_side"], r["reason"]) for r in rows],
                         [("abstained", None, "method_unavailable")] * 2)

    def test_valid_prediction_preserves_physical_side_and_unrounded_evidence(self):
        rows = self.read({"schema_version": 1, "points": [call(), call(8, status="abstained", winner_side=None,
                        reason="no_terminal_net_sequence", evaluated_t0=20, evaluated_t1=26)]})
        self.assertEqual(rows[0]["winner_side"], "far")
        self.assertEqual(rows[0]["evaluated_t0"], 10.123)
        self.assertEqual(rows[0]["published_t0"], 10.12)
        self.assertEqual(rows[0]["published_t1"], 15.35)

    def test_bad_or_incomplete_sidecar_never_silently_assigns_a_winner(self):
        documents = [
            {"schema_version": 99, "points": [call()]},
            {"schema_version": 1, "points": [call(), call()]},
            {"schema_version": 1, "points": [call(status="abstained")]},
            {"schema_version": 1, "points": [call(winner_side="user")]},
            {"schema_version": 1, "points": [call(evaluated_t0=float("nan"))]},
            {"schema_version": 1, "points": [call(evaluated_t1=40)]},
            {"schema_version": 1, "points": [call(evidence={"bad": float("inf")})]},
        ]
        for document in documents:
            with self.subTest(document=document):
                with self.assertLogs(predictions.log, level="WARNING"):
                    rows = self.read(document, [POINTS[0]])
                self.assertEqual([(r["status"], r["winner_side"]) for r in rows], [("error", None)])

    def test_unknown_point_or_missing_point_invalidates_batch(self):
        for calls in ([call()], [call(), call(9)]):
            with self.assertLogs(predictions.log, level="WARNING"):
                rows = self.read({"schema_version": 1, "points": calls})
            self.assertTrue(all(r["status"] == "error" for r in rows))

    def test_prediction_evidence_is_independent_of_legacy_and_user_fields(self):
        points = [dict(POINTS[0], confirmed_winner="user", suggestion={"winner": "user"})]
        row = self.read({"schema_version": 1, "points": [call()]}, points)[0]
        self.assertEqual(row["winner_side"], "far")
        self.assertNotIn("confirmed_winner", row)


if __name__ == "__main__":
    unittest.main()
