import tempfile
import unittest
from pathlib import Path

from worker.score_temporal_serve_scale import (
    render_report,
    score_run,
    select_active_review,
    write_score_artifacts,
)


def run_fixture(
    *,
    correct=9,
    decided=9,
    eligible=10,
    chris_match_id="new-chris",
    complete=True,
):
    match_truth = {}
    match_predictions = {}
    point_rows = []
    for index in range(eligible):
        match_id = chris_match_id if index == 0 else f"match-{index}"
        truth = "near" if index % 2 == 0 else "far"
        match_truth[match_id] = truth
        if index < decided:
            predicted = truth if index < correct else (
                "far" if truth == "near" else "near"
            )
            match_predictions[match_id] = {
                "status": "high_confidence",
                "side": predicted,
                "confidence": 0.97,
            }
        else:
            match_predictions[match_id] = {
                "status": "withheld",
                "side": None,
                "confidence": 0.0,
            }
        point_rows.append(
            {
                "source_id": f"source-{index}",
                "match_id": match_id,
                "source_point_idx": 1,
                "temporal": {"near": 0.95, "far": 0.05, "onset_t": 1.0},
                "fused": match_predictions[match_id],
                "baseline": None,
                "evaluation": {"expected_server_side": truth},
            }
        )
    return {
        "schema_version": 1,
        "experiment": "temporal-serve-scale-v1",
        "manifest_sha256": "a" * 64,
        "manifest_status": "complete" if complete else "preliminary",
        "holdout_canaries": [chris_match_id],
        "match_truth": match_truth,
        "match_predictions": match_predictions,
        "predictions": {
            "train": [],
            "development": [],
            "holdout": point_rows,
        },
        "compute": {
            "points": eligible,
            "elapsed_s": 100.0,
            "inference_s": 80.0,
            "peak_rss_mb": 1200.0,
        },
    }


def case_fixtures(count):
    rows = []
    for index in range(count):
        truth = "near" if index % 2 == 0 else "far"
        predicted = "far" if index == 0 and truth == "near" else truth
        rows.append(
            {
                "source_id": f"case-{index}",
                "match_id": f"match-{index % 12}",
                "source_point_idx": index,
                "temporal": {"near": 0.96, "far": 0.04},
                "fused": {
                    "status": "high_confidence",
                    "side": predicted,
                    "confidence": 0.98,
                    "reason": "strong_temporal_evidence",
                },
                "evaluation": {"expected_server_side": truth},
            }
        )
    return rows


class ScoringTests(unittest.TestCase):
    def test_automatic_requires_precision_coverage_and_ten_decisions(self):
        score = score_run(run_fixture(correct=9, decided=9, eligible=10))
        self.assertEqual(score["recommendation"], "research_only")

    def test_first_server_metrics_ignore_train_and_development_matches(self):
        run = run_fixture(correct=9, decided=9, eligible=10)
        run["match_truth"]["train-only"] = "near"
        run["match_predictions"]["train-only"] = {
            "status": "high_confidence",
            "side": "far",
            "confidence": 0.99,
        }
        score = score_run(run)
        self.assertEqual(score["holdout"]["first_server"]["eligible"], 10)

    def test_automatic_gate_opens_only_for_complete_strong_holdout(self):
        score = score_run(run_fixture(correct=19, decided=19, eligible=20))
        self.assertEqual(score["recommendation"], "automatic")
        self.assertGreaterEqual(
            score["holdout"]["first_server"]["precision"], 0.95
        )

    def test_preliminary_cohort_never_advances(self):
        score = score_run(
            run_fixture(correct=20, decided=20, eligible=20, complete=False)
        )
        self.assertEqual(score["recommendation"], "research_only")
        self.assertTrue(score["preliminary"])

    def test_active_review_is_bounded_and_prioritizes_contradictions(self):
        selected = select_active_review(case_fixtures(100), limit=60)
        self.assertLessEqual(len(selected), 60)
        self.assertEqual(selected[0]["reason"], "confident_truth_contradiction")
        self.assertEqual(selected[0]["source_id"], "case-0")

    def test_report_names_chris_holdout_canary(self):
        score = score_run(run_fixture(chris_match_id="new-chris"))
        report = render_report(score)
        self.assertIn("new-chris", score["holdout_canaries"])
        self.assertIn("new-chris", report)

    def test_writes_machine_and_human_readable_artifacts(self):
        run = run_fixture()
        with tempfile.TemporaryDirectory() as directory:
            paths = write_score_artifacts(run, Path(directory))
            self.assertTrue(paths["score"].is_file())
            self.assertTrue(paths["report"].is_file())
            self.assertTrue(paths["active_review"].is_file())


if __name__ == "__main__":
    unittest.main()
