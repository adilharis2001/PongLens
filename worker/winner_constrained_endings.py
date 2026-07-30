"""Production-facing winner-constrained point-ending analysis.

This adapter preserves the independently tested terminal geometry from the
research POC while exposing a compact, versioned contract suitable for frozen
research gold records.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from worker.eval.enhanced_terminal_analysis import (
    build_event_timeline,
    rank_terminal_hypotheses,
)


ANALYZER_VERSION = 1
ENDING_MAP = {
    "net_error": "net",
    "net_cord_out": "net",
    "long_error": "long",
    "clean_winner": "clean_winner",
    "complete_miss": "missed_return",
    "unreturned_or_missed": "clean_winner",
    "unclear": "unsure",
}


def _other_player(player: str | None) -> str | None:
    if player == "user":
        return "opponent"
    if player == "opponent":
        return "user"
    return None


def _ending_family(result: Mapping[str, Any]) -> str:
    prediction = str(result.get("prediction") or "unclear")
    top_family = str((result.get("top_candidate") or {}).get("family") or "")
    if prediction == "unreturned_or_missed":
        attempted = (result.get("terminal_features") or {}).get(
            "attempted_return"
        )
        return "missed_return" if attempted is True else "clean_winner"
    return ENDING_MAP.get(prediction, ENDING_MAP.get(top_family, "unsure"))


def _net_behavior(
    family: str,
    result: Mapping[str, Any],
) -> str | None:
    if family != "net":
        return None
    features = result.get("terminal_features") or {}
    if (
        features.get("net_lateral_roll") is True
        or features.get("net_normal_stall_or_reversal") is True
        or features.get("net_speed_drop") is True
        or result.get("prediction") == "net_error"
    ):
        return "died_stuck_lateral"
    if result.get("prediction") == "net_cord_out":
        return "clipped_continued"
    return "unsure"


def analyze_point_ending(
    point: Mapping[str, Any],
    blurball_detections: Mapping[Any, Any],
    audio_candidates: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    """Analyze one scored point without consulting any reviewer answer."""

    confirmed_winner = context.get("confirmed_winner")
    if confirmed_winner not in {"user", "opponent"}:
        raise ValueError("confirmed_winner must be user or opponent")
    timeline = build_event_timeline(
        point,
        blurball_detections,
        audio_candidates,
        context,
    )
    ranked = rank_terminal_hypotheses(timeline, context)
    family = _ending_family(ranked)
    final_hitter = ranked.get("final_hitter")
    if family in {"net", "long", "wide"}:
        implied_winner = _other_player(final_hitter)
    elif family in {"clean_winner", "missed_return"}:
        implied_winner = final_hitter
    else:
        implied_winner = None
    if implied_winner != confirmed_winner:
        family = "unsure"
        implied_winner = None

    margin = float(ranked.get("confidence_margin") or 0.0)
    status = "predicted" if family != "unsure" else "abstained"
    confidence = (
        "high"
        if status == "predicted" and margin >= 1.5
        else "medium"
        if status == "predicted" and margin >= 0.75
        else "low"
    )
    top = ranked.get("top_candidate") or {}
    return {
        "schema_version": 1,
        "analyzer_version": ANALYZER_VERSION,
        "status": status,
        "ending_family": family,
        "net_behavior": _net_behavior(family, ranked),
        "final_hitter": final_hitter,
        "implied_winner": implied_winner,
        "contact_count": ranked.get("contact_count"),
        "observed_contact_count": ranked.get(
            "observed_contact_count",
            timeline.get("observed_contact_count"),
        ),
        "inferred_contact_count": ranked.get(
            "inferred_contact_count",
            timeline.get("inferred_contact_count"),
        ),
        "attempted_return": (ranked.get("terminal_features") or {}).get(
            "attempted_return"
        ),
        "receiving_zone": ranked.get("terminal_features", {}).get(
            "terminal_stroke_side",
            "unknown",
        ),
        "confidence": confidence,
        "confidence_margin": round(margin, 4),
        "rally_start_s": timeline.get("rally_start_s"),
        "features": ranked.get("terminal_features") or {},
        "positive_evidence": list(top.get("positive_evidence") or []),
        "negative_evidence": list(top.get("negative_evidence") or []),
        "alternatives": [
            {
                "family": ENDING_MAP.get(
                    str(candidate.get("family")),
                    "unsure",
                ),
                "score": candidate.get("score"),
                "winner_consistent": candidate.get("winner_consistent"),
            }
            for candidate in (ranked.get("candidates") or [])[:3]
        ],
    }
