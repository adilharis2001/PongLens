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

ALGORITHM_VERSION = "side-change-v3"
EVIDENCE_VERSION = 3

# Default thresholds. The worker may override any of these from
# app_config.game_end_detection_config (JSON) so tuning is one UPDATE, but
# the defaults are the measured operating point, not placeholders.
DEFAULT_CONFIG = {
    # --- qualification: which points are worth comparing at all ---------
    # Signature spread across one point's sampled frames must stay under
    # this for that side to qualify — the doubles/occlusion guard. Two
    # different shirts alternating at one end cannot hold a tight spread.
    "spread_max": 0.16,
    # The two players must measure at least this far apart, in the same
    # units as everything else, before ANY of the match's margins are
    # treated as evidence. See separability().
    "min_separability": 0.18,

    # --- the comparison graph -------------------------------------------
    # Each qualified point is compared with the next N qualified points,
    # not only its neighbour. This is what carries a verdict across a
    # messy changeover.
    "link_span": 3,
    # Weight of a k-hop comparison relative to an adjacent one:
    # link_decay ** (k - 1).
    "link_decay": 0.6,
    # A comparison may not reach across more than this many of the
    # detector's own points.
    "link_max_skip": 8,

    # --- what a state change costs ---------------------------------------
    # The prior that changeovers are rare. Raise it for precision, lower
    # it for recall; it is the single knob that trades the two.
    "switch_penalty": 0.42,
    # Gap length discounts the penalty, smoothly and never to zero.
    "gap_ref_s": 12.0,
    "gap_relief": 0.5,
    # More state changes than this in one match means the appearance
    # signal itself is unstable; withhold everything rather than pick.
    "max_changes": 8,
    # Every stretch of one configuration must run at least this
    # many qualified points, the first and last included. A game
    # is eleven rallies at minimum; anything shorter than this is
    # a tracking glitch being read as a game.
    "min_segment_points": 3,
    # A candidate must also survive a second, independent look at the
    # settled runs either side of it. See verify_change.
    "verify_points": 6,
    "verify_skip": 1,
    "verify_margin": 0.04,
    # Share of comparisons the winning labelling may contradict before
    # the whole match is withheld as noise.
    "max_contradiction": 0.30,

    # --- reporting --------------------------------------------------------
    # Confidence is how much worse the best explanation of the match gets
    # when no change is allowed within this many points of the candidate,
    # divided by this scale and clipped to 1.
    "confidence_radius": 2,
    "confidence_scale": 0.8,
    # Below this, a change is recorded as diagnostic only and must not be
    # surfaced. Components are stored so the floor can move.
    "min_confidence": 0.55,

    # --- display only -----------------------------------------------------
    # build_pairs still renders adjacent verdicts on the review pages.
    # Neither of these decides anything any more.
    "margin_threshold": 0.08,
    "bridge_max": 3,
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
    """Per-dimension median. Width comes from the samples, not from 3:
    the signature used to be a BGR triple and is now whichever descriptor
    the config names, up to a 36-bin histogram."""
    width = min(len(sample) for sample in samples)
    return [
        sorted(sample[channel] for sample in samples)[len(samples) // 2]
        for channel in range(width)
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
        if sample is not None and len(sample) > 0
    ]
    if usable:
        width = max(len(sample) for sample in usable)
        usable = [sample for sample in usable if len(sample) == width]
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



# --- the labelling model ----------------------------------------------------
#
# Why this replaced the run-counting rule (2026-08-27).
#
# v2 asked a local question: is this pair 'swapped', with N consecutive
# 'same' pairs either side? That framing has a failure it cannot see past.
# A changeover is messy — the players walk round the table, fetch the ball,
# towel off — and the cards cut out of that mess produce a RUN of
# disagreeing pairs. v2 collapsed consecutive runs, which helped, but a
# single pair reading 'same' by chance in the middle of the mess split the
# transition into two halves, each with settled ground on one side only,
# and both were refused. Ishan (d59d7610) is the case: three real
# boundaries, four candidates found, every one refused with stability 0 on
# one side.
#
# The fix is to stop thresholding pairs into verdicts before deciding
# anything. Each qualified point has one hidden binary state — which of the
# two players is at the near end — and every comparison between two points
# is noisy evidence about whether their states agree. Pick the labelling of
# the whole match that best explains ALL the evidence, paying a fixed
# penalty per state change so that changes have to earn their place.
# Boundaries are then simply where the winning labelling changes state.
#
# Two things fall out of this that no amount of threshold tuning gave us:
#
#   * Non-adjacent evidence counts. Point 28 is compared directly with
#     point 31, straight across the mess, and that comparison is usually
#     the cleanest one available. Run counting could only ever look at
#     neighbours.
#   * An ambiguous comparison contributes weak evidence instead of
#     destroying the case. Under v2 one 'uncertain' pair zeroed a
#     stability run; here it just has a small margin and is outvoted.
#
# The optimisation is exact, not a heuristic search: with links reaching at
# most `link_span` points ahead, a Viterbi pass whose state is the last
# `link_span` labels visits 2**link_span states per point and returns the
# global optimum in one sweep over the match.


def _link_margin(a, b) -> dict[str, float]:
    """Evidence that two qualified points hold OPPOSITE configurations.

    Positive margin favours 'same', negative favours 'swapped' — the same
    quantity pair_verdict thresholds, kept raw here on purpose.
    """
    same_cost = (
        _distance(a["near"]["sig"], b["near"]["sig"])
        + _distance(a["far"]["sig"], b["far"]["sig"])
    )
    swap_cost = (
        _distance(a["near"]["sig"], b["far"]["sig"])
        + _distance(a["far"]["sig"], b["near"]["sig"])
    )
    return {"same_cost": same_cost, "swap_cost": swap_cost,
            "margin": swap_cost - same_cost}


def separability(points: Sequence[Mapping[str, Any]]) -> float | None:
    """Median distance between the two players within one point.

    The honesty gate. If the near and far signatures are barely different
    from each other, then near-vs-far and near-vs-near are barely
    different either, and every margin in the match is noise being read as
    evidence. Prabhas (9e15ed10) measures 0.147 here and produces no
    usable signal at any threshold; PingPod measures 0.240 and works.
    Withholding is the right answer, not a lower bar.
    """
    values = [
        _distance(p["near"]["sig"], p["far"]["sig"])
        for p in points if point_qualified(p)
    ]
    if not values:
        return None
    return round(sorted(values)[len(values) // 2], 4)


def build_links(
    points: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Qualified points, and the weighted comparisons between them.

    Each qualified point is linked to the next `link_span` qualified
    points. A link reaching k places ahead is worth `link_decay ** (k-1)`
    of an adjacent one: it is real evidence, and on a messy changeover it
    is the BEST evidence, but it is also more likely to straddle something
    that changed, so it should not outvote its neighbours.

    Links spanning more than `link_max_skip` of the detector's own points
    are dropped outright. Reaching over a two-minute stretch of cards that
    never showed two players is not a comparison of neighbours any more.
    """
    qualified = [p for p in points if point_qualified(p)]
    span = max(1, int(config.get("link_span", 3)))
    decay = float(config.get("link_decay", 0.6))
    max_skip = int(config.get("link_max_skip", 8))
    links = []
    for i, a in enumerate(qualified):
        for k in range(1, span + 1):
            j = i + k
            if j >= len(qualified):
                break
            b = qualified[j]
            if int(b["idx"]) - int(a["idx"]) - 1 > max_skip:
                break
            links.append({
                "i": i, "j": j, "hop": k,
                "weight": decay ** (k - 1),
                **_link_margin(a, b),
            })
    return qualified, links


def switch_cost(gap_s: float | None, config: Mapping[str, Any]) -> float:
    """What one state change costs at a gap of this length.

    Gap length is a real prior, not a garnish. Measured 2026-08-27 over
    3,573 gaps between consecutive live points on 52 scored matches: the
    median gap at a true game boundary is 17.6s against 4.0s everywhere
    else, and 99% of ordinary gaps are under 21.5s. So a long gap should
    make a state change CHEAPER — but only somewhat, because recordings
    paused between games produce real boundaries with no gap at all
    (p10 of true boundary gaps is 2.0s). Relief is capped and smooth; a
    zero-length gap is never disqualifying.
    """
    base = float(config["switch_penalty"])
    if gap_s is None or gap_s <= 0:
        return base
    ref = float(config.get("gap_ref_s", 12.0))
    relief = float(config.get("gap_relief", 0.5))
    return base * (1.0 - relief * (gap_s / (gap_s + ref)))


def _solve(
    count: int,
    links: Sequence[Mapping[str, Any]],
    switch_costs: Sequence[float],
    span: int,
    min_segment: int = 1,
    forbidden: frozenset[int] = frozenset(),
) -> tuple[float, list[int]]:
    """Exact minimum-cost binary labelling, by Viterbi.

    The state carries two things: the last `span` labels, so a link
    reaching that far back knows what it is comparing against, and a
    countdown enforcing that every stretch of one configuration runs at
    least `min_segment` points — including the first and last stretches.

    The minimum run length is not tidiness. Without it the model happily
    explains one rally shot from the wrong ends, or a single trailing
    point, by paying the switch penalty twice; the evidence from strongly
    coloured shirts is more than enough to cover it. A game is at least
    eleven rallies, so any "configuration" lasting two is a tracking
    glitch and not a game.

    `forbidden` names positions where a change is not allowed, which is
    how a candidate's confidence gets measured.

    The labelling is symmetric under flipping every label, so position 0
    is pinned to 0 without loss.
    """
    if count == 0:
        return 0.0, []
    hold_max = max(0, int(min_segment) - 1)
    by_target: dict[int, list[Mapping[str, Any]]] = {}
    for link in links:
        by_target.setdefault(link["j"], []).append(link)
    mask = (1 << span) - 1
    # state -> (bits, hold): hold is how many more positions must keep the
    # current label before a change becomes affordable.
    best = {(0, hold_max): 0.0}
    back: list[dict[tuple[int, int], tuple[int, int]]] = []
    for position in range(1, count):
        arrivals = by_target.get(position, ())
        nxt: dict[tuple[int, int], float] = {}
        step: dict[tuple[int, int], tuple[int, int]] = {}
        for (bits, hold), cost in best.items():
            previous = bits & 1
            for label in (0, 1):
                changed = label != previous
                if changed and (hold > 0 or position in forbidden):
                    continue
                total = cost + (switch_costs[position] if changed else 0.0)
                for link in arrivals:
                    other = (bits >> (link["hop"] - 1)) & 1
                    if label != other:
                        total += link["weight"] * link["margin"]
                key = (
                    ((bits << 1) | label) & mask,
                    hold_max if changed else max(0, hold - 1),
                )
                if key not in nxt or total < nxt[key]:
                    nxt[key] = total
                    step[key] = (bits, hold)
        if not nxt:
            return math.inf, []
        best = nxt
        back.append(step)
    # The final stretch must be long enough too, so only settled states
    # may finish.
    settled = {k: v for k, v in best.items() if k[1] == 0}
    pool = settled or best
    end_state = min(pool, key=lambda k: pool[k])
    labels = [0] * count
    state = end_state
    for position in range(count - 1, 0, -1):
        labels[position] = state[0] & 1
        state = back[position - 1][state]
    labels[0] = state[0] & 1
    return pool[end_state], labels


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


def segment_signature(
    points: Sequence[Mapping[str, Any]],
    lo: int,
    hi: int,
) -> dict[str, list[float]] | None:
    """Median near and far signatures over a settled stretch of points."""
    near = [p["near"]["sig"] for p in points[lo:hi]]
    far = [p["far"]["sig"] for p in points[lo:hi]]
    if not near or not far:
        return None
    return {"near": _channel_median(near), "far": _channel_median(far)}


def verify_change(
    qualified: Sequence[Mapping[str, Any]],
    switches: Sequence[int],
    position: int,
    config: Mapping[str, Any],
) -> dict[str, Any]:
    """Compare the two SETTLED configurations either side of a candidate.

    The labelling model finds where the cheapest explanation changes
    state. That is the right question to ask of the whole match and the
    wrong one to ask of a single rally: one point whose near and far
    players got swapped by the detector is enough to drag a boundary to
    the wrong place, because the model must either explain it or smear it
    and smearing is sometimes cheaper.

    So a candidate is checked a second way, on evidence the transition
    cannot touch. Take the run of points before the change and the run
    after, drop the point immediately either side of it (those are the
    ones most likely to be mid-changeover), take the median signature of
    each run, and ask the plain question: did the two players actually
    end up at opposite ends? A real changeover says yes by a wide margin.
    A one-rally glitch says no, because the players before and after it
    are in the same places.
    """
    reach = int(config.get("verify_points", 6))
    skip = int(config.get("verify_skip", 1))
    order = sorted(switches)
    index = order.index(position)
    lower = order[index - 1] if index > 0 else 0
    upper = order[index + 1] if index + 1 < len(order) else len(qualified)
    before = segment_signature(
        qualified, max(lower, position - skip - reach),
        max(lower + 1, position - skip))
    after = segment_signature(
        qualified, min(upper - 1, position + skip),
        min(upper, position + skip + reach))
    if before is None or after is None:
        return {"verified": False, "reason": "no settled run either side"}
    verdict = pair_verdict(
        {"near": {"sig": before["near"]}, "far": {"sig": before["far"]}},
        {"near": {"sig": after["near"]}, "far": {"sig": after["far"]}},
        float(config["verify_margin"]),
    )
    return {
        "verified": verdict["verdict"] == "swapped",
        "verify_margin": verdict["margin"],
        "verify_verdict": verdict["verdict"],
    }


def contradiction_share(
    links: Sequence[Mapping[str, Any]],
    labels: Sequence[int],
) -> float:
    """Weighted share of comparisons the winning labelling disagrees with.

    A healthy match has one explanation that nearly all its evidence
    supports. When the appearance signal is noise — a bystander picked as
    a player on alternate rallies, say — no labelling fits, and the best
    one still leaves a third of the comparisons pointing the other way.
    That is the instability guard: not how many changes were found, but
    how much evidence had to be ignored to find them.
    """
    total = wrong = 0.0
    for link in links:
        differ = labels[link["i"]] != labels[link["j"]]
        prefers_differ = link["margin"] < 0
        total += link["weight"]
        if differ != prefers_differ:
            wrong += link["weight"]
    return round(wrong / total, 4) if total else 0.0


def detect_side_changes(
    points: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Qualified points -> one labelling of the match -> its state changes.

    Returns {status, side_changes, pairs, links, flips_total, reason?}.
    `pairs` is kept because the review pages render it; it no longer
    decides anything.
    """
    cfg = merge_config(config)
    pairs = build_pairs(points, cfg)
    flips = sum(1 for p in pairs if p["verdict"] == "swapped")
    qualified, links = build_links(points, cfg)
    apart = separability(points)
    base = {
        "pairs": pairs,
        "flips_total": flips,
        "config": cfg,
        "separability": apart,
        "qualified_total": len(qualified),
    }
    if len(qualified) < 4:
        return {"status": "withheld", "side_changes": [], "links": [],
                "reason": f"only {len(qualified)} qualified points",
                **base}
    if apart is not None and apart < float(cfg["min_separability"]):
        return {
            "status": "withheld", "side_changes": [], "links": [],
            "reason": (
                f"the two players measure {apart:.3f} apart, under the "
                f"{float(cfg['min_separability']):.3f} floor; appearance "
                f"cannot tell them apart, so nothing here is evidence"
            ),
            **base,
        }

    span = max(1, int(cfg.get("link_span", 3)))
    costs = [0.0]
    for a, b in zip(qualified, qualified[1:]):
        gap = None
        if a.get("t1") is not None and b.get("t0") is not None:
            gap = float(b["t0"]) - float(a["t1"])
        costs.append(switch_cost(gap, cfg))
    floor = int(cfg.get("min_segment_points", 3))
    total, labels = _solve(
        len(qualified), links, costs, span, floor)
    switches = [
        i for i in range(1, len(labels)) if labels[i] != labels[i - 1]
    ]
    if len(switches) > int(cfg["max_changes"]):
        return {
            "status": "withheld", "side_changes": [], "links": links,
            "reason": (
                f"{len(switches)} state changes exceed the budget of "
                f"{int(cfg['max_changes'])}; appearance signal unstable"
            ),
            **base,
        }

    contradiction = contradiction_share(links, labels)
    if contradiction > float(cfg["max_contradiction"]):
        return {
            "status": "withheld", "side_changes": [], "links": links,
            "labels": labels, "contradiction": contradiction,
            "reason": (
                f"the best explanation of this match still disagrees with "
                f"{contradiction:.0%} of its own comparisons; the "
                f"appearance signal is noise"
            ),
            **base,
        }

    radius = int(cfg.get("confidence_radius", 2))
    scale = float(cfg.get("confidence_scale", 0.8))
    changes = []
    for position in switches:
        # How much worse the best explanation of the whole match gets when
        # no state change is allowed anywhere near here. Forbidding only
        # this one position would measure where the boundary is, which is
        # not the claim being made; forbidding a window measures whether
        # one happened at all.
        window = frozenset(
            p for p in range(
                max(1, position - radius),
                min(len(labels), position + radius + 1))
        )
        penalised, _ = _solve(
            len(qualified), links, costs, span, floor, window)
        delta = penalised - total
        confidence = round(min(1.0, max(0.0, delta / scale)), 3)
        a, b = qualified[position - 1], qualified[position]
        gap = None
        if a.get("t1") is not None and b.get("t0") is not None:
            gap = round(float(b["t0"]) - float(a["t1"]), 2)
        margin = _link_margin(a, b)
        check = verify_change(qualified, switches, position, cfg)
        changes.append({
            "kind": "side_change",
            "after_idx": int(a["idx"]),
            "before_idx": int(b["idx"]),
            "confidence": confidence,
            "confirmed": (
                check["verified"]
                and confidence >= float(cfg["min_confidence"])
            ),
            "components": {
                "delta_cost": round(delta, 4),
                **check,
                "gap_s": gap,
                "switch_cost": round(costs[position], 4),
                "margin": round(-margin["margin"], 4),
                "bridged": int(b["idx"]) - int(a["idx"]) - 1,
                "separability": apart,
                "run_before": position - (
                    switches[switches.index(position) - 1]
                    if switches.index(position) > 0 else 0),
                "run_after": (
                    switches[switches.index(position) + 1]
                    if switches.index(position) + 1 < len(switches)
                    else len(labels)) - position,
            },
        })
    return {
        "status": "ready",
        "side_changes": changes,
        "links": links,
        "labels": labels,
        "cost": round(total, 4),
        "contradiction": contradiction,
        **base,
    }
