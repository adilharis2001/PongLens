"""Side-neutral placement reconstruction primitives.

This module deliberately separates visual/audio event extraction from rally
interpretation. Candidate events describe observations; a later solver assigns
serve, stroke, landing, and terminal roles under each possible server.
"""

from __future__ import annotations

import math
from copy import deepcopy
from typing import Any, Iterable, Mapping, Sequence

import numpy as np


TABLE_WIDTH_M = 1.525
TABLE_LENGTH_M = 2.74


def split_track_chunks(
    detections: Mapping[int, Sequence[float]],
    f0: int,
    f1: int,
    width: int,
    *,
    max_gap_frames: int = 2,
    min_points: int = 3,
) -> list[list[int]]:
    """Split a detector track at gaps and physically impossible image jumps.

    Short chunks are discarded. In particular, an isolated false detection
    between two valid runs cannot poison either neighboring trajectory.
    """

    frames = [frame for frame in range(f0, f1) if frame in detections]
    if not frames:
        return []

    jump_limit = max(48.0, width * 0.055)
    chunks: list[list[int]] = []
    current = [frames[0]]

    for frame in frames[1:]:
        previous = current[-1]
        x0, y0 = detections[previous]
        x1, y1 = detections[frame]
        gap = frame - previous
        distance = math.hypot(float(x1) - float(x0), float(y1) - float(y0))
        gap_scale = max(1.0, min(float(gap), float(max_gap_frames)))

        if gap > max_gap_frames or distance > jump_limit * gap_scale:
            if len(current) >= min_points:
                chunks.append(current)
            current = [frame]
        else:
            current.append(frame)

    if len(current) >= min_points:
        chunks.append(current)
    return chunks


def _project_if_plausible(
    H: Sequence[Sequence[float]],
    x: float,
    y: float,
) -> tuple[float | None, float | None]:
    matrix = np.asarray(H, dtype=float)
    projected = matrix @ np.array([x, y, 1.0], dtype=float)
    if abs(projected[2]) < 1e-9:
        return None, None
    u = float(projected[0] / projected[2])
    v = float(projected[1] / projected[2])
    if not (
        -0.20 <= u <= TABLE_WIDTH_M + 0.20
        and -0.30 <= v <= TABLE_LENGTH_M + 0.30
    ):
        return None, None
    return round(u, 4), round(v, 4)


def _audio_time(impact: Any) -> tuple[float, float]:
    if isinstance(impact, Mapping):
        return float(impact["t"]), float(impact.get("confidence", 1.0))
    return float(impact), 1.0


def _attach_audio(
    event: dict[str, Any],
    impacts: Sequence[tuple[float, float]],
    tolerance_s: float,
) -> int | None:
    if not impacts:
        event["audio_confidence"] = 0.0
        return None
    nearest_index = min(
        range(len(impacts)),
        key=lambda index: abs(impacts[index][0] - event["t"]),
    )
    audio_t, confidence = impacts[nearest_index]
    delta = abs(audio_t - event["t"])
    if delta > tolerance_s:
        event["audio_confidence"] = 0.0
        return None
    proximity = 1.0 - delta / tolerance_s
    event["audio_confidence"] = round(confidence * proximity, 4)
    event["audio_t"] = round(audio_t, 4)
    return nearest_index


