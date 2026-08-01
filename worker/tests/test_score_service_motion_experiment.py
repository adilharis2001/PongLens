import collections
import unittest

from worker.score_service_motion_experiment import (
    choose_onset_review_subset,
    leave_one_match_out,
    render_markdown_report,
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


def stage_c_fixture(
    *,
    wrong_match=None,
    withheld_match=None,
    match_count=5,
    point_correct=50,
    point_decided=50,
):
    truth = {}
    decoders = {}
    for index in range(match_count):
        match_id = f"m{index + 1}"
        expected = "near" if index % 2 == 0 else "far"
        truth[match_id] = expected
        predicted = (
            ("far" if expected == "near" else "near")
            if match_id == wrong_match
            else expected
        )
        decoders[match_id] = (
            {
                "status": "withheld",
                "side": None,
                "confidence": 0.0,
                "alignment": None,
            }
            if match_id == withheld_match
            else {
                "status": "high_confidence",
                "side": predicted,
                "confidence": 0.98,
                "alignment": {"missing_points": 0},
            }
        )
    return {
        "status": "completed",
        "truth": truth,
        "decoders": decoders,
        "point_metrics": {
            "eligible": 50,
            "decided": point_decided,
            "correct": point_correct,
            "precision": (
                point_correct / point_decided if point_decided else 0.0
            ),
            "coverage": point_decided / 50,
        },
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

    def test_completed_onset_metrics_are_preserved_in_final_score(self):
        cases = [case("a", "m1", "near", "near")]
        onset = {
            "eligible": 17,
            "frozen_v1": {"mae_s": 0.2668},
            "backtracked_v2": {"mae_s": 0.18},
        }

        score = score_experiment(
            {"cases": cases, "onset_development": onset},
            export_for(cases),
        )

        self.assertEqual(score["onset_development"], onset)
        self.assertEqual(score["timing"]["onset_accuracy_status"], "completed")

    def test_production_gate_uses_frozen_boundaries(self):
        cases = [
            case(f"a{i}", "m1", "near", "near") for i in range(20)
        ]
        score = score_experiment(
            {"cases": cases, "stage_c": stage_c_fixture()},
            export_for(cases),
        )
        self.assertEqual(score["recommendation"], "automatic")

        score = score_experiment(
            {
                "cases": cases,
                "stage_c": stage_c_fixture(
                    match_count=10,
                    wrong_match="m10",
                    point_correct=46,
                ),
            },
            export_for(cases),
        )
        self.assertEqual(score["recommendation"], "prefill_only")

        score = score_experiment(
            {
                "cases": cases,
                "stage_c": stage_c_fixture(
                    match_count=10,
                    wrong_match="m9",
                    point_correct=44,
                ),
            },
            export_for(cases),
        )
        self.assertEqual(score["recommendation"], "research_only")

    def test_report_identifies_held_out_point_precision_and_coverage(self):
        cases = [case("a", "m1", "near", "near")]
        score = score_experiment(
            {
                "cases": cases,
                "stage_c": {
                    **stage_c_fixture(),
                    "point_metrics": {
                        "eligible": 50,
                        "decided": 9,
                        "correct": 7,
                        "precision": 7 / 9,
                        "coverage": 9 / 50,
                    },
                },
            },
            export_for(cases),
        )

        report = render_markdown_report(score)

        self.assertIn("Held-out point calls: 7/9 correct", report)
        self.assertIn("coverage 18.0%", report)

    def test_first_server_metrics_include_decision_latency_and_skip_robustness(
        self,
    ):
        cases = [case("a", "m1", "near", "near")]
        calls = [
            {
                "idx": index,
                "position": index - 1,
                "status": "high_confidence",
                "side": side,
                "confidence": 0.98,
            }
            for index, side in enumerate(
                ["near", "near", "far", "far", "near"],
                start=1,
            )
        ]
        stage_c = {
            "status": "completed",
            "truth": {"m1": "near"},
            "point_calls": {"m1": calls},
            "decoders": {
                "m1": {
                    "status": "high_confidence",
                    "side": "near",
                    "confidence": 0.98,
                    "alignment": {"missing_points": 0},
                }
            },
            "point_metrics": {
                "eligible": 5,
                "decided": 5,
                "correct": 5,
                "precision": 1.0,
                "coverage": 1.0,
            },
        }

        score = score_experiment(
            {"cases": cases, "stage_c": stage_c},
            export_for(cases),
        )

        self.assertEqual(
            score["first_server"]["per_match"]["m1"]["points_required"],
            3,
        )
        robustness = score["first_server"]["skipped_point_robustness"]
        self.assertEqual(robustness["eligible"], 5)
        self.assertGreaterEqual(robustness["correct"], 4)
        self.assertIn("Skipped-point robustness", render_markdown_report(score))

    def test_production_gate_requires_scored_first_server_results(self):
        cases = [
            case(f"a{i}", "m1", "near", "near") for i in range(20)
        ]

        missing = score_experiment({"cases": cases}, export_for(cases))
        wrong = score_experiment(
            {
                "cases": cases,
                "stage_c": stage_c_fixture(wrong_match="m2"),
            },
            export_for(cases),
        )

        self.assertEqual(missing["recommendation"], "research_only")
        self.assertEqual(wrong["recommendation"], "research_only")
        self.assertEqual(wrong["first_server"]["decided"], 5)
        self.assertEqual(wrong["first_server"]["correct"], 4)
        self.assertEqual(wrong["first_server"]["precision"], 0.8)

    def test_prefill_gate_requires_five_decided_holdout_matches(self):
        cases = [
            case(f"a{i}", "m1", "near", "near") for i in range(20)
        ]

        score = score_experiment(
            {
                "cases": cases,
                "stage_c": stage_c_fixture(
                    match_count=5,
                    withheld_match="m5",
                ),
            },
            export_for(cases),
        )

        self.assertEqual(score["first_server"]["precision"], 1.0)
        self.assertEqual(score["first_server"]["decided"], 4)
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
    def test_selects_only_reviewable_onsets_in_a_stable_cohort(self):
        cases = []
        for index in range(30):
            stratum = (
                "prior_wrong_server"
                if index < 2
                else "occluded"
                if index < 26
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
        cases[0]["oracle_motion"]["status"] = "withheld"
        cases[0]["oracle_motion"]["onset_t"] = None
        for index in range(2, 14):
            cases[index]["oracle_motion"]["status"] = "withheld"
            cases[index]["oracle_motion"]["onset_t"] = None

        selected = choose_onset_review_subset(cases)

        self.assertEqual(len(selected), 17)
        self.assertEqual(
            len({item["source_id"] for item in selected}),
            17,
        )
        self.assertEqual(
            collections.Counter(item["stratum"] for item in selected),
            {
                "visible": 4,
                "occluded": 12,
                "prior_wrong_server": 1,
            },
        )
        self.assertTrue(
            all(item["proposal"]["onset_t"] is not None for item in selected)
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
