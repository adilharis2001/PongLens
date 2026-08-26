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

ALGO = "ratio-v2"
# The shipped serve detector's own output, committed by the 2026-08-13
# rerun. `serve` is the detected contact in CUT seconds — the same clock
# as points.cut_t0, verified against the DB — and is null when the
# detector stayed quiet. It fires on 36% of points, and those are the
# only points worth putting in front of a labeler: the rest are junk
# fragments, mid-rally pieces and warm-up, where there is no serve to
# judge.
SERVE_POINTS_TS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "app", "research", "serve-detector", "data.ts")
W_M, L_M, NET_V = 1.525, 2.74, 1.37
DET_DIR = os.path.expanduser("~/Library/Caches/PongLens/serve-study/det")
WORK_DIR = os.path.expanduser("~/Library/Caches/PongLens/serve-study/work")
WIN_S = 0.28            # velocity window either side of the bounce: at
                        # 30 fps a 0.20 s window is six samples, and one
                        # dropped frame splits it below the fit minimum.
# points_v2.serve_motifs reports contact as bounce1 - CONTACT_LOOKBACK_S
# with a CONSTANT lookback, so the detected contact pins the first bounce
# exactly: bounce1 = serve + 0.81. Searching from the contact instead
# swept up the toss and the bat strike, both of which are local maxima of
# image y and neither of which is a table bounce.
CONTACT_LOOKBACK_S = 0.81
BOUNCE1_TOL_S = 0.40
BACK_MAX = 0.55         # ratio below this reads as backspin
TOP_MIN = 0.95          # ratio above this reads as topspin


def detected_serves():
    """(point_id -> detected serve contact in cut seconds, fired only),
    and (det file skey -> the match those points belong to)."""
    import re
    body = open(SERVE_POINTS_TS).read()
    body = body[body.index("SERVE_POINTS"):]
    fired, skey_match = {}, {}
    for chunk in re.findall(r'\{"pointId".*?\}', body, re.S):
        rec = json.loads(chunk)
        skey_match.setdefault(rec["skey"], rec["matchId"])
        if rec.get("serve") is not None:
            fired[rec["pointId"]] = float(rec["serve"])
    return fired, skey_match


def q(conn, sql, args=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, args or ())
        return [dict(r) for r in cur.fetchall()]


def det_matches(conn, skey_match):
    """Map det cache files to matches using the study's own record of
    which match each file came from.

    The filename fragment is NOT the answer. A `_rc` file is a RECUT,
    whose points live under a different match row than the original the
    fragment names — julian_522c_rc carries the original's 522c but its
    track belongs to b01af658. Resolving by fragment silently pairs one
    match's ball track with another match's points, and every timestamp
    then fails to line up: it is what turned 15 of these 25 matches into
    walls of no_time_anchor."""
    out = {}
    for path in sorted(glob.glob(os.path.join(DET_DIR, "*.jsonl"))):
        key = os.path.basename(path)[:-6]
        mid = skey_match.get(key)
        if not mid:
            print(f"  [skip] {key}: no detected serves in the corpus")
            continue
        rows = q(conn,
                 "select m.id::text, m.match_json_path, "
                 "tcr.corrected_corners "
                 "from matches m "
                 "left join table_calibration_review tcr on tcr.match_id = m.id "
                 "where m.id = %s", (mid,))
        if len(rows) != 1:
            print(f"  [skip] {key}: match {mid[:8]} not found")
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


def serve_pair(pl, t0, serve_orig):
    """The serve's two bounces, anchored on the detected serve contact.

    serve_orig is the shipped detector's contact time converted to this
    point's ORIGINAL clock. The first bounce of a serve lands shortly
    after the bat touches the ball, so the pair must start in the window
    just after it. That window is what rejects the pre-serve ritual —
    the server bouncing the ball on the table before tossing — which is
    the single most common wrong pair and reads as a perfectly good
    bounce pair on every other test."""
    lo, hi = serve_orig - 0.25, serve_orig + 1.60
    h = chosen_hypothesis(pl)
    if h and h.get("shots"):
        s0 = h["shots"][0]
        a, b = s0.get("serve_first_bounce"), s0.get("landing")
        if a and b and pair_plausible(a, b) and lo <= a["t"] <= hi:
            return a, b
    bs = [c for c in (pl.get("candidates") or [])
          if c.get("kind") == "bounce" and c.get("t") is not None]
    bs.sort(key=lambda c: c["t"])
    for i in range(len(bs) - 1):
        if lo <= bs[i]["t"] <= hi and pair_plausible(bs[i], bs[i + 1]):
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


