"""Fail-closed automatic-highlight qualification and deterministic manifests.

This module contains no database, FFmpeg, or queue code.  The points pipeline
measures evidence; this module decides membership; the worker renders exactly
the returned manifest.  Keeping the rule pure makes it impossible for web and
iOS presentation code to quietly acquire different thresholds.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


RULE = "quality-first-v1"
EVIDENCE_VERSION = 1
MIN_HITS = 5
MIN_CONNECTED_CROSSINGS = 4
MIN_TABLE_BOUNCES = 2
AUTO_MAX_S = 150.0
END_TAIL_S = 0.75
XFADE_S = 0.3
MIN_SEGMENT_S = 0.5


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _integer(value: Any) -> int | None:
    number = _number(value)
    if number is None or not number.is_integer():
        return None
    return int(number)


def _segment_bounds(point: dict) -> tuple[float, float] | None:
    start = _number(point.get("cut_t0"))
    observed_end = _number(point.get("rally_end_cut_s"))
    if start is None or observed_end is None:
        return None
    end = observed_end + END_TAIL_S
    if end - start < MIN_SEGMENT_S:
        return None
    return start, end


def qualifies(point: dict) -> bool:
    """Return true only when every v1 rally receipt is present and strong."""
    if not isinstance(point, dict):
        return False
    if point.get("deleted") or point.get("edited") or point.get("is_let"):
        return False
    if not point.get("clip_path") or _segment_bounds(point) is None:
        return False

    t0 = _number(point.get("t0"))
    t1 = _number(point.get("t1"))
    evidence = point.get("highlight_evidence")
    if t0 is None or t1 is None or t1 <= t0 or not isinstance(evidence, dict):
        return False
    if evidence.get("v") != EVIDENCE_VERSION or evidence.get("status") != "ready":
        return False

    hits = _integer(evidence.get("n_hits"))
    crossings = _integer(evidence.get("connected_crossings"))
    bounces = _integer(evidence.get("table_bounces"))
    observed_end = _number(evidence.get("observed_end_s"))
    if hits is None or crossings is None or bounces is None or observed_end is None:
        return False
    if hits < MIN_HITS or crossings < MIN_CONNECTED_CROSSINGS:
        return False
    if bounces < MIN_TABLE_BOUNCES:
        return False
    return t0 <= observed_end <= t1


def _duration(point: dict) -> float:
    start, end = _segment_bounds(point) or (0.0, 0.0)
    return end - start


def _rank(point: dict) -> tuple[float, float, float, float]:
    evidence = point["highlight_evidence"]
    hits = int(evidence["n_hits"])
    crossings = int(evidence["connected_crossings"])
    observed_duration = float(evidence["observed_end_s"]) - float(point["t0"])
    return (
        float(min(hits, crossings + 1)),
        float(crossings),
        observed_duration,
        -float(point["idx"]),
    )


def select_highlights(points: list[dict], max_seconds: float) -> list[dict]:
    """Choose the best qualified rallies under a ceiling, then restore order."""
    budget = _number(max_seconds)
    if budget is None or budget <= 0:
        return []
    ranked = sorted((p for p in points if qualifies(p)), key=_rank, reverse=True)
    selected: list[dict] = []
    duration = 0.0
    for point in ranked:
        cost = _duration(point) - (XFADE_S if selected else 0.0)
        if duration + cost <= budget + 1e-9:
            selected.append(point)
            duration += cost
    return sorted(selected, key=lambda p: (int(p["idx"]), str(p["id"])))


def points_revision(points: list[dict]) -> str:
    """Hash only fields that can change the rendered automatic artifact."""
    rows = []
    for point in sorted(points, key=lambda p: (int(p["idx"]), str(p["id"]))):
        evidence = point.get("highlight_evidence") or {}
        rows.append({
            "point_id": str(point["id"]),
            "idx": int(point["idx"]),
            "t0": _number(point.get("t0")),
            "t1": _number(point.get("t1")),
            "cut_t0": _number(point.get("cut_t0")),
            "rally_end_cut_s": _number(point.get("rally_end_cut_s")),
            "clip_path": point.get("clip_path"),
            "deleted": bool(point.get("deleted")),
            "edited": bool(point.get("edited")),
            "is_let": bool(point.get("is_let")),
            "evidence": {
                "v": evidence.get("v"),
                "status": evidence.get("status"),
                "n_hits": evidence.get("n_hits"),
                "connected_crossings": evidence.get("connected_crossings"),
                "table_bounces": evidence.get("table_bounces"),
                "observed_end_s": evidence.get("observed_end_s"),
            },
        })
    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":"),
                           allow_nan=False).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def build_manifest(points: list[dict], max_seconds: float = AUTO_MAX_S) -> dict:
    """Build the canonical cut-clock and output-clock render manifest."""
    selected = select_highlights(points, max_seconds)
    output_cursor = 0.0
    manifest_points = []
    for index, point in enumerate(selected):
        cut_start, cut_end = _segment_bounds(point)  # qualifies() proved it
        if index:
            output_cursor -= XFADE_S
        output_start = output_cursor
        output_end = output_start + (cut_end - cut_start)
        evidence = point["highlight_evidence"]
        manifest_points.append({
            "point_id": str(point["id"]),
            "cut_start_s": round(cut_start, 3),
            "cut_end_s": round(cut_end, 3),
            "output_start_s": round(output_start, 3),
            "output_end_s": round(output_end, 3),
            "n_hits": int(evidence["n_hits"]),
            "connected_crossings": int(evidence["connected_crossings"]),
            "table_bounces": int(evidence["table_bounces"]),
        })
        output_cursor = output_end
    return {
        "v": 1,
        "rule": RULE,
        "max_seconds": float(max_seconds),
        "points_revision": points_revision(selected),
        "duration_s": round(output_cursor, 3),
        "points": manifest_points,
    }
