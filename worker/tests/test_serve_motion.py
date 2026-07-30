import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.eval.run_serve_detection_experiment import run_point
from worker.serve_motion import (
    motion_evidence,
    validate_model_provenance,
)


def _point(root: Path) -> dict:
    (root / "ball.jsonl").write_text("")
    (root / "audio.json").write_text("[]")
    (root / "clip.mp4").write_bytes(b"not-used")
    return {
        "point_key": "case-001-point-001",
        "idx": 1,
        "clip_path": "clip.mp4",
        "ball_path": "ball.jsonl",
        "audio_path": "audio.json",
        "fps": 30.0,
        "frame_count": 90,
        "duration": 3.0,
        "calibration_size": [1280, 720],
        "table_corners": [[1, 3], [3, 3], [3, 1], [1, 1]],
        "homography": np.eye(3).tolist(),
        "length_axis": [0.0, -1.0],
    }


def _reconstruction(**_kwargs):
    return {
        "v": 3,
        "status": "unavailable",
        "candidates": [{"kind": "contact", "t": 1.0}],
        "hypotheses": {
            side: {
                "server_side": side,
                "status": "unavailable",
                "score": -4.0,
                "reasons": ["serve_incomplete"],
                "hard_reasons": ["serve_incomplete"],
                "shots": [],
            }
            for side in ("near", "far")
        },
    }


class ProvenanceTests(unittest.TestCase):
    def test_motion_model_rejects_unapproved_license(self):
        with self.assertRaisesRegex(ValueError, "commercial-use allowlist"):
            validate_model_provenance(
                {
                    "name": "RTMDet",
                    "license": "AGPL-3.0",
                    "source_url": "https://example.test/model",
                    "sha256": "a" * 64,
                }
            )

    def test_motion_model_requires_rtmdet_and_sealed_checkpoint(self):
        with self.assertRaisesRegex(ValueError, "RTMDet"):
            validate_model_provenance(
                {
                    "name": "Other detector",
                    "license": "Apache-2.0",
                    "source_url": "https://example.test/model",
                    "sha256": "a" * 64,
                }
            )
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            validate_model_provenance(
                {
                    "name": "RTMDet tiny",
                    "license": "Apache-2.0",
                    "source_url": "https://example.test/model",
                    "sha256": "",
                }
            )


class MotionEvidenceTests(unittest.TestCase):
    def test_missing_runtime_returns_explicit_unavailable_result(self):
        result = motion_evidence(
            Path("missing.mp4"),
            [1.0],
            [[1, 3], [3, 3], [3, 1], [1, 1]],
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "motion_runtime_unavailable")

    def test_motion_arm_preserves_geometry_audio_decision_without_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            point = _point(root)
            geometry_audio = run_point(
                point,
                root,
                "geometry_audio",
                track_runner=lambda *_args: {
                    "segments": [],
                    "bounces": [],
                    "hits": [],
                },
                reconstruction_runner=_reconstruction,
            )
            motion = run_point(
                point,
                root,
                "geometry_audio_motion",
                track_runner=lambda *_args: {
                    "segments": [],
                    "bounces": [],
                    "hits": [],
                },
                reconstruction_runner=_reconstruction,
                motion_runner=None,
            )

        self.assertEqual(motion["server_side"], geometry_audio["server_side"])
        self.assertEqual(motion["status"], geometry_audio["status"])
        self.assertEqual(motion["motion_status"], "unavailable")
        self.assertFalse(motion["motion_changed_decision"])

    def test_checkpoint_file_must_match_declared_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "model.pth"
            checkpoint.write_bytes(b"checkpoint")
            provenance = {
                "name": "RTMDet tiny",
                "license": "Apache-2.0",
                "source_url": "https://example.test/model",
                "sha256": hashlib.sha256(b"different").hexdigest(),
            }
            with self.assertRaisesRegex(ValueError, "hash"):
                validate_model_provenance(
                    provenance,
                    checkpoint_path=checkpoint,
                )


if __name__ == "__main__":
    unittest.main()
