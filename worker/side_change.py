"""Pure side-change (game-boundary candidate) detection logic.

Downstream of point detection, and deliberately blind to it: this module
never decides whether a point exists or where it starts or ends. It reads
per-point player appearance evidence and answers one question — did the
two players persistently swap table ends between two consecutive points?

Why adjacent pairs, not a global anchor. The retired v1 logic
(match_structure.assign_anonymous_players) anchored appearance prototypes
on the first usable point and classified every later point against them,
so gradual lighting or white-balance drift accumulated into the exact
signal being measured. A swap is a LOCAL event: comparing each point only
to its neighbour keeps the two frames minutes apart at most, and a
one-sided clothing change (a jacket coming off at the break) degrades the
margin instead of inverting the verdict.

Why sampling inside points is the occlusion guard. Signatures come from
frames sampled during play, when each player is at their own end. A player
wandering around the table mid-gap to retrieve a ball never enters the
evidence at all, so "walked around the table" cannot fire this detector —
only "played the next point from the other end" can.

This module owns no model, media, database, or command-line I/O, mirroring
match_structure.py: the extractor adapter and the unit tests exercise the
same frozen gates.
"""

from __future__ import annotations

import json
import math
from typing import Any, Mapping, Sequence

ALGORITHM_VERSION = "side-change-v2"
EVIDENCE_VERSION = 2

# Default thresholds. The worker may override any of these from
# app_config.game_end_detection_config (JSON) so tuning is one UPDATE, but
# the defaults are the measured operating point, not placeholders.
DEFAULT_CONFIG = {
    # A pair verdict needs the cheaper configuration to win by this much
    # (summed Euclidean distance over two normalized-BGR signatures).
    "margin_threshold": 0.08,
    # Signature spread across one point's sampled frames must stay under
    # this for the point to qualify — the doubles/occlusion guard. Two
    # different shirts alternating at one end cannot hold a tight spread.
    "spread_max": 0.16,
    # Consecutive qualified SAME pairs required before and after the flip.
    "pre_stable_pairs": 2,
    "post_stable_pairs": 2,
    # More swapped verdicts than this in one match means the appearance
    # signal itself is unstable; withhold everything rather than pick.
    "max_flips": 6,
    # How many points a pair may reach across. A changeover is not one
    # clean gap: players fetch the ball, drink, towel off, and the cutter
    # turns that into one to three junk cards sitting between the last
    # rally of a game and the first of the next. Measured 2026-08-26
    # against Adil's own frame-by-frame verdicts: of 11 candidates the
    # strict-adjacency rule threw away, 8 were real changeovers and every
    # one of them had exactly one point in between. Reaching three covers
    # the longer transitions the same footage produces.
    "bridge_max": 3,
    # Longest burst of consecutive disagreeing pairs still read as one
    # changeover rather than as noise. A real transition is the players
    # walking round the table, two or three cards' worth.
    "max_transition_pairs": 4,
    # Gap length only shapes confidence (recordings paused between games
    # produce real boundaries with near-zero gaps — measured 2026-08-26:
    # p25 of true boundary gaps is 6.7s and the minimum is 0.0s).
    "confident_gap_s": 8.0,
    # Below this confidence a change is recorded as diagnostic only and
    # must not be surfaced. Components are stored so the floor can move.
    "min_confidence": 0.55,
}


def merge_config(overrides: Mapping[str, Any] | None) -> dict[str, Any]:
    """DEFAULT_CONFIG with numeric overrides applied, junk ignored."""
    config = dict(DEFAULT_CONFIG)
    if isinstance(overrides, Mapping):
        for key, value in overrides.items():
            if key not in DEFAULT_CONFIG:
                continue
            if isinstance(value, bool) or not isinstance(
                value, (int, float)
            ):
                continue
            if not math.isfinite(float(value)) or float(value) < 0:
                continue
            config[key] = float(value)
    return config


