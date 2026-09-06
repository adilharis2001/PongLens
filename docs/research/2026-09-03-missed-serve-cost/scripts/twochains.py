"""Cards holding two rally chains, and which stage put them there.

The confirmed cases say the fusion has two different mechanisms, and the
signature that separates them is the card's own crossings:

  a SERVE card's extent is `rally_end_ev`, which stops at the first pause
  longer than CROSS_GAP_S. So a serve card can only fuse two points if the
  crossings run continuously across the boundary — the gap is UNDER 3 s and
  the second serve was skipped as mid-rally.

  a FALLBACK card's extent is a merge of ball_dense runs up to
  FALLBACK_MERGE_S = 3.5 s apart, and dense motion does not stop when a
  rally does — the retrieval, the walk back and the next server bouncing the
  ball all register. So a fallback card CAN swallow a gap far longer than
  any rally's, and the crossings inside it show the hole.

Counted here per final card: the largest internal crossing gap, how many
crossings and own-table bounces sit either side of it, and which stage the
card came from. `two_chains` is the conservative reading — a gap longer than
CROSS_GAP_S with at least two crossings and one own-table bounce on both
sides, so both halves look like play rather than like noise.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reload import load, stages                                # noqa: E402
import points_v2 as V2                                         # noqa: E402


def split_at_biggest_gap(cross):
    if len(cross) < 2:
        return None, 0.0
    gaps = [(cross[i + 1] - cross[i], i) for i in range(len(cross) - 1)]
    g, i = max(gaps)
    return i, g


def describe(E, c):
    cross = [float(t) for t in E.cross if c["t0"] <= t <= c["t1"]]
    i, g = split_at_biggest_gap(cross)
    row = {"t0": round(c["t0"], 2), "t1": round(c["t1"], 2),
           "len": round(c["t1"] - c["t0"], 2),
           "serve_s": c.get("serve_s"), "why": c.get("why"),
           "n_cross": len(cross), "max_gap": round(g, 2),
           "two_chains": False}
    if i is None or g <= V2.CROSS_GAP_S:
        return row
    a, b = cross[i], cross[i + 1]
    left = [t for t in cross if t <= a]
    right = [t for t in cross if t >= b]
    bl = int(((E.bt_table >= c["t0"]) & (E.bt_table <= a + 1.0)).sum())
    br = int(((E.bt_table >= b - 1.0) & (E.bt_table <= c["t1"])).sum())
    row.update({"gap_at": [round(a, 2), round(b, 2)],
                "left_cross": len(left), "right_cross": len(right),
                "left_bt": bl, "right_bt": br,
                "two_chains": len(left) >= 2 and len(right) >= 2
                              and bl >= 1 and br >= 1})
    return row


def run(path):
    b, E = load(path)
    if E is None:
        return None
    s = stages(E)
    rows = [describe(E, c) for c in s["final"]]
    # was this card's window one fallback merge before split_long touched it?
    pre = s["merged"]
    for r in rows:
        owner = next((c for c in pre
                      if c["t0"] <= r["t0"] + 0.2 and c["t1"] >= r["t1"] - 0.2),
                     None)
        r["pre_split_len"] = None if owner is None else round(owner["t1"] - owner["t0"], 2)
        r["from_fallback"] = bool(owner and owner.get("serve_s") is None)
    return {"match_id": b.get("match_id") or os.path.basename(path)[:-5],
            "venue": b.get("venue"), "route": b.get("route"),
            "cards": rows}


if __name__ == "__main__":
    out = {}
    for p in sys.argv[1:]:
        r = run(p)
        if r:
            out[r["match_id"]] = r
    print(json.dumps(out))
