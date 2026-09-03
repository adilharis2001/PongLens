#!/usr/bin/env python3
"""Sample the BREAK footage between rallies and record who is standing where.

The changeover detector has only ever read the per-point clips: seven
frames from the rally before a break and seven from the rally after,
with the break itself unopened. But a changeover is not a state that
holds still either side of a gap — it is a walk, and the walk happens
entirely inside the gap. This script opens that footage.

Two coordinates per person, both built by interpolating between the
table's own lines rather than by inverting a homography. A homography
extrapolated behind the far end is numerically wild exactly where the
far player stands, and end-on cameras make it worse; line interpolation
degrades gently instead of exploding.

    depth    0 at the far end line, 1 at the near end line, >1 in front
             of the near end and <0 behind the far end. Uses the rule
             that already holds 44 of 44 on the calibration corpus: the
             near end line always sits lower in the frame.
    lateral  0 at the left sideline, 1 at the right, as the camera sees
             them, measured at that person's own depth.

Appearance is captured in the same pass — five horizontal bands of each
box in Lab — so experiments on what a person LOOKS like during a break
need no second decode. The bands are crude on purpose: this is asking
whether break frames carry a better signal than rally frames, not
proposing a descriptor.

Reads the source video sequentially and grabs without decoding outside
the windows it wants. Seeking a 27-minute phone capture hundreds of
times is both slower and less exact.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Mapping

# worker/worker.py is a MODULE named `worker`, and a real module beats a
# namespace package wherever it is found. Running a script that lives in
# worker/ puts that directory on sys.path, so `worker.x` resolves against
# worker.py and fails. Drop our own directory first.
HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != HERE]
sys.path.insert(0, str(HERE.parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from worker.extract_side_changes_rtmpose import (  # noqa: E402
    _create_det_model, _named_corners, dedupe_boxes, quad_foreshortening,
)

from worker.extract_side_changes_rtmpose import (  # noqa: E402
    DET_MODEL_URL,
)
# 2 Hz is the slowest rate at which a walking person still lands within
# about a metre of their previous position, which is what makes frame to
# frame linking possible with no motion model. The cap stops a two-minute
# break between games from costing forty times a normal one.
SAMPLE_HZ = 2.0
MAX_FRAMES = 90
# Four seconds is the floor for a corpus, but some matches are cut so
# that consecutive rallies are barely a second apart — the dead time
# lives INSIDE the rally bounds rather than between them. Lowering the
# floor is how you look at those at all.
MIN_BREAK_S = float(os.environ.get("PONGLENS_MIN_BREAK_S", "4.0"))
# Bands as fractions of box height, and the central slice of the width
# that is mostly person rather than background behind them.
BANDS = (
    ("head", 0.00, 0.16),
    ("torso", 0.20, 0.45),
    ("shorts", 0.45, 0.62),
    ("legs", 0.62, 0.85),
    ("shoes", 0.88, 1.00),
)
BAND_WIDTH_KEEP = 0.6


def _line_y_at(x: float, a: list[float], b: list[float]) -> float:
    if abs(b[0] - a[0]) < 1e-6:
        return (a[1] + b[1]) / 2.0
    t = (x - a[0]) / (b[0] - a[0])
    return a[1] + t * (b[1] - a[1])


def _line_x_at(y: float, a: list[float], b: list[float]) -> float:
    if abs(b[1] - a[1]) < 1e-6:
        return (a[0] + b[0]) / 2.0
    t = (y - a[1]) / (b[1] - a[1])
    return a[0] + t * (b[0] - a[0])


def table_frame(corners: Mapping[str, Any]):
    """Return depth/lateral for a foot point, plus the geometry it used."""
    named = _named_corners(corners)
    near = (named["A"], named["B"])   # 1.525 m end nearest the camera
    far = (named["C"], named["D"])
    left = (named["A"], named["D"])   # sidelines, camera's left and right
    right = (named["B"], named["C"])

    def coords(x: float, y: float) -> tuple[float, float]:
        y_near = _line_y_at(x, *near)
        y_far = _line_y_at(x, *far)
        span = y_near - y_far
        depth = (y - y_far) / span if abs(span) > 1e-6 else float("nan")
        x_left = _line_x_at(y, *left)
        x_right = _line_x_at(y, *right)
        width = x_right - x_left
        lateral = (x - x_left) / width if abs(width) > 1e-6 else float("nan")
        return depth, lateral

    return coords


def band_lab(frame: np.ndarray, box: list[float]) -> dict[str, list[float]]:
    """Median Lab of five horizontal bands of one person's box."""
    x0, y0, x1, y1 = (float(v) for v in box[:4])
    h, w = frame.shape[:2]
    bw = x1 - x0
    keep = bw * (1.0 - BAND_WIDTH_KEEP) / 2.0
    cx0 = int(max(0, min(w - 1, x0 + keep)))
    cx1 = int(max(cx0 + 1, min(w, x1 - keep)))
    out: dict[str, list[float]] = {}
    for name, top, bottom in BANDS:
        by0 = int(max(0, min(h - 1, y0 + (y1 - y0) * top)))
        by1 = int(max(by0 + 1, min(h, y0 + (y1 - y0) * bottom)))
        patch = frame[by0:by1, cx0:cx1]
        if patch.size == 0:
            continue
        lab = cv2.cvtColor(patch.reshape(-1, 1, 3).astype(np.uint8),
                           cv2.COLOR_BGR2LAB).reshape(-1, 3)
        out[name] = [round(float(v), 1) for v in np.median(lab, axis=0)]
    return out


