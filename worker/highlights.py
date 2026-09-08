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
from decimal import Decimal
from typing import Any


RULE = "quality-first-v2"
EVIDENCE_VERSION = 2
MIN_EXCHANGES = 5
MIN_HIT_SUPPORT_CROSSINGS = 2
MIN_HIT_SUPPORT_LANDINGS = 3
MIN_TABLE_BOUNCES = 2
AUTO_MAX_S = 150.0
TAP_END_TAIL_S = 0.2
DETECTOR_END_TAIL_S = 0.25
XFADE_S = 0.3
MIN_SEGMENT_S = 0.5


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
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
    if start is None:
        return None

    scored_end = point.get("scored_at_cut_s")
    if scored_end is not None:
        observed_end = _number(scored_end)
        if observed_end is None or observed_end < start:
            return None
        tail = TAP_END_TAIL_S
    else:
        observed_end = _number(point.get("rally_end_cut_s"))
        tail = DETECTOR_END_TAIL_S
    if observed_end is None:
        source_start = _number(point.get("t0"))
        evidence = point.get("highlight_evidence")
        source_end = (
            _number(evidence.get("observed_end_s"))
            if isinstance(evidence, dict) else None
        )
        if source_start is not None and source_end is not None:
            # No dead-space cut occurs inside a point card, so an evidence
            # end maps to the cut clock by the card's stored offset. This is
            # what lets end-on legacy cards recover without rewriting their
            # manually reviewed point bounds.
            observed_end = start + source_end - source_start
    if observed_end is None:
        return None
    end = observed_end + tail
    if end - start < MIN_SEGMENT_S:
        return None
    return start, end


def qualifies(point: dict) -> bool:
    """Return true when a v2 receipt proves sustained back-and-forth play."""
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
    alternating = _integer(evidence.get("alternating_table_landings"))
    bounces = _integer(evidence.get("table_bounces"))
    observed_end = _number(evidence.get("observed_end_s"))
    if bounces is None or observed_end is None:
        return False
    if bounces < MIN_TABLE_BOUNCES:
        return False
    if not t0 <= observed_end <= t1:
        return False

    crossing_path = crossings is not None and crossings >= MIN_EXCHANGES
    landing_path = alternating is not None and alternating >= MIN_EXCHANGES
    hit_support = (
        (crossings is not None and crossings >= MIN_HIT_SUPPORT_CROSSINGS)
        or (alternating is not None
            and alternating >= MIN_HIT_SUPPORT_LANDINGS)
    )
    hit_path = hits is not None and hits >= MIN_EXCHANGES and hit_support
    return crossing_path or landing_path or hit_path


def _duration(point: dict) -> float:
    start, end = _segment_bounds(point) or (0.0, 0.0)
    return end - start


def _rank(point: dict) -> tuple[float, float, float, float]:
    evidence = point["highlight_evidence"]
    hits = _integer(evidence.get("n_hits")) or 0
    crossings = _integer(evidence.get("connected_crossings")) or 0
    alternating = _integer(evidence.get("alternating_table_landings")) or 0
    supported_hits = hits if (
        crossings >= MIN_HIT_SUPPORT_CROSSINGS
        or alternating >= MIN_HIT_SUPPORT_LANDINGS
    ) else 0
    exchanges = max(crossings, alternating, supported_hits)
    observed_duration = float(evidence["observed_end_s"]) - float(point["t0"])
    return (
        float(exchanges),
        observed_duration,
        float(max(crossings, alternating)),
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
    return sorted(
        selected,
        key=lambda p: (float(p["t0"]), int(p["idx"]), str(p["id"])),
    )


def points_revision(points: list[dict]) -> str:
    """Hash only fields that can change the rendered automatic artifact."""
    def canonical_number(value: Any) -> str | None:
        number = _number(value)
        if number is None:
            return None
        text = f"{number:.6f}".rstrip("0").rstrip(".")
        return "0" if text == "-0" else text

    rows = []
    for point in sorted(
        points,
        key=lambda p: (float(p["t0"]), int(p["idx"]), str(p["id"])),
    ):
        evidence = point.get("highlight_evidence") or {}
        # Arrays plus decimal strings are deliberate: JSON object key order and
        # float formatting differ between Python and JavaScript. The API must
        # reproduce this hash to reject a stale stored reel.
        rows.append([
            str(point["id"]),
            canonical_number(point.get("idx")),
            canonical_number(point.get("t0")),
            canonical_number(point.get("t1")),
            canonical_number(point.get("cut_t0")),
            canonical_number(point.get("scored_at_cut_s")),
            canonical_number(point.get("rally_end_cut_s")),
            point.get("clip_path"),
            bool(point.get("deleted")),
            bool(point.get("edited")),
            bool(point.get("is_let")),
            canonical_number(evidence.get("v")),
            evidence.get("status"),
            canonical_number(evidence.get("n_hits")),
            canonical_number(evidence.get("connected_crossings")),
            canonical_number(evidence.get("alternating_table_landings")),
            canonical_number(evidence.get("table_bounces")),
            canonical_number(evidence.get("observed_end_s")),
            evidence.get("end_source"),
        ])
    canonical = json.dumps(
        rows, separators=(",", ":"), allow_nan=False, ensure_ascii=False
    ).encode("utf-8")
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
            # Keep these legacy manifest fields numeric for build 135.
            # Evidence may omit either one, but the released iOS decoder
            # predates the corroborated-OR rule and expects Int values.
            "n_hits": _integer(evidence.get("n_hits")) or 0,
            "connected_crossings": _integer(
                evidence.get("connected_crossings")
            ) or 0,
            "table_bounces": int(evidence["table_bounces"]),
            "alternating_table_landings": _integer(
                evidence.get("alternating_table_landings")
            ),
        })
        output_cursor = output_end
    return {
        "v": 2,
        "rule": RULE,
        "max_seconds": float(max_seconds),
        # The receipt set, not only today's winners. A later evidence-only
        # recovery that promotes a previously weak rally must make the
        # artifact stale even when every already-selected point is unchanged.
        "points_revision": points_revision(points),
        "duration_s": round(output_cursor, 3),
        "points": manifest_points,
    }
