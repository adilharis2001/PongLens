"""Card assembly for matches where the serve detector has nothing to say.

points_v2 anchors every card on a detected serve. That is the right
design when the camera can see one: on the side-on corpus it reaches 95%
clean against hand-marked boundaries. It collapses when the camera sits
behind the players and the ball travels along the lens axis instead of
across it, because a serve's two bounces stop being separable. The serve
rate splits matches into two groups with a gap between them — at the time
of writing 1.32 per minute at the top of the low group and 2.90 at the
bottom of the high one — and the low group is where the product currently
produces four cards for a seven-minute video.

Do not read that gap as a law. It was 1.07 to 5.17 across the first
twenty matches and narrowed as soon as two more users' uploads were
measured. It will keep narrowing, and the day a match lands inside it,
the router needs better evidence than a threshold in a hole.

This module is the other assembler for that group. It never looks for a
serve. Instead it scores every tick of the match as play-like or
dead-like and finds the single alternating segmentation of the whole
match that best explains it. A boundary is accepted not because it looks
convincing on its own, but because the segmentation containing it beats
every segmentation without it.

That reframing is the whole idea, and it came from measuring the
alternative. The oracle study (lab s61) showed the boundary information
is present in the signals — the ceiling with a perfect chooser is 90% —
while every greedy assembly stalled near 54%. The bottleneck was never
detection, it was SELECTION: asking "is this gap a boundary?" one gap at
a time has no good answer when nine candidates in ten are noise. A match
alternates point, dead, point, dead from beginning to end, and that
constraint is only usable globally.

Measured on 199 hand-marked points across three end-on matches, held out
one match at a time:

                     clean   clipped  fused  split  lost
  shipped v2          44%       70      26     21     21
  this module         74%        9      11     32      0

Zero lost is the number that matters most: v2 dropped 13 rallies on Terry
alone, and a rally the app never shows is the one defect that cannot be
recovered by scoring. The remaining weakness is splits — one rally
arriving as two cards — which is a known, accepted cost of this version.

NOT a replacement for points_v2. On the side-on corpus this scores 76%
against v2's 95%, because ignoring a working serve detector throws away
the best signal available. The router below is what keeps each match on
the assembler that suits it.

Tuning came from a leave-one-match-out sweep; all three folds chose the
same parameters independently, which is reassuring but not the same as
transfer evidence. Three matches, one venue. Treat CONFIG as measured on
Westchester and unproven elsewhere.
"""
import subprocess

import cv2
import numpy as np

import points_v2 as V2

TICK = V2.TICK

# ---------------------------------------------------------------------------
# router
# ---------------------------------------------------------------------------
# Serves per minute below which the serve-anchored assembler has nothing
# to anchor on. Sited at the middle of the observed gap: the highest rate
# among matches that clearly need the fallback is 1.32 (Tripp), the
# lowest among matches whose serve-anchored cards come out healthy is
# 2.90 (a Guillaume match at camera 0.57), so 2.1 sits about 0.8 clear
# either way.
#
# It was 2.5 when the only evidence was a gap running 1.07 to 5.17.
# Validating two users' uploads put a real match at 2.90 and left the
# old threshold with 0.40 of headroom above and 1.18 below, which is a
# lopsided place to stand. The gap is narrower than it first looked and
# will keep narrowing; the route and the rate are recorded on every match
# so the next revision argues from more than a dozen numbers.
#
# Deliberately NOT foreshortening. Camera angle looks like the obvious
# criterion and it is the worse one: it overlaps across the decision
# (0.49 with no serves at all, 0.46 with 5.17), it is absent on the ~20%
# of matches that never calibrate, and a quad recovered one position
# round reads as a superb camera angle. Serve rate measures the thing we
# actually care about — whether cards can be anchored — rather than a
# proxy for it.
SERVE_RATE_MIN = 2.1


def serve_rate(E):
    """Accepted serve contacts per minute of video."""
    minutes = max(E.duration / 60.0, 1e-6)
    return len(E.serves) / minutes


def wants_endon(E):
    """True when the serve-anchored assembler has too little to work with."""
    return serve_rate(E) < SERVE_RATE_MIN


# ---------------------------------------------------------------------------
# prism geometry (lab s47, s49)
# ---------------------------------------------------------------------------
PRISM_H_M = 1.6        # how high above the table a ball may plausibly be
RETURN_GAP_S = 1.8     # out or unseen this long means it is not coming back


