#!/usr/bin/env python3
"""PongLens points pipeline — self-contained port of the proven TTVid logic.

Subcommands (run under /Users/adil/Desktop/Projects/TTVid/vendor/venv python,
which has numpy + opencv; see worker/README.md):

  cut     blurball detections -> activity spans -> trimmed "pure play" video.
          Port of TTVid pipeline/cut_deadspace.py with strictness presets.

  points  Full point pipeline on the ORIGINAL video:
          activity spans -> play splitting (analyze_plays/split_plays port)
          -> auto table calibration (median background + pink-rim quad,
             calib_vaibhav derivation) -> pose over point windows only
             (subprocess into vendor/venv_pose ultralytics)
          -> per-point: clip (720px, audio), server (pose-bbox ball
             proximity, the validated 18/18 method), placement bounces
             (optional), winner/how SUGGESTION (umpire_v3 walker port,
             suggestions only — no strokes3d, so the serve anchor falls
             back to the first fitted segment and the forced-error km/h
             refinement is skipped).
          Writes <outdir>/points/NN.mp4 + <outdir>/match.json.

  pose    Internal: YOLO pose over frame windows only. Run under
          vendor/venv_pose python (ultralytics). Writes a pose jsonl with
          raw detections; side assignment happens in the `points` parent.

Everything degrades gracefully: if calibration fails, placement and
winner/how suggestions are skipped (noted in match.json) and server
detection falls back to a bbox-size depth cue; clips always ship.
"""
import argparse
import json
import math
import os
import subprocess
import sys

# ---------------------------------------------------------------------------
# Constants (table geometry in meters; px thresholds tuned at 1920x1080 and
# scaled by frame width)
# ---------------------------------------------------------------------------
W_M, L_M = 1.525, 2.74
NET_V = 1.37

BIN_S = 0.5
MIN_FAST = 4
MIN_KEEP = 1.6

STRICTNESS = {                     # (pre_s, post_s, merge_s) — SPEC.md §2
    "tight": (0.5, 1.0, 1.5),
    "normal": (1.0, 1.6, 2.2),
    "loose": (1.6, 2.4, 3.5),
}

# umpire_v3 thresholds (px values at 1920 width; scaled at runtime)
SERVER_FRAMES = 20
NET_BAND = 0.28
U_MARGIN_REF = 0.15
U_MARGIN_UNREF = 0.30
NEAR_OUT = 0.15
FAR_OUT_REF = 0.30
FAR_OUT_UNREF = 0.45
DEAD_GAP_S = 0.8
FLIGHT_GAP_S = 1.2
COINCIDENT_F = 3
LANDING_LOOKAHEAD_S = 1.0
NET_ABSORB = 0.35
HANDOVER_DV = 0.60
MIN_PTS = 4                        # min detections for a quadratic fit
MICRO_PLAY_S = 1.2                 # plays shorter than this with <2 hits
MICRO_PLAY_MIN_HITS = 2            # are ghost points and get dropped

VENV_POSE_PY = "/Users/adil/Desktop/Projects/TTVid/vendor/venv_pose/bin/python"
POSE_MODEL = "/Users/adil/Desktop/Projects/TTVid/pipeline/yolo11m-pose.pt"


class Px:
    """Pixel-tuned thresholds, scaled by frame width / 1920."""

    def __init__(self, width):
        s = width / 1920.0
        self.fast = 8.0 * s                # fast-ball frame-to-frame px
        self.hit_leg = 60.0 * s            # s-reversal leg (analyze_plays)
        self.srange_min = 350.0 * s        # serve-prep dribble threshold
        self.contact_min_leg = 150.0 * s   # px/s
        self.catch_max_out = 250.0 * s
        self.fast_out = 400.0 * s
        self.fast_seg = 150.0 * s
        self.pose_override = 100.0 * s
        self.pose_net = 130.0 * s
        self.wrist_racket_max = 170.0 * s
        self.max_bounce_shift = 30.0 * s


# ---------------------------------------------------------------------------
# ffprobe helpers
# ---------------------------------------------------------------------------
def probe(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,avg_frame_rate",
         "-show_entries", "format=duration", "-of", "json", video],
        capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    st = j["streams"][0]
    num, den = st["avg_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) else 29.97
    return {"width": int(st["width"]), "height": int(st["height"]),
            "fps": fps, "duration": float(j["format"]["duration"])}


def load_detections(path):
    det = {}
    with open(path) as fh:
        for line in fh:
            r = json.loads(line)
            if r.get("x") is not None:
                det[r["f"]] = (r["x"], r["y"])
    return det


# ---------------------------------------------------------------------------
# Activity spans (cut_deadspace.py port, parameterized paddings)
# ---------------------------------------------------------------------------
def activity_spans(det, dur, fps, pre, post, merge, px):
    import numpy as np
    nb = int(dur / BIN_S) + 1
    fast = np.zeros(nb)
    for f, (x, y) in det.items():
        p = det.get(f - 1)
        if p and ((x - p[0]) ** 2 + (y - p[1]) ** 2) ** 0.5 > px.fast:
            b = int(f / fps / BIN_S)
            if b < nb:
                fast[b] += 1
    active = fast >= MIN_FAST
    spans = []
    i = 0
    while i < nb:
        if active[i]:
            j = i
            while j + 1 < nb and (active[j + 1] or
                                  (j + 2 < nb and active[j + 2])):
                j += 1
            t0 = max(0.0, i * BIN_S - pre)
            t1 = min(dur, (j + 1) * BIN_S + post)
            if spans and t0 - spans[-1][1] < merge:
                spans[-1][1] = t1
            else:
                spans.append([t0, t1])
            i = j + 1
        else:
            i += 1
    return [s for s in spans if s[1] - s[0] >= MIN_KEEP]


def cmd_cut(args):
    px = Px(probe(args.video)["width"])
    meta = probe(args.video)
    pre, post, merge = STRICTNESS[args.strictness]
    det = load_detections(args.blurball)
    spans = activity_spans(det, meta["duration"], meta["fps"],
                           pre, post, merge, px)
    kept = sum(s[1] - s[0] for s in spans)
    print(f"{len(spans)} active spans, keeping {kept:.1f}s of "
          f"{meta['duration']:.1f}s "
          f"({100 * kept / max(meta['duration'], 1e-6):.0f}%) "
          f"[strictness={args.strictness}]")
    if not spans:
        raise SystemExit("no active spans found — refusing to cut")
    tmp = args.out + ".parts"
    os.makedirs(tmp, exist_ok=True)
    parts = []
    for i, (t0, t1) in enumerate(spans):
        part = f"{tmp}/part_{i:03d}.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{t0:.2f}",
             "-i", args.video, "-t", f"{t1 - t0:.2f}",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-c:a", "aac", "-b:a", "128k", part], check=True)
        parts.append(part)
    with open(f"{tmp}/list.txt", "w") as fh:
        fh.write("\n".join(f"file {os.path.basename(p)!r}" for p in parts))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat",
                    "-safe", "0", "-i", f"{tmp}/list.txt", "-c", "copy",
                    args.out], check=True)
    if not os.path.exists(args.out) or os.path.getsize(args.out) == 0:
        raise SystemExit("cut produced no output")
    print(f"wrote {args.out}")


