"""Sharpen the two counts that a raw replay overstates.

1. A swallowed serve is only a lost POINT if a point really started there.
   `serve_motifs` accepts pairs mid-rally too — the census that produced the
   refusal table said so in as many words — and the arithmetic proves it on
   this corpus: two matches accept more serves than the owner scored points,
   so at least the difference is false. The discriminator used here is the
   assembler's own idea of what separates two points: MIN_DEAD_S. If the
   crossings run continuously up to the swallowed serve's own contact, the
   ball was still in play and this is a shot, not a serve.

2. `on_own_table` drops a card after `resolve` has settled overlaps, so a
   card can trim its neighbour's tail and then die. Detecting that needs the
   pre-resolve card matched to its post-resolve self, and resolve moves t0
   as well as t1 — so match on the serve mark where there is one, and on
   nearest t0 otherwise, rather than on t0 equality.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reload import load, stages                                # noqa: E402
import points_v2 as V2                                         # noqa: E402

DEAD = V2.MIN_DEAD_S      # 1.2 s — the assembler's own dead-space floor


def pre_gap(E, contact_s):
    """Seconds of crossing silence before this serve's contact."""
    before = [float(t) for t in E.cross if t < contact_s - 0.05]
    if not before:
        return None
    return round(contact_s - max(before), 2)


def match_pre(pre, post):
    """Pair each post-resolve card with the pre-resolve card it came from."""
    pairs = []
    used = set()
    for c in post:
        best, bd = None, 1e9
        for i, p in enumerate(pre):
            if i in used:
                continue
            if (c.get("serve_s") is not None and p.get("serve_s") is not None
                    and abs(c["serve_s"] - p["serve_s"]) < 0.01):
                best, bd = i, -1
                break
            d = abs(c["t0"] - p["t0"])
            if d < bd:
                best, bd = i, d
        if best is not None and bd < 3.0:
            used.add(best)
            pairs.append((pre[best], c))
        else:
            pairs.append((None, c))
    return pairs


def run(path):
    b, E = load(path)
    if E is None:
        return None
    s = stages(E)
    final, resolved = s["final"], s["resolved"]
    opened = {round(c["serve_s"], 2) for c in s["serve"]
              if c.get("serve_s") is not None}
    sw = []
    for t in E.serves:
        if round(t, 2) in opened:
            continue
        card = next((c for c in final if c["t0"] - 0.05 <= t <= c["t1"] + 0.05),
                    None)
        g = pre_gap(E, t)
        sw.append({
            "serve_s": round(float(t), 2),
            "pre_gap": g,
            "dead_before": g is not None and g >= DEAD,
            "card_len": None if card is None else round(card["t1"] - card["t0"], 2),
            "card": None if card is None else [round(card["t0"], 2), round(card["t1"], 2)],
        })

    # on_own_table: what died, and had it already cost a neighbour
    pairs = match_pre(s["split"], resolved)
    trimmed_by = {id(c): (p["t1"] - c["t1"]) for p, c in pairs if p is not None}
    dropped = s["dropped_by_own_table"]
    drops = []
    for d in dropped:
        idx = resolved.index(d) if d in resolved else None
        prev = None
        if idx is not None and idx > 0:
            prev = resolved[idx - 1]
        drops.append({
            "t0": round(d["t0"], 2), "t1": round(d["t1"], 2),
            "len": round(d["t1"] - d["t0"], 2),
            "serve_s": None if d.get("serve_s") is None else round(d["serve_s"], 2),
            "neighbour_lost_s": None if prev is None
                                else round(max(0.0, trimmed_by.get(id(prev), 0.0)), 2),
            "n_bt_corridor": int(((E.bt >= d["t0"]) & (E.bt <= d["t1"])).sum()),
        })

    # the tolerance band, per anchored card
    uv = {round(t, 2): (u, v) for t, u, v in E.bounce_uv()}

    def pad_ok(t, pad):
        u, v = uv.get(round(float(t), 2), (None, None))
        return (u is not None and -pad <= u <= V2.W_M + pad
                and -pad <= v <= V2.L_M + pad)

    band = []
    for c in resolved:
        if c.get("serve_s") is None:
            continue
        ts = [float(t) for t in E.bt if c["t0"] <= t <= c["t1"]]
        n15 = sum(1 for t in ts if pad_ok(t, 0.15))
        n45 = sum(1 for t in ts if pad_ok(t, 0.45))
        if n15 == 0:
            band.append({"t0": round(c["t0"], 2), "t1": round(c["t1"], 2),
                         "serve_s": round(c["serve_s"], 2),
                         "bounces": len(ts), "on45": n45,
                         "died": any(abs(d["t0"] - c["t0"]) < 1e-9
                                     and abs(d["t1"] - c["t1"]) < 1e-9
                                     for d in dropped)})
    return {
        "match_id": b.get("match_id") or os.path.basename(path)[:-5],
        "venue": b.get("venue"), "opponent": b.get("opponent"),
        "route": b.get("route"), "duration": b["duration"],
        "n_cards": len(final), "n_serves": len(E.serves),
        "n_anchored": sum(1 for c in final if c.get("serve_s") is not None),
        "swallowed": sw, "drops": drops, "band": band,
        "capped": [[round(c["t0"], 2), round(c["t1"], 2)] for c in s["merged"]
                   if c["t1"] - c["t0"] > V2.MAX_CARD_S],
    }


if __name__ == "__main__":
    out = {}
    for p in sys.argv[1:]:
        r = run(p)
        if r:
            out[r["match_id"]] = r
    print(json.dumps(out))
