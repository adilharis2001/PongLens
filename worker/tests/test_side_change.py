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

    def test_flip_without_post_stability_is_unconfirmed(self):
        # The swap is the LAST pair — nothing after it persists, so this
        # must not confirm (a player leaning into the far region on the
        # final rally must not mint a boundary).
        points = sequence(5, flip_at=4)
        result = detect_side_changes(points)
        self.assertEqual(result["status"], "ready")
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_flip_without_pre_stability_is_unconfirmed(self):
        result = detect_side_changes(sequence(5, flip_at=1))
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_uncertain_neighbour_breaks_confirmation(self):
        points = sequence(8, flip_at=4)
        # Make the pair right after the flip uncertain: point 4 keeps the
        # swapped layout but point 5's shirts read nearly identical.
        points[5] = point(5, [0.5, 0.5, 0.5], [0.5, 0.52, 0.5])
        result = detect_side_changes(points)
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_flip_budget_withholds_everything(self):
        points = []
        for i in range(14):
            if i % 2 == 0:
                points.append(point(i, RED, BLUE))
            else:
                points.append(point(i, BLUE, RED))
        result = detect_side_changes(points)
        self.assertEqual(result["status"], "withheld")
        self.assertEqual(result["side_changes"], [])

    def test_flip_reaches_across_transition_cards(self):
        # The changeover itself gets cut into junk cards — a player
        # fetching the ball or a drink, with nobody at one end — so the
        # last rally of a game and the first of the next are rarely
        # neighbours. Reaching across them is the point: requiring
        # adjacency threw away 8 of 11 real changeovers on the corpus
        # (2026-08-26). The boundary is reported after the last
        # qualified point, which is where the game actually ended.
        points = sequence(9, flip_at=5)
        points[4]["near"]["ok"] = False
        result = detect_side_changes(points)
        confirmed = [c for c in result["side_changes"] if c["confirmed"]]
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(confirmed[0]["after_idx"], 3)
        self.assertEqual(confirmed[0]["before_idx"], 5)
        self.assertEqual(confirmed[0]["components"]["bridged"], 1)

    def test_reach_stops_at_the_bridge_limit(self):
        # Four unqualified points in a row is not a changeover, it is a
        # blind spot; no pair spans it, so nothing confirms.
        points = sequence(14, flip_at=8)
        for i in range(4, 8):
            points[i]["near"]["ok"] = False
        result = detect_side_changes(points, {"bridge_max": 3})
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_double_flip_and_back_is_not_confirmed(self):
        # One point played from the wrong ends (or a tracker glitch) then
        # back: neither flip has post/pre stability on its far side.
        points = sequence(9, flip_at=4)
        for i in range(5, 9):
            points[i] = point(i, RED, BLUE)
        result = detect_side_changes(points)
        self.assertTrue(
            all(not c["confirmed"] for c in result["side_changes"])
        )

    def test_gap_bonus_rewards_long_break(self):
        near_zero_gap = detect_side_changes(sequence(8, flip_at=4))
        spread_out = sequence(8, flip_at=4)
        # Insert a 30s dead gap at the flip.
        for i, p in enumerate(spread_out):
            if i >= 4:
                p["t0"] += 30.0
                p["t1"] += 30.0
        with_gap = detect_side_changes(spread_out)
        base = [c for c in near_zero_gap["side_changes"] if c["confirmed"]]
        bonus = [c for c in with_gap["side_changes"] if c["confirmed"]]
        self.assertEqual(len(base), 1)
        self.assertEqual(len(bonus), 1)
        self.assertGreater(bonus[0]["confidence"], base[0]["confidence"])


class MergeConfig(unittest.TestCase):
    def test_ignores_unknown_and_junk_values(self):
        merged = merge_config(
            {
                "margin_threshold": 0.12,
                "max_flips": 4,
                "unknown_key": 1.0,
                "spread_max": "junk",
                "pre_stable_pairs": -3,
            }
        )
        self.assertEqual(merged["margin_threshold"], 0.12)
        self.assertEqual(merged["max_flips"], 4)
        self.assertNotIn("unknown_key", merged)
        self.assertEqual(merged["spread_max"], DEFAULT_CONFIG["spread_max"])
        self.assertEqual(
            merged["pre_stable_pairs"], DEFAULT_CONFIG["pre_stable_pairs"]
        )



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
