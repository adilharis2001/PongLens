"""The ball's own record around each flagged ending.

serves.json holds, per card, the tracked positions in table coordinates via
the match quad, every bounce with its half of the table, and the net
crossings. A card's arrays stop at its end, so the next card's arrays show
what the ball did after the cut. The dead gap between them is the blind
spot, and its length is printed.
"""
import json, glob, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import numpy as np
import points_v2 as V2
from table_coordinates import canonicalize_table_quad, table_homography

W = "/tmp/serve-diag/census"
rows = [r for r in json.load(open(f"{W}/verdicts_joined.json")) if r["verdict"] == "real"]
sj = {os.path.basename(p).split(".")[0]: json.load(open(p)) for p in glob.glob(f"{W}/*.serves.json")}
CORNER = ["A_near_1", "B_near_2", "C_far_2", "D_far_1"]

def homog(page):
    q = page["quad"]
    corners = [tuple(p) for p in q] if isinstance(q, list) else [tuple(q[k]) for k in CORNER]
    return table_homography(canonicalize_table_quad(corners, near_pair=(0, 1)))

for r in sorted(rows, key=lambda r: (r["match"], r["point"])):
    mid = r["match_id"]; page = sj[mid]; H = homog(page)
    w, h = float(page["w"]), float(page["h"])
    cards = sorted(page["cards"], key=lambda c: c["t0"])
    me = min(cards, key=lambda c: abs(c["t0"] - r["db"]["me"]["t0"]))
    i = cards.index(me); nxt = cards[i + 1] if i + 1 < len(cards) else None
    t1 = me["t1"]
    print(f"\n=== {r['match'][:38]} point {r['point']}   card {me['t0']:.2f}-{t1:.2f}  serve {me.get('serve_s')}")
    xs = me.get("crossings") or []
    gaps = [round(b - a, 2) for a, b in zip(xs, xs[1:])]
    print(f"    net crossings {[round(x,2) for x in xs]}")
    print(f"    gaps between them {gaps}   (the chain stops following the rally at a gap over {V2.CROSS_GAP_S}s)")
    tb = [(b['t'], 'near' if b['v'] < V2.NET_V else 'far') for b in me["bounces"] if b.get("onTable")]
    off = [(b['t'], round(b['u'],2), round(b['v'],2)) for b in me["bounces"] if not b.get("onTable") and b.get('u') is not None]
    print(f"    table bounces {[(round(t,2), s) for t, s in tb]}")
    if off: print(f"    bounces projecting OFF the table (t, across, along) {off[-4:]}")
    for label, c in (("this card, last 3.5s", me), ("next card, first 3.5s", nxt)):
        if not c: continue
        lo, hi = (t1 - 3.5, t1) if c is me else (c["t0"], c["t0"] + 3.5)
        pts = [(t, x, y) for t, x, y in c["track"] if lo <= t <= hi]
        line = []
        prev_t = None
        for t, x, y in pts:
            p = V2.project(H, x * w, y * h)
            if prev_t is not None and t - prev_t > 0.34:
                line.append(f"[not seen {t-prev_t:.1f}s]")
            prev_t = t
            if not p:
                line.append("?"); continue
            u, v = p
            s = "N" if v < V2.NET_V - V2.NET_MARGIN_M else "F" if v > V2.NET_V + V2.NET_MARGIN_M else "="
            line.append(s if V2.in_corridor(u, v) else f"{s.lower()}[{u:+.0f},{v:+.0f}]")
        comp = []
        for x in line:
            if comp and comp[-1][0] == x: comp[-1][1] += 1
            else: comp.append([x, 1])
        print(f"    {label} ({lo:.1f}-{hi:.1f}): " + " ".join(f"{a}x{n}" if n > 1 else a for a, n in comp))
    if nxt:
        print(f"    blind gap {nxt['t0'] - t1:.2f}s, then the next card opens (serve {nxt.get('serve_s')}, "
              f"first crossing {(nxt.get('crossings') or ['-'])[0]})")
print("\nlegend: N near half, F far half, = within 20cm of the net, lowercase [across,along] = the ball's")
print("ground projection is outside the table corridor, which is what a high ball does. Distances in metres,")
print("table 1.525 wide by 2.74 long.")
