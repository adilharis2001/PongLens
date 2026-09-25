"""Detailed analysis and highlights for hand-marked matches.

Spec: docs/superpowers/specs/2026-09-24-ios-hand-cut-design.md, section 5.

A hand cut (matches.cut_source = 'manual', match.json pipeline 'hand-v1')
differs from an automatic match in three ways that matter to placement and
highlights, and every rule here exists because of one of them:

- Nothing tracked the ball when the match was cut, so the ball is tracked
  now, and only inside the marked points (each point's clip window, from
  the pre pad before the mark to the post pad after it, merged where two
  touch). blurball_windowed.py does the tracking so that every detection
  inside a window is the one a full-video run would have produced.
- The marks are playback seconds, not frame counts. An automatic match's
  times come from counting frames, so frame = seconds x frame rate is exact
  for it by construction. A mark is a time the player's video element
  reported, so on a variable-frame-rate video that product drifts away from
  the frame actually shown. FrameClock maps a mark to the frame whose own
  presentation time it is, using the times the decoder read.
- The tracking is saved beside match.json, so the second of the two
  features to run (placement or highlights) reuses the first one's
  tracking instead of running the detector again.

Pure Python on purpose: this module is imported by the worker and by the
placement subprocess, which run under different interpreters.
"""

from __future__ import annotations

import bisect
import gzip
import json
import math
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

HAND_CUT_PIPELINE = "hand-v1"
# process_hand_cut's clip pads. A hand-cut match stores them on
# matches.clip_pads and in match.json options.clip_pads; these are only the
# fallback for a record that somehow lacks both.
HAND_CUT_PRE_S = 1.2
HAND_CUT_POST_S = 1.3
# The adjust_point rule for a tight start (public.adjust_point): the pad a
# tight-start point opens with is least(pre, 0.3).
TIGHT_START_PRE_S = 0.3

TRACKING_NAME = "hand-tracking.jsonl.gz"
TRACKING_VERSION = 1
SERVES_NAME = "serves.json"


# ---------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------
def clip_pads(match: Mapping[str, Any] | None,
              clip_pads_column: Mapping[str, Any] | None = None) -> tuple[float, float]:
    """(pre, post) for a hand-cut match: the column, then match.json, then
    the hand cut's own constants."""
    for source in (clip_pads_column,
                   ((match or {}).get("options") or {}).get("clip_pads")):
        if isinstance(source, Mapping):
            pre, post = source.get("pre"), source.get("post")
            if _finite(pre) and _finite(post):
                return float(pre), float(post)
    return HAND_CUT_PRE_S, HAND_CUT_POST_S


def merge_windows(windows: Iterable[Sequence[float]]) -> list[list[float]]:
    """Sorted [start, end] ranges merged where they touch or overlap."""
    cleaned = sorted((float(a), float(b)) for a, b in windows
                     if _finite(a) and _finite(b) and float(b) > float(a))
    merged: list[list[float]] = []
    for a, b in cleaned:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def clip_windows(points: Iterable[Mapping[str, Any]], duration: float | None,
                 pre: float, post: float) -> list[list[float]]:
    """Each live point's clip window [t0 - pre, t1 + post], clamped to the
    video and merged where windows touch. Deleted points are not tracked."""
    windows = []
    for point in points:
        if point.get("deleted"):
            continue
        t0, t1 = point.get("t0"), point.get("t1")
        if not _finite(t0) or not _finite(t1):
            continue
        start = max(0.0, float(t0) - pre)
        end = float(t1) + post
        if _finite(duration) and float(duration) > 0:
            end = min(float(duration), end)
        windows.append((start, end))
    return merge_windows(windows)


def windows_cover(saved: Iterable[Sequence[float]],
                  needed: Iterable[Sequence[float]], tolerance: float = 0.01) -> bool:
    """True when every needed window lies inside one saved window."""
    saved = merge_windows(saved)
    for a, b in merge_windows(needed):
        if not any(sa - tolerance <= a and b <= sb + tolerance for sa, sb in saved):
            return False
    return True


