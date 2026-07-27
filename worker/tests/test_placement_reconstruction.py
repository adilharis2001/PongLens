import json
import inspect
import math
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, call, patch

import numpy as np

from worker.eval import render_placement_match as report_module
from worker.placement_reconstruction import (
    extract_candidates,
    reconstruct_placement,
    solve_hypothesis,
    split_track_chunks,
)
from worker.points_pipeline import build_placement_v3
from worker.eval.render_placement_match import build_report, render_v3_svg


class CandidateExtractionTests(unittest.TestCase):
    def test_impossible_jump_is_removed_without_destroying_neighboring_track(self):
        detections = {
            0: (100.0, 100.0),
            1: (108.0, 103.0),
            2: (116.0, 106.0),
            3: (124.0, 109.0),
            4: (900.0, 800.0),
            5: (132.0, 112.0),
            6: (140.0, 115.0),
            7: (148.0, 118.0),
            8: (156.0, 121.0),
        }

        chunks = split_track_chunks(
            detections,
            f0=0,
            f1=9,
            width=1000,
            min_points=3,
        )
        kept_frames = [frame for chunk in chunks for frame in chunk]

        self.assertNotIn(4, kept_frames)
        self.assertEqual(kept_frames, [0, 1, 2, 3, 5, 6, 7, 8])

    def test_close_contact_and_bounce_remain_distinct_candidates(self):
        detections = {
            0: (10.0, 10.0),
            1: (20.0, 12.0),
            2: (30.0, 14.0),
            3: (40.0, 17.0),
            4: (50.0, 21.0),
            5: (40.0, 25.0),
            6: (30.0, 20.0),
            7: (20.0, 16.0),
            8: (10.0, 13.0),
            9: (0.0, 11.0),
        }
        fps = 30.0

        candidates = extract_candidates(
            detections,
            H=np.eye(3, dtype=np.float32),
            e=(1.0, 0.0),
            f0=0,
            f1=10,
            fps=fps,
            width=1000,
            audio_impacts=[{"t": 4 / fps, "confidence": 0.9}],
        )
        contacts = [event for event in candidates if event["kind"] == "contact"]
        bounces = [event for event in candidates if event["kind"] == "bounce"]

        self.assertEqual(len(contacts), 1)
        self.assertEqual(len(bounces), 1)
        self.assertNotEqual(contacts[0]["t"], bounces[0]["t"])
        self.assertLess(abs(contacts[0]["t"] - bounces[0]["t"]), 0.09)
        self.assertGreater(contacts[0]["audio_confidence"], 0.0)
        self.assertIsNone(contacts[0]["u"])
        self.assertIsNone(contacts[0]["v"])
        self.assertEqual(contacts[0]["side"], "far")


