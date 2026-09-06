"""Adil's ball check: does the ball suddenly emerge over the table?

Not a two-bounce motif. No bounce detection at all, no apex, no
opposite-halves test. Just: the ball was not being seen over the table, and
then it was — which is what a serve looks like from the tracker's point of
view, because before the serve the ball is held in a hand, unblurred, and
BlurBall finds a blurred ball.

An EMERGENCE is a frame where the ball projects inside the table (plus a
pad), preceded by at least GAP_S seconds with no tracked ball over the
table at all.

Judged against the shipped serve rule's own mark on cards that have one:
how close does the first emergence land to the known serve contact, and on
cards with NO serve mark, does an emergence exist at all?
"""
import json
import os
import sys
import statistics as st

import numpy as np

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, os.path.join(HERE, "../servemiss/scripts"))

from reload import load                                          # noqa: E402
import points_v2 as V2                                           # noqa: E402
from points_v2 import project                                    # noqa: E402

GAP_S = 0.50        # how long the ball must have been unseen over the table
PAD_M = 0.45        # same surface pad the serve rule already uses
CONTACT_LOOKBACK_S = 0.81


def emergences(E, pad=PAD_M, gap=GAP_S):
    """[t] where the ball reappears over the table after a gap."""
    over = []
    for f in sorted(E.track):
        p = project(E.H, *E.track[f])
        if p is None:
            continue
        if -pad <= p[0] <= V2.W_M + pad and -pad <= p[1] <= V2.L_M + pad:
            over.append(f / E.fps)
    out, last = [], -99.0
    for t in over:
        if t - last > gap:
            out.append(t)
        last = t
    return out


def main(match):
    b, E = load(f"{HERE}/../servemiss/bundles/crossings/{match}.json")
    calib = json.load(open(f"{HERE}/real_calib.json"))[match]
    pts = calib["points"]
    ev = emergences(E)
    print(f"{match[:8]}: {len(ev)} ball emergences over the whole match "
          f"({len(E.track)} tracked frames, {b['duration']:.0f}s)\n")

    anchored, unanchored, rows = [], [], []
    for idx, p in pts.items():
        t0, t1 = float(p["t0"]), float(p["t1"])
        inside = [t for t in ev if t0 - 0.5 <= t <= t1]
        ss = p.get("serve_s")
        rec = {"idx": int(idx), "t0": t0, "t1": t1, "serve_s": ss,
               "emergences": [round(t, 2) for t in inside]}
        if ss is not None:
            fb = float(ss) + CONTACT_LOOKBACK_S
            if inside:
                near = min(inside, key=lambda t: abs(t - fb))
                rec["err_vs_first_bounce"] = round(near - fb, 2)
                anchored.append(near - fb)
            rows.append(rec)
        else:
            unanchored.append(1 if inside else 0)
            rows.append(rec)

    print("CARDS THAT ALREADY HAVE A SERVE MARK — how close is the emergence?")
    if anchored:
        a = sorted(anchored)
        within = lambda s: sum(1 for x in a if abs(x) <= s) / len(a) * 100
        print(f"  n={len(a)}  median error {st.median(a):+.2f}s   "
              f"|err| <=0.3s {within(0.3):.0f}%   <=0.5s {within(0.5):.0f}%   "
              f"<=1.0s {within(1.0):.0f}%")
    have = sum(1 for r in rows if r["serve_s"] is not None and r["emergences"])
    tot = sum(1 for r in rows if r["serve_s"] is not None)
    print(f"  an emergence exists inside the card on {have}/{tot} of them\n")

    print("CARDS WITH NO SERVE MARK — does an emergence exist anyway?")
    if unanchored:
        print(f"  n={len(unanchored)}  emergence found on "
              f"{sum(unanchored)}/{len(unanchored)} "
              f"({sum(unanchored)/len(unanchored)*100:.0f}%)")
    per = [len(r["emergences"]) for r in rows]
    print(f"\n  emergences per card: median {st.median(per):.0f}, "
          f"mean {st.mean(per):.1f}  — a card holds one serve, so anything "
          f"above 1 is the rule firing more than once")
    json.dump(rows, open(f"{HERE}/emerge_{match[:8]}.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