def prism_polygon(corners_px):
    """Image-space hull of the table quad lifted by PRISM_H_M.

    A rally lives inside the volume above the table. Lifting the quad by
    a fixed height in metres — converted to pixels separately at each end,
    since the far end is smaller — gives a region the ball leaves exactly
    once per point, when it is finally missed.
    """
    px = corners_px
    near = sorted((p for n, p in px.items() if "near" in n), key=lambda p: p[0])
    far = sorted((p for n, p in px.items() if "far" in n), key=lambda p: p[0])
    A, B = near        # near-left, near-right
    D, C = far         # far-left, far-right, sorted by x
    ppm_near = float(np.hypot(B[0] - A[0], B[1] - A[1])) / V2.W_M
    ppm_far = float(np.hypot(C[0] - D[0], C[1] - D[1])) / V2.W_M
    lift = {id(A): ppm_near, id(B): ppm_near, id(C): ppm_far, id(D): ppm_far}
    pts = []
    for P in (A, B, C, D):
        pts.append([P[0], P[1]])
        pts.append([P[0], P[1] - lift[id(P)] * PRISM_H_M])
    return cv2.convexHull(np.asarray(pts, np.float32))


def in_prism(hull, x, y):
    return cv2.pointPolygonTest(hull, (float(x), float(y)), False) >= 0


def final_exits(track, fps, hull):
    """Moments the ball leaves the prism and does not come back."""
    fr = sorted(track)
    states = [(f / fps, in_prism(hull, *track[f])) for f in fr]
    exits = []
    for i in range(1, len(states)):
        t_prev, in_prev = states[i - 1]
        t_cur, in_cur = states[i]
        if not in_prev:
            continue
        # left by crossing out, or by vanishing for the whole gap
        if not ((not in_cur) or (t_cur - t_prev >= RETURN_GAP_S)):
            continue
        back = False
        for t2, in2 in states[i:]:
            if t2 - t_prev > RETURN_GAP_S:
                break
            if in2:
                back = True
                break
        if not back:
            exits.append(t_prev)
    return np.asarray(exits, float)


# ---------------------------------------------------------------------------
# player motion (lab s5, s50)
# ---------------------------------------------------------------------------
# The only signal here that does not depend on seeing the ball, which is
# what makes it worth an extra decode: it is the one input that still
# works in the stretches where the tracker is blind, and on this class of
# match that is 49-68% of the ball-dense time.
SCALE_W, SCALE_H = 320, 180

# Player zones in table metres. v runs along the table (0 = near edge),
# u across it. The zones start just off each end so a ball resting on the
# table is not motion, and reach ~2.2m back — enough for a defender,
# short of the next court.
ZONE_V = {"near": (-2.2, -0.15), "far": (V2.L_M + 0.15, V2.L_M + 2.2)}
ZONE_U = (-1.0, V2.W_M + 1.0)

# Two smoothings, in this order, because the tuning was done through both
# and the valley positions depend on them. The first stands in for the
# capture pass the lab ran separately; the second is the signal-shaping
# one. Collapsing them into a single wider window is NOT equivalent.
SMOOTH_CAPTURE_S = 0.5
SMOOTH_SIGNAL_S = 0.4


def zone_masks(H, w, h):
    """Boolean masks at decode resolution for the two player end zones."""
    sx, sy = w / float(SCALE_W), h / float(SCALE_H)
    xs = (np.arange(SCALE_W) + 0.5) * sx
    ys = (np.arange(SCALE_H) + 0.5) * sy
    gx, gy = np.meshgrid(xs, ys)
    den = H[2, 0] * gx + H[2, 1] * gy + H[2, 2]
    den = np.where(np.abs(den) < 1e-9, np.nan, den)
    u = (H[0, 0] * gx + H[0, 1] * gy + H[0, 2]) / den
    v = (H[1, 0] * gx + H[1, 1] * gy + H[1, 2]) / den
    lateral = (u >= ZONE_U[0]) & (u <= ZONE_U[1])
    out = {}
    for name, (v0, v1) in ZONE_V.items():
        out[name] = np.nan_to_num(lateral & (v >= v0) & (v <= v1)).astype(bool)
    return out