def point_clip_start(point: Mapping[str, Any], pre: float) -> float:
    """Where a point's clip opens on the source clock, the way adjust_point
    anchors cut_t0: max(0, t0 - pad), with a tight start's shorter pad."""
    pad = min(pre, TIGHT_START_PRE_S) if point.get("tight_start") else pre
    return max(0.0, float(point["t0"]) - pad)


# ---------------------------------------------------------------------------
# Frame clock
# ---------------------------------------------------------------------------
class FrameClock:
    """Frame numbers and seconds for one decode of one video.

    `times[f]` is the presentation time of frame f exactly as the decoder
    that numbered the frames read it. `fps` is the nominal rate the rest of
    the pipeline divides by (ffprobe avg_frame_rate, as points_pipeline
    probes it), so a time computed as frame / fps can be turned back into
    the frame it came from and then into that frame's real time.

    The two lookups reproduce the automatic arithmetic's shape: floor(t x
    fps) is "the last frame at or before t" and ceil(t x fps) is "the first
    frame at or after t", which is what these return on a constant-rate
    video. Beyond either end they extrapolate at the nominal rate, which is
    what the arithmetic does everywhere.
    """

    def __init__(self, times: Sequence[float], fps: float):
        if not times:
            raise ValueError("a frame clock needs at least one frame")
        if not _finite(fps) or float(fps) <= 0:
            raise ValueError("a frame clock needs a positive frame rate")
        self.times = [float(t) for t in times]
        if any(b < a for a, b in zip(self.times, self.times[1:])):
            raise ValueError("frame times must not go backwards")
        self.fps = float(fps)

    def frame_at_or_before(self, seconds: float) -> int:
        index = bisect.bisect_right(self.times, float(seconds) + 1e-9) - 1
        if index < 0:
            return 0
        if index == len(self.times) - 1 and seconds > self.times[-1]:
            extra = math.floor((seconds - self.times[-1]) * self.fps + 1e-9)
            return index + max(0, extra)
        return index

    def frame_at_or_after(self, seconds: float) -> int:
        index = bisect.bisect_left(self.times, float(seconds) - 1e-9)
        if index >= len(self.times):
            extra = math.ceil((seconds - self.times[-1]) * self.fps - 1e-9)
            return len(self.times) - 1 + max(1, extra)
        return index

    def time_of_frame(self, frame: float) -> float:
        """Real time of a (possibly fractional) frame position."""
        last = len(self.times) - 1
        if frame <= 0:
            return self.times[0] + frame / self.fps
        if frame >= last:
            return self.times[last] + (frame - last) / self.fps
        lower = int(math.floor(frame))
        fraction = frame - lower
        if fraction < 1e-6:
            return self.times[lower]
        return self.times[lower] + fraction * (self.times[lower + 1] - self.times[lower])

    def real_from_nominal(self, nominal: float) -> float:
        """A time computed as frame / fps, back on the video's own clock.

        Placement rounds its times to 4 decimals, so a frame's time comes
        back up to 0.003 frames off its integer at 60 fps; a position that
        close to a whole frame IS that frame."""
        position = float(nominal) * self.fps
        nearest = round(position)
        if abs(position - nearest) < 0.01:
            position = float(nearest)
        return self.time_of_frame(position)

    def nominal_from_real(self, seconds: float) -> float:
        """A real time as the frame-counting pipeline would write it."""
        index = bisect.bisect_right(self.times, float(seconds)) - 1
        if index < 0:
            # Before the first frame: extrapolate at the nominal rate.
            return float(seconds) - self.times[0]
        if index >= len(self.times) - 1:
            return (len(self.times) - 1) / self.fps + (float(seconds) - self.times[-1])
        span = self.times[index + 1] - self.times[index]
        fraction = 0.0 if span <= 0 else (float(seconds) - self.times[index]) / span
        return (index + fraction) / self.fps


