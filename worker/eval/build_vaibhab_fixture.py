#!/usr/bin/env python3
"""Build the compact five-point Vaibhab placement regression fixture."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from worker.points_pipeline import Px, fit_play  # noqa: E402


SERVER_TRUTH = {1: "far", 2: "near", 3: "near", 4: "far", 5: "far"}
TERMINAL_TRUTH = {
    1: "out",
    2: "net",
    3: "winner_landing",
    4: "out",
    5: "winner_landing",
}
FINAL_HITTER_TRUTH = {
    1: "far",
    2: "near",
    3: "near",
    4: "near",
    5: "far",
}
MIN_SHOT_TRUTH = {1: 3, 2: 3, 3: 5, 4: 4, 5: 3}

# Point-scoped, manually reviewed output from hf10k_ema_v1. The detector has
# measurable latency relative to video; reconstruction therefore treats these
# only as optional timing support within its tolerance window.
AUDIO_IMPACTS = {
    1: [(1.693, 3.080), (2.052, 2.518), (2.878, 2.549), (3.143, 15.245)],
    2: [(12.886, 4.956), (14.221, 1.981), (15.517, 3.069)],
    3: [
        (24.464, 5.071),
        (24.793, 3.038),
        (25.276, 4.958),
        (26.144, 4.786),
        (26.649, 2.696),
        (27.135, 9.642),
    ],
    4: [
        (33.797, 2.004),
        (34.189, 3.211),
        (34.874, 3.889),
        (35.186, 6.039),
        (35.360, 8.469),
        (35.475, 3.279),
    ],
    5: [
        (43.210, 2.399),
        (43.591, 3.647),
        (44.228, 3.446),
        (44.492, 3.187),
        (44.656, 1.737),
    ],
}


def load_detections(path: Path) -> dict[int, tuple[float, float]]:
    detections = {}
    with path.open() as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("x") is not None and record.get("y") is not None:
                detections[int(record["f"])] = (
                    float(record["x"]),
                    float(record["y"]),
                )
    return detections


def calibration_matrix(calibration: dict) -> np.ndarray:
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
        [[0.0, 0.0], [1.525, 0.0], [1.525, 2.74], [0.0, 2.74]],
        dtype=np.float32,
    )
    return cv2.getPerspectiveTransform(source, destination)


def build_fixture(match: dict, detections: dict[int, tuple[float, float]]) -> dict:
    source = match["source"]
    fps = float(source["fps"])
    width = int(source["width"])
    H = calibration_matrix(match["calibration"])
    axis = tuple(float(value) for value in match["calibration"]["length_axis"])
    px = Px(width)
    points = []

    for source_point in match["points"][:5]:
        idx = int(source_point["idx"])
        f0 = max(0, int(math.floor(float(source_point["t0"]) * fps)))
        f1 = int(math.ceil(float(source_point["t1"]) * fps)) + 1
        point_detections = {
            frame: detections[frame]
            for frame in range(f0, f1)
            if frame in detections
        }
        track = fit_play(point_detections, H, axis, f0, f1, fps, px) or {
            "segments": [],
            "bounces": [],
            "hits": [],
            "serve_side": None,
        }
        points.append(
            {
                "idx": idx,
                "f0": f0,
                "f1": f1,
                "server_side": SERVER_TRUTH[idx],
                "terminal_truth": TERMINAL_TRUTH[idx],
                "final_hitter_truth": FINAL_HITTER_TRUTH[idx],
                "min_shots": MIN_SHOT_TRUTH[idx],
                "suggestion": source_point.get("suggestion"),
                "audio_impacts": [
                    {"t": time_s, "confidence": confidence}
                    for time_s, confidence in AUDIO_IMPACTS[idx]
                ],
                "detections": {
                    str(frame): [round(x, 3), round(y, 3)]
                    for frame, (x, y) in point_detections.items()
                },
                "track": track,
                "placement_v2": source_point.get("placement"),
            }
        )

    return {
        "fixture_version": 1,
        "source": {
            "match": "Vaibhab",
            "detector": "BlurBall",
            "audio_detector": "hf10k_ema_v1",
            "note": "Five user-narrated regression points; no media paths.",
        },
        "fps": fps,
        "width": width,
        "height": int(source["height"]),
        "homography": H.round(10).tolist(),
        "length_axis": list(axis),
        "points": points,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--match-json", required=True, type=Path)
    parser.add_argument("--blurball", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    match = json.loads(args.match_json.read_text())
    fixture = build_fixture(match, load_detections(args.blurball))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"Wrote {len(fixture['points'])} points to {args.output}")


if __name__ == "__main__":
    main()
