import json
import unittest
from pathlib import Path

import numpy as np

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


if __name__ == "__main__":
    unittest.main()
