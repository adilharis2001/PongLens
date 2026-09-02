"""Timeline around census points no variant joined."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from replay import base, light_E, assemble, crossings_lob, between, pts
import points_v2 as V2
cases = [("25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "m4 #4", 45.22, 46.42), ("25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "m4 #65", 736.21, 737.17),
         ("47b83b9b-ae34-4106-827d-be74d4bdf677", "26Aug/81 #58", 769.29, 770.49), ("fa96cd0e-bfbd-403b-8c30-87714ee78030", "Kyle #8", 118.08, None)]
for mid, name, t1, nt0 in cases:
    b = base(mid); trk, H, fps = b["trk"], b["H"], b["fps"]
    cross0 = b["E"]["cross"]; cross2 = crossings_lob(trk, H, fps, 2.0, False, 0.0, b["E"]["bt_table"])
    E0 = light_E(b, cross0); c0 = sorted(assemble(E0), key=lambda c: c["t0"])
    E2 = light_E(b, cross2, cross0); c2 = sorted(assemble(E2), key=lambda c: c["t0"])
    lo, hi = t1 - 7, (nt0 or t1) + 4
    print(f"\n=== {name} ({mid[:8]}) prod card ends {t1}, next opens {nt0}")
    print("  baseline cards:", [(round(c['t0'],1), round(c['t1'],1), 'S' if c.get('serve_s') else '-') for c in c0 if c["t1"] > lo - 5 and c["t0"] < hi + 5])
    print("  lob2.0 cards:  ", [(round(c['t0'],1), round(c['t1'],1), 'S' if c.get('serve_s') else '-') for c in c2 if c["t1"] > lo - 5 and c["t0"] < hi + 5])
    print("  crossings base:", [round(float(x),2) for x in between(np.asarray(cross0), lo, hi)])
    print("  crossings lob: ", [round(float(x),2) for x in between(np.asarray(cross2), lo, hi)])
    print("  table bounces: ", [round(float(x),2) for x in between(b['E']['bt_table'], lo, hi)], " all bounces:", [round(float(x),2) for x in between(b['E']['bt'], lo, hi)])
    print("  serves:", [s for s in E0.serves if lo <= s <= hi])
    print("  dense runs:", [(round(a,1), round(bb,1)) for a, bb in V2.runs(E0.ball_dense) if bb > lo and a < hi])
    # track in 0.25s steps: side (v) and corridor status
    line = []
    last_t = None
    for f in sorted(trk):
        t = f / fps
        if t < lo or t > hi: continue
        p = V2.project(H, *trk[f])
        if last_t is not None and t - last_t > 0.34: line.append(f"[gap {t-last_t:.1f}s]")
        last_t = t
        if not p: line.append("?"); continue
        u, v = p
        tag = ("N" if v < V2.NET_V - V2.NET_MARGIN_M else "F" if v > V2.NET_V + V2.NET_MARGIN_M else "=")
        if not V2.in_corridor(u, v): tag = tag.lower() + f"({u:.1f},{v:.1f})"
        line.append(tag)
    # compress runs of identical tags
    comp = []; 
    for x in line:
        if comp and comp[-1][0] == x: comp[-1][1] += 1
        else: comp.append([x, 1])
    print("  track from", lo, ":", " ".join(f"{x}x{n}" if n > 1 else x for x, n in comp))
