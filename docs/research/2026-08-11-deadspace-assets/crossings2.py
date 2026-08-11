"""Per-match breakdown of the zero-crossings rule + calibration sanity.

A real point MUST cross the net, so a kept window with dozens of ball
detections and zero measured crossings indicts the measurement (quad or
track), not the rule. Sanity check: what fraction of each match's KEPT
windows measure zero crossings — a per-match measurement-health score.
"""
import json
from collections import defaultdict
from pathlib import Path
import sys

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
                side = 0
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
    return n_cross


cas = defaultdict(int)
cap = defaultdict(lambda: [0, 0])
kept_zero = defaultdict(lambda: [0, 0])
for key, gt in sorted(GT.items()):
    m = load_match(key)
    if not m:
        continue
    det, H = m
    first_kept = min((a for a, b, dd in gt if not int(dd)), default=0)
    for a, b, dd in gt:
        if a < first_kept:
            continue
        nc = crossings(det, H, a, b)
        if int(dd):
            cap[key][1] += 1
            if nc == 0:
                cap[key][0] += 1
        else:
            kept_zero[key][1] += 1
            if nc == 0:
                kept_zero[key][0] += 1
                cas[key] += 1

print(f"{'match':16s} {'junk caught':>12s} {'KEPT killed':>12s} "
      f"{'kept zero-rate':>15s}")
for k in sorted(cap):
    c, t = cap[k]
    kz, kt = kept_zero[k]
    print(f"{k:16s} {c:>6d}/{t:<5d} {cas[k]:>12d} "
          f"{100*kz/max(1,kt):>13.1f}%")

healthy = [k for k in cap if kept_zero[k][0] / max(1, kept_zero[k][1]) < 0.03]
print(f"\nHEALTHY-MEASUREMENT matches (kept zero-rate < 3%): {healthy}")
jc = sum(cap[k][0] for k in healthy)
jt = sum(cap[k][1] for k in healthy)
kc = sum(cas[k] for k in healthy)
kt = sum(kept_zero[k][1] for k in healthy)
print(f"On healthy matches only: junk caught {jc}/{jt} "
      f"({100*jc/max(1,jt):.1f}%), kept killed {kc}/{kt} "
      f"({100*kc/max(1,kt):.2f}%)")
