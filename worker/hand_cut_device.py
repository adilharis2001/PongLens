"""Hand cuts: the plan, and the Mac's check of a cut made on the iPhone.

Spec: docs/superpowers/specs/2026-09-24-ios-hand-cut-design.md, section 7.
Contract: docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md.

`plan_hand_cut` is the one statement of which source seconds a hand cut
keeps and where every point lands in the cut. The Mac's own hand cut
(worker.process_hand_cut), the check of a phone's cut (check_manifest) and
the parity fixture the iPhone's planner is tested against
(ios/Tests/fixtures/cut-plan-parity.json) all call it, so the three cannot
drift apart. Its arithmetic is points_pipeline's own: play_cut_segments,
segment_cut_offsets and cut_position with SEGMENT_PADS and SEGMENT_MERGE_S,
exactly as the automatic cut uses them.

Everything below `plan_hand_cut` is pure: it reads a manifest and numbers
the worker measured, and either returns what to publish or raises
DeviceCutMismatch naming the first thing that disagreed. The worker does
the reading (R2, ffprobe) and the publishing.

    python -B worker/hand_cut_device.py --write-fixture \
        ios/Tests/fixtures/cut-plan-parity.json \
        --live worker/tests/fixtures/hand_cut_live_marks.json
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from points_pipeline import (  # noqa: E402
    SEGMENT_MERGE_S,
    SEGMENT_PADS,
    cut_position,
    hand_cut_length_tolerance,
    play_cut_segments,
    segment_cut_offsets,
)

PIPELINE = "hand-v1"
MANIFEST_SCHEMA = 1
# The clip pads claim_hand_cut stamps on matches.clip_pads.
CLIP_PRE_S = 1.2
CLIP_POST_S = 1.3
MANIFEST_MAX_BYTES = 2 * 1024 * 1024

# Contract section 7. Each number says what it is compared against.
PLAN_TOLERANCE_S = 0.011        # two-decimal values, one hundredth of slack
PUBLISH_TOLERANCE_S = 0.06      # normalize_manual_cut_observations
POSITION_TOLERANCE_S = 0.05     # process_hand_cut's own cut_t0 tripwire
OFFSET_TOLERANCE_S = 0.05
FIRST_OFFSET_MAX_S = 0.1
FIRST_FRAME_TOLERANCE_S = 0.1
DURATION_PROBE_TOLERANCE_S = 0.5
DURATION_ROW_TOLERANCE_S = 1.5
FPS_TOLERANCE = 0.005           # relative


class DeviceCutMismatch(Exception):
    """The phone's cut disagrees with the marks or with itself.

    Never a failure the player sees: the worker notes it and cuts the same
    marks on the Mac."""


def r2(value: float) -> float:
    """Python's round(x, 2): the binary value rounded half to even. The
    iPhone must reproduce it exactly (the fixture carries the edge cases)."""
    return round(float(value), 2)


def clip_name(idx: int) -> str:
    """The Mac's clip file name: 01.mp4 ... 99.mp4, 100.mp4."""
    return f"{int(idx):02d}.mp4"


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class HandCutPlan:
    duration: float
    # The marks that became points: sorted, t1 clamped to the duration,
    # copies of the frozen draft's entries (winner, let and star intact).
    marks: list[dict]
    # Marks dropped because they start at or after the end of the video.
    dropped: int
    # Each kept mark's (t0, t1) as the player marked it, before the clamp.
    marked: list[tuple[float, float]]
    # play_cut_segments' own floats, and the two-decimal form the video is
    # cut from and match.json keeps.
    segments_exact: list[tuple[float, float]]
    cut_segments: list[list[float]]
    # segment_cut_offsets over cut_segments: where each segment starts on
    # the cut's clock if the encoder lays them end to end.
    offsets: list[float]
    # idx, t0, t1, clip_t0, clip_t1, cut_t0, clip ("01.mp4")
    points: list[dict]

    @property
    def kept_exact(self) -> float:
        return sum(b - a for a, b in self.segments_exact)

    @property
    def kept(self) -> float:
        return sum(b - a for a, b in self.cut_segments)


def mark_pairs(raw: Any) -> list[dict]:
    """Closed marks from a stored draft, in either stored form, sorted by
    start. The short form claim_hand_cut is sent ({t0, t1, w, let, star})
    and the long form a draft is saved in ({t0, t1, winner, isLet, ...})
    both carry t0 and t1; nothing else matters to the plan."""
    out = []
    for entry in raw or []:
        if not isinstance(entry, Mapping):
            continue
        if entry.get("t0") is None or entry.get("t1") is None:
            continue
        out.append(dict(entry))
    out.sort(key=lambda m: float(m["t0"]))
    return out


