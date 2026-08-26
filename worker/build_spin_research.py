"""Seed spin_predictions from the serve-study detection caches.

For every labelable point in a match covered by
~/Library/Caches/PongLens/serve-study/det/<key>.jsonl, measure the
serve's bounce speed ratio and write one spin_predictions row: a
top/back/none call with confidence when the measurement is clean, or
'unmeasurable' with the reason when it is not. The page at /research/spin
reads these beside the owner's labels.

Method and gates are ported from the 2026-08-26 feasibility study
(docs/research/2026-08-26-spin-estimation/): production quad from
match.json (the quad that produced the stored candidate u,v — the
corrected quads in table_calibration_review must NOT be used to
interpret them), per-point clock anchoring by voting bounce-candidate
pixels into the track (the study's cut copies pre-date a pad change, so
DB cut_t0 does not line up with the cache's clock), teleport chunking,
robust window velocities, and physical sanity gates. The
heading-reversal gate matters most: the most common wrong "serve pair"
is the server bouncing the ball before serving, and the ground heading
reverses at a fake serve bounce, never at a real one.

Run on the Mac with the worker venv:
  ./venv/bin/python build_spin_research.py [--dry-run] [--match <mid8>]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import numpy as np
import cv2
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worker as W  # DATABASE_URL, r2(), parse_r2_path
from table_coordinates import canonicalize_table_quad, table_homography

ALGO = "ratio-v1"
W_M, L_M, NET_V = 1.525, 2.74, 1.37
DET_DIR = os.path.expanduser("~/Library/Caches/PongLens/serve-study/det")
WORK_DIR = os.path.expanduser("~/Library/Caches/PongLens/serve-study/work")
WIN_S = 0.20            # velocity window either side of the bounce
BACK_MAX = 0.55         # ratio below this reads as backspin
TOP_MIN = 0.95          # ratio above this reads as topspin


def q(conn, sql, args=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, args or ())
        return [dict(r) for r in cur.fetchall()]


def det_matches(conn):
    """Map det cache files to match ids via the 4-hex fragment in the
    filename (e.g. vinay_0411 -> match id starting 0411)."""
    out = {}
    for path in sorted(glob.glob(os.path.join(DET_DIR, "*.jsonl"))):
        key = os.path.basename(path)[:-6]
        frags = [p for p in key.split("_") if len(p) == 4
                 and all(c in "0123456789abcdef" for c in p)]
        if not frags:
            print(f"  [skip] {key}: no id fragment in filename")
            continue
        rows = q(conn,
                 "select m.id::text, m.match_json_path, "
                 "tcr.corrected_corners "
                 "from matches m "
                 "left join table_calibration_review tcr on tcr.match_id = m.id "
                 "where m.id::text like %s", (frags[-1] + "%",))
        if len(rows) != 1:
            print(f"  [skip] {key}: fragment {frags[-1]} matched {len(rows)}")
            continue
        out[key] = rows[0]
    return out


def load_track(key):
    fs, xs, ys = [], [], []
    with open(os.path.join(DET_DIR, key + ".jsonl")) as f:
        for line in f:
            r = json.loads(line)
            if r["x"] is not None:
                fs.append(r["f"]); xs.append(r["x"]); ys.append(r["y"])
    meta = json.load(open(os.path.join(WORK_DIR, key, "meta.json")))
    return np.array(fs, float), np.array(xs), np.array(ys), float(meta["fps"])


def match_quad(match_json_path):
    loc = W.parse_r2_path(match_json_path)
    if not loc:
        return None
    obj = W.r2().get_object(Bucket=loc[0], Key=loc[1])
    j = json.loads(obj["Body"].read())
    cal = j.get("calibration") or {}
    if not cal.get("ok"):
        return None
    c = cal.get("table_corners_px")
    if isinstance(c, dict):
        try:
            c = [c["A_near_1"], c["B_near_2"], c["C_far_2"], c["D_far_1"]]
        except KeyError:
            return None
    return c


def homography(corners):
    """Canonicalize the way production does (points_pipeline
    _orient_near_far + near_pair=(0,1): the near end is the edge lower in
    the frame, 44/44 on the calibration corpus), then map to metric table
    coordinates. If the ring phase is off by one (corners given
    side-first), the convexity check raises and the rotated pairing is
    tried."""
    pts = np.asarray([(float(c[0]), float(c[1])) for c in corners],
                     dtype=np.float64)
    for ring in (pts, np.vstack([pts[1:], pts[:1]])):
        near_y = (ring[0][1] + ring[1][1]) / 2.0
        far_y = (ring[2][1] + ring[3][1]) / 2.0
        oriented = ring if near_y >= far_y else np.vstack(
            [ring[2:], ring[:2]])
        try:
            quad = canonicalize_table_quad(oriented, near_pair=(0, 1))
            return table_homography(quad)
        except ValueError:
            continue
    raise ValueError("table quad could not be canonicalized")


def to_uv(H, x, y):
    p = H @ np.array([x, y, 1.0])
    return p[0] / p[2], p[1] / p[2]


def chosen_hypothesis(pl):
    hyps = pl.get("hypotheses") or {}
    hf, hn = hyps.get("far"), hyps.get("near")
    if hf and (not hn or float(hf.get("score", -9e9)) >=
               float(hn.get("score", -9e9))):
        return hf
    return hn


def pair_plausible(a, b):
    if not (0.15 < b["t"] - a["t"] < 1.6):
        return False
    if a.get("v") is not None and b.get("v") is not None:
        if (a["v"] - NET_V) * (b["v"] - NET_V) > 0:
            return False
    return True


def serve_pair(pl, t0):
    """The serve's two bounces: the chosen hypothesis when its pair is
    plausible, else the consecutive-pair rule over candidates (a serve's
    bounces straddle the net; a same-half pair is the pre-serve ritual
    or a rally fragment)."""
    h = chosen_hypothesis(pl)
    if h and h.get("shots"):
        s0 = h["shots"][0]
        a, b = s0.get("serve_first_bounce"), s0.get("landing")
        if a and b and pair_plausible(a, b):
            return a, b
    bs = [c for c in (pl.get("candidates") or [])
          if c.get("kind") == "bounce" and c.get("t") is not None
          and c["t"] >= t0 - 0.5]
    bs.sort(key=lambda c: c["t"])
    for i in range(len(bs) - 1):
        if pair_plausible(bs[i], bs[i + 1]):
            return bs[i], bs[i + 1]
    return None, None


def anchor_offset(cands, t0, cut_t0, ts, px):
    """offset = cache clock - (cut_t0 + (t - t0)). Vote every bounce
    candidate's pixel against every track sample within 12 px, take the
    densest 0.12 s cluster. Searched globally so it also survives a
    concatenated cache video, then quality-gated."""
    votes = []
    srcs = []
    for ci, c in enumerate(cands):
        if c.get("x") is None or c.get("t") is None:
            continue
        pred = cut_t0 + (c["t"] - t0)
        d = np.linalg.norm(px - np.array([c["x"], c["y"]]), axis=1)
        for i in np.where(d < 12)[0]:
            votes.append(ts[i] - pred)
            srcs.append(ci)
    if len(votes) < 3:
        return None, len(votes)
    votes = np.array(votes)
    srcs = np.array(srcs)
    best_n, best_c, best_src = 0, None, 0
    for v in votes:
        m = np.abs(votes - v) < 0.12
        n_src = len(set(srcs[m].tolist()))
        if m.sum() > best_n:
            best_n, best_c, best_src = int(m.sum()), float(np.median(votes[m])), n_src
    # No offset-magnitude cap: some caches index a concatenated per-point
    # video, where valid offsets run to minutes. A wrong cluster is caught
    # downstream by the bounce-pixel proximity check.
    if best_n < 3 or best_src < 2:
        return None, best_n
    return best_c, best_n


def chunks(track, max_jump_m=0.45, max_gap_s=0.10):
    out, cur = [], []
    for s in track:
        if cur:
            dt = s[0] - cur[-1][0]
            d = np.hypot(s[1] - cur[-1][1], s[2] - cur[-1][2])
            if dt > max_gap_s or d > max_jump_m * max(1.0, dt / 0.034):
                if len(cur) >= 3:
                    out.append(np.array(cur))
                cur = []
        cur.append(s)
    if len(cur) >= 3:
        out.append(np.array(cur))
    return out


def robust_vel(track, lo, hi):
    """Straight-line ground velocity over [lo, hi]: least squares on u(t)
    and v(t) within a single teleport-free chunk, one outlier round."""
    best = None
    for ch in chunks(track):
        m = (ch[:, 0] >= lo) & (ch[:, 0] <= hi)
        seg = ch[m]
        if len(seg) < 3:
            continue
        t = seg[:, 0] - seg[0, 0]
        A = np.stack([t, np.ones_like(t)], axis=1)
        cu, *_ = np.linalg.lstsq(A, seg[:, 1], rcond=None)
        cv_, *_ = np.linalg.lstsq(A, seg[:, 2], rcond=None)
        r = np.hypot(seg[:, 1] - A @ cu, seg[:, 2] - A @ cv_)
        keep = r < max(0.06, 2.5 * np.median(r) + 1e-9)
        if 3 <= keep.sum() < len(seg):
            cu, *_ = np.linalg.lstsq(A[keep], seg[keep, 1], rcond=None)
            cv_, *_ = np.linalg.lstsq(A[keep], seg[keep, 2], rcond=None)
        resid = float(np.mean(np.hypot(seg[:, 1] - A @ cu,
                                       seg[:, 2] - A @ cv_)))
        cand = dict(vu=float(cu[0]), vv=float(cv_[0]),
                    speed=float(np.hypot(cu[0], cv_[0])),
                    n=int(keep.sum()), resid=resid)
        if best is None or cand["n"] > best["n"]:
            best = cand
    return best


def measure(point, H, ts, px, fps):
    """One point -> a spin_predictions row dict (never raises)."""
    pl = point["placement"] or {}
    t0 = float(point["t0"])
    cut_t0 = float(point["cut_t0"]) if point["cut_t0"] is not None else None
    row = dict(point_id=point["id"], algo=ALGO, predicted_spin="unmeasurable",
               confidence=None, ratio1=None, kick1_deg=None, hop_t=None,
               hop_speed=None, pre_speed=None, post_speed=None,
               serve_cut_s=None, quality={})

    def refuse(reason, **extra):
        row["quality"] = dict(reason=reason, **extra)
        return row

    if cut_t0 is None:
        return refuse("no_cut_t0")
    cands = pl.get("candidates") or []
    if not cands:
        return refuse("no_candidates")
    b1, b2 = serve_pair(pl, t0)
    if b1 is None:
        return refuse("no_serve_pair")
    hop_t = float(b2["t"] - b1["t"])
    row["hop_t"] = hop_t
    row["serve_cut_s"] = cut_t0 + (float(b1["t"]) - t0)
    if not (0.2 < hop_t < 1.0):
        return refuse("hop_time_implausible", hop_t=round(hop_t, 2))
    if b1.get("u") is not None and b2.get("u") is not None:
        if (b1["v"] - NET_V) * (b2["v"] - NET_V) > 0:
            return refuse("pair_same_half")
        hop_len = float(np.hypot(b2["u"] - b1["u"], b2["v"] - b1["v"]))
        row["hop_speed"] = hop_len / hop_t
        if not (0.8 < row["hop_speed"] < 15):
            return refuse("hop_speed_implausible",
                          hop_speed=round(row["hop_speed"], 2))
    off, n_votes = anchor_offset(cands, t0, cut_t0, ts, px)
    if off is None:
        return refuse("no_time_anchor", votes=n_votes)
    row["quality"] = dict(anchor_offset=round(off, 3), anchor_votes=n_votes)
    b1_c = cut_t0 + (float(b1["t"]) - t0) + off
    b2_c = b1_c + hop_t
    m = (ts >= b1_c - 0.45) & (ts <= b2_c + 0.10)
    if m.sum() < 6:
        return refuse("track_sparse", samples=int(m.sum()), **row["quality"])
    # confirm the anchored track passes through the stored bounce pixel
    i1 = int(np.argmin(np.abs(ts[m] - b1_c)))
    if b1.get("x") is not None:
        d1 = float(np.hypot(px[m][i1, 0] - b1["x"], px[m][i1, 1] - b1["y"]))
        if d1 > 45:
            return refuse("anchor_mismatch", px_off=round(d1),
                          **row["quality"])
    track = [(float(t - b1_c), *to_uv(H, x, y))
             for t, (x, y) in zip(ts[m], px[m])]
    post = robust_vel(track, 0.02, min(WIN_S, hop_t * 0.6))

    def kick_of(pre_):
        dh = (np.arctan2(post["vv"], post["vu"])
              - np.arctan2(pre_["vv"], pre_["vu"]))
        while dh > np.pi:
            dh -= 2 * np.pi
        while dh < -np.pi:
            dh += 2 * np.pi
        return float(np.degrees(dh))

    pre = robust_vel(track, -WIN_S, -0.005)
    if pre is None or post is None:
        return refuse("window_unfit", **row["quality"])
    kick = kick_of(pre)
    if abs(kick) > 75:
        # A fast serve reaches bounce 1 well under 0.2 s after contact,
        # so the wide window can reach back into the toss, whose heading
        # is unrelated. Retry on just the last few frames before the
        # bounce before calling it a fake serve.
        pre_short = robust_vel(track, -0.12, -0.005)
        if pre_short is not None:
            k2 = kick_of(pre_short)
            if abs(k2) <= 75:
                pre, kick = pre_short, k2
    row["pre_speed"] = round(pre["speed"], 3)
    row["post_speed"] = round(post["speed"], 3)
    if not (0.5 < pre["speed"] < 20 and 0.3 < post["speed"] < 20):
        return refuse("speed_implausible", **row["quality"])
    if pre["resid"] > 0.20 or post["resid"] > 0.20:
        return refuse("window_noisy", **row["quality"])
    row["kick1_deg"] = round(kick, 1)
    if abs(kick) > 75:
        # the ground heading reverses at a pre-serve bounce, never a serve
        return refuse("fake_serve_reversal", kick=row["kick1_deg"],
                      **row["quality"])
    ratio = post["speed"] / pre["speed"]
    row["ratio1"] = round(float(ratio), 3)
    if ratio < BACK_MAX:
        row["predicted_spin"] = "back"
        margin = BACK_MAX - ratio
    elif ratio > TOP_MIN:
        row["predicted_spin"] = "top"
        margin = ratio - TOP_MIN
    else:
        row["predicted_spin"] = "none"
        margin = min(ratio - BACK_MAX, TOP_MIN - ratio)
    row["confidence"] = round(float(min(0.95, 0.5 + 2.0 * margin)), 2)
    row["quality"]["n_pre"] = pre["n"]
    row["quality"]["n_post"] = post["n"]
    return row


def upsert(conn, row):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.spin_predictions
              (point_id, algo, predicted_spin, confidence, ratio1, kick1_deg,
               hop_t, hop_speed, pre_speed, post_speed, serve_cut_s, quality,
               updated_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            on conflict (point_id) do update set
              algo = excluded.algo,
              predicted_spin = excluded.predicted_spin,
              confidence = excluded.confidence,
              ratio1 = excluded.ratio1,
              kick1_deg = excluded.kick1_deg,
              hop_t = excluded.hop_t,
              hop_speed = excluded.hop_speed,
              pre_speed = excluded.pre_speed,
              post_speed = excluded.post_speed,
              serve_cut_s = excluded.serve_cut_s,
              quality = excluded.quality,
              updated_at = now()
            """,
            (row["point_id"], row["algo"], row["predicted_spin"],
             row["confidence"], row["ratio1"], row["kick1_deg"], row["hop_t"],
             row["hop_speed"], row["pre_speed"], row["post_speed"],
             row["serve_cut_s"], json.dumps(row["quality"])),
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--match", help="only this mid8 prefix")
    args = ap.parse_args()

    conn = psycopg2.connect(W.DATABASE_URL)
    conn.autocommit = True
    mapping = det_matches(conn)
    print(f"{len(mapping)} det-cached matches resolved")

    totals = {}
    for key, m in sorted(mapping.items()):
        if args.match and not m["id"].startswith(args.match):
            continue
        corners = match_quad(m["match_json_path"])
        quad_src = "match_json"
        if not corners and m.get("corrected_corners"):
            # No production calibration; the owner-corrected quad is fine
            # for measuring ground velocities (we never interpret stored
            # candidate u,v through it — those are null on these matches).
            corners = m["corrected_corners"]
            quad_src = "corrected"
        if not corners:
            print(f"  [skip] {key}: no quad from match.json or review")
            continue
        H = homography(corners)
        try:
            fs, xs, ys, fps = load_track(key)
        except FileNotFoundError as e:
            print(f"  [skip] {key}: {e}")
            continue
        ts = fs / fps
        px = np.stack([xs, ys], axis=1)
        points = q(conn,
                   "select id::text, t0, cut_t0, placement from points "
                   "where match_id = %s and deleted is not true "
                   "and warmup is not true order by idx", (m["id"],))
        counts = {}
        for p in points:
            row = measure(p, H, ts, px, fps)
            k = (row["predicted_spin"] if row["predicted_spin"] != "unmeasurable"
                 else row["quality"].get("reason", "unmeasurable"))
            counts[k] = counts.get(k, 0) + 1
            totals[k] = totals.get(k, 0) + 1
            if not args.dry_run:
                upsert(conn, row)
        measured = sum(v for k, v in counts.items()
                       if k in ("top", "back", "none"))
        print(f"  {key}: {len(points)} points, {measured} measured "
              f"({dict(sorted(counts.items(), key=lambda kv: -kv[1]))})")

    print("\ntotals:")
    for k, v in sorted(totals.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")
    measured = sum(v for k, v in totals.items() if k in ("top", "back", "none"))
    total = sum(totals.values())
    if total:
        print(f"yield: {measured}/{total} = {100 * measured / total:.0f}%")


if __name__ == "__main__":
    main()
