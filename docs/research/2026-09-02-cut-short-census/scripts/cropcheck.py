"""Did the ball leave the detection crop while the rally was still going?

The 2 September re-uploads were detected inside a box around the table
(worker.log records it). Anton's own uploads of the same files were
detected on the full frame, so their tracks say where the ball actually
was. Any sample above the box's top edge is a ball the cropped run could
not see.
"""
import json, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/docs/research/2026-09-02-cut-short-census/scripts")
import numpy as np
from replay import base
import points_v2 as V2

# crop box for the cropped run (w, h, x, y) straight from worker.log
CROP = {"m4": (1058, 596, 358, 162), "m5": (864, 484, 414, 254), "m6": (542, 304, 316, 122)}
# census point -> (uncropped dump of the same file, crop of the cropped run, window)
CASES = [
    ("m4 #4  (card ended 45.25)", "25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "m4", 39.1, 47.0, 45.25),
    ("m4 #65 (card ended 736.23)", "25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "m4", 728.5, 738.0, 736.23),
    ("m5 #57 (card ended 642.36)", "47b83b9b-ae34-4106-827d-be74d4bdf677", "m5", 635.5, 648.0, 642.36),
    ("m5 #74 (card ended 834.18)", "47b83b9b-ae34-4106-827d-be74d4bdf677", "m5", 829.2, 838.0, 834.18),
    ("m6 #17 (card ended 214.86)", "840b4635-7791-4538-b722-9cd17ae6ed34", "m6", 206.3, 220.0, 214.86),
]
db = json.load(open("/tmp/serve-diag/census/db_points.json"))
for label, dump, crop, lo, hi, cut in CASES:
    b = base(dump); trk = b["trk"]; fps = b["fps"]
    cw, ch, cx, cy = CROP[crop]
    top, bot, left, right = cy, cy + ch, cx, cx + cw
    rows = [(f / fps, x, y) for f, (x, y) in sorted(trk.items()) if lo <= f / fps <= hi]
    out = [(t, x, y) for t, x, y in rows if not (left <= x <= right and top <= y <= bot)]
    above = [(t, x, y) for t, x, y in out if y < top]
    near = [t for t, x, y in out if abs(t - cut) <= 3.0]
    print(f"\n{label}   crop {cw}x{ch} at ({cx},{cy}); the full-frame run tracked {len(rows)} samples in {lo}-{hi}s")
    print(f"   outside the crop: {len(out)}  (above its top edge: {len(above)})   within 3s of the cut: {len(near)}")
    if above:
        hs = sorted(above, key=lambda r: r[2])[:3]
        print(f"   highest samples (t, x, y): {[(round(t,2), int(x), int(y)) for t, x, y in hs]}   crop top edge y={top}")
        runs, cur = [], None
        for t, x, y in above:
            if cur and t - cur[1] < 0.4: cur[1] = t
            else:
                if cur: runs.append(tuple(cur))
                cur = [t, t]
        if cur: runs.append(tuple(cur))
        print(f"   spells above the box: {[(round(a,2), round(bb,2)) for a, bb in runs if bb - a > 0.05][:8]}")
    # what the UNCROPPED production run made of the same moment
    L = sorted(db.get(dump, []), key=lambda k: k["t0"])
    cover = [k for k in L if k["t0"] - 1 <= cut <= k["t1"] + 1]
    print(f"   the full-frame upload's own cards there: {[(round(k['t0'],2), round(k['t1'],2)) for k in cover]}")