def _distance(a: Sequence[float], b: Sequence[float]) -> float:
    return math.sqrt(
        sum((float(x) - float(y)) ** 2 for x, y in zip(a, b))
    )


def signature_spread(samples: Sequence[Sequence[float]]) -> float | None:
    """Largest pairwise distance among one point-side's frame signatures."""
    if len(samples) < 2:
        return None
    worst = 0.0
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            worst = max(worst, _distance(samples[i], samples[j]))
    return round(worst, 4)


def _channel_median(samples: Sequence[Sequence[float]]) -> list[float]:
    return [
        sorted(sample[channel] for sample in samples)[len(samples) // 2]
        for channel in range(3)
    ]


def summarize_point_side(
    samples: Sequence[Sequence[float]],
    spread_max: float,
) -> dict[str, Any] | None:
    """Median signature + qualification for one side of one point.

    None when there is nothing usable at all; a dict with ok=False when
    the samples disagree with each other (occlusion, a bystander in the
    region, or a second player of a doubles pair).

    Qualification uses a TRIMMED spread: with four or more samples, the
    two farthest from the median are dropped before measuring agreement.
    A player turning their torso or briefly walking out of the region
    produces one or two outlier frames on real singles footage (measured
    2026-08-26: raw near-side spread median 0.187 against a 0.16 gate,
    which disqualified 60% of an ordinary match). With only two or three
    samples nothing is dropped, so a sparsely-seen side still has to
    agree with itself outright.
    """
    usable = [
        [float(v) for v in sample]
        for sample in samples
        if sample is not None and len(sample) == 3
    ]
    if not usable:
        return None
    center = _channel_median(usable)
    ranked = sorted(usable, key=lambda sample: _distance(sample, center))
    kept = ranked if len(ranked) <= 3 else ranked[: max(3, len(ranked) - 2)]
    medians = _channel_median(kept)
    raw_spread = signature_spread(usable) if len(usable) > 1 else 0.0
    spread = signature_spread(kept) if len(kept) > 1 else 0.0
    ok = len(kept) >= 2 and (spread is None or spread <= spread_max)
    return {
        "sig": [round(v, 4) for v in medians],
        "frames": len(kept),
        "frames_raw": len(usable),
        "spread": spread,
        "spread_raw": raw_spread,
        "samples": [[round(float(v), 4) for v in s] for s in usable],
        "ok": ok,
    }


def pair_verdict(
    a: Mapping[str, Any],
    b: Mapping[str, Any],
    margin_threshold: float,
) -> dict[str, Any]:
    """Compare two consecutive qualified points.

    same_cost pairs near-with-near and far-with-far; swap_cost pairs them
    across. The verdict is whichever wins by margin_threshold, else
    'uncertain'. Both points must already be qualified on both sides.
    """
    same_cost = (
        _distance(a["near"]["sig"], b["near"]["sig"])
        + _distance(a["far"]["sig"], b["far"]["sig"])
    )
    swap_cost = (
        _distance(a["near"]["sig"], b["far"]["sig"])
        + _distance(a["far"]["sig"], b["near"]["sig"])
    )
    margin = swap_cost - same_cost
    if margin >= margin_threshold:
        verdict = "same"
    elif margin <= -margin_threshold:
        verdict = "swapped"
    else:
        verdict = "uncertain"
    return {
        "verdict": verdict,
        "margin": round(abs(margin), 4),
        "same_cost": round(same_cost, 4),
        "swap_cost": round(swap_cost, 4),
    }


def point_qualified(point: Mapping[str, Any]) -> bool:
    near = point.get("near")
    far = point.get("far")
    return bool(near and far and near.get("ok") and far.get("ok"))


def build_pairs(
    points: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Pair verdicts over consecutive qualified points.

    A pair may reach across up to bridge_max unqualified points — without
    this, ordinary qualification holes starve the stability runs
    (measured 2026-08-26: 34 pairs from 105 gaps on a healthy match).

    Bridged pairs may mint a boundary, and this is the whole point. An
    earlier version required the flip pair to be strictly adjacent, on
    the reasoning that a flip spanning a bridge cannot say which of the
    bridged gaps it happened in. True, and it does not matter: the
    bridged cards ARE the changeover — a player walking round the table
    for the ball or a drink, cut into a card that never had two players
    at two ends. The game ended before them, so the boundary belongs
    after the last qualified point, which is exactly where a bridged
    pair puts it. Requiring adjacency discarded 8 of the 11 real
    changeovers this detector found.

    `bridged` rides on every pair so a reviewer can see how far a
    verdict reached, and so the cost of widening it stays measurable.
    """
    bridge_max = int(config.get("bridge_max", 1))
    qualified = [
        (position, point)
        for position, point in enumerate(points)
        if point_qualified(point)
    ]
    pairs = []
    for (pos_a, a), (pos_b, b) in zip(qualified, qualified[1:]):
        skipped = pos_b - pos_a - 1
        if skipped > bridge_max:
            continue
        entry = {
            "a_idx": int(a["idx"]),
            "b_idx": int(b["idx"]),
            "adjacent": skipped == 0,
            "bridged": skipped,
            "gap_s": (
                round(float(b["t0"]) - float(a["t1"]), 2)
                if a.get("t1") is not None and b.get("t0") is not None
                else None
            ),
            **pair_verdict(a, b, float(config["margin_threshold"])),
        }
        pairs.append(entry)
    return pairs


def _stable_run(
    pairs: Sequence[Mapping[str, Any]],
    start: int,
    step: int,
) -> int:
    """Consecutive 'same' verdicts walking from start in step direction."""
    count = 0
    index = start
    while 0 <= index < len(pairs) and pairs[index]["verdict"] == "same":
        count += 1
        index += step
    return count


def _confidence(
    pair: Mapping[str, Any],
    pre_run: int,
    post_run: int,
    config: Mapping[str, Any],
) -> tuple[float, dict[str, Any]]:
    """Explainable confidence from named components, min-combined.

    Each component is 0..1. The overall score is dominated by the weakest
    link — a huge margin cannot buy back a missing confirmation — with the
    gap-length component only ever adding a small bonus, never subtracting
    (paused recordings produce real boundaries with no gap at all).
    """
    margin_score = min(
        1.0, pair["margin"] / (2.0 * float(config["margin_threshold"]))
    )
    pre_score = min(1.0, pre_run / float(config["pre_stable_pairs"]))
    post_score = min(1.0, post_run / float(config["post_stable_pairs"]))
    base = min(margin_score, pre_score, post_score)
    gap_s = pair.get("gap_s")
    gap_bonus = (
        0.1
        if gap_s is not None and gap_s >= float(config["confident_gap_s"])
        else 0.0
    )
    score = round(min(1.0, 0.9 * base + gap_bonus), 3)
    components = {
        "margin_score": round(margin_score, 3),
        "pre_stable_pairs": pre_run,
        "post_stable_pairs": post_run,
        "gap_s": gap_s,
        "gap_bonus": gap_bonus,
    }
    return score, components


MAX_ALIGNMENT_DRIFT_S = 1.0


def assert_aligned(
    evidence: Mapping[str, Any],
    points_by_idx: Mapping[int, Mapping[str, Any]],
    max_drift_s: float = MAX_ALIGNMENT_DRIFT_S,
) -> None:
    """Refuse evidence that describes a DIFFERENT cut of this match.

    The detector reads match.json out of R2; the app reads the points
    table. Both key on idx, and NOTHING otherwise ties them together —
    so when a match is reprocessed and match.json goes stale, idx 73 in
    the evidence and idx 73 in the database are unrelated rallies. That
    is not a subtle error: on 2026-08-26 it put every marker on the
    wrong point of a 127-point match whose match.json still described a
    106-point cut, 198 seconds adrift, and it looked like a detector
    accuracy problem rather than a data one.

    A point count that differs is FINE and expected — the owner deletes
    junk cards, and those rows simply are not in points_by_idx. What is
    never fine is a shared idx whose start time disagrees.
    """
    checked = 0
    for point in evidence.get("points") or []:
        stored = points_by_idx.get(int(point["idx"]))
        if not stored or point.get("t0") is None:
            continue
        drift = abs(float(point["t0"]) - float(stored["t0"]))
        if drift > max_drift_s:
            raise ValueError(
                f"evidence is not aligned with the stored points: idx "
                f"{point['idx']} is at {float(point['t0']):.1f}s in the "
                f"evidence and {float(stored['t0']):.1f}s in the database "
                f"({drift:.1f}s apart). The match was most likely "
                f"reprocessed after this match.json was written; "
                f"re-extract before persisting."
            )
        checked += 1
    if not checked:
        raise ValueError(
            "evidence shares no point index with the stored points, so "
            "alignment cannot be established"
        )


def map_point_ids(
    evidence: Mapping[str, Any],
    points_by_idx: Mapping[int, Mapping[str, Any]],
) -> dict[str, Any]:
    """Attach stable database point IDs and gap times to the evidence.

    points_by_idx: worker idx -> {"id", "t0", "t1"} for the rows the
    match currently has. Raises on evidence that describes a different
    cut of the match (see assert_aligned) — a marker pinned to the wrong
    rally is worse than no marker.

    A MISSING idx is not an error. The owner deletes junk cards, and the
    detector's own view of the match keeps them; those points simply get
    no id. The gap times come from the evidence itself rather than the
    database rows precisely so a change still carries a usable position
    when one of its two points has since been removed — alignment has
    already been established, so the two clocks agree.
    """
    assert_aligned(evidence, points_by_idx)
    mapped = json.loads(json.dumps(evidence))
    by_idx = {int(p["idx"]): p for p in mapped.get("points") or []}
    for point in mapped.get("points") or []:
        stored = points_by_idx.get(int(point["idx"]))
        if stored:
            point["point_id"] = str(stored["id"])
    for change in mapped.get("side_changes") or []:
        after_idx = int(change["after_idx"])
        before_idx = int(change["before_idx"])
        after_stored = points_by_idx.get(after_idx)
        before_stored = points_by_idx.get(before_idx)
        if after_stored:
            change["after_point_id"] = str(after_stored["id"])
        if before_stored:
            change["before_point_id"] = str(before_stored["id"])
        after_point = by_idx.get(after_idx) or {}
        before_point = by_idx.get(before_idx) or {}
        if after_point.get("t1") is not None:
            change["gap_t0"] = float(after_point["t1"])
        if before_point.get("t0") is not None:
            change["gap_t1"] = float(before_point["t0"])
    return mapped


def compact_evidence(evidence: Mapping[str, Any]) -> dict[str, Any]:
    """The database-persisted shape: what a match page needs, nothing else.

    Per-point summaries and pair verdicts are diagnostics — they ride to
    R2 beside match.json, not into a JSONB the client downloads on every
    match open. The persisted side_changes keep their components block:
    that is what explains a fired indicator later.
    """
    keep = {
        key: evidence.get(key)
        for key in (
            "version",
            "status",
            "algorithm",
            "model",
            "foreshortening",
            "side_changes",
            "flips_total",
            "coverage",
            "config",
            "compute",
            "reason",
        )
        if evidence.get(key) is not None
    }
    keep["pairs_total"] = len(evidence.get("pairs") or [])
    return keep


def detect_side_changes(
    points: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """The state machine: qualified points -> pairs -> confirmed changes.

    Returns {status, side_changes, pairs, flips_total, reason?}. A change
    is emitted only when the flip is a clean, isolated step:

      - the pair itself reads 'swapped' beyond the margin;
      - at least pre_stable_pairs consecutive 'same' pairs directly before;
      - at least post_stable_pairs consecutive 'same' pairs directly after
        (the reversed configuration persists into following points);
      - the match's total swapped verdicts stay within max_flips.

    'uncertain' pairs break stability runs — a boundary next to noise is
    not confirmed, it is withheld.
    """
    cfg = merge_config(config)
    pairs = build_pairs(points, cfg)
    flips = [i for i, p in enumerate(pairs) if p["verdict"] == "swapped"]
    if len(flips) > int(cfg["max_flips"]):
        return {
            "status": "withheld",
            "reason": (
                f"{len(flips)} swapped pairs exceed the flip budget of "
                f"{int(cfg['max_flips'])}; appearance signal unstable"
            ),
            "side_changes": [],
            "pairs": pairs,
            "flips_total": len(flips),
            "config": cfg,
        }
    # Collapse a BURST of flips into the one transition it is.
    #
    # A changeover is not a single gap between two rallies; it is the
    # players walking round the table, and the cutter makes cards out of
    # that. Those cards are often QUALIFIED — two people are visible,
    # just mid-walk and at the wrong ends — so bridging unqualified
    # points does not reach them. Compared pair by pair they read as
    # several flips in a row, each with another flip beside it instead
    # of stable ground, and every one is refused.
    #
    # Prabhas (9e15ed10, LYTTC) is the case: a real boundary after point
    # 31, and swapped pairs at 30->31, 32->33 and 33->34 straddling it,
    # all three thrown away. Runs of consecutive non-'same' pairs are
    # now treated as one transition and judged end to end — the last
    # settled point before it against the first settled point after.
    runs: list[tuple[int, int]] = []
    i = 0
    while i < len(pairs):
        if pairs[i]["verdict"] == "same":
            i += 1
            continue
        j = i
        while j + 1 < len(pairs) and pairs[j + 1]["verdict"] != "same":
            j += 1
        runs.append((i, j))
        i = j + 1

    by_idx = {int(point["idx"]): point for point in points}
    max_run = int(cfg.get("max_transition_pairs", 4))
    changes = []
    for start, end in runs:
        if end - start + 1 > max_run:
            continue
        a_idx = int(pairs[start]["a_idx"])
        b_idx = int(pairs[end]["b_idx"])
        before, after = by_idx.get(a_idx), by_idx.get(b_idx)
        if not before or not after:
            continue
        if not (point_qualified(before) and point_qualified(after)):
            continue
        verdict = pair_verdict(before, after, float(cfg["margin_threshold"]))
        if verdict["verdict"] != "swapped":
            continue
        pre_run = _stable_run(pairs, start - 1, -1)
        post_run = _stable_run(pairs, end + 1, +1)
        gap = None
        if before.get("t1") is not None and after.get("t0") is not None:
            gap = round(float(after["t0"]) - float(before["t1"]), 2)
        spanning = {
            "a_idx": a_idx, "b_idx": b_idx, "gap_s": gap,
            "adjacent": end == start, "bridged": b_idx - a_idx - 1,
            **verdict,
        }
        confidence, components = _confidence(
            spanning, pre_run, post_run, cfg)
        confirmed = (
            pre_run >= int(cfg["pre_stable_pairs"])
            and post_run >= int(cfg["post_stable_pairs"])
            and confidence >= float(cfg["min_confidence"])
        )
        changes.append({
            "kind": "side_change",
            "after_idx": a_idx,
            "before_idx": b_idx,
            "confidence": confidence,
            "confirmed": confirmed,
            "components": {
                **components,
                "margin": spanning["margin"],
                "bridged": spanning["bridged"],
                "transition_pairs": end - start + 1,
            },
        })
    return {
        "status": "ready",
        "side_changes": changes,
        "pairs": pairs,
        "flips_total": len(flips),
        "config": cfg,
    }
