import unittest

from worker.side_change import (
    DEFAULT_CONFIG,
    detect_side_changes,
    map_point_ids,
    merge_config,
    pair_verdict,
    summarize_point_side,
)


RED = [0.9, 0.1, 0.1]
BLUE = [0.1, 0.1, 0.9]
REDDISH = [0.88, 0.12, 0.11]
BLUISH = [0.12, 0.09, 0.91]


def point(idx, near_sig, far_sig, t0=None, t1=None, qualified=True):
    def side(sig):
        if sig is None:
            return None
        return {"sig": sig, "frames": 3, "spread": 0.01, "ok": qualified}

    return {
        "idx": idx,
        "t0": float(t0 if t0 is not None else idx * 10.0),
        "t1": float(t1 if t1 is not None else idx * 10.0 + 4.0),
        "near": side(near_sig),
        "far": side(far_sig),
    }


def sequence(states, flip_at=None):
    """states: count of points; flip_at: first idx with swapped ends."""
    points = []
    for i in range(states):
        if flip_at is not None and i >= flip_at:
            points.append(point(i, BLUE, RED))
        else:
            points.append(point(i, RED, BLUE))
    return points


class SummarizePointSide(unittest.TestCase):
    def test_requires_two_agreeing_samples(self):
        self.assertIsNone(summarize_point_side([], 0.16))
        single = summarize_point_side([RED], 0.16)
        self.assertFalse(single["ok"])
        stable = summarize_point_side([RED, REDDISH, RED], 0.16)
        self.assertTrue(stable["ok"])

    def test_disagreeing_samples_disqualify(self):
        # Two different shirts alternating at one end (doubles, or a
        # bystander wandering through the region) must not qualify.
        mixed = summarize_point_side([RED, BLUE, RED], 0.16)
        self.assertFalse(mixed["ok"])
        self.assertGreater(mixed["spread"], 0.16)


class PairVerdict(unittest.TestCase):
    def test_same_and_swapped(self):
        a = point(0, RED, BLUE)
        b_same = point(1, REDDISH, BLUISH)
        b_swap = point(1, BLUISH, REDDISH)
        self.assertEqual(
            pair_verdict(a, b_same, 0.08)["verdict"], "same"
        )
        self.assertEqual(
            pair_verdict(a, b_swap, 0.08)["verdict"], "swapped"
        )

    def test_similar_shirts_are_uncertain(self):
        a = point(0, RED, REDDISH)
        b = point(1, REDDISH, RED)
        self.assertEqual(pair_verdict(a, b, 0.08)["verdict"], "uncertain")