def zone_masks_from_gate(gate, w, h):
    """Zones without a table, from the bounce-cloud gate.

    Calibration fails on roughly a match in four, and that is exactly when
    the crossing rescue and the crossing sweep are also gone. The bottom
    tier cannot vanish at the same moment as everything above it, so the
    dense cluster of bounce candidates stands in for the table and the
    player bands sit beyond its near and far edges in image space.
    """
    x0, x1, _y0, _y1 = gate["bbox"]
    _cx0, _cx1, cy0, cy1 = gate["core"]
    ch = max(cy1 - cy0, 1.0)
    sx, sy = w / float(SCALE_W), h / float(SCALE_H)
    xs = (np.arange(SCALE_W) + 0.5) * sx
    ys = (np.arange(SCALE_H) + 0.5) * sy
    gx, gy = np.meshgrid(xs, ys)
    lateral = (gx >= x0) & (gx <= x1)
    return {
        # nearer the camera is lower in frame; the far player is above the
        # table and smaller, so its band scales to the core's height
        "near": lateral & (gy > cy1) & (gy <= cy1 + 1.6 * ch),
        "far": lateral & (gy < cy0) & (gy >= cy0 - 1.0 * ch),
    }


def _zone_energy(video, masks):
    """Mean absolute frame difference inside each mask, per frame."""
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", video,
         "-vf", f"scale={SCALE_W}:{SCALE_H},format=gray",
         "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    size = SCALE_W * SCALE_H
    names = list(masks)
    counts = {n: max(int(masks[n].sum()), 1) for n in names}
    series = {n: [] for n in names}
    prev = None
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            cur = np.frombuffer(buf, np.uint8).reshape(SCALE_H, SCALE_W)
            if prev is not None:
                d = np.abs(cur.astype(np.int16) - prev)
                for n in names:
                    series[n].append(float(d[masks[n]].sum()) / counts[n])
            else:
                for n in names:
                    series[n].append(0.0)
            prev = cur.astype(np.int16)
    finally:
        proc.stdout.close()
        proc.wait()
    return series


def _smooth(a, win):
    if win <= 1:
        return np.asarray(a, float)
    return np.convolve(np.asarray(a, float), np.ones(win) / win, mode="same")


def z_motion(video, corners_px, gate, width, height, fps):
    """Per-frame end-zone motion, log-scaled and z-scored within the match.

    Z-scoring per match is deliberate and load-bearing. The 2026-08-11
    dead-space study measured motion features with absolute thresholds and
    cross-scene transfer failed outright. Every number here is relative to
    the match's own distribution, so nothing crosses a venue boundary.
    """
    H = None
    if corners_px:
        try:
            H = V2.homography_from_corners(corners_px)
        except Exception:                                   # noqa: BLE001
            H = None
    if H is not None:
        masks = zone_masks(H, width, height)
    elif gate and gate.get("bbox") and gate.get("core"):
        masks = zone_masks_from_gate(gate, width, height)
    else:
        return None, fps
    if not any(m.sum() for m in masks.values()):
        return None, fps

    series = _zone_energy(video, masks)
    if not series.get("near"):
        return None, fps

    win = max(1, int(round(SMOOTH_CAPTURE_S * fps)))
    # rounded to 4dp because the lab's capture wrote JSON at that precision
    # and the tuning ran on the rounded values
    near = np.round(_smooth(series["near"], win), 4)
    far = np.round(_smooth(series["far"], win), 4)

    m = np.log1p(near + far)
    k = max(3, int(SMOOTH_SIGNAL_S * fps))
    m = _smooth(m, k)
    return (m - m.mean()) / max(m.std(), 1e-9), fps


# ---------------------------------------------------------------------------
# global segmentation (lab s62)
# ---------------------------------------------------------------------------
# Chosen identically by all three leave-one-match-out folds.
#   theta   the play/dead decision level
#   lam     the price of admitting a boundary (zero: the duration bounds
#           below already stop the segmentation running away)
#   lead    how far before the first evidence a card opens, so the serve
#           is inside it
CONFIG = dict(w_dense=1.0, w_cross=1.2, w_bounce=0.5, w_motion=0.4,
              theta=1.0, lam=0.0, cand_pct=65.0, lead=2.2, pad=1.4)

# Duration bounds, in seconds. MIN_DEAD is the one aimed at splits: real
# dead time between points is never under about a second, because someone
# has to retrieve the ball and reset, so a shorter "gap" is the tracker
# losing sight of a live rally.
MIN_PT, MAX_PT = 2.5, 45.0
MIN_DEAD, MAX_DEAD = 0.8, 150.0


