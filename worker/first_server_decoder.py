"""High-precision first-server decoding from physical-server point calls."""

from __future__ import annotations

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
