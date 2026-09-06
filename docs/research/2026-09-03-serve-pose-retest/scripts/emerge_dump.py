"""Per-card emergence candidates at the chosen setting, for the review page.

gap 2.0 s, pad 0.20 m — the setting that fires about once per card. Also
records the whole ball track in card-local time so the page can draw the
ball appearing rather than just assert that it did.
"""
import json
import os
import sys

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, os.path.join(HERE, "../servemiss/scripts"))
from reload import load                                          # noqa: E402
import points_v2 as V2                                           # noqa: E402
from points_v2 import project                                    # noqa: E402

GAP, PAD, K = 2.0, 0.20, 0.81


def main(match):
    b, E = load(f"{HERE}/../servemiss/bundles/crossings/{match}.json")
    calib = json.load(open(f"{HERE}/real_calib.json"))[match]
    pts = calib["points"]
    over, last, ev = [], -99.0, []
    for f in sorted(E.track):
        p = project(E.H, *E.track[f])
        if p is None:
            continue
        if -PAD <= p[0] <= V2.W_M + PAD and -PAD <= p[1] <= V2.L_M + PAD:
            t = f / E.fps
            over.append(t)
            if t - last > GAP:
                ev.append(t)
            last = t
    out = {}
    for idx, p in pts.items():
        t0, t1 = float(p["t0"]), float(p["t1"])
        ct0 = float(p.get("clip_t0") or t0)
        inside = [t for t in ev if t0 - 0.5 <= t <= t1]
        ss = p.get("serve_s")
        out[idx] = {
            "emerge_local": [round(t - ct0, 3) for t in inside],
            "serve_local": None if ss is None else round(float(ss) - ct0, 3),
            "bounce_local": None if ss is None else round(float(ss) + K - ct0, 3),
            "has_serve": ss is not None,
        }
    json.dump(out, open(f"{HERE}/emerge_cards_{match[:8]}.json", "w"))
    n = sum(1 for v in out.values() if v["emerge_local"])
    print(f"{match[:8]}: {len(out)} cards, emergence on {n}")


if __name__ == "__main__":
    for m in sys.argv[1:]:
        main(m)