def extract_candidates(
    detections: Mapping[int, Sequence[float]],
    H: Sequence[Sequence[float]],
    e: Sequence[float],
    f0: int,
    f1: int,
    fps: float,
    width: int,
    audio_impacts: Iterable[Any] | None = None,
) -> list[dict[str, Any]]:
    """Extract observations without assuming who served or who struck.

    Image-y maxima produce bounce candidates. Reversals along the calibrated
    table axis produce contact candidates. Audio can strengthen either event
    but never decides the surface or player on its own.
    """

    if fps <= 0:
        raise ValueError("fps must be positive")

    axis_length = math.hypot(float(e[0]), float(e[1]))
    if axis_length < 1e-9:
        raise ValueError("table axis must be non-zero")
    ex, ey = float(e[0]) / axis_length, float(e[1]) / axis_length

    impacts = sorted(
        (_audio_time(impact) for impact in (audio_impacts or [])),
        key=lambda item: item[0],
    )
    candidates: list[dict[str, Any]] = []
    contact_leg_min = max(6.0, width * 0.006)

    for chunk in split_track_chunks(detections, f0, f1, width):
        coordinates = [
            (float(detections[frame][0]), float(detections[frame][1]))
            for frame in chunk
        ]
        axis_positions = [x * ex + y * ey for x, y in coordinates]

        for index in range(2, len(chunk) - 2):
            frame = chunk[index]
            x, y = coordinates[index]
            u, v = _project_if_plausible(H, x, y)

            y_window = [coordinates[offset][1] for offset in range(index - 2, index + 3)]
            rise = y_window[2] - y_window[0]
            fall = y_window[2] - y_window[4]
            if (
                y_window[2] >= y_window[1]
                and y_window[2] >= y_window[3]
                and rise >= 3.0
                and fall >= 3.0
            ):
                strength = min(1.0, (rise + fall) / 16.0)
                candidates.append(
                    {
                        "kind": "bounce",
                        "frame": frame,
                        "t": round(frame / fps, 4),
                        "x": round(x, 2),
                        "y": round(y, 2),
                        "u": u,
                        "v": v,
                        "visual_confidence": round(0.45 + 0.45 * strength, 4),
                    }
                )

            before = axis_positions[index] - axis_positions[index - 2]
            after = axis_positions[index + 2] - axis_positions[index]
            if (
                before * after < 0
                and abs(before) >= contact_leg_min
                and abs(after) >= contact_leg_min
            ):
                strength = min(
                    1.0,
                    (abs(before) + abs(after)) / (contact_leg_min * 6.0),
                )
                candidates.append(
                    {
                        "kind": "contact",
                        "frame": frame,
                        "t": round(frame / fps, 4),
                        "x": round(x, 2),
                        "y": round(y, 2),
                        "u": None,
                        "v": None,
                        "side": "near" if after > 0 else "far",
                        "visual_confidence": round(0.45 + 0.45 * strength, 4),
                        "direction_before": round(before, 3),
                        "direction_after": round(after, 3),
                    }
                )

    candidates.sort(key=lambda event: (event["t"], event["kind"]))

    used_audio: set[int] = set()
    for event in candidates:
        match = _attach_audio(event, impacts, tolerance_s=0.09)
        if match is not None:
            used_audio.add(match)

    for index, (audio_t, confidence) in enumerate(impacts):
        if index in used_audio:
            continue
        candidates.append(
            {
                "kind": "impact",
                "frame": None,
                "t": round(audio_t, 4),
                "x": None,
                "y": None,
                "u": None,
                "v": None,
                "visual_confidence": 0.0,
                "audio_confidence": round(confidence, 4),
                "audio_t": round(audio_t, 4),
            }
        )

    candidates.sort(key=lambda event: (event["t"], event["kind"]))
    for index, event in enumerate(candidates):
        event["id"] = f"candidate-{index + 1}"
    return candidates


def _other_side(side: str) -> str:
    return "far" if side == "near" else "near"


def _candidate_kind(candidate: Mapping[str, Any]) -> str:
    if candidate.get("kind"):
        return str(candidate["kind"])
    kinds = candidate.get("kinds") or []
    aliases = {
        "table_bounce": "bounce",
        "paddle_contact": "contact",
        "audio_impact": "impact",
    }
    return aliases.get(str(kinds[0]), str(kinds[0])) if kinds else "unknown"


def _table_half(candidate: Mapping[str, Any]) -> str | None:
    v = candidate.get("v")
    if v is None:
        return None
    return "near" if float(v) < TABLE_LENGTH_M / 2.0 else "far"


def _event_reference(candidate: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: candidate.get(key)
        for key in ("id", "t", "u", "v", "x", "y")
        if candidate.get(key) is not None
    } | {"event_id": candidate.get("id")}


def _seed_state(server_side: str) -> dict[str, Any]:
    if server_side not in {"near", "far"}:
        raise ValueError("server_side must be 'near' or 'far'")
    return {
        "server_side": server_side,
        "expected_hitter": _other_side(server_side),
        "serve_bounces": [],
        "shots": [],
        "open_shot": None,
        "score": 0.0,
        "reasons": [],
        "hard_reasons": [],
        "used_event_ids": [],
    }


def _record_reason(
    state: dict[str, Any],
    reason: str,
    *,
    hard: bool = False,
) -> None:
    if reason not in state["reasons"]:
        state["reasons"].append(reason)
    if hard and reason not in state["hard_reasons"]:
        state["hard_reasons"].append(reason)


def _new_shot(
    phase: str,
    hitter_side: str,
    *,
    contact: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "phase": phase,
        "hitter_side": hitter_side,
        "contact": _event_reference(contact) if contact else None,
        "serve_first_bounce": None,
        "landing": None,
        "terminal": None,
        "confidence": 0.0,
    }


def _start_rally_shot(
    state: dict[str, Any],
    candidate: Mapping[str, Any],
    side: str,
    *,
    inferred_from_audio: bool = False,
) -> None:
    state["open_shot"] = _new_shot("rally", side, contact=candidate)
    state["expected_hitter"] = side
    state["used_event_ids"].append(candidate.get("id"))
    state["score"] += 0.9 if inferred_from_audio else 1.7
    if inferred_from_audio:
        _record_reason(state, "contact_inferred_from_audio")