def breaks(points: list[dict], duration: float) -> list[dict]:
    """Gaps between consecutive live rallies, in source seconds."""
    live = [p for p in points
            if not p.get("deleted") and p.get("t0") is not None
            and p.get("t1") is not None]
    live.sort(key=lambda p: float(p["t0"]))
    out = []
    for i in range(len(live) - 1):
        a, b = live[i], live[i + 1]
        t0, t1 = float(a["t1"]), float(b["t0"])
        if t1 - t0 < MIN_BREAK_S:
            continue
        out.append({
            "after_idx": int(a["idx"]), "before_idx": int(b["idx"]),
            "t0": round(t0, 2), "t1": round(t1, 2),
            "duration": round(t1 - t0, 2),
        })
    return out


def wanted_frames(window: dict, fps: float) -> list[int]:
    n = int(max(4, min(MAX_FRAMES, round(window["duration"] * SAMPLE_HZ))))
    times = np.linspace(window["t0"], window["t1"], n)
    return sorted({int(round(t * fps)) for t in times})


def run(match_dir: Path, out_path: Path, det_model: str,
        limit: int | None = None) -> None:
    match = json.loads((match_dir / "match.json").read_text())
    calibration = match.get("calibration") or {}
    corners = calibration.get("table_corners_px")
    if not corners:
        raise SystemExit("no calibration corners")
    source = next(
        (p for p in match_dir.glob("source.*") if p.suffix.lower()
         in (".mp4", ".mov", ".m4v")), None)
    if source is None:
        raise SystemExit("no source video")

    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS) or float(
        (match.get("source") or {}).get("fps") or 30.0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    src = match.get("source") or {}
    # The corners are stored in the source video's own pixels. This IS the
    # source video, so they need no rescale — but check, because reading a
    # re-encoded copy at another size and skipping the scale is exactly
    # the trap that put 50 of 62 quads off the frame in the last study.
    sw, sh = int(src.get("width") or width), int(src.get("height") or height)
    scale = 1.0
    if sw and width and sw != width:
        scale = width / sw
        corners = {k: [v[0] * scale, v[1] * scale] for k, v in corners.items()}
    coords = table_frame(corners)

    windows = breaks(match.get("points") or [], total / fps if fps else 0.0)
    if limit:
        windows = windows[:limit]
    want: dict[int, int] = {}
    for wi, window in enumerate(windows):
        for f in wanted_frames(window, fps):
            want.setdefault(f, wi)

    model = _create_det_model(det_model, "onnxruntime", "cpu")
    per_window: list[list[dict]] = [[] for _ in windows]
    started = time.perf_counter()
    seen = 0
    frame_i = -1
    highest = max(want) if want else -1
    while True:
        ok = cap.grab()
        if not ok:
            break
        frame_i += 1
        if frame_i > highest:
            break
        wi = want.get(frame_i)
        if wi is None:
            continue
        ok, frame = cap.retrieve()
        if not ok:
            continue
        boxes = dedupe_boxes([[float(v) for v in b] for b in model(frame)])
        people = []
        for box in boxes:
            ax = (box[0] + box[2]) / 2.0
            ay = box[3]
            depth, lateral = coords(ax, ay)
            people.append({
                "box": [round(v, 1) for v in box[:4]],
                "h": round(box[3] - box[1], 1),
                "depth": None if depth != depth else round(depth, 4),
                "lateral": None if lateral != lateral else round(lateral, 4),
                "lab": band_lab(frame, box),
            })
        per_window[wi].append({
            "t": round(frame_i / fps, 2), "frame": frame_i, "people": people,
        })
        seen += 1
        if seen % 250 == 0:
            print(f"  {seen}/{len(want)} frames "
                  f"{time.perf_counter() - started:.0f}s", flush=True)
    cap.release()

    for window, frames in zip(windows, per_window):
        window["frames"] = frames
    out = {
        "match_dir": match_dir.name,
        "source": {"fps": fps, "width": width, "height": height,
                   "frames": total, "scale_applied": scale},
        "corners": {k: [round(v[0], 1), round(v[1], 1)]
                    for k, v in corners.items()},
        "foreshortening": quad_foreshortening(corners),
        "sample_hz": SAMPLE_HZ,
        "windows": windows,
    }
    out_path.write_text(json.dumps(out))
    print(f"{match_dir.name[:8]} {len(windows)} windows, {seen} frames, "
          f"{time.perf_counter() - started:.0f}s", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--match-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--det-model", default=DET_MODEL_URL)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    run(args.match_dir, args.out, args.det_model, args.limit)


if __name__ == "__main__":
    main()
