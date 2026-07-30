import json
from pathlib import Path
import tempfile
import unittest

from worker.eval.enhanced_terminal_analysis import (
    DEVELOPMENT_INDEXES,
    HOLDOUT_INDEXES,
    build_event_timeline,
    load_development_truth,
    rank_terminal_hypotheses,
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


def _context(winner="user", server="user"):
    return {
        "confirmed_winner": winner,
        "server": server,
        "server_side": "near" if server == "user" else "far",
        "side_to_player": {"near": "user", "far": "opponent"},
        "player_to_side": {"user": "near", "opponent": "far"},
    }


def _point(candidates=None, segments=None, bounces=None, hits=None):
    return {
        "idx": 1,
        "duration_s": 3.0,
        "raw_suggestion": {
            "ending": "missed table (long/wide)",
            "reason": "off-table v=9.99 u=9.99",
        },
        "placement": {"candidates": candidates or []},
        "diagnostics": {
            "track": {
                "segments": segments or [],
                "bounces": bounces or [],
                "hits": hits or [],
            }
        },
    }


class EventTimelineTests(unittest.TestCase):
    def test_audio_only_candidate_remains_unknown(self):
        timeline = build_event_timeline(
            _point(),
            {},
            [{"time_s": 1.2, "confidence": 8.0}],
            _context(),
        )

        self.assertEqual(timeline["events"][0]["role"], "unknown_audio")
        self.assertEqual(timeline["observed_contact_count"], 1)
        self.assertEqual(timeline["contact_count"], 1)

    def test_contact_count_separates_observed_and_inferred(self):
        point = _point(candidates=[
            {"kind": "contact", "t": 0.8, "side": "far", "x": 500, "y": 170},
            {"kind": "contact", "t": 1.4, "side": "near", "x": 180, "y": 210},
        ])

        timeline = build_event_timeline(
            point,
            {},
            [{"time_s": 0.81, "confidence": 4.0},
             {"time_s": 1.41, "confidence": 4.0}],
            _context(),
        )

        self.assertEqual(timeline["contact_count"], 3)
        self.assertEqual(timeline["observed_contact_count"], 3)
        self.assertEqual(timeline["inferred_contact_count"], 0)
        self.assertTrue(timeline["contacts"][1]["audio_supported"])

    def test_old_classifier_ending_cannot_change_the_timeline(self):
        point = _point(
            candidates=[
                {"kind": "contact", "t": 0.8, "side": "far", "x": 500, "y": 170},
            ],
            segments=[{
                "t0": 0.8, "t1": 1.2,
                "cx": [500, -200, 0], "cy": [170, 0, 0],
            }],
        )
        changed = json.loads(json.dumps(point))
        changed["raw_suggestion"] = {
            "ending": "hit into net",
            "reason": "net death t=1.0 striker=far",
        }

        first = build_event_timeline(point, {}, [], _context())
        second = build_event_timeline(changed, {}, [], _context())

        self.assertEqual(first, second)


class TerminalHypothesisTests(unittest.TestCase):
    def test_near_net_reversal_ranks_net_without_prior_classifier_label(self):
        timeline = {
            "contacts": [
                {"t": 0.0, "side": "near", "player": "user"},
                {"t": 0.8, "side": "far", "player": "opponent"},
            ],
            "contact_count": 2,
            "terminal_features": {
                "near_net_reversal": True,
                "near_net_end": True,
                "crossed_net": False,
                "legal_landing": False,
                "continued_after_net": False,
                "off_table_exit": False,
                "unreturned": False,
                "audio_terminal_support": True,
            },
        }

        result = rank_terminal_hypotheses(timeline, _context(winner="user"))

        self.assertEqual(result["prediction"], "net_error")
        self.assertEqual(result["final_hitter"], "opponent")

    def test_crossed_track_with_no_legal_landing_ranks_long(self):
        timeline = {
            "contacts": [
                {"t": 0.0, "side": "near", "player": "user"},
                {"t": 0.8, "side": "far", "player": "opponent"},
            ],
            "contact_count": 2,
            "terminal_features": {
                "near_net_reversal": False,
                "near_net_end": False,
                "crossed_net": True,
                "legal_landing": False,
                "continued_after_net": True,
                "off_table_exit": True,
                "unreturned": False,
                "audio_terminal_support": True,
            },
        }

        result = rank_terminal_hypotheses(timeline, _context(winner="user"))

        self.assertEqual(result["prediction"], "long_error")

    def test_net_disturbance_then_exit_preserves_net_cord_cause(self):
        timeline = {
            "contacts": [
                {"t": 0.0, "side": "near", "player": "user"},
                {"t": 0.8, "side": "far", "player": "opponent"},
            ],
            "contact_count": 2,
            "terminal_features": {
                "near_net_reversal": True,
                "near_net_end": False,
                "crossed_net": True,
                "legal_landing": False,
                "continued_after_net": True,
                "off_table_exit": True,
                "unreturned": False,
                "audio_terminal_support": True,
            },
        }

        result = rank_terminal_hypotheses(timeline, _context(winner="user"))

        self.assertEqual(result["prediction"], "net_cord_out")

    def test_winner_constraint_rejects_wrong_actor_without_choosing_net_over_long(self):
        timeline = {
            "contacts": [
                {"t": 0.0, "side": "near", "player": "user"},
                {"t": 0.8, "side": "far", "player": "opponent"},
            ],
            "contact_count": 2,
            "terminal_features": {
                "near_net_reversal": False,
                "near_net_end": False,
                "crossed_net": None,
                "legal_landing": False,
                "continued_after_net": False,
                "off_table_exit": False,
                "unreturned": False,
                "audio_terminal_support": False,
            },
        }

        result = rank_terminal_hypotheses(timeline, _context(winner="user"))

        self.assertEqual(result["prediction"], "unclear")
        families = {candidate["family"] for candidate in result["candidates"]}
        self.assertIn("net_error", families)
        self.assertIn("long_error", families)


if __name__ == "__main__":
    unittest.main()
