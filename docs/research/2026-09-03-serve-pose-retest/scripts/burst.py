"""Adil's rule: who was still, and then erupted?

No toss. No ball-near-wrist, no ball-rise, no ball-departure. The only
question asked of each player is whether they were quiet and then moved,
and the server is whoever's ratio is bigger.

Energy is the mean per-frame movement of the tracked keypoints, divided by
the player's own shoulder width, so a near player 128px tall and a far
player 87px tall are on the same scale.

Windows are placed off the serve's first bounce. Contact is 0.81s before it
(the physical constant the pipeline already uses), so the service stroke
lives around bounce-1.1 to bounce-0.4, and the ball is at rest on the palm
before that.

    quiet   [bounce-1.60, bounce-1.10]
    burst   [bounce-1.10, bounce-0.40]

Reuses the keypoints already computed — no new inference.
"""
import json
import math
import os
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
QUIET = (-1.60, -1.10)
BURST = (-1.10, -0.40)
SHOULDERS = (5, 6)
CONF = 0.30


def scale_of(pts):
    a, b = pts[SHOULDERS[0]], pts[SHOULDERS[1]]
    if a[2] < CONF or b[2] < CONF:
        return None
    d = math.hypot(a[0] - b[0], a[1] - b[1])
    return d if d > 4 else None


def energy_series(kp, side, fps):
    """[(t, movement per frame / shoulder width)] for one player."""
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
        for i in range(17):
            if pa[i][2] < CONF or pb[i][2] < CONF:
                continue
            moved += math.hypot(pb[i][0] - pa[i][0], pb[i][1] - pa[i][1])
            n += 1
        if n < 6:
            continue
        out.append((b / fps, moved / n / s))
    return out


def window_mean(series, lo, hi):
    v = [e for t, e in series if lo <= t <= hi]
    return st.mean(v) if len(v) >= 2 else None


def main(poses_path, boxes_path):
    P = json.load(open(poses_path))
    B = json.load(open(boxes_path))
    rows = []
    for pid, r in P.items():
        c = B.get(pid) or {}
        fb = c.get("fb_local")
        if fb is None or not r.get("truth") or not r.get("scored"):
            continue
        kp = r.get("keypoints") or {}
        fps = c["fps"]
        ratios = {}
        for side in ("near", "far"):
            s = energy_series(kp, side, fps)
            q = window_mean(s, fb + QUIET[0], fb + QUIET[1])
            b = window_mean(s, fb + BURST[0], fb + BURST[1])
            if q is None or b is None:
                continue
            ratios[side] = {"quiet": q, "burst": b, "ratio": b / (q + 1e-4)}
        if len(ratios) < 2:
            rows.append({"idx": c["idx"], "truth": r["truth"], "call": None,
                         "why": "one player only"})
            continue
        call = max(ratios, key=lambda s: ratios[s]["ratio"])
        margin = ratios[call]["ratio"] / (ratios["far" if call == "near" else "near"]["ratio"] + 1e-4)
        rows.append({"idx": c["idx"], "truth": r["truth"], "call": call,
                     "margin": margin, "ratios": ratios})
    dec = [x for x in rows if x["call"]]
    right = sum(1 for x in dec if x["call"] == x["truth"])
    print(f"{len(rows)} anchored scored cards, both players measurable on {len(dec)}")
    print(f"  called {len(dec)}/{len(rows)} ({len(dec)/len(rows)*100:.1f}%)   "
          f"right {right}/{len(dec)} ({right/len(dec)*100:.1f}%)")
    from collections import Counter
    print(f"  truth balance {dict(Counter(x['truth'] for x in rows))}")
    print(f"  calls         {dict(Counter(x['call'] for x in dec))}")
    # does demanding a clearer margin buy accuracy?
    print("\n  requiring the winner's ratio to beat the other by a margin:")
    for m in (1.0, 1.3, 1.7, 2.2, 3.0):
        sub = [x for x in dec if x["margin"] >= m]
        if len(sub) < 5:
            continue
        r2 = sum(1 for x in sub if x["call"] == x["truth"])
        print(f"    margin >= {m:3.1f}   n={len(sub):3d}  right {r2:3d} ({r2/len(sub)*100:5.1f}%)")
    # is the raw quiet->burst jump itself real?
    qs = [x["ratios"][x["truth"]]["quiet"] for x in dec]
    bs = [x["ratios"][x["truth"]]["burst"] for x in dec]
    print(f"\n  the TRUE server: quiet {st.median(qs):.3f} -> burst {st.median(bs):.3f} "
          f"({st.median(bs)/st.median(qs):.2f}x)")
    other = ["far" if x["truth"] == "near" else "near" for x in dec]
    qo = [x["ratios"][o]["quiet"] for x, o in zip(dec, other)]
    bo = [x["ratios"][o]["burst"] for x, o in zip(dec, other)]
    print(f"  the RECEIVER : quiet {st.median(qo):.3f} -> burst {st.median(bo):.3f} "
          f"({st.median(bo)/st.median(qo):.2f}x)")
    json.dump(rows, open(f"{HERE}/burst_rows.json", "w"), indent=1, default=str)


if __name__ == "__main__":
    main(*sys.argv[1:])
