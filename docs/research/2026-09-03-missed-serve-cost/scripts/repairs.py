"""What Adil had to fix by hand, and what the assembler saw where he fixed it.

A point row whose (t0, t1) is not in the match's own match.json was made in
the app, not by the worker. Three shapes, and they mean opposite things:

  SPLIT   two rows tile one production card end to end. That card held two
          points: the fusion this study is about, caught by the owner.
  JOIN    one row covers two production cards. One point split in two —
          the opposite defect.
  INSERT  a row overlapping no production card at all. A point that never
          got a card.

For every split and insert the evidence bundle is then asked what the
assembler had at that moment: how many serves it accepted inside the
window, and where its crossings ran. That is what separates "the serve was
never detected" from "the serve was detected and skipped as mid-rally".
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reload import load, stages                                # noqa: E402
import points_v2 as V2                                         # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def prod_cards(mid):
    mj = json.load(open(f"{ROOT}/mj/{mid}.json"))
    return [(round(float(c["t0"]), 2), round(float(c["t1"]), 2),
             c.get("serve_s"), c.get("why")) for c in mj["points"]]


def classify(mid, rows, prod):
    """Hand-made rows -> [(kind, row, detail)]."""
    spans = [(a, b) for a, b, _s, _w in prod]
    hand = []
    for r in rows:
        if r["t0"] is None:
            continue
        t0, t1 = round(float(r["t0"]), 2), round(float(r["t1"]), 2)
        if any(abs(t0 - a) < 0.03 and abs(t1 - b) < 0.03 for a, b in spans):
            continue
        hand.append((t0, t1, r))
    out = []
    for t0, t1, r in hand:
        covers = [(a, b) for a, b in spans if a >= t0 - 0.05 and b <= t1 + 0.05]
        inside = [(a, b) for a, b in spans if a <= t0 + 0.05 and b >= t1 - 0.05]
        if len(covers) >= 2:
            out.append(("join", t0, t1, r, covers))
        elif inside:
            out.append(("split", t0, t1, r, inside[0]))
        else:
            overlap = [(a, b) for a, b in spans if b > t0 + 0.05 and a < t1 - 0.05]
            out.append(("insert" if not overlap else "other", t0, t1, r, overlap))
    return out


def probe(E, a, b):
    """What the assembler had between a and b."""
    serves = [s for s in E.serves if a - 0.05 <= s <= b + 0.05]
    cross = [round(float(t), 2) for t in E.cross if a <= t <= b]
    bt = [round(float(t), 2) for t in E.bt_table if a <= t <= b]
    biggest = 0.0
    for x, y in zip(cross, cross[1:]):
        biggest = max(biggest, y - x)
    return {"serves": serves, "n_cross": len(cross), "n_bt": len(bt),
            "max_cross_gap": round(biggest, 2)}
