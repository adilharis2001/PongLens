"""Cropped vs uncropped, scored the way a detector has to be scored.

The previous sweep rewarded "a flash exists somewhere in the card", which
any high-firing setting wins — 29 of 29 recovered at 4.4 flashes a card is
not a detector, it is a strobe. So:

  ACCURACY  does the FIRST flash in the card land within 0.35 s of the
            serve? No oracle, no picking the closest of four.
  COST      flashes per card. One is the target; a card holds one serve.

Both runs are scored by the identical function, and the 49 timestamps come
from Adil's own verdicts on the uncropped run — which makes them slightly
generous to the uncropped arm, since they were defined by its flashes. Any
gain the cropped arm shows is therefore a floor, not a ceiling.
"""
import json
import os
import sys

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, os.path.join(HERE, "../servemiss/scripts"))
import points_v2 as V2                                            # noqa: E402
from points_v2 import build_track, homography_from_corners, load_multi, project
from reload import load as load_bundle                            # noqa: E402


def score(proj, pts, truth, gap, pad, fps):
    over = sorted(t for t, p in proj.items()
                  if -pad <= p[0] <= V2.W_M + pad and -pad <= p[1] <= V2.L_M + pad)
    ev, last = [], -99.0
    for t in over:
        if t - last > gap:
            ev.append(t)
        last = t

    def flashes(idx):
        p = pts.get(str(idx)) or {}
        t0, t1 = float(p["t0"]), float(p["t1"])
        ct0 = float(p.get("clip_t0") or t0)
        return [t - ct0 for t in ev if t0 - 0.5 <= t <= t1]

    timed = [r for r in truth["hit"] if r.get("serve_local") is not None]
    first_ok = sum(1 for r in timed
                   if flashes(r["idx"])
                   and abs(flashes(r["idx"])[0] - r["serve_local"]) <= 0.35)
    got = sum(1 for r in truth["miss"] if flashes(r["idx"]))
    per = sum(len(flashes(int(i))) for i in pts) / len(pts)
    return first_ok, len(timed), got, len(truth["miss"]), per, len(ev)


def projections(track, H, fps):
    out = {}
    for f in sorted(track):
        p = project(H, *track[f])
        if p is not None:
            out[f / fps] = p
    return out


def main(match, det_path, fps, width):
    fps, width = float(fps), float(width)
    calib = json.load(open(f"{HERE}/real_calib.json"))[match]
    truth = json.load(open(f"{HERE}/phase1_truth.json"))
    pts = calib["points"]
    H = homography_from_corners({k: tuple(v) for k, v in calib["corners"].items()})

    cropped = projections(build_track(load_multi(det_path), width / 1920.0), H, fps)
    b, E = load_bundle(f"{HERE}/../servemiss/bundles/crossings/{match}.json")
    uncropped = projections(E.track, E.H, E.fps)
    print(f"ball projected onto the table: uncropped {len(uncropped)} frames, "
          f"cropped {len(cropped)} (+{len(cropped)/len(uncropped)*100-100:.0f}%)\n")

    print(f"{'run':10s} {'gap':>5s} {'pad':>5s} {'per card':>9s} "
          f"{'FIRST flash on the serve':>25s} {'missed cards w/ a flash':>24s}")
    print("-" * 84)
    best = {}
    for name, proj in (("uncropped", uncropped), ("cropped", cropped)):
        for pad in (0.10, 0.20, 0.45):
            for gap in (0.4, 0.6, 0.8, 1.0, 1.4, 2.0):
                ok, n, got, m, per, nev = score(proj, pts, truth, gap, pad, fps)
                if per > 1.6:            # a strobe is not a detector
                    continue
                key = name
                if key not in best or ok > best[key][0]:
                    best[key] = (ok, n, got, m, per, gap, pad)
                print(f"{name:10s} {gap:5.1f} {pad:5.2f} {per:9.2f} "
                      f"{ok:10d}/{n:<3d} ({ok/n*100:4.0f}%) "
                      f"{got:14d}/{m:<3d} ({got/m*100:3.0f}%)")
    print()
    for name, v in best.items():
        ok, n, got, m, per, gap, pad = v
        print(f"BEST {name:10s} gap {gap} pad {pad}: first flash right "
              f"{ok}/{n} = {ok/n*100:.0f}%, at {per:.2f} flashes/card, "
              f"and a flash appears on {got}/{m} of the cards it used to miss")


if __name__ == "__main__":
    main(*sys.argv[1:])
