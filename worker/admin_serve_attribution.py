#!/usr/bin/env python3
"""Build an admin-only server attribution artifact.

This module is deliberately outside the match worker.  It rewrites only the
server half displayed by the admin upload inspector and preserves V3's
original answer beside it.  It never writes points, scores, clips, or the
production serve rotation.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any


SIDE_VALUES = ("near", "far")
TABLE_LENGTH_M = 2.74


def pair_server_half(
    card: dict[str, Any],
    *,
    arrival_tolerance_s: float = 1.0,
    bounce_tolerance_s: float = 0.10,
) -> str | None:
    """Return the server end when V3 saw both bounces of this serve.

    `serve_bounces` is strong only when its first bounce belongs to the same
    flight as `serve_arrival_s`.  The matching bounce's table coordinate is
    measured from the near end, so the near/far boundary is half a table.
    """
    pair = card.get("serve_bounces")
    arrival = card.get("serve_arrival_s")
    if not pair or len(pair) < 2 or arrival is None:
        return None
    try:
        first_t = float(pair[0])
        arrival_t = float(arrival)
    except (TypeError, ValueError):
        return None
    if abs(first_t - arrival_t) > arrival_tolerance_s:
        return None

    candidates = []
    for bounce in card.get("bounces") or []:
        try:
            candidates.append((abs(float(bounce["t"]) - first_t), bounce))
        except (KeyError, TypeError, ValueError):
            continue
    if not candidates:
        return None
    delta, bounce = min(candidates, key=lambda item: item[0])
    if delta > bounce_tolerance_s or bounce.get("onSurface") is False:
        return None
    try:
        table_v = float(bounce["v"])
    except (KeyError, TypeError, ValueError):
        return None
    return "near" if table_v < TABLE_LENGTH_M / 2.0 else "far"


def enrich_card(card: dict[str, Any], held_half: str | None) -> dict[str, Any]:
    """Attach the admin answer without losing the original V3 answer."""
    out = copy.deepcopy(card)
    original = card.get("serve_half")
    original = original if original in SIDE_VALUES else None
    held_half = held_half if held_half in SIDE_VALUES else None
    pair_half = pair_server_half(card)

    if pair_half:
        selected, source, confidence = pair_half, "bounce_pair", "high"
    elif held_half:
        selected, source, confidence = held_half, "held_ball", "high"
    elif original:
        selected, source, confidence = original, "visible_bounce", "low"
    else:
        selected = source = confidence = None

    out["serve_half_v3"] = original
    out["serve_half"] = selected
    out["serve_half_source"] = source
    out["serve_half_confidence"] = confidence
    return out


def held_ball_sides(
    match: dict[str, Any],
    serves: dict[str, Any],
    tracks: dict[str, Any],
    players: dict[str, Any],
) -> list[str | None]:
    """Read which player's box held or tossed the ball before each serve."""
    import body_features
    from serve_v3 import adapters, servedwell

    source = match["source"]
    fps = float(source["fps"])
    width = float(source["width"])
    height = float(source["height"])
    corners = match["calibration"]["table_corners_px"]
    _, overlay, _ = adapters.people_inputs(players, corners, fps)

    servedwell.FPS = fps
    servedwell.OVERLAY = overlay
    servedwell.CROP_OX = float(overlay["crop"][0])
    servedwell.CROP_OY = float(overlay["crop"][1])
    people = servedwell.People()
    table_width = body_features.table_width_px(corners)

    serve_cards = serves.get("cards") or []
    track_cards = tracks.get("cards") or []
    if len(serve_cards) != len(track_cards):
        raise ValueError(
            f"serve and track artifacts disagree: {len(serve_cards)} cards vs "
            f"{len(track_cards)}"
        )

    answers: list[str | None] = []
    for serve_card, track_card in zip(serve_cards, track_cards):
        contact = serve_card.get("serve_s")
        if contact is None:
            answers.append(None)
            continue
        track = {
            int(round(float(row[0]) * fps)): (float(row[1]) * width, float(row[2]) * height)
            for row in (track_card.get("track") or [])
            if len(row) >= 3
        }
        side, _runs = servedwell.serving_end(
            track,
            people,
            float(contact),
            min_run_s=0.3,
            min_ratio=4.0,
            max_speed_w=2.0,
            tw=table_width,
        )
        answers.append(side)
    return answers


def enrich_document(
    match: dict[str, Any],
    serves: dict[str, Any],
    tracks: dict[str, Any],
    players: dict[str, Any],
) -> dict[str, Any]:
    sides = held_ball_sides(match, serves, tracks, players)
    out = copy.deepcopy(serves)
    out["cards"] = [
        enrich_card(card, held_half)
        for card, held_half in zip(serves.get("cards") or [], sides)
    ]
    out["admin_server_attribution"] = {
        "version": 1,
        "admin_only": True,
        "method": "bounce_pair_then_held_ball_then_visible_bounce",
    }
    return out


def _load(path: str) -> dict[str, Any]:
    with open(path) as handle:
        return json.load(handle)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--match-json", required=True)
    parser.add_argument("--serves", required=True)
    parser.add_argument("--tracks", required=True)
    parser.add_argument("--players", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    enriched = enrich_document(
        _load(args.match_json),
        _load(args.serves),
        _load(args.tracks),
        _load(args.players),
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w") as handle:
        json.dump(enriched, handle, separators=(",", ":"))
        handle.write("\n")


if __name__ == "__main__":
    main()
