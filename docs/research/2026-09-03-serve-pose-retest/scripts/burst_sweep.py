"""Does ANY reading of "still, then erupts" separate server from receiver?

One parameterisation failing proves nothing, so this sweeps the three
choices that matter — which body parts count as movement, where the quiet
window sits, and where the burst window sits — and reports, for each, how
often the louder player is the one who actually served.

50% is a coin flip. The measure is deliberately symmetric: both players get
the identical treatment, so a bias can only come from the players.
"""
import json
import math
import os
import statistics as st
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CONF = 0.30
PARTS = {
    "all 17": list(range(17)),
    "wrists": [9, 10],
    "arms (wrist+elbow)": [7, 8, 9, 10],
    "upper body": [5, 6, 7, 8, 9, 10, 11, 12],
    "trunk": [5, 6, 11, 12],
}
WINDOWS = [
    ((-1.60, -1.10), (-1.10, -0.40)),
    ((-1.60, -1.20), (-1.20, -0.60)),
    ((-1.60, -0.90), (-0.90, -0.20)),
    ((-1.40, -0.80), (-0.80, 0.00)),
    ((-1.60, -1.00), (-0.60, 0.20)),
]


def scale_of(p):
    a, b = p[5], p[6]
    if a[2] < CONF or b[2] < CONF:
        return None
    d = math.hypot(a[0] - b[0], a[1] - b[1])
    return d if d > 4 else None


def series(kp, side, fps, idxs):
    fr = sorted(int(f) for f in kp if kp[f].get(side))
    out = []
    for a, b in zip(fr, fr[1:]):
        if b - a > 3:
            continue
        pa, pb = kp[str(a)][side], kp[str(b)][side]
        s = scale_of(pa) or scale_of(pb)
        if not s:
            continue
        moved, n = 0.0, 0
        for i in idxs:
            if pa[i][2] < CONF or pb[i][2] < CONF:
                continue
            moved += math.hypot(pb[i][0] - pa[i][0], pb[i][1] - pa[i][1])
            n += 1
        if n < max(2, len(idxs) // 3):
            continue
        out.append((b / fps, moved / n / s))
    return out


def wmean(s, lo, hi):
    v = [e for t, e in s if lo <= t <= hi]
    return st.mean(v) if len(v) >= 2 else None


def main(poses_path, boxes_path):
    P = json.load(open(poses_path))
    B = json.load(open(boxes_path))
    cards = []
    for pid, r in P.items():
        c = B.get(pid) or {}
        if c.get("fb_local") is None or not r.get("truth") or not r.get("scored"):
            continue
        cards.append((r.get("keypoints") or {}, c["fps"], c["fb_local"], r["truth"]))
    print(f"{len(cards)} anchored scored cards\n")
    print(f"{'body parts':22s} {'quiet':>14s} {'burst':>14s} {'n':>4s} {'ratio rule':>11s} "
          f"{'burst-only':>11s}")
    print("-" * 82)
    best = None
    for pname, idxs in PARTS.items():
        for q, b in WINDOWS:
            ok = tot = ok2 = 0
            for kp, fps, fb, truth in cards:
                vals = {}
                for side in ("near", "far"):
                    s = series(kp, side, fps, idxs)
                    qv = wmean(s, fb + q[0], fb + q[1])
                    bv = wmean(s, fb + b[0], fb + b[1])
                    if qv is None or bv is None:
                        continue
                    vals[side] = (qv, bv)
                if len(vals) < 2:
                    continue
                tot += 1
                ratio = {s: v[1] / (v[0] + 1e-4) for s, v in vals.items()}
                ok += (max(ratio, key=ratio.get) == truth)
                burst = {s: v[1] for s, v in vals.items()}
                ok2 += (max(burst, key=burst.get) == truth)
            if not tot:
                continue
            r1, r2 = ok / tot * 100, ok2 / tot * 100
            print(f"{pname:22s} {str(q):>14s} {str(b):>14s} {tot:4d} {r1:10.1f}% {r2:10.1f}%")
            for label, val in (("ratio", r1), ("burst", r2)):
                if best is None or abs(val - 50) > abs(best[0] - 50):
                    best = (val, pname, q, b, label, tot)
    print()
    v, pn, q, b, lab, n = best
    print(f"furthest from a coin flip: {v:.1f}% — {lab} rule, {pn}, quiet {q}, burst {b}, n={n}")
    print("(furthest from 50 in EITHER direction; below 50 means it points at the receiver)")


if __name__ == "__main__":
    main(*sys.argv[1:])
