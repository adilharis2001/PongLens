"""The router between the two point assemblers (2026-09-06).

Serves per candidate point, with a veto when the drawn table is not where
the ball bounces. The numbers in each case are real matches from the lab
table in docs/research/2026-09-06-endon-routing.md, section 3c.
"""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import points_endon as EO                                     # noqa: E402


class FakeEvidence:
    def __init__(self, serves, bounces, on_table, duration=600.0):
        self.serves = [float(i) for i in range(serves)]
        self.bt = np.zeros(bounces)
        self.bt_table = np.zeros(on_table)
        self.duration = duration


def cards(n):
    return [{"t0": float(i), "t1": float(i) + 0.5} for i in range(n)]


class Router(unittest.TestCase):

    def test_a_real_end_on_camera_goes_end_on(self):
        # koko: 5 serves on 34 candidate points, 73% of bounces on the table
        E = FakeEvidence(serves=5, bounces=100, on_table=73)
        self.assertTrue(EO.wants_endon(E, cards(34)))
        # tripp_rc, the highest end-on yield: 31 on 91 = 0.34
        self.assertTrue(EO.wants_endon(FakeEvidence(31, 100, 83), cards(91)))

    def test_a_side_on_camera_stays_serve_anchored(self):
        # ishan: 88 serves on 100 cards, 77% on the table
        self.assertFalse(EO.wants_endon(FakeEvidence(88, 100, 77), cards(100)))
        # gavin_16, the lowest side-on yield: 64 on 127 = 0.50, under the
        # OLD per-minute rule (1.62/min) but on the side-on side of the gap
        self.assertFalse(EO.wants_endon(FakeEvidence(64, 100, 78), cards(127)))

    def test_a_break_between_games_cannot_move_it(self):
        # Same serves, same cards, three times the video: the per-minute
        # rule would have flipped this; serves per point has no minutes.
        short = FakeEvidence(64, 100, 78, duration=600.0)
        long = FakeEvidence(64, 100, 78, duration=1800.0)
        self.assertEqual(EO.wants_endon(short, cards(127)),
                         EO.wants_endon(long, cards(127)))

    def test_a_table_the_ball_does_not_bounce_on_is_vetoed(self):
        # anton_long after the crop: 53 serves on 82 cards (0.65, a healthy
        # yield) but 48% of bounces on the drawn table (a net-post diamond)
        self.assertTrue(EO.wants_endon(FakeEvidence(53, 100, 48), cards(82)))
        # terry's 60% is the worst real camera and must NOT be vetoed
        self.assertFalse(EO.wants_endon(FakeEvidence(88, 100, 60), cards(100)))

    def test_no_bounces_at_all_means_no_veto(self):
        E = FakeEvidence(88, 0, 0)
        self.assertIsNone(EO.table_share(E))
        self.assertFalse(EO.wants_endon(E, cards(100)))

    def test_no_cards_at_all_is_end_on(self):
        self.assertTrue(EO.wants_endon(FakeEvidence(0, 10, 8), []))

    def test_the_rate_is_still_computed_for_the_record(self):
        self.assertAlmostEqual(EO.serve_rate(FakeEvidence(10, 0, 0, 600.0)), 1.0)
