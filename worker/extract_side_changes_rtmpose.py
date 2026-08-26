#!/usr/bin/env python3
"""Extract per-point player-side evidence and side-change candidates.

Runs in the isolated rtmpose-production venv (worker/requirements-
rtmpose.txt). Needs only the per-point clips and match.json's calibration
— no blurball track — so the same command serves the live worker stage
and offline backfill or evaluation over already-processed matches.

Architecture, and why it is detector-first: the retired v1 stage handed
RTMPose two huge fixed boxes derived from the table quad. RTMPose is a
top-down model — given a box it always produces a pose — so on side-on
footage the "far" box, which mostly frames the table and back wall,
returned poses of TVs and posters with just enough confidence to pass
(measured 2026-08-26 on 86f880b9: the far signature froze at the wall
colour through four side switches, making every real swap read as
'uncertain'). v2 instead detects actual people with RTMDet (Apache-2.0,
same rtmlib runtime, ~10ms/frame CPU), projects each person's feet
through the table homography, assigns them to the two table ends in
TABLE coordinates, and only then runs RTMPose on the chosen boxes.

Downstream-only by construction: reads the points the pipeline already
cut, never changes them.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any, Mapping

import cv2
import numpy as np

if __package__:
    from .extract_match_structure_rtmpose import (
        _clip_metadata,
        _clip_path,
        _create_pose_model,
        _read_frame,
        _scaled_corners,
        atomic_json,
        sha256,
    )
    from .match_structure import EXPECTED_CHECKPOINT_SHA256
    from .side_change import (
        ALGORITHM_VERSION,
        EVIDENCE_VERSION,
        detect_side_changes,
        merge_config,
        summarize_point_side,
    )
else:
    from extract_match_structure_rtmpose import (
        _clip_metadata,
        _clip_path,
        _create_pose_model,
        _read_frame,
        _scaled_corners,
        atomic_json,
        sha256,
    )
    from match_structure import EXPECTED_CHECKPOINT_SHA256
    from side_change import (
        ALGORITHM_VERSION,
        EVIDENCE_VERSION,
        detect_side_changes,
        merge_config,
        summarize_point_side,
    )


SAMPLE_FRAMES = 7
# Person detector: RTMDet-m person checkpoint from the same OpenMMLab
# release train rtmlib itself pulls models from. No YOLO/ultralytics
# lineage — RTMDet is Apache-2.0 via MMDetection. rtmlib caches the
# download under ~/.cache/rtmlib. The nano/320 variant was tried first
# and missed the far player in ~6 of 7 frames — at 720px source width a
# far player is ~30px tall after the det resize, below nano's floor.
DET_MODEL_URL = (
    "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/"
    "onnx_sdk/rtmdet_m_8xb32-100e_coco-obj365-person-235e8209.zip"
)
DET_INPUT_SIZE = (640, 640)
# Player-vs-bystander geometry runs in IMAGE space, normalized by each
# person's own bbox height, never in ground-plane metres: projecting a
# detection's bottom edge through the homography breaks the moment the
# table occludes the legs (the far player on every side-on camera), and
# the perspective error scales with distance. Both rules below were
# measured into shape by the 2026-08-11 deadspace study
# (docs/research/2026-08-11-deadspace-assets/analysis_pose.md): a person
# belongs to the table when their anchor sits within NEAR_TABLE_FACTOR x
# their own bbox height of the quad, and ends are split by the nearer
# END line segment (A-B vs C-D) — a net line cannot split players, and
# "far player is higher in frame" is false on this corpus.
NEAR_TABLE_FACTOR = 1.1
# A second candidate whose end-line distance comes within this fraction
# of the taller candidate's bbox height makes the end AMBIGUOUS for the
# frame — doubles, or a bystander standing with the player — and the
# frame contributes no sample for that end. The guard runs before any
# appearance is read.
AMBIGUOUS_FACTOR = 0.6
# Minimum per-joint confidence for a torso corner to count. Detection
# gives real person crops, so the v1 floor is kept.
TORSO_MIN_CONF = 0.3


def sample_fractions(count: int) -> list[float]:
    """Evenly spaced fractions across the played middle of the clip.

    Clips carry roughly 1.2s of head pad and 1.3s of tail pad around a
    median 3.8s of play, so the outer ~20% of a typical clip is dead
    time where a player may already be walking. Sampling 0.2..0.8 keeps
    every frame inside the rally, when each player is at their own end.
    """
    if count <= 1:
        return [0.5]
    return [0.2 + 0.6 * i / (count - 1) for i in range(count)]


def point_sample_frames(frame_count: int, samples: int) -> list[int]:
    if frame_count <= 0:
        return []
    last = frame_count - 1
    return sorted(
        {
            min(last, max(0, int(round(last * fraction))))
            for fraction in sample_fractions(samples)
        }
    )


def _named_corners(corners: Mapping[str, Any]) -> dict[str, list[float]]:
    named = {}
    for key, value in corners.items():
        letter = str(key)[:1].upper()
        if letter in "ABCD":
            named[letter] = [float(value[0]), float(value[1])]
    if set(named) != {"A", "B", "C", "D"}:
        raise ValueError("calibration corners must be named A..D")
    return named


def quad_foreshortening(corners: Mapping[str, Any]) -> float | None:
    """Length-axis pixels over 1.8x the near end-line pixels.

    Mirrors points_v2.foreshortening: a table is 2.740m x 1.525m so an
    honest camera sees the long axis longer than the end line; end-on
    cameras squash it (koko 0.32, terry 0.25). Diagnostic only here —
    recorded so the evaluation can decide whether to gate on it.
    """
    try:
        named = _named_corners(corners)
        near_mid = (
            (named["A"][0] + named["B"][0]) / 2.0,
            (named["A"][1] + named["B"][1]) / 2.0,
        )
        far_mid = (
            (named["C"][0] + named["D"][0]) / 2.0,
            (named["C"][1] + named["D"][1]) / 2.0,
        )
        axis_px = math.hypot(
            near_mid[0] - far_mid[0], near_mid[1] - far_mid[1]
        )
        end_px = math.hypot(
            named["A"][0] - named["B"][0], named["A"][1] - named["B"][1]
        )
        if end_px <= 1.0:
            return None
        return round(axis_px / (1.8 * end_px), 3)
    except Exception:
        return None


def _create_det_model(model: str, backend: str, device: str):
    from rtmlib import RTMDet

    return RTMDet(
        onnx_model=model,
        model_input_size=DET_INPUT_SIZE,
        backend=backend,
        device=device,
    )


def _det_checkpoint_sha(det_model: str) -> str | None:
    """SHA-256 of the resolved detector ONNX, for evidence provenance.

    rtmlib caches URL checkpoints under ~/.cache/rtmlib/hub/checkpoints
    with the zip's basename swapped to .onnx; a plain path is used as-is.
    """
    path = Path(det_model)
    if not path.is_file():
        name = path.name
        if name.endswith(".zip"):
            name = name[:-4] + ".onnx"
        path = (
            Path.home() / ".cache" / "rtmlib" / "hub" / "checkpoints" / name
        )
    return sha256(path) if path.is_file() else None


def _iou(a, b) -> float:
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / max(1e-9, area_a + area_b - inter)


def dedupe_boxes(boxes: list[list[float]]) -> list[list[float]]:
    """RTMDet occasionally returns near-duplicate boxes of one person."""
    kept: list[list[float]] = []
    for box in sorted(
        boxes,
        key=lambda b: (b[2] - b[0]) * (b[3] - b[1]),
        reverse=True,
    ):
        if all(_iou(box, other) < 0.6 for other in kept):
            kept.append(box)
    return kept


def _segment_distance(
    px: float, py: float, a: list[float], b: list[float]
) -> float:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq <= 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _quad_distance(
    px: float, py: float, named: Mapping[str, list[float]]
) -> float:
    """Distance to the table quad's boundary; 0 inside the polygon."""
    order = ["A", "B", "C", "D"]
    points = [named[k] for k in order]
    inside = False
    j = len(points) - 1
    for i in range(len(points)):
        xi, yi = points[i]
        xj, yj = points[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (
            yj - yi
        ) + xi:
            inside = not inside
        j = i
    if inside:
        return 0.0
    return min(
        _segment_distance(px, py, points[i], points[(i + 1) % 4])
        for i in range(4)
    )


def choose_players(
    boxes: list[list[float]],
    corners: Mapping[str, Any],
) -> dict[str, Any]:
    """Assign detected people to table ends, in image space.

    Each person is anchored at their bbox bottom-centre. A person
    belongs to the table when that anchor sits within NEAR_TABLE_FACTOR
    x their own bbox height of the quad (the deadspace study's rule —
    absolute pixel windows and ground-plane projections both break under
    perspective). Their end is whichever END line segment is nearer:
    A-B (near) or C-D (far). Within an end the candidate closest to its
    end line is the player; a second candidate nearly as close makes
    the end ambiguous for this frame and it contributes no sample —
    the doubles and bystander guard, applied before any appearance is
    read.
    """
    named = _named_corners(corners)
    near_line = (named["A"], named["B"])
    far_line = (named["C"], named["D"])
    candidates: dict[str, list[tuple[float, float, list[float]]]] = {
        "near": [],
        "far": [],
    }
    for box in boxes:
        anchor_x = (float(box[0]) + float(box[2])) / 2.0
        anchor_y = float(box[3])
        height = max(1.0, float(box[3]) - float(box[1]))
        if (
            _quad_distance(anchor_x, anchor_y, named)
            > NEAR_TABLE_FACTOR * height
        ):
            continue
        d_near = _segment_distance(anchor_x, anchor_y, *near_line)
        d_far = _segment_distance(anchor_x, anchor_y, *far_line)
        if d_near <= d_far:
            candidates["near"].append((d_near, height, box))
        else:
            candidates["far"].append((d_far, height, box))
    result: dict[str, Any] = {}
    for side in ("near", "far"):
        ranked = sorted(candidates[side], key=lambda c: c[0])
        result[f"{side}_candidates"] = len(ranked)
        if not ranked:
            result[side] = None
            result[f"{side}_ambiguous"] = False
            continue
        ambiguous = False
        if len(ranked) > 1:
            tallest = max(ranked[0][1], ranked[1][1])
            ambiguous = (
                ranked[1][0] - ranked[0][0] <= AMBIGUOUS_FACTOR * tallest
            )
        result[side] = None if ambiguous else ranked[0][2]
        result[f"{side}_ambiguous"] = ambiguous
    return result


def torso_signature_v2(
    image: np.ndarray,
    keypoints: np.ndarray,
    scores: np.ndarray,
) -> list[float] | None:
    """Normalized median BGR of the shoulders/hips crop (COCO 5,6,11,12)."""
    torso_points = [
        keypoints[index]
        for index in (5, 6, 11, 12)
        if float(scores[index]) >= TORSO_MIN_CONF
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


def extract_side_change_evidence(
    clips_dir: Path,
    match_json_path: Path,
    output_path: Path,
    model_path: Path,
    backend: str,
    device: str,
    det_model: str = DET_MODEL_URL,
    config: Mapping[str, Any] | None = None,
    samples: int = SAMPLE_FRAMES,
    pose_model: Any | None = None,
    det_model_instance: Any | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    match = json.loads(match_json_path.read_text())
    points = sorted(
        match.get("points") or [], key=lambda point: int(point["idx"])
    )
    if not points:
        raise ValueError("match JSON contains no points")
    calibration = match.get("calibration")
    if not isinstance(calibration, Mapping) or calibration.get("ok") is False:
        raise ValueError("match JSON has no usable table calibration")

    first_clip = _clip_path(clips_dir, points[0])
    _, _, first_width, first_height = _clip_metadata(first_clip)
    if "size" not in calibration:
        source = match.get("source") or {}
        calibration = {
            **calibration,
            "size": [
                int(source.get("width") or first_width),
                int(source.get("height") or first_height),
            ],
        }

    if pose_model is None:
        actual_hash = sha256(model_path)
        if actual_hash != EXPECTED_CHECKPOINT_SHA256:
            raise ValueError("RTMPose checkpoint SHA-256 is unexpected")
        model_started = time.perf_counter()
        pose_model, engine_version = _create_pose_model(
            model_path, backend, device
        )
        model_load_s = time.perf_counter() - model_started
        checkpoint_hash = actual_hash
    else:
        engine_version = "injected-test-model"
        model_load_s = 0.0
        checkpoint_hash = sha256(model_path)
    if det_model_instance is None:
        det_started = time.perf_counter()
        # The detector always runs on CPU: onnxruntime's CoreML EP
        # rejects RTMDet-m's output shape outright (rank mismatch,
        # verified 2026-08-26), and this machine's Metal path has form —
        # the table-keypoint model SIGABRTs inside MPS too.
        det_model_instance = _create_det_model(det_model, backend, "cpu")
        model_load_s += time.perf_counter() - det_started

    cfg = merge_config(config)
    spread_max = float(cfg["spread_max"])
    point_summaries: list[dict[str, Any]] = []
    inference_s = 0.0
    decode_s = 0.0
    frames_requested = 0
    frames_decoded = 0

    for point in points:
        idx = int(point["idx"])
        clip = _clip_path(clips_dir, point)
        fps, frame_count, width, height = _clip_metadata(clip)
        corners = _scaled_corners(calibration, width, height)
        requested = point_sample_frames(frame_count, samples)
        capture = cv2.VideoCapture(str(clip))
        if not capture.isOpened():
            raise RuntimeError(f"could not open pose source clip: {clip}")
        frames_requested += len(requested)
        raw_samples: dict[str, list[list[float]]] = {"near": [], "far": []}
        candidate_stats: dict[str, list[int]] = {"near": [], "far": []}
        ambiguous_frames = 0
        try:
            for frame in requested:
                decode_started = time.perf_counter()
                image = _read_frame(capture, frame)
                decode_s += time.perf_counter() - decode_started
                if image is None:
                    continue
                frames_decoded += 1
                inference_started = time.perf_counter()
                boxes = dedupe_boxes(
                    [
                        [float(v) for v in box]
                        for box in det_model_instance(image)
                    ]
                )
                chosen = choose_players(boxes, corners)
                sides = [
                    side
                    for side in ("near", "far")
                    if chosen.get(side) is not None
                ]
                if chosen.get("near_ambiguous") or chosen.get(
                    "far_ambiguous"
                ):
                    ambiguous_frames += 1
                for side in ("near", "far"):
                    candidate_stats[side].append(
                        int(chosen[f"{side}_candidates"])
                    )
                if sides:
                    bboxes = np.asarray(
                        [chosen[side] for side in sides], dtype=np.float32
                    )
                    keypoints, scores = pose_model(image, bboxes=bboxes)
                    for position, side in enumerate(sides):
                        signature = torso_signature_v2(
                            image,
                            keypoints[position],
                            scores[position],
                        )
                        if signature is not None:
                            raw_samples[side].append(signature)
                inference_s += time.perf_counter() - inference_started
        finally:
            capture.release()
        summary: dict[str, Any] = {
            "idx": idx,
            "t0": float(point["t0"]),
            "t1": float(point["t1"]),
            "near": summarize_point_side(raw_samples["near"], spread_max),
            "far": summarize_point_side(raw_samples["far"], spread_max),
            "ambiguous_frames": ambiguous_frames,
            "candidates": {
                side: max(values) if values else 0
                for side, values in candidate_stats.items()
            },
        }
        summary["qualified"] = bool(
            summary["near"]
            and summary["far"]
            and summary["near"]["ok"]
            and summary["far"]["ok"]
        )
        point_summaries.append(summary)

    detection = detect_side_changes(point_summaries, cfg)
    qualified = sum(1 for p in point_summaries if p["qualified"])
    status = detection["status"]
    if status == "ready" and qualified < 2:
        status = "withheld"
        detection["reason"] = "fewer than two qualified points"
    elapsed_s = time.perf_counter() - started
    evidence = {
        "version": EVIDENCE_VERSION,
        "status": status,
        "algorithm": ALGORITHM_VERSION,
        "model": {
            "family": "RTMPose",
            "name": "RTMPose-M COCO-17 + RTMDet-m person",
            "checkpoint_sha256": checkpoint_hash,
            "det_checkpoint_sha256": _det_checkpoint_sha(det_model),
            "profile": f"det-first sparse-{samples}",
            "engine": "rtmlib",
            "engine_version": engine_version,
            "backend": backend,
            "device": device,
        },
        "foreshortening": quad_foreshortening(
            calibration.get("table_corners_px") or {}
        ),
        "points": point_summaries,
        "pairs": detection["pairs"],
        "side_changes": detection["side_changes"],
        "flips_total": detection["flips_total"],
        "coverage": {"total": len(point_summaries), "qualified": qualified},
        "config": detection["config"],
        "compute": {
            "elapsed_s": round(elapsed_s, 6),
            "model_load_s": round(model_load_s, 6),
            "decode_s": round(decode_s, 6),
            "inference_s": round(inference_s, 6),
            "frames_requested": frames_requested,
            "frames_decoded": frames_decoded,
        },
    }
    if detection.get("reason"):
        evidence["reason"] = detection["reason"]
    validate_evidence(evidence)
    atomic_json(output_path, evidence)
    return evidence


def validate_evidence(evidence: Mapping[str, Any]) -> None:
    """Reject malformed or forbidden-provenance evidence before persist."""
    serialized = json.dumps(evidence, sort_keys=True).lower()
    if "ultralytics" in serialized or "yolo" in serialized:
        raise ValueError("evidence contains forbidden model provenance")
    if evidence.get("version") != EVIDENCE_VERSION:
        raise ValueError("evidence version must be 2")
    if evidence.get("algorithm") != ALGORITHM_VERSION:
        raise ValueError("evidence algorithm is unsupported")
    if evidence.get("status") not in {"ready", "withheld", "failed"}:
        raise ValueError("evidence status is unsupported")
    points = evidence.get("points")
    if not isinstance(points, list):
        raise ValueError("evidence points must be a list")
    indices = [int(point["idx"]) for point in points]
    if len(indices) != len(set(indices)):
        raise ValueError("evidence point indices must be unique")
    known = set(indices)
    for change in evidence.get("side_changes") or []:
        if change.get("kind") != "side_change":
            raise ValueError("side change kind is unsupported")
        for field in ("after_idx", "before_idx"):
            if int(change[field]) not in known:
                raise ValueError("side change references an unknown point")
        confidence = change.get("confidence")
        if (
            not isinstance(confidence, (int, float))
            or not 0.0 <= float(confidence) <= 1.0
        ):
            raise ValueError("side change confidence must be within [0,1]")
    compute = evidence.get("compute")
    if not isinstance(compute, Mapping):
        raise ValueError("evidence compute is required")
    for key, value in compute.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)) or float(value) < 0:
            raise ValueError(f"compute field {key} must be non-negative")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clips-dir", required=True, type=Path)
    parser.add_argument("--match-json", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--det-model", default=DET_MODEL_URL)
    parser.add_argument("--backend", default="onnxruntime")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--samples", type=int, default=SAMPLE_FRAMES)
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="JSON object of side_change threshold overrides",
    )
    args = parser.parse_args()
    overrides = json.loads(args.config) if args.config else None
    evidence = extract_side_change_evidence(
        clips_dir=args.clips_dir,
        match_json_path=args.match_json,
        output_path=args.output,
        model_path=args.model,
        backend=args.backend,
        device=args.device,
        det_model=args.det_model,
        config=overrides,
        samples=args.samples,
    )
    confirmed = [
        change
        for change in evidence["side_changes"]
        if change.get("confirmed")
    ]
    print(
        f"{evidence['status']}: {evidence['coverage']['qualified']}/"
        f"{evidence['coverage']['total']} qualified points, "
        f"{len(confirmed)} confirmed side change(s)"
    )


if __name__ == "__main__":
    main()
