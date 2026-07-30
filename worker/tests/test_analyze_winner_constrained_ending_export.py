import unittest

from worker.analyze_winner_constrained_ending_export import analyze_export


def assignment(
    truth,
    without,
    with_boundary=None,
    *,
    truth_contacts=3,
    predicted_contacts=3,
    server_review="correct",
    corrected_server=None,
    winner_review="correct",
    corrected_winner=None,
):
    return {
        "status": "submitted",
        "human_label": {
            "ending_family": truth,
            "contact_count": truth_contacts,
            "final_hitter": "receiver",
            "attempted_return": "yes",
            "server_review": server_review,
            "corrected_server": corrected_server,
            "winner_review": winner_review,
            "corrected_winner": corrected_winner,
        },
        "gold": {
            "source": {"match_key": "vaibhav"},
            "predictions": {
                "without_serve_boundary": {
                    "ending_family": without,
                    "contact_count": predicted_contacts,
                    "final_hitter": "opponent",
                    "attempted_return": True,
                    "status": (
                        "abstained" if without == "unsure" else "predicted"
                    ),
                },
                "with_detected_serve_boundary": (
                    {"available": False}
                    if with_boundary is None
                    else {
                        "available": True,
                        "result": {
                            "ending_family": with_boundary,
                            "contact_count": truth_contacts,
                            "status": "predicted",
                        },
                    }
                ),
            },
        },
    }


class EndingExportAnalysisTests(unittest.TestCase):
    def test_reports_coverage_accuracy_confusion_and_contacts(self):
        export = {
            "assignments": [
                assignment("net", "net"),
                assignment(
                    "long",
                    "net",
                    truth_contacts=4,
                    predicted_contacts=2,
                ),
                assignment("wide", "unsure"),
            ]
        }

        metrics = analyze_export(export)
        plain = metrics["without_serve_boundary"]

        self.assertEqual(metrics["labels"]["submitted"], 3)
        self.assertAlmostEqual(plain["coverage"], 2 / 3)
        self.assertAlmostEqual(plain["covered_accuracy"], 0.5)
        self.assertEqual(plain["confusion"]["long"]["net"], 1)
        self.assertAlmostEqual(plain["contact_mae"], 2 / 3)
        self.assertAlmostEqual(plain["net_precision"], 0.5)
        self.assertEqual(plain["net_recall"], 1.0)

    def test_paired_boundary_comparison_uses_only_available_pairs(self):
        export = {
            "assignments": [
                assignment("net", "long", "net"),
                assignment("wide", "wide", None),
            ]
        }

        paired = analyze_export(export)["serve_boundary_paired"]

        self.assertEqual(paired["pair_count"], 1)
        self.assertEqual(paired["without_exact"], 0)
        self.assertEqual(paired["with_exact"], 1)
        self.assertEqual(paired["net_improvement"], 1)

    def test_unsubmitted_and_missing_labels_do_not_enter_truth(self):
        row = assignment("net", "net")
        row["status"] = "in_progress"

        metrics = analyze_export({"assignments": [row]})

        self.assertEqual(metrics["labels"]["submitted"], 0)
        self.assertEqual(metrics["without_serve_boundary"]["point_count"], 0)

    def test_server_corrections_are_reported_and_excluded_from_compatible_metrics(self):
        export = {
            "assignments": [
                assignment("net", "net", server_review="correct"),
                assignment(
                    "long",
                    "net",
                    server_review="corrected",
                    corrected_server="user",
                ),
                assignment("wide", "wide", server_review="unsure"),
            ]
        }

        metrics = analyze_export(export)

        self.assertEqual(metrics["server_review"]["correct"], 1)
        self.assertEqual(metrics["server_review"]["corrected"], 1)
        self.assertEqual(metrics["server_review"]["unsure"], 1)
        self.assertAlmostEqual(metrics["server_review"]["correction_rate"], 0.5)
        self.assertEqual(
            metrics["scoring_compatible"]["without_serve_boundary"]["point_count"],
            1,
        )
        self.assertEqual(
            metrics["scoring_compatible"][
                "excluded_wrong_or_uncertain_scoring_context"
            ],
            2,
        )

    def test_winner_corrections_are_reported_and_excluded_from_compatible_metrics(self):
        export = {
            "assignments": [
                assignment("net", "net", winner_review="correct"),
                assignment(
                    "long",
                    "net",
                    winner_review="corrected",
                    corrected_winner="opponent",
                ),
                assignment("wide", "wide", winner_review="unsure"),
                assignment("net", "net", winner_review=None),
            ]
        }

        metrics = analyze_export(export)

        self.assertEqual(metrics["winner_review"]["correct"], 1)
        self.assertEqual(metrics["winner_review"]["corrected"], 1)
        self.assertEqual(metrics["winner_review"]["unsure"], 1)
        self.assertEqual(metrics["winner_review"]["unreviewed"], 1)
        self.assertAlmostEqual(metrics["winner_review"]["correction_rate"], 0.5)
        self.assertEqual(
            metrics["scoring_compatible"]["without_serve_boundary"]["point_count"],
            1,
        )
        self.assertEqual(
            metrics["scoring_compatible"][
                "excluded_wrong_or_uncertain_scoring_context"
            ],
            3,
        )


if __name__ == "__main__":
    unittest.main()
