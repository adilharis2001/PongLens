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
                            }
                        ],
                    },
                    "geometry_audio": {
                        "summary": {"total": 1, "high_confidence": 1},
                        "points": [
                            {
                                "point_key": "case-001-point-001",
                                "status": "high_confidence",
                                "server_side": "near",
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

        self.assertIn("Geometry + audio", html)
        self.assertIn("Mark actual serve", html)
        self.assertIn("Export references", html)
        self.assertIn("localStorage", html)
        self.assertNotIn("first_server", report_data)
        self.assertNotIn("confirmed_winner", report_data)
        self.assertNotIn('"name"', report_data)
        self.assertIn('"component": "OpenCV"', report_data)

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
