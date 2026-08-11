"""Adil's hypothesis: much mid-match junk is a HANDOVER — one player lobbing
the ball to the other because serve switched — and sometimes the ball never
crosses the table at all. Test: count genuine net crossings per labelled
window in table coordinates. If "zero crossings" (or "one un-returned
crossing") is junk-pure, it is an easy win the window statistics missed,
because crossings are EVENTS, not window averages.

A crossing = the projected ball moves from clearly one side of the net to
clearly the other (dwell >= 2 detections per side, laterally near the table,
no teleports between detections).
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_pipeline as pp                                  # noqa: E402

ROOT = Path(__file__).parent
GT = json.loads((ROOT / "gt_all.json").read_text())
L, W = pp.L_M, pp.W_M
NET, MARGIN = L / 2, 0.20


def load_match(key):
    mj = ROOT / f"pts_{key}" / "match.json"
    bb = ROOT / f"{key}.blurball.jsonl"
    if not (mj.exists() and bb.exists()):
        return None
    d = json.loads(mj.read_text())
    corners = ((d.get("calibration") or {}).get("table_corners_px") or {})
    if len(corners) != 4:
        return None
    quad = np.asarray([corners[k] for k in ("A_near_1", "B_near_2",
                                            "C_far_2", "D_far_1")], np.float32)
    _s, H, _e, _r = pp._canonical_calibration_geometry(quad)
    fps = ((d.get("video") or {}).get("fps")) or 30.0
    det = []
    for line in bb.open():
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("x") is not None:
            det.append((int(r["f"]) / fps, float(r["x"]), float(r["y"])))
    det.sort()
    return det, H


def crossings(det, H, t0, t1):
    """Count net crossings between t0 and t1; also return side coverage."""
    pts = []
    for t, x, y in det:
        if not (t0 <= t <= t1):
            continue
        p = H @ np.array([x, y, 1.0])
        if abs(p[2]) < 1e-9:
            continue
        u, v = p[0] / p[2], p[1] / p[2]
        if -0.7 <= u <= W + 0.7 and -1.5 <= v <= L + 1.5:
            pts.append((t, v))
    n_cross, side, streak, last_t = 0, 0, 0, None
    for t, v in pts:
        s = 1 if v > NET + MARGIN else (-1 if v < NET - MARGIN else 0)
        if s == 0 or (last_t is not None and t - last_t > 0.35):
            streak = 0 if s == 0 else 1
            if s != 0 and last_t is not None and t - last_t > 0.35:
                side = 0          # trajectory break: restart side tracking
            last_t = t
            if s != 0 and side == 0:
                side = s
            continue
        last_t = t
        if s == side:
            streak += 1
        else:
            streak += 1
            if streak >= 2 and side != 0:
                n_cross += 1
                side, streak = s, 1
            elif side == 0:
                side, streak = s, 1
    return n_cross, len(pts)


hist = {0: [0, 0], 1: [0, 0], 2: [0, 0], 3: [0, 0]}   # crossings -> [junk, kept]
zero_kept = []
n_matches = 0
for key, gt in sorted(GT.items()):
    m = load_match(key)
    if not m:
        continue
    det, H = m
    n_matches += 1
    first_kept = min((a for a, b, dd in gt if not int(dd)), default=0)
    for a, b, dd in gt:
        if a < first_kept:
            continue                                   # mid-match only
        nc, npts = crossings(det, H, a, b)
        bucket = min(nc, 3)
        hist[bucket][0 if int(dd) else 1] += 1
        if nc == 0 and not int(dd):
            zero_kept.append((key, a, b, npts))

print(f"{n_matches} matches with calibration+track\n")
print(f"{'crossings':>10s} {'junk':>6s} {'kept':>6s} {'junk share':>11s}")
for k in sorted(hist):
    j, ke = hist[k]
    lbl = f"{k}" if k < 3 else "3+"
    tot = j + ke
    print(f"{lbl:>10s} {j:>6d} {ke:>6d} {100*j/max(1,tot):>10.1f}%")

print(f"\nRule 'zero crossings -> junk': kills {len(zero_kept)} kept points")
for key, a, b, npts in zero_kept[:10]:
    print(f"  KEPT with 0 crossings: {key} [{a:.1f}-{b:.1f}] "
          f"({b-a:.1f}s, {npts} ball detections in window)")
