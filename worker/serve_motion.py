"""Commercial-use-gated player motion evidence for serve candidates.

Motion is supporting evidence only. It never establishes a serve without the
ordered two-bounce table geometry produced by the placement reconstruction.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import cv2
import numpy as np


COMMERCIAL_LICENSE_ALLOWLIST = frozenset(
    {"Apache-2.0", "MIT", "BSD-3-Clause"}
)


def validate_model_provenance(
    provenance: Mapping[str, Any],
    *,
    checkpoint_path: Path | None = None,
) -> dict[str, str]:
    """Validate an RTMDet checkpoint and optional local file hash."""

    name = str(provenance.get("name") or "")
    license_name = str(provenance.get("license") or "")
    source_url = str(provenance.get("source_url") or "")
    sha256 = str(provenance.get("sha256") or "").lower()
    if license_name not in COMMERCIAL_LICENSE_ALLOWLIST:
        raise ValueError("model license is not on the commercial-use allowlist")
    if "rtmdet" not in name.lower():
        raise ValueError("motion model must be an RTMDet checkpoint")
    if not source_url.startswith(("https://", "http://")):
        raise ValueError("model source URL is required")
    if len(sha256) != 64 or any(
        character not in "0123456789abcdef" for character in sha256
    ):
        raise ValueError("model SHA-256 is required")
    if checkpoint_path is not None:
        checkpoint_path = Path(checkpoint_path)
        digest = hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()
        if digest != sha256:
            raise ValueError("checkpoint hash does not match provenance")
    return {
        "name": name,
        "license": license_name,
        "source_url": source_url,
        "sha256": sha256,
    }


def _unavailable(reason: str) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "reason": reason,
        "supporting_side": None,
        "confidence": 0.0,
        "near_motion": 0.0,
        "far_motion": 0.0,
        "frames_analyzed": 0,
    }


def _clip_box(box: Sequence[float], width: int, height: int):
    if len(box) < 4:
        return None
    x0, y0, x1, y1 = [int(round(float(value))) for value in box[:4]]
    x0, x1 = sorted((max(0, x0), min(width, x1)))
    y0, y1 = sorted((max(0, y0), min(height, y1)))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return x0, y0, x1, y1


def _flow_energy(
    previous_gray: np.ndarray,
    gray: np.ndarray,
    box: Sequence[float],
) -> float:
    clipped = _clip_box(box, gray.shape[1], gray.shape[0])
    if clipped is None:
        return 0.0
    x0, y0, x1, y1 = clipped
    before = previous_gray[y0:y1, x0:x1]
    after = gray[y0:y1, x0:x1]
    if before.size == 0 or after.size == 0:
        return 0.0
    flow = cv2.calcOpticalFlowFarneback(
        before,
        after,
        None,
        0.5,
        2,
        15,
        2,
        5,
        1.1,
        0,
    )
    magnitude = np.linalg.norm(flow, axis=2)
    return float(np.percentile(magnitude, 75))


def motion_evidence(
    clip: Path,
    candidate_times: Sequence[float],
    table_corners: Sequence[Sequence[float]],
    *,
    detector: Callable[[np.ndarray], Sequence[Mapping[str, Any]]] | None = None,
    provenance: Mapping[str, Any] | None = None,
    checkpoint_path: Path | None = None,
    window_s: float = 0.45,
    sample_fps: float = 12.0,
) -> dict[str, Any]:
    """Measure side-specific movement only around candidate windows."""

    if detector is None:
        return _unavailable("motion_runtime_unavailable")
    if provenance is None:
        raise ValueError("motion model provenance is required")
    validated = validate_model_provenance(
        provenance,
        checkpoint_path=checkpoint_path,
    )
    corners = np.asarray(table_corners, dtype=float)
    if corners.shape != (4, 2) or not np.isfinite(corners).all():
        raise ValueError("table corners are invalid")
    times = sorted(
        {
            max(0.0, float(candidate_time) + offset)
            for candidate_time in list(candidate_times)[:2]
            for offset in np.arange(
                -window_s,
                window_s + 1e-6,
                1.0 / sample_fps,
            )
        }
    )
    if not times:
        return _unavailable("motion_candidate_windows_unavailable")
    capture = cv2.VideoCapture(str(Path(clip)))
    if not capture.isOpened():
        return _unavailable("motion_clip_unreadable")
    near_end_y = float(np.mean(corners[:2, 1]))
    far_end_y = float(np.mean(corners[2:, 1]))
    divider_y = (near_end_y + far_end_y) / 2.0
    scores = {"near": [], "far": []}
    previous_gray = None
    frame_count = 0
    try:
        for timestamp in times:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            ok, frame = capture.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            people = list(detector(frame) or [])
            if previous_gray is not None:
                for person in people:
                    box = person.get("box") or person.get("bbox")
                    if not isinstance(box, Sequence) or len(box) < 4:
                        continue
                    center_y = (float(box[1]) + float(box[3])) / 2.0
                    if near_end_y >= far_end_y:
                        side = "near" if center_y >= divider_y else "far"
                    else:
                        side = "near" if center_y <= divider_y else "far"
                    scores[side].append(
                        _flow_energy(previous_gray, gray, box)
                    )
            previous_gray = gray
            frame_count += 1
    finally:
        capture.release()
    near = float(np.median(scores["near"])) if scores["near"] else 0.0
    far = float(np.median(scores["far"])) if scores["far"] else 0.0
    total = near + far
    contrast = abs(near - far) / total if total > 1e-6 else 0.0
    supporting_side = None
    if max(near, far) >= 0.20 and contrast >= 0.20:
        supporting_side = "near" if near > far else "far"
    return {
        "status": "available",
        "reason": (
            "side_motion_separated"
            if supporting_side
            else "side_motion_ambiguous"
        ),
        "supporting_side": supporting_side,
        "confidence": round(min(1.0, contrast), 4),
        "near_motion": round(near, 4),
        "far_motion": round(far, 4),
        "frames_analyzed": frame_count,
        "model": validated,
    }

