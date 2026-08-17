"""Placement-v3 reconstruction helpers for already-segmented matches."""

from __future__ import annotations

import copy
import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import cv2
import numpy as np

try:
    from .placement_reconstruction import reconstruct_placement
    from .points_pipeline import Px, fit_play, keypoint_calibrate
    from .table_coordinates import (
        canonicalize_table_quad,
        table_homography,
    )
except ImportError:  # Direct execution from worker/.
    from placement_reconstruction import reconstruct_placement
    from points_pipeline import Px, fit_play, keypoint_calibrate
    from table_coordinates import canonicalize_table_quad, table_homography


W_M = 1.525
L_M = 2.74


@dataclass(frozen=True)
class CalibrationResult:
    runtime: Mapping[str, Any] | None
    stored: Mapping[str, Any]


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
    canonical = canonicalize_table_quad(
        source,
        near_pair=(0, 1),
    )
    return table_homography(canonical)


def unavailable_placement(reason: str) -> dict[str, Any]:
    hypotheses = {}
    for side in ("near", "far"):
        hypotheses[side] = {
            "serverSide": side,
            "server_side": side,
            "status": "unavailable",
            "confidence": 0.0,
            "score": 0.0,
            "reasons": [reason],
            "hard_reasons": [reason],
            "shots": [],
            "used_event_ids": [],
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


# What a point in match.json is allowed to contain. The artifact is the
# pipeline's own output; the points TABLE is the app's, and the two have been
# drifting apart since the day someone added a column.
#
# merge_match_placements used to copy the whole database row over each point,
# which wrote every one of those app columns — deleted, starred,
# confirmed_winner, scored_at_cut_s, serve_spin and eighteen more — into the
# artifact. worker.validate_placement_only_match_update then refused the
# result, correctly, because the points had changed outside placement. That
# broke every placement generation and retry from the moment the table
# outgrew this list. The last one to succeed ran on 2026-07-30.
#
# An allow-list rather than "keys already present": a database point with no
# counterpart in match.json still has to come out as a usable point, and
# under the other rule it came out empty.
ARTIFACT_POINT_FIELDS = frozenset({
    "idx", "t0", "t1", "clip_t0", "clip_t1", "cut_t0", "clip",
    "server_side", "server", "suggestion", "placement",
})


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
        incoming = copy.deepcopy(dict(database_point))
        point.update({key: value for key, value in incoming.items()
                      if key in ARTIFACT_POINT_FIELDS})
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


def recover_calibration(
    match: Mapping[str, Any],
    video_path: str | Path,
    detections: Mapping[int, tuple[float, float]],
    workdir: str | Path,
) -> CalibrationResult:
    """Reuse the stored calibration, or recompute one from the video.

    `detections` is unused now and kept in the signature because two call
    sites and their tests pass it positionally. The pink calibrator needed
    ball evidence to tell a table from a banner; the keypoint detector asks
    the network where the table's landmarks are and needs no such hint.
    """
    del detections
    saved = match.get("calibration") or {"ok": False}
    if saved.get("ok"):
        return CalibrationResult(runtime=saved, stored=saved)

    # The keypoint detector, not the pink-rim one this used to call. A
    # backfill exists to REPAIR matches whose quads were wrong, and the pink
    # calibrator is what got most of them wrong: 3.50% median corner error
    # with 20 gross failures in 50 against the hand marks. Recomputing with
    # it would have reproduced the defect it was meant to fix.
    recovered = keypoint_calibrate(str(video_path), str(workdir))
    if recovered is None:
        return CalibrationResult(runtime=None, stored={"ok": False})
    stored = {
        "ok": True,
        "table_corners_px": recovered["corners_px"],
        "length_axis": recovered["e"],
        "note": recovered.get("note", "recomputed during placement v3 backfill"),
    }
    return CalibrationResult(runtime=recovered, stored=stored)


def reconstruct_files(
    match_path: Path,
    points_path: Path,
    blurball_path: Path,
    video_path: Path,
    output_path: Path,
) -> None:
    match = json.loads(match_path.read_text())
    points = json.loads(points_path.read_text())
    detections = load_detections(blurball_path)
    calibration = recover_calibration(
        match,
        video_path,
        detections,
        output_path.parent,
    )
    match["calibration"] = copy.deepcopy(calibration.stored)
    placements = reconstruct_existing_match(
        match,
        points,
        detections,
        calibration.runtime,
    )
    merged = merge_match_placements(match, points, placements)
    output_path.write_text(
        json.dumps(
            {
                "placements": placements,
                "match": merged,
            },
            indent=2,
        )
        + "\n"
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    reconstruct = subparsers.add_parser("reconstruct")
    reconstruct.add_argument("--match-json", required=True, type=Path)
    reconstruct.add_argument("--points-json", required=True, type=Path)
    reconstruct.add_argument("--blurball", required=True, type=Path)
    reconstruct.add_argument("--video", required=True, type=Path)
    reconstruct.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    if args.command == "reconstruct":
        reconstruct_files(
            args.match_json,
            args.points_json,
            args.blurball,
            args.video,
            args.output,
        )


if __name__ == "__main__":
    main()
