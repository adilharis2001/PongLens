"""Pure, review-only winner-constrained point inference for the local POC."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping, Sequence


PLAYERS = {"user", "opponent"}
SIDES = {"near", "far"}
CAUSAL_ENDINGS = {"forced_error", "unforced_error", "forced error", "unforced error"}


def _other(value: str | None) -> str | None:
    if value == "user":
        return "opponent"
    if value == "opponent":
        return "user"
    if value == "near":
        return "far"
    if value == "far":
        return "near"
    return None


def _winner_value(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("value")
    return value if value in PLAYERS else None


def _ending_value(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("value")
    return value if isinstance(value, str) and value else None


def _is_causal_ending(ending: str | None) -> bool:
    return ending is not None and ending.lower().replace("-", " ") in CAUSAL_ENDINGS


def select_twenty(points: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Choose four frozen, confirmed points from each of five holdout strata."""
    by_stratum: dict[int, list[Mapping[str, Any]]] = {index: [] for index in range(1, 6)}
    for point in points:
        stratum = point.get("stratum")
        if stratum in by_stratum:
            by_stratum[int(stratum)].append(point)
    selected: list[dict[str, Any]] = []
    for stratum in range(1, 6):
        candidates = sorted(
            by_stratum[stratum],
            key=lambda point: (str(point.get("selection_hash") or ""), int(point["idx"])),
        )
        if len(candidates) < 4:
            raise ValueError(f"stratum {stratum} needs at least four frozen points")
        chosen = candidates[:4]
        if any(_winner_value(point.get("confirmed_winner")) is None for point in chosen):
            raise ValueError(f"stratum {stratum} selection includes an unconfirmed winner")
        selected.extend(deepcopy(dict(point)) for point in chosen)
    return sorted(selected, key=lambda point: int(point["idx"]))


def _step_boundary(
    score: dict[str, int],
    winner: str | None,
    override: str | None,
    held_open: bool,
) -> tuple[bool, bool]:
    if winner in PLAYERS:
        score[winner] += 1
    if override == "end":
        return True, False
    if override == "continue":
        return False, True
    if held_open or winner is None:
        return False, held_open
    return (
        (score["user"] >= 11 or score["opponent"] >= 11)
        and abs(score["user"] - score["opponent"]) >= 2,
        False,
    )