def plan_hand_cut(marks: Iterable[Mapping[str, Any]], duration: float,
                  pre: float = CLIP_PRE_S, post: float = CLIP_POST_S
                  ) -> HandCutPlan:
    """Which seconds to keep and where every point lands, from the marks.

    1. Drop marks starting at or after the end; clamp every end to it.
    2. Each point's clip window is [t0 - pre, t1 + post], clamped to the
       video. The windows, padded by SEGMENT_PADS and merged across gaps
       under SEGMENT_MERGE_S, are the cut segments (play_cut_segments).
    3. The video is cut from the segments rounded to two decimals, so the
       offsets and positions are taken over those.
    """
    dur = float(duration)
    kept = []
    marked = []
    dropped = 0
    for m in mark_pairs(marks):
        if float(m["t0"]) >= dur:
            dropped += 1
            continue
        marked.append((float(m["t0"]), float(m["t1"])))
        m["t1"] = min(float(m["t1"]), dur)
        kept.append(m)
    seg_head, seg_tail = SEGMENT_PADS["normal"]
    windows = [
        (max(0.0, float(m["t0"]) - pre), min(dur, float(m["t1"]) + post))
        for m in kept
    ]
    exact = play_cut_segments(windows, dur, seg_head, seg_tail,
                              SEGMENT_MERGE_S)
    cut_segments = [[r2(a), r2(b)] for a, b in exact]
    offsets = segment_cut_offsets(cut_segments)
    points = []
    for i, m in enumerate(kept, start=1):
        t0, t1 = float(m["t0"]), float(m["t1"])
        clip_t0 = r2(max(0.0, t0 - pre))
        points.append({
            "idx": i,
            "t0": r2(t0),
            "t1": r2(t1),
            "clip_t0": clip_t0,
            "clip_t1": r2(min(dur, t1 + post)),
            "cut_t0": r2(cut_position(cut_segments, offsets, clip_t0)),
            "clip": clip_name(i),
        })
    return HandCutPlan(duration=dur, marks=kept, dropped=dropped,
                       marked=marked, segments_exact=[(a, b) for a, b in exact],
                       cut_segments=cut_segments, offsets=offsets,
                       points=points)


# ---------------------------------------------------------------------------
# Checking a phone's cut
# ---------------------------------------------------------------------------
def device_keys(user_id: str, job_id: str, match_id: str) -> dict:
    """The object keys claim_device_hand_cut hands the phone (media bucket)."""
    return {
        "cut": f"results/{user_id}/{job_id}.mp4",
        "manifest": f"results/{user_id}/{job_id}.manifest.json",
        "clip_prefix": f"points/{user_id}/{match_id}",
    }


@dataclass
class VerifiedDeviceCut:
    plan: HandCutPlan
    duration: float
    cut_segments: list[list[float]]
    offsets: list[float]
    # idx, t0, t1, clip_t0, clip_t1, cut_t0 (the Mac's own reading), clip
    points: list[dict]
    source: dict
    max_position_error_s: float
    notes: list[str] = field(default_factory=list)
    encoder: dict | None = None


def _mismatch(reason: str) -> DeviceCutMismatch:
    return DeviceCutMismatch(reason)


