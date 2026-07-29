import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.extract_match_structure_rtmpose import (
    _clip_path,
    extract_evidence,
    point_sample_frames,
    rebase_point_detections,
    validate_evidence,
)
from worker.match_structure import (
    ALGORITHM_VERSION,
    EXPECTED_CHECKPOINT_SHA256,
)


class FrameSelectionTests(unittest.TestCase):
    def test_command_runs_by_file_path_without_importing_worker_daemon(self):
        script = (
            Path(__file__).resolve().parents[1]
            / "extract_match_structure_rtmpose.py"
        )

        result = subprocess.run(
            [sys.executable, str(script), "--help"],
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--clips-dir", result.stdout)

    def test_sparse_three_uses_twenty_fifty_eighty_percent(self):
        self.assertEqual(point_sample_frames(frame_count=101), [20, 50, 80])

    def test_duplicate_rounded_frames_are_deduplicated(self):
        self.assertEqual(point_sample_frames(frame_count=2), [0, 1])

    def test_global_blurball_frames_rebase_into_the_point_clip(self):
        detections = {
            250: (10.0, 20.0),
            275: (11.0, 21.0),
            400: (12.0, 22.0),
        }
        point = {"clip_t0": 10.0, "clip_t1": 12.0}

        self.assertEqual(
            rebase_point_detections(
                detections,
                point,
                source_fps=25.0,
                clip_fps=25.0,
            ),
            {0: (10.0, 20.0), 25: (11.0, 21.0)},
        )

    def test_production_clip_path_keeps_points_subdirectory(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            clip = root / "points" / "01.mp4"
            clip.parent.mkdir()
            clip.write_bytes(b"video")

            self.assertEqual(
                _clip_path(root, {"idx": 1, "clip": "points/01.mp4"}),
                clip,
            )


class EvidenceValidationTests(unittest.TestCase):
    def test_rejects_forbidden_model_provenance(self):
        evidence = {
            "version": 1,
            "status": "ready",
            "algorithm": ALGORITHM_VERSION,
            "model": {
                "family": "YOLO",
                "checkpoint_sha256": EXPECTED_CHECKPOINT_SHA256,
                "profile": "sparse-3",
            },
            "first_server": {"status": "withheld", "side": None},
            "points": [],
            "end_changes": [],
            "coverage": {
                "total": 0,
                "high_confidence": 0,
                "needs_review": 0,
                "unavailable": 0,
            },
            "compute": {"elapsed_s": 0.1},
        }

        with self.assertRaisesRegex(ValueError, "forbidden"):
            validate_evidence(evidence)


class FakePoseModel:
    def __call__(self, image, bboxes):
        del image, bboxes
        keypoints = np.zeros((2, 17, 2), dtype=np.float32)
        scores = np.full((2, 17), 0.9, dtype=np.float32)
        for person, y in enumerate((48.0, 14.0)):
            keypoints[person, :, 0] = np.linspace(20.0, 40.0, 17)
            keypoints[person, :, 1] = y + np.linspace(-4.0, 4.0, 17)
        return keypoints, scores


class ExtractEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.clips = self.root / "clips"
        self.blurball = self.root / "blurball"
        self.clips.mkdir()
        self.blurball.mkdir()
        self.model = self.root / "model.onnx"
        self.model.write_bytes(b"fake model; injected model bypasses loading")

    def tearDown(self):
        self.temp.cleanup()

    def _write_clip(self, idx):
        path = self.clips / f"point-{idx:03d}.mp4"
        writer = cv2.VideoWriter(
            str(path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            25.0,
            (64, 64),
        )
        self.assertTrue(writer.isOpened())
        try:
            for _ in range(8):
                image = np.zeros((64, 64, 3), dtype=np.uint8)
                image[:32, :] = (20, 40, 220)
                image[32:, :] = (200, 50, 30)
                writer.write(image)
        finally:
            writer.release()

    def test_extracts_summaries_without_raw_pose_or_frame_data(self):
        points = []
        for idx in (1, 2, 3):
            self._write_clip(idx)
            (self.blurball / f"point-{idx:03d}.jsonl").write_text(
                "\n".join(
                    json.dumps(
                        {
                            "f": frame,
                            "x": 30.0,
                            "y": 45.0,
                            "conf": 0.9,
                        }
                    )
                    for frame in range(6)
                )
                + "\n"
            )
            points.append(
                {
                    "id": f"point-{idx}",
                    "idx": idx,
                    "t0": float(idx),
                    "t1": float(idx) + 1.0,
                    "clip_path": f"point-{idx:03d}.mp4",
                }
            )
        match = {
            "version": 1,
            "source": {"fps": 25.0, "width": 64, "height": 64},
            "calibration": {
                "ok": True,
                "table_corners_px": {
                    "near_left": [10, 42],
                    "near_right": [54, 42],
                    "far_left": [20, 22],
                    "far_right": [44, 22],
                },
            },
            "points": points,
        }
        match_path = self.root / "match.json"
        match_path.write_text(json.dumps(match))
        output_path = self.root / "evidence.json"

        result = extract_evidence(
            clips_dir=self.clips,
            blurball_dir=self.blurball,
            match_json_path=match_path,
            output_path=output_path,
            model_path=self.model,
            backend="onnxruntime",
            device="cpu",
            pose_model=FakePoseModel(),
            checkpoint_sha256=EXPECTED_CHECKPOINT_SHA256,
        )

        self.assertEqual(result["model"]["family"], "RTMPose")
        self.assertEqual(result["model"]["profile"], "sparse-3")
        self.assertNotIn("poses", result)
        self.assertNotIn("frames", result)
        self.assertTrue(output_path.is_file())
        self.assertFalse(Path(str(output_path) + ".tmp").exists())
        self.assertEqual(len(result["points"]), 3)


if __name__ == "__main__":
    unittest.main()
