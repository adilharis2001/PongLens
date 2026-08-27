import unittest
from unittest import mock

from worker import judged_boundaries as jb


class Boundaries(unittest.TestCase):
    def test_adjacent_judgements_are_one_changeover(self):
        """The same break judged at rally 20 and at rally 21 is one event.

        This is the bug that invented seven misses: the truth said the
        game ended after 21, a looser setting fired after 20, both were
        put in front of Adil, and a tally keyed on the rally index read
        the pair as one boundary found and one missed.
        """
        out = jb.boundaries({"aaaaaaaa@20": "swapped", "aaaaaaaa@21": "swapped"})
        self.assertEqual(out["aaaaaaaa"]["real"], [[20, 21]])

    def test_a_real_gap_stays_two_changeovers(self):
        out = jb.boundaries({"aaaaaaaa@20": "swapped", "aaaaaaaa@45": "swapped"})
        self.assertEqual(out["aaaaaaaa"]["real"], [[20], [45]])

    def test_excluded_matches_are_dropped_entirely(self):
        judged = {f"{jb.EXCLUDED_MATCHES[0]}@10": "swapped",
                  "bbbbbbbb@10": "swapped"}
        self.assertEqual(set(jb.boundaries(judged)), {"bbbbbbbb"})


class Score(unittest.TestCase):
    def setUp(self):
        patch = mock.patch.object(
            jb, "judgements",
            lambda: {"aaaaaaaa@20": "swapped", "aaaaaaaa@50": "swapped",
                     "aaaaaaaa@70": "same"})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_fire_within_tolerance_finds_the_boundary(self):
        out = jb.score({"aaaaaaaa": [22, 50]})
        self.assertEqual((out["found"], out["missed"], out["false"]), (2, 0, 0))

    def test_a_fire_on_a_same_verdict_is_false(self):
        out = jb.score({"aaaaaaaa": [20, 50, 70]})
        self.assertEqual((out["found"], out["false"]), (2, 1))

    def test_a_fire_nobody_judged_is_neither(self):
        """It must not count as a hit and must not count against precision.

        A change that lifts recall by firing in matches nobody reviewed
        would otherwise read as free.
        """
        out = jb.score({"aaaaaaaa": [20, 50, 120]})
        self.assertEqual((out["found"], out["false"]), (2, 0))
        self.assertEqual(out["unjudged"], ["aaaaaaaa@120"])
        self.assertEqual(out["precision"], 1.0)

    def test_a_withheld_match_misses_all_of_its_boundaries(self):
        out = jb.score({})
        self.assertEqual((out["found"], out["missed"]), (0, 2))


if __name__ == "__main__":
    unittest.main()
