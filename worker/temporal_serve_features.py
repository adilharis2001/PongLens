"""Blinded paired-player temporal features for serve-action learning."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import cv2
import numpy as np

from worker.extract_service_motion_rtmpose import (
    extract_pose_window,
    sampled_frame_indices,
)
from worker.match_structure import build_player_regions


SCHEMA_VERSION = 1
EXTRACTOR_VERSION = "temporal-serve-paired-v1"
POSE_JOINTS = (5, 6, 7, 8, 9, 10, 11, 12)
SIDE_FEATURE_WIDTH = len(POSE_JOINTS) * 7 + 3
GLOBAL_FEATURE_WIDTH = 7
PAIRED_FEATURE_WIDTH = SIDE_FEATURE_WIDTH * 2 + GLOBAL_FEATURE_WIDTH
FORBIDDEN_FEATURE_KEYS = {
    "confirmed_winner",
    "expected_server_side",
    "first_server",
    "first_server_source",
    "gold",
    "human_label",
    "player_identity",
    "reviewer_id",
    "score",
    "scored_server_side",
    "winner",
}


def _video_metadata(path: Path) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise RuntimeError(f"could not open temporal feature video: {path}")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frames = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH)))
        height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    finally:
        capture.release()
    if min(fps, frames, width, height) <= 0:
        raise RuntimeError(f"invalid temporal feature video metadata: {path}")
    return {
        "fps": fps,
        "frame_count": frames,
        "width": width,
        "height": height,
        "duration_s": frames / fps,
    }


def _named_ends(
    corners: Mapping[str, Sequence[float]],
) -> tuple[list[np.ndarray], list[np.ndarray]]:
    named = {
        str(key).lower(): np.asarray(value, dtype=np.float32)
        for key, value in corners.items()
    }
    near = [value for key, value in named.items() if "near" in key]
    far = [value for key, value in named.items() if "far" in key]
    if len(near) != 2 or len(far) != 2:
        values = list(named.values())
        if len(values) != 4:
            raise ValueError("table calibration must contain four corners")
        near, far = values[:2], values[2:]
    return near, far


def _table_basis(
    corners: Mapping[str, Sequence[float]],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float, float]:
    near, far = _named_ends(corners)
    near_mid = np.mean(np.stack(near), axis=0)
    far_mid = np.mean(np.stack(far), axis=0)
    length_vector = near_mid - far_mid
    length = float(np.linalg.norm(length_vector))
    width_vector = near[1] - near[0]
    width = float(np.linalg.norm(width_vector))
    if length < 2.0 or width < 2.0:
        raise ValueError("table calibration axes are degenerate")
    return far_mid, length_vector / length, width_vector / width, length, width


def _table_point(
    point: Sequence[float],
    basis: tuple[np.ndarray, np.ndarray, np.ndarray, float, float],
) -> np.ndarray:
    origin, length_unit, width_unit, length, width = basis
    offset = np.asarray(point, dtype=np.float32) - origin
    return np.asarray(
        [
            float(np.dot(offset, width_unit) / width),
            float(np.dot(offset, length_unit) / length),
        ],
        dtype=np.float32,
    )


def _event_times(placement: Mapping[str, Any]) -> list[dict[str, Any]]:
    output: dict[tuple[str, float], dict[str, Any]] = {}
    hypotheses = placement.get("hypotheses") or {}
    values = hypotheses.values() if isinstance(hypotheses, Mapping) else hypotheses
    for hypothesis in values or []:
        if not isinstance(hypothesis, Mapping):
            continue
        for shot in hypothesis.get("shots") or []:
            if not isinstance(shot, Mapping) or shot.get("phase") != "serve":
                continue
            for kind, key in (
                ("first_bounce", "serve_first_bounce"),
                ("second_bounce", "landing"),
            ):
                event = shot.get(key) or {}
                if isinstance(event, Mapping) and event.get("t") is not None:
                    time_s = round(float(event["t"]), 4)
                    output[(kind, time_s)] = {"kind": kind, "time_s": time_s}
    return sorted(output.values(), key=lambda item: (item["time_s"], item["kind"]))


def _nearest_score(
    time_s: float,
    events: Sequence[Mapping[str, Any]],
    scale: float,
) -> float:
    times = [
        float(event["time_s"])
        for event in events
        if event.get("time_s") is not None
    ]
    if not times:
        return 0.0
    return float(math.exp(-min(abs(time_s - value) for value in times) / scale))


def _player_arrays(
    side: str,
    indices: Sequence[int],
    poses: Mapping[int, Mapping[str, Mapping[str, Any]]],
    ball_px: np.ndarray,
    basis: tuple[np.ndarray, np.ndarray, np.ndarray, float, float],
    sample_fps: float,
) -> tuple[np.ndarray, np.ndarray]:
    count = len(indices)
    positions = np.zeros((count, len(POSE_JOINTS), 2), dtype=np.float32)
    confidence = np.zeros((count, len(POSE_JOINTS)), dtype=np.float32)
    torso_scales = np.ones(count, dtype=np.float32)
    wrists_px = np.zeros((count, 2, 2), dtype=np.float32)
    wrist_visible = np.zeros((count, 2), dtype=np.float32)
    for row, frame in enumerate(indices):
        player = (poses.get(int(frame)) or {}).get(side) or {}
        keypoints = player.get("kpts") or []
        for column, joint in enumerate(POSE_JOINTS):
            if len(keypoints) <= joint or len(keypoints[joint]) < 3:
                continue
            x, y, score = keypoints[joint][:3]
            if float(score) < 0.15:
                continue
            positions[row, column] = _table_point((x, y), basis)
            confidence[row, column] = float(score)
        shoulder_points = [
            np.asarray(keypoints[joint][:2], dtype=np.float32)
            for joint in (5, 6)
            if len(keypoints) > joint
            and len(keypoints[joint]) >= 3
            and float(keypoints[joint][2]) >= 0.15
        ]
        hip_points = [
            np.asarray(keypoints[joint][:2], dtype=np.float32)
            for joint in (11, 12)
            if len(keypoints) > joint
            and len(keypoints[joint]) >= 3
            and float(keypoints[joint][2]) >= 0.15
        ]
        scales = []
        if len(shoulder_points) == 2:
            scales.append(
                float(np.linalg.norm(shoulder_points[1] - shoulder_points[0]))
            )
        if shoulder_points and hip_points:
            scales.append(
                float(
                    np.linalg.norm(
                        np.mean(hip_points, axis=0)
                        - np.mean(shoulder_points, axis=0)
                    )
                )
            )
        torso_scales[row] = max(scales or [1.0])
        for wrist_column, joint in enumerate((9, 10)):
            if (
                len(keypoints) > joint
                and len(keypoints[joint]) >= 3
                and float(keypoints[joint][2]) >= 0.15
            ):
                wrists_px[row, wrist_column] = np.asarray(
                    keypoints[joint][:2], dtype=np.float32
                )
                wrist_visible[row, wrist_column] = 1.0
    velocity = np.zeros_like(positions)
    acceleration = np.zeros_like(positions)
    if count > 1:
        velocity[1:] = np.diff(positions, axis=0) * sample_fps
    if count > 2:
        acceleration[2:] = np.diff(velocity, axis=0)[1:] * sample_fps
    output = np.zeros((count, SIDE_FEATURE_WIDTH), dtype=np.float32)
    for row in range(count):
        joint_features = np.concatenate(
            (
                positions[row],
                confidence[row, :, None],
                velocity[row],
                acceleration[row],
            ),
            axis=1,
        ).reshape(-1)
        distances = np.zeros(2, dtype=np.float32)
        if np.isfinite(ball_px[row]).all():
            for wrist in range(2):
                if wrist_visible[row, wrist]:
                    distances[wrist] = min(
                        5.0,
                        float(
                            np.linalg.norm(ball_px[row] - wrists_px[row, wrist])
                            / max(1.0, torso_scales[row])
                        ),
                    )
        output[row] = np.concatenate(
            (
                joint_features,
                [float((confidence[row] >= 0.15).mean())],
                distances,
            )
        )
    valid = (confidence >= 0.15).any(axis=1).astype(np.float32)
    return output, valid


def _assert_blinded(value: Any, path: str = "feature") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if str(key).lower() in FORBIDDEN_FEATURE_KEYS:
                raise ValueError(f"forbidden feature key at {path}.{key}")
            _assert_blinded(child, f"{path}.{key}")
    elif isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, np.ndarray)
    ):
        for index, child in enumerate(value):
            _assert_blinded(child, f"{path}[{index}]")


def feature_cache_key(
    point: Mapping[str, Any],
    extractor_version: str,
    model_sha256: str,
) -> str:
    payload = ":".join(
        (
            str(point.get("source_id") or ""),
            str(point.get("media_sha256") or ""),
            extractor_version,
            model_sha256,
        )
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def extract_feature_record(
    *,
    point: Mapping[str, Any],
    media_path: Path,
    pose_model: Any,
    blurball: Callable[[Mapping[str, Any]], Mapping[int, Sequence[float]]],
    audio: Sequence[Mapping[str, Any]],
    sample_fps: float = 15.0,
    maximum_seconds: float = 12.0,
    model_sha256: str,
) -> dict[str, Any]:
    _assert_blinded(point, "point")
    video = _video_metadata(media_path)
    end_s = min(float(video["duration_s"]), maximum_seconds)
    indices = sampled_frame_indices(
        0.0,
        end_s,
        float(video["fps"]),
        int(video["frame_count"]),
        sample_fps,
    )
    corners = (point.get("calibration") or {}).get("table_corners_px") or {}
    regions = build_player_regions(
        corners, int(video["width"]), int(video["height"])
    )
    poses, compute = extract_pose_window(
        media_path, indices, regions, pose_model
    )
    raw_ball = blurball(point) or {}
    detections = {int(key): value for key, value in raw_ball.items()}
    ball_px = np.full((len(indices), 2), np.nan, dtype=np.float32)
    for row, frame in enumerate(indices):
        raw = detections.get(frame)
        if raw is not None and len(raw) >= 2:
            ball_px[row] = [float(raw[0]), float(raw[1])]
    basis = _table_basis(corners)
    near, near_valid = _player_arrays(
        "near", indices, poses, ball_px, basis, sample_fps
    )
    far, far_valid = _player_arrays(
        "far", indices, poses, ball_px, basis, sample_fps
    )
    global_features = np.zeros(
        (len(indices), GLOBAL_FEATURE_WIDTH), dtype=np.float32
    )
    ball_table = np.zeros((len(indices), 2), dtype=np.float32)
    ball_visible = np.isfinite(ball_px).all(axis=1)
    for row in range(len(indices)):
        if ball_visible[row]:
            ball_table[row] = _table_point(ball_px[row], basis)
    ball_velocity = np.zeros_like(ball_table)
    if len(indices) > 1:
        ball_velocity[1:] = np.diff(ball_table, axis=0) * sample_fps
    bounce_events = _event_times(point.get("placement") or {})
    audio_events = [
        {
            "time_s": round(float(item["time_s"]), 4),
            "confidence": round(
                max(0.0, float(item.get("confidence") or 0.0)), 4
            ),
        }
        for item in audio
        if item.get("time_s") is not None
    ]
    times = [float(frame) / float(video["fps"]) for frame in indices]
    for row, time_s in enumerate(times):
        global_features[row, :2] = ball_table[row]
        global_features[row, 2:4] = ball_velocity[row]
        global_features[row, 4] = float(ball_visible[row])
        global_features[row, 5] = _nearest_score(
            time_s, bounce_events, 0.08
        )
        global_features[row, 6] = _nearest_score(
            time_s, audio_events, 0.08
        )
    features = np.concatenate(
        (near, far, global_features), axis=1
    ).astype(np.float32)
    mask = np.maximum(
        np.maximum(near_valid, far_valid), ball_visible.astype(np.float32)
    )
    record = {
        "schema_version": SCHEMA_VERSION,
        "extractor_version": EXTRACTOR_VERSION,
        "source_id": str(point.get("source_id") or ""),
        "media_sha256": str(point.get("media_sha256") or ""),
        "model_sha256": model_sha256,
        "sample_fps": float(sample_fps),
        "times_s": [round(value, 6) for value in times],
        "features": features,
        "mask": mask.astype(np.float32),
        "ball_events": bounce_events,
        "audio_events": audio_events,
        "compute": compute,
    }
    validate_feature_record(record)
    return record


def validate_feature_record(record: Mapping[str, Any]) -> None:
    _assert_blinded(record)
    if int(record.get("schema_version") or 0) != SCHEMA_VERSION:
        raise ValueError("unsupported temporal feature schema")
    features = np.asarray(record.get("features"), dtype=np.float32)
    mask = np.asarray(record.get("mask"), dtype=np.float32)
    times = record.get("times_s") or []
    if features.ndim != 2 or features.shape[1] != PAIRED_FEATURE_WIDTH:
        raise ValueError("temporal feature width mismatch")
    if mask.shape != (features.shape[0],) or len(times) != features.shape[0]:
        raise ValueError("temporal feature sequence length mismatch")
    if not np.isfinite(features).all() or not np.isfinite(mask).all():
        raise ValueError("temporal features must be finite")
    if not str(record.get("source_id") or ""):
        raise ValueError("temporal feature source ID is required")


def save_feature_record(cache_dir: Path, record: Mapping[str, Any]) -> Path:
    validate_feature_record(record)
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = feature_cache_key(
        record,
        str(record["extractor_version"]),
        str(record["model_sha256"]),
    )
    arrays_path = cache_dir / f"{key}.npz"
    metadata_path = cache_dir / f"{key}.json"
    arrays_tmp = cache_dir / f".{key}.npz.tmp"
    metadata_tmp = cache_dir / f".{key}.json.tmp"
    with arrays_tmp.open("wb") as destination:
        np.savez_compressed(
            destination,
            features=np.asarray(record["features"], dtype=np.float32),
            mask=np.asarray(record["mask"], dtype=np.float32),
        )
    metadata = {
        key_name: value
        for key_name, value in record.items()
        if key_name not in {"features", "mask"}
    }
    metadata["arrays_file"] = arrays_path.name
    metadata["feature_shape"] = list(np.asarray(record["features"]).shape)
    metadata_tmp.write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n"
    )
    arrays_tmp.replace(arrays_path)
    metadata_tmp.replace(metadata_path)
    return metadata_path


def load_feature_record(metadata_path: Path) -> dict[str, Any]:
    metadata = json.loads(metadata_path.read_text())
    arrays_path = metadata_path.parent / str(metadata.pop("arrays_file"))
    with np.load(arrays_path, allow_pickle=False) as arrays:
        record = {
            **metadata,
            "features": np.asarray(arrays["features"], dtype=np.float32),
            "mask": np.asarray(arrays["mask"], dtype=np.float32),
        }
    record.pop("feature_shape", None)
    validate_feature_record(record)
    return record