def _advance_state(
    state: Mapping[str, Any],
    candidate: Mapping[str, Any],
    suggestion: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return legal/diagnostic transitions for one observation.

    The input is never mutated. Invalid serve transitions are retained with a
    hard reason so the rejected physical-server hypothesis remains explainable.
    """

    kind = _candidate_kind(candidate)
    advanced: list[dict[str, Any]] = []

    if kind == "bounce":
        if len(state["serve_bounces"]) < 2:
            next_state = deepcopy(state)
            bounce_index = len(next_state["serve_bounces"])
            expected_half = (
                next_state["server_side"]
                if bounce_index == 0
                else _other_side(next_state["server_side"])
            )
            actual_half = _table_half(candidate)
            next_state["serve_bounces"].append(_event_reference(candidate))
            next_state["used_event_ids"].append(candidate.get("id"))
            if actual_half == expected_half:
                next_state["score"] += 2.0
            else:
                reason = (
                    "serve_first_bounce_on_receiver_half"
                    if bounce_index == 0
                    else "serve_second_bounce_on_server_half"
                )
                _record_reason(next_state, reason, hard=True)
                next_state["score"] -= 0.7

            if len(next_state["serve_bounces"]) == 2:
                serve = _new_shot("serve", next_state["server_side"])
                serve["serve_first_bounce"] = next_state["serve_bounces"][0]
                serve["landing"] = next_state["serve_bounces"][1]
                serve["confidence"] = 0.9 if not next_state["hard_reasons"] else 0.25
                next_state["shots"].append(serve)
                next_state["expected_hitter"] = _other_side(
                    next_state["server_side"]
                )
            advanced.append(next_state)
            return advanced

        next_state = deepcopy(state)
        open_shot = next_state.get("open_shot")
        if open_shot is None:
            hitter = next_state["expected_hitter"]
            open_shot = _new_shot("rally", hitter)
            _record_reason(next_state, "contact_missing_before_landing")
            next_state["score"] -= 0.25

        expected_half = _other_side(open_shot["hitter_side"])
        actual_half = _table_half(candidate)
        open_shot["landing"] = _event_reference(candidate)
        if actual_half == expected_half:
            next_state["score"] += 1.7
            open_shot["confidence"] = 0.82 if open_shot["contact"] else 0.55
        else:
            _record_reason(next_state, "landing_on_hitter_half", hard=True)
            next_state["score"] -= 1.2
            open_shot["confidence"] = 0.2
        next_state["shots"].append(open_shot)
        next_state["open_shot"] = None
        next_state["expected_hitter"] = expected_half
        next_state["used_event_ids"].append(candidate.get("id"))
        advanced.append(next_state)
        return advanced

    if kind in {"contact", "impact"}:
        if len(state["serve_bounces"]) < 2:
            return []
        next_state = deepcopy(state)
        side = candidate.get("side") or next_state["expected_hitter"]
        inferred_from_audio = kind == "impact"
        open_shot = next_state.get("open_shot")

        if open_shot is not None:
            if side != _other_side(open_shot["hitter_side"]):
                _record_reason(next_state, "non_alternating_contacts", hard=True)
                next_state["score"] -= 1.2
            else:
                _record_reason(next_state, "landing_missing_before_contact")
                next_state["score"] -= 0.45
            open_shot["confidence"] = 0.35
            next_state["shots"].append(open_shot)
            next_state["open_shot"] = None

        if side != next_state["expected_hitter"]:
            _record_reason(next_state, "unexpected_hitter", hard=True)
            next_state["score"] -= 0.8
        _start_rally_shot(
            next_state,
            candidate,
            side,
            inferred_from_audio=inferred_from_audio,
        )
        advanced.append(next_state)
        return advanced

    if kind in {"out", "net"}:
        if len(state["serve_bounces"]) < 2 or state.get("open_shot") is None:
            return []
        next_state = deepcopy(state)
        open_shot = next_state["open_shot"]
        open_shot["terminal"] = {
            "kind": kind,
            **_event_reference(candidate),
        }
        open_shot["confidence"] = 0.82
        next_state["shots"].append(open_shot)
        next_state["open_shot"] = None
        next_state["used_event_ids"].append(candidate.get("id"))
        next_state["score"] += 1.5
        advanced.append(next_state)
        return advanced

    return []


def _state_signature(state: Mapping[str, Any]) -> tuple[Any, ...]:
    shot_signature = tuple(
        (
            shot["hitter_side"],
            (shot.get("contact") or {}).get("event_id"),
            (shot.get("landing") or {}).get("event_id"),
            (shot.get("terminal") or {}).get("event_id"),
        )
        for shot in state["shots"]
    )
    open_shot = state.get("open_shot") or {}
    return (
        tuple(bounce.get("event_id") for bounce in state["serve_bounces"]),
        shot_signature,
        open_shot.get("hitter_side"),
        (open_shot.get("contact") or {}).get("event_id"),
        tuple(state["hard_reasons"]),
    )


def _dedupe_states(states: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[tuple[Any, ...], dict[str, Any]] = {}
    for state in states:
        signature = _state_signature(state)
        if signature not in best or state["score"] > best[signature]["score"]:
            best[signature] = state
    return list(best.values())


def _suggested_terminal_kind(
    suggestion: Mapping[str, Any] | None,
) -> str | None:
    how = (suggestion or {}).get("how")
    if how == "hit into net":
        return "net"
    if how == "missed table (long/wide)":
        return "out"
    return None


def _finish_hypothesis(
    state: Mapping[str, Any],
    candidates: Sequence[Mapping[str, Any]],
    suggestion: Mapping[str, Any] | None,
    track_segments: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    finished = deepcopy(state)
    if len(finished["serve_bounces"]) < 2:
        _record_reason(finished, "serve_incomplete", hard=True)
        finished["score"] -= 4.0

    if finished.get("open_shot") is not None:
        open_shot = finished["open_shot"]
        terminal_kind = _suggested_terminal_kind(suggestion)
        if terminal_kind:
            open_shot["terminal"] = {
                "kind": terminal_kind,
                "event_id": None,
                "inferred": True,
            }
            open_shot["confidence"] = 0.55
            _record_reason(finished, "terminal_inferred_from_suggestion")
            finished["score"] += 0.3
        else:
            open_shot["confidence"] = 0.35
            _record_reason(finished, "terminal_observation_missing")
            finished["score"] -= 0.3
        finished["shots"].append(open_shot)
        finished["open_shot"] = None

    for index, shot in enumerate(finished["shots"]):
        shot["id"] = f"shot-{index + 1}"

    confidence = 1.0 / (1.0 + math.exp(-finished["score"] / 4.0))
    if confidence >= 0.72 and not finished["hard_reasons"]:
        status = "ready"
    elif confidence >= 0.42:
        status = "review"
    else:
        status = "unavailable"

    return {
        "serverSide": finished["server_side"],
        "server_side": finished["server_side"],
        "status": status,
        "confidence": round(confidence, 4),
        "score": round(finished["score"], 3),
        "reasons": finished["reasons"],
        "hard_reasons": finished["hard_reasons"],
        "shots": finished["shots"],
        "used_event_ids": [
            event_id
            for event_id in finished["used_event_ids"]
            if event_id is not None
        ],
    }


def solve_hypothesis(
    candidates: Sequence[Mapping[str, Any]],
    server_side: str,
    suggestion: Mapping[str, Any] | None,
    track_segments: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Solve one physical-server interpretation with a bounded monotonic beam."""

    ordered = sorted(candidates, key=lambda candidate: float(candidate["t"]))
    beam = [_seed_state(server_side)]
    for candidate in ordered:
        advanced: list[dict[str, Any]] = []
        for state in beam:
            skipped = deepcopy(state)
            skipped["score"] -= (
                1.2 if len(skipped["serve_bounces"]) < 2 else 0.25
            )
            advanced.append(skipped)
            advanced.extend(_advance_state(state, candidate, suggestion))
        beam = sorted(
            _dedupe_states(advanced),
            key=lambda item: item["score"],
            reverse=True,
        )[:24]

    finished = [
        _finish_hypothesis(state, ordered, suggestion, track_segments)
        for state in beam
    ]
    return max(finished, key=lambda item: item["score"])


def reconstruct_placement(
    det: Mapping[int, Sequence[float]],
    H: Sequence[Sequence[float]],
    e: Sequence[float],
    track: Mapping[str, Any],
    suggestion: Mapping[str, Any] | None,
    f0: int,
    f1: int,
    fps: float,
    width: int,
    audio_impacts: Iterable[Any] | None = None,
) -> dict[str, Any]:
    candidates = extract_candidates(
        det,
        H,
        e,
        f0,
        f1,
        fps,
        width,
        audio_impacts or [],
    )
    hypotheses = {
        side: solve_hypothesis(
            candidates,
            side,
            suggestion,
            track.get("segments", []),
        )
        for side in ("near", "far")
    }
    statuses = {hypothesis["status"] for hypothesis in hypotheses.values()}
    status = (
        "ready"
        if "ready" in statuses
        else "review"
        if "review" in statuses
        else "unavailable"
    )
    return {
        "v": 3,
        "status": status,
        "candidates": candidates,
        "hypotheses": hypotheses,
    }
