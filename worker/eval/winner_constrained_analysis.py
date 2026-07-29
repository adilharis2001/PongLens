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


def _timeline_key(point: Mapping[str, Any]) -> tuple[int, float, int]:
    t0 = point.get("t0")
    if isinstance(t0, (int, float)) and not isinstance(t0, bool):
        return (0, float(t0), int(point["idx"]))
    return (1, 0.0, int(point["idx"]))


def select_twenty(points: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Choose four frozen, confirmed points from each of five holdout strata."""
    by_stratum: dict[int, list[Mapping[str, Any]]] = {index: [] for index in range(1, 6)}
    seen_ids: set[str] = set()
    seen_indices: set[int] = set()
    for point in points:
        point_id = point.get("id")
        if not isinstance(point_id, str) or not point_id:
            raise ValueError("point selection requires a point id")
        if point_id in seen_ids:
            raise ValueError(f"duplicate point id: {point_id}")
        seen_ids.add(point_id)
        idx = int(point["idx"])
        if idx in seen_indices:
            raise ValueError(f"duplicate point index: {idx}")
        seen_indices.add(idx)
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
    player_names = _player_names(match, user_side)
    contexts: list[dict[str, Any]] = []

    for point in sorted(timeline, key=_timeline_key):
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
            "player_names": player_names,
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


def _player_names(match: Mapping[str, Any], user_side: str) -> dict[str, str]:
    near_name = match.get("player_near_name")
    far_name = match.get("player_far_name")
    user_name = (
        (near_name if user_side == "near" else far_name)
        or match.get("user_name")
        or match.get("owner_name")
        or "Adil"
    )
    opponent_name = (
        (far_name if user_side == "near" else near_name)
        or match.get("opponent_name")
        or "Opponent"
    )
    return {"user": str(user_name), "opponent": str(opponent_name)}


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
    terminal = (
        point.get("terminal")
        or (point.get("diagnostics") or {}).get("terminal")
        or ((point.get("high_precision") or {}).get("diagnostics") or {}).get("terminal")
    )
    if not isinstance(terminal, Mapping):
        return None
    if not terminal.get("supported") or terminal.get("truncated") or terminal.get("later_event"):
        return None
    ending = _ending_value(terminal.get("expected_ending") or terminal.get("ending"))
    winner_side = terminal.get("expected_winner_side") or terminal.get("winner_side")
    if (
        winner_side not in SIDES
        and terminal.get("terminal_kind") == "unreturned landing"
        and ending == "clean winner"
    ):
        contacts = (
            ((point.get("high_precision") or {}).get("diagnostics") or {})
            .get("contact_evidence", {})
            .get("contacts", [])
        )
        for contact in reversed(contacts):
            if isinstance(contact, Mapping) and contact.get("side") in SIDES:
                winner_side = contact["side"]
                break
    implied_winner = (context.get("side_to_player") or {}).get(winner_side)
    if ending is None or implied_winner is None:
        return None
    return _vote(
        "terminal",
        ending,
        implied_winner,
        terminal_kind=terminal.get("terminal_kind"),
    )


def _normalise_player(value: Any, context: Mapping[str, Any]) -> str | None:
    direct = _winner_value(value)
    if direct is not None:
        return direct
    if isinstance(value, Mapping):
        value = value.get("value")
    if not isinstance(value, str):
        return None
    normalized = value.strip().casefold()
    for player, name in (context.get("player_names") or {}).items():
        if player in PLAYERS and isinstance(name, str) and name.strip().casefold() == normalized:
            return player
    return None


def _classifier_vote(
    point: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any] | None:
    classifier = point.get("raw_suggestion") or point.get("classifier") or point.get("suggestion")
    if not isinstance(classifier, Mapping):
        return None
    ending = _ending_value(classifier.get("ending") or classifier.get("how"))
    implied_winner = _normalise_player(classifier.get("winner"), context)
    if ending is None or implied_winner is None:
        return None
    return _vote(
        "classifier",
        ending,
        implied_winner,
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
        _classifier_vote(point, context),
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
    """Join frozen evidence to production facts and package 20 review results."""
    if isinstance(analysis, Mapping) and "points" in analysis:
        points = _build_joined_inferences(analysis, production_context)
    else:
        points = list(analysis)
    confirmed = sum(_winner_value(point.get("confirmed_winner")) is not None for point in points)
    proposals = sum(point.get("ending") is not None for point in points)
    high_confidence = sum(
        point.get("status") == "high_confidence" and point.get("ending") is not None
        for point in points
    )
    confirmed_endings = [
        point.get("confirmed_how")
        for point in points
        if _ending_value(point.get("confirmed_how")) is not None
    ]
    return {
        "version": 1,
        "evidence_policy": (
            "Confirmed winners constrain ending evidence; placement and classifier "
            "evidence remain review-only."
        ),
        "production_context": _compact_match_summary(production_context),
        "points": deepcopy(points),
        "coverage": {
            "confirmed_winner_available": confirmed,
            "ending_proposal_coverage": proposals,
            "high_confidence_auto_fill_coverage": high_confidence,
        },
        "ending_accuracy": {
            "status": "pending" if confirmed_endings else "unavailable",
            "reason": (
                "Confirmed ending labels require a separate accuracy comparison."
                if confirmed_endings
                else "No confirmed ending labels are available for this POC."
            ),
        },
    }


def _match_record(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    match = payload.get("match")
    return match if isinstance(match, Mapping) else payload


def _match_id(payload: Mapping[str, Any]) -> Any:
    match = _match_record(payload)
    return match.get("id") or payload.get("match_id")


def _compact_match_summary(production_context: Mapping[str, Any]) -> dict[str, Any]:
    match = _match_record(production_context)
    fields = (
        "id",
        "first_server",
        "user_side",
        "initial_user_side",
        "opponent_name",
        "player_near_name",
        "player_far_name",
    )
    summary = {
        field: deepcopy(match[field])
        for field in fields
        if field in match
    }
    match_id = _match_id(production_context)
    if match_id is not None:
        summary["match_id"] = match_id
    return summary


def _join_analysis_points(
    analysis_points: Sequence[Mapping[str, Any]],
    production_points: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    by_id: dict[str, Mapping[str, Any]] = {}
    by_idx: dict[int, Mapping[str, Any]] = {}
    for point in production_points:
        point_id = point.get("id")
        idx = int(point["idx"])
        if not isinstance(point_id, str) or not point_id:
            raise ValueError("production point requires an id")
        if point_id in by_id or idx in by_idx:
            raise ValueError("production context contains duplicate point identities")
        by_id[point_id] = point
        by_idx[idx] = point

    joined: list[dict[str, Any]] = []
    for point in analysis_points:
        source = dict(point)
        production = by_id.get(source.get("id"))
        if production is None:
            production = by_idx.get(int(source["idx"]))
        if production is None:
            raise ValueError(f"analysis point {source.get('id') or source.get('idx')} is missing production context")
        combined = deepcopy(source)
        for field in (
            "id",
            "idx",
            "t0",
            "confirmed_winner",
            "confirmed_how",
            "is_let",
            "game_end_override",
            "server_override",
        ):
            if field in production:
                combined[field] = deepcopy(production[field])
        joined.append(combined)
    return joined


def _build_joined_inferences(
    analysis: Mapping[str, Any],
    production_context: Mapping[str, Any],
) -> list[dict[str, Any]]:
    analysis_match_id = _match_id(analysis)
    production_match_id = _match_id(production_context)
    if (
        analysis_match_id is not None
        and production_match_id is not None
        and analysis_match_id != production_match_id
    ):
        raise ValueError("analysis and production match ids do not match")
    analysis_points = analysis.get("points") or []
    production_points = production_context.get("points") or []
    if not isinstance(analysis_points, Sequence) or not isinstance(production_points, Sequence):
        raise ValueError("analysis and production context require point timelines")
    joined = _join_analysis_points(analysis_points, production_points)
    selected = select_twenty(joined)
    contexts = {
        int(context["idx"]): context
        for context in build_point_contexts(production_points, _match_record(production_context))
    }
    results = []
    for point in selected:
        context = contexts.get(int(point["idx"]))
        if context is None:
            raise ValueError(f"selected point {point['idx']} has no score context")
        inference = infer_winner_constrained_point(point, context)
        results.append({
            "id": point["id"],
            "idx": point["idx"],
            "stratum": point.get("stratum"),
            "selection_hash": point.get("selection_hash"),
            "clip": point.get("clip") or point.get("clip_path"),
            "raw_suggestion": deepcopy(point.get("raw_suggestion") or {}),
            "high_precision": deepcopy(point.get("high_precision") or {}),
            "placement": deepcopy(point.get("placement") or {}),
            "confirmed_how": point.get("confirmed_how"),
            **inference,
        })
    return results