def track_bounces(ts, xs, ys, lo, hi):
    """Bounce frames inside [lo, hi], read off the ball track the way
    production reads them (points_v2.bounces): the ball is at its lowest
    on SCREEN at the bounce, so a bounce is a local maximum of image y.
    The motion gate stops a parked speck manufacturing bounces."""
    idx = np.where((ts >= lo) & (ts <= hi))[0]
    out = []
    for k in range(2, len(idx) - 2):
        i0, i1, i2 = idx[k - 2], idx[k - 1], idx[k]
        i3, i4 = idx[k + 1], idx[k + 2]
        # consecutive-ish frames only; a gap makes the shape meaningless
        if ts[i4] - ts[i0] > 0.34:
            continue
        if not (ys[i2] >= ys[i1] and ys[i2] >= ys[i3]):
            continue
        if not (ys[i2] - ys[i0] >= 3.0 and ys[i2] - ys[i4] >= 3.0):
            continue
        if np.hypot(xs[i2] - xs[i1], ys[i2] - ys[i1]) < 3.0:
            continue
        if out and ts[i2] - ts[out[-1]] < 0.10:
            continue                      # one bounce, not a plateau
        out.append(i2)
    return out


def contiguous(t, u, v, max_gap_s=0.10, max_jump_m=0.45):
    """Split a window at dropped frames and tracker teleports. Fitting a
    velocity straight through a jump reads as a violent change of
    direction, which is how a clean serve ends up looking like it
    reversed at the bounce."""
    runs, cur = [], [0]
    for i in range(1, len(t)):
        dt = t[i] - t[i - 1]
        d = float(np.hypot(u[i] - u[i - 1], v[i] - v[i - 1]))
        if dt > max_gap_s or d > max_jump_m * max(1.0, dt / 0.034):
            runs.append(cur); cur = []
        cur.append(i)
    runs.append(cur)
    return max(runs, key=len)


def fit_velocity(t, u, v):
    """Straight-line ground velocity with one outlier-rejection round,
    over the longest teleport-free run in the window."""
    if len(t) >= 3:
        keep_run = contiguous(t, u, v)
        t, u, v = t[keep_run], u[keep_run], v[keep_run]
    if len(t) < 3:
        return None
    A = np.stack([t - t[0], np.ones_like(t)], axis=1)
    cu, *_ = np.linalg.lstsq(A, u, rcond=None)
    cv, *_ = np.linalg.lstsq(A, v, rcond=None)
    r = np.hypot(u - A @ cu, v - A @ cv)
    keep = r < max(0.06, 2.5 * np.median(r) + 1e-9)
    if 3 <= keep.sum() < len(t):
        cu, *_ = np.linalg.lstsq(A[keep], u[keep], rcond=None)
        cv, *_ = np.linalg.lstsq(A[keep], v[keep], rcond=None)
    return dict(vu=float(cu[0]), vv=float(cv[0]),
                speed=float(np.hypot(cu[0], cv[0])), n=int(keep.sum()),
                resid=float(np.mean(np.hypot(u - A @ cu, v - A @ cv))))


