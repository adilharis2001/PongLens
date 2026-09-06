"""The emergence rule judged the way a detector has to be judged.

The first pass took the emergence CLOSEST to the known serve, which is
oracle selection — a real detector does not know the answer. This takes the
FIRST emergence inside the card, which is the only choice available without
one, and sweeps the two knobs: how long the ball must have been unseen, and
how far outside the table still counts as over it.
"""
import json
import os
import statistics as st
import sys

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, os.path.join(HERE, "../servemiss/scripts"))
from reload import load                                          # noqa: E402
import points_v2 as V2                                           # noqa: E402
from points_v2 import project                                    # noqa: E402

K = 0.81


def over_table(E, pad):
    out = []
    for f in sorted(E.track):
        p = project(E.H, *E.track[f])
        if p is None:
            continue
        if -pad <= p[0] <= V2.W_M + pad and -pad <= p[1] <= V2.L_M + pad:
            out.append(f / E.fps)
    return out


def main(match):
    b, E = load(f"{HERE}/../servemiss/bundles/crossings/{match}.json")
    pts = json.load(open(f"{HERE}/real_calib.json"))[match]["points"]
    print(f"{match[:8]}\n")
    print(f"{'gap':>5s} {'pad':>5s} {'per card':>9s} "
          f"{'FIRST: <=0.3s':>14s} {'<=0.5s':>8s} {'median err':>11s} "
          f"{'unanchored hit':>15s}")
    print("-" * 74)
    for pad in (0.45, 0.20):
        cache = over_table(E, pad)
        for gap in (0.4, 0.6, 0.8, 1.2, 1.6, 2.0):
            ev, last = [], -99.0
            for t in cache:
                if t - last > gap:
                    ev.append(t)
                last = t
            errs, per, unan_hit, unan_n = [], [], 0, 0
            for idx, p in pts.items():
                t0, t1 = float(p["t0"]), float(p["t1"])
                inside = [t for t in ev if t0 - 0.5 <= t <= t1]
                per.append(len(inside))
                ss = p.get("serve_s")
                if ss is None:
                    unan_n += 1
                    unan_hit += bool(inside)
                elif inside:
                    errs.append(inside[0] - (float(ss) + K))
            if not errs:
                continue
            w3 = sum(1 for x in errs if abs(x) <= 0.3) / len(errs) * 100
            w5 = sum(1 for x in errs if abs(x) <= 0.5) / len(errs) * 100
            print(f"{gap:5.1f} {pad:5.2f} {st.mean(per):9.1f} "
                  f"{w3:13.0f}% {w5:7.0f}% {st.median(errs):+10.2f}s "
                  f"{unan_hit}/{unan_n:>3d} ({unan_hit/max(unan_n,1)*100:.0f}%)")


if __name__ == "__main__":
    main(sys.argv[1])