def build_point_contexts(
    timeline: Sequence[Mapping[str, Any]],
    match: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Mirror the app's score boundary and ITTF serve walks for each point."""
    first_server = _winner_value(match.get("first_server"))
    initial_user_side = match.get("initial_user_side", match.get("user_side"))
    if initial_user_side not in SIDES:
        raise ValueError("match requires initial user_side of near or far")
    if match.get("first_server") is not None and first_server is None:
        raise ValueError("match first_server must be user or opponent")

    current_server = first_server
    game_first = first_server
    serves_in_block = 0
    score = {"user": 0, "opponent": 0}
    held_open = False
    game = 1
    user_side = initial_user_side
    contexts: list[dict[str, Any]] = []

    for point in sorted(timeline, key=lambda item: int(item["idx"])):
        override_server = _winner_value(point.get("server_override"))
        if override_server is not None:
            if current_server is not None and game_first is not None and override_server != current_server:
                game_first = _other(game_first)
            if current_server is None:
                serves_in_block = 0
            current_server = override_server
            if game_first is None:
                game_first = current_server

        side_to_player = {
            user_side: "user",
            _other(user_side): "opponent",
        }
        player_to_side = {player: side for side, player in side_to_player.items()}
        contexts.append({
            "idx": int(point["idx"]),
            "game": game,
            "score_before": dict(score),
            "server": current_server,
            "server_side": player_to_side.get(current_server),
            "user_side": user_side,
            "side_to_player": side_to_player,
            "player_to_side": player_to_side,
        })

        winner = None if point.get("is_let") else _winner_value(point.get("confirmed_winner"))
        ended, held_open = _step_boundary(
            score,
            winner,
            point.get("game_end_override"),
            held_open,
        )
        if not point.get("is_let"):
            serves_in_block += 1
            deuce = score["user"] >= 10 and score["opponent"] >= 10
            if current_server is not None and serves_in_block >= (1 if deuce else 2):
                current_server = _other(current_server)
                serves_in_block = 0
        if ended:
            game += 1
            score = {"user": 0, "opponent": 0}
            held_open = False
            serves_in_block = 0
            if game_first is not None:
                game_first = _other(game_first)
                current_server = game_first
            user_side = _other(user_side) or user_side
    return contexts


def _vote(
    source: str,
    ending: str | None,
    implied_winner: str | None,
    **details: Any,
) -> dict[str, Any]:
    return {
        "source": source,
        "ending": ending,
        "implied_winner": implied_winner,
        **deepcopy(details),
    }


def _placement_vote(
    point: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any] | None:
    placement = point.get("placement") or {}
    server_side = context.get("server_side")
    hypothesis = (placement.get("hypotheses") or {}).get(server_side)
    if not isinstance(hypothesis, Mapping) or hypothesis.get("status") == "unavailable":
        return None
    proposal = hypothesis.get("proposal") or hypothesis
    if not isinstance(proposal, Mapping):
        return None
    ending = _ending_value(proposal.get("ending") or proposal.get("how"))
    winner_side = proposal.get("winner_side") or proposal.get("implied_winner_side")
    if winner_side not in SIDES:
        winner_side = hypothesis.get("winner_side") or hypothesis.get("implied_winner_side")
    if ending is None or winner_side not in SIDES:
        for shot in reversed(hypothesis.get("shots") or []):
            terminal = shot.get("terminal") or {}
            kind = terminal.get("kind") if isinstance(terminal, Mapping) else None
            if kind not in {"net", "out"}:
                continue
            ending = "hit into net" if kind == "net" else "missed table (long/wide)"
            winner_side = _other(shot.get("hitter_side"))
            break
    implied_winner = (context.get("side_to_player") or {}).get(winner_side)
    if ending is None or implied_winner is None:
        return None
    return _vote(
        "placement",
        ending,
        implied_winner,
        server_side=server_side,
        hypothesis_status=hypothesis.get("status"),
    )


def _terminal_vote(
    point: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any] | None:
    terminal = point.get("terminal") or (point.get("diagnostics") or {}).get("terminal")
    if not isinstance(terminal, Mapping):
        return None
    if not terminal.get("supported") or terminal.get("truncated") or terminal.get("later_event"):
        return None
    winner_side = terminal.get("expected_winner_side") or terminal.get("winner_side")
    implied_winner = (context.get("side_to_player") or {}).get(winner_side)
    ending = _ending_value(terminal.get("expected_ending") or terminal.get("ending"))
    if ending is None or implied_winner is None:
        return None
    return _vote(
        "terminal",
        ending,
        implied_winner,
        terminal_kind=terminal.get("terminal_kind"),
    )


def _classifier_vote(point: Mapping[str, Any]) -> dict[str, Any] | None:
    classifier = point.get("classifier") or point.get("suggestion")
    if not isinstance(classifier, Mapping):
        return None
    return _vote(
        "classifier",
        _ending_value(classifier.get("ending") or classifier.get("how")),
        _winner_value(classifier.get("winner")),
    )


def infer_winner_constrained_point(
    point: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    """Filter terminal, placement, and classifier evidence through the winner."""
    confirmed_winner = _winner_value(point.get("confirmed_winner"))
    surviving: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for candidate in (
        _terminal_vote(point, context),
        _placement_vote(point, context),
        _classifier_vote(point),
    ):
        if candidate is None:
            continue
        if _is_causal_ending(candidate["ending"]):
            rejected.append({**candidate, "reason": "causal_ending_withheld"})
        elif confirmed_winner is None or candidate["implied_winner"] != confirmed_winner:
            rejected.append({**candidate, "reason": "winner_conflict"})
        else:
            surviving.append(candidate)

    terminal = next((vote for vote in surviving if vote["source"] == "terminal"), None)
    review_votes = [vote for vote in surviving if vote["source"] != "terminal"]
    if terminal is not None:
        status = "high_confidence"
        ending = terminal["ending"]
        reason = "Supported terminal geometry agrees with the confirmed winner."
    elif review_votes:
        status = "needs_review"
        ending = review_votes[0]["ending"]
        reason = "Winner-constrained evidence is review-only."
    else:
        status = "unavailable"
        ending = None
        reason = "No ending evidence survives the confirmed-winner constraint."
    return {
        "idx": point.get("idx"),
        "confirmed_winner": confirmed_winner,
        "context": deepcopy(dict(context)),
        "status": status,
        "ending": ending,
        "reason": reason,
        "evidence": {"surviving": surviving, "rejected": rejected},
    }


def build_poc_payload(
    analysis: Sequence[Mapping[str, Any]] | Mapping[str, Any],
    production_context: Mapping[str, Any],
) -> dict[str, Any]:
    """Package reviewable local POC results without asserting ending accuracy."""
    points = list(analysis.get("points") or []) if isinstance(analysis, Mapping) else list(analysis)
    confirmed = sum(_winner_value(point.get("confirmed_winner")) is not None for point in points)
    proposals = sum(point.get("ending") is not None for point in points)
    high_confidence = sum(
        point.get("status") == "high_confidence" and point.get("ending") is not None
        for point in points
    )
    return {
        "version": 1,
        "evidence_policy": (
            "Confirmed winners constrain ending evidence; placement and classifier "
            "evidence remain review-only."
        ),
        "production_context": deepcopy(dict(production_context)),
        "points": deepcopy(points),
        "coverage": {
            "confirmed_winner_available": confirmed,
            "ending_proposal_coverage": proposals,
            "high_confidence_auto_fill_coverage": high_confidence,
        },
        "ending_accuracy": {
            "status": "pending",
            "reason": "No confirmed ending labels are available for this POC.",
        },
    }
