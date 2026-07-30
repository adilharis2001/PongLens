import json
import tempfile
import unittest
from pathlib import Path

from worker.eval import render_placement_calibration_comparison as renderer
from worker.eval.render_placement_calibration_comparison import render_report


class PlacementCalibrationReportTests(unittest.TestCase):
    def test_point_contexts_follow_game_server_and_side_alternation(self):
        prepared = {
            "truth": {
                "first_server": "user",
                "first_server_source": "user",
                "user_side": "near",
            },
            "points": [
                {
                    "idx": 1,
                    "t0": 1.0,
                    "is_let": False,
                    "confirmed_winner": "user",
                    "game_end_override": "end",
                    "server_override": None,
                },
                {
                    "idx": 2,
                    "t0": 2.0,
                    "is_let": False,
                    "confirmed_winner": "opponent",
                    "game_end_override": None,
                    "server_override": None,
                },
            ],
        }

        point_contexts = getattr(renderer, "_point_contexts", None)
        self.assertIsNotNone(point_contexts)
        contexts = point_contexts(prepared)

        self.assertEqual(
            contexts[1],
            {
                "server": "user",
                "server_source": "rotation",
                "user_side": "near",
                "opponent_side": "far",
                "game_number": 1,
            },
        )
        self.assertEqual(
            contexts[2],
            {
                "server": "opponent",
                "server_source": "rotation",
                "user_side": "far",
                "opponent_side": "near",
                "game_number": 2,
            },
        )

    def test_report_renders_sanitized_paired_review_with_point_video(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case_root = root / "cases" / "private-match-id"
            (case_root / "images").mkdir(parents=True)
            (case_root / "clips").mkdir()
            (case_root / "images" / "representative-1.jpg").write_bytes(
                b"jpeg"
            )
            (case_root / "clips" / "point-018.mp4").write_bytes(b"video")
            cases = {
                "cases": [
                    {
                        "match_id": "private-match-id",
                        "root": "cases/private-match-id",
                        "image_size": [320, 180],
                        "source_size": [640, 360],
                        "truth": {
                            "first_server": "user",
                            "first_server_source": "user",
                            "user_side": "near",
                        },
                        "points": [
                            {
                                "idx": 18,
                                "t0": 18.0,
                                "is_let": False,
                                "confirmed_winner": "user",
                                "game_end_override": None,
                                "server_override": None,
                            }
                        ],
                        "images": [
                            {"path": "images/background.jpg", "sha256": "a"},
                            {
                                "path": "images/representative-1.jpg",
                                "sha256": "b",
                            },
                            {
                                "path": "images/representative-2.jpg",
                                "sha256": "c",
                            },
                        ],
                    }
                ]
            }
            comparison = {
                "version": 1,
                "model": "gpt-5.6-sol",
                "summary": {
                    "matches": 1,
                    "accepted_openai_calibrations": 1,
                    "matched_landings": 10,
                    "zone_flips": 1,
                    "zone_flip_rate": {"numerator": 1, "denominator": 10},
                    "estimated_usd": 0.07,
                },
                "cases": [
                    {
                        "match_id": "private-match-id",
                        "source_size": [640, 360],
                        "image_size": [320, 180],
                        "representative_image": "images/representative-1.jpg",
                        "current_calibration": {
                            "ok": True,
                            "table_corners_px": {
                                "A_near_1": [260, 232],
                                "B_near_2": [192, 192],
                                "C_far_2": [358, 154],
                                "D_far_1": [442, 166],
                            },
                        },
                        "proposed_calibration": {
                            "ok": True,
                            "table_corners_px": {
                                "A_near_1": [264, 234],
                                "B_near_2": [196, 194],
                                "C_far_2": [362, 156],
                                "D_far_1": [446, 168],
                            },
                        },
                        "corner_displacement": {
                            "status": "measured",
                            "median_px": 4.47,
                            "maximum_px": 4.47,
                            "median_frame_diagonal_ratio": 0.0061,
                        },
                        "openai": {
                            "consensus": {
                                "accepted": True,
                                "median_drift_ratio": 0.003,
                                "maximum_drift_ratio": 0.01,
                            },
                            "calibration": {
                                "accepted": True,
                                "scores": {"edge_support": 0.8},
                            },
                            "provider": {
                                "estimated_usd": 0.07,
                                "response_id": "must-not-leak",
                            },
                        },
                        "placement": {
                            "current_status": {
                                "ready": 8,
                                "review": 2,
                                "unavailable": 0,
                            },
                            "proposed_status": {
                                "ready": 9,
                                "review": 1,
                                "unavailable": 0,
                            },
                            "current_trusted_landings": 10,
                            "proposed_trusted_landings": 11,
                            "matched_landings": 10,
                            "current_only_landings": 0,
                            "proposed_only_landings": 1,
                            "displacement_cm": {
                                "median": 3.2,
                                "p90": 8.1,
                                "maximum": 10.0,
                            },
                            "lateral_flips": 1,
                            "depth_flips": 0,
                            "zone_flips": 1,
                            "zone_flip_rate": {
                                "numerator": 1,
                                "denominator": 10,
                            },
                            "boundary_entries": 1,
                            "boundary_exits": 0,
                            "current_zones": {"medium_left": 10},
                            "proposed_zones": {
                                "medium_left": 9,
                                "medium_middle": 2,
                            },
                            "changed_points": [
                                {
                                    "identity": {
                                        "match_id": "private-match-id",
                                        "point_idx": 18,
                                        "server_side": "near",
                                        "shot_seq": 1,
                                        "phase": "serve",
                                        "hitter_side": "near",
                                    },
                                    "displacement_cm": 10.0,
                                    "clip": "clips/point-018.mp4",
                                    "current": {
                                        "u": 0.49,
                                        "v": 2.0,
                                        "zone": "medium_left",
                                    },
                                    "proposed": {
                                        "u": 0.59,
                                        "v": 2.0,
                                        "zone": "medium_middle",
                                    },
                                }
                            ],
                        },
                    }
                ],
            }
            historical = {
                "cases": [
                    {
                        "match_id": "historical-a",
                        "image_sha256": ["one", "two", "three"],
                        "accuracy": {
                            "status": "passes_reference_gate",
                            "median_ratio": 0.002,
                            "maximum_ratio": 0.009,
                        },
                        "calibration": {"accepted": True},
                    },
                    {
                        "match_id": "historical-duplicate",
                        "image_sha256": ["one", "two", "three"],
                        "accuracy": {
                            "status": "passes_reference_gate",
                            "median_ratio": 0.002,
                            "maximum_ratio": 0.009,
                        },
                        "calibration": {"accepted": True},
                    },
                ]
            }
            report_dir = root / "report"

            html, report_data = render_report(
                cases,
                comparison,
                root,
                report_dir,
                historical=historical,
            )

            self.assertIn("Comparison, not ground truth", html)
            self.assertIn("Current calibration", html)
            self.assertIn("OpenAI consensus", html)
            self.assertIn("1 / 10 matched landings changed zone", html)
            self.assertIn("Point 18", html)
            self.assertIn('preload="metadata"', html)
            self.assertIn("Current map", html)
            self.assertIn("OpenAI map", html)
            self.assertIn("System’s scored server", html)
            self.assertIn("You served", html)
            self.assertIn("You · near / bottom", html)
            self.assertIn("Chris · far / top", html)
            self.assertIn("Uses the You-serving hypothesis", html)
            self.assertIn("Matches scored server", html)
            self.assertIn("Receiver-relative landing", html)
            self.assertIn("1 distinct historical frame set", html)
            self.assertIn("1 duplicate excluded", html)
            self.assertNotIn("private-match-id", html)
            self.assertNotIn("historical-a", html)
            self.assertNotIn("must-not-leak", html)
            self.assertNotIn(str(root), html)
            self.assertNotIn("r2://", html)
            self.assertEqual(report_data["summary"]["matches"], 1)
            self.assertEqual(
                report_data["cases"][0]["label"],
                "Chris Match 1",
            )
            changed = report_data["cases"][0]["changed_points"][0]
            self.assertEqual(changed["resolved_server"], "user")
            self.assertEqual(changed["server_source"], "rotation")
            self.assertEqual(changed["user_side"], "near")
            self.assertEqual(changed["opponent_side"], "far")
            self.assertEqual(changed["hypothesis_player"], "user")
            self.assertTrue(changed["hypothesis_matches_server"])
            self.assertTrue(
                (report_dir / "assets" / "match-1-frame.jpg").is_file()
            )
            self.assertTrue(
                (
                    report_dir
                    / "assets"
                    / "match-1-point-018.mp4"
                ).is_file()
            )
            self.assertEqual(
                json.loads((report_dir / "report-data.json").read_text()),
                report_data,
            )

    def test_withheld_openai_calibration_renders_honestly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case_root = root / "cases" / "m1" / "images"
            case_root.mkdir(parents=True)
            (case_root / "representative-1.jpg").write_bytes(b"jpeg")
            cases = {
                "cases": [
                    {
                        "match_id": "m1",
                        "root": "cases/m1",
                        "image_size": [320, 180],
                        "source_size": [640, 360],
                    }
                ]
            }
            comparison = {
                "summary": {
                    "matches": 1,
                    "accepted_openai_calibrations": 0,
                    "matched_landings": 0,
                    "zone_flips": 0,
                    "zone_flip_rate": {"numerator": 0, "denominator": 0},
                    "estimated_usd": 0.0,
                },
                "cases": [
                    {
                        "match_id": "m1",
                        "source_size": [640, 360],
                        "image_size": [320, 180],
                        "representative_image": "images/representative-1.jpg",
                        "current_calibration": {"ok": False},
                        "proposed_calibration": None,
                        "corner_displacement": {
                            "status": "proposed_unavailable"
                        },
                        "openai": {
                            "consensus": {
                                "accepted": False,
                                "reason": "unstable_proposals",
                            },
                            "calibration": {"accepted": False},
                            "provider": {},
                        },
                        "placement": {
                            "matched_landings": 0,
                            "zone_flips": 0,
                            "zone_flip_rate": {
                                "numerator": 0,
                                "denominator": 0,
                            },
                            "current_zones": {},
                            "proposed_zones": {},
                            "changed_points": [],
                            "displacement_cm": {
                                "median": None,
                                "p90": None,
                                "maximum": None,
                            },
                        },
                    }
                ],
            }

            html, _ = render_report(
                cases,
                comparison,
                root,
                root / "report",
            )

            self.assertIn("OpenAI calibration withheld", html)
            self.assertIn("unstable proposals", html)


if __name__ == "__main__":
    unittest.main()
