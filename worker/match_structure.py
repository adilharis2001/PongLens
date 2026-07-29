"""Pure high-precision RTMPose match-structure logic.

This module deliberately owns no model, media, database, or command-line I/O.
It consumes plain mappings and NumPy arrays so both the worker adapter and
unit tests exercise the same frozen precision gates.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import numpy as np


ALGORITHM_VERSION = "rtmpose-match-structure-v1"
EXPECTED_CHECKPOINT_SHA256 = (
    "5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c"
)
MARGIN_THRESHOLD = 0.08
CONFIRMATIONS_REQUIRED = 2


def _table_endpoints(
    corners: Mapping[str, Sequence[float]],
) -> tuple[np.ndarray, np.ndarray]:
    named = {
        str(name).lower(): np.asarray(value, dtype=float)
        for name, value in corners.items()
    }
    near_points = [point for name, point in named.items() if "near" in name]
    far_points = [point for name, point in named.items() if "far" in name]
    if len(near_points) != 2 or len(far_points) != 2:
        values = list(named.values())
        if len(values) != 4:
            raise ValueError("table calibration must contain four corners")
        near_points = values[:2]
        far_points = values[2:]
    if any(point.shape != (2,) for point in near_points + far_points):
        raise ValueError("every table corner must contain x and y")
    near_midpoint = np.mean(np.stack(near_points), axis=0)
    far_midpoint = np.mean(np.stack(far_points), axis=0)
    if not np.all(np.isfinite((near_midpoint, far_midpoint))):
        raise ValueError("table corners must be finite")
    if float(np.linalg.norm(near_midpoint - far_midpoint)) < 2.0:
        raise ValueError("table length axis is degenerate")
    return near_midpoint, far_midpoint


def _centered_box(
    center: np.ndarray,
    box_width: float,
    box_height: float,
    width: int,
    height: int,
) -> list[float]:
    x1 = max(0.0, float(center[0]) - box_width / 2.0)
    y1 = max(0.0, float(center[1]) - box_height / 2.0)
    x2 = min(float(width), float(center[0]) + box_width / 2.0)
    y2 = min(float(height), float(center[1]) + box_height / 2.0)
    box = [x1, y1, x2, y2]
    if (
        not all(math.isfinite(value) for value in box)
        or x2 - x1 < width * 0.2
        or y2 - y1 < height * 0.2
    ):
        raise ValueError("derived player region is degenerate")
    return [round(value, 3) for value in box]


def build_player_regions(
    corners: Mapping[str, Sequence[float]],
    width: int,
    height: int,
) -> dict[str, list[float]]:
    """Derive stable near/far RTMPose boxes from fixed table geometry."""
    if width <= 0 or height <= 0:
        raise ValueError("video dimensions must be positive")
    near_midpoint, far_midpoint = _table_endpoints(corners)
    table_axis = near_midpoint - far_midpoint
    near_center = near_midpoint + table_axis * 0.35
    far_center = far_midpoint - table_axis * 0.35
    box_width = width * 0.52
    box_height = height * 0.85
    near = _centered_box(
        near_center,
        box_width,
        box_height,
        width,
        height,
    )
    far = _centered_box(
        far_center,
        box_width,
        box_height,
        width,
        height,
    )
    near[0 if table_axis[0] < 0 else 2] = (
        0.0 if table_axis[0] < 0 else float(width)
    )
    near[1 if table_axis[1] < 0 else 3] = (
        0.0 if table_axis[1] < 0 else float(height)
    )
    far[2 if table_axis[0] < 0 else 0] = (
        float(width) if table_axis[0] < 0 else 0.0
    )
    far[3 if table_axis[1] < 0 else 1] = (
        float(height) if table_axis[1] < 0 else 0.0
    )
    return {"near": near, "far": far}


def encode_players(
    keypoints: np.ndarray,
    scores: np.ndarray,
    sides: Sequence[str],
    threshold: float = 0.15,
) -> list[dict[str, Any]]:
    """Convert RTMPose arrays to the worker's COCO-17 player schema."""
    keypoints = np.asarray(keypoints, dtype=float)
    scores = np.asarray(scores, dtype=float)
    if (
        keypoints.ndim != 3
        or keypoints.shape[1:] != (17, 2)
        or scores.shape != keypoints.shape[:2]
        or keypoints.shape[0] != len(sides)
    ):
        raise ValueError(
            "RTMPose output must match the COCO-17 "
            "(people, 17, 2) keypoint contract"
        )
    players = []
    for pose, confidence, side in zip(keypoints, scores, sides):
        valid = (
            np.isfinite(pose).all(axis=1)
            & np.isfinite(confidence)
            & (confidence >= threshold)
        )
        if int(valid.sum()) < 4:
            continue
        visible = pose[valid]
        span = np.maximum(np.ptp(visible, axis=0), 1.0)
        padding = np.maximum(span * 0.12, 8.0)
        bbox = [
            float(visible[:, 0].min() - padding[0]),
            float(visible[:, 1].min() - padding[1]),
            float(visible[:, 0].max() + padding[0]),
            float(visible[:, 1].max() + padding[1]),
        ]
        players.append(
            {
                "side": str(side),
                "conf": round(float(confidence[valid].mean()), 3),
                "bbox": [round(value, 1) for value in bbox],
                "kpts": [
                    [
                        round(float(point[0]), 1),
                        round(float(point[1]), 1),
                        round(float(score), 3),
                    ]
                    for point, score in zip(pose, confidence)
                ],
            }
        )
    return players


