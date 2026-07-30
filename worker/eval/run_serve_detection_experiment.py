#!/usr/bin/env python3
"""Run deterministic serve-detection ablations on local anonymous cases."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import resource
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Mapping

import cv2
import numpy as np

try:
    from ..placement_reconstruction import reconstruct_placement
    from ..points_pipeline import Px, fit_play
    from ..serve_detection import select_server_hypothesis
    from .materialize_serve_detection_cases import resolve_inside
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from placement_reconstruction import reconstruct_placement  # type: ignore
    from points_pipeline import Px, fit_play  # type: ignore
    from serve_detection import select_server_hypothesis  # type: ignore
    from eval.materialize_serve_detection_cases import (  # type: ignore
        resolve_inside,
    )


LOCAL_ARMS = (
    "wrist_baseline",
    "geometry",
    "geometry_audio",
    "geometry_audio_motion",
)


def _load_detections(path: Path) -> dict[int, tuple[float, float]]:
    detections = {}
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            detections[int(row["f"])] = (
                float(row["x"]),
                float(row["y"]),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"invalid point ball row at line {line_number}"
            ) from exc
    return detections


def _peak_rss_bytes() -> int:
    value = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return value if sys.platform == "darwin" else value * 1024


def _empty_track() -> dict[str, list]:
    return {"segments": [], "bounces": [], "hits": []}


def _run_track(
    detections,
    homography,
    axis,
    f0,
    f1,
    fps,
    px,
):
    return (
        fit_play(
            detections,
            homography,
            axis,
            f0,
            f1,
            fps,
            px,
        )
        or _empty_track()
    )


def run_point(
    point: Mapping[str, Any],
    root: Path,
    arm: str,
    *,
    track_runner: Callable[..., Mapping[str, Any]] | None = None,
    reconstruction_runner: Callable[..., Mapping[str, Any]] | None = None,
    motion_runner: Callable[..., Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run one ablation across the complete prepared point clip."""

    if arm not in LOCAL_ARMS:
        raise ValueError(f"unsupported local arm: {arm}")
    if arm == "wrist_baseline":
        return {
            "point_key": point["point_key"],
            "idx": int(point["idx"]),
            "arm": arm,
            "status": "unavailable",
            "server_side": None,
            "reason": "baseline_not_present_in_anonymous_case",
            "frame_window": [0, int(point["frame_count"])],
            "audio_impact_count": 0,
            "motion_status": "not_applicable",
            "motion_changed_decision": False,
            "wall_s": 0.0,
            "peak_rss_bytes": _peak_rss_bytes(),
        }

    root = Path(root).resolve()
    frame_count = int(point["frame_count"])
    fps = float(point["fps"])
    width, _height = (int(value) for value in point["calibration_size"])
    if frame_count <= 0 or fps <= 0 or width <= 0:
        raise ValueError("point runtime metadata is invalid")
    detections = _load_detections(
        resolve_inside(root, str(point["ball_path"]))
    )
    use_audio = arm in {
        "geometry_audio",
        "geometry_audio_motion",
    }
    audio_impacts = (
        json.loads(
            resolve_inside(root, str(point["audio_path"])).read_text()
        )
        if use_audio
        else []
    )
    homography = np.asarray(point["homography"], dtype=float)
    axis = np.asarray(point["length_axis"], dtype=float)
    if homography.shape != (3, 3) or axis.shape != (2,):
        raise ValueError("point calibration is invalid")
    track_runner = track_runner or _run_track
    reconstruction_runner = (
        reconstruction_runner or reconstruct_placement
    )
    started = time.perf_counter()
    track = track_runner(
        detections,
        homography,
        axis,
        0,
        frame_count,
        fps,
        Px(width),
    )
    reconstruction = reconstruction_runner(
        det=detections,
        H=homography,
        e=axis,
        track=track or _empty_track(),
        suggestion=None,
        f0=0,
        f1=frame_count,
        fps=fps,
        width=width,
        audio_impacts=audio_impacts,
    )
    decision = select_server_hypothesis(reconstruction)
    wall_s = time.perf_counter() - started
    motion = None
    motion_status = "not_requested"
    if arm == "geometry_audio_motion":
        candidate_times = []
        serve = decision.get("serve") or {}
        for value in (
            serve.get("contact_t"),
            (serve.get("first_bounce") or {}).get("t"),
        ):
            if value is not None:
                candidate_times.append(float(value))
        if not candidate_times:
            candidate_times = [
                float(candidate["t"])
                for candidate in reconstruction.get("candidates") or []
                if candidate.get("kind") in {"contact", "impact"}
                and candidate.get("t") is not None
            ][:2]
        if motion_runner is None:
            motion = {
                "status": "unavailable",
                "reason": "motion_runtime_unavailable",
                "supporting_side": None,
                "confidence": 0.0,
            }
        else:
            motion = dict(
                motion_runner(
                    resolve_inside(root, str(point["clip_path"])),
                    candidate_times,
                    point["table_corners"],
                )
            )
        motion_status = str(motion.get("status") or "unavailable")
    return {
        "point_key": point["point_key"],
        "idx": int(point["idx"]),
        "arm": arm,
        **decision,
        "frame_window": [0, frame_count],
        "ball_detection_count": len(detections),
        "audio_impact_count": len(audio_impacts),
        "motion_status": motion_status,
        "motion_changed_decision": False,
        **({"motion": motion} if motion is not None else {}),
        "wall_s": round(wall_s, 6),
        "peak_rss_bytes": _peak_rss_bytes(),
        "reconstruction": reconstruction,
    }


