"""Experiment C v2: real labeled-serve feature extraction using the
committed serve-detector research tracks (public/research/serve-detector),
which are per-point 30 fps ball tracks on the study's cut copies.

The study's cut copies used older clip pads, so DB cut_t0 doesn't line up
with the track clock. Calibrate a per-point time offset by matching
placement bounce candidates (which carry both t and pixel) to track
samples at the same pixel.

Run with the worker venv (psycopg2 + numpy + cv2).
"""
import json
import os
import sys
import numpy as np
import cv2

sys.path.insert(0, "/Users/adil/Library/Caches/PongLens/serve-study")
from db import q
from r2util import presign
import urllib.request

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out",
                     "matchjson")

def match_calibration(match_id, path):
    """Production's own calibration quad from match.json (the quad that
    produced the stored u,v)."""
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, match_id[:8] + ".json")
    if not os.path.exists(local):
        url = presign(path)
        urllib.request.urlretrieve(url, local)
    j = json.load(open(local))
    cal = j.get("calibration") or {}
    if not cal.get("ok"):
        return None
    c = cal.get("table_corners_px")
    if isinstance(c, dict):
        try:
            c = [c["A_near_1"], c["B_near_2"], c["C_far_2"], c["D_far_1"]]
        except KeyError:
            c = list(c.values())
    return c

W_M, L_M = 1.525, 2.74
BASE = "/Users/adil/Desktop/Projects/PongLens/public/research/serve-detector"
KEYS = {
    "8e17b962": "chris_8e17_rc",
    "d3c7827e": "chris_d3c7_rc",
    "04112a24": "vinay_0411",
    "6a3777db": "yilin_6a37_rc",
    "efff9208": "alex_efff",
}
FW, FH = 1920.0, 1080.0

def homography_for(corners, checks):
    dst = np.array([[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]], np.float32)
    best = None
    for scale in (1.0, 1.2):
        pts0 = [(c[0] * scale, c[1] * scale) for c in corners]
        orders = []
        for rot in range(4):
            seq = pts0[rot:] + pts0[:rot]
            orders.append(seq)
            orders.append(list(reversed(seq)))
        for seq in orders:
            H = cv2.getPerspectiveTransform(np.array(seq, np.float32), dst)
            errs = []
            for (px, py, u, v) in checks:
                p = H @ np.array([px, py, 1.0])
                errs.append(np.hypot(p[0] / p[2] - u, p[1] / p[2] - v))
            if not errs:
                continue
            err = float(np.median(errs))
            if best is None or err < best[1]:
                best = (H, err, scale)
    return best

def img_to_uv(H, x, y):
    p = H @ np.array([x, y, 1.0])
    return p[0] / p[2], p[1] / p[2]

def serve_pair(cands, t0):
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
                continue
        return a, b
    return None, None

def calibrate_offset(cands, t0, cut_t0, track):
    """offset = t_track - (cut_t0 + (t_cand - t0)), from pixel matches."""
    votes = []
    ts = np.array([s[0] for s in track])
    px = np.array([[s[1] * FW, s[2] * FH] for s in track])
    for c in cands:
        if c.get("x") is None or c.get("t") is None:
            continue
        pred = cut_t0 + (c["t"] - t0)
        d = np.linalg.norm(px - np.array([c["x"], c["y"]]), axis=1)
        for i in np.where(d < 12)[0]:
            off = ts[i] - pred
            if -3.5 < off < 3.5:
                votes.append(off)
    if len(votes) < 2:
        return None
    votes = np.array(votes)
    # densest 0.12 s cluster
    best_n, best_c = 0, None
    for v in votes:
        m = np.abs(votes - v) < 0.12
        if m.sum() > best_n:
            best_n, best_c = m.sum(), float(np.median(votes[m]))
    if best_n < 2:
        return None
    return best_c

