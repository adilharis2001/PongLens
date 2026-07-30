import unittest

from worker.build_placement_calibration_pilot import (
    build_assignment_order,
    select_pilot_events,
)


def candidate(
    match_index,
    point_idx,
    phase,
    *,
    user_side="near",
    comparison_class="agreement",
    scored_server=True,
):
    return {
        "match_index": match_index,
        "point_idx": point_idx,
        "phase": phase,
        "shot_seq": {"serve": 1, "return": 2, "rally": 3}[phase],
        "user_side": user_side,
        "comparison_class": comparison_class,
        "scored_server": scored_server,
        "event_id": f"m{match_index}-p{point_idx}-{phase}",
    }


class PlacementPilotSelectionTests(unittest.TestCase):
    def synthetic_pool(self):
        pool = []
        for match_index in range(1, 7):
            base = match_index * 100
            phases = [
                "serve",
                "serve",
                "return",
                "return",
                "rally",
                "rally",
                "rally",
                "serve",
                "return",
            ]
            classes = [
                "disagreement",
                "agreement",
                "one_arm_abstention",
                "agreement",
                "disagreement",
                "agreement",
                "one_arm_abstention",
                "agreement",
                "disagreement",
            ]
            for offset, (phase, comparison_class) in enumerate(
                zip(phases, classes),
            ):
                pool.append(
                    candidate(
                        match_index,
                        base + offset,
                        phase,
                        user_side=(
                            "near"
                            if (match_index + offset) % 2
                            else "far"
                        ),
                        comparison_class=comparison_class,
                    )
                )
        pool.append(
            candidate(
                1,
                999,
                "serve",
                scored_server=False,
            )
        )
        return pool

    def test_selection_freezes_six_balanced_match_strata(self):
        selected = select_pilot_events(self.synthetic_pool())

        self.assertEqual(len(selected), 42)
        self.assertEqual(len({item["event_id"] for item in selected}), 42)
        self.assertEqual(
            len({(item["match_index"], item["point_idx"]) for item in selected}),
            42,
        )
        self.assertEqual(
            {match: sum(item["match_index"] == match for item in selected)
             for match in range(1, 7)},
            {match: 7 for match in range(1, 7)},
        )
        self.assertGreaterEqual(
            sum(item["phase"] == "serve" for item in selected),
            12,
        )
        self.assertGreaterEqual(
            sum(item["phase"] == "return" for item in selected),
            12,
        )
        self.assertGreaterEqual(
            sum(item["user_side"] == "near" for item in selected),
            15,
        )
        self.assertGreaterEqual(
            sum(item["user_side"] == "far" for item in selected),
            15,
        )
        self.assertEqual(
            {item["comparison_class"] for item in selected},
            {"agreement", "disagreement", "one_arm_abstention"},
        )
        self.assertTrue(all(item["scored_server"] for item in selected))

    def test_assignment_order_adds_six_stable_blind_repeats(self):
        selected = select_pilot_events(self.synthetic_pool())
        first = build_assignment_order(selected)
        second = build_assignment_order(list(reversed(selected)))

        self.assertEqual(first, second)
        self.assertEqual(len(first), 48)
        self.assertEqual(sum(item["is_repeat"] for item in first), 6)
        repeated = [
            item["source_event_id"]
            for item in first
            if item["is_repeat"]
        ]
        self.assertEqual(len(set(repeated)), 6)


if __name__ == "__main__":
    unittest.main()
