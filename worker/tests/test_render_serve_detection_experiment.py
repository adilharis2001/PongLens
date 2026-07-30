import json
import tempfile
import unittest
from pathlib import Path

from worker.eval.render_serve_detection_experiment import (
    copy_asset,
    render_report,
)


class ServeDetectionReportTests(unittest.TestCase):
    def test_report_exposes_ablation_and_blind_label_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clip = root / "clips" / "case-001-point-001.mp4"
            clip.parent.mkdir()
            clip.write_bytes(b"test-video")
            cases = {
                "version": 1,
                "cases": [
                    {
                        "case_key": "case-001",
                        "points": [
                            {
                                "point_key": "case-001-point-001",
                                "idx": 1,
                                "clip_path": "clips/case-001-point-001.mp4",
                                "duration": 4.0,
                                "table_corners": [
                                    [1, 3],
                                    [3, 3],
                                    [3, 1],
                                    [1, 1],
                                ],
                            }
                        ],
                    }
                ],
            }
            results = {
                "run_id": "serve-dev-v1",
                "dependency_ledger": [
                    {
                        "name": "OpenCV",
                        "version": "4.0",
                        "license": "Apache-2.0",
                    }
                ],
                "arms": {
                    "geometry": {
                        "summary": {"total": 1, "high_confidence": 0},
                        "points": [
                            {
                                "point_key": "case-001-point-001",
                                "status": "needs_review",
                                "server_side": None,
                                "reconstruction": {
                                    "candidates": [
                                        {
                                            "kind": "bounce",
                                            "t": 2.6,
                                            "visual_confidence": 0.82,
                                        },
                                        {
                                            "kind": "impact",
                                            "t": 0.2,
                                            "audio_confidence": 12.0,
                                        },
                                        {
                                            "kind": "bounce",
                                            "t": 2.7,
                                            "visual_confidence": 0.4,
                                        },
                                        {
                                            "kind": "contact",
                                            "t": 3.1,
                                            "visual_confidence": 0.75,
                                        },
                                        {
                                            "kind": "bounce",
                                            "t": 3.8,
                                            "visual_confidence": 0.7,
                                        },
                                        {
                                            "kind": "bounce",
                                            "t": 4.4,
                                            "visual_confidence": 0.6,
                                        },
                                        {
                                            "kind": "bounce",
                                            "t": 4.9,
                                            "visual_confidence": 0.5,
                                        },
                                    ]
                                },
                            }
                        ],
                    },
                    "geometry_audio": {
                        "summary": {"total": 1, "high_confidence": 1},
                        "points": [
                            {
                                "point_key": "case-001-point-001",
                                "status": "needs_review",
                                "server_side": None,
                                "serve": {
                                    "contact_t": 1.2,
                                    "first_bounce": {"t": 1.4},
                                    "second_bounce": {"t": 1.8},
                                },
                            }
                        ],
                    },
                },
            }

            output = render_report(
                cases,
                results,
                root / "report",
                source_root=root,
            )
            html = (output / "index.html").read_text()
            report_data = (output / "report-data.json").read_text()
            report_payload = json.loads(report_data)

        self.assertIn("Geometry + audio", html)
        self.assertIn("Mark actual serve", html)
        self.assertIn("Export references", html)
        self.assertIn("localStorage", html)
        self.assertIn("Jump to likely action", html)
        self.assertIn("actionTime - 0.6", html)
        self.assertIn('cache:"no-store"', html)
        self.assertIn('video.setAttribute("src"', html)
        self.assertNotIn("first_server", report_data)
        self.assertNotIn("confirmed_winner", report_data)
        self.assertNotIn('"name"', report_data)
        self.assertIn('"component": "OpenCV"', report_data)
        actions = report_payload["points"][0]["likely_actions"]
        self.assertLessEqual(len(actions), 4)
        self.assertEqual(
            [action["t"] for action in actions],
            [2.6, 3.1, 3.8, 4.4],
        )
        self.assertTrue(
            all(action["source"] == "visual" for action in actions)
        )

    def test_assets_cannot_escape_report_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report"
            report.mkdir()

            with self.assertRaisesRegex(ValueError, "escapes"):
                copy_asset(
                    report,
                    Path("../../private.mp4"),
                    source_root=root,
                )

    def test_report_data_contains_only_anonymous_point_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "clip.mp4").write_bytes(b"video")
            cases = {
                "cases": [
                    {
                        "case_key": "case-001",
                        "points": [
                            {
                                "point_key": "case-001-point-001",
                                "idx": 1,
                                "clip_path": "clip.mp4",
                                "match_id": "private-match-id",
                            }
                        ],
                    }
                ]
            }
            results = {"run_id": "v1", "arms": {}}

            output = render_report(
                cases,
                results,
                root / "report",
                source_root=root,
            )
            payload = json.loads(
                (output / "report-data.json").read_text()
            )
            serialized = json.dumps(payload)

        self.assertIn("case-001-point-001", serialized)
        self.assertNotIn("private-match-id", serialized)


if __name__ == "__main__":
    unittest.main()