def _git_revision(cwd: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    revision = completed.stdout.strip()
    if len(revision) != 40:
        raise ValueError("git revision is invalid")
    return revision


def _input_hash(cases_path: Path) -> str:
    lock_path = cases_path.parent / "serve-input-lock.json"
    if lock_path.is_file():
        lock = json.loads(lock_path.read_text())
        digest = str(lock.get("sha256") or "")
        if len(digest) == 64:
            return digest
    return hashlib.sha256(cases_path.read_bytes()).hexdigest()


def _arm_summary(points: list[Mapping[str, Any]]) -> dict[str, Any]:
    counts = {
        status: sum(point.get("status") == status for point in points)
        for status in (
            "high_confidence",
            "needs_review",
            "unavailable",
        )
    }
    wall = [float(point.get("wall_s") or 0.0) for point in points]
    return {
        "total": len(points),
        **counts,
        "wall_s": round(sum(wall), 6),
        "mean_point_wall_s": (
            round(sum(wall) / len(wall), 6) if wall else 0.0
        ),
    }


def run_experiment(
    cases_path: Path,
    output_path: Path,
    *,
    run_id: str,
    point_runner: Callable[[Mapping[str, Any], Path, str], dict] | None = None,
    git_revision: str | None = None,
) -> dict[str, Any]:
    """Run all local arms once and write one append-only artifact."""

    cases_path = Path(cases_path).resolve()
    output_path = Path(output_path).resolve()
    if output_path.exists():
        raise FileExistsError(f"output already exists: {output_path.name}")
    if not run_id or any(character.isspace() for character in run_id):
        raise ValueError("run_id must be non-empty and contain no whitespace")
    payload = json.loads(cases_path.read_text())
    root = cases_path.parent
    point_runner = point_runner or (
        lambda point, case_root, arm: run_point(
            point,
            case_root,
            arm,
        )
    )
    started = time.perf_counter()
    arms: dict[str, dict[str, Any]] = {}
    all_points = [
        point
        for case in payload.get("cases") or []
        for point in case.get("points") or []
    ]
    for arm in LOCAL_ARMS:
        point_results = [
            point_runner(point, root, arm) for point in all_points
        ]
        arms[arm] = {
            "summary": _arm_summary(point_results),
            "points": point_results,
        }
    result = {
        "version": 1,
        "kind": "multimodal_serve_detection",
        "run_id": run_id,
        "git_commit": git_revision or _git_revision(
            Path(__file__).resolve().parents[2]
        ),
        "input_sha256": _input_hash(cases_path),
        "case_count": len(payload.get("cases") or []),
        "point_count": len(all_points),
        "arms": arms,
        "dependency_ledger": [
            {
                "name": "Python",
                "version": platform.python_version(),
                "license": "PSF-2.0",
            },
            {
                "name": "NumPy",
                "version": np.__version__,
                "license": "BSD-3-Clause",
            },
            {
                "name": "OpenCV",
                "version": cv2.__version__,
                "license": "Apache-2.0",
            },
        ],
        "timing": {
            "total_wall_s": round(time.perf_counter() - started, 6),
            "peak_rss_bytes": _peak_rss_bytes(),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    result = run_experiment(
        args.cases,
        args.output,
        run_id=args.run_id,
    )
    print(
        json.dumps(
            {
                "run_id": result["run_id"],
                "cases": result["case_count"],
                "points": result["point_count"],
                "output": str(args.output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
