"""Measurement-stability check at scale: bounce speed ratios for every
detector-validated serve in the recall research files (unlabeled, but
real 30 fps production footage across 5 matches / 2 venues).

Question: does the pre/post-bounce ground-speed ratio measure stably on
real serves — i.e. plausible physical range, per-player consistency —
even though we lack spin labels to score accuracy against?
"""
import json
import numpy as np
import cv2
from real_analyze import robust_vel

W_M, L_M = 1.525, 2.74
FW, FH = 1920.0, 1080.0
BASE = "/Users/adil/Desktop/Projects/PongLens/public/research/recall"
FILES = ["chris_a", "chris_b", "chris_rc", "ishan_rc", "prabhas_rc"]

def homography(quad):
    src = np.array([[c[0] * FW, c[1] * FH] for c in quad], np.float32)
    dst = np.array([[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]], np.float32)
    return cv2.getPerspectiveTransform(src, dst)

def to_uv(H, x, y):
    p = H @ np.array([x, y, 1.0])
    return p[0] / p[2], p[1] / p[2]

def main():
    all_rows = []
    for key in FILES:
        j = json.load(open(f"{BASE}/{key}.json"))
        if not j.get("quad"):
            print(f"{key}: no quad, skipped")
            continue
        H = homography(j["quad"])
        buv = []
        for t, x, y in j["bounces"]:
            u, v = to_uv(H, x * FW, y * FH)
            buv.append((t, u, v))
        track_uv = []
        for t, x, y in j["track"]:
            u, v = to_uv(H, x * FW, y * FH)
            track_uv.append((t, u, v))
        n_ok = 0
        for c in j["serves"]:
            # serve pair: consecutive bounces after contact, straddling net
            cand = [b for b in buv if c - 0.1 <= b[0] <= c + 2.0
                    and -0.2 <= b[1] <= W_M + 0.2 and -0.2 <= b[2] <= L_M + 0.2]
            pair = None
            for i in range(len(cand) - 1):
                a, b = cand[i], cand[i + 1]
                dt = b[0] - a[0]
                if 0.2 < dt < 1.0 and (a[2] - 1.37) * (b[2] - 1.37) < 0:
                    pair = (a, b)
                    break
            if pair is None:
                continue
            b1, b2 = pair
            tr = [(t - b1[0], u, v) for t, u, v in track_uv
                  if b1[0] - 0.45 <= t <= b2[0] + 0.1]
            hop_T = b2[0] - b1[0]
            pre = robust_vel(tr, -0.20, -0.005)
            post = robust_vel(tr, 0.02, min(0.20, hop_T * 0.6))
            if pre is None or post is None:
                continue
            if not (0.5 < pre["speed"] < 20 and 0.3 < post["speed"] < 20):
                continue
            if pre["resid"] > 0.20 or post["resid"] > 0.20:
                continue
            h1 = np.arctan2(pre["vv"], pre["vu"])
            h2 = np.arctan2(post["vv"], post["vu"])
            d = h2 - h1
            while d > np.pi: d -= 2 * np.pi
            while d < -np.pi: d += 2 * np.pi
            if abs(np.degrees(d)) > 75:
                continue
            hop_len = np.hypot(b2[1] - b1[1], b2[2] - b1[2])
            all_rows.append(dict(
                key=key, t=c, ratio1=post["speed"] / pre["speed"],
                kick1=float(np.degrees(d)), pre=pre["speed"],
                post=post["speed"], hop_t=hop_T,
                hop_speed=hop_len / hop_T))
            n_ok += 1
        print(f"{key}: {len(j['serves'])} serves -> {n_ok} clean measurements")

    r = np.array([x["ratio1"] for x in all_rows])
    print(f"\ntotal clean serve bounce measurements: {len(r)}")
    if len(r):
        print(f"ratio1: mean {r.mean():.2f}  median {np.median(r):.2f}  "
              f"p10 {np.percentile(r,10):.2f}  p90 {np.percentile(r,90):.2f}")
        print("histogram (0.1 bins 0..1.6):")
        hist, edges = np.histogram(r, bins=np.arange(0, 1.65, 0.1))
        for h, e in zip(hist, edges):
            print(f"  {e:.1f}-{e+0.1:.1f}: {'#' * h} {h}")
        for key in FILES:
            rr = np.array([x["ratio1"] for x in all_rows if x["key"] == key])
            if len(rr) >= 3:
                print(f"  {key}: median {np.median(rr):.2f} "
                      f"IQR {np.percentile(rr,25):.2f}-{np.percentile(rr,75):.2f} "
                      f"(n={len(rr)})")
    json.dump(all_rows, open("out/real_scale.json", "w"))

if __name__ == "__main__":
    main()