# ---------------------------------------------------------------------------
# Auto table calibration — median background + pink-rim quad
# (calib_vaibhav_bg.py / calib_vaibhav_quad.py derivation, generalized)
# ---------------------------------------------------------------------------
def calibrate(video, workdir, det, px):
    """Returns {"H", "e", "roi", "corners_px", "note", "debug"} or None.

    Pink-FREQUENCY mask (a pixel is rim if pink in >=25% of sampled
    frames — recovers rim stretches the players occlude in a plain median
    background), then two-pass component selection with ball evidence:
    components with table bounces nearby are seeds (kills pink signs,
    banners, floor reflections), and remaining pink fragments adjacent to
    the seed bbox complete the ring. Quad = 4-corner approx of the union
    hull."""
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(video)
    frames = []
    f = 0
    while True:                       # sequential decode, no seeks
        ok = cap.grab()
        if not ok:
            break
        if f % 20 == 0:
            ok, img = cap.retrieve()
            if ok:
                frames.append(img)
        f += 1
    cap.release()
    if len(frames) < 5:
        return None
    sub = frames[:: max(1, len(frames) // 150)]
    hgt, wid = sub[0].shape[:2]
    scale = wid / 1920.0

    acc = None
    for img in sub:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h = hsv[..., 0].astype(int)
        s = hsv[..., 1].astype(int)
        v = hsv[..., 2].astype(int)
        # pink/magenta table rim (JOOLA): hue ~130-179 or 0-10, saturated
        m = (((h >= 130) | (h <= 10)) & (s >= 50) & (v >= 80)) \
            .astype(np.float32)
        acc = m if acc is None else acc + m
    pink = ((acc / len(sub)) >= 0.25).astype(np.uint8) * 255
    pink = cv2.morphologyEx(
        pink, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(pink)
    if n <= 1:
        return None

    # ball bounce candidates: local image-y maxima of a moving ball —
    # they happen ON the table surface, i.e. right at rim level
    bpts = []
    for fr in det:
        if not all(ff in det for ff in
                   (fr - 2, fr - 1, fr + 1, fr + 2)):
            continue
        yv = [det[ff][1] for ff in (fr - 2, fr - 1, fr, fr + 1, fr + 2)]
        if not (yv[2] >= yv[1] and yv[2] >= yv[3] and
                yv[2] - yv[0] >= 3 and yv[2] - yv[4] >= 3):
            continue
        if math.hypot(det[fr][0] - det[fr - 1][0],
                      det[fr][1] - det[fr - 1][1]) < 4:
            continue
        bpts.append(det[fr])
    if len(bpts) < 4:
        return None
    bpts = np.array(bpts, np.float32)

    min_area = 200 * scale ** 2
    pad = 20 * scale
    comps = [i for i in range(1, n)
             if stats[i, cv2.CC_STAT_AREA] >= min_area]

    def bbox(i):
        return (stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP],
                stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH],
                stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT])

    seeds = []
    for i in comps:
        x0c, y0c, x1c, y1c = bbox(i)
        nin = int(((bpts[:, 0] > x0c - pad) & (bpts[:, 0] < x1c + pad) &
                   (bpts[:, 1] > y0c - pad) & (bpts[:, 1] < y1c + pad))
                  .sum())
        if nin >= 3:
            seeds.append(i)
    if not seeds:
        return None                    # nothing pink where the ball bounces
    sx0 = min(bbox(i)[0] for i in seeds)
    sy0 = min(bbox(i)[1] for i in seeds)
    sx1 = max(bbox(i)[2] for i in seeds)
    sy1 = max(bbox(i)[3] for i in seeds)
    margin = 25 * scale
    keep = set(seeds)
    for i in comps:                    # rim fragments adjacent to the seeds
        x0c, y0c, x1c, y1c = bbox(i)
        cx, cy = (x0c + x1c) / 2.0, (y0c + y1c) / 2.0
        if sx0 - margin <= cx <= sx1 + margin and \
           sy0 - margin <= cy <= sy1 + margin:
            keep.add(i)
    mask = np.isin(lab, list(keep))
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], -1).astype(np.float32)
    hull = cv2.convexHull(pts)
    peri = cv2.arcLength(hull, True)
    ap = hull
    for eps in np.linspace(0.005, 0.05, 40):
        ap = cv2.approxPolyDP(hull, eps * peri, True)
        if len(ap) <= 4:
            break
    if len(ap) != 4:
        return None
    quad = ap.reshape(4, 2).astype(np.float32)   # cyclic hull order

    # plausibility: convex quad, sane area, no degenerate edges
    area = cv2.contourArea(quad)
    if not (0.002 * wid * hgt < area < 0.6 * wid * hgt):
        return None
    edges = [np.linalg.norm(quad[(i + 1) % 4] - quad[i]) for i in range(4)]
    if min(edges) < 25 * wid / 1920.0:
        return None

    # opposite-edge pairing: sidelines (2.74 m) are the longer pair in px
    pair_a = edges[0] + edges[2]      # edges (0-1, 2-3)
    pair_b = edges[1] + edges[3]      # edges (1-2, 3-0)
    if pair_a >= pair_b:
        # 0-1 and 2-3 are sidelines; ends are 1-2 and 3-0
        ends = [(1, 2), (3, 0)]
    else:
        ends = [(0, 1), (2, 3)]
    # near end line = larger apparent (px) end edge
    e0 = np.linalg.norm(quad[ends[0][1]] - quad[ends[0][0]])
    e1 = np.linalg.norm(quad[ends[1][1]] - quad[ends[1][0]])
    na, nb_ = ends[0] if e0 >= e1 else ends[1]
    # rotate the cyclic order so it reads A(near) B(near) C(far) D(far)
    order = [na, nb_, (nb_ + 1) % 4, (nb_ + 2) % 4]
    A, B, C, D = [quad[i] for i in order]

    src = np.array([A, B, C, D], np.float32)
    dst = np.array([[0, 0], [W_M, 0], [W_M, L_M], [0, L_M]], np.float32)
    H = cv2.getPerspectiveTransform(src, dst)
    e = ((D - A) + (C - B)) / 2.0
    e = e / np.linalg.norm(e)

    # split-plays ROI: quad bbox padded up for ball flight, out for reach
    x0, y0 = quad.min(axis=0)
    x1, y1 = quad.max(axis=0)
    bw, bh = x1 - x0, y1 - y0
    roi = (float(x0 - 0.2 * bw), float(x1 + 0.2 * bw),
           float(y0 - 1.5 * bh), float(y1 + 0.6 * bh))

    bg = np.median(np.stack(sub[:: max(1, len(sub) // 40)]),
                   axis=0).astype(np.uint8)
    dbg = bg.copy()
    cv2.polylines(dbg, [src.astype(int)], True, (0, 255, 0), 2)
    for name, p in zip("ABCD", src):
        cv2.circle(dbg, tuple(int(q) for q in p), 6, (0, 0, 255), 2)
        cv2.putText(dbg, name, (int(p[0]) + 8, int(p[1]) - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    debug_path = os.path.join(workdir, "calib_debug.jpg")
    cv2.imwrite(debug_path, dbg, [cv2.IMWRITE_JPEG_QUALITY, 90])

    return {
        "H": H, "e": (float(e[0]), float(e[1])), "roi": roi,
        "corners_px": {k: [round(float(p[0]), 1), round(float(p[1]), 1)]
                       for k, p in zip(["A_near_1", "B_near_2",
                                        "C_far_2", "D_far_1"], src)},
        "note": "auto pink-rim median-background calibration; "
                "A-B = near end line (v=0), C-D = far end (v=2.74)",
        "debug": debug_path,
    }


# ---------------------------------------------------------------------------
# Play splitting inside a span (analyze_plays.split_plays port)
# ---------------------------------------------------------------------------
def split_plays(det, f0, f1, fps, px, roi=None, e=None):
    import numpy as np
    bin_f = max(1, int(round(BIN_S * fps)))
    nb = (f1 - f0) // bin_f + 1
    fast = np.zeros(nb)
    for f in range(f0, f1):
        if f in det and f - 1 in det:
            x, y = det[f]
            if roi and not (roi[0] < x < roi[1] and roi[2] < y < roi[3]):
                continue
            pxy = det[f - 1]
            if ((x - pxy[0]) ** 2 + (y - pxy[1]) ** 2) ** 0.5 > px.fast:
                fast[(f - f0) // bin_f] += 1
    active = fast >= MIN_FAST
    spans = []
    i = 0
    while i < nb:
        if active[i]:
            j = i
            while j + 1 < nb and (active[j + 1] or
                                  (j + 2 < nb and active[j + 2])):
                j += 1
            spans.append((i, j))
            i = j + 1
        else:
            i += 1
    merged = []
    for sp in spans:
        if merged and sp[0] - merged[-1][1] <= 2 and \
           (merged[-1][1] - merged[-1][0]) < 2:
            merged[-1] = (merged[-1][0], sp[1])
        elif (sp[1] - sp[0]) < 1 and merged:
            continue
        else:
            merged.append(list(sp))
    wins = [(f0 + a * bin_f, min(f1, f0 + (b + 1) * bin_f))
            for a, b in merged]
    if e is None:
        return wins or [(f0, f1)]

    def srange(w):
        ss = [det[f][0] * e[0] + det[f][1] * e[1]
              for f in range(w[0], w[1]) if f in det]
        return (max(ss) - min(ss)) if ss else 0

    out, carry = [], None
    for w in wins:
        if carry is not None:
            w = (carry, w[1])
            carry = None
        if srange(w) < px.srange_min:
            carry = w[0]
        else:
            out.append(w)
    if carry is not None and out:
        out[-1] = (out[-1][0], f1)
    return out or [(f0, f1)]


# ---------------------------------------------------------------------------
# Track fitting (fit_segments_vaibhav.py port)
# ---------------------------------------------------------------------------
def _project(H, x, y):
    import cv2
    import numpy as np
    p = cv2.perspectiveTransform(np.array([[[x, y]]], np.float32), H)[0, 0]
    return float(p[0]), float(p[1])


def fit_play(det, H, e, f0, f1, fps, px):
    import cv2
    import numpy as np

    def detect_hits(s, v):
        hits = []
        for i in range(3, len(s) - 3):
            b = s[i] - s[max(0, i - 6)]
            a = s[min(len(s) - 1, i + 6)] - s[i]
            if abs(b) >= px.hit_leg and abs(a) >= px.hit_leg and b * a < 0:
                if v[i] < -0.05 or v[i] > L_M + 0.05:
                    continue           # beyond an end line: body save
                if not hits or i - hits[-1] > 5:
                    hits.append(i)
        return hits

    def detect_bounces(y, hits):
        out = []
        for j in range(2, len(y) - 2):
            if y[j] - y[j - 2] > 2 and y[j + 2] - y[j] < -2 and \
               y[j] >= max(y[j - 1], y[j + 1]):
                if any(abs(j - hh) <= 3 for hh in hits):
                    continue
                out.append(j)
        return out

    def fit_quad(t, w):
        if len(t) < MIN_PTS:
            return None
        T = t - t[0]
        c = np.polyfit(T, w, 2)
        res = np.abs(np.polyval(c, T) - w)
        thr = max(15.0, 3.0 * res.std())
        keep = res <= thr
        if keep.sum() >= MIN_PTS and keep.sum() < len(t):
            c = np.polyfit(T[keep], w[keep], 2)
        return [float(c[2]), float(c[1]), float(c[0])]

    def shift_poly(c, hshift):
        c0, c1, c2 = c
        return np.array([c0 + c1 * hshift + c2 * hshift * hshift,
                         c1 + 2 * c2 * hshift, c2])

    max_shift_t = 2.0 / fps

    def refine_bounce(segA, segB, tb, xr, yr):
        ya = shift_poly(segA["cy"], tb - segA["t0"])
        yb = shift_poly(segB["cy"], tb - segB["t0"])
        d = ya - yb
        if abs(d[2]) < 1e-9 and abs(d[1]) < 1e-9:
            return None
        roots = np.roots(d[::-1]) if abs(d[2]) >= 1e-9 else \
            np.array([-d[0] / d[1]])
        real = [r.real for r in roots if abs(r.imag) < 1e-9]
        real = [r for r in real if abs(r) <= max_shift_t]
        if not real:
            return None
        dt = min(real, key=abs)
        ts = tb + dt
        ysv = float(np.polyval(shift_poly(segA["cy"],
                                          tb - segA["t0"])[::-1], dt))
        xa = float(np.polyval(shift_poly(segA["cx"],
                                         tb - segA["t0"])[::-1], dt))
        xb = float(np.polyval(shift_poly(segB["cx"],
                                         tb - segB["t0"])[::-1], dt))
        xsv = 0.5 * (xa + xb)
        if np.hypot(xsv - xr, ysv - yr) > px.max_bounce_shift:
            return None
        return ts, xsv, ysv

    frames = [f for f in range(f0, f1) if f in det]
    if len(frames) < 8:
        return None
    t = np.array(frames, float) / fps
    x = np.array([det[f][0] for f in frames])
    y = np.array([det[f][1] for f in frames])
    s = x * e[0] + y * e[1]
    proj = cv2.perspectiveTransform(
        np.stack([x, y], -1)[None].astype(np.float32), H)[0]
    v = proj[:, 1]

    hit_idx = detect_hits(s, v)
    bounce_idx = detect_bounces(y, hit_idx)

    hits = []
    for i in hit_idx:
        b = s[i] - s[max(0, i - 6)]
        hits.append({"t": round(t[i], 4), "x": round(float(x[i]), 2),
                     "y": round(float(y[i]), 2),
                     "side": "near" if b < 0 else "far"})
    serve_side = "near" if v[0] < NET_V else "far"

    def side_at(i):
        prior = [k for k, hh in enumerate(hit_idx) if hh <= i]
        if prior:
            return hits[prior[-1]]["side"]
        return ("far" if hits[0]["side"] == "near" else "near") if hits \
            else serve_side

    ev = sorted(set(hit_idx) | set(bounce_idx))
    bnds = [0] + ev + [len(t) - 1]
    segments, seg_span = [], []
    for a, b in zip(bnds[:-1], bnds[1:]):
        if b - a + 1 < MIN_PTS:
            continue
        tt, xx, yy = t[a:b + 1], x[a:b + 1], y[a:b + 1]
        cx, cy = fit_quad(tt, xx), fit_quad(tt, yy)
        if cx is None or cy is None:
            continue
        segments.append({"t0": round(float(tt[0]), 4),
                         "t1": round(float(tt[-1]), 4),
                         "cx": cx, "cy": cy})
        seg_span.append((a, b))

    bounces = []
    for j in bounce_idx:
        tb, xr, yr = float(t[j]), float(x[j]), float(y[j])
        segA = next((segments[k] for k, (a, b) in enumerate(seg_span)
                     if b == j), None)
        segB = next((segments[k] for k, (a, b) in enumerate(seg_span)
                     if a == j), None)
        ref = refine_bounce(segA, segB, tb, xr, yr) \
            if segA and segB else None
        if ref:
            ts, xsv, ysv = ref
        else:
            ts, xsv, ysv = tb, xr, yr
        us, vs = _project(H, xsv, ysv)
        bounces.append({"t": round(ts, 4), "x": round(xsv, 2),
                        "y": round(ysv, 2), "u": round(us, 3),
                        "v": round(vs, 3), "side": side_at(j),
                        "refined": ref is not None})
    return {"segments": segments, "bounces": bounces, "hits": hits}


# ---------------------------------------------------------------------------
# Server detection (umpire_v3 R1 — pose-bbox ball proximity, 18/18 on truth)
# ---------------------------------------------------------------------------
def detect_server(det, pose, f0, f1):
    f_vote = next((f for f in range(f0, f1) if f in det), f0)
    votes = {"near": 0, "far": 0}
    for f in range(f_vote, f_vote + SERVER_FRAMES):
        if f not in det or f not in pose:
            continue
        bx, by = det[f]
        best, side = None, None
        for pl in pose[f]:
            if "side" not in pl:
                continue
            x0, y0, x1, y1 = pl["bbox"]
            dx = max(x0 - bx, 0, bx - x1)
            dy = max(y0 - by, 0, by - y1)
            d = (dx * dx + dy * dy) ** 0.5
            if best is None or d < best:
                best, side = d, pl["side"]
        if side:
            votes[side] += 1
    if votes["near"] == votes["far"]:
        return None
    return "near" if votes["near"] > votes["far"] else "far"


# ---------------------------------------------------------------------------
# Winner/how suggestion (umpire_v3 walker port; strokes3d unavailable, so the
# serve anchor is the first fitted segment and R14's forced-error km/h
# refinement is skipped — suggestions only, surfaced only in the scorecard UI)
# ---------------------------------------------------------------------------
def _other(s):
    return "far" if s == "near" else "near"


def classify_play(det, pose, H, e, track, server_side, fps, px):
    import numpy as np

    def seg_mid_vel(seg):
        dt = (seg["t1"] - seg["t0"]) / 2
        return ((seg["cx"][1] + 2 * seg["cx"][2] * dt) * e[0] +
                (seg["cy"][1] + 2 * seg["cy"][2] * dt) * e[1])

    def seg_pos(seg, t):
        dt = t - seg["t0"]
        return (seg["cx"][0] + seg["cx"][1] * dt + seg["cx"][2] * dt * dt,
                seg["cy"][0] + seg["cy"][1] * dt + seg["cy"][2] * dt * dt)

    def pose_wrist_dist(f, x, y):
        best = {"near": None, "far": None}
        for ff in range(int(f) - 2, int(f) + 3):
            for pl in pose.get(ff, []):
                if "side" not in pl:
                    continue
                for kx, ky, kc in (pl["kpts"][9], pl["kpts"][10]):
                    if kc < 0.3:
                        continue
                    d = ((kx - x) ** 2 + (ky - y) ** 2) ** 0.5
                    if best[pl["side"]] is None or d < best[pl["side"]]:
                        best[pl["side"]] = d
        return best

    def bounce_pre_post_vel(tb):
        pre = post = None
        best_pre = best_post = 0.1
        for s in track["segments"]:
            if abs(s["t1"] - tb) < best_pre:
                best_pre, pre = abs(s["t1"] - tb), seg_mid_vel(s)
            if abs(s["t0"] - tb) < best_post:
                best_post, post = abs(s["t0"] - tb), seg_mid_vel(s)
        return pre, post

    def striker_by_direction(t_event):
        cands = [s for s in track["segments"] if s["t1"] <= t_event + 0.05]
        for s in reversed(cands):
            sv = seg_mid_vel(s)
            if abs(sv) >= px.fast_seg:
                return "near" if sv > 0 else "far"
        return None

    def find_contacts():
        segs = track["segments"]
        out = []
        for i in range(1, len(segs)):
            a, b = segs[i - 1], segs[i]
            if b["t0"] - a["t1"] > 0.35:
                continue
            va, vb = seg_mid_vel(a), seg_mid_vel(b)
            if va == 0 or vb == 0 or va * vb > 0:
                continue
            if max(abs(va), abs(vb)) < px.contact_min_leg:
                continue
            t = b["t0"]
            x, y = seg_pos(b, t)
            u, v = _project(H, x, y)
            side = "near" if vb > 0 else "far"
            wd = pose_wrist_dist(t * fps, x, y)
            if min(abs(va), abs(vb)) < px.contact_min_leg:
                cand = [(d, s) for s, d in wd.items()
                        if d is not None and d < px.pose_override]
                if cand:
                    cand.sort()
                    side = cand[0][1]
            min_wd = min([d for d in wd.values() if d is not None] or [9e9])
            interior = 0.15 < v < 2.45 and 0.05 < u < W_M - 0.05
            side_ok = (side == "near" and v <= 1.65) or \
                      (side == "far" and v >= 2.30)
            in_band = abs(v - NET_V) < 0.30
            near_band = abs(v - NET_V) < 0.75
            fast_out = abs(vb) >= px.catch_max_out
            weak = False
            if in_band and min_wd > px.pose_net and not fast_out:
                kind = "netc"
            elif not (-0.90 <= u <= W_M + 0.90):
                kind = "noise"
            elif not side_ok:
                if near_band and not fast_out:
                    kind = "netc"
                elif in_band and fast_out:
                    kind = "contact"
                else:
                    kind = "noise"
            elif interior and min_wd > px.wrist_racket_max:
                kind = "contact"
                weak = True
            else:
                kind = "contact"
            if kind == "noise":
                continue
            out.append({"t": t, "x": x, "y": y, "u": u, "v": v,
                        "type": kind, "side": side, "va": va, "vb": vb,
                        "weak": weak, "wd": min_wd})
        return out

    def raw_landing_between(half, t0, t1):
        f0, f1 = int(t0 * fps) + 2, int(t1 * fps)
        for f in range(f0, f1):
            if not all(ff in det for ff in
                       (f - 2, f - 1, f, f + 1, f + 2)):
                continue
            yv = [det[ff][1] for ff in (f - 2, f - 1, f, f + 1, f + 2)]
            if not (yv[2] >= yv[1] and yv[2] >= yv[3] and
                    yv[2] - yv[0] >= 3 and yv[2] - yv[4] >= 3):
                continue
            u, v = _project(H, *det[f])
            on = -U_MARGIN_UNREF <= u <= W_M + U_MARGIN_UNREF and \
                -NEAR_OUT <= v <= L_M + FAR_OUT_UNREF
            if on and ("near" if v < NET_V else "far") == half:
                return True
        return False

    def recover_bounces(contacts, t0, t1):
        have = {round(b["t"] * fps) for b in track["bounces"]}
        cframes = [round(c["t"] * fps) for c in contacts]
        out = []
        f0, f1 = int(t0 * fps), int(t1 * fps)
        for f in range(f0 + 2, f1 - 2):
            if any(abs(f - cf) <= 4 for cf in cframes):
                continue
            if not all(ff in det for ff in
                       (f - 2, f - 1, f, f + 1, f + 2)):
                continue
            yv = [det[ff][1] for ff in (f - 2, f - 1, f, f + 1, f + 2)]
            if not (yv[2] >= yv[1] and yv[2] >= yv[3] and
                    yv[2] - yv[0] >= 3 and yv[2] - yv[4] >= 3):
                continue
            sp1 = math.hypot(det[f][0] - det[f - 1][0],
                             det[f][1] - det[f - 1][1])
            sp2 = math.hypot(det[f + 1][0] - det[f][0],
                             det[f + 1][1] - det[f][1])
            if max(sp1, sp2) < 4:
                continue
            if any(abs(f - hh) <= 5 for hh in have):
                continue
            u, v = _project(H, *det[f])
            if not (-U_MARGIN_UNREF <= u <= W_M + U_MARGIN_UNREF and
                    -NEAR_OUT <= v <= L_M + FAR_OUT_UNREF):
                continue
            out.append({"t": f / fps, "x": det[f][0], "y": det[f][1],
                        "u": round(u, 3), "v": round(v, 3),
                        "refined": False, "synthetic": True})
            have.add(f)
        return out

    def bflags(b):
        um = U_MARGIN_REF if b["refined"] else U_MARGIN_UNREF
        fm = FAR_OUT_REF if b["refined"] else FAR_OUT_UNREF
        u, v = b["u"], b["v"]
        in_u = -um <= u <= W_M + um
        off_near = v < -NEAR_OUT
        off_far = v > L_M + fm
        return {"on": in_u and not off_near and not off_far,
                "half": "near" if v < NET_V else "far",
                "netz": abs(v - NET_V) < NET_BAND,
                "off_near": off_near, "off_far": off_far, "in_u": in_u}

    serve_t = track["segments"][0]["t0"] if track["segments"] else 0
    track_t1 = track["segments"][-1]["t1"] if track["segments"] else serve_t

    contacts = find_contacts()
    kept = [c for c in contacts if c["type"] == "contact"]
    bounces = list(track["bounces"]) + \
        recover_bounces(kept, serve_t, track_t1)

    events = []
    for b in bounces:
        fl = bflags(b)
        coin = any(abs(c["t"] - b["t"]) * fps <= COINCIDENT_F for c in kept)
        if coin and (not fl["on"] or fl["netz"]):
            continue
        events.append({"type": "bounce", **b, **fl})
    for c in contacts:
        t_adj = c["t"]
        for b in events:
            if b["type"] == "bounce" and b["on"] and \
               abs(b["t"] - c["t"]) * fps <= COINCIDENT_F and \
               b["t"] > t_adj:
                t_adj = b["t"] + 1e-4
        events.append({**c, "t_adj": t_adj})
    for ev in events:
        ev.setdefault("t_adj", ev["t"])
    events = [ev for ev in events if ev["t"] >= serve_t - 2 / fps]
    events.sort(key=lambda ev: (ev["t_adj"],
                                0 if ev["type"] == "bounce" else 1))

    cur = server_side
    n_hits = 1
    own_bounce = False
    served_across = False
    opp_bounce = None
    side_bounced = {"near": False, "far": False}
    netcord = False
    winner = how = reason = None
    last_contact = None
    last_contact_coincident = False
    prev_t = serve_t

    def terminal(w, h, r):
        nonlocal winner, how, reason
        winner, how, reason = w, h, r

    def net_event(i, ev):
        nonlocal netcord
        if last_contact is not None and ev["t"] - last_contact["t"] < 1.2:
            striker = cur
        else:
            striker = striker_by_direction(ev["t"]) or cur
        later = [b for b in events[i + 1:]
                 if b["type"] == "bounce" and b["t"] - ev["t"] < DEAD_GAP_S]
        over = [b for b in later if b["on"] and
                b["half"] == _other(striker) and not b["netz"]]
        died = [b for b in later if b["netz"] or b["half"] == striker]
        if over and not (died and died[0]["t"] < over[0]["t"]):
            netcord = True
            return False
        h = "hit into net"
        if not (-0.05 <= ev.get("u", 0.5) <= W_M + 0.05):
            h = "missed table (long/wide)"
        terminal(_other(striker), h,
                 f"net death t={ev['t']:.2f} striker={striker}")
        return True

    i = 0
    started = False
    while i < len(events):
        ev = events[i]
        gap_lim = DEAD_GAP_S if opp_bounce is not None else FLIGHT_GAP_S
        if started and ev["t"] - prev_t > gap_lim:
            if ev["type"] == "bounce" and not ev["on"] and \
                    ev["t"] - prev_t < 1.5 and opp_bounce is None:
                pend = striker_by_direction(ev["t"]) or cur
                consistent = (ev["off_near"] and pend == "far") or \
                             (ev["off_far"] and pend == "near") or \
                             not ev["in_u"]
                if consistent:
                    terminal(_other(pend), "missed table (long/wide)",
                             f"post-gap miss v={ev['v']:.2f}")
                    break
            break
        prev_t = max(prev_t, ev["t"])
        started = True

        if ev["type"] == "netc":
            if net_event(i, ev):
                break
            i += 1
            continue

        if ev["type"] == "contact":
            side = ev["side"]
            bounced_in = side_bounced[side]
            if not bounced_in and last_contact is not None:
                bounced_in = raw_landing_between(
                    side, last_contact["t"], ev["t"])
            if cur != side and not bounced_in and n_hits >= 2 and \
                    not ev.get("weak"):
                if abs(ev["vb"]) < px.catch_max_out:
                    terminal(side, None, "catch of dead ball")
                    last_contact = ev
                    break
                landing = [b for b in events[i + 1:]
                           if b["type"] == "bounce" and
                           b["half"] == _other(side) and
                           b["t"] - ev["t"] < LANDING_LOOKAHEAD_S]
                if not landing:
                    terminal(side, "missed table (long/wide)",
                             "unbounced interception, no reply landing")
                    last_contact = ev
                    break
            cur = side
            n_hits += 1
            opp_bounce = None
            last_contact_coincident = any(
                b["type"] == "bounce" and b["on"] and
                b["half"] == side and
                abs(b["t"] - ev["t"]) * fps <= COINCIDENT_F
                for b in events)
            side_bounced = {"near": False, "far": False}
            netcord = False
            last_contact = ev
            i += 1
            continue

        b = ev
        side_bounced[b["half"]] = True
        if b["half"] != server_side:
            served_across = True
        if not b["on"]:
            if opp_bounce is not None:
                w = _other(cur) if (last_contact_coincident and
                                    last_contact is not None and
                                    opp_bounce["t"] > last_contact["t"]) \
                    else cur
                terminal(w, "exit", f"exited after landing v={b['v']:.2f}")
            else:
                terminal(_other(cur), "missed table (long/wide)",
                         f"off-table v={b['v']:.2f} u={b['u']:.2f}")
            break
        if b["netz"] and not b.get("synthetic"):
            pre, post = bounce_pre_post_vel(b["t"])
            absorbed = pre is not None and (
                post is None or
                (abs(post) < NET_ABSORB * abs(pre) and
                 abs(post) < px.fast_seg) or
                (pre * (post or 0) < 0 and abs(post) < px.fast_seg))
            if absorbed:
                if net_event(i, b):
                    break
                if b["half"] == _other(cur):
                    opp_bounce = b
                i += 1
                continue
        if b["half"] == cur:
            if not served_across and b["half"] == server_side:
                own_bounce = True
                i += 1
                continue
            if opp_bounce is not None:
                cur = _other(cur)
                n_hits += 1
                opp_bounce = b
                side_bounced = {"near": False, "far": False}
                side_bounced[b["half"]] = True
                i += 1
                continue
            h = "hit into net" if abs(b["v"] - NET_V) <= 0.9 \
                else "missed table (long/wide)"
            terminal(_other(cur), h, f"own-half bounce v={b['v']:.2f}")
            break
        if opp_bounce is not None:
            toward_net = (opp_bounce["v"] - b["v"]) if cur == "near" \
                else (b["v"] - opp_bounce["v"])
            if toward_net > HANDOVER_DV:
                cur = _other(cur)
                n_hits += 1
                opp_bounce = b if b["half"] == _other(cur) else None
                side_bounced = {"near": False, "far": False}
                side_bounced[b["half"]] = True
                i += 1
                continue
            played_on = any(c["type"] == "contact" and
                            0 < c["t"] - b["t"] < 0.6 for c in kept)
            if played_on:
                opp_bounce = b
                i += 1
                continue
            h = "double bounce / no return"
            if netcord or toward_net > 0.05:
                h = "edge/net-cord lucky ball"
            terminal(cur, h, "double bounce")
            break
        opp_bounce = b
        i += 1

    coincident_vanish = False
    if winner is None:
        last_seg = track["segments"][-1] if track["segments"] else None
        end_u = end_v = end_speed = None
        if last_seg:
            x, y = seg_pos(last_seg, last_seg["t1"])
            end_u, end_v = _project(H, x, y)
            end_speed = abs(seg_mid_vel(last_seg))
        crossed = None
        if last_contact is not None and end_v is not None:
            crossed = (end_v > NET_V) if last_contact["side"] == "near" \
                else (end_v < NET_V)
        if opp_bounce is not None:
            winner = _other(cur) if (last_contact_coincident and
                                     last_contact is not None and
                                     opp_bounce["t"] > last_contact["t"]) \
                else cur
            how = "exit"
            reason = "opp-half landing, no return"
        elif end_v is not None and abs(end_v - NET_V) < 0.55 and \
                (end_speed or 0) < px.fast_out:
            striker = striker_by_direction(track_t1 + 1) or cur
            winner = _other(striker)
            how = "hit into net"
            if end_u is not None and not (-0.05 <= end_u <= W_M + 0.05):
                how = "missed table (long/wide)"
            reason = f"died near net v={end_v:.2f}"
        elif last_contact is not None and \
                last_contact["type"] == "contact" and \
                not last_contact.get("weak") and \
                last_contact_coincident and crossed:
            winner = last_contact["side"]
            coincident_vanish = True
            how = "clean winner" if abs(last_contact["vb"]) >= px.fast_out \
                else "missed table (long/wide)"
            reason = "coincident-contact vanish (crossed)"
        elif last_contact is not None and \
                last_contact["type"] == "contact" and \
                crossed is False and (end_speed or 0) < px.fast_seg:
            winner = _other(last_contact["side"])
            how = "hit into net"
            reason = f"died on own half v={end_v:.2f}"
        elif (end_speed or 0) >= px.fast_out and n_hits >= 2:
            winner = cur
            how = "clean winner"
            reason = "fast vanish toward opponent"
        else:
            winner = _other(cur)
            how = "missed table (long/wide)"
            reason = "vanished"

    # R14 mapping without strokes3d: no km/h forced-error refinement
    if reason == "catch of dead ball":
        how = "missed table (long/wide)"
    elif how == "missed table (long/wide)" and winner != cur and \
            not coincident_vanish:
        if last_contact is not None and last_contact.get("weak"):
            how = "clean winner"
    elif how == "exit":
        how = "missed table (long/wide)" if n_hits <= 1 else "clean winner"

    return {"winner_side": winner, "how": how, "last_hitter_side": cur,
            "n_hits": n_hits, "reason": reason}


# ---------------------------------------------------------------------------
# Placement v2 — ordered, role-tagged on-table bounces for the mini-map.
#
# Bounces only, never racket contacts: the homography H maps the TABLE PLANE
# to table coordinates, and racket contacts happen well above (and often
# beyond) that plane, so projecting them through H yields meaningless u/v.
# Contact points are deliberately excluded from the placement map.
# ---------------------------------------------------------------------------
PLACEMENT_U_PAD = 0.06     # keep edge balls: slight off-width tolerance (m)
PLACEMENT_V_MIN = -0.08
PLACEMENT_V_MAX = 2.95


def _final_kind(how):
    """Umpire suggestion's how -> the final bounce's kind for the map."""
    if how == "hit into net":
        return "net"
    if how == "missed table (long/wide)":
        return "out_adjacent"
    if how in ("clean winner", "double bounce / no return",
               "edge/net-cord lucky ball", "exit"):
        return "winner_landing"
    return "unknown"


def build_placement(track, srv_side, suggestion):
    """Role-tagged placement: {"v": 2, "bounces": [...]} or None.

    Each on-table bounce carries {seq, t, u, v, role, hitter_side}:
      serve_1  the serve's bounce on the server's own half
      serve_2  the serve landing on the receiver's half (the valuable one)
      rally    everything in between, numbered by exchange (rally_n)
      final    the point's last bounce, annotated with final_kind from the
               umpire suggestion: winner_landing | net | out_adjacent |
               unknown
    Old rows keep the v1 shape ({"bounces": [{t,u,v,side}]}); the UI falls
    back to a plain dot map for those.
    """
    if not track or not track.get("bounces"):
        return None
    bs = [b for b in sorted(track["bounces"], key=lambda b: b["t"])
          if -PLACEMENT_U_PAD <= b["u"] <= W_M + PLACEMENT_U_PAD
          and PLACEMENT_V_MIN <= b["v"] <= PLACEMENT_V_MAX]
    if not bs:
        return None

    def half(b):
        return "near" if b["v"] < NET_V else "far"

    roles = ["rally"] * len(bs)
    # Serve bounces lead the point: own-half first (serve_1), receiver-half
    # next (serve_2). If the own-half bounce wasn't detected, the first
    # bounce is the serve landing itself. Unknown server: fall back to the
    # half-alternation of the first two bounces.
    if srv_side:
        if half(bs[0]) == srv_side:
            roles[0] = "serve_1"
            if len(bs) > 1 and half(bs[1]) != srv_side:
                roles[1] = "serve_2"
        else:
            roles[0] = "serve_2"
    elif len(bs) > 1 and half(bs[0]) != half(bs[1]):
        roles[0] = "serve_1"
        roles[1] = "serve_2"
    else:
        roles[0] = "serve_2"
    # the last bounce is the point's final bounce, whatever else it was
    roles[-1] = "final"

    out = []
    rally_n = 0
    for i, (b, role) in enumerate(zip(bs, roles)):
        mark = {"seq": i + 1, "t": round(b["t"], 3),
                "u": round(b["u"], 3), "v": round(b["v"], 3),
                "role": role, "hitter_side": b["side"]}
        if role == "rally":
            rally_n += 1
            mark["rally_n"] = rally_n
        elif role == "final":
            mark["final_kind"] = _final_kind(
                (suggestion or {}).get("how"))
        out.append(mark)
    return {"v": 2, "bounces": out}


# ---------------------------------------------------------------------------
# Warmup detection — flag pre-match casual play so the UI can collapse it.
#
# A real point's serve shows the double-bounce signature: a bounce on the
# server's half followed by a bounce on the receiver's half early in the
# play. Plays BEFORE the first play with a valid serve signature are warmup
# candidates. Independently, a play that never crosses the net and only
# bounces on one side (casual table bouncing) is warmup wherever it sits.
# Points are only flagged, never dropped — the owner can flip any of them
# back with "This is a point".
# ---------------------------------------------------------------------------
SERVE_SIG_WINDOW_S = 1.5     # server-half -> receiver-half bounce gap cap
WARMUP_PREFIX_MAX = 8        # don't trust the prefix rule deeper than this


def play_warmup_features(track, srv_side):
    """Per-play features for warmup classification.

    Returns {"serve_sig": bool, "casual": bool}. Without a fitted track
    (calibration failed / too few detections) both come back False — we
    never flag what we can't see.
    """
    if not track or not track.get("bounces"):
        return {"serve_sig": False, "casual": False}
    bs = sorted(track["bounces"], key=lambda b: b["t"])
    sides = [b["side"] for b in bs]

    serve_sig = False
    if len(bs) >= 2:
        first, second = bs[0], bs[1]
        if srv_side:
            ok = first["side"] == srv_side and \
                second["side"] == _other(srv_side)
        else:                       # server unknown: any half-to-half pair
            ok = first["side"] != second["side"]
        serve_sig = ok and (second["t"] - first["t"]) <= SERVE_SIG_WINDOW_S

    hit_sides = {h["side"] for h in track.get("hits", [])}
    crossed = any(a != b for a, b in zip(sides, sides[1:]))
    casual = not crossed and len(set(sides)) == 1 and len(hit_sides) <= 1

    return {"serve_sig": serve_sig, "casual": casual}


def apply_warmup_flags(points, feats):
    """Set p['warmup'] on each point dict. Returns the warmup count.

    Prefix rule: everything before the first valid serve signature is
    warmup — but only when that first real serve appears within the first
    WARMUP_PREFIX_MAX plays (deeper than that means serve detection is
    unreliable for this video, so only the casual rule applies).
    """
    first_real = next(
        (i for i, f in enumerate(feats) if f["serve_sig"]), None)
    prefix_ok = first_real is not None and 0 < first_real <= WARMUP_PREFIX_MAX
    n = 0
    for i, (p, f) in enumerate(zip(points, feats)):
        warm = f["casual"] or (prefix_ok and i < first_real)
        p["warmup"] = warm
        if warm:
            n += 1
    return n


# ---------------------------------------------------------------------------
# Pose (subprocess under vendor/venv_pose) + side assignment in the parent
# ---------------------------------------------------------------------------
def cmd_pose(args):
    """Raw YOLO pose detections over frame windows only (no side logic)."""
    import cv2
    from ultralytics import YOLO

    windows = json.load(open(args.windows))
    wanted = set()
    for f0, f1 in windows:
        wanted.update(range(int(f0), int(f1) + 1))
    if not wanted:
        open(args.out, "w").close()
        return
    fmax = max(wanted)
    model = YOLO(args.model)
    cap = cv2.VideoCapture(args.video)
    n = 0
    with open(args.out, "w") as fh:
        f = 0
        while f <= fmax:
            ok = cap.grab()
            if not ok:
                break
            if f in wanted:
                ok, frame = cap.retrieve()
                if ok:
                    res = model(frame, device=args.device, imgsz=960,
                                verbose=False, conf=0.3)[0]
                    players = []
                    if res.boxes is not None and len(res.boxes) > 0:
                        boxes = res.boxes.xyxy.cpu().numpy()
                        confs = res.boxes.conf.cpu().numpy()
                        kpts = res.keypoints.data.cpu().numpy()
                        order = confs.argsort()[::-1][:2]
                        for i in order:
                            players.append({
                                "conf": round(float(confs[i]), 3),
                                "bbox": [round(float(q), 1)
                                         for q in boxes[i]],
                                "kpts": [[round(float(x), 1),
                                          round(float(y), 1),
                                          round(float(c), 3)]
                                         for x, y, c in kpts[i]],
                            })
                    fh.write(json.dumps({"frame": f,
                                         "players": players}) + "\n")
                    n += 1
                    if n % 200 == 0:
                        print(f"pose: {n} frames", flush=True)
            f += 1
    cap.release()
    print(f"pose: wrote {n} frames -> {args.out}")


def assign_sides(pose, H):
    """Tag each pose player near/far. With calibration: project the bbox
    foot point through the table homography and order by v (smaller = near).
    Without: the nearer player appears larger (bbox height depth cue)."""
    for f, players in pose.items():
        if not players:
            continue
        if H is not None:
            keyed = []
            for pl in players:
                x0, y0, x1, y1 = pl["bbox"]
                _, v = _project(H, (x0 + x1) / 2.0, y1)
                keyed.append((v, pl))
            keyed.sort(key=lambda kv: kv[0])
            if len(keyed) >= 2:
                keyed[0][1]["side"] = "near"
                keyed[1][1]["side"] = "far"
            else:
                keyed[0][1]["side"] = "near" if keyed[0][0] < NET_V \
                    else "far"
        else:
            byh = sorted(players,
                         key=lambda pl: pl["bbox"][3] - pl["bbox"][1],
                         reverse=True)
            if len(byh) >= 2:
                byh[0]["side"] = "near"
                byh[1]["side"] = "far"
    if H is None:
        # single-detection frames: nearest two-player median height wins
        import numpy as np
        hs = {"near": [], "far": []}
        for players in pose.values():
            for pl in players:
                if "side" in pl:
                    hs[pl["side"]].append(pl["bbox"][3] - pl["bbox"][1])
        med = {s: (float(np.median(v)) if v else None)
               for s, v in hs.items()}
        for players in pose.values():
            if len(players) == 1 and "side" not in players[0]:
                h = players[0]["bbox"][3] - players[0]["bbox"][1]
                if med["near"] and med["far"]:
                    players[0]["side"] = "near" if \
                        abs(h - med["near"]) <= abs(h - med["far"]) \
                        else "far"


# ---------------------------------------------------------------------------
# points subcommand
# ---------------------------------------------------------------------------
def cmd_points(args):
    meta = probe(args.video)
    fps, dur = meta["fps"], meta["duration"]
    px = Px(meta["width"])
    pre, post, merge = STRICTNESS[args.strictness]
    det = load_detections(args.blurball)
    os.makedirs(args.outdir, exist_ok=True)
    clips_dir = os.path.join(args.outdir, "points")
    os.makedirs(clips_dir, exist_ok=True)

    notes = []

    # 1. activity spans on the original video
    spans = activity_spans(det, dur, fps, pre, post, merge, px)
    print(f"{len(spans)} activity spans")
    if not spans:
        raise SystemExit("no activity spans — nothing to break into points")

    # 2. auto table calibration
    calib = None
    try:
        calib = calibrate(args.video, args.outdir, det, px)
    except Exception as e:
        print(f"calibration crashed: {e}")
    if calib is None:
        notes.append("table calibration failed: placement and winner/how "
                     "suggestions skipped; server detection uses the "
                     "bbox-size depth cue")
        print("calibration FAILED — degrading gracefully")
    else:
        print(f"calibration ok: {calib['corners_px']}  e={calib['e']}")
    H = calib["H"] if calib else None
    e = calib["e"] if calib else None
    roi = calib["roi"] if calib else None

    # 3. split spans into plays -> point windows (frames in the raw video)
    plays = []
    for t0, t1 in spans:
        f0, f1 = int(t0 * fps), int(t1 * fps)
        for a, b in split_plays(det, f0, f1, fps, px, roi=roi, e=e):
            plays.append((a, b))
    print(f"{len(plays)} points after play splitting")

    # 3b. drop micro-plays: shorter than MICRO_PLAY_S with fewer than
    # MICRO_PLAY_MIN_HITS detected hits (the 0.5s ghost point case).
    # Needs calibration for hit detection; without it we keep everything.
    dropped_micro = 0
    if H is not None:
        kept = []
        for a, b in plays:
            if (b - a) / fps < MICRO_PLAY_S:
                tr = fit_play(det, H, e, a, b, fps, px)
                n_hits = len(tr["hits"]) if tr else 0
                if n_hits < MICRO_PLAY_MIN_HITS:
                    dropped_micro += 1
                    print(f"dropping micro-play {a / fps:.1f}-{b / fps:.1f}s "
                          f"({n_hits} hit(s))")
                    continue
            kept.append((a, b))
        plays = kept
    if dropped_micro:
        notes.append(f"dropped {dropped_micro} micro-play(s) shorter than "
                     f"{MICRO_PLAY_S}s with <{MICRO_PLAY_MIN_HITS} hits")
        print(f"{len(plays)} points after micro-play filter "
              f"({dropped_micro} dropped)")

    # 4. pose over point windows only (subprocess into venv_pose)
    pose = {}
    if not args.skip_pose:
        pad = int(round(0.5 * fps))
        windows = [[max(0, a - pad), min(int(dur * fps), b + pad)]
                   for a, b in plays]
        wpath = os.path.join(args.outdir, "pose_windows.json")
        json.dump(windows, open(wpath, "w"))
        ppath = os.path.join(args.outdir, "pose.jsonl")
        try:
            subprocess.run(
                [args.pose_python, os.path.abspath(__file__), "pose",
                 "--video", args.video, "--windows", wpath,
                 "--out", ppath, "--model", args.pose_model,
                 "--device", args.pose_device],
                check=True, timeout=4 * 3600)
            with open(ppath) as fh:
                for line in fh:
                    r = json.loads(line)
                    pose[r["frame"]] = r["players"]
            assign_sides(pose, H)
        except Exception as exc:
            pose = {}
            notes.append(f"pose step failed ({exc}); servers not detected")
            print(f"pose step failed: {exc}")

    # 5. per point: server, fit, suggestion, placement, clip
    side_name = {"near": "user", "far": "opponent"}   # assumption: the
    # uploader is the player nearer the camera (player ID is a later phase)
    points = []
    warmup_feats = []
    for idx, (a, b) in enumerate(plays, start=1):
        t0, t1 = a / fps, b / fps
        srv_side = detect_server(det, pose, a, b) if pose else None

        track = fit_play(det, H, e, a, b, fps, px) if H is not None else None
        suggestion = None
        placement = None
        if track and track["segments"] and srv_side:
            try:
                cls = classify_play(det, pose, H, e, track, srv_side,
                                    fps, px)
                if cls["winner_side"]:
                    suggestion = {
                        "winner": side_name[cls["winner_side"]],
                        "how": cls["how"],
                        "n_hits": cls["n_hits"],
                        "reason": cls["reason"],
                    }
            except Exception as exc:
                print(f"point {idx}: classify failed: {exc}")
        if args.placement and track:
            placement = build_placement(track, srv_side, suggestion)
        warmup_feats.append(play_warmup_features(track, srv_side))

        # clip with context padding (strictness paddings, clamped)
        c0 = max(0.0, t0 - pre)
        c1 = min(dur, t1 + post)
        clip_name = f"{idx:02d}.mp4"
        clip_path = os.path.join(clips_dir, clip_name)
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{c0:.2f}",
             "-i", args.video, "-t", f"{c1 - c0:.2f}",
             "-vf", "scale=720:-2",
             "-c:v", "libx264", "-preset", "medium", "-crf", "23",
             "-c:a", "aac", "-b:a", "96k",
             "-movflags", "+faststart", clip_path], check=True)

        points.append({
            "idx": idx,
            "t0": round(t0, 2), "t1": round(t1, 2),
            "clip_t0": round(c0, 2), "clip_t1": round(c1, 2),
            "clip": f"points/{clip_name}",
            "server_side": srv_side,
            "server": side_name.get(srv_side),
            "suggestion": suggestion,
            "placement": placement,
        })
        print(f"point {idx:02d}: {t0:6.1f}-{t1:6.1f}s "
              f"server={side_name.get(srv_side)} "
              f"suggest={suggestion['winner'] + '/' + suggestion['how'] if suggestion else None}")

    # warmup flags: kept, never dropped — the UI collapses them
    n_warmup = apply_warmup_flags(points, warmup_feats)
    if n_warmup:
        notes.append(f"flagged {n_warmup} warmup play(s) — pre-match "
                     "casual play, collapsed in the timeline")
        print(f"{n_warmup} play(s) flagged as warmup")

    match_json = {
        "version": 2,          # v2: role-tagged placement ({"v":2,...})
        "source": {"duration": round(dur, 2), "fps": round(fps, 3),
                   "width": meta["width"], "height": meta["height"]},
        "options": {"strictness": args.strictness,
                    "placement": bool(args.placement)},
        "side_mapping": {"user": "near", "opponent": "far",
                         "assumed": True},
        "calibration": ({"ok": True,
                         "table_corners_px": calib["corners_px"],
                         "length_axis": calib["e"],
                         "note": calib["note"]}
                        if calib else {"ok": False}),
        "dropped_micro_points": dropped_micro,
        "warmup_points": n_warmup,
        "notes": notes,
        "points": points,
    }
    with open(os.path.join(args.outdir, "match.json"), "w") as fh:
        json.dump(match_json, fh, indent=1)
    print(f"wrote {len(points)} points -> {args.outdir}/match.json")


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("cut")
    c.add_argument("--blurball", required=True)
    c.add_argument("--video", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--strictness", default="normal",
                   choices=list(STRICTNESS))
    c.set_defaults(fn=cmd_cut)

    p = sub.add_parser("points")
    p.add_argument("--blurball", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--strictness", default="normal",
                   choices=list(STRICTNESS))
    p.add_argument("--placement", action="store_true")
    p.add_argument("--skip-pose", action="store_true")
    p.add_argument("--pose-python", default=VENV_POSE_PY)
    p.add_argument("--pose-model", default=POSE_MODEL)
    p.add_argument("--pose-device", default="mps")
    p.set_defaults(fn=cmd_points)

    o = sub.add_parser("pose")
    o.add_argument("--video", required=True)
    o.add_argument("--windows", required=True)
    o.add_argument("--out", required=True)
    o.add_argument("--model", default=POSE_MODEL)
    o.add_argument("--device", default="mps")
    o.set_defaults(fn=cmd_pose)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
