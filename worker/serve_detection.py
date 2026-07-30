"""Experiment-only serve selection from side-neutral placement evidence.

This module never reads user-entered server truth. It compares the two
physical-server hypotheses produced by placement reconstruction, requires a
legal two-bounce table sequence, and abstains when the evidence is close.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence


TABLE_LENGTH_M = 2.74
NET_V = TABLE_LENGTH_M / 2.0


@dataclass(frozen=True)
class ServeThresholds:
    ready_margin: float = 1.6
    review_margin: float = 0.65
    minimum_selected_score: float = 3.5
    minimum_bounce_confidence: float = 0.45
    contact_lookback_s: float = 1.25


DEFAULT_THRESHOLDS = ServeThresholds()


def _other(side: str) -> str:
    return "far" if side == "near" else "near"


def _table_half(event: Mapping[str, Any]) -> str | None:
    value = event.get("v")
    if value is None:
        return None
    return "near" if float(value) < NET_V else "far"


def _serve_shot(hypothesis: Mapping[str, Any]) -> Mapping[str, Any] | None:
    return next(
        (
            shot
            for shot in hypothesis.get("shots") or []
            if shot.get("phase") == "serve"
        ),
        None,
    )


def _contact_strength(candidate: Mapping[str, Any], side: str) -> float:
    kind = str(candidate.get("kind") or "")
    visual = max(0.0, float(candidate.get("visual_confidence") or 0.0))
    audio = max(0.0, float(candidate.get("audio_confidence") or 0.0))
    strength = min(1.0, visual) + min(1.0, audio / 2.0)
    if kind == "contact":
        strength += 0.7
    elif kind == "impact":
        strength += 0.2
    if candidate.get("side") == side:
        strength += 0.4
    return strength


def _infer_contact_time(
    candidates: Sequence[Mapping[str, Any]],
    side: str,
    first_bounce_t: float,
    lookback_s: float,
) -> float | None:
    eligible = [
        candidate
        for candidate in candidates
        if candidate.get("kind") in {"contact", "impact"}
        and candidate.get("t") is not None
        and first_bounce_t - lookback_s
        <= float(candidate["t"])
        < first_bounce_t
    ]
    if not eligible:
        return None
    selected = max(
        eligible,
        key=lambda candidate: (
            _contact_strength(candidate, side),
            float(candidate["t"]),
        ),
    )
    return round(float(selected["t"]), 4)


def _geometry_reason(
    side: str,
    serve: Mapping[str, Any] | None,
    thresholds: ServeThresholds,
) -> str | None:
    if serve is None:
        return "selected_serve_missing"
    first = serve.get("serve_first_bounce") or {}
    second = serve.get("landing") or {}
    if not first or not second:
        return "selected_serve_incomplete"
    first_half = _table_half(first)
    second_half = _table_half(second)
    if first_half != side or second_half != _other(side):
        return "selected_serve_geometry_invalid"
    first_t = first.get("t")
    second_t = second.get("t")
    if (
        first_t is None
        or second_t is None
        or float(second_t) <= float(first_t)
    ):
        return "selected_serve_geometry_invalid"
    first_confidence = float(first.get("confidence") or 0.0)
    second_confidence = float(second.get("confidence") or 0.0)
    if min(first_confidence, second_confidence) < (
        thresholds.minimum_bounce_confidence
    ):
        return "selected_bounce_evidence_weak"
    return None


def _empty_result(
    *,
    status: str,
    reason: str,
    margin: float = 0.0,
    evidence: Mapping[str, Any] | None = None,
    thresholds: ServeThresholds = DEFAULT_THRESHOLDS,
) -> dict[str, Any]:
    return {
        "version": 1,
        "status": status,
        "server_side": None,
        "confidence": 0.0,
        "score_margin": round(float(margin), 4),
        "serve": {
            "contact_t": None,
            "first_bounce": None,
            "second_bounce": None,
        },
        "evidence": dict(evidence or {}),
        "reason": reason,
        "thresholds": asdict(thresholds),
    }


def select_server_hypothesis(
    reconstruction: Mapping[str, Any],
    thresholds: ServeThresholds = DEFAULT_THRESHOLDS,
) -> dict[str, Any]:
    """Select a physical server only when one legal hypothesis is separated."""

    hypotheses = reconstruction.get("hypotheses") or {}
    usable = [
        hypothesis
        for side in ("near", "far")
        if isinstance((hypothesis := hypotheses.get(side)), Mapping)
    ]
    if len(usable) != 2:
        return _empty_result(
            status="unavailable",
            reason="both_server_hypotheses_required",
            thresholds=thresholds,
        )
    ranked = sorted(
        usable,
        key=lambda hypothesis: float(hypothesis.get("score") or -math.inf),
        reverse=True,
    )
    selected, runner_up = ranked
    selected_side = str(
        selected.get("server_side") or selected.get("serverSide") or ""
    )
    if selected_side not in {"near", "far"}:
        return _empty_result(
            status="unavailable",
            reason="selected_server_side_invalid",
            thresholds=thresholds,
        )
    selected_score = float(selected.get("score") or -math.inf)
    runner_up_score = float(runner_up.get("score") or -math.inf)
    margin = selected_score - runner_up_score
    evidence = {
        "selected_score": round(selected_score, 4),
        "runner_up_score": round(runner_up_score, 4),
        "selected_status": selected.get("status"),
        "selected_reasons": list(selected.get("reasons") or []),
        "selected_hard_reasons": list(selected.get("hard_reasons") or []),
    }
    if not math.isfinite(selected_score) or not math.isfinite(margin):
        return _empty_result(
            status="unavailable",
            reason="hypothesis_scores_invalid",
            margin=margin if math.isfinite(margin) else 0.0,
            evidence=evidence,
            thresholds=thresholds,
        )
    if selected_score < thresholds.minimum_selected_score:
        return _empty_result(
            status="needs_review",
            reason="selected_score_too_low",
            margin=margin,
            evidence=evidence,
            thresholds=thresholds,
        )
    if margin < thresholds.ready_margin:
        return _empty_result(
            status="needs_review",
            reason="hypothesis_margin_too_small",
            margin=margin,
            evidence=evidence,
            thresholds=thresholds,
        )

    serve = _serve_shot(selected)
    geometry_reason = _geometry_reason(selected_side, serve, thresholds)
    if geometry_reason is not None:
        return _empty_result(
            status="needs_review",
            reason=geometry_reason,
            margin=margin,
            evidence=evidence,
            thresholds=thresholds,
        )
    if selected.get("hard_reasons"):
        return _empty_result(
            status="needs_review",
            reason="selected_hypothesis_has_hard_contradiction",
            margin=margin,
            evidence=evidence,
            thresholds=thresholds,
        )

    first = dict(serve["serve_first_bounce"])
    second = dict(serve["landing"])
    first_t = float(first["t"])
    contact_t = _infer_contact_time(
        reconstruction.get("candidates") or [],
        selected_side,
        first_t,
        thresholds.contact_lookback_s,
    )
    confidence = min(
        0.999,
        0.78
        + min(0.14, max(0.0, margin - thresholds.ready_margin) * 0.025)
        + 0.04 * min(
            1.0,
            float(first.get("confidence") or 0.0),
            float(second.get("confidence") or 0.0),
        ),
    )
    evidence["contact_observed"] = contact_t is not None
    evidence["rally_continued"] = len(selected.get("shots") or []) > 1
    return {
        "version": 1,
        "status": "high_confidence",
        "server_side": selected_side,
        "confidence": round(confidence, 4),
        "score_margin": round(margin, 4),
        "serve": {
            "contact_t": contact_t,
            "first_bounce": first,
            "second_bounce": second,
        },
        "evidence": evidence,
        "reason": "legal_two_bounce_hypothesis_separated",
        "thresholds": asdict(thresholds),
    }


def expected_server(
    first_server: str,
    game_number: int,
    points_played: int,
) -> str:
    """Return the expected server before one point under ITTF rotation."""

    if first_server not in {"near", "far"}:
        raise ValueError("first_server must be 'near' or 'far'")
    if game_number < 1:
        raise ValueError("game_number must be at least 1")
    if points_played < 0:
        raise ValueError("points_played cannot be negative")
    game_first = (
        first_server if game_number % 2 == 1 else _other(first_server)
    )
    if points_played < 20:
        swap = (points_played // 2) % 2 == 1
    else:
        swap = (points_played - 20) % 2 == 1
    return _other(game_first) if swap else game_first


def aggregate_first_server(
    calls: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Convert independent point calls into a conservative match-level vote."""

    votes = {"near": 0, "far": 0}
    usable_points: list[int] = []
    for call in calls:
        if call.get("status") != "high_confidence":
            continue
        observed = call.get("server_side")
        if observed not in {"near", "far"}:
            continue
        game_number = int(call.get("game_number") or 1)
        points_played = int(call.get("points_played") or 0)
        vote = (
            "near"
            if expected_server("near", game_number, points_played) == observed
            else "far"
        )
        votes[vote] += 1
        usable_points.append(int(call["idx"]))

    ranked = sorted(votes, key=votes.get, reverse=True)
    best, other = ranked
    side = (
        best
        if votes[best] >= 2 and votes[best] - votes[other] >= 2
        else None
    )
    return {
        "side": side,
        "status": "high_confidence" if side else "withheld",
        "votes": votes,
        "usable_points": usable_points,
        "reason": (
            "At least two votes and a two-vote margin agree."
            if side
            else "First-server vote count or margin is insufficient."
        ),
    }
