"""Legal serve-chain candidates and explicit pose fusion."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any, Mapping


TABLE_MID_V = 2.74 / 2.0


@dataclass(frozen=True)
class ServeChainThresholds:
    minimum_separation_s: float = 0.30
    maximum_separation_s: float = 0.62
    maximum_chains: int = 3
    disagreement_margin: float = 1.1


DEFAULT_SERVE_CHAIN_THRESHOLDS = ServeChainThresholds()


def _serve_shot(hypothesis: Mapping[str, Any]) -> Mapping[str, Any] | None:
    return next(
        (
            shot
            for shot in hypothesis.get("shots") or []
            if shot.get("phase") == "serve"
        ),
        None,
    )


def _half(event: Mapping[str, Any]) -> str | None:
    raw = event.get("v")
    if raw is None:
        return None
    return "near" if float(raw) < TABLE_MID_V else "far"


def _bounded(value: float) -> float:
    return min(1.0, max(0.0, value))


def _event_audio(event: Mapping[str, Any]) -> float:
    raw = max(0.0, float(event.get("audio_confidence") or 0.0))
    return 1.0 - math.exp(-raw / 2.0)


def _candidate(
    hypothesis: Mapping[str, Any],
    thresholds: ServeChainThresholds,
) -> dict[str, Any] | None:
    side = str(
        hypothesis.get("server_side") or hypothesis.get("serverSide") or ""
    )
    if side not in {"near", "far"}:
        return None
    if hypothesis.get("hard_reasons"):
        return None
    serve = _serve_shot(hypothesis)
    if serve is None:
        return None
    first = serve.get("serve_first_bounce") or {}
    second = serve.get("landing") or {}
    if first.get("t") is None or second.get("t") is None:
        return None
    first_t = float(first["t"])
    second_t = float(second["t"])
    separation = second_t - first_t
    first_half = _half(first)
    second_half = _half(second)
    if (
        first_half != side
        or second_half not in {"near", "far"}
        or first_half == second_half
        or not (
            thresholds.minimum_separation_s
            <= separation
            <= thresholds.maximum_separation_s
        )
    ):
        return None
    geometry_score = _bounded(
        (
            float(first.get("confidence") or 0.0)
            + float(second.get("confidence") or 0.0)
        )
        / 2.0
    )
    trajectory_score = _bounded(
        1.0 - math.exp(-max(0.0, float(hypothesis.get("score") or 0.0)) / 6.0)
    )
    audio_score = (
        _event_audio(first) + _event_audio(second)
    ) / 2.0
    rank = (
        0.45 * geometry_score
        + 0.35 * trajectory_score
        + 0.20 * audio_score
    )
    return {
        "version": 1,
        "server_hypothesis": side,
        "first_bounce": {
            **dict(first),
            "t": round(first_t, 4),
            "half": first_half,
        },
        "second_bounce": {
            **dict(second),
            "t": round(second_t, 4),
            "half": second_half,
        },
        "separation_s": round(separation, 4),
        "geometry_score": round(geometry_score, 4),
        "trajectory_score": round(trajectory_score, 4),
        "audio_score": round(audio_score, 4),
        "rank": round(rank, 4),
        "thresholds": asdict(thresholds),
    }


def enumerate_serve_chains(
    reconstruction: Mapping[str, Any],
    thresholds: ServeChainThresholds = DEFAULT_SERVE_CHAIN_THRESHOLDS,
) -> list[dict[str, Any]]:
    """Return up to three deterministic legal two-bounce candidates."""

    by_key: dict[tuple[str, float, float], dict[str, Any]] = {}
    for hypothesis in (reconstruction.get("hypotheses") or {}).values():
        if not isinstance(hypothesis, Mapping):
            continue
        candidate = _candidate(hypothesis, thresholds)
        if candidate is None:
            continue
        key = (
            str(candidate["server_hypothesis"]),
            float(candidate["first_bounce"]["t"]),
            float(candidate["second_bounce"]["t"]),
        )
        existing = by_key.get(key)
        if existing is None or float(candidate["rank"]) > float(
            existing["rank"]
        ):
            by_key[key] = candidate
    return sorted(
        by_key.values(),
        key=lambda item: (
            -float(item["rank"]),
            0 if item["server_hypothesis"] == "near" else 1,
            float(item["first_bounce"]["t"]),
        ),
    )[: thresholds.maximum_chains]


def fuse_chain_and_motion(
    chain: Mapping[str, Any],
    motion: Mapping[str, Any],
    thresholds: ServeChainThresholds = DEFAULT_SERVE_CHAIN_THRESHOLDS,
) -> dict[str, Any]:
    """Let coherent pose attribute the player while geometry confirms play."""

    evidence = {
        "chain_side": chain.get("server_hypothesis"),
        "chain_rank": round(float(chain.get("rank") or 0.0), 4),
        "motion_side": motion.get("side"),
        "motion_scores": dict(motion.get("scores") or {}),
        "motion_confidence": round(
            float(motion.get("confidence") or 0.0), 4
        ),
    }
    if (
        motion.get("status") != "high_confidence"
        or motion.get("side") not in {"near", "far"}
    ):
        return {
            "version": 1,
            "status": "withheld",
            "side": None,
            "onset_t": None,
            "contact_t": None,
            "confidence": 0.0,
            "reason": "service_motion_withheld",
            "evidence": evidence,
        }
    motion_side = str(motion["side"])
    chain_side = str(chain.get("server_hypothesis") or "")
    scores = motion.get("scores") or {}
    other_side = "far" if motion_side == "near" else "near"
    motion_margin = float(scores.get(motion_side) or 0.0) - float(
        scores.get(other_side) or 0.0
    )
    consistent = motion_side == chain_side
    if not consistent and motion_margin < thresholds.disagreement_margin:
        return {
            "version": 1,
            "status": "withheld",
            "side": None,
            "onset_t": None,
            "contact_t": None,
            "confidence": 0.0,
            "reason": "chain_pose_disagreement",
            "evidence": {**evidence, "motion_margin": round(motion_margin, 4)},
        }
    chain_rank = _bounded(float(chain.get("rank") or 0.0))
    motion_confidence = _bounded(float(motion.get("confidence") or 0.0))
    confidence = (
        0.65 * motion_confidence + 0.35 * chain_rank
        if consistent
        else 0.72 * motion_confidence + 0.18 * chain_rank
    )
    return {
        "version": 1,
        "status": "high_confidence",
        "side": motion_side,
        "onset_t": motion.get("onset_t"),
        "contact_t": motion.get("contact_t"),
        "confidence": round(min(0.999, confidence), 4),
        "reason": (
            "chain_pose_agree"
            if consistent
            else "pose_overrides_chain_hypothesis"
        ),
        "evidence": {**evidence, "motion_margin": round(motion_margin, 4)},
    }
