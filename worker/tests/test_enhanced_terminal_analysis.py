import json
from pathlib import Path
import tempfile
import unittest

from worker.eval.enhanced_terminal_analysis import (
    DEVELOPMENT_INDEXES,
    HOLDOUT_INDEXES,
    build_event_timeline,
    classify_player_relative_stroke,
    load_development_truth,
    rank_terminal_hypotheses,
    select_disjoint_holdout,
)
from worker.eval.run_enhanced_terminal_poc import (
    cache_key,
    freeze_holdout_predictions,
    score_development,
    validate_output_destination,
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
    def test_sideways_roll_at_net_is_not_forward_continuation(self):
        context = _context(winner="user")
        context["fps"] = 30.0
        context["calibration"] = {
            "table_corners_px": {
                "A_near_left": [0, -20],
                "B_near_right": [0, 20],
                "C_far_right": [100, 20],
                "D_far_left": [100, -20],
            }
        }
        timeline = build_event_timeline(
            _point(candidates=[
                {"kind": "contact", "t": 0.5, "side": "far", "x": 95, "y": 0},
            ]),
            {
                17: (75, 0),
                18: (65, 0),
                19: (56, 0),
                20: (51, 2),
                21: (50, 9),
                22: (50, 18),
            },
            [{"time_s": 0.67, "confidence": 4.0}],
            context,
        )

        features = timeline["contact_hypotheses"][-1]["terminal_features"]
        result = rank_terminal_hypotheses(timeline, context)

        self.assertTrue(features["net_normal_stall_or_reversal"])
        self.assertTrue(features["net_tangential_motion"])
        self.assertTrue(features["net_lateral_roll"])
        self.assertFalse(features["net_receiver_crossing"])
        self.assertEqual(result["prediction"], "net_error")

    def test_track_crossing_net_keeps_receiver_directed_progress(self):
        context = _context(winner="user")
        context["fps"] = 30.0
        context["calibration"] = {
            "table_corners_px": {
                "A_near_left": [0, -20],
                "B_near_right": [0, 20],
                "C_far_right": [100, 20],
                "D_far_left": [100, -20],
            }
        }
        timeline = build_event_timeline(
            _point(candidates=[
                {"kind": "contact", "t": 0.5, "side": "far", "x": 95, "y": 0},
            ]),
            {
                17: (76, 0),
                18: (66, 0),
                19: (56, 0),
                20: (46, 4),
                21: (20, 7),
                22: (24, 9),
            },
            [],
            context,
        )

        features = timeline["contact_hypotheses"][-1]["terminal_features"]

        self.assertTrue(features["net_receiver_crossing"])
        self.assertGreater(features["net_normal_progress"], 0.2)
        self.assertFalse(features["net_normal_stall_or_reversal"])
        self.assertFalse(features["net_lateral_roll"])

    def test_explicit_rally_start_excludes_pre_serve_noise(self):
        point = _point(candidates=[
            {"kind": "bounce", "t": 1.0, "side": "near", "x": 10, "y": 0},
            {"kind": "contact", "t": 1.4, "side": "far", "x": 90, "y": 0},
            {"kind": "contact", "t": 9.4, "side": "far", "x": 90, "y": 0},
        ])
        point["shots"] = [{"index": 1, "time_s": 1.2}]
        context = _context()
        context["fps"] = 10.0
        context["rally_start_s"] = 9.0

        timeline = build_event_timeline(
            point,
            {12: (20, 0), 92: (80, 0), 94: (70, 0)},
            [
                {"time_s": 1.0, "confidence": 5.0},
                {"time_s": 9.4, "confidence": 5.0},
            ],
            context,
        )

        self.assertEqual([row["t"] for row in timeline["contacts"]], [9.0, 9.4])
        self.assertTrue(all(row["t"] >= 9.0 for row in timeline["events"]))
        self.assertEqual(timeline["rally_start_s"], 9.0)

    def test_fast_ball_stays_non_terminal_even_if_speed_changes_near_net(self):
        context = _context(winner="user")
        context["fps"] = 30.0
        context["calibration"] = {
            "table_corners_px": {
                "A_near_left": [0, -10],
                "B_near_right": [0, 10],
                "C_far_right": [100, 10],
                "D_far_left": [100, -10],
            }
        }
        timeline = build_event_timeline(
            _point(candidates=[
                {"kind": "contact", "t": 0.5, "side": "far", "x": 95, "y": 0},
            ]),
            {
                17: (200, 0),
                18: (150, 0),
                19: (100, 0),
                20: (50, 0),
                21: (20, 0),
                22: (-10, 0),
            },
            [],
            context,
        )

        features = timeline["contact_hypotheses"][-1]["terminal_features"]
        self.assertFalse(features["net_speed_drop"])

    def test_unrelated_reacquired_track_does_not_turn_net_death_into_exit(self):
        context = _context(winner="user")
        context["fps"] = 30.0
        context["calibration"] = {
            "table_corners_px": {
                "A_near_left": [0, -10],
                "B_near_right": [0, 10],
                "C_far_right": [100, 10],
                "D_far_left": [100, -10],
            }
        }
        timeline = build_event_timeline(
            _point(candidates=[
                {"kind": "contact", "t": 0.5, "side": "far", "x": 95, "y": 0},
            ]),
            {
                17: (65, 0),
                18: (58, 0),
                19: (52, 0),
                20: (50, 0),
                21: (49.5, 0),
                22: (49.2, 0),
                36: (120, 0),
            },
            [{"time_s": 0.67, "confidence": 4.0}],
            context,
        )

        features = timeline["contact_hypotheses"][-1]["terminal_features"]
        self.assertTrue(features["near_net_end"])
        self.assertTrue(features["net_speed_drop"])
        self.assertFalse(features["off_table_exit"])
        self.assertFalse(features["continued_after_net"])

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


class PlayerRelativeStrokeTests(unittest.TestCase):
    def setUp(self):
        self.pose = {
            "left_shoulder": [40, 40, 0.95],
            "right_shoulder": [60, 40, 0.95],
            "left_hip": [42, 70, 0.90],
            "right_hip": [58, 70, 0.90],
        }

    def test_right_hander_contact_on_anatomical_right_is_forehand(self):
        result = classify_player_relative_stroke(
            (72, 52), self.pose, handedness="right"
        )

        self.assertEqual(result["stroke_side"], "forehand")
        self.assertEqual(result["basis"], "player_relative_pose")

    def test_right_hander_contact_on_anatomical_left_is_backhand(self):
        result = classify_player_relative_stroke(
            (28, 52), self.pose, handedness="right"
        )

        self.assertEqual(result["stroke_side"], "backhand")

    def test_midline_contact_abstains(self):
        result = classify_player_relative_stroke(
            (51, 52), self.pose, handedness="right"
        )

        self.assertEqual(result["stroke_side"], "unknown")
        self.assertEqual(result["reason"], "contact_near_body_midline")

    def test_low_confidence_pose_abstains_instead_of_using_screen_side(self):
        pose = dict(self.pose)
        pose["right_shoulder"] = [60, 40, 0.1]

        result = classify_player_relative_stroke(
            (72, 52), pose, handedness="right"
        )

        self.assertEqual(result["stroke_side"], "unknown")
        self.assertEqual(result["reason"], "insufficient_pose")

    def test_timeline_propagates_pose_based_side_for_terminal_contact(self):
        context = _context()
        context["pose_by_contact_id"] = {"terminal": self.pose}
        context["handedness_by_player"] = {"opponent": "right"}
        timeline = build_event_timeline(
            _point(candidates=[{
                "id": "terminal",
                "kind": "contact",
                "t": 0.8,
                "side": "far",
                "x": 72,
                "y": 52,
            }]),
            {},
            [],
            context,
        )

        self.assertEqual(timeline["contacts"][-1]["stroke_side"], "forehand")
        self.assertEqual(
            timeline["terminal_features"]["terminal_stroke_side"],
            "forehand",
        )

    def test_timeline_omits_screen_side_when_contact_pose_is_missing(self):
        timeline = build_event_timeline(
            _point(candidates=[{
                "id": "terminal",
                "kind": "contact",
                "t": 0.8,
                "side": "far",
                "x": 900,
                "y": 52,
            }]),
            {},
            [],
            _context(),
        )

        self.assertEqual(timeline["contacts"][-1]["stroke_side"], "unknown")
        self.assertEqual(
            timeline["terminal_features"]["terminal_stroke_side"],
            "unknown",
        )


class TerminalHypothesisTests(unittest.TestCase):
    def test_terminal_evidence_can_stop_before_a_post_point_contact(self):
        base_contacts = [
            {"t": 0.0, "side": "near", "player": "user"},
            {"t": 0.8, "side": "far", "player": "opponent"},
            {"t": 1.7, "side": "near", "player": "user"},
        ]
        timeline = {
            "contacts": base_contacts,
            "contact_count": 3,
            "terminal_features": {
                "near_net_reversal": False,
                "near_net_end": False,
                "crossed_net": True,
                "legal_landing": False,
                "continued_after_net": False,
                "off_table_exit": False,
                "unreturned": False,
                "audio_terminal_support": False,
            },
            "contact_hypotheses": [
                {
                    "contacts": base_contacts[:2],
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
                },
                {
                    "contacts": base_contacts,
                    "contact_count": 3,
                    "terminal_features": {
                        "near_net_reversal": False,
                        "near_net_end": False,
                        "crossed_net": True,
                        "legal_landing": False,
                        "continued_after_net": False,
                        "off_table_exit": False,
                        "unreturned": False,
                        "audio_terminal_support": False,
                    },
                },
            ],
        }

        result = rank_terminal_hypotheses(timeline, _context(winner="user"))

        self.assertEqual(result["prediction"], "net_error")
        self.assertEqual(result["contact_count"], 2)

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


class RunnerContractTests(unittest.TestCase):
    def test_cache_key_changes_with_clip_bytes_and_not_mapping_order(self):
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "point.mp4"
            clip.write_bytes(b"first")
            first = cache_key(clip, {"threshold": 0.5, "step": 3})
            reordered = cache_key(clip, {"step": 3, "threshold": 0.5})
            clip.write_bytes(b"second")
            changed = cache_key(clip, {"threshold": 0.5, "step": 3})

        self.assertEqual(first, reordered)
        self.assertNotEqual(first, changed)

    def test_development_metrics_count_abstentions_as_missing_coverage(self):
        truth = {
            1: {"ending_family": "net_error", "contact_count": 2},
            2: {"ending_family": "long_error", "contact_count": 4},
            3: {"ending_family": "clean_winner", "contact_count": 3},
        }
        predictions = [
            {"idx": 1, "prediction": "net_error", "contact_count": 2},
            {"idx": 2, "prediction": "unclear", "contact_count": 3},
            {"idx": 3, "prediction": "long_error", "contact_count": 3},
        ]

        metrics = score_development(predictions, truth)

        self.assertEqual(metrics["point_count"], 3)
        self.assertAlmostEqual(metrics["coverage"], 2 / 3)
        self.assertAlmostEqual(metrics["covered_accuracy"], 1 / 2)
        self.assertAlmostEqual(metrics["net_recall"], 1.0)
        self.assertAlmostEqual(metrics["contact_exact_accuracy"], 2 / 3)
        self.assertAlmostEqual(metrics["contact_mae"], 1 / 3)

    def test_freeze_writes_hash_for_exact_prediction_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            digest = freeze_holdout_predictions(
                [{"idx": 11, "prediction": "net_error"}],
                destination,
            )
            prediction_path = destination / "holdout-predictions.json"
            digest_path = destination / "holdout-predictions.sha256"

            import hashlib
            observed = hashlib.sha256(prediction_path.read_bytes()).hexdigest()

            self.assertEqual(digest, observed)
            self.assertEqual(digest_path.read_text().strip(), observed)

    def test_existing_destination_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)

            with self.assertRaisesRegex(FileExistsError, "already exists"):
                validate_output_destination(path)


if __name__ == "__main__":
    unittest.main()
