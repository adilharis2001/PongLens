"""Experiment C: extract real 30 fps serve trajectories for the
hand-labeled spin serves, from the serve-study detection caches.

Uses:
 - points.serve_spin / serve_sidespin labels (back/top/none + bool)
 - placement candidates (bounce events with t, pixel xy, table uv)
 - table_calibration_review.corrected_corners for the homography
 - ~/Library/Caches/PongLens/serve-study/det/<key>.jsonl per-frame tracks
   (frames indexed on the CUT video; orig t -> cut t via cut_t0 + (t - t0))

Run with the WORKER venv (psycopg2 + numpy + cv2):
  /Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python real_extract.py
"""
import json
import os
import sys
import numpy as np
import cv2

sys.path.insert(0, "/Users/adil/Library/Caches/PongLens/serve-study")
from db import q

W_M, L_M = 1.525, 2.74
DET_DIR = os.path.expanduser("~/Library/Caches/PongLens/serve-study/det")
WORK_DIR = os.path.expanduser("~/Library/Caches/PongLens/serve-study/work")
KEYS = {  # mid8 -> det key
    "8e17b962": "chris_8e17_rc",
    "d3c7827e": "chris_d3c7_rc",
    "04112a24": "vinay_0411",
    "6a3777db": "yilin_6a37_rc",
    "efff9208": "alex_efff",
}

def load_track(key):
    path = os.path.join(DET_DIR, key + ".jsonl")
    fs, xs, ys = [], [], []
    with open(path) as f:
        for line in f:
            r = json.loads(line)
            if r["x"] is not None:
                fs.append(r["f"]); xs.append(r["x"]); ys.append(r["y"])
    meta = json.load(open(os.path.join(WORK_DIR, key, "meta.json")))
    return np.array(fs), np.array(xs), np.array(ys), meta["fps"]

def homography_for(corners, checks):
    """corners: 4x2 list. Resolve corner ordering by testing rotations
    and reflections against production (x,y)->(u,v) check pairs."""
    dst = np.array([[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]], np.float32)
    best = None
    pts0 = [tuple(c) for c in corners]
    orders = []
    for rot in range(4):
        seq = pts0[rot:] + pts0[:rot]
        orders.append(seq)
        orders.append(list(reversed(seq)))
    for seq in orders:
        H = cv2.getPerspectiveTransform(np.array(seq, np.float32), dst)
        err = 0.0
        n = 0
        for (px, py, u, v) in checks:
            p = H @ np.array([px, py, 1.0])
            uu, vv = p[0] / p[2], p[1] / p[2]
            err += np.hypot(uu - u, vv - v)
            n += 1
        if n == 0:
            continue
        err /= n
        if best is None or err < best[1]:
            best = (H, err)
    return best

def img_to_uv(H, x, y):
    p = H @ np.array([x, y, 1.0])
    return p[0] / p[2], p[1] / p[2]

def serve_pair(cands, t0):
    """Pick the serve's two bounces from the candidate list: first two
    consecutive bounce candidates after t0 - 0.5 with 0.15 < dt < 1.6 s,
    straddling the net when uv is known."""
    bs = [c for c in cands if c.get("kind") == "bounce"
          and c.get("t") is not None and c["t"] >= t0 - 0.5]
    bs.sort(key=lambda c: c["t"])
    for i in range(len(bs) - 1):
        a, b = bs[i], bs[i + 1]
        dt = b["t"] - a["t"]
        if not (0.15 < dt < 1.6):
            continue
        if a.get("v") is not None and b.get("v") is not None:
            if (a["v"] - 1.37) * (b["v"] - 1.37) > 0:
                continue  # same half: not serve bounce 1 -> 2
        return a, b
    return None, None

