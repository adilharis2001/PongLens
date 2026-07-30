import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from worker.eval.render_table_calibration_experiment import (
    render_report,
    run_structure,
)


MATCH_ID = "5721edd0-a80e-4eb8-a605-a6d3c8dbe41f"
CORNERS = [
    [131.0, 116.0],
    [96.0, 96.0],
    [179.0, 77.0],
    [221.0, 83.0],
]


def build_case(root: Path) -> tuple[dict, dict]:
    case_root = root / "cases" / MATCH_ID
    images_dir = case_root / "images"
    clips_dir = case_root / "clips"
    images_dir.mkdir(parents=True)
    clips_dir.mkdir()
    image = np.full((180, 320, 3), 45, dtype=np.uint8)
    for name in (
        "background.jpg",
        "representative-1.jpg",
        "representative-2.jpg",
    ):
        cv2.imwrite(str(images_dir / name), image)
    (clips_dir / "point-001.mp4").write_bytes(b"clip")
    (case_root / "blurball.jsonl").write_text('{"f":1,"x":300,"y":180}\n')
    match = {
        "version": 1,
        "source": {"width": 640, "height": 360, "fps": 30},
        "calibration": {"ok": False},
        "points": [{"idx": 1, "t0": 1.0, "t1": 2.0}],
    }
    match_path = case_root / "match.json"
    match_path.write_text(json.dumps(match))
    case = {
        "match_id": MATCH_ID,
        "root": f"cases/{MATCH_ID}",
        "source_size": [640, 360],
        "image_size": [320, 180],
        "match_json": "match.json",
        "blurball": "blurball.jsonl",
        "clips": "clips",
        "images": [
            {"path": f"images/{name}", "sha256": f"hash-{index}"}
            for index, name in enumerate(
                (
                    "background.jpg",
                    "representative-1.jpg",
                    "representative-2.jpg",
                )
            )
        ],
        "points": [
            {
                "idx": 1,
                "id": "point-1",
                "confirmed_winner": "user",
                "is_let": False,
                "game_end_override": None,
            }
        ],
        "truth": {
            "first_server": "user",
            "first_server_source": "user",
            "user_side": "near",
            "existing_structure": {"status": "failed"},
        },
    }
    result = {
        "match_id": MATCH_ID,
        "trials": [
            {
                "status": "completed",
                "proposal": {
                    "corners": {
                        name: point
                        for name, point in zip(
                            (
                                "A_near_1",
                                "B_near_2",
                                "C_far_2",
                                "D_far_1",
                            ),
                            CORNERS,
                        )
                    }
                },
                "response_id": "private-provider-response",
                "validation": {"accepted": True},
            }
        ],
        "consensus": {"accepted": True, "corners": CORNERS},
        "calibration": {
            "accepted": True,
            "reason": None,
            "corners": CORNERS,
            "scores": {
                "edge_support": 0.75,
                "activity_overlap": 0.5,
                "projected_on_table_ratio": 0.8,
            },
        },
        "accuracy": {
            "status": "passes_reference_gate",
            "median_ratio": 0.01,
            "maximum_ratio": 0.02,
        },
        "provider": {
            "model": "gpt-5.6-sol",
            "estimated_usd": 0.0021,
        },
    }
    return case, result


class DownstreamTests(unittest.TestCase):
    def test_accepted_calibration_runs_against_a_copy_of_match_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case, result = build_case(root)
            original = root / case["root"] / case["match_json"]
            before = original.read_bytes()
            captured = {}

            def runner(command, **_kwargs):
                captured["command"] = command
                output = Path(command[command.index("--output") + 1])
                output.write_text(
                    json.dumps(
                        {
                            "status": "ready",
                            "first_server": {
                                "status": "high_confidence",
                                "side": "near",
                            },
                            "end_changes": [
                                {
                                    "after_idx": 18,
                                    "before_idx": 19,
                                    "confirmed_at_idx": 20,
                                }
                            ],
                            "coverage": {
                                "total": 1,
                                "high_confidence": 1,
                                "needs_review": 0,
                                "unavailable": 0,
                            },
                            "compute": {
                                "elapsed_s": 1.2,
                                "inference_s": 0.8,
                            },
                        }
                    )
                )
                return SimpleNamespace(returncode=0, stderr="")

            downstream = run_structure(
                case,
                result["calibration"],
                root,
                rtmpose_python=Path("/tmp/rtmpose-python"),
                rtmpose_model=Path("/tmp/rtmpose-model.onnx"),
                command_runner=runner,
            )

            self.assertEqual(original.read_bytes(), before)
            command = captured["command"]
            self.assertIn("--match-json", command)
            self.assertIn("--blurball", command)
            local_match = json.loads(
                Path(command[command.index("--match-json") + 1]).read_text()
            )
            self.assertTrue(local_match["calibration"]["ok"])
            self.assertEqual(
                local_match["calibration"]["table_corners_px"][
                    "A_near_1"
                ],
                [262.0, 232.0],
            )
            self.assertEqual(downstream["status"], "ready")
            self.assertEqual(
                downstream["evidence"]["first_server"]["side"],
                "near",
            )

    def test_rejected_calibration_never_runs_pose(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case, _ = build_case(root)

            downstream = run_structure(
                case,
                {"accepted": False, "reason": "unstable_proposals"},
                root,
                rtmpose_python=Path("/tmp/rtmpose-python"),
                rtmpose_model=Path("/tmp/rtmpose-model.onnx"),
                command_runner=lambda *_args, **_kwargs: self.fail(
                    "pose must not run"
                ),
            )

            self.assertEqual(downstream["status"], "not_run")
            self.assertEqual(downstream["reason"], "unstable_proposals")


class ReportTests(unittest.TestCase):
    def test_report_separates_calibration_from_pose_and_sanitizes_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case, result = build_case(root)
            result["reference"] = {
                "corners": {
                    name: point
                    for name, point in zip(
                        (
                            "A_near_1",
                            "B_near_2",
                            "C_far_2",
                            "D_far_1",
                        ),
                        CORNERS,
                    )
                }
            }
            result["downstream"] = {
                "status": "ready",
                "evidence": {
                    "first_server": {
                        "status": "high_confidence",
                        "side": "near",
                    },
                    "end_changes": [],
                    "coverage": {"total": 1, "high_confidence": 1},
                    "compute": {"elapsed_s": 1.2, "inference_s": 0.8},
                },
            }
            cases = {"cases": [case]}
            results = {"version": 1, "cases": [result]}

            index = render_report(cases, results, root)

            html = index.read_text()
            data = (index.parent / "report-data.json").read_text()
            self.assertIn("Calibration result", html)
            self.assertIn("RTMPose result", html)
            self.assertIn("First-server agreement", html)
            self.assertIn("Correct", html)
            self.assertIn("Reference", html)
            self.assertIn("Accepted consensus", html)
            self.assertIn(
                "not a statistically representative accuracy study",
                html,
            )
            self.assertNotIn("private-provider-response", html)
            self.assertNotIn("private-provider-response", data)
            self.assertNotIn("r2://", data)
            self.assertTrue(
                (
                    index.parent
                    / "assets"
                    / MATCH_ID
                    / "background-overlay.jpg"
                ).is_file()
            )


if __name__ == "__main__":
    unittest.main()