def torso_signature(
    image: np.ndarray,
    player: Mapping[str, Any],
) -> list[float] | None:
    """Return a robust normalized BGR signature from confident torso joints."""
    keypoints = player.get("kpts") or []
    torso_points = [
        keypoints[index]
        for index in (5, 6, 11, 12)
        if len(keypoints) > index
        and len(keypoints[index]) >= 3
        and float(keypoints[index][2]) >= 0.3
    ]
    if len(torso_points) < 3:
        return None
    height, width = image.shape[:2]
    xs = [float(point[0]) for point in torso_points]
    ys = [float(point[1]) for point in torso_points]
    x0 = max(0, int(math.floor(min(xs))))
    x1 = min(width, int(math.ceil(max(xs))) + 1)
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(height, int(math.ceil(max(ys))) + 1)
    if x1 - x0 < 5 or y1 - y0 < 5:
        return None
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    median = np.median(crop.reshape((-1, 3)), axis=0) / 255.0
    return [round(float(value), 4) for value in median]


def assign_anonymous_players(
    signatures: Mapping[int, Mapping[str, Sequence[float]]],
    margin_threshold: float = MARGIN_THRESHOLD,
) -> dict[int, dict[str, Any]]:
    """Anchor anonymous A/B appearance once, then assign physical ends."""
    usable = [
        (int(idx), sides)
        for idx, sides in sorted(signatures.items())
        if sides.get("near") is not None and sides.get("far") is not None
    ]
    if not usable:
        return {
            int(idx): {
                "state": None,
                "names": None,
                "status": "unavailable",
                "cost_margin": None,
                "reason": "Both physical ends require torso signatures.",
            }
            for idx in signatures
        }
    _, anchor = usable[0]
    prototype_a = list(anchor["near"])
    prototype_b = list(anchor["far"])

    def distance(left: Sequence[float], right: Sequence[float]) -> float:
        return math.sqrt(
            sum(
                (float(a) - float(b)) ** 2
                for a, b in zip(left, right)
            )
        )

    result = {}
    for idx, sides in sorted(signatures.items()):
        near = sides.get("near")
        far = sides.get("far")
        if near is None or far is None:
            result[int(idx)] = {
                "state": None,
                "names": None,
                "status": "unavailable",
                "cost_margin": None,
                "reason": "Both physical ends require torso signatures.",
            }
            continue
        direct = distance(near, prototype_a) + distance(far, prototype_b)
        swapped = distance(near, prototype_b) + distance(far, prototype_a)
        state = "direct" if direct <= swapped else "swapped"
        margin = abs(direct - swapped)
        result[int(idx)] = {
            "state": state,
            "names": (
                {"near": "A", "far": "B"}
                if state == "direct"
                else {"near": "B", "far": "A"}
            ),
            "status": (
                "high_confidence"
                if margin >= margin_threshold
                else "needs_review"
            ),
            "cost_margin": round(margin, 4),
            "direct_cost": round(direct, 4),
            "swapped_cost": round(swapped, 4),
            "reason": "Torso appearance matched anonymous anchor prototypes.",
        }
    return result


def detect_end_changes(
    assignments: Mapping[int, Mapping[str, Any]],
    confirmations: int = CONFIRMATIONS_REQUIRED,
) -> list[dict[str, Any]]:
    """Require persistent contradictory identity before changing end state."""
    if confirmations < 1:
        raise ValueError("confirmations must be positive")
    stable_state = None
    last_stable_idx = None
    pending_state = None
    pending_first_idx = None
    pending_count = 0
    changes = []
    for idx, assignment in sorted(assignments.items()):
        idx = int(idx)
        if (
            assignment.get("status") != "high_confidence"
            or assignment.get("state") not in {"direct", "swapped"}
        ):
            continue
        state = str(assignment["state"])
        if stable_state is None:
            stable_state = state
            last_stable_idx = idx
            continue
        if state == stable_state:
            last_stable_idx = idx
            pending_state = None
            pending_first_idx = None
            pending_count = 0
            continue
        if pending_state == state:
            pending_count += 1
        else:
            pending_state = state
            pending_first_idx = idx
            pending_count = 1
        if pending_count < confirmations:
            continue
        changes.append(
            {
                "after_idx": last_stable_idx,
                "before_idx": pending_first_idx,
                "confirmed_at_idx": idx,
                "old_state": stable_state,
                "new_state": state,
                "confirmations": pending_count,
                "kind": "end_change",
            }
        )
        stable_state = state
        last_stable_idx = idx
        pending_state = None
        pending_first_idx = None
        pending_count = 0
    return changes


