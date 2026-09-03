"""Which function set each card's end, on the matches whose evidence dump
reproduces production's cards exactly.

Every assembly function is wrapped so a card carries a provenance string:
where it was born, and what last moved its t1. A production card that the
replay reproduces to 0.05 s is then explained by name, not by arithmetic
that several rules could fit.
"""
import json, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/docs/research/2026-09-02-cut-short-census/scripts")
import numpy as np
import points_v2 as V2
from replay import base, light_E, dump_ids, meta, pts
from points_v2 import TICK

rows = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
db = json.load(open("/tmp/serve-diag/census/db_points.json"))
raw_of = {mid: os.path.basename(str(m.get("raw"))) for mid, m in json.load(open("/tmp/serve-diag/fix/db.json"))["meta"].items()}
dump_by_raw = {raw_of[m]: m for m in dump_ids}

def instrumented(E):
    tag = {}
    def key(c):
        return (round(c["t0"], 3), round(c["t1"], 3))
    S = V2.serve_points(E)
    for c in S:
        b = E.between(E.bt_table, c["serve_s"], c["t1"])
        last = float(b[-1]) if len(b) else None
        xs = E.between(E.cross, c["serve_s"], c["t1"])
        c["_p"] = (f"serve card; ends 2.6s after the last table bounce ({last:.2f})" if last is not None
                   else f"serve card; ends 2.6s after the last crossing ({float(xs[-1]):.2f})" if len(xs)
                   else "serve card; ends 2.6s after the serve, nothing followed")
        c["_chain"] = [round(float(x), 2) for x in xs]
    F = V2.fallback_points(E, S)
    for c in F:
        xs = E.between(E.cross, c["t0"], c["t1"])
        c["_p"] = ("no-serve card over a burst of ball motion; " +
                   (f"ends 2.6s after the last event in the crossing chain" if len(xs)
                    else "no crossings at all, so it ends 1.6s after the motion stopped"))
        c["_chain"] = [round(float(x), 2) for x in xs]
    cards, _ = V2.veto(E, S + F)
    R1 = V2.resolve(cards)
    M = V2.merge_continuous(E, R1)
    for c in M:
        if "+ continued" in c["why"]:
            c["_p"] += " | merged with the next card (crossings under 3s apart)"
    R2 = V2.resolve(M)
    before = {key(c): c.get("_p", "?") for c in R2}
    SP = V2.split_long(E, R2)
    for c in SP:
        if "(long card split)" in c["why"]:
            c["_p"] = "SECOND HALF of a card over 20s, cut at its quietest moment"
        elif c["t1"] - c["t0"] <= V2.MAX_CARD_S and key(c) not in before:
            i0, i1 = int(c["t0"] / TICK), int(c["t1"] / TICK)
            c["_p"] = "FIRST HALF of a card over 20s, cut at its quietest moment"
    R3 = V2.resolve(SP)
    for c in R3:
        pass
    final = V2.on_own_table(E, R3)
    return final

print("PROVENANCE of the production cards the replay reproduces")
for mid in dump_ids:
    b = base(mid); E = light_E(b, b["E"]["cross"])
    final = instrumented(E)
    # every census 'real' row whose match shares this raw file
    for r in rows:
        if dump_by_raw.get(raw_of.get(r["match_id"])) != mid or r["verdict"] != "real":
            continue
        me = r["db"]["me"]
        hit = [c for c in final if abs(c["t0"] - me["t0"]) < 0.06 and abs(c["t1"] - me["t1"]) < 0.06]
        near = min(final, key=lambda c: abs(c["t0"] - me["t0"]))
        cover = [c for c in final if c["t0"] - 0.5 <= me["t1"] <= c["t1"] + 0.5]
        if hit:
            c = hit[0]
            print(f"\n  {r['match'][:32]:32s} pt {r['pt'] if 'pt' in r else r['point']:3d}  card {c['t0']:.2f}-{c['t1']:.2f}  EXACT")
            print(f"      {c['_p']}")
            print(f"      crossing chain: {c['_chain']}")
        else:
            print(f"\n  {r['match'][:32]:32s} pt {r['point']:3d}  prod {me['t0']:.2f}-{me['t1']:.2f}  no exact replay card"
                  f" (nearest {near['t0']:.2f}-{near['t1']:.2f}; the ending falls inside {[f'{c['t0']:.2f}-{c['t1']:.2f}' for c in cover]})")
            for c in cover:
                print(f"      that card: {c['_p']}")