class ReconstructionTests(unittest.TestCase):
    @staticmethod
    def event(event_id, t, kind, u=None, v=None, side=None):
        return {
            "id": event_id,
            "t": t,
            "kind": kind,
            "u": u,
            "v": v,
            "side": side,
            "visual_confidence": 0.9,
            "audio_confidence": 0.0,
        }

    def test_serve_second_bounce_must_be_on_receiver_half(self):
        candidates = [
            self.event("e1", 1.0, "bounce", u=0.4, v=2.2),
            self.event("e2", 1.3, "bounce", u=0.7, v=0.6),
        ]

        far = solve_hypothesis(candidates, "far", None, [])
        near = solve_hypothesis(candidates, "near", None, [])

        self.assertEqual(far["shots"][0]["phase"], "serve")
        self.assertEqual(far["shots"][0]["landing"]["event_id"], "e2")
        self.assertIn("serve_second_bounce_on_server_half", near["reasons"])
        self.assertNotEqual(near["status"], "ready")

    def test_terminal_out_belongs_to_last_contact_not_previous_landing(self):
        candidates = [
            self.event("s1", 1.0, "bounce", u=0.4, v=2.2),
            self.event("s2", 1.3, "bounce", u=0.7, v=0.6),
            self.event("r1", 1.7, "contact", side="near"),
            self.event("r2", 2.0, "bounce", u=0.8, v=2.1),
            self.event("x1", 2.4, "contact", side="far"),
            self.event("x2", 2.8, "out", side="far"),
        ]

        result = solve_hypothesis(candidates, "far", None, [])

        self.assertEqual(result["shots"][-1]["hitter_side"], "far")
        self.assertEqual(result["shots"][-1]["terminal"]["kind"], "out")
        self.assertIsNone(result["shots"][-1]["landing"])

    def test_unrelated_late_track_chunk_cannot_infer_terminal_out(self):
        candidates = [
            self.event("s1", 1.0, "bounce", u=0.4, v=2.2),
            self.event("s2", 1.3, "bounce", u=0.7, v=0.6),
            self.event("r1", 1.7, "contact", side="near"),
        ]

        result = solve_hypothesis(
            candidates,
            "far",
            None,
            [
                {
                    "t0": 5.0,
                    "t1": 5.5,
                    "start_v": 0.4,
                    "end_v": 3.2,
                }
            ],
        )

        self.assertIsNone(result["shots"][-1]["terminal"])
        self.assertIn("terminal_observation_missing", result["reasons"])

    def test_reconstruction_keeps_both_physical_server_hypotheses(self):
        detections = {
            0: (10.0, 10.0),
            1: (20.0, 12.0),
            2: (30.0, 18.0),
            3: (40.0, 12.0),
            4: (50.0, 10.0),
        }

        placement = reconstruct_placement(
            detections,
            H=np.eye(3, dtype=np.float32),
            e=(1.0, 0.0),
            track={"segments": []},
            suggestion=None,
            f0=0,
            f1=5,
            fps=30.0,
            width=1000,
        )

        self.assertEqual(placement["v"], 3)
        self.assertEqual(set(placement["hypotheses"]), {"near", "far"})


class VaibhabRegressionTests(unittest.TestCase):
    @staticmethod
    def load_fixture():
        path = Path(__file__).parent / "fixtures" / "vaibhab_points.json"
        return json.loads(path.read_text())

    @staticmethod
    def reconstruct_fixture_point(fixture, point):
        detections = {
            int(frame): tuple(coordinates)
            for frame, coordinates in point["detections"].items()
        }
        return reconstruct_placement(
            detections,
            H=np.asarray(fixture["homography"], dtype=np.float32),
            e=tuple(fixture["length_axis"]),
            track=point["track"],
            suggestion=point["suggestion"],
            f0=point["f0"],
            f1=point["f1"],
            fps=fixture["fps"],
            width=fixture["width"],
            audio_impacts=point["audio_impacts"],
        )

    def test_five_narrated_points_never_render_impossible_serve_as_ready(self):
        fixture = self.load_fixture()
        expected_status = {
            1: "ready",
            2: "review",
            3: "review",
            4: "review",
            5: "ready",
        }

        for point in fixture["points"]:
            hypothesis = self.reconstruct_fixture_point(
                fixture, point
            )["hypotheses"][point["server_side"]]
            with self.subTest(point=point["idx"]):
                self.assertNotIn(
                    "serve_second_bounce_on_server_half",
                    hypothesis["reasons"],
                )
                self.assertIn(hypothesis["status"], {"ready", "review"})
                self.assertEqual(
                    hypothesis["status"],
                    expected_status[point["idx"]],
                )
                if hypothesis["hard_reasons"]:
                    self.assertLessEqual(hypothesis["confidence"], 0.69)

    def test_ready_points_match_narrated_terminal_kind(self):
        fixture = self.load_fixture()

        for point in fixture["points"]:
            hypothesis = self.reconstruct_fixture_point(
                fixture, point
            )["hypotheses"][point["server_side"]]
            if hypothesis["status"] != "ready":
                continue
            final_shot = hypothesis["shots"][-1]
            with self.subTest(point=point["idx"]):
                self.assertGreaterEqual(
                    len(hypothesis["shots"]),
                    point["min_shots"],
                )
                self.assertEqual(
                    final_shot["hitter_side"],
                    point["final_hitter_truth"],
                )
                if point["terminal_truth"] == "winner_landing":
                    self.assertIsNone(final_shot["terminal"])
                    self.assertIsNotNone(final_shot["landing"])
                else:
                    self.assertIsNotNone(final_shot["terminal"])
                    self.assertEqual(
                        final_shot["terminal"]["kind"],
                        point["terminal_truth"],
                    )

    def test_same_kind_candidates_are_not_double_counted_one_frame_apart(self):
        fixture = self.load_fixture()

        for point in fixture["points"]:
            candidates = self.reconstruct_fixture_point(
                fixture, point
            )["candidates"]
            for previous, current in zip(candidates, candidates[1:]):
                if previous["kind"] != current["kind"]:
                    continue
                with self.subTest(
                    point=point["idx"],
                    previous=previous["id"],
                    current=current["id"],
                ):
                    self.assertGreater(
                        current["t"] - previous["t"],
                        0.035,
                    )


