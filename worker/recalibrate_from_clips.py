#!/usr/bin/env python3
"""Recover table calibration for matches processed before the keypoint ladder.

Twelve of the corpus's scored matches carry `calibration: {"ok": false}` and
nothing else — they were processed when the only calibrator was the retired
pink-rim one, which refused. Their raw uploads are long gone (swept at 30
days), so the usual retry path, which needs the raw video and its BlurBall
detections, cannot run.

The clips can stand in for the raw. The camera does not move during a match,
so a frame taken from the middle of a rally shows the same table in the same
place as a frame taken from the source — and the keypoint detector only ever
looked at single frames anyway.

Sixteen frames, one from each of sixteen clips spread across the match, are
encoded into a throwaway video and handed to `table_keypoints.py` UNCHANGED.
That matters: sixteen filtered-then-pooled frames is the measured rule (see
CLAUDE.md and docs/research/2026-08-16-table-detection/), and reimplementing
the pooling here to feed it loose frames would be a second, unmeasured copy
of the rule. Spreading the frames over sixteen different rallies is if
anything a better draw than sixteen frames of one continuous video, because
the players and the background clutter move between them.

Research only. Writes the calibration into a LOCAL copy of match.json under
the eval workdir; nothing here touches R2, the matches table, or the product.

  worker/venv/bin/python -m worker.recalibrate_from_clips --match <uuid> ...
  worker/venv/bin/python -m worker.recalibrate_from_clips --all-uncalibrated
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent
DEFAULT_WORKDIR = Path.home() / "ponglens-research-work" / "game-end-eval"
TABLE_KEYPOINT_PY = Path(
    os.environ.get(
        "PONGLENS_TABLE_KEYPOINT_PY",
        "/Users/adil/Library/Caches/PongLens/table-keypoints/venv/bin/python",
    )
)
TABLE_KEYPOINT_SCRIPT = REPO / "table_keypoints.py"
FRAMES = 16


def clip_paths(match_json: Path) -> list[Path]:
    parsed = json.loads(match_json.read_text())
    out = []
    for point in parsed.get("points") or []:
        name = str(point.get("clip") or "").split("/")[-1]
        if not name:
            continue
        local = match_json.parent / name
        if local.exists() and local.stat().st_size > 0:
            out.append(local)
    return out


def pick(items: list[Path], count: int) -> list[Path]:
    """Evenly spread `count` picks over items, repeating if there are few."""
    if not items:
        return []
    if len(items) <= count:
        picks = list(items)
        while len(picks) < count:
            picks.append(items[len(picks) % len(items)])
        return picks[:count]
    step = (len(items) - 1) / (count - 1)
    return [items[int(round(i * step))] for i in range(count)]


def midframe(clip: Path, dest: Path) -> bool:
    duration = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(clip)],
        capture_output=True, text=True,
    ).stdout.strip()
    try:
        seek = max(0.0, float(duration) / 2.0)
    except ValueError:
        seek = 0.5
    done = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{seek:.3f}",
         "-i", str(clip), "-frames:v", "1", "-y", str(dest)],
        capture_output=True,
    )
    return done.returncode == 0 and dest.exists() and dest.stat().st_size > 0


def frame_size(image: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x",
         str(image)],
        capture_output=True, text=True,
    ).stdout.strip()
    width, _, height = out.partition("x")
    return int(width), int(height)


def calibrate(match_json: Path, verbose: bool = True,
              frames: int = FRAMES) -> dict:
    clips = clip_paths(match_json)
    if len(clips) < 4:
        return {"ok": False, "reason": f"only {len(clips)} clips on disk"}
    staging = Path(tempfile.mkdtemp(prefix="recal-"))
    try:
        made = []
        for i, clip in enumerate(pick(clips, frames)):
            png = staging / f"f{i:03d}.png"
            if midframe(clip, png):
                made.append(png)
        if len(made) < frames // 2:
            return {"ok": False,
                    "reason": f"only {len(made)} frames could be read"}
        width, height = frame_size(made[0])
        # Renumber so the concat pattern is contiguous even if a clip failed.
        for i, png in enumerate(made):
            png.rename(staging / f"s{i:03d}.png")
        video = staging / "recal.mp4"
        encode = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-framerate", "1",
             "-i", str(staging / "s%03d.png"), "-c:v", "libx264",
             "-pix_fmt", "yuv420p", "-y", str(video)],
            capture_output=True,
        )
        if encode.returncode != 0:
            return {"ok": False, "reason": "could not encode the frame reel"}
        out = staging / "table_keypoints.json"
        if not TABLE_KEYPOINT_PY.exists():
            return {"ok": False,
                    "reason": f"no keypoint interpreter at {TABLE_KEYPOINT_PY}"}
        run = subprocess.run(
            [str(TABLE_KEYPOINT_PY), str(TABLE_KEYPOINT_SCRIPT),
             "--video", str(video), "--out", str(out),
             "--frames", str(len(made)), "--quiet"],
            capture_output=True, text=True, timeout=20 * 60,
        )
        if not out.exists():
            return {"ok": False,
                    "reason": f"detector failed: {run.stderr.strip()[:200]}"}
        result = json.loads(out.read_text())
        if verbose:
            print(f"    {len(made)} frames -> {result.get('reason') or 'ok'}",
                  flush=True)
        if not result.get("ok"):
            return {"ok": False, "reason": result.get("reason")}
        result["frame_width"], result["frame_height"] = width, height
        result["frames_from_clips"] = len(made)
        return result
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def canonical_calibration(result: dict) -> dict:
    """The quad, canonicalised by the same rule every other source uses."""
    # points_pipeline is written for a flat worker/ sys.path, not for
    # package-relative import; matching that is cheaper than a shim.
    sys.path.insert(0, str(REPO))
    import numpy as np

    from points_pipeline import _canonical_calibration_geometry

    quad = np.asarray(result["quad"], np.float32)
    src, _H, _e, legacy_reordered = _canonical_calibration_geometry(quad)
    names = ["A_near_left", "B_near_right", "C_far_right", "D_far_left"]
    return {
        "ok": True,
        "table_corners_px": {
            name: [round(float(p[0]), 1), round(float(p[1]), 1)]
            for name, p in zip(names, src)
        },
        # Corners were measured on clip frames, so the calibration's own
        # frame of reference IS the clip. Recording it here keeps every
        # consumer's source->clip rescale a no-op instead of a guess.
        "size": [result["frame_width"], result["frame_height"]],
        "orientation": "canonical-v1",
        "legacy_reordered": legacy_reordered,
        "source": "keypoints-from-clips",
        "agreement": {
            "frames_sampled": result.get("frames_sampled"),
            "frames_kept": result.get("frames_kept"),
            "frames_used": result.get("frames_used"),
            "agreement": result.get("agreement"),
            "spread_px": result.get("spread_px"),
        },
        "note": (
            f"keypoint detector re-run over {result.get('frames_from_clips')} "
            f"clip frames, {result.get('frames_used')}/"
            f"{result.get('frames_kept')} agree, spread "
            f"{result.get('spread_px', 0):.1f}px"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--match", nargs="*", default=[])
    parser.add_argument("--all-uncalibrated", action="store_true")
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--frames", type=int, default=FRAMES,
        help=("clips to sample. Sixteen is the measured floor for a "
              "single detection and must not be lowered — one frame is "
              "wrong 13% of the time and sixteen is 0.2%. Raising it is "
              "the honest retry when the pooled vote could not decide, "
              "which on this corpus is a hall with two tables in shot."))
    args = parser.parse_args()

    targets = [args.workdir / m for m in args.match]
    if args.all_uncalibrated:
        for directory in sorted(args.workdir.iterdir()):
            match_json = directory / "match.json"
            if not match_json.is_dir() and match_json.exists():
                parsed = json.loads(match_json.read_text())
                cal = parsed.get("calibration") or {}
                if not cal.get("ok"):
                    targets.append(directory)
    seen, ordered = set(), []
    for target in targets:
        if target.name not in seen:
            seen.add(target.name)
            ordered.append(target)

    recovered = 0
    for directory in ordered:
        match_json = directory / "match.json"
        if not match_json.exists():
            print(f"{directory.name[:8]} no match.json")
            continue
        parsed = json.loads(match_json.read_text())
        cal = parsed.get("calibration") or {}
        if cal.get("ok") and not args.force:
            print(f"{directory.name[:8]} already calibrated "
                  f"({cal.get('source')})")
            continue
        print(f"{directory.name[:8]} recalibrating...", flush=True)
        result = calibrate(match_json, frames=args.frames)
        if not result.get("ok"):
            print(f"{directory.name[:8]} DECLINED: {result.get('reason')}")
            continue
        parsed["calibration"] = canonical_calibration(result)
        backup = directory / "match.original.json"
        if not backup.exists():
            backup.write_text(json.dumps(
                json.loads(match_json.read_text()), indent=1))
        match_json.write_text(json.dumps(parsed))
        recovered += 1
        print(f"{directory.name[:8]} RECOVERED "
              f"{parsed['calibration']['note']}")
    print(f"\nrecovered {recovered} of {len(ordered)}")


if __name__ == "__main__":
    main()