def play_evidence(E, z, zfps, P):
    """Per-tick play score, all four signals on one clock."""
    n = E.n
    ev = np.zeros(n)
    ev += P["w_dense"] * E.ball_dense.astype(float)
    for t in E.cross:
        i0, i1 = max(0, int((t - 0.4) / TICK)), min(n, int((t + 0.4) / TICK))
        ev[i0:i1] += P["w_cross"]
    for t in E.bt_table:
        i0, i1 = max(0, int((t - 0.3) / TICK)), min(n, int((t + 0.3) / TICK))
        ev[i0:i1] += P["w_bounce"]
    if z is not None and len(z):
        idx = np.clip((np.arange(n) * TICK * zfps).astype(int), 0, len(z) - 1)
        ev += P["w_motion"] / (1.0 + np.exp(-z[idx]))
    return ev


def valleys(z, zfps, pct):
    """Local minima of end-zone motion below the match's own percentile."""
    if z is None or len(z) < 3:
        return np.zeros(0)
    lo = np.percentile(z, pct)
    idx = np.where((z[1:-1] < lo) & (z[1:-1] <= z[:-2])
                   & (z[1:-1] <= z[2:]))[0] + 1
    return idx / zfps


def boundaries(E, z, zfps, exits, P):
    """Candidate boundary ticks: freeze valleys, prism exits, chain gaps."""
    cand = [valleys(z, zfps, P["cand_pct"]), np.asarray(exits, float)]
    cr = np.asarray(E.cross, float)
    if len(cr):
        cand.append(np.asarray(
            [(cr[i] + cr[i + 1]) / 2 for i in range(len(cr) - 1)
             if cr[i + 1] - cr[i] > 2.0], float))
    usable = [c for c in cand if len(c)]
    b = np.unique(np.concatenate(usable)) if usable else np.zeros(0)
    b = np.concatenate([[0.0], b, [E.duration]])
    ticks = np.unique((b / TICK).astype(int))
    return ticks[(ticks >= 0) & (ticks < E.n)]


def segment(E, z, zfps, exits, P):
    """Viterbi over candidate boundaries, strictly alternating.

    f[j][0] is the best total for a segmentation whose segment ending at
    B[j] is DEAD; f[j][1] the same for POINT. Because the two states can
    only be reached from each other, the alternation is structural rather
    than a penalty that could be outweighed.
    """
    ev = play_evidence(E, z, zfps, P)
    s = np.concatenate([[0.0], np.cumsum(ev - P["theta"])])
    B = boundaries(E, z, zfps, exits, P)
    m = len(B)
    if m < 2:
        return []
    NEG = -1e18
    f = np.full((m, 2), NEG)
    bk = np.full((m, 2), -1, int)
    f[0] = 0.0
    for j in range(1, m):
        for state in (0, 1):
            lo = MIN_DEAD if state == 0 else MIN_PT
            hi = MAX_DEAD if state == 0 else MAX_PT
            best, arg = NEG, -1
            for i in range(j - 1, -1, -1):
                dur = (B[j] - B[i]) * TICK
                if dur < lo:
                    continue
                if dur > hi:
                    break
                prev = f[i][1 - state]
                if prev <= NEG / 2:
                    continue
                gain = s[B[j]] - s[B[i]]
                val = prev + (gain if state == 1 else -gain) - P["lam"]
                if val > best:
                    best, arg = val, i
            f[j][state], bk[j][state] = best, arg
    j = m - 1
    state = int(np.argmax(f[j]))
    if f[j][state] <= NEG / 2:
        return []
    segs = []
    while j > 0 and bk[j][state] >= 0:
        i = bk[j][state]
        if state == 1:
            segs.append((B[i] * TICK, B[j] * TICK))
        j, state = i, 1 - state
    return segs[::-1]


def build_cards(E, z, zfps, exits, P=None):
    """Cards in SOURCE seconds, sorted and disjoint.

    serve_s is always None: this assembler never claims to have found a
    serve, and downstream code that wants one must treat its absence as
    the normal case rather than a failure.
    """
    P = dict(CONFIG, **(P or {}))
    out = []
    for a, b in segment(E, z, zfps, exits, P):
        out.append({"t0": max(0.0, a - P["lead"]),
                    "t1": min(E.duration, b + P["pad"]),
                    "serve_s": None, "why": "endon"})
    return V2.resolve(out)
