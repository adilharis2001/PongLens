"""Consecutive table bounces on opposite halves: how often in play vs between points."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from replay import base, dump_ids, taps_for, light_E, assemble, between
import points_v2 as V2
tot = {}
for mid in dump_ids:
    taps = taps_for(mid)
    if len(taps) < 20: continue
    b = base(mid); H, fps = b["H"], b["fps"]
    cross = np.asarray(b["E"]["cross"]); E0 = light_E(b, cross); cards = sorted(assemble(E0), key=lambda c: c["t0"])
    tb = []
    for f, x, y in b["bnc"]:
        p = V2.project(H, x, y)
        if p and -0.15 <= p[0] <= V2.W_M + 0.15 and -0.15 <= p[1] <= V2.L_M + 0.15:
            tb.append((f / fps, 1 if p[1] > V2.NET_V else -1))
    lo, hi = min(taps) - 30, max(taps) + 30
    for (t0, h0), (t1, h1) in zip(tb, tb[1:]):
        if h0 == h1 or not (lo <= t1 <= hi): continue
        dt = t1 - t0
        seen = bool(((cross > t0) & (cross < t1)).any())
        card = next((c for c in cards if c["t0"] <= t1 <= c["t1"]), None)
        if card:
            ct = [x for x in taps if card["t0"] <= x <= card["t1"] + 0.5]
            state = "in play" if (ct and t1 <= min(ct)) else ("after tap" if ct else "untapped")
        else: state = "dead"
        for X in (2.0, 3.0, 4.0, 5.0):
            if dt <= X:
                tot[(X, state, seen)] = tot.get((X, state, seen), 0) + 1
print("alternating-half table bounce pairs within X s, on tapped matches (seen = a crossing already sits between them)")
for X in (2.0, 3.0, 4.0, 5.0):
    ip = sum(v for k, v in tot.items() if k[0] == X and k[1] == "in play" and not k[2]); ips = sum(v for k, v in tot.items() if k[0] == X and k[1] == "in play" and k[2])
    ot = sum(v for k, v in tot.items() if k[0] == X and k[1] != "in play" and not k[2]); ots = sum(v for k, v in tot.items() if k[0] == X and k[1] != "in play" and k[2])
    print(f"  X={X}: UNSEEN pairs  in play {ip:4d}   not in play {ot:4d}     (already-seen pairs: in play {ips}, not {ots})")
