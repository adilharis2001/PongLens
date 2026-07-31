"""Bounded top-down RTMPose extraction for service-motion experiments."""

from __future__ import annotations

import math
from pathlib import Path
import resource
import sys
import time
from typing import Any, Mapping, Sequence

import cv2
import numpy as np


def sampled_frame_indices(
    start_s: float,
    end_s: float,
    fps: float,
    frame_count: int,
    sample_fps: float,
) -> list[int]:
    """Return stable source-frame indices for one bounded time interval."""

    if fps <= 0 or sample_fps <= 0 or frame_count <= 0:
        raise ValueError("fps, sample fps, and frame count must be positive")
    if start_s < 0 or end_s < start_s:
        raise ValueError("sample interval must be non-negative and ordered")
    start = max(0, int(math.ceil(start_s * fps)))
    end = min(frame_count - 1, int(math.floor(end_s * fps)))
    if end < start:
        return []
    step = max(1, int(round(fps / sample_fps)))
    return list(range(start, end + 1, step))


def window_frame_indices(
    first_bounce_t: float,
    fps: float,
    frame_count: int,
    sample_fps: float = 15.0,
) -> list[int]:
    if fps <= 0 or sample_fps <= 0 or frame_count <= 0:
        raise ValueError("fps, sample fps, and frame count must be positive")
    if first_bounce_t < 0:
        raise ValueError("first bounce time must be non-negative")
    extended_start = max(
        0,
        int(math.ceil((first_bounce_t - 1.2) * fps)),
    )
    core_start = max(
        0,
        int(math.ceil((first_bounce_t - 1.0) * fps)),
    )
    end = min(
        frame_count - 1,
        int(math.floor((first_bounce_t + 0.1) * fps)),
    )
    step = max(1, int(round(fps / sample_fps)))
    start = core_start
    while start - step >= extended_start:
        start -= step
    if end < start:
        return []
    return list(range(start, end + 1, step))


def _peak_rss_mb() -> float:
    raw = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    divisor = 1024.0 * 1024.0 if sys.platform == "darwin" else 1024.0
    return round(max(0.0, raw / divisor), 3)


class _MMPoseAdapter:
    def __init__(self, model: Any, inference_topdown: Any):
        self.model = model
        self.inference_topdown = inference_topdown

    def __call__(
        self,
        image: np.ndarray,
        bboxes: Sequence[Sequence[float]],
    ) -> tuple[np.ndarray, np.ndarray]:
        results = self.inference_topdown(
            self.model,
            image,
            bboxes=np.asarray(bboxes, dtype=np.float32),
        )
        keypoints = []
        scores = []
        for result in results:
            instances = result.pred_instances
            points = np.asarray(instances.keypoints)
            confidence = np.asarray(instances.keypoint_scores)
            if points.ndim == 3:
                points = points[0]
            if confidence.ndim == 2:
                confidence = confidence[0]
            keypoints.append(points)
            scores.append(confidence)
        return np.asarray(keypoints), np.asarray(scores)


def create_pose_model(
    config_path: Path,
    checkpoint_path: Path,
    device: str = "mps",
) -> Any:
    try:
        from mmpose.apis import inference_topdown, init_model
    except ImportError as error:
        raise RuntimeError(
            "MMPose is required; run bootstrap_service_motion_rtmpose.py"
        ) from error
    model = init_model(
        str(config_path),
        str(checkpoint_path),
        device=device,
    )
    return _MMPoseAdapter(model, inference_topdown)


def _player_summary(
    box: Sequence[float],
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> dict[str, Any]:
    return {
        "bbox": [round(float(value), 4) for value in box],
        "kpts": [
            [
                round(float(point[0]), 4),
                round(float(point[1]), 4),
                round(float(score), 4),
            ]
            for point, score in zip(keypoints, scores)
        ],
    }


def extract_pose_window(
    video_path: Path,
    frame_indices: Sequence[int],
    regions: Mapping[str, Sequence[float]],
    pose_model: Any,
) -> tuple[dict[int, dict[str, dict[str, Any]]], dict[str, Any]]:
    """Decode only requested frames and retain compact COCO-17 summaries."""

    if set(regions) != {"near", "far"}:
        raise ValueError("near and far player regions are required")
    requested = sorted({int(frame) for frame in frame_indices if frame >= 0})
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"could not open pose source clip: {video_path}")
    started = time.perf_counter()
    inference_s = 0.0
    decoded = 0
    posed = 0
    output: dict[int, dict[str, dict[str, Any]]] = {}
    sides = ("near", "far")
    boxes = [list(regions[side]) for side in sides]
    try:
        for frame in requested:
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame)
            ok, image = capture.read()
            if not ok or image is None:
                continue
            decoded += 1
            inference_started = time.perf_counter()
            keypoints, scores = pose_model(image, boxes)
            inference_s += time.perf_counter() - inference_started
            if len(keypoints) != len(boxes) or len(scores) != len(boxes):
                continue
            output[frame] = {
                side: _player_summary(
                    box,
                    np.asarray(keypoints[index]),
                    np.asarray(scores[index]),
                )
                for index, (side, box) in enumerate(zip(sides, boxes))
            }
            posed += len(output[frame])
    finally:
        capture.release()
    return output, {
        "decoded_frames": decoded,
        "posed_frames": posed,
        "inference_s": round(inference_s, 6),
        "elapsed_s": round(time.perf_counter() - started, 6),
        "peak_rss_mb": _peak_rss_mb(),
    }