def _number(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _mismatch(f"{what} is not a number")
    number = float(value)
    if not math.isfinite(number):
        raise _mismatch(f"{what} is not finite")
    return number


def parse_manifest(body: bytes | str) -> dict:
    if isinstance(body, str):
        body = body.encode()
    if len(body) > MANIFEST_MAX_BYTES:
        raise _mismatch(f"manifest is {len(body)} bytes, over the limit")
    try:
        manifest = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise _mismatch(f"manifest is not JSON ({error})") from error
    if not isinstance(manifest, dict):
        raise _mismatch("manifest is not an object")
    return manifest


def check_duration(phone: float, *, probe: float | None,
                   row: float | None) -> str:
    """The phone's reading of the source duration against the Mac's own
    probe of the original (a header read), or the match row's figure when
    that probe failed. Returns a note."""
    if probe is not None and probe > 0:
        if abs(phone - probe) > DURATION_PROBE_TOLERANCE_S:
            raise _mismatch(
                f"the iPhone read the video as {phone:.3f}s, the Mac as "
                f"{probe:.3f}s")
        return f"duration {phone:.3f}s (Mac {probe:.3f}s)"
    if row is not None and row > 0:
        if abs(phone - row) > DURATION_ROW_TOLERANCE_S:
            raise _mismatch(
                f"the iPhone read the video as {phone:.3f}s, the match row "
                f"says {row:.3f}s")
        return f"duration {phone:.3f}s (match row {row:.3f}s)"
    raise _mismatch("no duration to check the iPhone's reading against")


def reconcile_source(manifest_source: Mapping[str, Any],
                     mac_geometry: Mapping[str, Any] | None,
                     duration: float) -> tuple[dict, str | None]:
    """match.json's source block: the phone's frame rate and frame size,
    unless the Mac's own probe of the original disagrees, in which case
    the Mac's reading wins (every other hand cut records the Mac's)."""
    fps = _number(manifest_source.get("fps"), "source.fps")
    width = manifest_source.get("width")
    height = manifest_source.get("height")
    if not (isinstance(width, int) and isinstance(height, int)
            and width > 0 and height > 0 and fps > 0):
        raise _mismatch("source frame rate or size is missing")
    source = {"duration": round(duration, 2), "fps": round(fps, 3),
              "width": width, "height": height}
    if not mac_geometry:
        return source, None
    mac = {"fps": round(float(mac_geometry["fps"]), 3),
           "width": int(mac_geometry["width"]),
           "height": int(mac_geometry["height"])}
    same = (mac["width"] == width and mac["height"] == height
            and abs(mac["fps"] - source["fps"])
            <= FPS_TOLERANCE * max(mac["fps"], 1.0))
    if same:
        return source, None
    note = (f"source from the Mac's probe ({mac['width']}x{mac['height']} "
            f"at {mac['fps']}), the iPhone said {width}x{height} at "
            f"{source['fps']}")
    source.update(mac)
    return source, note


def check_manifest(manifest: Mapping[str, Any], *, job_id: str,
                   match_id: str, marks: Iterable[Mapping[str, Any]],
                   duration_probe: float | None,
                   duration_row: float | None,
                   cut_map: Callable[[dict], Any],
                   mac_geometry: Mapping[str, Any] | None = None,
                   pre: float = CLIP_PRE_S, post: float = CLIP_POST_S
                   ) -> VerifiedDeviceCut:
    """Checks 1 to 6 of the contract: the manifest against the frozen
    marks, and every position against the re-cut lookup.

    `cut_map` builds worker._CutMap from a match.json-shaped dict, so the
    positions are read by the exact code every later re-cut uses."""
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise _mismatch(f"manifest schema {manifest.get('schema')!r}")
    if manifest.get("pipeline") != PIPELINE:
        raise _mismatch(f"manifest pipeline {manifest.get('pipeline')!r}")
    if manifest.get("cutter") != "device":
        raise _mismatch(f"manifest cutter {manifest.get('cutter')!r}")
    if str(manifest.get("job_id", "")).lower() != str(job_id).lower():
        raise _mismatch("manifest belongs to another job")
    if str(manifest.get("match_id", "")).lower() != str(match_id).lower():
        raise _mismatch("manifest belongs to another match")
    source = manifest.get("source")
    if not isinstance(source, Mapping):
        raise _mismatch("manifest has no source")
    duration = _number(source.get("duration"), "source.duration")
    if duration <= 0:
        raise _mismatch("source.duration is not positive")
    pads = manifest.get("clip_pads") or {}
    if (abs(_number(pads.get("pre"), "clip_pads.pre") - pre) > 1e-9
            or abs(_number(pads.get("post"), "clip_pads.post") - post) > 1e-9):
        raise _mismatch("clip pads differ from the hand cut's")

    notes = [check_duration(duration, probe=duration_probe, row=duration_row)]

    frozen = mark_pairs(marks)
    plan = plan_hand_cut(frozen, duration, pre, post)
    if plan.dropped:
        raise _mismatch(
            f"{plan.dropped} mark(s) start after the end of the iPhone's "
            "reading of the video")

    raw_segments = manifest.get("cut_segments")
    if not isinstance(raw_segments, list):
        raise _mismatch("cut_segments missing")
    segments = []
    for i, pair in enumerate(raw_segments):
        if not isinstance(pair, list) or len(pair) != 2:
            raise _mismatch(f"cut_segments[{i}] is not a pair")
        segments.append([_number(pair[0], f"cut_segments[{i}][0]"),
                         _number(pair[1], f"cut_segments[{i}][1]")])
    if len(segments) != len(plan.cut_segments):
        raise _mismatch(
            f"{len(segments)} segments, the marks make "
            f"{len(plan.cut_segments)}")
    for i, (got, want) in enumerate(zip(segments, plan.cut_segments)):
        if (abs(got[0] - want[0]) > PLAN_TOLERANCE_S
                or abs(got[1] - want[1]) > PLAN_TOLERANCE_S):
            raise _mismatch(f"segment {i + 1} is {got}, the marks make {want}")

    raw_points = manifest.get("points")
    if not isinstance(raw_points, list):
        raise _mismatch("points missing")
    if len(raw_points) != len(plan.points):
        raise _mismatch(
            f"{len(raw_points)} points, the marks make {len(plan.points)}")
    for p, want, (marked_t0, marked_t1) in zip(raw_points, plan.points,
                                                plan.marked):
        if not isinstance(p, Mapping):
            raise _mismatch("a point is not an object")
        if p.get("idx") != want["idx"]:
            raise _mismatch(f"point {want['idx']} has idx {p.get('idx')!r}")
        for key in ("t0", "t1", "clip_t0", "clip_t1"):
            got = _number(p.get(key), f"point {want['idx']} {key}")
            if abs(got - want[key]) > PLAN_TOLERANCE_S:
                raise _mismatch(
                    f"point {want['idx']} {key} is {got}, the marks make "
                    f"{want[key]}")
        clip = p.get("clip")
        if clip is not None and clip != want["clip"]:
            raise _mismatch(f"point {want['idx']} clip is {clip!r}")
        # The publish rule, checked here so a disagreement becomes a Mac
        # cut instead of a failed publication.
        for key, marked in (("t0", marked_t0), ("t1", marked_t1)):
            if abs(want[key] - marked) > PUBLISH_TOLERANCE_S:
                raise _mismatch(
                    f"point {want['idx']} {key} is {want[key]}, more than "
                    f"{PUBLISH_TOLERANCE_S}s from its mark {marked}")

    raw_offsets = manifest.get("cut_segment_offsets")
    if not isinstance(raw_offsets, list) or len(raw_offsets) != len(segments):
        raise _mismatch("cut_segment_offsets missing or the wrong length")
    offsets = [_number(v, f"cut_segment_offsets[{i}]")
               for i, v in enumerate(raw_offsets)]
    if offsets and (offsets[0] < 0 or offsets[0] > FIRST_OFFSET_MAX_S):
        raise _mismatch(f"the first segment starts at {offsets[0]}s")
    if any(b <= a for a, b in zip(offsets, offsets[1:])):
        raise _mismatch("cut_segment_offsets are not increasing")
    planned = segment_cut_offsets(segments)
    for i, (got, want) in enumerate(zip(offsets, planned)):
        if abs(got - want) > OFFSET_TOLERANCE_S:
            raise _mismatch(
                f"segment {i + 1} starts at {got:.3f}s in the cut, the "
                f"plan says {want:.3f}s")
    first_frames = manifest.get("cut_first_frame_s")
    if first_frames is not None:
        if not isinstance(first_frames, list) or len(first_frames) != len(offsets):
            raise _mismatch("cut_first_frame_s has the wrong length")
        for i, (frame, offset) in enumerate(zip(first_frames, offsets)):
            got = _number(frame, f"cut_first_frame_s[{i}]")
            if abs(got - offset) > FIRST_FRAME_TOLERANCE_S:
                raise _mismatch(
                    f"segment {i + 1}'s first frame is at {got:.3f}s, its "
                    f"offset {offset:.3f}s")

    lookup = cut_map({"cut_segments": segments,
                      "cut_segment_offsets": offsets, "points": []})
    if not getattr(lookup, "offsets", None) and segments:
        raise _mismatch("the re-cut lookup refused the measured offsets")
    published = []
    worst = 0.0
    for p, want in zip(raw_points, plan.points):
        claimed = _number(p.get("cut_t0"), f"point {want['idx']} cut_t0")
        located = lookup.locate(want["idx"], want["clip_t0"], want["clip_t1"])
        if located is None:
            raise _mismatch(f"point {want['idx']} is not inside the cut")
        error = abs(located - claimed)
        worst = max(worst, error)
        if error > POSITION_TOLERANCE_S:
            raise _mismatch(
                f"point {want['idx']} is at {located:.3f}s in the cut, the "
                f"iPhone said {claimed:.3f}s")
        published.append({
            "idx": want["idx"], "t0": want["t0"], "t1": want["t1"],
            "clip_t0": want["clip_t0"], "clip_t1": want["clip_t1"],
            "cut_t0": r2(located), "clip": p.get("clip"),
        })

    source_block, source_note = reconcile_source(source, mac_geometry,
                                                 duration)
    if source_note:
        notes.append(source_note)
    encoder = manifest.get("encoder")
    return VerifiedDeviceCut(
        plan=plan, duration=duration,
        cut_segments=[[r2(a), r2(b)] for a, b in segments],
        offsets=offsets, points=published, source=source_block,
        max_position_error_s=worst, notes=notes,
        encoder=encoder if isinstance(encoder, dict) else None)


def check_cut_probe(probe: Mapping[str, Any], cut_segments: Sequence[Sequence[float]]
                    ) -> tuple[float, str]:
    """Check 7: ffprobe's reading of the uploaded cut. Returns its duration
    and a note."""
    streams = probe.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise _mismatch("the cut has no video stream")
    if video.get("codec_name") != "h264":
        raise _mismatch(f"the cut is {video.get('codec_name')!r}, not h264")
    try:
        duration = float((probe.get("format") or {}).get("duration"))
    except (TypeError, ValueError) as error:
        raise _mismatch("the cut has no readable duration") from error
    kept = sum(float(b) - float(a) for a, b in cut_segments)
    tolerance = hand_cut_length_tolerance(len(cut_segments))
    if not math.isfinite(duration) or abs(duration - kept) > tolerance:
        raise _mismatch(
            f"the cut is {duration:.2f}s long, the segments {kept:.2f}s")
    return duration, (f"cut {duration:.2f}s for {kept:.2f}s of segments, "
                      f"{video.get('width')}x{video.get('height')} h264")


def device_match_json(verified: VerifiedDeviceCut, *, cut_duration: float,
                      pre: float = CLIP_PRE_S, post: float = CLIP_POST_S
                      ) -> dict:
    """match.json for a phone cut: the Mac hand cut's own shape, with the
    phone's measured clock (cut_segment_offsets), which every consumer of
    a newly exported match reads (cut_timeline.segment_offsets)."""
    points = []
    for p in verified.points:
        points.append({
            "idx": p["idx"], "t0": p["t0"], "t1": p["t1"],
            "clip_t0": p["clip_t0"], "clip_t1": p["clip_t1"],
            "cut_t0": p["cut_t0"],
            "clip": p["clip"],
            "server": None, "placement": None, "suggestion": None,
        })
    kept = sum(b - a for a, b in verified.cut_segments)
    notes = [
        f"hand cut v1: {len(points)} points marked by the owner, keeping "
        f"{kept:.1f}s of {verified.duration:.1f}s",
        "detections: none (marked by hand)",
        "cut on the owner's iPhone, checked by the Mac: positions within "
        f"{verified.max_position_error_s:.3f}s; "
        + "; ".join(verified.notes),
    ]
    return {
        "version": 3,
        "pipeline": PIPELINE,
        "source": verified.source,
        "options": {"clip_pads": {"pre": pre, "post": post}},
        "cut_mode": "plays",
        "cut_segments": verified.cut_segments,
        "cut_segment_offsets": [round(v, 6) for v in verified.offsets],
        "cut_timing": {"method": "device-avassetwriter-v1",
                       "duration_s": round(cut_duration, 6)},
        "notes": notes,
        "points": points,
    }


# ---------------------------------------------------------------------------
# The parity fixture for the iPhone's planner
# ---------------------------------------------------------------------------
ROUNDING_CASES = [
    2.675, 1.005, 0.125, 0.375, 1.115, 4.35, 0.285, 10.005, 1234.565,
    8.345, 0.015, 2.5, 1039.465, 1045.465, 13.629999999999999,
    21.950000000000003, 7.0049999, 0.0, 99.995, 1e-9,
]


def _synthetic_cases() -> list[dict]:
    many = [[10.0 + 8.0 * k, 14.0 + 8.0 * k] for k in range(105)]
    return [
        {"name": "single point", "duration": 60.0,
         "marks": [[5.0, 12.0]]},
        {"name": "gap under 0.5 s merges", "duration": 600.0,
         "marks": [[10.0, 20.0], [23.1, 30.0]]},
        {"name": "gap of 0.49 s merges", "duration": 600.0,
         "marks": [[10.0, 20.0], [23.29, 30.0]]},
        {"name": "gap of 0.5 s stays apart (float edge)", "duration": 600.0,
         "marks": [[10.0, 20.0], [23.3, 30.0]]},
        {"name": "overlapping windows merge", "duration": 600.0,
         "marks": [[10.0, 20.0], [21.0, 30.0]]},
        {"name": "abutting points", "duration": 600.0,
         "marks": [[10.0, 20.0], [20.0, 30.0], [30.0, 31.5]]},
        {"name": "clamp at zero", "duration": 600.0,
         "marks": [[0.4, 9.0], [0.0 + 30.0, 36.0]]},
        {"name": "clamp at the duration", "duration": 100.0,
         "marks": [[90.0, 99.8]]},
        {"name": "ends in the final second", "duration": 120.4,
         "marks": [[40.0, 52.5], [110.0, 120.1]]},
        {"name": "end past the video is clamped", "duration": 120.4,
         "marks": [[110.0, 121.0]]},
        {"name": "start after the end is dropped", "duration": 50.0,
         "marks": [[10.0, 20.0], [50.2, 51.0]]},
        {"name": "more than two decimals", "duration": 300.0,
         "marks": [[12.3456, 20.9871], [33.3335, 40.0049],
                   [101.115, 110.005]]},
        {"name": "three-digit clip names", "duration": 900.0,
         "marks": many},
    ]


def _expected(case: Mapping[str, Any]) -> dict:
    marks = [{"t0": a, "t1": b} for a, b in case["marks"]]
    plan = plan_hand_cut(marks, case["duration"])
    return {
        "dropped": plan.dropped,
        "segments_exact": [[a, b] for a, b in plan.segments_exact],
        "cut_segments": plan.cut_segments,
        "offsets": plan.offsets,
        "kept_s": plan.kept,
        "points": plan.points,
    }


def build_fixture(live: Mapping[str, Any] | None) -> dict:
    cases = []
    for row in (live or {}).get("matches", []):
        case = {"name": f"live {row['match']}",
                "duration": float(row["duration_s"]),
                "marks": [[float(a), float(b)] for a, b in row["marks"]]}
        case["expected"] = _expected(case)
        # What the Mac published for these marks, for reference only: it
        # used ffprobe's duration, not duration_s, and it is not a target.
        case["published_cut_t0"] = [float(p[3]) for p in row["published"]]
        cases.append(case)
    for case in _synthetic_cases():
        case = dict(case)
        case["expected"] = _expected(case)
        cases.append(case)
    return {
        "about": (
            "The iPhone's hand-cut planner must reproduce every expected "
            "value. Generated from the real Python rules; do not edit. "
            "Contract: docs/superpowers/specs/"
            "2026-09-25-device-hand-cut-contract.md section 5."),
        "generated_by": ("worker/hand_cut_device.py --write-fixture "
                         "ios/Tests/fixtures/cut-plan-parity.json --live "
                         "worker/tests/fixtures/hand_cut_live_marks.json"),
        "rules": {"clip_pre": CLIP_PRE_S, "clip_post": CLIP_POST_S,
                  "segment_head": SEGMENT_PADS["normal"][0],
                  "segment_tail": SEGMENT_PADS["normal"][1],
                  "merge_gap": SEGMENT_MERGE_S, "decimals": 2},
        "rounding": [{"x": x, "r2": r2(x)} for x in ROUNDING_CASES],
        "cases": cases,
    }


def render_fixture(fixture: Mapping[str, Any]) -> str:
    return json.dumps(fixture, indent=1, sort_keys=False) + "\n"


def _main(argv: Sequence[str]) -> int:
    if "--write-fixture" not in argv:
        print(__doc__)
        return 2
    out = argv[argv.index("--write-fixture") + 1]
    live = None
    if "--live" in argv:
        with open(argv[argv.index("--live") + 1]) as handle:
            live = json.load(handle)
    text = render_fixture(build_fixture(live))
    with open(out, "w") as handle:
        handle.write(text)
    fixture = json.loads(text)
    print(f"wrote {out}: {len(fixture['cases'])} cases, "
          f"{sum(len(c['expected']['points']) for c in fixture['cases'])} "
          "points")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
