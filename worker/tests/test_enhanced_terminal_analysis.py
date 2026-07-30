import json
from pathlib import Path
import tempfile
import unittest

from worker.eval.enhanced_terminal_analysis import (
    DEVELOPMENT_INDEXES,
    HOLDOUT_INDEXES,
    load_development_truth,
    select_disjoint_holdout,
)


FIXTURE = (
    Path(__file__).parents[1]
    / "eval"
    / "fixtures"
    / "vaibhav_terminal_review_v1.json"
)


class FrozenDatasetTests(unittest.TestCase):
    def test_fixture_matches_twenty_reviewed_points(self):
        truth = load_development_truth(FIXTURE)

        self.assertEqual(set(truth), DEVELOPMENT_INDEXES)
        self.assertEqual(truth[4]["ending_family"], "complete_miss")
        self.assertEqual(truth[16]["ending_family"], "net_error")
        self.assertEqual(truth[100]["contact_count"], 5)

    def test_remaining_frozen_points_are_the_five_holdout_indexes(self):
        analysis = {
            "points": [
                {"idx": value}
                for value in sorted(DEVELOPMENT_INDEXES | HOLDOUT_INDEXES)
            ]
        }

        self.assertEqual(
            select_disjoint_holdout(analysis, DEVELOPMENT_INDEXES),
            [11, 34, 78, 114, 138],
        )

    def test_fixture_rejects_duplicate_point_indexes(self):
        malformed = {
            "version": 1,
            "source": "review.json",
            "points": [
                {
                    "idx": 4,
                    "contact_count": 2,
                    "ending_family": "complete_miss",
                    "last_hitter": "user",
                    "attempted_hitter": "opponent",
                    "summary": "first",
                },
                {
                    "idx": 4,
                    "contact_count": 3,
                    "ending_family": "net_error",
                    "last_hitter": "opponent",
                    "attempted_hitter": None,
                    "summary": "duplicate",
                },
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.json"
            path.write_text(json.dumps(malformed))

            with self.assertRaisesRegex(ValueError, "duplicate"):
                load_development_truth(path)


if __name__ == "__main__":
    unittest.main()
