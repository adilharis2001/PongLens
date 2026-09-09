"""Keep each player's identity through the moments the detector loses them.
    python pose_fix.py <in pose.json> <out pose.json> hold|nan
Three repairs, in order, per sample:
  1. duplicate / swap: a 'near' box that sits on the far player's box (IoU>0.5)
     is the far player, not a new near player -> near becomes missing (and if
     the far slot was empty, the box moves there).
  2. clipped: a box touching the window edge and narrower than 60% of that
     player's recent width is a body walking out of the picture -> missing.
  3. fill: 'hold' carries the last full-body pose forward for up to 2s;
     'nan' leaves the player missing (unknown to the model)."""
import json, sys, numpy as np
src, dst, mode = sys.argv[1:4]
P = json.load(open(src)); fps = P["fps"]; x0, y0, w, h = P["rect"]
keys = sorted(P["frames"], key=int)
def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy; u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i
    return i / u if u > 0 else 0.0
prev = {"near": None, "far": None}; hist = {"near": [], "far": []}
n_dup = n_clip = n_hold = n_gap = 0
for k in keys:
    t = int(k) / fps; f = dict(P["frames"][k])
    cur = {s: (f.get(s) if (f.get(s) or {}).get("box") else None) for s in ("near", "far")}
    for s, o in (("near", "far"), ("far", "near")):
        if not cur[s]: continue
        b = cur[s]["box"]
        other_now = cur[o]["box"] if cur[o] else None
        other_prev = prev[o][0] if prev[o] and t - prev[o][2] <= 1.0 else None
        if other_now and iou(b, other_now) > 0.5:
            cur[s] = None; n_dup += 1                      # the same person in both slots
        elif other_prev and iou(b, other_prev) > 0.5 and not cur[o]:
            cur[o] = cur[s]; cur[s] = None; n_dup += 1     # the other player, relabelled
    for s in ("near", "far"):
        if not cur[s]: continue
        b = cur[s]["box"]; ws = hist[s][-20:]
        edge = b[0] <= 1 or b[2] >= w - 1 or b[1] <= 1 or b[3] >= h - 1
        if edge and ws and (b[2] - b[0]) < 0.6 * float(np.median(ws)):
            cur[s] = None; n_clip += 1
        else:
            hist[s].append(b[2] - b[0])
    for s in ("near", "far"):
        if cur[s]:
            f[s] = cur[s]; prev[s] = (cur[s]["box"], cur[s], t)
        elif mode == "hold" and prev[s] and t - prev[s][2] <= 2.0:
            f[s] = prev[s][1]; n_hold += 1
        else:
            f.pop(s, None); n_gap += 1
    P["frames"][k] = f
json.dump(P, open(dst, "w"))
print(f"{mode}: relabelled/duplicate {n_dup}, clipped-out {n_clip}, held {n_hold}, left missing {n_gap} of {len(keys)} samples")
