import unittest

from worker.analyze_winner_constrained_ending_export import analyze_export


def assignment(
    truth,
    without,
    with_boundary=None,
    *,
    truth_contacts=3,
    predicted_contacts=3,
):
    return {
        "status": "submitted",
        "human_label": {
            "ending_family": truth,
            "contact_count": truth_contacts,
            "final_hitter": "receiver",
            "attempted_return": "yes",
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


if __name__ == "__main__":
    unittest.main()
