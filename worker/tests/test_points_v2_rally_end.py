"""The evidence end must survive card assembly, or it trims the wrong point.

`rally_end_ev` has always returned two numbers; 143 keeps the second one so
an unscored match can stop at the rally instead of at the padding that
exists to catch a winner tap. Between the moment it is computed and the
moment it is stored, four functions move card boundaries — resolve trims a
tail to make room for the next serve, merge_continuous joins two rallies,
split_long cuts one in half, and resolve again absorbs a card inside its
neighbour. Each of them can leave an evidence end describing a moment its
own card no longer contains.

These assert the OUTCOME each function is supposed to produce, built from
hand-made cards rather than from a pipeline run, so a failure names the
function that broke rather than "the numbers moved".
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import points_v2  # noqa: E402


def card(t0, t1, ev, serve_s=None, why="serve"):
    return {"t0": t0, "t1": t1, "serve_s": serve_s, "why": why,
            "end_evidence_s": ev}


class EvidenceEndSurvivesAssembly(unittest.TestCase):
    def test_clamp_drops_an_evidence_end_before_its_own_card(self):
        # Not clamped UP to t0: an ending before the card started describes a
        # different rally, and moving it would invent a boundary.
        c = points_v2.clamp_evidence(card(10.0, 20.0, 4.0))
        self.assertIsNone(c["end_evidence_s"])

    def test_clamp_pulls_an_evidence_end_back_inside_a_trimmed_card(self):
        c = points_v2.clamp_evidence(card(10.0, 15.0, 18.0))
        self.assertEqual(c["end_evidence_s"], 15.0)

    def test_clamp_leaves_an_ending_inside_its_card_alone(self):
        c = points_v2.clamp_evidence(card(10.0, 20.0, 17.5))
        self.assertEqual(c["end_evidence_s"], 17.5)

    def test_resolve_clamps_the_ending_of_a_tail_it_trims(self):
        # Two serve cards colliding: resolve pulls the first card's padded tail
        # back so the second keeps a head before its own serve. An evidence end
        # inside the discarded tail has to come back with it.
        cards = [card(0.0, 20.0, 19.0, serve_s=1.0),
                 card(19.0, 30.0, 29.0, serve_s=21.0)]
        out = points_v2.resolve(cards)
        for c in out:
            ev = c["end_evidence_s"]
            self.assertTrue(ev is None or c["t0"] <= ev <= c["t1"], c)

    def test_resolve_absorbs_and_keeps_the_later_ending(self):
        # A card wholly inside its predecessor is absorbed. The survivor covers
        # both rallies, so it must end at the later observed ending, not the
        # earlier — stopping at the first would cut the second rally short.
        cards = [card(0.0, 20.0, 12.0), card(10.0, 19.0, 18.0)]
        out = points_v2.resolve(cards)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["end_evidence_s"], 18.0)

    def test_split_long_gives_the_first_half_no_ending(self):
        # The split point is chosen for quietness, not because a rally ended
        # there. Inventing an ending for the first half would trim a point on
        # evidence that was never gathered.
        class E:
            ball_dense = np.zeros(4000)

        long_card = card(0.0, points_v2.MAX_CARD_S + 10.0, 40.0)
        out = points_v2.split_long(E, [long_card])
        self.assertEqual(len(out), 2)
        self.assertIsNone(out[0]["end_evidence_s"])
        for c in out:
            ev = c["end_evidence_s"]
            self.assertTrue(ev is None or c["t0"] <= ev <= c["t1"], c)

    def test_resolve_coerces_numpy_so_psycopg2_never_sees_one(self):
        # The evidence end can be a crossing time, and E.cross is a numpy array.
        # A numpy scalar reaching psycopg2 renders as "np.float64(...)" inside
        # the SQL text — the exact reason t0/t1/serve_s are coerced here.
        out = points_v2.resolve([card(0.0, 20.0, np.float64(19.0))])
        self.assertIs(type(out[0]["end_evidence_s"]), float)

    def test_a_card_with_no_observed_ending_stays_none_throughout(self):
        # A fallback card with no crossing chain has no measured ending. Missing
        # must stay missing: read as an early end, it would cut a real rally.
        out = points_v2.resolve([card(0.0, 20.0, None), card(30.0, 50.0, None)])
        self.assertEqual([c["end_evidence_s"] for c in out], [None, None])


if __name__ == "__main__":
    unittest.main()
