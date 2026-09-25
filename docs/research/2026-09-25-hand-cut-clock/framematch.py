"""Find where a moment of the original lands in another video, by picture.

Both videos are decoded by ffmpeg to small grayscale frames with their own
presentation timestamps (-copyts, so the numbers are each file's real
clock, the one a browser's currentTime and ffmpeg's -ss both use). A short
run of consecutive ORIGINAL frames is slid along the other video's frames
and scored by the mean absolute difference of normalised frames; the best
alignment gives the other video's timestamp for the original's frame.

A run, not a single frame, because table tennis footage from a tripod has
long near-still stretches where one frame matches its neighbours almost as
well as itself. Every reading carries a confidence: the best cost against
the best cost more than MARGIN_FRAMES away.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass

import numpy as np

W, H = 96, 54
MARGIN_FRAMES = 6
_PTS = re.compile(r"\bn:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:(-?[0-9.]+)")


@dataclass
class Frames:
    pts: np.ndarray        # seconds, the file's own clock
    img: np.ndarray        # (n, H, W) float32, each frame normalised


def decode(src: str, start: float, duration: float, fps: float = 60.0) -> Frames:
    """Frames from `start` on, about `duration` seconds of them (counted in
    frames at `fps`, an upper bound on the rate). The caller filters by pts.

    No -t: with -copyts ffmpeg applies an input -t to the absolute clock
    and returns nothing past the first seconds of the file."""
    start = max(0.0, start)
    count = int(duration * fps) + 2
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "info",
           "-ss", f"{start:.3f}", "-i", src, "-frames:v", str(count),
           # passthrough: never duplicate or drop a frame to fake a
           # constant rate, or frames and timestamps stop pairing up.
           "-copyts", "-fps_mode", "passthrough", "-an", "-sn",
           "-vf", f"scale={W}:{H}:flags=area,format=gray,showinfo",
           "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace")[-600:])
    pts = [float(m.group(2)) for m in _PTS.finditer(proc.stderr.decode(errors="replace"))]
    raw = np.frombuffer(proc.stdout, dtype=np.uint8)
    n = raw.size // (W * H)
    # -frames:v stops the output, but the filter may have logged the frame
    # after the last one written. The output is the first n, in order.
    if len(pts) < n or len(pts) > n + 1:
        raise RuntimeError(f"{n} frames but {len(pts)} timestamps from {src[:80]}")
    pts = pts[:n]
    img = raw[: n * W * H].reshape(n, H, W).astype(np.float32)
    mean = img.mean(axis=(1, 2), keepdims=True)
    std = img.std(axis=(1, 2), keepdims=True) + 1e-3
    return Frames(np.array(pts), (img - mean) / std)


def run_of(frames: Frames, at: float, count: int) -> Frames:
    """`count` consecutive frames starting with the first at or after `at`."""
    i = int(np.searchsorted(frames.pts, at - 1e-6))
    sel = slice(i, i + count)
    if frames.pts[sel].size < count:
        raise RuntimeError(f"only {frames.pts[sel].size} frames after {at:.3f}")
    return Frames(frames.pts[sel], frames.img[sel])


@dataclass
class Match:
    pts: float          # the other video's timestamp of the run's first frame
    cost: float         # mean abs difference of normalised frames (0 = same)
    second: float       # best cost more than MARGIN_FRAMES away
    index: int

    @property
    def confidence(self) -> float:
        """How much better the match is than anything else nearby-but-not-
        adjacent. Above ~1.5 is unambiguous on this footage."""
        return self.second / max(self.cost, 1e-6)


def align(run: Frames, other: Frames) -> Match:
    k = len(run.pts)
    n = len(other.pts) - k + 1
    if n <= 0:
        raise RuntimeError("search window shorter than the run")
    costs = np.empty(n, dtype=np.float64)
    for j in range(n):
        costs[j] = np.abs(other.img[j:j + k] - run.img).mean()
    best = int(costs.argmin())
    far = np.abs(np.arange(n) - best) > MARGIN_FRAMES
    second = float(costs[far].min()) if far.any() else float("inf")
    return Match(float(other.pts[best]), float(costs[best]), second, best)
