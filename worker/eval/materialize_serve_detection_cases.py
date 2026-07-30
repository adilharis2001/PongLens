#!/usr/bin/env python3
"""Materialize anonymous, read-only inputs for serve-detection research."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
from pathlib import Path
from typing import Any, Callable, Mapping

import cv2
import numpy as np

try:
    from ..research_audio_candidates import point_audio_impacts
except ImportError:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from research_audio_candidates import point_audio_impacts  # type: ignore


TABLE_WIDTH_M = 1.525
TABLE_LENGTH_M = 2.74


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def resolve_inside(root: Path, relative: str | Path) -> Path:
    base = Path(root).resolve()
    resolved = (base / Path(relative)).resolve()
    if not resolved.is_relative_to(base):
        raise ValueError("path escapes the experiment root")
    return resolved


def _probe_clip(path: Path) -> dict[str, float | int]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"could not open point clip: {path.name}")
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    finally:
        capture.release()
    if (
        not math.isfinite(fps)
        or fps <= 0
        or frame_count <= 0
        or width <= 0
        or height <= 0
    ):
        raise ValueError(f"point clip metadata is invalid: {path.name}")
    return {
        "fps": fps,
        "frame_count": frame_count,
        "width": width,
        "height": height,
        "duration": frame_count / fps,
    }


def _link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(f"prepared media already exists: {destination}")
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def _load_global_detections(path: Path) -> list[dict[str, Any]]:
    detections = []
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            frame = int(row["f"])
            if row.get("x") is None and row.get("y") is None:
                continue
            x = float(row["x"])
            y = float(row["y"])
            confidence = float(row.get("conf") or 0.0)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"invalid BlurBall row at line {line_number}"
            ) from exc
        detections.append(
            {"f": frame, "x": x, "y": y, "conf": confidence}
        )
    return detections


def _localize_detections(
    detections: list[Mapping[str, Any]],
    *,
    source_fps: float,
    clip_t0: float,
    clip_fps: float,
    frame_count: int,
    scale_x: float,
    scale_y: float,
) -> list[dict[str, Any]]:
    by_frame: dict[int, dict[str, Any]] = {}
    for detection in detections:
        source_t = float(detection["f"]) / source_fps
        local_frame = int(round((source_t - clip_t0) * clip_fps))
        if not 0 <= local_frame < frame_count:
            continue
        localized = {
            "f": local_frame,
            "x": round(float(detection["x"]) * scale_x, 3),
            "y": round(float(detection["y"]) * scale_y, 3),
            "conf": round(float(detection.get("conf") or 0.0), 4),
        }
        existing = by_frame.get(local_frame)
        if existing is None or localized["conf"] > existing["conf"]:
            by_frame[local_frame] = localized
    return [by_frame[frame] for frame in sorted(by_frame)]


def _calibration(
    corners: list[list[float]],
    image_size: list[int],
    clip_size: tuple[int, int],
) -> dict[str, Any]:
    if len(corners) != 4 or len(image_size) != 2:
        raise ValueError("accepted calibration shape is invalid")
    image_width, image_height = (float(value) for value in image_size)
    clip_width, clip_height = clip_size
    if min(image_width, image_height, clip_width, clip_height) <= 0:
        raise ValueError("calibration dimensions must be positive")
    scale = np.asarray(
        [clip_width / image_width, clip_height / image_height],
        dtype=float,
    )
    points = (
        np.asarray(corners, dtype=np.float32) * scale
    ).astype(np.float32)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        raise ValueError("accepted calibration corners are invalid")
    destination = np.asarray(
        [
            [0.0, 0.0],
            [TABLE_WIDTH_M, 0.0],
            [TABLE_WIDTH_M, TABLE_LENGTH_M],
            [0.0, TABLE_LENGTH_M],
        ],
        dtype=np.float32,
    )
    homography = cv2.getPerspectiveTransform(points, destination)
    if not np.isfinite(homography).all():
        raise ValueError("accepted calibration homography is invalid")
    A, B, C, D = points.astype(float)
    axis = ((D - A) + (C - B)) / 2.0
    norm = float(np.linalg.norm(axis))
    if not math.isfinite(norm) or norm <= 1e-8:
        raise ValueError("accepted calibration length axis is invalid")
    axis /= norm
    return {
        "table_corners": [
            [round(float(value), 4) for value in point] for point in points
        ],
        "homography": [
            [round(float(value), 10) for value in row] for row in homography
        ],
        "length_axis": [
            round(float(axis[0]), 10),
            round(float(axis[1]), 10),
        ],
    }


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def _find_calibrations(evaluated: Mapping[str, Any]) -> dict[str, list]:
    calibrations = {}
    for case in evaluated.get("cases") or []:
        calibration = case.get("calibration") or {}
        if calibration.get("accepted") and calibration.get("corners"):
            calibrations[str(case["match_id"])] = calibration["corners"]
    return calibrations


def materialize_cases(
    table_root: Path,
    output_root: Path,
    *,
    probe_clip: Callable[[Path], Mapping[str, Any]] | None = None,
    audio_runner: Callable[[Path], list[dict[str, float]]] | None = None,
) -> dict[str, Any]:
    """Create anonymous serve cases from an existing local table experiment."""

    table_root = Path(table_root).resolve()
    output_root = Path(output_root).resolve()
    manifest_path = output_root / "serve-cases.json"
    if manifest_path.exists():
        raise FileExistsError("serve-cases.json already exists")
    output_root.mkdir(parents=True, exist_ok=True)
    cases_payload = json.loads(
        resolve_inside(table_root, "cases.json").read_text()
    )
    evaluated = json.loads(
        resolve_inside(table_root, "evaluated-results.json").read_text()
    )
    calibrations = _find_calibrations(evaluated)
    probe_clip = probe_clip or _probe_clip
    audio_runner = audio_runner or point_audio_impacts

    prepared_cases = []
    references = []
    for case_number, source_case in enumerate(
        cases_payload.get("cases") or [],
        start=1,
    ):
        private_match_id = str(source_case["match_id"])
        if private_match_id not in calibrations:
            raise ValueError("case has no accepted table calibration")
        case_key = f"case-{case_number:03d}"
        source_root = resolve_inside(table_root, str(source_case["root"]))
        match_path = resolve_inside(
            source_root,
            str(source_case["match_json"]),
        )
        match = json.loads(match_path.read_text())
        source = match.get("source") or {}
        source_fps = float(source.get("fps") or 0.0)
        source_width = int(source.get("width") or 0)
        source_height = int(source.get("height") or 0)
        if (
            source_fps <= 0
            or source_width <= 0
            or source_height <= 0
        ):
            raise ValueError("source metadata is invalid")
        match_points = {
            int(point["idx"]): point for point in match.get("points") or []
        }
        global_detections = _load_global_detections(
            resolve_inside(source_root, str(source_case["blurball"]))
        )
        prepared_points = []
        for source_point in source_case.get("points") or []:
            idx = int(source_point["idx"])
            match_point = match_points.get(idx)
            timing_source = "match_json"
            if not match_point:
                source_t0 = float(source_point.get("t0"))
                source_t1 = float(source_point.get("t1"))
                if (
                    not math.isfinite(source_t0)
                    or not math.isfinite(source_t1)
                    or source_t0 < 0
                    or source_t1 <= source_t0
                ):
                    raise ValueError(
                        f"point {idx} has no usable timing metadata"
                    )
                match_point = {
                    "clip_t0": max(0.0, source_t0 - 0.5),
                }
                timing_source = "case_manifest"
            source_clip = resolve_inside(
                source_root / str(source_case["clips"]),
                f"point-{idx:03d}.mp4",
            )
            if not source_clip.is_file():
                raise FileNotFoundError(
                    f"point {idx} clip is unavailable"
                )
            point_key = f"{case_key}-point-{idx:03d}"
            clip_relative = Path("media") / case_key / f"{point_key}.mp4"
            clip_path = output_root / clip_relative
            _link_or_copy(source_clip, clip_path)
            metadata = dict(probe_clip(clip_path))
            clip_fps = float(metadata["fps"])
            frame_count = int(metadata["frame_count"])
            clip_width = int(metadata["width"])
            clip_height = int(metadata["height"])
            clip_t0 = float(match_point.get("clip_t0"))
            localized = _localize_detections(
                global_detections,
                source_fps=source_fps,
                clip_t0=clip_t0,
                clip_fps=clip_fps,
                frame_count=frame_count,
                scale_x=clip_width / source_width,
                scale_y=clip_height / source_height,
            )
            ball_relative = (
                Path("evidence") / case_key / f"{point_key}-ball.jsonl"
            )
            ball_path = output_root / ball_relative
            ball_path.parent.mkdir(parents=True, exist_ok=True)
            ball_path.write_text(
                "".join(
                    json.dumps(row, separators=(",", ":")) + "\n"
                    for row in localized
                )
            )
            audio = sorted(
                (
                    {
                        "t": round(float(impact["t"]), 4),
                        "confidence": round(
                            float(impact["confidence"]),
                            4,
                        ),
                    }
                    for impact in audio_runner(clip_path)
                ),
                key=lambda impact: impact["t"],
            )
            audio_relative = (
                Path("evidence") / case_key / f"{point_key}-audio.json"
            )
            audio_path = output_root / audio_relative
            _write_json(audio_path, audio)
            calibration = _calibration(
                calibrations[private_match_id],
                list(source_case["image_size"]),
                (clip_width, clip_height),
            )
            point_record = {
                "point_key": point_key,
                "idx": idx,
                "clip_path": clip_relative.as_posix(),
                "clip_sha256": _sha256(clip_path),
                "ball_path": ball_relative.as_posix(),
                "ball_sha256": _sha256(ball_path),
                "audio_path": audio_relative.as_posix(),
                "audio_sha256": _sha256(audio_path),
                "fps": round(clip_fps, 8),
                "frame_count": frame_count,
                "duration": round(
                    float(metadata.get("duration") or frame_count / clip_fps),
                    6,
                ),
                "calibration_size": [clip_width, clip_height],
                "table_corners": calibration["table_corners"],
                "homography": calibration["homography"],
                "length_axis": calibration["length_axis"],
                "ball_detection_count": len(localized),
                "audio_impact_count": len(audio),
                "timing_source": timing_source,
            }
            prepared_points.append(point_record)
            references.append(
                {
                    "point_key": point_key,
                    "serve_contact_t": None,
                    "server_side": None,
                    "visibility": None,
                    "first_bounce_visible": None,
                    "second_bounce_visible": None,
                    "hard_negatives": [],
                    "note": "",
                }
            )
        prepared_cases.append(
            {
                "case_key": case_key,
                "points": prepared_points,
            }
        )

    manifest = {
        "version": 1,
        "kind": "multimodal_serve_detection",
        "cases": prepared_cases,
    }
    _write_json(manifest_path, manifest)
    _write_json(
        output_root / "references.template.json",
        {"version": 1, "points": references},
    )
    freeze_input_hash(
        manifest_path,
        output_root / "serve-input-lock.json",
    )
    return manifest


def _manifest_digest(manifest_path: Path) -> str:
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text())
    root = manifest_path.parent
    assets = []
    for case in manifest.get("cases") or []:
        for point in case.get("points") or []:
            for prefix in ("clip", "ball", "audio"):
                asset = resolve_inside(root, str(point[f"{prefix}_path"]))
                expected = str(point[f"{prefix}_sha256"])
                actual = _sha256(asset)
                if actual != expected:
                    raise ValueError(
                        f"prepared {prefix} input hash changed"
                    )
                assets.append(
                    {
                        "point_key": point["point_key"],
                        "kind": prefix,
                        "sha256": actual,
                    }
                )
    return _canonical_sha256({"manifest": manifest, "assets": assets})


def freeze_input_hash(manifest_path: Path, lock_path: Path) -> str:
    digest = _manifest_digest(Path(manifest_path))
    lock_path = Path(lock_path)
    if lock_path.exists():
        existing = json.loads(lock_path.read_text())
        if existing.get("sha256") != digest:
            raise ValueError("serve experiment inputs changed")
        return digest
    _write_json(
        lock_path,
        {
            "version": 1,
            "sha256": digest,
            "manifest": Path(manifest_path).name,
        },
    )
    return digest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--table-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = materialize_cases(args.table_root, args.output)
    print(
        json.dumps(
            {
                "cases": len(result["cases"]),
                "points": sum(
                    len(case["points"]) for case in result["cases"]
                ),
                "output": str(args.output / "serve-cases.json"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
