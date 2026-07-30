"""Answer-free terminal-event analysis for the scored-point research POC."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping


DEVELOPMENT_INDEXES = {
    4, 6, 16, 18, 33, 35, 46, 56, 62, 66,
    76, 77, 91, 100, 102, 107, 121, 125, 132, 148,
}
HOLDOUT_INDEXES = {11, 34, 78, 114, 138}
ENDING_FAMILIES = {
    "net_error",
    "net_cord_out",
    "long_error",
    "clean_winner",
    "complete_miss",
}
PLAYERS = {"user", "opponent"}


def load_development_truth(path: Path) -> dict[int, dict[str, Any]]:
    """Load the audited review fixture and enforce its frozen point contract."""

    payload = json.loads(path.read_text())
    if payload.get("version") != 1 or not isinstance(payload.get("points"), list):
        raise ValueError("development fixture must be version 1 with points")

    by_index: dict[int, dict[str, Any]] = {}
    for raw in payload["points"]:
        if not isinstance(raw, Mapping):
            raise ValueError("development fixture points must be objects")
        idx = raw.get("idx")
        if not isinstance(idx, int) or isinstance(idx, bool):
            raise ValueError("development fixture point requires integer idx")
        if idx in by_index:
            raise ValueError(f"duplicate development point index: {idx}")
        contact_count = raw.get("contact_count")
        if (
            not isinstance(contact_count, int)
            or isinstance(contact_count, bool)
            or contact_count < 1
        ):
            raise ValueError(f"point {idx} requires positive contact_count")
        if raw.get("ending_family") not in ENDING_FAMILIES:
            raise ValueError(f"point {idx} has unknown ending_family")
        for field in ("last_hitter", "attempted_hitter"):
            value = raw.get(field)
            if value is not None and value not in PLAYERS:
                raise ValueError(f"point {idx} has invalid {field}")
        if not isinstance(raw.get("summary"), str) or not raw["summary"].strip():
            raise ValueError(f"point {idx} requires a summary")
        by_index[idx] = dict(raw)

    if set(by_index) != DEVELOPMENT_INDEXES:
        missing = sorted(DEVELOPMENT_INDEXES - set(by_index))
        extra = sorted(set(by_index) - DEVELOPMENT_INDEXES)
        raise ValueError(
            f"development fixture index mismatch; missing={missing} extra={extra}"
        )
    return by_index


def select_disjoint_holdout(
    analysis: Mapping[str, Any],
    development_indexes: set[int],
) -> list[int]:
    """Return every frozen analysis point not used for development."""

    points = analysis.get("points")
    if not isinstance(points, list):
        raise ValueError("analysis requires a points list")
    indexes = [point.get("idx") for point in points if isinstance(point, Mapping)]
    if any(not isinstance(value, int) or isinstance(value, bool) for value in indexes):
        raise ValueError("analysis point requires integer idx")
    if len(indexes) != len(set(indexes)):
        raise ValueError("analysis contains duplicate point indexes")
    overlap = development_indexes - set(indexes)
    if overlap:
        raise ValueError(f"analysis is missing development indexes: {sorted(overlap)}")
    holdout = sorted(set(indexes) - development_indexes)
    if set(holdout) != HOLDOUT_INDEXES:
        raise ValueError(f"unexpected holdout indexes: {holdout}")
    return holdout
