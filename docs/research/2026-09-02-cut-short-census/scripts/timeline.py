import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from replay import base, light_E, assemble, crossings_lob, between, taps_for
import points_v2 as V2
cases = [("25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "m4 #4", 40.0, 52.0), ("25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "m4 #65", 730.0, 742.0),
         ("44c85a9b-14e8-4af2-b5c2-d021d84fa763", "Young2 1034-1061 two points no pause", 1033.0, 1062.0),
         ("47b83b9b-ae34-4106-827d-be74d4bdf677", "26Aug/81 #58 33s rally", 757.0, 790.0)]
for mid, name, lo, hi in cases:
    b = base(mid); trk, H, fps = b["trk"], b["H"], b["fps"]
    cross0 = list(b["E"]["cross"]); cross2 = crossings_lob(trk, H, fps, 2.0, False, 0.0, b["E"]["bt_table"])
    E0 = light_E(b, cross0); cards = sorted(assemble(E0), key=lambda c: c["t0"])
    # per-bounce half
    halves = {}
    for f, x, y in b["bnc"]:
        p = V2.project(H, x, y)
        if p and -0.15 <= p[0] <= V2.W_M + 0.15 and -0.15 <= p[1] <= V2.L_M + 0.15:
            halves[round(f / fps, 2)] = "n" if p[1] < V2.NET_V else "f"
    n = int((hi - lo) / 0.1) + 1
    tags = [[] for _ in range(n)]
    for f in sorted(trk):
        t = f / fps
        if not (lo <= t <= hi): continue
        p = V2.project(H, *trk[f]); i = int((t - lo) / 0.1)
        if not p: tags[i].append("?"); continue
        u, v = p
        s = "N" if v < V2.NET_V - V2.NET_MARGIN_M else "F" if v > V2.NET_V + V2.NET_MARGIN_M else "="
        tags[i].append(s if V2.in_corridor(u, v) else s.lower())
    print(f"\n=== {name} ({mid[:8]}) {lo}-{hi}s   serves {[s for s in E0.serves if lo-2 <= s <= hi]}  taps {[round(t,1) for t in taps_for(mid) if lo <= t <= hi]}")
    print("  cards:", [(round(c['t0'],1), round(c['t1'],1), 'S' if c.get('serve_s') else '-') for c in cards if c["t1"] > lo and c["t0"] < hi])
    line1 = ""; line2 = ""; line3 = ""
    for i in range(n):
        t = lo + i * 0.1
        tg = tags[i]
        if not tg: c = "."
        else:
            up = [x for x in tg if x in "NF="]
            c = max(set(up), key=up.count) if up else max(set(tg), key=tg.count)
        line1 += c
        xb = any(abs(x - t) < 0.05 for x in cross0); xl = any(abs(x - t) < 0.05 for x in cross2)
        line2 += ("X" if xb else "x" if xl else " ")
        bt = [h for tb, h in halves.items() if abs(tb - t) < 0.05]
        line3 += (bt[0] if bt else " ")
    for k in range(0, n, 100):
        print(f"  t={lo + k*0.1:7.1f}  track  {line1[k:k+100]}")
        print(f"           cross  {line2[k:k+100]}")
        print(f"           bounce {line3[k:k+100]}")
print("\nlegend: track N/F = in corridor near/far, = net band, n/f = OUT of corridor (high ball or player deep), . = untracked; cross X = current, x = lob rule only; bounce n/f = table bounce half")
