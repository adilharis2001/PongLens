"""Answer-free terminal-event analysis for the scored-point research POC."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEVELOPMENT_INDEXES = {
    4, 6, 16, 18, 33, 35, 46, 56, 62, 66,
    76, 77, 91, 100, 102, 107, 121, 125, 132, 148,
}
HOLDOUT_INDEXES = {11, 34, 78, 114, 138}
ENDING_FAMILIES = {
    "net_error",
    "net_cord_out",
    "long_error",
    "clean_winner",
    "complete_miss",
}
PLAYERS = {"user", "opponent"}


def load_development_truth(path: Path) -> dict[int, dict[str, Any]]:
    """Load the audited review fixture and enforce its frozen point contract."""

    payload = json.loads(path.read_text())
    if payload.get("version") != 1 or not isinstance(payload.get("points"), list):
        raise ValueError("development fixture must be version 1 with points")

    by_index: dict[int, dict[str, Any]] = {}
    for raw in payload["points"]:
        if not isinstance(raw, Mapping):
            raise ValueError("development fixture points must be objects")
        idx = raw.get("idx")
        if not isinstance(idx, int) or isinstance(idx, bool):
            raise ValueError("development fixture point requires integer idx")
        if idx in by_index:
            raise ValueError(f"duplicate development point index: {idx}")
        contact_count = raw.get("contact_count")
        if (
            not isinstance(contact_count, int)
            or isinstance(contact_count, bool)
            or contact_count < 1
        ):
            raise ValueError(f"point {idx} requires positive contact_count")
        if raw.get("ending_family") not in ENDING_FAMILIES:
            raise ValueError(f"point {idx} has unknown ending_family")
        for field in ("last_hitter", "attempted_hitter"):
            value = raw.get(field)
            if value is not None and value not in PLAYERS:
                raise ValueError(f"point {idx} has invalid {field}")
        if not isinstance(raw.get("summary"), str) or not raw["summary"].strip():
            raise ValueError(f"point {idx} requires a summary")
        by_index[idx] = dict(raw)

    if set(by_index) != DEVELOPMENT_INDEXES:
        missing = sorted(DEVELOPMENT_INDEXES - set(by_index))
        extra = sorted(set(by_index) - DEVELOPMENT_INDEXES)
        raise ValueError(
            f"development fixture index mismatch; missing={missing} extra={extra}"
        )
    return by_index


def select_disjoint_holdout(
    analysis: Mapping[str, Any],
    development_indexes: set[int],
) -> list[int]:
    """Return every frozen analysis point not used for development."""

    points = analysis.get("points")
    if not isinstance(points, list):
        raise ValueError("analysis requires a points list")
    indexes = [point.get("idx") for point in points if isinstance(point, Mapping)]
    if any(not isinstance(value, int) or isinstance(value, bool) for value in indexes):
        raise ValueError("analysis point requires integer idx")
    if len(indexes) != len(set(indexes)):
        raise ValueError("analysis contains duplicate point indexes")
    overlap = development_indexes - set(indexes)
    if overlap:
        raise ValueError(f"analysis is missing development indexes: {sorted(overlap)}")
    holdout = sorted(set(indexes) - development_indexes)
    if set(holdout) != HOLDOUT_INDEXES:
        raise ValueError(f"unexpected holdout indexes: {holdout}")
    return holdout


def _other(value: str | None) -> str | None:
    if value == "near":
        return "far"
    if value == "far":
        return "near"
    if value == "user":
        return "opponent"
    if value == "opponent":
        return "user"
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _event_time(event: Mapping[str, Any]) -> float | None:
    return _number(event.get("t", event.get("time_s")))


def _side_player(side: str | None, context: Mapping[str, Any]) -> str | None:
    player = (context.get("side_to_player") or {}).get(side)
    return player if player in PLAYERS else None


def _audio_rows(
    audio_candidates: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    rows = []
    for number, raw in enumerate(audio_candidates, start=1):
        time_s = _event_time(raw)
        if time_s is None:
            continue
        rows.append({
            "id": str(raw.get("id") or f"audio-{number:04d}"),
            "t": round(time_s, 4),
            "confidence": round(_number(raw.get("confidence")) or 0.0, 4),
            "role": "unknown_audio",
        })
    return sorted(rows, key=lambda event: (event["t"], event["id"]))


def _candidate_rows(point: Mapping[str, Any]) -> list[dict[str, Any]]:
    candidates = (point.get("placement") or {}).get("candidates") or []
    rows: list[dict[str, Any]] = []
    for number, raw in enumerate(candidates, start=1):
        if not isinstance(raw, Mapping):
            continue
        kind = raw.get("kind")
        time_s = _event_time(raw)
        if kind not in {"contact", "bounce", "impact"} or time_s is None:
            continue
        rows.append({
            "id": str(raw.get("id") or f"visual-{number:04d}"),
            "kind": kind,
            "t": round(time_s, 4),
            "side": raw.get("side") if raw.get("side") in {"near", "far"} else None,
            "x": _number(raw.get("x")),
            "y": _number(raw.get("y")),
            "u": _number(raw.get("u")),
            "v": _number(raw.get("v")),
            "visual_confidence": round(
                _number(raw.get("visual_confidence")) or 0.0, 4
            ),
        })

    track = (point.get("diagnostics") or {}).get("track") or {}
    for kind, field in (("contact", "hits"), ("bounce", "bounces")):
        for number, raw in enumerate(track.get(field) or [], start=1):
            if not isinstance(raw, Mapping):
                continue
            time_s = _event_time(raw)
            if time_s is None:
                continue
            if any(
                event["kind"] == kind and abs(float(event["t"]) - time_s) <= 0.10
                for event in rows
            ):
                continue
            rows.append({
                "id": f"track-{kind}-{number:04d}",
                "kind": kind,
                "t": round(time_s, 4),
                "side": (
                    raw.get("side")
                    if raw.get("side") in {"near", "far"}
                    else None
                ),
                "x": _number(raw.get("x")),
                "y": _number(raw.get("y")),
                "u": _number(raw.get("u")),
                "v": _number(raw.get("v")),
                "visual_confidence": 0.55,
            })
    return sorted(rows, key=lambda event: (event["t"], event["kind"], event["id"]))


def _attach_audio_support(
    events: list[dict[str, Any]],
    audio: list[dict[str, Any]],
    tolerance_s: float = 0.120,
) -> set[str]:
    used: set[str] = set()
    for event in events:
        nearest = min(
            audio,
            key=lambda candidate: abs(float(candidate["t"]) - float(event["t"])),
            default=None,
        )
        if (
            nearest is None
            or abs(float(nearest["t"]) - float(event["t"])) > tolerance_s
        ):
            event["audio_supported"] = False
            event["audio_confidence"] = 0.0
            continue
        event["audio_supported"] = True
        event["audio_confidence"] = nearest["confidence"]
        event["audio_t"] = nearest["t"]
        used.add(nearest["id"])
    return used


def _serve_time(
    point: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
) -> float:
    shot_times = [
        _number(shot.get("time_s"))
        for shot in point.get("shots") or []
        if isinstance(shot, Mapping) and int(shot.get("index") or 0) == 1
    ]
    valid_shot_times = [value for value in shot_times if value is not None]
    bounces = [
        float(event["t"]) for event in candidates if event.get("kind") == "bounce"
    ]
    values = []
    if valid_shot_times:
        values.append(min(valid_shot_times))
    if bounces:
        values.append(max(0.0, min(bounces) - 0.22))
    return round(min(values), 4) if values else 0.0


def _contact_sequence(
    point: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
    context: Mapping[str, Any],
) -> list[dict[str, Any]]:
    server_side = context.get("server_side")
    if server_side not in {"near", "far"}:
        raise ValueError("event timeline requires a known server_side")
    serve_t = _serve_time(point, candidates)
    contacts = [{
        "id": "serve-origin",
        "t": serve_t,
        "side": server_side,
        "player": _side_player(server_side, context),
        "observed": True,
        "inferred": False,
        "audio_supported": False,
        "audio_confidence": 0.0,
        "source": "known_server_origin",
    }]

    expected = _other(server_side)
    for candidate in candidates:
        if candidate.get("kind") != "contact":
            continue
        time_s = float(candidate["t"])
        if time_s <= float(contacts[-1]["t"]) + 0.080:
            continue
        side = candidate.get("side")
        if side != expected:
            continue
        contact = {
            **dict(candidate),
            "player": _side_player(side, context),
            "observed": True,
            "inferred": False,
            "source": "visual_reversal",
        }
        contacts.append(contact)
        expected = _other(expected)
    return contacts


def _calibration_corners(
    context: Mapping[str, Any],
) -> dict[str, tuple[float, float]] | None:
    calibration = context.get("calibration") or {}
    raw = calibration.get("table_corners_px") or {}
    aliases = {
        "near_left": ("A_near_left", "A_near_1"),
        "near_right": ("B_near_right", "B_near_2"),
        "far_right": ("C_far_right", "C_far_2"),
        "far_left": ("D_far_left", "D_far_1"),
    }
    corners: dict[str, tuple[float, float]] = {}
    for name, keys in aliases.items():
        value = next((raw.get(key) for key in keys if raw.get(key) is not None), None)
        if (
            not isinstance(value, Sequence)
            or len(value) != 2
            or _number(value[0]) is None
            or _number(value[1]) is None
        ):
            return None
        corners[name] = (float(value[0]), float(value[1]))
    return corners


def _table_axis(
    context: Mapping[str, Any],
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    corners = _calibration_corners(context)
    if corners is None:
        return None
    near = (
        (corners["near_left"][0] + corners["near_right"][0]) / 2.0,
        (corners["near_left"][1] + corners["near_right"][1]) / 2.0,
    )
    far = (
        (corners["far_left"][0] + corners["far_right"][0]) / 2.0,
        (corners["far_left"][1] + corners["far_right"][1]) / 2.0,
    )
    return near, far


def _relative_axis_position(
    x: float,
    y: float,
    context: Mapping[str, Any],
) -> float | None:
    axis = _table_axis(context)
    if axis is None:
        return None
    near, far = axis
    dx, dy = far[0] - near[0], far[1] - near[1]
    denominator = dx * dx + dy * dy
    if denominator <= 1e-9:
        return None
    return ((x - near[0]) * dx + (y - near[1]) * dy) / denominator


def _normalise_detections(
    detections: Mapping[Any, Any],
    fps: float,
    context: Mapping[str, Any],
) -> list[dict[str, Any]]:
    rows = []
    for raw_frame, value in detections.items():
        try:
            frame = int(raw_frame)
        except (TypeError, ValueError):
            continue
        if isinstance(value, Mapping):
            x, y = _number(value.get("x")), _number(value.get("y"))
        elif isinstance(value, Sequence) and len(value) >= 2:
            x, y = _number(value[0]), _number(value[1])
        else:
            continue
        if x is None or y is None:
            continue
        rows.append({
            "frame": frame,
            "t": frame / fps,
            "x": x,
            "y": y,
            "axis": _relative_axis_position(x, y, context),
        })
    return sorted(rows, key=lambda row: row["frame"])


def _terminal_features(
    point: Mapping[str, Any],
    detections: Mapping[Any, Any],
    contacts: Sequence[Mapping[str, Any]],
    candidates: Sequence[Mapping[str, Any]],
    audio: Sequence[Mapping[str, Any]],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    final_contact = contacts[-1]
    final_t = float(final_contact["t"])
    final_side = final_contact.get("side")
    fps = _number(context.get("fps")) or 29.97
    track_rows = [
        row
        for row in _normalise_detections(detections, fps, context)
        if final_t + 0.03 <= float(row["t"]) <= final_t + 1.20
    ]
    axis_values = [
        float(row["axis"]) for row in track_rows if row.get("axis") is not None
    ]
    receiver_side = _other(final_side)
    crossed_net: bool | None = None
    if axis_values and final_side in {"near", "far"}:
        crossed_net = (
            max(axis_values) >= 0.55
            if receiver_side == "far"
            else min(axis_values) <= 0.45
        )
    near_net_rows = [
        row
        for row in track_rows
        if row.get("axis") is not None and 0.37 <= float(row["axis"]) <= 0.63
    ]
    near_net_reversal = False
    for index in range(2, len(track_rows) - 2):
        axis = track_rows[index].get("axis")
        before = track_rows[index - 2].get("axis")
        after = track_rows[index + 2].get("axis")
        if axis is None or before is None or after is None:
            continue
        if 0.37 <= float(axis) <= 0.63 and (
            (float(axis) - float(before)) * (float(after) - float(axis)) < 0
        ):
            near_net_reversal = True
            break
    near_net_end = bool(
        axis_values and 0.34 <= float(axis_values[-1]) <= 0.66
    )
    continued_after_net = bool(
        near_net_rows
        and track_rows
        and float(track_rows[-1]["t"]) - float(near_net_rows[0]["t"]) >= 0.16
    )
    off_table_exit = bool(
        axis_values
        and (
            float(axis_values[-1]) < -0.10
            or float(axis_values[-1]) > 1.10
        )
    )

    bounces = [
        event
        for event in candidates
        if event.get("kind") == "bounce" and float(event["t"]) > final_t + 0.04
    ]
    legal_landing = False
    for bounce in bounces:
        v = _number(bounce.get("v"))
        if v is not None:
            on_table = 0.0 <= v <= 2.74
            receiver_half = (
                v >= 1.37 if receiver_side == "far" else v <= 1.37
            )
            legal_landing = legal_landing or (on_table and receiver_half)
    later_contact = any(
        float(contact["t"]) > final_t + 0.08 for contact in contacts[:-1]
    )
    unreturned = legal_landing and not later_contact
    audio_after = [
        event
        for event in audio
        if final_t + 0.08 <= float(event["t"]) <= final_t + 0.65
        and float(event.get("confidence") or 0.0) >= 1.0
    ]
    return {
        "near_net_reversal": near_net_reversal,
        "near_net_end": near_net_end,
        "crossed_net": crossed_net,
        "legal_landing": legal_landing,
        "continued_after_net": continued_after_net,
        "off_table_exit": off_table_exit,
        "unreturned": unreturned,
        "audio_terminal_support": bool(audio_after),
        "attempted_return": False,
        "track_points_after_final_contact": len(track_rows),
    }


def build_event_timeline(
    point: Mapping[str, Any],
    blurball_detections: Mapping[Any, Any],
    audio_candidates: Iterable[Mapping[str, Any]],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    """Normalize answer-free audiovisual evidence into a rally timeline."""

    audio = _audio_rows(audio_candidates)
    candidates = _candidate_rows(point)
    used_audio = _attach_audio_support(candidates, audio)
    contacts = _contact_sequence(point, candidates, context)
    for contact in contacts:
        if contact["id"] == "serve-origin":
            nearest = min(
                audio,
                key=lambda candidate: abs(
                    float(candidate["t"]) - float(contact["t"])
                ),
                default=None,
            )
            if (
                nearest is not None
                and abs(float(nearest["t"]) - float(contact["t"])) <= 0.120
            ):
                contact["audio_supported"] = True
                contact["audio_confidence"] = nearest["confidence"]
                contact["audio_t"] = nearest["t"]
                used_audio.add(nearest["id"])
    unknown_audio = [
        dict(event) for event in audio if event["id"] not in used_audio
    ]
    visual_events = [
        {
            **dict(event),
            "role": (
                "paddle_contact"
                if event["kind"] == "contact"
                else "table_bounce"
                if event["kind"] == "bounce"
                else "visual_impact"
            ),
        }
        for event in candidates
    ]
    events = sorted(
        [*visual_events, *unknown_audio],
        key=lambda event: (
            float(event["t"]),
            0 if event["role"] != "unknown_audio" else 1,
        ),
    )
    observed_count = sum(bool(contact.get("observed")) for contact in contacts)
    inferred_count = sum(bool(contact.get("inferred")) for contact in contacts)
    return {
        "idx": int(point.get("idx") or 0),
        "events": events,
        "contacts": contacts,
        "contact_count": len(contacts),
        "observed_contact_count": observed_count,
        "inferred_contact_count": inferred_count,
        "terminal_features": _terminal_features(
            point,
            blurball_detections,
            contacts,
            candidates,
            audio,
            context,
        ),
    }


def _candidate(
    family: str,
    score: float,
    implied_winner: str | None,
    final_hitter: str | None,
    positive: list[str],
    negative: list[str],
) -> dict[str, Any]:
    return {
        "family": family,
        "score": round(score, 4),
        "implied_winner": implied_winner,
        "final_hitter": final_hitter,
        "positive_evidence": positive,
        "negative_evidence": negative,
    }


def rank_terminal_hypotheses(
    timeline: Mapping[str, Any],
    context: Mapping[str, Any],
) -> dict[str, Any]:
    """Rank physical endings, then apply the confirmed winner constraint."""

    contacts = timeline.get("contacts") or []
    if not contacts:
        raise ValueError("terminal ranking requires at least one contact")
    final = contacts[-1]
    final_hitter = final.get("player") or _side_player(
        final.get("side"), context
    )
    if final_hitter not in PLAYERS:
        raise ValueError("terminal ranking requires a mapped final hitter")
    error_winner = _other(final_hitter)
    features = dict(timeline.get("terminal_features") or {})

    def yes(name: str) -> bool:
        return features.get(name) is True

    def evidence(name: str, message: str, positive: list[str], negative: list[str]):
        (positive if yes(name) else negative).append(message)

    candidates = []

    positive: list[str] = []
    negative: list[str] = []
    net_score = 0.0
    if yes("near_net_reversal"):
        net_score += 2.2
    evidence(
        "near_net_reversal",
        "track reversed inside the net corridor",
        positive,
        negative,
    )
    if yes("near_net_end"):
        net_score += 1.3
    evidence("near_net_end", "track ended near the net", positive, negative)
    if features.get("crossed_net") is False:
        net_score += 0.7
        positive.append("track did not cross cleanly")
    elif features.get("crossed_net") is True:
        net_score -= 0.5
        negative.append("track crossed the net plane")
    if yes("audio_terminal_support"):
        net_score += 0.35
        positive.append("an audio onset supports the terminal window")
    else:
        negative.append("no audio onset supports the terminal window")
    if yes("continued_after_net"):
        net_score -= 0.45
        negative.append("motion continued after the net corridor")
    candidates.append(_candidate(
        "net_error", net_score, error_winner, final_hitter, positive, negative
    ))

    positive = []
    negative = []
    cord_score = 0.0
    if yes("near_net_reversal"):
        cord_score += 1.8
        positive.append("track changed at the net corridor")
    else:
        negative.append("no net-corridor disturbance was observed")
    if yes("crossed_net"):
        cord_score += 0.9
        positive.append("the ball continued across the net")
    else:
        negative.append("clean crossing was not observed")
    if yes("continued_after_net"):
        cord_score += 1.0
        positive.append("motion continued after the net disturbance")
    else:
        negative.append("no continued deflection was observed")
    if yes("off_table_exit"):
        cord_score += 0.8
        positive.append("the continued path exited the table")
    else:
        negative.append("no off-table exit was observed")
    if yes("audio_terminal_support"):
        cord_score += 0.25
        positive.append("an audio onset supports the terminal window")
    candidates.append(_candidate(
        "net_cord_out",
        cord_score,
        error_winner,
        final_hitter,
        positive,
        negative,
    ))

    positive = []
    negative = []
    long_score = 0.0
    if yes("crossed_net"):
        long_score += 1.7
        positive.append("track crossed the net plane")
    else:
        negative.append("net crossing was not observed")
    if yes("off_table_exit"):
        long_score += 1.4
        positive.append("track exited beyond the receiver boundary")
    else:
        negative.append("receiver-boundary exit was not observed")
    if yes("continued_after_net"):
        long_score += 0.45
        positive.append("flight continued after crossing")
    if yes("legal_landing"):
        long_score -= 1.1
        negative.append("a legal receiver-side landing was observed")
    if yes("near_net_reversal"):
        long_score -= 0.9
        negative.append("the path was disturbed at the net")
    if yes("audio_terminal_support"):
        long_score += 0.2
        positive.append("an audio onset supports the terminal window")
    candidates.append(_candidate(
        "long_error", long_score, error_winner, final_hitter, positive, negative
    ))

    positive = []
    negative = []
    winner_score = 0.0
    if yes("legal_landing"):
        winner_score += 1.8
        positive.append("a legal receiver-side landing was observed")
    else:
        negative.append("no legal receiver-side landing was observed")
    if yes("unreturned"):
        winner_score += 1.2
        positive.append("no later return was observed")
    else:
        negative.append("unreturned status was not established")
    if yes("crossed_net"):
        winner_score += 0.45
        positive.append("track crossed the net plane")
    candidates.append(_candidate(
        "clean_winner",
        winner_score,
        final_hitter,
        final_hitter,
        positive,
        negative,
    ))

    miss_score = winner_score
    miss_positive = list(positive)
    miss_negative = list(negative)
    if yes("attempted_return"):
        miss_score += 1.1
        miss_positive.append("receiver attempted a return without contact")
    else:
        miss_score -= 0.2
        miss_negative.append("no independent missed-swing evidence")
    candidates.append(_candidate(
        "complete_miss",
        miss_score,
        final_hitter,
        final_hitter,
        miss_positive,
        miss_negative,
    ))

    confirmed_winner = context.get("confirmed_winner")
    if confirmed_winner not in PLAYERS:
        raise ValueError("terminal ranking requires a confirmed_winner")
    for item in candidates:
        item["winner_consistent"] = item["implied_winner"] == confirmed_winner
        if not item["winner_consistent"]:
            item["score"] = round(float(item["score"]) - 5.0, 4)
            item["negative_evidence"].append(
                "candidate conflicts with the confirmed winner"
            )
    ordered = sorted(
        candidates,
        key=lambda item: (-float(item["score"]), item["family"]),
    )
    best = ordered[0]
    runner_up = ordered[1]
    margin = float(best["score"]) - float(runner_up["score"])
    prediction = best["family"]
    minimum = 2.0
    if (
        not best["winner_consistent"]
        or float(best["score"]) < minimum
        or margin < 0.75
    ):
        prediction = "unclear"
    elif (
        prediction in {"clean_winner", "complete_miss"}
        and not yes("attempted_return")
    ):
        prediction = "unreturned_or_missed"
    return {
        "prediction": prediction,
        "confidence_margin": round(margin, 4),
        "final_hitter": final_hitter,
        "contact_count": timeline.get("contact_count"),
        "candidates": ordered,
        "top_candidate": best,
        "runner_up": runner_up,
    }
