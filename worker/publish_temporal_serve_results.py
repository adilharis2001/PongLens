#!/usr/bin/env python3
"""Publish a protected, read-only review of temporal serve results."""

from __future__ import annotations

from collections import Counter
from typing import Any, Mapping, Sequence

from worker.service_motion_chains import enumerate_serve_chains


EXPERIMENT = "temporal-serve-scale-v1"
OUTCOMES = ("correct", "wrong", "withheld")


def validate_experiment(
    manifest: Mapping[str, Any], results: Mapping[str, Any]
) -> None:
    if manifest.get("experiment") != EXPERIMENT or results.get("experiment") != EXPERIMENT:
        raise ValueError("results or manifest belong to another experiment")
    manifest_hash = str(manifest.get("manifest_sha256") or "")
    if not manifest_hash or manifest_hash != str(results.get("manifest_sha256") or ""):
        raise ValueError("results and manifest hash do not match")


def classify_prediction(row: Mapping[str, Any]) -> str:
    truth = (row.get("evaluation") or {}).get("expected_server_side")
    call = row.get("fused") or {}
    predicted = call.get("side")
    if (
        truth in {"near", "far"}
        and call.get("status") == "high_confidence"
        and predicted in {"near", "far"}
    ):
        return "correct" if predicted == truth else "wrong"
    return "withheld"


def _sealed_holdout_points(manifest: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for match in (manifest.get("splits") or {}).get("holdout") or []:
        for raw in match.get("points") or []:
            point = dict(raw)
            source_id = str(point.get("source_id") or "")
            if not source_id or source_id in output:
                raise ValueError("sealed holdout contains a missing or duplicate source")
            output[source_id] = point
    return output


def _rank_key(item: Mapping[str, Any]) -> tuple[float, float, str]:
    return (
        -float(item.get("fused_confidence") or 0.0),
        -float(item.get("temporal_margin") or 0.0),
        str(item.get("source_id") or ""),
    )


def _result_item(
    row: Mapping[str, Any], point: Mapping[str, Any]
) -> dict[str, Any]:
    temporal = row.get("temporal") or {}
    fused = row.get("fused") or {}
    near = float(temporal.get("near") or 0.0)
    far = float(temporal.get("far") or 0.0)
    model_input = point.get("model_input") or {}
    chains = enumerate_serve_chains(model_input.get("placement") or {})
    best_chain = chains[0] if chains else {}
    return {
        "source_id": str(row["source_id"]),
        "match_id": str(row.get("match_id") or ""),
        "point_id": str(point.get("source_point_id") or ""),
        "point_idx": int(point.get("source_point_idx") or 0),
        "clip_uri": str(model_input.get("clip_uri") or ""),
        "media_sha256": str(model_input.get("media_sha256") or ""),
        "outcome": classify_prediction(row),
        "expected_side": (row.get("evaluation") or {}).get("expected_server_side"),
        "predicted_side": fused.get("side"),
        "fused_status": str(fused.get("status") or "withheld"),
        "fused_confidence": float(fused.get("confidence") or 0.0),
        "fused_reason": str(fused.get("reason") or "unknown"),
        "temporal_near": near,
        "temporal_far": far,
        "temporal_margin": abs(near - far),
        "model_onset_s": temporal.get("onset_t"),
        "first_bounce_s": (best_chain.get("first_bounce") or {}).get("t"),
        "second_bounce_s": (best_chain.get("second_bounce") or {}).get("t"),
        "chain_rank": best_chain.get("rank"),
        "server_source": (row.get("evaluation") or {}).get("server_source"),
    }


def _take_with_match_cap(
    ranked: Sequence[dict[str, Any]], count: int, per_match_cap: int
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    per_match: Counter[str] = Counter()
    for item in ranked:
        match_id = str(item["match_id"])
        if per_match[match_id] >= per_match_cap:
            continue
        selected.append(item)
        per_match[match_id] += 1
        if len(selected) == count:
            return selected
    for item in ranked:
        if item in selected:
            continue
        selected.append(item)
        if len(selected) == count:
            return selected
    return selected


def select_review_sample(
    manifest: Mapping[str, Any],
    results: Mapping[str, Any],
    *,
    total: int = 24,
    per_stratum: int = 8,
    per_match_cap: int = 3,
) -> list[dict[str, Any]]:
    validate_experiment(manifest, results)
    sealed = _sealed_holdout_points(manifest)
    rows = list((results.get("predictions") or {}).get("holdout") or [])
    if len({str(row.get("source_id") or "") for row in rows}) != len(rows):
        raise ValueError("holdout predictions contain duplicate sources")
    items = []
    for row in rows:
        source_id = str(row.get("source_id") or "")
        point = sealed.get(source_id)
        if point is None:
            raise ValueError(f"prediction {source_id} is missing from sealed holdout")
        items.append(_result_item(row, point))

    by_outcome = {
        outcome: sorted(
            (item for item in items if item["outcome"] == outcome),
            key=_rank_key,
        )
        for outcome in OUTCOMES
    }
    selected: list[dict[str, Any]] = []
    for outcome in OUTCOMES:
        selected.extend(
            _take_with_match_cap(
                by_outcome[outcome], per_stratum, per_match_cap
            )
        )
    if len(selected) < total:
        leftovers = {
            outcome: [item for item in by_outcome[outcome] if item not in selected]
            for outcome in OUTCOMES
        }
        while len(selected) < total and any(leftovers.values()):
            for outcome in OUTCOMES:
                if leftovers[outcome] and len(selected) < total:
                    selected.append(leftovers[outcome].pop(0))
    if len(selected) != total:
        raise ValueError(f"could not assemble {total} unique held-out result items")
    for order, item in enumerate(selected, start=1):
        item["order"] = order
    return selected


__all__ = [
    "EXPERIMENT",
    "OUTCOMES",
    "classify_prediction",
    "select_review_sample",
    "validate_experiment",
]
