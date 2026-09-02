"""What are the crossings the lob rule adds? On matches with taps, a crossing
is IN PLAY if it sits inside a card before that card's tap, and BETWEEN
POINTS if it comes after the tap or in dead time. The filters are then read
by how many of each they keep."""
import json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from replay import base, dump_ids, taps_for, meta, crossings_lob, assemble, light_E, between
import points_v2 as V2

LOB = 2.0
tot = {}
for mid in dump_ids:
    taps = taps_for(mid)
    if len(taps) < 20:
        continue
    b = base(mid); trk, H, fps = b["trk"], b["H"], b["fps"]
    base_cross = list(b["E"]["cross"]); bt_table = b["E"]["bt_table"]
    E0 = light_E(b, base_cross); cards = sorted(assemble(E0), key=lambda c: c["t0"])
    times = np.asarray(sorted(f / fps for f in trk))
    # gap crossings with their gap and provenance
    pts = []
    for f in sorted(trk):
        p = V2.project(H, *trk[f])
        if p and V2.in_corridor(*p):
            pts.append((f / fps, p[1]))
    out, side, streak, last, pending = [], 0, 0, None, None
    for t, v in pts:
        s = 1 if v > V2.NET_V + V2.NET_MARGIN_M else (-1 if v < V2.NET_V - V2.NET_MARGIN_M else 0)
        gap = None if last is None else t - last
        if s == 0 or (gap is not None and gap > V2.TELEPORT_S):
            streak = 0 if s == 0 else 1
            if s != 0 and gap is not None and gap > V2.TELEPORT_S:
                if gap <= LOB:
                    pending = (gap, last, t)
                else:
                    side = 0; pending = None
            last = t
            if s != 0 and side == 0:
                side = s
            continue
        last = t; streak += 1
        if s != side and streak >= V2.DWELL and side != 0:
            out.append((t, pending)); side, streak = s, 1; pending = None
        elif side == 0:
            side, streak = s, 1
        if pending and streak >= 3:
            pending = None
    lo, hi = min(taps) - 30, max(taps) + 30
    for t, pend in out:
        if pend is None or not (lo <= t <= hi):
            continue
        gap, a, b_ = pend
        i = np.searchsorted(times, a, side="right"); j = np.searchsorted(times, b_, side="left")
        seen = j > i
        bounce = bool(len(between(bt_table, t, t + 1.5)))
        card = next((c for c in cards if c["t0"] <= t <= c["t1"]), None)
        if card:
            ctaps = [x for x in taps if card["t0"] <= x <= card["t1"] + 0.5]
            state = "in play" if (ctaps and t <= min(ctaps)) else ("after tap" if ctaps else "untapped card")
        else:
            state = "dead time"
        nxt_cross = min((c for c in base_cross if c > t + 0.05), default=None)
        follow = nxt_cross is not None and nxt_cross - t <= V2.CROSS_GAP_S
        key = (state, seen, bounce, follow)
        tot[key] = tot.get(key, 0) + 1
print(f"gap crossings (gap {V2.TELEPORT_S}-{LOB}s) on tapped matches, by where they fall:")
print(f"  {'state':14s} {'seen in gap':11s} {'bounce<=1.5s':12s} {'next cross<=3s':14s} n")
for k in sorted(tot, key=lambda k: (k[0], -tot[k])):
    print(f"  {k[0]:14s} {str(k[1]):11s} {str(k[2]):12s} {str(k[3]):14s} {tot[k]}")
def agg(pred):
    inplay = sum(v for k, v in tot.items() if k[0] == "in play" and pred(k)); other = sum(v for k, v in tot.items() if k[0] != "in play" and pred(k))
    return inplay, other
for name, pred in (("no filter", lambda k: True), ("seen in gap", lambda k: k[1]), ("bounce after", lambda k: k[2]), ("seen AND bounce", lambda k: k[1] and k[2]),
                   ("bounce OR next cross", lambda k: k[2] or k[3]), ("seen AND (bounce OR next)", lambda k: k[1] and (k[2] or k[3]))):
    i, o = agg(pred); print(f"  filter {name:26s}: in play {i:3d}   after tap / dead / untapped {o:3d}")