# Placement payload keys that carry seconds on the frame-counting clock.
# Measured over 300 live ready placements: `t` (candidates and every event
# that copies one) and `contact_t` are the only time-valued keys; audio_t is
# a real time already and the backfill never passes audio anyway.
PLACEMENT_TIME_KEYS = ("t", "contact_t")


def placement_on_real_clock(payload: Any, clock: FrameClock) -> Any:
    """A copy of a placement payload with its times on the video's clock."""
    if isinstance(payload, dict):
        result = {}
        for key, value in payload.items():
            if key in PLACEMENT_TIME_KEYS and _finite(value):
                result[key] = round(clock.real_from_nominal(float(value)), 4)
            else:
                result[key] = placement_on_real_clock(value, clock)
        return result
    if isinstance(payload, list):
        return [placement_on_real_clock(value, clock) for value in payload]
    return payload


# ---------------------------------------------------------------------------
# The saved tracking, beside match.json
# ---------------------------------------------------------------------------
def sibling_key(match_json_key: str, name: str) -> str:
    """The object key of `name` in match.json's own folder."""
    if "/" not in match_json_key:
        raise ValueError("match.json key has no folder")
    return match_json_key.rsplit("/", 1)[0] + "/" + name


def write_tracking_bundle(destination: str | Path, *, detections_path: str | Path,
                          frames: Mapping[str, Any], header: Mapping[str, Any]) -> Path:
    """One gzip file: a header line (identity, windows, frame times), then
    the detection lines exactly as the tracker wrote them."""
    destination = Path(destination)
    record = dict(header)
    record.update({
        "v": TRACKING_VERSION,
        "kind": "hand-cut-tracking",
        "frames": dict(frames),
    })
    with gzip.open(destination, "wt") as out, open(detections_path) as source:
        out.write(json.dumps(record, separators=(",", ":")) + "\n")
        for line in source:
            out.write(line)
    return destination


def read_tracking_bundle(source: str | Path, detections_path: str | Path,
                         frames_path: str | Path) -> dict[str, Any]:
    """Unpack a bundle into the two files the pipeline reads. Returns the
    header; raises ValueError on anything that is not a complete bundle."""
    with gzip.open(source, "rt") as bundle:
        header = json.loads(bundle.readline())
        if (not isinstance(header, dict)
                or header.get("v") != TRACKING_VERSION
                or header.get("kind") != "hand-cut-tracking"
                or not isinstance(header.get("frames"), dict)):
            raise ValueError("not a hand-cut tracking bundle")
        count = 0
        with open(detections_path, "w") as out:
            for line in bundle:
                out.write(line)
                count += 1
    frames = header["frames"]
    if count != frames.get("frame_count") or len(frames.get("frame_times") or ()) != count:
        raise ValueError("tracking bundle is incomplete")
    with open(frames_path, "w") as out:
        json.dump(frames, out, separators=(",", ":"))
    return header


def tracking_usable(header: Mapping[str, Any] | None, *, raw_path: str | None,
                    needed: Sequence[Sequence[float]]) -> bool:
    """A saved tracking is reused only for the same original and only when
    it already covers every window this job needs."""
    if not isinstance(header, Mapping):
        return False
    if raw_path and header.get("raw_path") != raw_path:
        return False
    windows = (header.get("frames") or {}).get("windows") or []
    return windows_cover(windows, needed)


def load_frame_clock(frames: Mapping[str, Any], fps: float) -> FrameClock:
    return FrameClock(frames["frame_times"], fps)


def _finite(value: Any) -> bool:
    """A usable time. Point times read from the database are numeric
    columns, which psycopg2 returns as Decimal, so Decimal counts too."""
    if isinstance(value, bool):
        return False
    if isinstance(value, Decimal):
        return value.is_finite()
    return isinstance(value, (int, float)) and math.isfinite(value)
