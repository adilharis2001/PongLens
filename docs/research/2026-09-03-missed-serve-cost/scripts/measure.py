"""The four ways a scored point can go missing, counted from the replay.

Every count comes out of the SHIPPED functions' own output rather than out
of a second reading of their rules:

  swallowed  an accepted serve that `serve_points` did not open a card on.
             The function returns one card per serve it accepts, so a serve
             in E.serves with no card carrying it as serve_s was skipped by
             the `c < open_ev + MIN_GAP_S` test — the previous rally's
             crossing chain had already run past it. The card that contains
             it therefore holds two points.
  capped     a card `split_long` cut, i.e. one that reached 20 s.
  own_table  a card that survived resolve and was then dropped by
             `on_own_table`, plus whether it trimmed a neighbour's tail on
             the way through resolve.
  uncarded   rally-shaped activity (crossings clustered together) that no
             final card covers.

And for the tolerance question: for every serve card, where its bounces sit
relative to the two different pads the pipeline uses — 0.45 m for the serve
pair, 0.15 m for `Evidence.bt_table`, which is what `on_own_table` reads.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reload import load, stages                                # noqa: E402
import points_v2 as V2                                         # noqa: E402

TABLE_PAD = 0.15          # Evidence.bt_table, hardcoded in points_v2:539
SERVE_PAD = 0.45          # PAIR_SURFACE_PAD_M, points_v2:82


def on_pad(u, v, pad):
    return (u is not None and -pad <= u <= V2.W_M + pad
            and -pad <= v <= V2.L_M + pad)


def swallowed(E, s):
    """Accepted serves that serve_points opened no card on."""
    opened = {round(c["serve_s"], 2) for c in s["serve"]
              if c.get("serve_s") is not None}
    return [t for t in E.serves if round(t, 2) not in opened]


def containing(cards, t):
    for c in cards:
        if c["t0"] - 0.05 <= t <= c["t1"] + 0.05:
            return c
    return None


def uncarded_bursts(E, final, min_cross=3, gap=3.0):
    """Crossing clusters that no final card covers."""
    covered = np.zeros(E.n, bool)
    for c in final:
        V2._mark(covered, c["t0"], c["t1"])
    loose = [float(t) for t in E.cross
             if not covered[min(E.n - 1, int(t / V2.TICK))]]
    bursts, cur = [], []
    for t in loose:
        if cur and t - cur[-1] > gap:
            if len(cur) >= min_cross:
                bursts.append((cur[0], cur[-1]))
            cur = []
        cur.append(t)
    if len(cur) >= min_cross:
        bursts.append((cur[0], cur[-1]))
    # only count a burst that also put the ball on the user's own table
    out = []
    for a, b in bursts:
        if int(((E.bt_table >= a - 1.0) & (E.bt_table <= b + 1.0)).sum()) >= 2:
            out.append((round(a, 2), round(b, 2)))
    return out


def tolerance(E, s):
    """The 0.15 / 0.45 mismatch, per serve card."""
    uv = {round(t, 2): (u, v) for t, u, v in E.bounce_uv()}
    rows = []
    for c in s["resolved"]:
        if c.get("serve_s") is None:
            continue
        ts = [round(float(t), 2) for t in E.bt
              if c["t0"] <= t <= c["t1"]]
        if not ts:
            continue
        n15 = sum(1 for t in ts if on_pad(*uv.get(t, (None, None)), TABLE_PAD))
        n45 = sum(1 for t in ts if on_pad(*uv.get(t, (None, None)), SERVE_PAD))
        rows.append({"t0": round(c["t0"], 2), "t1": round(c["t1"], 2),
                     "serve_s": round(c["serve_s"], 2),
                     "bounces": len(ts), "on15": n15, "on45": n45,
                     "band_only": n45 - n15})
    return rows


def run(path):
    b, E = load(path)
    if E is None:
        return None
    s = stages(E)
    final = s["final"]
    sw = swallowed(E, s)
    sw_rows = []
    for t in sw:
        c = containing(final, t)
        sw_rows.append({
            "serve_s": round(t, 2),
            "card": None if c is None else [round(c["t0"], 2), round(c["t1"], 2)],
            "card_len": None if c is None else round(c["t1"] - c["t0"], 2),
            "card_serve": None if c is None or c.get("serve_s") is None
                          else round(c["serve_s"], 2),
        })
    capped = [[round(c["t0"], 2), round(c["t1"], 2)] for c in s["merged"]
              if c["t1"] - c["t0"] > V2.MAX_CARD_S]
    dropped = s["dropped_by_own_table"]
    tol = tolerance(E, s)
    # a dropped card that had trimmed its neighbour: its own t1 or the
    # previous card's t1 moved during resolve
    pre = {(round(c["t0"], 2)): c for c in s["split"]}
    trimmed = []
    for d in dropped:
        nb = [c for c in s["resolved"] if c["t1"] <= d["t0"] + 0.01]
        if not nb:
            continue
        prev = max(nb, key=lambda c: c["t1"])
        before = pre.get(round(prev["t0"], 2))
        if before is not None and before["t1"] - prev["t1"] > 0.05:
            trimmed.append({"dropped": [round(d["t0"], 2), round(d["t1"], 2)],
                            "neighbour": [round(prev["t0"], 2), round(prev["t1"], 2)],
                            "lost_s": round(before["t1"] - prev["t1"], 2)})
    return {
        "match_id": b.get("match_id") or os.path.basename(path)[:-5],
        "opponent": b.get("opponent"), "venue": b.get("venue"),
        "route": b.get("route"), "camera": b.get("camera"),
        "serves_per_min": b.get("serves_per_min"),
        "duration": b["duration"],
        "n_cards": len(final), "n_serves": len(E.serves),
        "n_anchored": sum(1 for c in final if c.get("serve_s") is not None),
        "swallowed": sw_rows,
        "capped": capped,
        "dropped_own_table": [
            {"t0": round(c["t0"], 2), "t1": round(c["t1"], 2),
             "serve_s": None if c.get("serve_s") is None else round(c["serve_s"], 2)}
            for c in dropped],
        "own_table_trimmed_neighbour": trimmed,
        "uncarded": uncarded_bursts(E, final),
        "tolerance": tol,
    }


if __name__ == "__main__":
    out = {}
    for path in sys.argv[1:]:
        r = run(path)
        if r:
            out[r["match_id"]] = r
    print(json.dumps(out))
