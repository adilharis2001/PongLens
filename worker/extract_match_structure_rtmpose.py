#!/usr/bin/env python3
"""Extract summarized RTMPose first-server and player-end evidence."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Mapping, Sequence

import cv2
import numpy as np

if __package__:
    from .match_structure import (
        ALGORITHM_VERSION,
        EXPECTED_CHECKPOINT_SHA256,
        aggregate_first_server,
        assign_anonymous_players,
        build_player_regions,
        detect_end_changes,
        detect_server_side,
        encode_players,
        torso_signature,
    )
else:
    from match_structure import (
        ALGORITHM_VERSION,
        EXPECTED_CHECKPOINT_SHA256,
        aggregate_first_server,
        assign_anonymous_players,
        build_player_regions,
        detect_end_changes,
        detect_server_side,
        encode_players,
        torso_signature,
    )


FORBIDDEN_MODEL_PATTERN = re.compile(r"ultralytics|yolo", re.IGNORECASE)
PROFILE = "sparse-3"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def point_sample_frames(frame_count: int) -> list[int]:
    """Return exact 20%, 50%, and 80% frame indices for one point clip."""
    if frame_count <= 0:
        return []
    last = frame_count - 1
    return sorted(
        {
            min(last, max(0, int(round(last * fraction))))
            for fraction in (0.2, 0.5, 0.8)
        }
    )


def rebase_point_detections(
    detections: Mapping[int, tuple[float, float]],
    point: Mapping[str, Any],
    source_fps: float,
    clip_fps: float,
) -> dict[int, tuple[float, float]]:
    """Translate original-video BlurBall frames into one padded point clip."""
    if (
        not math.isfinite(source_fps)
        or source_fps <= 0
        or not math.isfinite(clip_fps)
        or clip_fps <= 0
    ):
        raise ValueError("source and clip fps must be positive")
    start = float(point["clip_t0"])
    end = float(point["clip_t1"])
    if not math.isfinite(start) or not math.isfinite(end) or end <= start:
        raise ValueError("point clip range must be finite and increasing")
    result = {}
    for frame, position in sorted(detections.items()):
        source_time = int(frame) / source_fps
        if source_time < start or source_time > end:
            continue
        local_frame = int(round((source_time - start) * clip_fps))
        result[local_frame] = (float(position[0]), float(position[1]))
    return result


def atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(str(path) + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def _load_detections(path: Path) -> dict[int, tuple[float, float]]:
    if not path.is_file():
        return {}
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        x = record.get("x")
        y = record.get("y")
        if x is None or y is None:
            continue
        frame = record.get("f", record.get("frame"))
        if frame is None:
            continue
        result[int(frame)] = (float(x), float(y))
    return result


def _write_detections(
    path: Path,
    detections: Mapping[int, tuple[float, float]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(
            json.dumps({"f": frame, "x": xy[0], "y": xy[1], "conf": 1.0})
            + "\n"
            for frame, xy in sorted(detections.items())
        )
    )


def _clip_path(clips_dir: Path, point: Mapping[str, Any]) -> Path:
    idx = int(point["idx"])
    candidates = [clips_dir / f"point-{idx:03d}.mp4"]
    clip = point.get("clip")
    if clip:
        relative = Path(str(clip))
        candidates.extend([clips_dir / relative, clips_dir / relative.name])
    clip_path = point.get("clip_path")
    if clip_path and not str(clip_path).startswith("r2://"):
        candidates.append(clips_dir / Path(str(clip_path)).name)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"point {idx} clip is missing under {clips_dir}")


def _clip_metadata(path: Path) -> tuple[float, int, int, int]:
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise RuntimeError(f"could not open pose source clip: {path}")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH)))
        height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    finally:
        capture.release()
    if (
        not math.isfinite(fps)
        or fps <= 0
        or frame_count <= 0
        or width <= 0
        or height <= 0
    ):
        raise RuntimeError(f"invalid clip metadata: {path}")
    return fps, frame_count, width, height


def _scaled_corners(
    calibration: Mapping[str, Any],
    width: int,
    height: int,
) -> dict[str, list[float]]:
    corners = calibration.get("table_corners_px")
    if not isinstance(corners, Mapping):
        raise ValueError("calibration is missing table_corners_px")
    source_size = calibration.get("size") or [width, height]
    if (
        not isinstance(source_size, Sequence)
        or len(source_size) != 2
        or float(source_size[0]) <= 0
        or float(source_size[1]) <= 0
    ):
        raise ValueError("calibration size must contain width and height")
    scale_x = width / float(source_size[0])
    scale_y = height / float(source_size[1])
    return {
        str(name): [
            float(point[0]) * scale_x,
            float(point[1]) * scale_y,
        ]
        for name, point in corners.items()
    }


def _create_pose_model(
    model_path: Path,
    backend: str,
    device: str,
) -> tuple[Any, str]:
    try:
        from rtmlib import RTMPose
    except ImportError as exc:
        raise RuntimeError(
            "rtmlib is required; install worker/requirements-rtmpose.txt"
        ) from exc
    model = RTMPose(
        onnx_model=str(model_path),
        model_input_size=(192, 256),
        to_openpose=False,
        backend=backend,
        device=device,
    )
    try:
        version = importlib.metadata.version("rtmlib")
    except importlib.metadata.PackageNotFoundError:
        version = "unknown"
    return model, version


def _pose_players(
    model: Any,
    image: np.ndarray,
    regions: Mapping[str, Sequence[float]],
) -> list[dict[str, Any]]:
    sides = ("near", "far")
    bboxes = np.asarray([regions[side] for side in sides], dtype=np.float32)
    keypoints, scores = model(image, bboxes=bboxes)
    return encode_players(keypoints, scores, sides)


def _read_frame(capture: cv2.VideoCapture, frame: int) -> np.ndarray | None:
    capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame))
    ok, image = capture.read()
    return image if ok else None


def validate_evidence(evidence: Mapping[str, Any]) -> None:
    """Reject malformed, unversioned, or forbidden production evidence."""
    serialized = json.dumps(evidence, sort_keys=True)
    if FORBIDDEN_MODEL_PATTERN.search(serialized):
        raise ValueError("evidence contains forbidden model provenance")
    if evidence.get("version") != 1:
        raise ValueError("evidence version must be 1")
    if evidence.get("algorithm") != ALGORITHM_VERSION:
        raise ValueError("evidence algorithm is unsupported")
    if evidence.get("status") not in {"ready", "withheld", "failed"}:
        raise ValueError("evidence status is unsupported")
    model = evidence.get("model")
    if evidence.get("status") != "failed":
        if not isinstance(model, Mapping):
            raise ValueError("evidence model is required")
        if str(model.get("family", "")).lower() != "rtmpose":
            raise ValueError("evidence model family must be RTMPose")
        if model.get("checkpoint_sha256") != EXPECTED_CHECKPOINT_SHA256:
            raise ValueError("evidence checkpoint SHA-256 is unexpected")
        if model.get("profile") != PROFILE:
            raise ValueError("evidence profile must be sparse-3")
    points = evidence.get("points")
    if not isinstance(points, list):
        raise ValueError("evidence points must be a list")
    indices = [int(point["idx"]) for point in points]
    if len(indices) != len(set(indices)):
        raise ValueError("evidence point indices must be unique")
    known = set(indices)
    for change in evidence.get("end_changes") or []:
        for field in ("after_idx", "before_idx", "confirmed_at_idx"):
            if int(change[field]) not in known:
                raise ValueError("end change references an unknown point")
    compute = evidence.get("compute")
    if not isinstance(compute, Mapping):
        raise ValueError("evidence compute is required")
    for key, value in compute.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)) or float(value) < 0:
            raise ValueError(f"compute field {key} must be non-negative")


def extract_evidence(
    clips_dir: Path,
    blurball_dir: Path,
    match_json_path: Path,
    output_path: Path,
    model_path: Path,
    backend: str,
    device: str,
    pose_model: Any | None = None,
    checkpoint_sha256: str | None = None,
) -> dict[str, Any]:
    """Run summarized sparse-three extraction and atomically publish it."""
    started = time.perf_counter()
    match = json.loads(match_json_path.read_text())
    points = sorted(match.get("points") or [], key=lambda point: int(point["idx"]))
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
            model_path,
            backend,
            device,
        )
        model_load_s = time.perf_counter() - model_started
        checkpoint_hash = actual_hash
    else:
        engine_version = "injected-test-model"
        model_load_s = 0.0
        checkpoint_hash = checkpoint_sha256 or sha256(model_path)
        if checkpoint_hash != EXPECTED_CHECKPOINT_SHA256:
            raise ValueError("RTMPose checkpoint SHA-256 is unexpected")

    signatures: dict[int, dict[str, list[float]]] = {}
    serve_calls = []
    inference_s = 0.0
    decode_s = 0.0
    frames_requested = 0
    frames_decoded = 0
    clips_opened = 0

    for position, point in enumerate(points, start=1):
        idx = int(point["idx"])
        clip = _clip_path(clips_dir, point)
        fps, frame_count, width, height = _clip_metadata(clip)
        regions = build_player_regions(
            _scaled_corners(calibration, width, height),
            width,
            height,
        )
        detections = _load_detections(
            blurball_dir / f"point-{idx:03d}.jsonl"
        )
        early_limit = int(round(4.5 * fps))
        useful = sorted(
            frame
            for frame in detections
            if 0 <= int(frame) <= early_limit
        )
        requested = point_sample_frames(frame_count)
        if position <= 3:
            requested = sorted(set(requested) | set(useful))
        capture = cv2.VideoCapture(str(clip))
        if not capture.isOpened():
            raise RuntimeError(f"could not open pose source clip: {clip}")
        clips_opened += 1
        frames_requested += len(requested)
        samples: dict[str, list[list[float]]] = {"near": [], "far": []}
        serve_poses: dict[int, dict[str, dict[str, Any]]] = {}
        try:
            for frame in requested:
                decode_started = time.perf_counter()
                image = _read_frame(capture, frame)
                decode_s += time.perf_counter() - decode_started
                if image is None:
                    continue
                frames_decoded += 1
                inference_started = time.perf_counter()
                players = _pose_players(pose_model, image, regions)
                inference_s += time.perf_counter() - inference_started
                players_by_side = {
                    str(player["side"]): player for player in players
                }
                if frame in useful:
                    serve_poses[frame] = players_by_side
                if frame in point_sample_frames(frame_count):
                    for side, player in players_by_side.items():
                        signature = torso_signature(image, player)
                        if signature is not None:
                            samples[side].append(signature)
        finally:
            capture.release()
        point_signatures = {}
        for side, values in samples.items():
            if values:
                point_signatures[side] = [
                    round(float(value), 4)
                    for value in np.median(
                        np.asarray(values, dtype=float),
                        axis=0,
                    )
                ]
        signatures[idx] = point_signatures
        if position <= 3:
            serve_calls.append(
                {
                    "position": position,
                    "idx": idx,
                    **detect_server_side(
                        {frame: detections[frame] for frame in useful},
                        serve_poses,
                        fps,
                    ),
                }
            )

    assignments = assign_anonymous_players(signatures)
    changes = detect_end_changes(assignments)
    coverage = {
        status: sum(
            assignment["status"] == status
            for assignment in assignments.values()
        )
        for status in ("high_confidence", "needs_review", "unavailable")
    }
    coverage["total"] = len(assignments)
    status = "ready" if coverage["high_confidence"] else "withheld"
    elapsed_s = time.perf_counter() - started
    evidence = {
        "version": 1,
        "status": status,
        "algorithm": ALGORITHM_VERSION,
        "model": {
            "family": "RTMPose",
            "name": "RTMPose-M COCO-17",
            "checkpoint_sha256": checkpoint_hash,
            "profile": PROFILE,
            "engine": "rtmlib",
            "engine_version": engine_version,
            "backend": backend,
            "device": device,
        },
        "first_server": aggregate_first_server(serve_calls),
        "serve_calls": serve_calls,
        "points": [
            {
                "idx": int(point["idx"]),
                "t0": float(point["t0"]),
                "t1": float(point["t1"]),
                "assignment": assignments[int(point["idx"])],
            }
            for point in points
        ],
        "end_changes": changes,
        "coverage": coverage,
        "compute": {
            "elapsed_s": round(elapsed_s, 6),
            "model_load_s": round(model_load_s, 6),
            "decode_s": round(decode_s, 6),
            "inference_s": round(inference_s, 6),
            "postprocess_s": round(
                max(0.0, elapsed_s - model_load_s - decode_s - inference_s),
                6,
            ),
            "frames_requested": frames_requested,
            "frames_decoded": frames_decoded,
            "clips_opened": clips_opened,
        },
    }
    validate_evidence(evidence)
    atomic_json(output_path, evidence)
    return evidence


def _normalize_benchmark_match(
    manifest_path: Path,
    calibration_path: Path,
    destination: Path,
) -> None:
    manifest = json.loads(manifest_path.read_text())
    calibration = json.loads(calibration_path.read_text())
    atomic_json(
        destination,
        {
            "version": 1,
            "source": {
                "width": calibration["size"][0],
                "height": calibration["size"][1],
            },
            "calibration": {"ok": True, **calibration},
            "points": manifest["points"],
        },
    )


def _materialize_global_blurball(
    match_path: Path,
    clips_dir: Path,
    global_path: Path,
    destination: Path,
) -> None:
    match = json.loads(match_path.read_text())
    source_fps = float((match.get("source") or {})["fps"])
    detections = _load_detections(global_path)
    for point in match.get("points") or []:
        clip = _clip_path(clips_dir, point)
        clip_fps, _, _, _ = _clip_metadata(clip)
        rebased = rebase_point_detections(
            detections,
            point,
            source_fps,
            clip_fps,
        )
        _write_detections(
            destination / f"point-{int(point['idx']):03d}.jsonl",
            rebased,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clips-dir", type=Path)
    parser.add_argument("--blurball-dir", type=Path)
    parser.add_argument("--blurball", type=Path)
    parser.add_argument("--match-json", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--calibration", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--backend", default="onnxruntime")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    if args.validate_only:
        validate_evidence(json.loads(args.output.read_text()))
        print(f"validated {args.output}")
        return
    if not args.clips_dir or not args.model:
        parser.error("--clips-dir and --model are required")
    with tempfile.TemporaryDirectory(prefix="ponglens-structure-") as raw:
        temporary = Path(raw)
        if args.match_json:
            match_path = args.match_json
        elif args.manifest and args.calibration:
            match_path = temporary / "match.json"
            _normalize_benchmark_match(
                args.manifest,
                args.calibration,
                match_path,
            )
        else:
            parser.error(
                "use --match-json or both --manifest and --calibration"
            )
        if args.blurball_dir:
            blurball_dir = args.blurball_dir
        elif args.blurball:
            blurball_dir = temporary / "blurball"
            _materialize_global_blurball(
                match_path,
                args.clips_dir,
                args.blurball,
                blurball_dir,
            )
        else:
            parser.error("use --blurball-dir or --blurball")
        evidence = extract_evidence(
            clips_dir=args.clips_dir,
            blurball_dir=blurball_dir,
            match_json_path=match_path,
            output_path=args.output,
            model_path=args.model,
            backend=args.backend,
            device=args.device,
        )
    print(
        f"{evidence['status']}: {evidence['coverage']['high_confidence']}/"
        f"{evidence['coverage']['total']} high-confidence points"
    )


if __name__ == "__main__":
    main()
