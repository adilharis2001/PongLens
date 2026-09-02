"""What does a real between-point pause look like, against taps? Longest quiet
stretch inside a point (serve contact -> tap) vs between points (tap -> next
serve contact), under three quiet definitions."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from replay import base, dump_ids, taps_for, light_E, between
import points_v2 as V2
from points_v2 import TICK

def longest_run(mask):
    best = run = 0
    for v in mask:
        run = run + 1 if not v else 0; best = max(best, run)
    return best * TICK
res = {"within": {k: [] for k in ("dense", "events", "both")}, "between": {k: [] for k in ("dense", "events", "both")}}
for mid in dump_ids:
    taps = taps_for(mid)
    if len(taps) < 20: continue
    b = base(mid); E = light_E(b, b["E"]["cross"])
    ev = np.zeros(E.n, bool)
    for t in list(E.cross) + list(E.bt_table):
        V2._mark(ev, t - 0.15, t + 0.15)
    serves = np.asarray(E.serves)
    for tp in taps:
        prev_s = serves[serves < tp - 1.0]
        if len(prev_s):
            s = float(prev_s[-1])
            if tp - s <= 40 and not any(s < x < tp for x in taps):
                i0, i1 = int((s + 0.5) / TICK), int((tp - 0.3) / TICK)
                if i1 > i0 + 5:
                    res["within"]["dense"].append(longest_run(E.ball_dense[i0:i1])); res["within"]["events"].append(longest_run(ev[i0:i1])); res["within"]["both"].append(longest_run(E.ball_dense[i0:i1] | ev[i0:i1]))
        nxt = serves[serves > tp + 0.5]
        if len(nxt):
            s2 = float(nxt[0])
            if s2 - tp <= 30 and not any(tp < x < s2 for x in taps):
                i0, i1 = int((tp + 0.3) / TICK), int((s2 - 0.3) / TICK)
                if i1 > i0 + 5:
                    res["between"]["dense"].append(longest_run(E.ball_dense[i0:i1])); res["between"]["events"].append(longest_run(ev[i0:i1])); res["between"]["both"].append(longest_run(E.ball_dense[i0:i1] | ev[i0:i1]))
for k in ("dense", "events", "both"):
    w = np.asarray(res["within"][k]); bw = np.asarray(res["between"][k])
    print(f"\nquiet = no {k}:  within a point n={len(w)}  between points n={len(bw)}")
    print(f"   within  : p50 {np.percentile(w,50):.1f}s p90 {np.percentile(w,90):.1f}s p95 {np.percentile(w,95):.1f}s p99 {np.percentile(w,99):.1f}s max {w.max():.1f}s")
    print(f"   between : p1 {np.percentile(bw,1):.1f}s p5 {np.percentile(bw,5):.1f}s p10 {np.percentile(bw,10):.1f}s p50 {np.percentile(bw,50):.1f}s min {bw.min():.1f}s")
    for thr in (0.6, 1.0, 1.5, 2.0, 2.5, 3.0):
        print(f"     threshold {thr:.1f}s: points that would be SPLIT {int((w >= thr).sum()):3d}/{len(w)} ({(w >= thr).mean()*100:4.1f}%)   gaps that would be MISSED {int((bw < thr).sum()):3d}/{len(bw)} ({(bw < thr).mean()*100:4.1f}%)")
