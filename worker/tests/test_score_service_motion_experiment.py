import collections
import unittest

from worker.score_service_motion_experiment import (
    choose_onset_review_subset,
    leave_one_match_out,
    score_experiment,
)


def case(
    source_id,
    match,
    predicted,
    truth,
    *,
    confidence=0.98,
    stratum="visible",
):
    return {
        "source_id": source_id,
        "source_match_id": match,
        "stratum": stratum,
        "oracle_motion": {
            "status": "high_confidence" if predicted else "withheld",
            "side": predicted,
            "confidence": confidence if predicted else 0.0,
            "onset_t": 0.4,
            "contact_t": 0.9,
        },
        "detected_motion": {
            "status": "high_confidence" if predicted else "withheld",
            "side": predicted,
            "confidence": confidence if predicted else 0.0,
            "onset_t": 0.4,
            "contact_t": 0.9,
            "first_bounce": {"t": 1.0},
            "second_bounce": {"t": 1.4},
        },
        "evaluation": {
            "scored_server_side": truth,
            "first_bounce": {"status": "exact", "time_s": 1.0},
            "serve_contact_s": 0.9,
            "no_observable_serve": None,
        },
    }


def export_for(cases):
    return {
        "batch": {"slug": "serve-detection-cross-match-v1"},
        "assignments": [
            {
                "source_id": item["source_id"],
                "source_match_id": item["source_match_id"],
                "gold": {
                    "scored_server_side": item["evaluation"][
                        "scored_server_side"
                    ]
                },
                "human_label": {
                    "actual_serve_contact_s": item["evaluation"][
                        "serve_contact_s"
                    ],
                    "no_observable_serve": item["evaluation"][
                        "no_observable_serve"
                    ],
                    "followup": {
                        "first_bounce": item["evaluation"]["first_bounce"],
                    },
                },
            }
            for item in cases
        ],
    }


class MetricTests(unittest.TestCase):
    def test_precision_coverage_abstention_and_worst_match(self):
        cases = [
            case("a", "m1", "near", "near"),
            case("b", "m1", "far", "near"),
            case("c", "m2", None, "far"),
            case("d", "m2", "far", "far"),
        ]
        score = score_experiment({"cases": cases}, export_for(cases))
        automatic = score["automatic"]

        self.assertEqual(automatic["eligible"], 4)
        self.assertEqual(automatic["decided"], 3)
        self.assertEqual(automatic["correct"], 2)
        self.assertAlmostEqual(automatic["precision"], 2 / 3)
        self.assertEqual(automatic["coverage"], 0.75)
        self.assertEqual(automatic["abstention"], 0.25)
        self.assertEqual(automatic["worst_match_precision"], 0.5)

    def test_oracle_and_automatic_metrics_are_separate(self):
        cases = [case("a", "m1", "far", "near")]
        cases[0]["oracle_motion"]["side"] = "near"
        score = score_experiment({"cases": cases}, export_for(cases))

        self.assertEqual(score["oracle"]["precision"], 1.0)
        self.assertEqual(score["automatic"]["precision"], 0.0)

    def test_production_gate_uses_frozen_boundaries(self):
        cases = [
            case(f"a{i}", "m1", "near", "near") for i in range(20)
        ]
        score = score_experiment({"cases": cases}, export_for(cases))
        self.assertEqual(score["recommendation"], "automatic")

        for item in cases[-2:]:
            item["detected_motion"]["side"] = "far"
        score = score_experiment({"cases": cases}, export_for(cases))
        self.assertEqual(score["recommendation"], "prefill_only")

        for item in cases[-3:]:
            item["detected_motion"]["side"] = "far"
        score = score_experiment({"cases": cases}, export_for(cases))
        self.assertEqual(score["recommendation"], "research_only")


class LeaveOneMatchOutTests(unittest.TestCase):
    def test_threshold_is_fit_without_held_out_match(self):
        cases = [
            case("a", "vaibhav", "near", "near", confidence=0.95),
            case("b", "gui", "far", "near", confidence=0.80),
            case("c", "chris", "far", "far", confidence=0.90),
        ]
        result = leave_one_match_out(cases, [0.8, 0.9, 0.95])
        gui = result["folds"]["gui"]

        self.assertEqual(gui["threshold"], 0.9)
        self.assertEqual(gui["test"]["decided"], 0)


class OnsetSelectionTests(unittest.TestCase):
    def test_selects_exact_stable_balanced_twenty(self):
        cases = []
        for index in range(40):
            stratum = (
                "prior_wrong_server"
                if index < 8
                else "occluded"
                if index < 24
                else "visible"
            )
            cases.append(
                case(
                    f"source-{index:02d}",
                    f"match-{index % 5}",
                    "near",
                    "near",
                    stratum=stratum,
                )
            )

        selected = choose_onset_review_subset(cases)

        self.assertEqual(len(selected), 20)
        self.assertEqual(
            len({item["source_id"] for item in selected}),
            20,
        )
        self.assertEqual(
            collections.Counter(item["stratum"] for item in selected),
            {
                "visible": 8,
                "occluded": 8,
                "prior_wrong_server": 4,
            },
        )
        self.assertEqual(
            [item["source_id"] for item in selected],
            [
                item["source_id"]
                for item in choose_onset_review_subset(reversed(cases))
            ],
        )


if __name__ == "__main__":
    unittest.main()
