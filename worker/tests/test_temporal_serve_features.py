import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.extract_service_motion_rtmpose import sampled_frame_indices
from worker.temporal_serve_features import (
    PAIRED_FEATURE_WIDTH,
    extract_feature_record,
    feature_cache_key,
    load_feature_record,
    save_feature_record,
    validate_feature_record,
)


def _write_video(path: Path, *, frames: int = 30, fps: float = 30.0) -> None:
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (320, 180),
    )
    if not writer.isOpened():
        raise RuntimeError("test video writer unavailable")
    try:
        for frame in range(frames):
            writer.write(np.full((180, 320, 3), frame, dtype=np.uint8))
    finally:
        writer.release()


class FakePoseModel:
    def __call__(self, _image, boxes):
        keypoints = np.zeros((2, 17, 2), dtype=np.float32)
        scores = np.full((2, 17), 0.95, dtype=np.float32)
        for player, box in enumerate(boxes):
            x1, y1, x2, y2 = box
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            for joint in range(17):
                keypoints[player, joint] = [
                    center_x + (joint % 3) * 3 + player,
                    center_y + (joint % 5) * 2 - player,
                ]
            keypoints[player, 9, 1] -= 15 * player
        return keypoints, scores


def _point(media_sha256: str = "a" * 64) -> dict:
    return {
        "source_id": "source-1",
        "source_match_id": "match-1",
        "source_point_id": "point-1",
        "source_point_idx": 1,
        "media_sha256": media_sha256,
        "calibration": {
            "table_corners_px": {
                "near_left": [70, 130],
                "near_right": [250, 130],
                "far_left": [120, 55],
                "far_right": [200, 55],
            }
        },
        "placement": {
            "hypotheses": {
                "h1": {
                    "shots": [{
                        "phase": "serve",
                        "serve_first_bounce": {"t": 0.45},
                        "landing": {"t": 0.82},
                    }]
                }
            }
        },
    }


class FeatureTests(unittest.TestCase):
    def test_side_view_table_uses_safe_player_regions(self):
        point = _point()
        point["calibration"]["table_corners_px"] = {
            "A_near_1": [0, 179],
            "B_near_2": [0, 80],
            "C_far_2": [319, 100],
            "D_far_1": [319, 179],
        }
        with tempfile.TemporaryDirectory() as raw:
            video = Path(raw) / "side.mp4"
            _write_video(video)
            record = extract_feature_record(
                point=point,
                media_path=video,
                pose_model=FakePoseModel(),
                blurball=lambda _input: {},
                audio=[],
                model_sha256="pose-sha",
            )
        self.assertGreater(float(record["mask"].sum()), 0.0)

    def test_sampled_indices_are_stable_and_bounded(self):
        self.assertEqual(
            sampled_frame_indices(0.2, 0.8, 30.0, 30, 15.0),
            [6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
        )

    def test_extracts_blinded_paired_temporal_features(self):
        with tempfile.TemporaryDirectory() as raw:
            video = Path(raw) / "point.mp4"
            _write_video(video)

            record = extract_feature_record(
                point=_point(),
                media_path=video,
                pose_model=FakePoseModel(),
                blurball=lambda _input: {
                    frame: [160.0 + frame, 90.0 - frame / 2]
                    for frame in range(30)
                },
                audio=[{"time_s": 0.4, "confidence": 2.0}],
                sample_fps=15.0,
                maximum_seconds=12.0,
                model_sha256="pose-sha",
            )

        validate_feature_record(record)
        self.assertEqual(record["features"].shape[1], PAIRED_FEATURE_WIDTH)
        self.assertEqual(record["features"].shape[0], 15)
        self.assertEqual(record["mask"].shape, (15,))
        self.assertGreater(float(record["mask"].sum()), 0)
        serialized = json.dumps(
            {key: value for key, value in record.items() if key not in {"features", "mask"}}
        )
        self.assertNotIn("expected_server_side", serialized)
        self.assertNotIn("first_server", serialized)

    def test_cache_key_changes_with_media_or_model(self):
        base = feature_cache_key(_point("a" * 64), "v1", "model-1")
        media = feature_cache_key(_point("b" * 64), "v1", "model-1")
        model = feature_cache_key(_point("a" * 64), "v1", "model-2")
        self.assertNotEqual(base, media)
        self.assertNotEqual(base, model)

    def test_compressed_cache_round_trips_and_rejects_truth(self):
        record = {
            "schema_version": 1,
            "extractor_version": "temporal-serve-paired-v1",
            "source_id": "source-1",
            "media_sha256": "a" * 64,
            "model_sha256": "pose-sha",
            "sample_fps": 15.0,
            "times_s": [0.0, 0.1],
            "features": np.zeros((2, PAIRED_FEATURE_WIDTH), dtype=np.float32),
            "mask": np.ones(2, dtype=np.float32),
            "ball_events": [],
            "audio_events": [],
            "compute": {"posed_frames": 4},
        }
        with tempfile.TemporaryDirectory() as raw:
            metadata = save_feature_record(Path(raw), record)
            loaded = load_feature_record(metadata)
            np.testing.assert_array_equal(loaded["features"], record["features"])
            np.testing.assert_array_equal(loaded["mask"], record["mask"])

        record["first_server"] = "near"
        with self.assertRaisesRegex(ValueError, "forbidden feature key"):
            validate_feature_record(record)


if __name__ == "__main__":
    unittest.main()
