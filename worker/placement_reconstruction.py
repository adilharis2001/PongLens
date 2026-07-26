"""Side-neutral placement reconstruction primitives.

This module deliberately separates visual/audio event extraction from rally
interpretation. Candidate events describe observations; a later solver assigns
serve, stroke, landing, and terminal roles under each possible server.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

import numpy as np


TABLE_WIDTH_M = 1.525
TABLE_LENGTH_M = 2.74


def split_track_chunks(
    detections: Mapping[int, Sequence[float]],
    f0: int,
    f1: int,
    width: int,
    *,
    max_gap_frames: int = 2,
    min_points: int = 3,
) -> list[list[int]]:
    """Split a detector track at gaps and physically impossible image jumps.

    Short chunks are discarded. In particular, an isolated false detection
    between two valid runs cannot poison either neighboring trajectory.
    """

    frames = [frame for frame in range(f0, f1) if frame in detections]
    if not frames:
        return []

    jump_limit = max(48.0, width * 0.055)
    chunks: list[list[int]] = []
    current = [frames[0]]

    for frame in frames[1:]:
        previous = current[-1]
        x0, y0 = detections[previous]
        x1, y1 = detections[frame]
        gap = frame - previous
        distance = math.hypot(float(x1) - float(x0), float(y1) - float(y0))
        gap_scale = max(1.0, min(float(gap), float(max_gap_frames)))

        if gap > max_gap_frames or distance > jump_limit * gap_scale:
            if len(current) >= min_points:
                chunks.append(current)
            current = [frame]
        else:
            current.append(frame)

    if len(current) >= min_points:
        chunks.append(current)
    return chunks


def _project_if_plausible(
    H: Sequence[Sequence[float]],
    x: float,
    y: float,
) -> tuple[float | None, float | None]:
    matrix = np.asarray(H, dtype=float)
    projected = matrix @ np.array([x, y, 1.0], dtype=float)
    if abs(projected[2]) < 1e-9:
        return None, None
    u = float(projected[0] / projected[2])
    v = float(projected[1] / projected[2])
    if not (
        -0.20 <= u <= TABLE_WIDTH_M + 0.20
        and -0.30 <= v <= TABLE_LENGTH_M + 0.30
    ):
        return None, None
    return round(u, 4), round(v, 4)


def _audio_time(impact: Any) -> tuple[float, float]:
    if isinstance(impact, Mapping):
        return float(impact["t"]), float(impact.get("confidence", 1.0))
    return float(impact), 1.0


def _attach_audio(
    event: dict[str, Any],
    impacts: Sequence[tuple[float, float]],
    tolerance_s: float,
) -> int | None:
    if not impacts:
        event["audio_confidence"] = 0.0
        return None
    nearest_index = min(
        range(len(impacts)),
        key=lambda index: abs(impacts[index][0] - event["t"]),
    )
    audio_t, confidence = impacts[nearest_index]
    delta = abs(audio_t - event["t"])
    if delta > tolerance_s:
        event["audio_confidence"] = 0.0
        return None
    proximity = 1.0 - delta / tolerance_s
    event["audio_confidence"] = round(confidence * proximity, 4)
    event["audio_t"] = round(audio_t, 4)
    return nearest_index


def extract_candidates(
    detections: Mapping[int, Sequence[float]],
    H: Sequence[Sequence[float]],
    e: Sequence[float],
    f0: int,
    f1: int,
    fps: float,
    width: int,
    audio_impacts: Iterable[Any] | None = None,
) -> list[dict[str, Any]]:
    """Extract observations without assuming who served or who struck.

    Image-y maxima produce bounce candidates. Reversals along the calibrated
    table axis produce contact candidates. Audio can strengthen either event
    but never decides the surface or player on its own.
    """

    if fps <= 0:
        raise ValueError("fps must be positive")

    axis_length = math.hypot(float(e[0]), float(e[1]))
    if axis_length < 1e-9:
        raise ValueError("table axis must be non-zero")
    ex, ey = float(e[0]) / axis_length, float(e[1]) / axis_length

    impacts = sorted(
        (_audio_time(impact) for impact in (audio_impacts or [])),
        key=lambda item: item[0],
    )
    candidates: list[dict[str, Any]] = []
    contact_leg_min = max(6.0, width * 0.006)

    for chunk in split_track_chunks(detections, f0, f1, width):
        coordinates = [
            (float(detections[frame][0]), float(detections[frame][1]))
            for frame in chunk
        ]
        axis_positions = [x * ex + y * ey for x, y in coordinates]

        for index in range(2, len(chunk) - 2):
            frame = chunk[index]
            x, y = coordinates[index]
            u, v = _project_if_plausible(H, x, y)

            y_window = [coordinates[offset][1] for offset in range(index - 2, index + 3)]
            rise = y_window[2] - y_window[0]
            fall = y_window[2] - y_window[4]
            if (
                y_window[2] >= y_window[1]
                and y_window[2] >= y_window[3]
                and rise >= 3.0
                and fall >= 3.0
            ):
                strength = min(1.0, (rise + fall) / 16.0)
                candidates.append(
                    {
                        "kind": "bounce",
                        "frame": frame,
                        "t": round(frame / fps, 4),
                        "x": round(x, 2),
                        "y": round(y, 2),
                        "u": u,
                        "v": v,
                        "visual_confidence": round(0.45 + 0.45 * strength, 4),
                    }
                )

            before = axis_positions[index] - axis_positions[index - 2]
            after = axis_positions[index + 2] - axis_positions[index]
            if (
                before * after < 0
                and abs(before) >= contact_leg_min
                and abs(after) >= contact_leg_min
            ):
                strength = min(
                    1.0,
                    (abs(before) + abs(after)) / (contact_leg_min * 6.0),
                )
                candidates.append(
                    {
                        "kind": "contact",
                        "frame": frame,
                        "t": round(frame / fps, 4),
                        "x": round(x, 2),
                        "y": round(y, 2),
                        "u": u,
                        "v": v,
                        "visual_confidence": round(0.45 + 0.45 * strength, 4),
                        "direction_before": round(before, 3),
                        "direction_after": round(after, 3),
                    }
                )

    candidates.sort(key=lambda event: (event["t"], event["kind"]))

    used_audio: set[int] = set()
    for event in candidates:
        match = _attach_audio(event, impacts, tolerance_s=0.09)
        if match is not None:
            used_audio.add(match)

    for index, (audio_t, confidence) in enumerate(impacts):
        if index in used_audio:
            continue
        candidates.append(
            {
                "kind": "impact",
                "frame": None,
                "t": round(audio_t, 4),
                "x": None,
                "y": None,
                "u": None,
                "v": None,
                "visual_confidence": 0.0,
                "audio_confidence": round(confidence, 4),
                "audio_t": round(audio_t, 4),
            }
        )

    candidates.sort(key=lambda event: (event["t"], event["kind"]))
    for index, event in enumerate(candidates):
        event["id"] = f"candidate-{index + 1}"
    return candidates
