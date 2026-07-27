"""Placement-v3 reconstruction helpers for already-segmented matches."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

import cv2
import numpy as np

try:
    from .placement_reconstruction import reconstruct_placement
    from .points_pipeline import Px, fit_play
except ImportError:  # Direct execution from worker/.
    from placement_reconstruction import reconstruct_placement
    from points_pipeline import Px, fit_play


W_M = 1.525
L_M = 2.74


def load_detections(path: Path) -> dict[int, tuple[float, float]]:
    detections: dict[int, tuple[float, float]] = {}
    with path.open() as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("x") is None or record.get("y") is None:
                continue
            detections[int(record["f"])] = (
                float(record["x"]),
                float(record["y"]),
            )
    return detections


def calibration_matrix(calibration: Mapping[str, Any]) -> np.ndarray:
    corners = calibration["table_corners_px"]
    source = np.asarray(
        [
            corners["A_near_1"],
            corners["B_near_2"],
            corners["C_far_2"],
            corners["D_far_1"],
        ],
        dtype=np.float32,
    )
    destination = np.asarray(
        [[0.0, 0.0], [W_M, 0.0], [W_M, L_M], [0.0, L_M]],
        dtype=np.float32,
    )
    return cv2.getPerspectiveTransform(source, destination)


def unavailable_placement(reason: str) -> dict[str, Any]:
    hypotheses = {}
    for side in ("near", "far"):
        hypotheses[side] = {
            "server_side": side,
            "status": "unavailable",
            "confidence": 0.0,
            "score": 0.0,
            "reasons": [reason],
            "hard_reasons": [reason],
            "shots": [],
        }
    return {
        "v": 3,
        "status": "unavailable",
        "candidates": [],
        "hypotheses": hypotheses,
    }


def validate_placements(
    point_indices: Sequence[int],
    placements: Mapping[int, Mapping[str, Any]],
) -> None:
    expected = [int(index) for index in point_indices]
    actual = sorted(int(index) for index in placements)
    if len(expected) != len(set(expected)) or sorted(expected) != actual:
        raise ValueError("placement point indices do not match existing points")
    if any(payload.get("v") != 3 for payload in placements.values()):
        raise ValueError("every placement payload must have v=3")


def merge_match_placements(
    match: Mapping[str, Any],
    points: Sequence[Mapping[str, Any]],
    placements: Mapping[int, Mapping[str, Any]],
) -> dict[str, Any]:
    merged = copy.deepcopy(dict(match))
    validate_placements([int(point["idx"]) for point in points], placements)
    stored_by_index = {
        int(point["idx"]): point for point in merged.get("points", [])
    }
    merged_points = []
    for database_point in points:
        index = int(database_point["idx"])
        point = copy.deepcopy(stored_by_index.get(index, {}))
        point.update(copy.deepcopy(dict(database_point)))
        point["placement"] = copy.deepcopy(placements[index])
        merged_points.append(point)
    merged["points"] = merged_points
    merged["version"] = max(int(merged.get("version") or 0), 3)
    return merged


def reconstruct_existing_match(
    match: Mapping[str, Any],
    points: Sequence[Mapping[str, Any]],
    detections: Mapping[int, tuple[float, float]],
    calibration: Mapping[str, Any] | None,
    audio_impacts: Sequence[Mapping[str, Any]] = (),
) -> dict[int, dict[str, Any]]:
    if not calibration or calibration.get("ok") is False:
        return {
            int(point["idx"]): unavailable_placement("calibration_failed")
            for point in points
        }

    source = match["source"]
    fps = float(source["fps"])
    width = int(source["width"])
    px = Px(width)
    H = calibration.get("H")
    if H is None:
        H = calibration_matrix(calibration)
    axis = calibration.get("e") or calibration["length_axis"]
    axis = tuple(float(value) for value in axis)
    placements: dict[int, dict[str, Any]] = {}

    for point in points:
        index = int(point["idx"])
        start = float(point["t0"])
        end = float(point["t1"])
        f0 = max(0, int(math.floor(start * fps)))
        f1 = int(math.ceil(end * fps)) + 1
        point_detections = {
            frame: detections[frame]
            for frame in range(f0, f1)
            if frame in detections
        }
        track = fit_play(
            point_detections,
            H,
            axis,
            f0,
            f1,
            fps,
            px,
        ) or {"segments": [], "bounces": [], "hits": []}
        point_audio = [
            dict(impact)
            for impact in audio_impacts
            if start <= float(impact["t"]) <= end
        ]
        placements[index] = reconstruct_placement(
            point_detections,
            H,
            axis,
            track,
            point.get("suggestion"),
            f0,
            f1,
            fps,
            width,
            point_audio,
        )

    validate_placements([int(point["idx"]) for point in points], placements)
    return placements