def main():
    rows = q("""
      select p.id, left(p.match_id::text, 8) as mid8, p.serve_spin,
             p.serve_sidespin, p.t0, p.cut_t0, p.placement,
             tcr.corrected_corners
      from points p
      left join table_calibration_review tcr on tcr.match_id = p.match_id
      where (p.serve_spin is not null or p.serve_sidespin is not null)
        and p.deleted is not true and p.placement is not null
    """)
    rows = [r for r in rows if r["mid8"] in KEYS and r["corrected_corners"]]
    print(f"{len(rows)} labeled serves in det-covered matches")

    tracks = {}
    out = []
    skipped = {}
    for r in rows:
        key = KEYS[r["mid8"]]
        if key not in tracks:
            tracks[key] = load_track(key)
        fs, xs, ys, fps = tracks[key]
        pl = r["placement"]
        cands = pl.get("candidates") or []
        checks = [(c["x"], c["y"], c["u"], c["v"]) for c in cands
                  if c.get("u") is not None and c.get("x") is not None]
        hb = homography_for(r["corrected_corners"], checks)
        if hb is None or hb[1] > 0.30:
            skipped[r["id"][:8]] = f"homography err {hb[1] if hb else 'na'}"
            continue
        H = hb[0]
        # serve bounce pair: prefer the chosen hypothesis, else pair up
        hyps = pl.get("hypotheses") or {}
        h = None
        if hyps:
            hf, hn = hyps.get("far"), hyps.get("near")
            h = hf if (hf and (not hn or float(hf.get("score", -9e9)) >=
                               float(hn.get("score", -9e9)))) else hn
        b1 = b2 = None
        if h and h.get("shots"):
            s0 = h["shots"][0]
            if s0.get("serve_first_bounce") and s0.get("landing"):
                b1, b2 = s0["serve_first_bounce"], s0["landing"]
        if b1 is None:
            b1, b2 = serve_pair(cands, float(r["t0"]))
        if b1 is None:
            skipped[r["id"][:8]] = "no serve pair"
            continue
        hop_t = b2["t"] - b1["t"]
        if not (0.15 < hop_t < 1.4):
            skipped[r["id"][:8]] = f"hop_t {hop_t:.2f}"
            continue
        t0, cut_t0 = float(r["t0"]), float(r["cut_t0"] or 0.0)
        def to_cut(t):
            return cut_t0 + (t - t0)
        # slice track window around the serve
        ta, tb = to_cut(b1["t"]) - 0.40, to_cut(b2["t"]) + 0.40
        m = (fs / fps >= ta) & (fs / fps <= tb)
        if m.sum() < 6:
            skipped[r["id"][:8]] = f"track pts {int(m.sum())}"
            continue
        tw = fs[m] / fps
        # sanity: track near stored bounce pixel at b1 time
        i1 = np.argmin(np.abs(tw - to_cut(b1["t"])))
        if b1.get("x") is not None:
            d = np.hypot(xs[m][i1] - b1["x"], ys[m][i1] - b1["y"])
            if d > 80:
                skipped[r["id"][:8]] = f"track/bounce mismatch {d:.0f}px"
                continue
        uv = np.array([img_to_uv(H, x_, y_) for x_, y_ in zip(xs[m], ys[m])])
        t_rel = tw - to_cut(b1["t"])   # 0 at bounce 1
        hop_T = to_cut(b2["t"]) - to_cut(b1["t"])

        def seg(lo, hi):
            mm = (t_rel >= lo) & (t_rel <= hi)
            tt, gg = t_rel[mm], uv[mm]
            if len(tt) < 2:
                return None
            d = np.linalg.norm(np.diff(gg, axis=0), axis=1)
            dt = np.diff(tt)
            ok = dt > 1e-6
            if ok.sum() == 0:
                return None
            return float(np.median(d[ok] / dt[ok])), gg, tt

        WIN = 0.17
        pre = seg(-WIN, -1e-4)
        post = seg(1e-4, WIN)
        feat = dict(
            id=r["id"], key=key, spin=r["serve_spin"],
            sidespin=r["serve_sidespin"],
            hop_t=hop_T,
            hop_len=float(np.hypot((b2.get("u") or 0) - (b1.get("u") or 0),
                                   (b2.get("v") or 0) - (b1.get("v") or 0)))
                    if b2.get("u") is not None and b1.get("u") is not None
                    else None,
            pre_speed=pre[0] if pre else None,
            post_speed=post[0] if post else None,
            n_pre=len(pre[2]) if pre else 0,
            n_post=len(post[2]) if post else 0,
            homog_err=hb[1],
        )
        if pre and post and pre[0] and pre[0] > 0.2:
            feat["ratio1"] = post[0] / pre[0]
        else:
            feat["ratio1"] = None
        # heading change across bounce 1
        def head(seg_):
            if not seg_ or len(seg_[1]) < 2:
                return None
            d = seg_[1][-1] - seg_[1][0]
            return float(np.arctan2(d[1], d[0]))
        h_pre, h_post = head(pre), head(post)
        if h_pre is not None and h_post is not None:
            dh = h_post - h_pre
            while dh > np.pi: dh -= 2 * np.pi
            while dh < -np.pi: dh += 2 * np.pi
            feat["kick1"] = float(dh)
        else:
            feat["kick1"] = None
        # raw uv track for later physics fitting
        feat["track"] = [[float(a), float(b_), float(c_)] for a, b_, c_ in
                         zip(t_rel, uv[:, 0], uv[:, 1])]
        feat["track_px"] = [[float(a), float(b_), float(c_)] for a, b_, c_ in
                            zip(t_rel, xs[m], ys[m])]
        out.append(feat)

    print(f"extracted {len(out)}, skipped {len(skipped)}")
    for k, v in skipped.items():
        print(f"  skip {k}: {v}")
    json.dump(out, open("out/real_serves.json", "w"))
    print("wrote out/real_serves.json")

if __name__ == "__main__":
    main()
