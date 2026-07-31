"""Calibrated fusion of temporal, bounce-chain, and audio serve evidence."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class FusionThresholds:
    strong_pose_probability: float = 0.90
    strong_pose_margin: float = 0.55
    supported_pose_probability: float = 0.72
    supported_pose_margin: float = 0.25
    minimum_support: float = 0.25
    override_margin: float = 0.60
    contradictory_chain_rank: float = 0.50
    audio_window_s: float = 0.18


DEFAULT_FUSION_THRESHOLDS = FusionThresholds()


def _bounded(value: Any) -> float:
    return min(1.0, max(0.0, float(value or 0.0)))


def _temporal_scores(temporal: Mapping[str, Any]) -> tuple[float, float]:
    scores = temporal.get("scores")
    source = scores if isinstance(scores, Mapping) else temporal
    if source.get("near") is None or source.get("far") is None:
        raise ValueError("temporal evidence must contain near and far probabilities")
    near = float(source["near"])
    far = float(source["far"])
    if not (math.isfinite(near) and math.isfinite(far)):
        raise ValueError("temporal near and far probabilities must be finite")
    if not (0.0 <= near <= 1.0 and 0.0 <= far <= 1.0):
        raise ValueError("temporal near and far probabilities must be between zero and one")
    return near, far


def _nearby_audio_support(
    audio: Sequence[Mapping[str, Any]], onset_t: float | None, window_s: float
) -> float:
    if onset_t is None:
        return 0.0
    support = 0.0
    for event in audio:
        raw_time = event.get("time_s", event.get("t"))
        if raw_time is None:
            continue
        distance = abs(float(raw_time) - onset_t)
        if distance > window_s:
            continue
        confidence = max(0.0, float(event.get("confidence") or 0.0))
        normalized = 1.0 - math.exp(-confidence / 2.0)
        proximity = 1.0 - distance / max(window_s, 1e-9)
        support = max(support, normalized * proximity)
    return _bounded(support)


def fuse_temporal_evidence(
    temporal: Mapping[str, Any],
    chains: Sequence[Mapping[str, Any]],
    audio: Sequence[Mapping[str, Any]],
    thresholds: FusionThresholds = DEFAULT_FUSION_THRESHOLDS,
) -> dict[str, Any]:
    """Make a high-precision point call or explicitly abstain.

    Pose can stand alone only when it is unusually strong.  Moderate pose needs
    a legal two-bounce chain for the same player; audio provides timing support
    but never chooses a serving side by itself.
    """

    near, far = _temporal_scores(temporal)
    side = "near" if near >= far else "far"
    probability = max(near, far)
    margin = abs(near - far)
    onset_raw = temporal.get("onset_t")
    onset_t = float(onset_raw) if onset_raw is not None else None

    ranked_chains = sorted(
        (
            chain
            for chain in chains
            if chain.get("server_hypothesis") in {"near", "far"}
        ),
        key=lambda chain: float(chain.get("rank") or 0.0),
        reverse=True,
    )
    best_chain = ranked_chains[0] if ranked_chains else None
    chain_side = best_chain.get("server_hypothesis") if best_chain else None
    chain_rank = _bounded(best_chain.get("rank")) if best_chain else 0.0
    audio_support = _nearby_audio_support(audio, onset_t, thresholds.audio_window_s)
    agrees = chain_side == side
    contradiction = (
        chain_side in {"near", "far"}
        and not agrees
        and chain_rank >= thresholds.contradictory_chain_rank
    )
    support = _bounded(0.75 * (chain_rank if agrees else 0.0) + 0.25 * audio_support)
    evidence = {
        "temporal": {"near": round(near, 6), "far": round(far, 6)},
        "temporal_margin": round(margin, 6),
        "chain_side": chain_side,
        "chain_rank": round(chain_rank, 6),
        "audio_support": round(audio_support, 6),
        "combined_support": round(support, 6),
    }

    if contradiction and margin < thresholds.override_margin:
        status = "withheld"
        reason = "temporal_chain_disagreement"
    elif margin < thresholds.supported_pose_margin:
        status = "withheld"
        reason = "temporal_margin_too_small"
    elif (
        probability >= thresholds.strong_pose_probability
        and margin >= thresholds.strong_pose_margin
    ):
        status = "high_confidence"
        reason = (
            "temporal_overrides_chain"
            if contradiction
            else "strong_temporal_evidence"
        )
    elif (
        agrees
        and probability >= thresholds.supported_pose_probability
        and margin >= thresholds.supported_pose_margin
        and support >= thresholds.minimum_support
    ):
        status = "high_confidence"
        reason = "supported_temporal_evidence"
    else:
        status = "withheld"
        reason = "insufficient_temporal_support"

    confidence = 0.0
    if status == "high_confidence":
        confidence = _bounded(0.75 * probability + 0.25 * support)
        if reason == "strong_temporal_evidence" and not best_chain:
            confidence = probability
    return {
        "version": 1,
        "status": status,
        "side": side if status == "high_confidence" else None,
        "confidence": round(confidence, 6),
        "onset_t": onset_t if status == "high_confidence" else None,
        "reason": reason,
        "evidence": evidence,
        "thresholds": asdict(thresholds),
    }


__all__ = [
    "DEFAULT_FUSION_THRESHOLDS",
    "FusionThresholds",
    "fuse_temporal_evidence",
]