def measure(point, H, ts, xs, ys, serve_cut):
    """One detected serve -> a spin_predictions row (never raises).

    Everything is read off the ball track in the cut clock, which the
    serve detector's contact time shares. No placement dependency: the
    recut matches that carry most of the detected serves have no bounce
    candidates stored at all."""
    row = dict(point_id=point["id"], algo=ALGO, predicted_spin="unmeasurable",
               confidence=None, ratio1=None, kick1_deg=None, hop_t=None,
               hop_speed=None, pre_speed=None, post_speed=None,
               serve_cut_s=serve_cut, quality={})

    def refuse(reason, **extra):
        row["quality"] = dict(reason=reason, **extra)
        return row

    # The serve's own two bounces sit just after the bat touches the ball.
    # Starting the search at the contact is what rejects the pre-serve
    # ritual, which otherwise reads as a textbook bounce pair.
    b1_expect = serve_cut + CONTACT_LOOKBACK_S
    bidx = track_bounces(ts, xs, ys, b1_expect - BOUNCE1_TOL_S,
                         b1_expect + 2.0)
    cands1 = [i for i in bidx if abs(ts[i] - b1_expect) <= BOUNCE1_TOL_S]
    if not cands1:
        return refuse("no_first_bounce", found=len(bidx))
    i1 = min(cands1, key=lambda i: abs(ts[i] - b1_expect))
    after = [i for i in bidx if ts[i] > ts[i1] + 0.12]
    if not after:
        return refuse("no_second_bounce")
    i2 = after[0]
    b1t, b2t = float(ts[i1]), float(ts[i2])
    hop_t = b2t - b1t
    row["hop_t"] = hop_t
    if not (0.15 < hop_t < 1.10):
        return refuse("hop_time_implausible", hop_t=round(hop_t, 2))

    u1, v1 = to_uv(H, xs[i1], ys[i1])
    u2, v2 = to_uv(H, xs[i2], ys[i2])
    pad = 0.25
    on = lambda u, v: (-pad <= u <= W_M + pad) and (-pad <= v <= L_M + pad)
    if not (on(u1, v1) and on(u2, v2)):
        return refuse("bounce_off_table",
                      b1=[round(u1, 2), round(v1, 2)],
                      b2=[round(u2, 2), round(v2, 2)])
    if (v1 - NET_V) * (v2 - NET_V) > 0:
        return refuse("pair_same_half")
    hop_len = float(np.hypot(u2 - u1, v2 - v1))
    row["hop_speed"] = hop_len / hop_t
    if not (0.8 < row["hop_speed"] < 15):
        return refuse("hop_speed_implausible",
                      hop_speed=round(row["hop_speed"], 2))

    def window(lo, hi):
        m = (ts >= lo) & (ts <= hi)
        if m.sum() < 3:
            return None
        tt = ts[m]
        uv = np.array([to_uv(H, x, y) for x, y in zip(xs[m], ys[m])])
        return fit_velocity(tt, uv[:, 0], uv[:, 1])

    pre = window(b1t - WIN_S, b1t - 0.005)
    post = window(b1t + 0.02, min(b1t + WIN_S, b1t + hop_t * 0.6))
    if pre is None or post is None:
        return refuse("window_unfit")
    row["pre_speed"] = round(pre["speed"], 3)
    row["post_speed"] = round(post["speed"], 3)
    if not (0.5 < pre["speed"] < 20 and 0.3 < post["speed"] < 20):
        return refuse("speed_implausible")
    if pre["resid"] > 0.20 or post["resid"] > 0.20:
        return refuse("window_noisy")
    dh = np.arctan2(post["vv"], post["vu"]) - np.arctan2(pre["vv"], pre["vu"])
    while dh > np.pi:
        dh -= 2 * np.pi
    while dh < -np.pi:
        dh += 2 * np.pi
    row["kick1_deg"] = round(float(np.degrees(dh)), 1)
    if abs(row["kick1_deg"]) > 75:
        return refuse("heading_reversal", kick=row["kick1_deg"])

    ratio = post["speed"] / pre["speed"]
    row["ratio1"] = round(float(ratio), 3)
    if ratio < BACK_MAX:
        row["predicted_spin"], margin = "back", BACK_MAX - ratio
    elif ratio > TOP_MIN:
        row["predicted_spin"], margin = "top", ratio - TOP_MIN
    else:
        row["predicted_spin"] = "none"
        margin = min(ratio - BACK_MAX, TOP_MIN - ratio)
    row["confidence"] = round(float(min(0.95, 0.5 + 2.0 * margin)), 2)
    row["quality"] = dict(n_pre=pre["n"], n_post=post["n"],
                          b1=[round(u1, 2), round(v1, 2)],
                          b2=[round(u2, 2), round(v2, 2)])
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
    fired, skey_match = detected_serves()
    print(f"{len(fired)} points where the serve detector fired")
    mapping = det_matches(conn, skey_match)
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
        points = q(conn,
                   "select id::text, t0, cut_t0, placement from points "
                   "where match_id = %s and deleted is not true "
                   "and warmup is not true order by idx", (m["id"],))
        # Only points the shipped serve detector called a serve. Everything
        # else has no serve to judge, and asking a human to label it is
        # how a labeling queue becomes unusable.
        points = [p for p in points if p["id"] in fired]
        if not points:
            print(f"  {key}: no detected serves")
            continue
        counts = {}
        for p in points:
            row = measure(p, H, ts, xs, ys, fired[p["id"]])
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

    if not args.dry_run and not args.match:
        # Drop rows this run did not write: earlier versions queued every
        # point in the match, serve or not.
        with conn.cursor() as cur:
            cur.execute("delete from public.spin_predictions "
                        "where algo <> %s", (ALGO,))
            print(f"\npruned {cur.rowcount} rows from earlier runs")

    print("\ntotals:")
    for k, v in sorted(totals.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")
    measured = sum(v for k, v in totals.items() if k in ("top", "back", "none"))
    total = sum(totals.values())
    if total:
        print(f"yield: {measured}/{total} = {100 * measured / total:.0f}%")


if __name__ == "__main__":
    main()
