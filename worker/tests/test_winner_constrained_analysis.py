import unittest

from worker.eval.winner_constrained_analysis import (
    build_poc_payload,
    build_point_contexts,
    infer_winner_constrained_point,
    select_twenty,
)


def point(idx, winner="user", **extra):
    value = {
        "id": f"point-{idx}",
        "idx": idx,
        "confirmed_winner": winner,
        "is_let": False,
        "game_end_override": None,
    }
    value.update(extra)
    return value


class TwentyPointSelectionTests(unittest.TestCase):
    def test_selects_four_lowest_hashes_from_each_chronological_stratum(self):
        points = []
        for stratum in range(1, 6):
            for offset, suffix in enumerate(("e", "d", "c", "b", "a")):
                idx = (stratum - 1) * 10 + offset + 1
                points.append({
                    "id": f"point-{idx}",
                    "idx": idx,
                    "stratum": stratum,
                    "selection_hash": suffix,
                    "confirmed_winner": "user",
                })

        selected = select_twenty(list(reversed(points)))

        self.assertEqual(len(selected), 20)
        self.assertEqual(
            [item["idx"] for item in selected],
            [2, 3, 4, 5, 12, 13, 14, 15, 22, 23, 24, 25,
             32, 33, 34, 35, 42, 43, 44, 45],
        )
        self.assertTrue(all(item["confirmed_winner"] == "user" for item in selected))

    def test_rejects_duplicate_point_identity_before_selecting_twenty(self):
        points = []
        for stratum in range(1, 6):
            for offset in range(5):
                idx = (stratum - 1) * 10 + offset + 1
                points.append({
                    "id": f"point-{idx}",
                    "idx": idx,
                    "stratum": stratum,
                    "selection_hash": str(offset),
                    "confirmed_winner": "user",
                })
        points[-1] = dict(points[-1], id=points[-2]["id"])

        with self.assertRaisesRegex(ValueError, "duplicate point id"):
            select_twenty(points)


class PointContextTests(unittest.TestCase):
    def test_walks_11_point_game_boundary_and_swaps_physical_sides(self):
        timeline = [
            point(index, "user" if index <= 11 else "opponent")
            for index in range(1, 13)
        ]

        contexts = build_point_contexts(timeline, {
            "first_server": "user",
            "user_side": "near",
        })

        self.assertEqual(contexts[9]["game"], 1)
        self.assertEqual(contexts[9]["score_before"], {"user": 9, "opponent": 0})
        self.assertEqual(contexts[10]["server"], "opponent")
        self.assertEqual(contexts[10]["game"], 1)
        self.assertEqual(contexts[11]["game"], 2)
        self.assertEqual(contexts[11]["score_before"], {"user": 0, "opponent": 0})
        self.assertEqual(contexts[11]["server"], "opponent")
        self.assertEqual(contexts[11]["user_side"], "far")
        self.assertEqual(contexts[11]["side_to_player"], {
            "near": "opponent",
            "far": "user",
        })

    def test_uses_two_serve_blocks_then_single_serves_after_ten_all(self):
        timeline = [
            point(index, "user" if index % 2 else "opponent")
            for index in range(1, 24)
        ]

        contexts = build_point_contexts(timeline, {
            "first_server": "user",
            "user_side": "near",
        })

        self.assertEqual([contexts[index]["server"] for index in range(8)], [
            "user", "user", "opponent", "opponent",
            "user", "user", "opponent", "opponent",
        ])
        self.assertEqual(contexts[20]["score_before"], {"user": 10, "opponent": 10})
        self.assertEqual(
            [contexts[index]["server"] for index in range(20, 23)],
            ["user", "opponent", "user"],
        )

    def test_honors_a_positional_boundary_override_on_an_unscored_point(self):
        timeline = [
            point(1, "user"),
            point(2, None, game_end_override="end"),
            point(3, "opponent"),
        ]

        contexts = build_point_contexts(timeline, {
            "first_server": "user",
            "user_side": "far",
        })

        self.assertEqual(contexts[2]["game"], 2)
        self.assertEqual(contexts[2]["server"], "opponent")
        self.assertEqual(contexts[2]["user_side"], "near")


