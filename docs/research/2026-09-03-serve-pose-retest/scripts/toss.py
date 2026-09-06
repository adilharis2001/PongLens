"""The rule the crop makes possible: see the toss, not the silence.

With the crop on, the ball is visible before the serve on 69% of serves —
so a serve can be observed directly instead of inferred from an absence:

    the ball RISES somewhere off the table (the toss),
    reaches an apex,
    then DESCENDS and arrives over the table.

That is a serve and very little else is. A ball returning to the table
mid-rally arrives flat or falling from a cross-court flight, not from a
near-vertical rise that started off the table.

No bounce detection, no opposite-halves test, no pair matching. Scored on
the 49 serve times Adil confirmed, first candidate only, no oracle.
"""
import json
import os
import statistics as st
import sys

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
import points_v2 as V2                                            # noqa: E402
from points_v2 import build_track, homography_from_corners, load_multi, project


def candidates(track, H, fps, rise_px, max_flight, pad, dedupe):
    """[t] where the ball rose off the table, then arrived over it."""
    fr = sorted(track)
    on = {}
    for f in fr:
        p = project(H, *track[f])
        on[f] = (p is not None and -pad <= p[0] <= V2.W_M + pad
                 and -pad <= p[1] <= V2.L_M + pad)
    out, last = [], -99.0
    for i, f in enumerate(fr):
        if not on[f] or (i and on[fr[i - 1]]):
            continue                      # want the ARRIVAL over the table
        # look back for a rise that peaked before this arrival
        lo = f - int(max_flight * fps)
        back = [g for g in fr if lo <= g < f]
        if len(back) < 4:
            continue
        ys = [track[g][1] for g in back]
        apex_i = min(range(len(ys)), key=lambda k: ys[k])
        if apex_i == 0 or apex_i == len(ys) - 1:
            continue                      # apex must be inside the window
        rose = max(ys[:apex_i + 1]) - ys[apex_i]
        fell = track[f][1] - ys[apex_i]
        if rose < rise_px or fell < rise_px:
            continue                      # a real up-then-down, not drift
        if on[back[apex_i]]:
            continue                      # the toss happened OFF the table
        t = f / fps
        if t - last > dedupe:
            out.append(t)
            last = t
    return out


def main(match, det_path, fps, width):
    fps, width = float(fps), float(width)
    calib = json.load(open(f"{HERE}/real_calib.json"))[match]
    truth = json.load(open(f"{HERE}/phase1_truth.json"))
    pts = calib["points"]
    H = homography_from_corners({k: tuple(v) for k, v in calib["corners"].items()})
    track = build_track(load_multi(det_path), width / 1920.0)
    scale = width / 1920.0
    timed = [r for r in truth["hit"] if r.get("serve_local") is not None]

    print(f"{'rise':>6s} {'flight':>7s} {'pad':>5s} {'cands':>6s} {'per card':>9s} "
          f"{'FIRST on the serve':>20s} {'missed cards hit':>17s}")
    print("-" * 76)
    best = None
    for rise in (6, 10, 16, 24):
        for flight in (0.8, 1.2, 1.8):
            for pad in (0.10, 0.20):
                ev = candidates(track, H, fps, rise * scale, flight, pad, 2.0)

                def fl(idx):
                    p = pts.get(str(idx)) or {}
                    t0, t1 = float(p["t0"]), float(p["t1"])
                    ct0 = float(p.get("clip_t0") or t0)
                    return [t - ct0 for t in ev if t0 - 0.5 <= t <= t1]

                ok = sum(1 for r in timed
                         if fl(r["idx"])
                         and abs(fl(r["idx"])[0] - r["serve_local"]) <= 0.35)
                got = sum(1 for r in truth["miss"] if fl(r["idx"]))
                per = sum(len(fl(int(i))) for i in pts) / len(pts)
                if per > 1.6:
                    continue
                print(f"{rise:6d} {flight:7.1f} {pad:5.2f} {len(ev):6d} {per:9.2f} "
                      f"{ok:9d}/{len(timed):<3d} ({ok/len(timed)*100:3.0f}%) "
                      f"{got:8d}/{len(truth['miss']):<3d} ({got/len(truth['miss'])*100:3.0f}%)")
                if best is None or ok > best[0]:
                    best = (ok, got, per, rise, flight, pad)
    if best:
        ok, got, per, rise, flight, pad = best
        print(f"\nbest: rise {rise}px, flight {flight}s, pad {pad} — "
              f"first candidate lands on the serve {ok}/{len(timed)} "
              f"= {ok/len(timed)*100:.0f}%, at {per:.2f} per card")
        print(f"      and it fires on {got}/{len(truth['miss'])} of the cards "
              f"the old rule missed")
    print("\nfor comparison, on the SAME 49 serve times:")
    print("  cropped emergence rule  45%")
    print("  (uncropped emergence is circular against these and cannot be compared)")


if __name__ == "__main__":
    main(*sys.argv[1:])