class PipelineIntegrationTests(unittest.TestCase):
    def test_pipeline_builder_emits_both_server_hypotheses(self):
        detections = {
            0: (10.0, 10.0),
            1: (20.0, 12.0),
            2: (30.0, 18.0),
            3: (40.0, 12.0),
            4: (50.0, 10.0),
        }

        placement = build_placement_v3(
            det=detections,
            H=np.eye(3, dtype=np.float32),
            e=(1.0, 0.0),
            track={"segments": [], "bounces": [], "hits": []},
            suggestion={"winner": "user", "how": "clean winner"},
            f0=0,
            f1=5,
            fps=30.0,
            width=1000,
            audio_impacts=[],
        )

        self.assertEqual(placement["v"], 3)
        self.assertEqual(set(placement["hypotheses"]), {"near", "far"})


class RenderReportTests(unittest.TestCase):
    def test_v3_trajectory_segments_meet_marker_outlines(self):
        hypothesis = {
            "status": "ready",
            "confidence": 0.9,
            "hard_reasons": [],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "near",
                    "landing": {"u": 0.4, "v": 0.8},
                    "terminal": None,
                },
                {
                    "phase": "rally",
                    "hitter_side": "far",
                    "landing": {"u": 1.2, "v": 2.0},
                    "terminal": None,
                },
            ],
        }

        svg = render_v3_svg(hypothesis, "near")
        lines = [
            tuple(map(float, match))
            for match in re.findall(
                r'<line x1="([\d.]+)" y1="([\d.]+)" '
                r'x2="([\d.]+)" y2="([\d.]+)" '
                r'stroke="(?:#22d3ee|#f59e0b)" stroke-width="2" '
                r'opacity="\.82"/>',
                svg,
            )
        ]
        first_marker = report_module._svg_point(0.4, 0.8)
        second_marker = report_module._svg_point(1.2, 2.0)

        self.assertEqual(len(lines), 2)
        self.assertAlmostEqual(
            math.dist(lines[0][2:], first_marker),
            5.0,
            delta=0.15,
        )
        self.assertAlmostEqual(
            math.dist(lines[1][:2], first_marker),
            5.0,
            delta=0.15,
        )
        self.assertAlmostEqual(
            math.dist(lines[1][2:], second_marker),
            5.0,
            delta=0.15,
        )

    def test_point_14_serve_lands_on_near_players_forehand(self):
        hypothesis = {
            "status": "review",
            "confidence": 0.71,
            "hard_reasons": [],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "far",
                    "landing": {"u": 0.5695, "v": 0.5997},
                    "terminal": None,
                }
            ],
        }

        svg = render_v3_svg(hypothesis, "far")

        self.assertIn('cx="140.2"', svg)
        self.assertNotIn('cx="99.8"', svg)

    def test_far_player_view_rotates_the_table_180_degrees(self):
        self.assertIn(
            "bottom_side",
            inspect.signature(render_v3_svg).parameters,
        )
        hypothesis = {
            "status": "review",
            "confidence": 0.71,
            "hard_reasons": [],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "far",
                    "landing": {"u": 0.5695, "v": 0.5997},
                    "terminal": None,
                }
            ],
        }

        svg = render_v3_svg(hypothesis, "far", bottom_side="far")

        self.assertIn('cx="99.8"', svg)
        self.assertIn('cy="97.3"', svg)

    def test_out_terminal_extends_beyond_the_mapped_receiver_edge(self):
        hypothesis = {
            "status": "ready",
            "confidence": 0.9,
            "hard_reasons": [],
            "shots": [
                {
                    "phase": "final",
                    "hitter_side": "near",
                    "landing": {"u": 0.5, "v": 2.0},
                    "terminal": {"kind": "out"},
                }
            ],
        }

        near_bottom = render_v3_svg(
            hypothesis,
            "near",
            bottom_side="near",
        )
        far_bottom = render_v3_svg(
            hypothesis,
            "near",
            bottom_side="far",
        )

        self.assertIn('y2="24.0"', near_bottom)
        self.assertIn('y2="328.0"', far_bottom)

    def test_far_bottom_v3_colors_bottom_player_cyan(self):
        hypothesis = {
            "status": "ready",
            "confidence": 0.9,
            "hard_reasons": [],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "far",
                    "landing": {"u": 0.5, "v": 0.6},
                    "terminal": None,
                }
            ],
        }

        svg = render_v3_svg(hypothesis, "far", bottom_side="far")

        self.assertIn('stroke="#22d3ee"', svg)
        self.assertNotIn('stroke="#f59e0b"', svg)

    def test_far_bottom_v2_colors_bottom_player_cyan(self):
        point = {
            "placement": {
                "v": 2,
                "bounces": [
                    {
                        "seq": 1,
                        "t": 1.0,
                        "u": 0.5,
                        "v": 0.6,
                        "role": "serve_2",
                        "hitter_side": "far",
                    }
                ],
            }
        }

        svg = report_module.render_v2_svg(point, bottom_side="far")

        self.assertIn('fill="#22d3ee"', svg)
        self.assertNotIn('fill="#f59e0b"', svg)

    def test_clip_extraction_uses_exact_point_range(self):
        self.assertTrue(
            hasattr(report_module, "extract_point_clip"),
            "extract_point_clip must be implemented",
        )
        with TemporaryDirectory() as directory:
            root = Path(directory)
            runner = Mock()
            runner.side_effect = lambda command, check: Path(
                command[-1]
            ).write_bytes(b"clip")
            video = root / "source match.mp4"
            output = root / "point-03.mp4"

            report_module.extract_point_clip(
                video,
                output,
                1.25,
                3.75,
                3,
                runner=runner,
            )

            command = runner.call_args.args[0]
            self.assertIn("-ss", command)
            self.assertIn("1.250", command)
            self.assertIn("-t", command)
            self.assertIn("2.500", command)
            self.assertIn("libx264", command)
            self.assertIn("+faststart", command)
            self.assertIn("-pix_fmt", command)
            self.assertIn("yuv420p", command)
            self.assertNotEqual(command[-1], str(output))
            self.assertTrue(output.is_file())
            self.assertFalse((root / ".point-03.tmp.mp4").exists())
            runner.assert_called_once()

    def test_clip_extraction_removes_partial_temporary_file_on_failure(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "point-04.mp4"

            def fail_after_partial_write(command, check):
                Path(command[-1]).write_bytes(b"partial")
                raise report_module.subprocess.CalledProcessError(1, command)

            with self.assertRaisesRegex(RuntimeError, "Point 4"):
                report_module.extract_point_clip(
                    root / "source.mp4",
                    output,
                    2.0,
                    4.0,
                    4,
                    runner=fail_after_partial_write,
                )

            self.assertFalse(output.exists())
            self.assertFalse((root / ".point-04.tmp.mp4").exists())

    def test_clip_extraction_rejects_invalid_range(self):
        self.assertTrue(
            hasattr(report_module, "extract_point_clip"),
            "extract_point_clip must be implemented",
        )
        runner = Mock()

        with self.assertRaisesRegex(ValueError, "Point 7"):
            report_module.extract_point_clip(
                Path("/tmp/source.mp4"),
                Path("/tmp/point-07.mp4"),
                3.0,
                3.0,
                7,
                runner=runner,
            )

        runner.assert_not_called()

    def test_unavailable_hypothesis_svg_suppresses_trajectory(self):
        hypothesis = {
            "status": "unavailable",
            "confidence": 0.3,
            "hard_reasons": [],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "near",
                    "landing": {"u": 0.8, "v": 2.1},
                    "terminal": None,
                }
            ],
        }

        svg = render_v3_svg(hypothesis, "near")

        self.assertIn("Trajectory unavailable", svg)
        self.assertNotIn('stroke="#22d3ee"', svg)

    def test_review_mode_reveals_raw_hard_invalid_trajectory(self):
        self.assertIn(
            "reveal_suppressed",
            inspect.signature(render_v3_svg).parameters,
        )
        hypothesis = {
            "status": "review",
            "confidence": 0.6,
            "hard_reasons": ["serve_second_bounce_on_server_half"],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "near",
                    "landing": {"u": 0.8, "v": 2.1},
                    "terminal": None,
                }
            ],
        }

        svg = render_v3_svg(
            hypothesis,
            "near",
            reveal_suppressed=True,
        )

        self.assertIn("Raw suppressed hypothesis", svg)
        self.assertIn('stroke="#22d3ee"', svg)
        self.assertNotIn("Trajectory suppressed", svg)

    def test_review_mode_uses_raw_serve_first_bounce_geometry(self):
        hypothesis = {
            "status": "review",
            "confidence": 0.6,
            "hard_reasons": ["serve_incomplete"],
            "shots": [
                {
                    "phase": "serve",
                    "hitter_side": "near",
                    "serve_first_bounce": {"u": 0.4, "v": 0.8},
                    "landing": None,
                    "terminal": None,
                }
            ],
        }

        svg = render_v3_svg(
            hypothesis,
            "near",
            reveal_suppressed=True,
        )

        self.assertIn("Raw suppressed hypothesis", svg)
        self.assertIn('stroke="#22d3ee"', svg)
        self.assertIn(">S1</text>", svg)

    def test_review_mode_explains_when_no_raw_geometry_exists(self):
        hypothesis = {
            "status": "review",
            "confidence": 0.6,
            "hard_reasons": ["shot_order_contradiction"],
            "shots": [],
        }

        svg = render_v3_svg(
            hypothesis,
            "near",
            reveal_suppressed=True,
        )

        self.assertIn("No raw geometry available", svg)
        self.assertNotIn("Trajectory suppressed", svg)

    def test_report_defaults_to_strictly_under_seventy_percent(self):
        match = {
            "points": [
                {"idx": 1, "placement": {"v": 2, "bounces": []}},
                {"idx": 2, "placement": {"v": 2, "bounces": []}},
            ]
        }
        reconstructions = [
            {
                "idx": 1,
                "server_side": "near",
                "selection_source": "truth",
                "hypothesis": {
                    "status": "review",
                    "confidence": 0.69,
                    "reasons": ["serve_incomplete"],
                    "shots": [],
                },
                "svg_file": "point-01.svg",
            },
            {
                "idx": 2,
                "server_side": "far",
                "selection_source": "truth",
                "hypothesis": {
                    "status": "review",
                    "confidence": 0.70,
                    "reasons": [],
                    "shots": [],
                },
                "svg_file": "point-02.svg",
            },
        ]

        report = build_report(match, reconstructions)

        self.assertIn('data-confidence-filter="low"', report)
        self.assertIn("Under 70%", report)
        self.assertIn("All points", report)
        self.assertEqual(
            report.count(
                'class="point-row" data-low-confidence="true"'
            ),
            1,
        )
        self.assertEqual(
            report.count(
                'class="point-row" data-low-confidence="false"'
            ),
            1,
        )

    def test_report_contains_every_point_and_both_versions(self):
        match = {
            "points": [
                {"idx": 1, "placement": {"v": 2, "bounces": []}},
                {"idx": 2, "placement": {"v": 2, "bounces": []}},
            ]
        }
        reconstructions = [
            {
                "idx": 1,
                "server_side": "near",
                "selection_source": "truth",
                "hypothesis": {
                    "status": "review",
                    "confidence": 0.6,
                    "reasons": ["serve_incomplete"],
                    "shots": [],
                },
                "svg_file": "point-01.svg",
            },
            {
                "idx": 2,
                "server_side": "far",
                "selection_source": "inferred",
                "hypothesis": {
                    "status": "ready",
                    "confidence": 0.8,
                    "reasons": [],
                    "shots": [],
                },
                "svg_file": "point-02.svg",
            },
        ]

        report = build_report(match, reconstructions)

        self.assertIn("Current v2", report)
        self.assertIn("Placement v3", report)
        self.assertEqual(report.count('class="point-row"'), 2)
        self.assertNotIn("<video ", report)

    def test_report_embeds_one_metadata_only_video_per_point(self):
        match = {
            "points": [
                {"idx": 1, "placement": {"v": 2, "bounces": []}},
                {"idx": 2, "placement": {"v": 2, "bounces": []}},
            ]
        }
        reconstructions = [
            {
                "idx": idx,
                "server_side": "near",
                "selection_source": "truth",
                "hypothesis": {
                    "status": "ready",
                    "confidence": 0.8,
                    "reasons": [],
                    "shots": [],
                },
                "svg_file": f"point-{idx:02d}.svg",
                "video_file": f"point-{idx:02d}.mp4",
            }
            for idx in (1, 2)
        ]

        report = build_report(match, reconstructions)

        self.assertEqual(report.count("<video "), 2)
        self.assertEqual(report.count('preload="metadata"'), 2)
        self.assertNotIn("autoplay", report)
        self.assertIn('src="point-01.mp4"', report)
        self.assertIn('src="point-02.mp4"', report)
        self.assertIn("Point 1 rally video", report)

    def test_generate_report_extracts_and_records_every_point_video(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            match_path = root / "match.json"
            blurball_path = root / "blurball.jsonl"
            video_path = root / "match.mp4"
            output = root / "report"
            match_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "source": {"fps": 30.0, "width": 1920},
                        "side_mapping": {"user": "far"},
                        "calibration": {"length_axis": [0.0, 1.0]},
                        "points": [
                            {
                                "idx": 1,
                                "t0": 0.5,
                                "t1": 3.5,
                                "placement": {"v": 2, "bounces": []},
                            },
                            {
                                "idx": 2,
                                "t0": 11.47,
                                "t1": 15.97,
                                "placement": {"v": 2, "bounces": []},
                            },
                        ],
                    }
                )
            )
            blurball_path.write_text("")
            video_path.write_bytes(b"source")
            hypothesis = {
                "status": "ready",
                "confidence": 0.8,
                "reasons": [],
                "hard_reasons": [],
                "shots": [],
            }
            placement = {
                "v": 3,
                "status": "ready",
                "candidates": [],
                "hypotheses": {
                    "near": hypothesis,
                    "far": hypothesis,
                },
            }

            with (
                patch.object(
                    report_module,
                    "calibration_matrix",
                    return_value=np.eye(3, dtype=np.float32),
                ),
                patch.object(
                    report_module,
                    "fit_play",
                    return_value={
                        "segments": [],
                        "bounces": [],
                        "hits": [],
                    },
                ),
                patch.object(
                    report_module,
                    "reconstruct_placement",
                    return_value=placement,
                ),
                patch.object(report_module, "extract_point_clip") as extract,
            ):
                results = report_module.generate_report(
                    match_path,
                    blurball_path,
                    output,
                    video_path=video_path,
                )

            self.assertEqual(
                extract.call_args_list,
                [
                    call(
                        video_path,
                        output / "point-01.mp4",
                        0.5,
                        3.5,
                        1,
                    ),
                    call(
                        video_path,
                        output / "point-02.mp4",
                        11.47,
                        15.97,
                        2,
                    ),
                ],
            )
            self.assertEqual(
                [result["video_file"] for result in results],
                ["point-01.mp4", "point-02.mp4"],
            )
            self.assertEqual(
                [result.get("bottom_side") for result in results],
                ["far", "far"],
            )
            reconstructed = json.loads(
                (output / "reconstructed-match.json").read_text()
            )
            self.assertEqual(
                [point["video_file"] for point in reconstructed["points"]],
                ["point-01.mp4", "point-02.mp4"],
            )

    def test_generate_report_preserves_maps_when_one_clip_fails(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            match_path = root / "match.json"
            blurball_path = root / "blurball.jsonl"
            video_path = root / "match.mp4"
            output = root / "report"
            output.mkdir()
            stale_clip = output / "point-02.mp4"
            stale_clip.write_bytes(b"stale")
            match_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "source": {"fps": 30.0, "width": 1920},
                        "calibration": {"length_axis": [0.0, 1.0]},
                        "points": [
                            {
                                "idx": 1,
                                "t0": 0.5,
                                "t1": 3.5,
                                "placement": {"v": 2, "bounces": []},
                            },
                            {
                                "idx": 2,
                                "t0": 11.47,
                                "t1": 15.97,
                                "placement": {"v": 2, "bounces": []},
                            },
                        ],
                    }
                )
            )
            blurball_path.write_text("")
            video_path.write_bytes(b"source")
            hypothesis = {
                "status": "ready",
                "confidence": 0.8,
                "reasons": [],
                "hard_reasons": [],
                "shots": [],
            }
            placement = {
                "v": 3,
                "status": "ready",
                "candidates": [],
                "hypotheses": {
                    "near": hypothesis,
                    "far": hypothesis,
                },
            }

            with (
                patch.object(
                    report_module,
                    "calibration_matrix",
                    return_value=np.eye(3, dtype=np.float32),
                ),
                patch.object(
                    report_module,
                    "fit_play",
                    return_value={
                        "segments": [],
                        "bounces": [],
                        "hits": [],
                    },
                ),
                patch.object(
                    report_module,
                    "reconstruct_placement",
                    return_value=placement,
                ),
                patch.object(
                    report_module,
                    "extract_point_clip",
                    side_effect=[
                        None,
                        RuntimeError("Point 2 <clip> failed"),
                    ],
                ),
            ):
                results = report_module.generate_report(
                    match_path,
                    blurball_path,
                    output,
                    video_path=video_path,
                )

            self.assertEqual(len(results), 2)
            self.assertEqual(results[0]["video_file"], "point-01.mp4")
            self.assertNotIn("video_file", results[1])
            self.assertEqual(
                results[1]["video_error"],
                "Point 2 <clip> failed",
            )
            self.assertFalse(stale_clip.exists())
            report = (output / "index.html").read_text()
            self.assertEqual(report.count('class="point-row"'), 2)
            self.assertEqual(report.count("<video "), 1)
            self.assertIn("Video unavailable", report)
            self.assertIn("Point 2 &lt;clip&gt; failed", report)

    def test_generate_report_rejects_missing_video_before_processing(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            missing_video = root / "missing.mp4"

            with self.assertRaisesRegex(
                FileNotFoundError,
                "missing.mp4",
            ):
                report_module.generate_report(
                    root / "missing-match.json",
                    root / "missing-blurball.jsonl",
                    root / "report",
                    video_path=missing_video,
                )


if __name__ == "__main__":
    unittest.main()
