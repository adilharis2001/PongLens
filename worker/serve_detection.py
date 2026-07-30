"""Select a serve from side-neutral placement reconstruction evidence.

This module deliberately knows nothing about match scoring, player identity,
or a user's first-server choice. It compares the two physical-server
hypotheses and abstains unless the selected hypothesis contains a separated,
legal two-bounce serve sequence.
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
    if _table_half(first) != side or _table_half(second) != _other(side):
        return "selected_serve_geometry_invalid"
    first_t = first.get("t")
    second_t = second.get("t")
    if first_t is None or second_t is None or float(second_t) <= float(first_t):
        return "selected_serve_geometry_invalid"
    confidence = min(
        float(first.get("confidence") or 0.0),
        float(second.get("confidence") or 0.0),
    )
    if confidence < thresholds.minimum_bounce_confidence:
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
    """Return a physical server only for one separated legal hypothesis."""

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

    assert serve is not None
    first = dict(serve["serve_first_bounce"])
    second = dict(serve["landing"])
    contact_t = _infer_contact_time(
        reconstruction.get("candidates") or [],
        selected_side,
        float(first["t"]),
        thresholds.contact_lookback_s,
    )
    confidence = min(
        0.999,
        0.78
        + min(0.14, margin / 20.0)
        + min(
            0.079,
            (
                float(first.get("confidence") or 0.0)
                + float(second.get("confidence") or 0.0)
            )
            / 20.0,
        ),
    )
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
        "reason": "selected_legal_serve",
        "thresholds": asdict(thresholds),
    }
