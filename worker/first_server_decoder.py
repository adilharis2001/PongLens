"""High-precision first-server decoding from physical-server point calls."""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence


def _other(side: str) -> str:
    return "far" if side == "near" else "near"


def _expected_side(first_side: str, logical_position: int) -> str:
    block = (logical_position - 1) // 2
    return first_side if block % 2 == 0 else _other(first_side)


def _ordered_calls(
    calls: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    return sorted(
        calls,
        key=lambda call: (
            int(call.get("position") or 0),
            int(call.get("idx") or 0),
        ),
    )


def score_rotation_alignment(
    calls: Sequence[Mapping[str, Any]],
    first_side: str,
    skipped_position: int | None = None,
) -> dict[str, Any]:
    """Score one A,A,B,B alignment while preserving explicit abstentions."""

    if first_side not in {"near", "far"}:
        raise ValueError("first side must be near or far")
    if skipped_position is not None and not 1 <= skipped_position <= 5:
        raise ValueError("skipped position must be between one and five")
    ordered = _ordered_calls(calls)
    logical_positions = []
    expected = []
    matched_weight = 0.0
    total_weight = 0.0
    usable_points = []
    for ordinal, call in enumerate(ordered, start=1):
        logical_position = ordinal
        if (
            skipped_position is not None
            and logical_position >= skipped_position
        ):
            logical_position += 1
        logical_positions.append(logical_position)
        expected_side = _expected_side(first_side, logical_position)
        expected.append(expected_side)
        if (
            call.get("status") != "high_confidence"
            or call.get("side") not in {"near", "far"}
        ):
            continue
        weight = min(1.0, max(0.0, float(call.get("confidence") or 0.0)))
        total_weight += weight
        usable_points.append(int(call.get("idx") or 0))
        if call.get("side") == expected_side:
            matched_weight += weight
    agreement = matched_weight / total_weight if total_weight > 0 else 0.0
    return {
        "first_side": first_side,
        "skipped_position": skipped_position,
        "missing_points": 1 if skipped_position is not None else 0,
        "logical_positions": logical_positions,
        "expected": expected,
        "agreement": round(agreement, 4),
        "matched_weight": round(matched_weight, 4),
        "total_weight": round(total_weight, 4),
        "usable_points": usable_points,
    }


def _best_alignment(
    calls: Sequence[Mapping[str, Any]],
    first_side: str,
    max_missing: int,
) -> dict[str, Any]:
    skipped = [None]
    if max_missing >= 1:
        skipped.extend(range(1, 6))
    candidates = [
        score_rotation_alignment(calls, first_side, position)
        for position in skipped
    ]
    return max(
        candidates,
        key=lambda result: (
            float(result["agreement"]),
            -int(result["missing_points"]),
            -int(result["skipped_position"] or 0),
        ),
    )


def decode_first_server(
    calls: Sequence[Mapping[str, Any]],
    max_missing: int = 1,
    minimum_calls: int = 3,
    minimum_confidence: float = 0.95,
) -> dict[str, Any]:
    """Return near/far only for one clearly superior legal rotation."""

    if max_missing not in {0, 1}:
        raise ValueError("max_missing must be zero or one")
    usable = [
        call
        for call in calls
        if call.get("status") == "high_confidence"
        and call.get("side") in {"near", "far"}
    ]
    usable_points = [int(call.get("idx") or 0) for call in usable]
    if len(usable) < minimum_calls:
        return {
            "version": 1,
            "side": None,
            "status": "withheld",
            "confidence": 0.0,
            "alignment": None,
            "usable_points": usable_points,
            "alternatives": [],
            "reason": "insufficient_usable_calls",
        }
    alternatives = [
        _best_alignment(calls, side, max_missing)
        for side in ("near", "far")
    ]
    ranked = sorted(
        alternatives,
        key=lambda result: (
            -float(result["agreement"]),
            int(result["missing_points"]),
            0 if result["first_side"] == "near" else 1,
        ),
    )
    best, other = ranked
    best_agreement = float(best["agreement"])
    other_agreement = float(other["agreement"])
    confidence = best_agreement * (
        0.9 + 0.1 * (1.0 - other_agreement)
    )
    decisive = (
        best_agreement > other_agreement
        and confidence >= minimum_confidence
    )
    return {
        "version": 1,
        "side": best["first_side"] if decisive else None,
        "status": "high_confidence" if decisive else "withheld",
        "confidence": round(confidence, 4) if decisive else 0.0,
        "alignment": best if decisive else None,
        "usable_points": usable_points,
        "alternatives": ranked,
        "reason": (
            "rotation_alignment_high_confidence"
            if decisive
            else "rotation_alignment_ambiguous"
        ),
    }


def _soft_probabilities(call: Mapping[str, Any]) -> tuple[float, float]:
    scores = call.get("scores")
    source = scores if isinstance(scores, Mapping) else call
    near_raw = source.get("near")
    far_raw = source.get("far")
    if near_raw is None or far_raw is None:
        side = call.get("side")
        confidence = min(1.0, max(0.0, float(call.get("confidence") or 0.0)))
        if side == "near":
            near_raw, far_raw = confidence, 1.0 - confidence
        elif side == "far":
            near_raw, far_raw = 1.0 - confidence, confidence
        else:
            near_raw, far_raw = 0.5, 0.5
    near = min(1.0 - 1e-6, max(1e-6, float(near_raw)))
    far = min(1.0 - 1e-6, max(1e-6, float(far_raw)))
    total = near + far
    return near / total, far / total


def _score_soft_alignment(
    calls: Sequence[Mapping[str, Any]],
    first_side: str,
    skipped_position: int | None,
) -> dict[str, Any]:
    ordered = _ordered_calls(calls)
    expected: list[str] = []
    logical_positions: list[int] = []
    log_likelihood = 0.0
    for ordinal, call in enumerate(ordered, start=1):
        logical_position = ordinal
        if skipped_position is not None and logical_position >= skipped_position:
            logical_position += 1
        expected_side = _expected_side(first_side, logical_position)
        near, far = _soft_probabilities(call)
        probability = near if expected_side == "near" else far
        log_likelihood += math.log(max(probability, 1e-12))
        logical_positions.append(logical_position)
        expected.append(expected_side)
    return {
        "first_side": first_side,
        "skipped_position": skipped_position,
        "missing_points": 1 if skipped_position is not None else 0,
        "logical_positions": logical_positions,
        "expected": expected,
        "log_likelihood": round(log_likelihood, 8),
    }


def decode_first_server_soft(
    calls: Sequence[Mapping[str, Any]],
    *,
    max_missing: int = 1,
    minimum_margin: float = 1.5,
    minimum_calls: int = 3,
) -> dict[str, Any]:
    """Combine weak point probabilities under legal A,A,B,B rotation.

    Unlike :func:`decode_first_server`, this decoder retains subthreshold point
    evidence.  It may shift the sequence once to represent one removed or
    missed point, but never invents more than one missing observation.
    """

    if max_missing not in {0, 1}:
        raise ValueError("max_missing must be zero or one")
    if minimum_margin < 0:
        raise ValueError("minimum_margin must be non-negative")
    ordered = _ordered_calls(calls)
    if len(ordered) < minimum_calls:
        return {
            "version": 2,
            "side": None,
            "status": "withheld",
            "confidence": 0.0,
            "likelihood_margin": 0.0,
            "alignment": None,
            "alternatives": [],
            "reason": "insufficient_calls",
        }

    candidates: list[dict[str, Any]] = []
    skipped_positions: list[int | None] = [None]
    if max_missing:
        skipped_positions.extend(range(1, len(ordered) + 2))
    for side in ("near", "far"):
        side_candidates = [
            _score_soft_alignment(ordered, side, skipped)
            for skipped in skipped_positions
        ]
        best = max(
            side_candidates,
            key=lambda value: (
                float(value["log_likelihood"]),
                -int(value["missing_points"]),
                -int(value["skipped_position"] or 0),
            ),
        )
        candidates.append(best)
    ranked = sorted(
        candidates,
        key=lambda value: (
            -float(value["log_likelihood"]),
            int(value["missing_points"]),
            0 if value["first_side"] == "near" else 1,
        ),
    )
    best, other = ranked
    margin = float(best["log_likelihood"]) - float(other["log_likelihood"])
    decisive = margin >= minimum_margin
    confidence = 1.0 / (1.0 + math.exp(-margin)) if decisive else 0.0
    return {
        "version": 2,
        "side": best["first_side"] if decisive else None,
        "status": "high_confidence" if decisive else "withheld",
        "confidence": round(confidence, 6),
        "likelihood_margin": round(margin, 6),
        "alignment": best if decisive else None,
        "alternatives": ranked,
        "reason": (
            "soft_rotation_likelihood_high_confidence"
            if decisive
            else "soft_rotation_likelihood_ambiguous"
        ),
    }