def detect_server_side(
    detections: Mapping[int, tuple[float, float]],
    poses: Mapping[int, Mapping[str, Mapping[str, Any]]],
    fps: float,
) -> dict[str, Any]:
    """Find the early toss/contact player, withholding close pose scores."""
    if not detections or not poses or fps <= 0:
        return {
            "side": None,
            "status": "unavailable",
            "scores": {"near": 0.0, "far": 0.0},
            "reason": "Ball or pose evidence is unavailable.",
        }
    first_frame = min(detections)
    last_frame = first_frame + int(round(4.5 * fps))
    scores = {"near": 0.0, "far": 0.0}
    samples = {"near": 0, "far": 0}
    toss_scores = {"near": 0.0, "far": 0.0}
    toss_samples = {"near": 0, "far": 0}
    first_toss_frame = {"near": None, "far": None}
    for frame, ball in sorted(detections.items()):
        if frame > last_frame:
            break
        frame_poses = poses.get(frame)
        if frame_poses is None:
            frame_poses = poses.get(frame - 1) or poses.get(frame + 1)
        if not frame_poses:
            continue
        elapsed = (frame - first_frame) / fps
        decay = math.exp(-elapsed / 5.0)
        for side in ("near", "far"):
            player = frame_poses.get(side)
            if not player:
                continue
            keypoints = player.get("kpts") or []
            wrists = [
                keypoints[index]
                for index in (9, 10)
                if len(keypoints) > index
                and len(keypoints[index]) >= 3
                and float(keypoints[index][2]) >= 0.3
            ]
            shoulders = [
                keypoints[index]
                for index in (5, 6)
                if len(keypoints) > index
                and len(keypoints[index]) >= 3
                and float(keypoints[index][2]) >= 0.3
            ]
            if not wrists:
                continue
            distance = min(
                math.hypot(
                    float(ball[0]) - float(wrist[0]),
                    float(ball[1]) - float(wrist[1]),
                )
                for wrist in wrists
            )
            close_score = max(0.0, 1.0 - distance / 140.0)
            toss_score = 0.0
            bbox = player.get("bbox") or []
            if shoulders and len(bbox) >= 4:
                shoulder_y = sum(
                    float(point[1]) for point in shoulders
                ) / len(shoulders)
                inside_x = (
                    float(bbox[0]) - 55
                    <= float(ball[0])
                    <= float(bbox[2]) + 55
                )
                if inside_x and float(ball[1]) < shoulder_y + 15:
                    toss_score = 0.55
            contribution = (close_score + toss_score) * decay
            if contribution > 0:
                scores[side] += contribution
                samples[side] += 1
            if toss_score > 0:
                toss_scores[side] += toss_score * decay
                toss_samples[side] += 1
                if first_toss_frame[side] is None:
                    first_toss_frame[side] = frame

    ranked = sorted(scores, key=scores.get, reverse=True)
    best, other = ranked
    best_score, other_score = scores[best], scores[other]
    ratio = best_score / max(other_score, 0.25)
    high_confidence = (
        best_score >= 2.5
        and best_score - other_score >= 1.0
        and ratio >= 1.35
        and samples[best] >= 4
    )
    rounded = {side: round(value, 3) for side, value in scores.items()}
    toss_rounded = {
        side: round(value, 3) for side, value in toss_scores.items()
    }
    if not high_confidence:
        return {
            "side": None,
            "status": "needs_review",
            "scores": rounded,
            "toss_scores": toss_rounded,
            "toss_samples": toss_samples,
            "first_toss_frame": first_toss_frame,
            "samples": samples,
            "reason": "Early toss/wrist pose evidence is absent or ambiguous.",
        }
    return {
        "side": best,
        "status": "high_confidence",
        "scores": rounded,
        "toss_scores": toss_rounded,
        "toss_samples": toss_samples,
        "first_toss_frame": first_toss_frame,
        "samples": samples,
        "reason": (
            "Early ball toss/contact stays closest to this player's wrists."
        ),
    }


def first_server_vote(
    position: int,
    side: str | None,
) -> str | None:
    """Convert one point server through the expected A,A,B sequence."""
    if side not in {"near", "far"}:
        return None
    if position in (1, 2):
        return side
    if position == 3:
        return "far" if side == "near" else "near"
    raise ValueError("first-server votes are limited to positions 1-3")


def aggregate_first_server(
    calls: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Require two consistent high-confidence votes for one first server."""
    votes = {"near": 0, "far": 0}
    usable = []
    for call in calls:
        if call.get("status") != "high_confidence":
            continue
        vote = first_server_vote(int(call["position"]), call.get("side"))
        if vote is None:
            continue
        votes[vote] += 1
        usable.append(int(call["idx"]))
    side = None
    if votes["near"] >= 2 and votes["near"] > votes["far"]:
        side = "near"
    elif votes["far"] >= 2 and votes["far"] > votes["near"]:
        side = "far"
    return {
        "side": side,
        "status": "high_confidence" if side else "withheld",
        "votes": votes,
        "usable_points": usable,
        "reason": (
            "At least two high-confidence A,A,B-adjusted votes agree."
            if side
            else "Fewer than two consistent high-confidence votes."
        ),
    }