class WinnerConstrainedInferenceTests(unittest.TestCase):
    def setUp(self):
        self.context = {
            "game": 1,
            "server": "user",
            "server_side": "near",
            "user_side": "near",
            "side_to_player": {"near": "user", "far": "opponent"},
        }

    def test_promotes_supported_terminal_only_when_it_agrees_with_confirmed_winner(self):
        result = infer_winner_constrained_point(point(
            1,
            terminal={
                "supported": True,
                "truncated": False,
                "expected_winner_side": "near",
                "expected_ending": "hit into net",
            },
        ), self.context)

        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["ending"], "hit into net")
        self.assertEqual(result["evidence"]["surviving"][0]["source"], "terminal")
        self.assertEqual(result["evidence"]["rejected"], [])

    def test_rejects_supported_terminal_that_implies_the_other_player_won(self):
        result = infer_winner_constrained_point(point(
            1,
            terminal={
                "supported": True,
                "truncated": False,
                "expected_winner_side": "far",
                "expected_ending": "hit into net",
            },
        ), self.context)

        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["ending"])
        self.assertEqual(result["evidence"]["rejected"][0]["reason"], "winner_conflict")

    def test_does_not_auto_fill_when_supported_terminal_has_no_observable_ending(self):
        result = infer_winner_constrained_point(point(
            1,
            terminal={
                "supported": True,
                "truncated": False,
                "expected_winner_side": "near",
            },
        ), self.context)

        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["ending"])

    def test_uses_known_server_placement_hypothesis_as_review_only_fallback(self):
        result = infer_winner_constrained_point(point(
            1,
            placement={
                "hypotheses": {
                    "near": {
                        "status": "ready",
                        "proposal": {
                            "ending": "missed table (long/wide)",
                            "winner_side": "near",
                        },
                    },
                    "far": {
                        "status": "ready",
                        "proposal": {
                            "ending": "hit into net",
                            "winner_side": "far",
                        },
                    },
                },
            },
        ), self.context)

        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["ending"], "missed table (long/wide)")
        self.assertEqual(result["evidence"]["surviving"][0]["source"], "placement")
        self.assertEqual(result["evidence"]["surviving"][0]["server_side"], "near")

    def test_derives_a_review_only_net_fallback_from_selected_placement_shot(self):
        result = infer_winner_constrained_point(point(
            1,
            placement={
                "hypotheses": {
                    "near": {
                        "status": "ready",
                        "shots": [{
                            "hitter_side": "far",
                            "terminal": {"kind": "net"},
                        }],
                    },
                },
            },
        ), self.context)

        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["ending"], "hit into net")

    def test_keeps_classifier_evidence_only_when_its_winner_matches_the_constraint(self):
        accepted = infer_winner_constrained_point(point(
            1,
            classifier={"winner": "user", "ending": "clean winner"},
        ), self.context)
        rejected = infer_winner_constrained_point(point(
            2,
            classifier={"winner": "opponent", "ending": "clean winner"},
        ), self.context)

        self.assertEqual(accepted["status"], "needs_review")
        self.assertEqual(accepted["evidence"]["surviving"][0]["source"], "classifier")
        self.assertEqual(rejected["status"], "unavailable")
        self.assertEqual(rejected["evidence"]["rejected"][0]["source"], "classifier")
        self.assertEqual(rejected["evidence"]["rejected"][0]["reason"], "winner_conflict")

    def test_matching_classifier_without_an_ending_abstains(self):
        result = infer_winner_constrained_point(point(
            1,
            classifier={"winner": "user"},
        ), self.context)

        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["ending"])

    def test_abstains_when_no_constrained_evidence_survives(self):
        result = infer_winner_constrained_point(point(1), self.context)

        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["ending"])
        self.assertEqual(result["evidence"], {"surviving": [], "rejected": []})

    def test_withholds_forced_and_unforced_error_labels_even_when_winner_matches(self):
        for ending in ("forced_error", "unforced_error"):
            with self.subTest(ending=ending):
                result = infer_winner_constrained_point(point(
                    1,
                    classifier={"winner": "user", "ending": ending},
                ), self.context)

                self.assertEqual(result["status"], "unavailable")
                self.assertIsNone(result["ending"])
                self.assertEqual(
                    result["evidence"]["rejected"][0]["reason"],
                    "causal_ending_withheld",
                )