class DetectSideChanges(unittest.TestCase):
    """The labelling model, exercised on the cases that shaped it.

    v3 stopped asking "is this pair swapped, with N clean pairs either
    side" and started asking "what single explanation of the whole match
    costs least". These tests are written against that: what must be
    found, what must not, and what an ambiguous rally is allowed to do.
    """

    def test_clean_flip_confirms_one_change(self):
        result = detect_side_changes(sequence(8, flip_at=4))
        self.assertEqual(result["status"], "ready")
        confirmed = [c for c in result["side_changes"] if c["confirmed"]]
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(confirmed[0]["after_idx"], 3)
        self.assertEqual(confirmed[0]["before_idx"], 4)
        self.assertGreaterEqual(confirmed[0]["confidence"], 0.55)

    def test_no_flip_no_changes(self):
        result = detect_side_changes(sequence(8))
        self.assertEqual(result["side_changes"], [])

    def test_flip_at_the_very_end_is_not_confirmed(self):
        # The swap is the last rally: nothing after it persists, so there
        # is no evidence the new arrangement held. A player leaning into
        # the far region on the final point must not mint a boundary.
        result = detect_side_changes(sequence(6, flip_at=5))
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_flip_at_the_very_start_is_not_confirmed(self):
        result = detect_side_changes(sequence(6, flip_at=1))
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_one_ambiguous_rally_does_not_veto_the_change(self):
        # THE Ishan case (d59d7610), in miniature. Under v2 a single
        # 'uncertain' pair beside the flip zeroed a stability run and the
        # boundary was refused; three real boundaries were lost to it.
        # Ambiguous evidence should be outvoted, not obeyed.
        points = sequence(10, flip_at=5)
        points[5] = point(5, [0.5, 0.5, 0.5], [0.5, 0.52, 0.5])
        result = detect_side_changes(points)
        confirmed = [c for c in result["side_changes"] if c["confirmed"]]
        self.assertEqual(len(confirmed), 1)

    def test_messy_changeover_is_still_one_changeover(self):
        # Two junk rallies in the middle of the break, one of which
        # happens to read 'same'. v2 split this into two halves with
        # settled ground on one side each and refused both.
        points = sequence(12, flip_at=6)
        points[5] = point(5, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
        points[6] = point(6, [0.45, 0.5, 0.55], [0.5, 0.5, 0.45])
        result = detect_side_changes(points)
        confirmed = [c for c in result["side_changes"] if c["confirmed"]]
        self.assertEqual(len(confirmed), 1)

    def test_change_budget_withholds_everything(self):
        points = []
        for i in range(14):
            points.append(point(i, *((RED, BLUE) if i % 2 == 0
                                     else (BLUE, RED))))
        result = detect_side_changes(points)
        self.assertEqual(result["status"], "withheld")
        self.assertEqual(result["side_changes"], [])

    def test_indistinguishable_players_withhold_everything(self):
        # Prabhas (9e15ed10): both players in dark tops under gym light,
        # measured 0.147 apart. Every margin in such a match is noise, so
        # the honest answer is nothing rather than a lower bar.
        points = []
        for i in range(12):
            a, b = [0.30, 0.31, 0.33], [0.32, 0.30, 0.31]
            points.append(point(i, *((a, b) if i < 6 else (b, a))))
        result = detect_side_changes(points)
        self.assertEqual(result["status"], "withheld")
        self.assertIn("apart", result["reason"])

    def test_flip_reaches_across_transition_cards(self):
        # The changeover gets cut into junk cards — a player fetching the
        # ball or a drink, with nobody at one end — so the last rally of a
        # game and the first of the next are rarely neighbours. The
        # boundary is reported after the last qualified point, which is
        # where the game actually ended.
        points = sequence(9, flip_at=5)
        points[4]["near"]["ok"] = False
        result = detect_side_changes(points)
        confirmed = [c for c in result["side_changes"] if c["confirmed"]]
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(confirmed[0]["after_idx"], 3)
        self.assertEqual(confirmed[0]["before_idx"], 5)
        self.assertEqual(confirmed[0]["components"]["bridged"], 1)

    def test_reach_stops_at_the_link_limit(self):
        # A long blind stretch is not a changeover. With link_max_skip
        # set below the hole, no comparison spans it and the two halves
        # are unconnected, so no change can be claimed across it.
        points = sequence(16, flip_at=9)
        for i in range(4, 9):
            points[i]["near"]["ok"] = False
        result = detect_side_changes(points, {"link_max_skip": 3})
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_single_rally_glitch_does_not_confirm(self):
        # One rally played from the wrong ends, then back. Paying the
        # switch penalty twice for one rally's worth of evidence is not
        # worth it, so the winning labelling has no change at all.
        points = sequence(12)
        points[6] = point(6, BLUE, RED)
        result = detect_side_changes(points)
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_a_long_break_makes_a_change_cheaper(self):
        tight = detect_side_changes(sequence(10, flip_at=5))
        spread = sequence(10, flip_at=5)
        for i, p in enumerate(spread):
            if i >= 5:
                p["t0"] += 40.0
                p["t1"] += 40.0
        loose = detect_side_changes(spread)
        self.assertEqual(len(tight["side_changes"]), 1)
        self.assertEqual(len(loose["side_changes"]), 1)
        self.assertLess(
            loose["side_changes"][0]["components"]["switch_cost"],
            tight["side_changes"][0]["components"]["switch_cost"],
        )

    def test_histogram_signatures_are_accepted(self):
        # Signatures are no longer three numbers: the descriptor may be a
        # 36-bin hue-saturation histogram. Nothing in the state machine
        # should care how wide a signature is.
        left = [0.0] * 18 + [1.0] + [0.0] * 17
        right = [1.0] + [0.0] * 35
        points = [
            point(i, *((left, right) if i < 5 else (right, left)))
            for i in range(10)
        ]
        result = detect_side_changes(points)
        confirmed = [c for c in result["side_changes"] if c["confirmed"]]
        self.assertEqual(len(confirmed), 1)


class MergeConfig(unittest.TestCase):
    def test_ignores_unknown_and_junk_values(self):
        merged = merge_config(
            {
                "switch_penalty": 0.55,
                "max_changes": 4,
                "unknown_key": 1.0,
                "spread_max": "junk",
                "link_span": -3,
            }
        )
        self.assertEqual(merged["switch_penalty"], 0.55)
        self.assertEqual(merged["max_changes"], 4)
        self.assertNotIn("unknown_key", merged)
        self.assertEqual(merged["spread_max"], DEFAULT_CONFIG["spread_max"])
        self.assertEqual(merged["link_span"], DEFAULT_CONFIG["link_span"])



class Alignment(unittest.TestCase):
    """The 2026-08-26 failure: evidence keyed by match.json idx, pinned
    onto database rows of the same idx, on a match that was reprocessed
    in between."""

    def evidence(self):
        return {
            "points": [
                {"idx": 73, "t0": 684.0, "t1": 693.0},
                {"idx": 74, "t0": 704.0, "t1": 715.0},
            ],
            "side_changes": [
                {
                    "kind": "side_change",
                    "after_idx": 73,
                    "before_idx": 74,
                    "confidence": 1.0,
                    "confirmed": True,
                }
            ],
        }

    def test_matching_times_map_cleanly(self):
        stored = {
            73: {"id": "a", "t0": 684.0, "t1": 693.0},
            74: {"id": "b", "t0": 704.0, "t1": 715.0},
        }
        mapped = map_point_ids(self.evidence(), stored)
        change = mapped["side_changes"][0]
        self.assertEqual(change["after_point_id"], "a")
        self.assertEqual(change["before_point_id"], "b")
        self.assertEqual(change["gap_t0"], 693.0)
        self.assertEqual(change["gap_t1"], 704.0)

    def test_reprocessed_match_is_refused(self):
        # The real Chris numbers: same idx, 198s apart.
        stored = {
            73: {"id": "a", "t0": 542.4, "t1": 552.1},
            74: {"id": "b", "t0": 552.7, "t1": 559.3},
        }
        with self.assertRaises(ValueError) as caught:
            map_point_ids(self.evidence(), stored)
        self.assertIn("not aligned", str(caught.exception))

    def test_deleted_points_are_not_misalignment(self):
        # The owner removed idx 74 as junk. The rest still lines up, so
        # this must map, not refuse.
        stored = {73: {"id": "a", "t0": 684.0, "t1": 693.0}}
        evidence = self.evidence()
        evidence["side_changes"] = []
        mapped = map_point_ids(evidence, stored)
        self.assertEqual(mapped["points"][0]["point_id"], "a")

    def test_no_shared_index_is_refused(self):
        with self.assertRaises(ValueError):
            map_point_ids(self.evidence(), {5: {"id": "z", "t0": 1.0,
                                                "t1": 2.0}})

if __name__ == "__main__":
    unittest.main()