def main():
    rows = q("""
      select p.id, p.match_id::text as match_id,
             left(p.match_id::text, 8) as mid8, p.serve_spin,
             p.serve_sidespin, p.t0, p.cut_t0, p.placement,
             m.match_json_path, tcr.corrected_corners
      from points p
      join matches m on m.id = p.match_id
      left join table_calibration_review tcr on tcr.match_id = p.match_id
      where (p.serve_spin is not null or p.serve_sidespin is not null)
        and p.deleted is not true and p.placement is not null
    """)
    rows = [r for r in rows if r["mid8"] in KEYS]
    files = {}
    match_checks = {}
    for r in rows:
        key = KEYS[r["mid8"]]
        if key not in files:
            path = os.path.join(BASE, key + ".json")
            files[key] = json.load(open(path)) if os.path.exists(path) else {}
        for c in (r["placement"].get("candidates") or []):
            if c.get("u") is not None and c.get("x") is not None:
                match_checks.setdefault(key, []).append(
                    (c["x"], c["y"], c["u"], c["v"]))

    homs = {}
    for r in rows:
        key = KEYS[r["mid8"]]
        if key not in homs:
            corners = None
            try:
                corners = match_calibration(r["match_id"],
                                            r["match_json_path"])
            except Exception as e:
                print(f"{key}: match.json fetch failed ({e})")
            hb = None
            if corners:
                hb = homography_for(corners, match_checks.get(key, []))
            if hb is None and r["corrected_corners"]:
                hb = homography_for(r["corrected_corners"],
                                    match_checks.get(key, []))
            homs[key] = hb
            if hb:
                print(f"{key}: homography median err {hb[1]:.3f} m "
                      f"(scale {hb[2]}, {len(match_checks.get(key, []))} checks)")

    out, skipped = [], {}
    for r in rows:
        key = KEYS[r["mid8"]]
        rec = files[key].get(r["id"])
        if rec is None:
            skipped[r["id"][:8]] = "not in research file"
            continue
        hb = homs.get(key)
        if hb is None or hb[1] > 0.25:
            skipped[r["id"][:8]] = "bad homography"
            continue
        H = hb[0]
        pl = r["placement"]
        cands = pl.get("candidates") or []
        t0, cut_t0 = float(r["t0"]), float(r["cut_t0"] or 0.0)
        off = calibrate_offset(cands, t0, cut_t0, rec["d"])
        if off is None:
            skipped[r["id"][:8]] = "no time anchor"
            continue
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
            b1, b2 = serve_pair(cands, t0)
        if b1 is None:
            skipped[r["id"][:8]] = "no serve pair"
            continue
        hop_T = b2["t"] - b1["t"]
        if not (0.15 < hop_T < 1.4):
            skipped[r["id"][:8]] = f"hop_t {hop_T:.2f}"
            continue
        b1_cut = cut_t0 + (b1["t"] - t0) + off
        b2_cut = cut_t0 + (b2["t"] - t0) + off
        tr = [(s[0], s[1] * FW, s[2] * FH) for s in rec["d"]]
        tr = [s for s in tr if b1_cut - 0.45 <= s[0] <= b2_cut + 0.45]
        if len(tr) < 6:
            skipped[r["id"][:8]] = f"track pts {len(tr)}"
            continue
        # sanity: track near stored b1 pixel at b1 time
        i1 = int(np.argmin([abs(s[0] - b1_cut) for s in tr]))
        if b1.get("x") is not None:
            d1 = np.hypot(tr[i1][1] - b1["x"], tr[i1][2] - b1["y"])
            if d1 > 70:
                skipped[r["id"][:8]] = f"anchor mismatch {d1:.0f}px"
                continue
        t_rel = np.array([s[0] - b1_cut for s in tr])
        uv = np.array([img_to_uv(H, s[1], s[2]) for s in tr])
        pxs = np.array([[s[1], s[2]] for s in tr])

        def seg(lo, hi):
            mm = (t_rel >= lo) & (t_rel <= hi)
            tt, gg = t_rel[mm], uv[mm]
            if len(tt) < 2:
                return None
            d = np.linalg.norm(np.diff(gg, axis=0), axis=1)
            dt = np.diff(tt)
            ok = (dt > 1e-6) & (dt < 0.12)   # consecutive frames only
            if ok.sum() == 0:
                return None
            return float(np.median(d[ok] / dt[ok])), gg, tt
        WIN = 0.17
        pre = seg(-WIN, -1e-4)
        post = seg(1e-4, WIN)
        pre2 = seg(hop_T - WIN, hop_T - 1e-4)
        post2 = seg(hop_T + 1e-4, hop_T + WIN)
        def head(seg_):
            if not seg_ or len(seg_[1]) < 2:
                return None
            d = seg_[1][-1] - seg_[1][0]
            return float(np.arctan2(d[1], d[0]))
        def dh(a, b):
            if a is None or b is None:
                return None
            d = b - a
            while d > np.pi: d -= 2 * np.pi
            while d < -np.pi: d += 2 * np.pi
            return float(d)
        feat = dict(
            id=r["id"], key=key, spin=r["serve_spin"],
            sidespin=r["serve_sidespin"], hop_t=hop_T, offset=off,
            b1_uv=[b1.get("u"), b1.get("v")], b2_uv=[b2.get("u"), b2.get("v")],
            pre_speed=pre[0] if pre else None,
            post_speed=post[0] if post else None,
            pre2_speed=pre2[0] if pre2 else None,
            post2_speed=post2[0] if post2 else None,
            n_pre=len(pre[2]) if pre else 0,
            n_post=len(post[2]) if post else 0,
            kick1=dh(head(pre), head(post)),
            kick2=dh(head(pre2), head(post2)),
            homog_err=hb[1],
            track=[[float(a), float(u_), float(v_)] for a, (u_, v_) in
                   zip(t_rel, uv)],
            track_px=[[float(a), float(x_), float(y_)] for a, (x_, y_) in
                      zip(t_rel, pxs)],
        )
        feat["ratio1"] = (post[0] / pre[0]) if (pre and post and pre[0] > 0.2) else None
        feat["ratio2"] = (post2[0] / pre2[0]) if (pre2 and post2 and pre2[0] > 0.2) else None
        if b1.get("u") is not None and b2.get("u") is not None:
            feat["hop_len"] = float(np.hypot(b2["u"] - b1["u"], b2["v"] - b1["v"]))
            feat["hop_speed"] = feat["hop_len"] / hop_T
        out.append(feat)

    print(f"\nextracted {len(out)}, skipped {len(skipped)}")
    from collections import Counter
    print(Counter(v.split()[0] for v in skipped.values()))
    json.dump(out, open("out/real_serves.json", "w"))
    print("wrote out/real_serves.json")

if __name__ == "__main__":
    main()
