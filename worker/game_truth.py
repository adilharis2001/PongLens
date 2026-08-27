"""Ground truth for game boundaries, read out of the owner's own scoring.

The old harness trusted a match only when EVERY non-let point in it had a
confirmed winner. That is a match-level gate on a point-level fact, and it
threw away the majority of the evidence: a player scores the first two
games carefully and gets bored, and the two proven boundaries inside that
match go with the rest. This module works per GAME instead.

Three tiers, and they are not interchangeable:

  proven  — the game reached 11 with a clear two, and every non-let point
            inside it carries a confirmed winner. The boundary is a fact.
  pinned  — the owner pressed the positional game_end_override='end'
            control, which by design marks the video's visible side
            switch (migration 021). Also a fact, and the only truth
            available once scoring goes quiet.
  none    — everything else. Not truth, and not a false positive either:
            a detector firing here is unverified, not wrong.

Deleted points are carried alongside rather than dropped. Adil deletes
cards on the scorekeeper when players take time between games, so the
deleted rows sitting inside a gap are evidence ABOUT the gap. They never
define a boundary by themselves — deletion also removes ordinary junk —
but a boundary's gap is measured to the next VISIBLE point, which is what
a viewer sees and what the detector has to reach across.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

GAME_TARGET, CLEAR_BY = 11, 2


def _game_over(you: int, them: int) -> bool:
    return max(you, them) >= GAME_TARGET and abs(you - them) >= CLEAR_BY


def walk_games(points: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Split live points into games, tagging how trustworthy each close is.

    Scoring drifts out of sync the moment a non-let point has no winner:
    the running count is then missing a rally and can reach 11 a point
    early or late, so from that moment on an automatic close is a guess.
    `dirty` latches that, and only an explicit pin clears it — the pin
    re-anchors the score at 0-0 by the owner's own hand.
    """
    games: list[dict[str, Any]] = []
    current: list[Mapping[str, Any]] = []
    you = them = 0
    dirty = False
    open_hold = False
    for point in points:
        current.append(point)
        is_let = bool(point.get("is_let"))
        winner = None if is_let else point.get("confirmed_winner")
        if not is_let:
            if winner == "user":
                you += 1
            elif winner == "opponent":
                them += 1
            else:
                dirty = True
        override = point.get("game_end_override")
        if override == "continue":
            open_hold = True
            continue
        if override == "end":
            games.append(
                {"points": current, "tier": "pinned",
                 "score": [you, them], "closing": point}
            )
            current, you, them, dirty, open_hold = [], 0, 0, False, False
            continue
        if open_hold or dirty or winner is None:
            continue
        if _game_over(you, them):
            games.append(
                {"points": current, "tier": "proven",
                 "score": [you, them], "closing": point}
            )
            current, you, them, dirty, open_hold = [], 0, 0, False, False
    if current:
        games.append(
            {"points": current, "tier": "open", "score": [you, them],
             "closing": None}
        )
    return games


def boundaries(
    live: Sequence[Mapping[str, Any]],
    deleted: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Per-game boundaries with their gaps and what sits inside them.

    live/deleted rows need id, idx, t0, t1, is_let, confirmed_winner,
    game_end_override. Both lists must already be in time order.

    The last game's close is deliberately not a boundary: there is no
    following point, so there is no after-configuration to observe and no
    side-change detector can see it even in principle.
    """
    games = walk_games(live)
    by_time = list(live)
    out = []
    for position, game in enumerate(games):
        if game["tier"] not in ("proven", "pinned"):
            continue
        close = game["closing"]
        if close is None or close.get("t1") is None:
            continue
        gap_t0 = float(close["t1"])
        nxt = next(
            (p for p in by_time
             if p.get("t0") is not None and float(p["t0"]) > gap_t0),
            None,
        )
        if nxt is None:
            continue  # final game: nothing after it to compare against
        gap_t1 = float(nxt["t0"])
        inside = [
            d for d in deleted
            if d.get("t0") is not None
            and gap_t0 <= float(d["t0"]) <= gap_t1
        ]
        out.append(
            {
                "game_index": position,
                "tier": game["tier"],
                "score": game["score"],
                "point_id": str(close["id"]),
                "idx": int(close["idx"]),
                "next_idx": int(nxt["idx"]),
                "gap_t0": gap_t0,
                "gap_t1": gap_t1,
                "gap_s": round(gap_t1 - gap_t0, 2),
                "deleted_inside": len(inside),
                "deleted_idx": [int(d["idx"]) for d in inside],
            }
        )
    proven_games = sum(1 for g in games if g["tier"] == "proven")
    return {
        "games": len(games),
        "proven_games": proven_games,
        "pinned_games": sum(1 for g in games if g["tier"] == "pinned"),
        "boundaries": out,
        # A match is "clean" when the walk never went dirty before the last
        # game: every boundary in it is provable and a fire between them is
        # chargeable as a false positive.
        "fully_scored": bool(games) and all(
            g["tier"] in ("proven", "pinned") for g in games[:-1]
        ) and proven_games > 0,
    }