class PocPayloadTests(unittest.TestCase):
    def test_reports_unavailable_accuracy_without_confirmed_endings(self):
        payload = build_poc_payload([
            {"idx": 1, "confirmed_winner": "user", "status": "high_confidence", "ending": "hit into net"},
            {"idx": 2, "confirmed_winner": "opponent", "status": "needs_review", "ending": "clean winner"},
            {"idx": 3, "confirmed_winner": "user", "status": "unavailable", "ending": None},
        ], {"match_id": "local-fixture", "first_server": "user"})

        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["production_context"]["match_id"], "local-fixture")
        self.assertEqual(payload["coverage"], {
            "confirmed_winner_available": 3,
            "ending_proposal_coverage": 2,
            "high_confidence_auto_fill_coverage": 1,
        })
        self.assertEqual(payload["ending_accuracy"], {
            "status": "unavailable",
            "reason": "No confirmed ending labels are available for this POC.",
        })

    def _real_shaped_inputs(self):
        analysis_points = []
        production_points = []
        for index in range(1, 26):
            stratum = (index - 1) // 5 + 1
            offset = (index - 1) % 5
            analysis_point = {
                "id": f"point-{index}",
                "idx": index,
                "stratum": stratum,
                "selection_hash": "edcba"[offset],
                "clip": f"clips/point-{index:03d}.mp4",
                "high_precision": {},
                "raw_suggestion": {},
                "placement": {"hypotheses": {}},
            }
            if index == 2:
                analysis_point["high_precision"] = {
                    "diagnostics": {
                        "terminal": {
                            "supported": True,
                            "truncated": False,
                            "terminal_kind": "unreturned landing",
                            "expected_winner_side": None,
                            "expected_ending": "clean winner",
                        },
                        "contact_evidence": {
                            "contacts": [{"side": "near", "t": 1.4}],
                        },
                    },
                }
            if index == 3:
                analysis_point["raw_suggestion"] = {
                    "winner": "Adil",
                    "ending": "hit into net",
                }
            analysis_points.append(analysis_point)
            production_points.append({
                "id": f"point-{index}",
                "idx": index,
                "t0": 0.0 if index == 2 else float(index),
                "confirmed_winner": "user",
                "confirmed_how": None,
                "is_let": False,
                "game_end_override": None,
                "server_override": None,
            })
        return (
            {"match": {"id": "match-1"}, "points": analysis_points},
            {
                "match": {
                    "id": "match-1",
                    "first_server": "user",
                    "user_side": "near",
                    "opponent_name": "Vaibhav",
                },
                "points": production_points,
            },
        )

    def test_builds_twenty_inferences_by_joining_real_analysis_with_production_context(self):
        analysis, production_context = self._real_shaped_inputs()

        payload = build_poc_payload(analysis, production_context)
        selected = payload["points"]
        terminal = next(item for item in selected if item["id"] == "point-2")
        classifier = next(item for item in selected if item["id"] == "point-3")

        self.assertEqual(len(selected), 20)
        self.assertEqual(len({item["id"] for item in selected}), 20)
        self.assertEqual(len({item["idx"] for item in selected}), 20)
        self.assertTrue(all(item["confirmed_winner"] == "user" for item in selected))
        self.assertEqual(terminal["context"]["score_before"], {"user": 0, "opponent": 0})
        self.assertEqual(terminal["status"], "high_confidence")
        self.assertEqual(terminal["ending"], "clean winner")
        self.assertEqual(classifier["status"], "needs_review")
        self.assertEqual(classifier["ending"], "hit into net")
        self.assertEqual(classifier["raw_suggestion"]["winner"], "Adil")
        self.assertEqual(payload["ending_accuracy"]["status"], "unavailable")
        self.assertNotIn("points", payload["production_context"])
        self.assertEqual(payload["production_context"]["match_id"], "match-1")

    def test_rejects_analysis_and_production_for_different_matches(self):
        analysis, production_context = self._real_shaped_inputs()
        production_context["match"]["id"] = "other-match"

        with self.assertRaisesRegex(ValueError, "match ids"):
            build_poc_payload(analysis, production_context)


if __name__ == "__main__":
    unittest.main()
