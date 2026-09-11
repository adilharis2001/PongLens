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
the router needs better evidence than a threshold in a hole. (Since
2026-09-06 the router no longer reads minutes at all: it counts serves
per candidate point and vetoes a table the ball does not bounce on. See
SERVE_YIELD_MIN and TABLE_SHARE_MIN below.)

This module is the other assembler for that group. It does not anchor
on a serve. Instead it scores every tick of the match as play-like or
dead-like and finds the single alternating segmentation of the whole
match that best explains it. (Since 2026-09-06 the serves the detector
DID find are offered to that segmentation as candidates and stamped onto
the cards that hold them — see SERVE_LEAD_S below. That borrows what
there is; it does not make this a serve-anchored assembler.) A boundary is accepted not because it looks
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
# Serves per CANDIDATE POINT below which the serve-anchored assembler has
# nothing to anchor on. The candidate points are its own cards, which it
# has already built by the time the router runs, so the question is the one
# that was always meant: on what share of the points it found did the serve
# detector actually see a serve?
#
# Until 2026-09-06 this was serves per minute of VIDEO (SERVE_RATE_MIN,
# 2.5 then 2.1). That conflated the detector with the clock: on the
# seventeen lab matches dead time is 30 to 63% of the video even after the
# dead-space cut, so a long break between games could push a good camera
# under the line. Serves per ACTIVE minute is not the fix either: Tripp
# reads 2.22 per active minute and would go serve-anchored, where he
# scores 46% instead of 75%. Serves per card has no minutes in it at all.
#
# 0.42 sits in the gap between tripp_rc (0.34, the highest end-on yield)
# and gavin_16 (0.50, the lowest side-on); on the stored corpus the nearest
# values are 0.39 and 0.47. It reproduces the route of every one of the 62
# matches the per-minute rule handled. The yield and the table share are
# written into every match's note so the next revision argues from the
# whole corpus rather than seventeen numbers.
#
# Deliberately NOT foreshortening, still. Camera angle looks like the
# obvious criterion and it is the worse one: it is absent on the matches
# that never calibrate, and on a net-post diamond (the PingPod W37 booth,
# Tim's match, gavin_16) it measures the calibration error, not the camera.
SERVE_YIELD_MIN = 0.42

# The veto. Share of moving-ball bounces the homography puts on the playing
# surface: 60 to 85% on every real quad in the lab, 42 to 53% on a net-post
# diamond, because half the surface projects off the table. Under this the
# geometry the serve-anchored assembler is about to trust is not the table
# (its "same side of the net" test becomes a diagonal), and the end-on
# assembler, which leans on it less, measures 64% against 49% on that
# booth. 0.57 sits between anton_first (53%) and terry (60%), the worst
# real camera. Seventeen matches; see the note above about writing it down.
TABLE_SHARE_MIN = 0.57


def serve_rate(E):
    """Accepted serve contacts per minute of video. Still written into the
    note on every match so the record stays comparable with the matches
    routed before 2026-09-06; it no longer decides anything."""
    minutes = max(E.duration / 60.0, 1e-6)
    return len(E.serves) / minutes


def serve_yield(E, cards):
    """Accepted serve contacts per candidate point."""
    return len(E.serves) / max(len(cards), 1)


def table_share(E):
    """Share of moving-ball bounces that land on the playing surface, or
    None when there were no moving-ball bounces to judge by."""
    bt = getattr(E, "bt", None)
    n = len(bt) if bt is not None else 0
    if n == 0:
        return None
    return len(E.bt_table) / n


def wants_endon(E, cards):
    """True when the serve-anchored assembler has too little to work with,
    or when the table it would work with is not where the ball bounces."""
    if serve_yield(E, cards) < SERVE_YIELD_MIN:
        return True
    share = table_share(E)
    return share is not None and share < TABLE_SHARE_MIN


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


# ---------------------------------------------------------------------------
# ball-detection crop (2026-09-01)
# ---------------------------------------------------------------------------
# The detector resizes every frame to 512x288 before it looks at it. At
# Westchester that leaves the ball about two pixels across, which is most of
# why it is found in half the frames and scored 9 out of 100 when it is.
# Cropping to the table before that shrink hands the same model a bigger
# ball, and drops the neighbouring courts on the way.
#
# Margins are generous because a ball that leaves the box is invisible: 35%
# of the prism's width to each side, 60% of its height above.
#
# Below the table is different, and gets a tenth of that. What is down there
# is floor: a retrieval bounce, someone's shoes. The rally happens ABOVE the
# surface, which is the whole reason the prism is a lifted quad and not a
# rectangle. Terry is why this is a separate number — anchoring the trim to
# the padded bottom kept 273px of his floor and 26px of his air, and his
# serves fell from 13 to 4.
CROP_PAD_X = 0.35
CROP_PAD_Y = 0.60
CROP_PAD_BELOW = 0.15
CROP_SIDE_M = 1.3

# ...BUT THE METRE IS CONVERTED AT THE NEAR END LINE, WHICH IS THE CLOSEST
# THING IN THE PICTURE. On a camera behind the players that line is huge in
# pixels, so CROP_SIDE_M stops being a modest margin and becomes the box.
# Terry's near line runs 259 px/m, so 1.3 m is 337 px of side room on each
# side of a prism only 451 px wide, and the box lands at twelve times the
# area of his table with the neighbouring court inside it.
#
# So the metre rule is kept and bounded: never more than this fraction of
# the prism's own width. 0.60 is where the bound bites ONLY on the tables
# that need it. Measured 2026-09-10 across the thirteen frozen quads, side
# room in metres: at 0.45 it would drop Wayne to 1.05 and Rowel to 1.11,
# both of which crop correctly today, and the corpus above says every match
# that ever cut a serve sideways had under 1.10 m. At 0.60 all eleven
# side-on tables keep 1.30 m to the pixel and only Terry (1.04) and Koko
# (1.17) move — the two that today get no crop at all, so their comparison
# is against the full frame, not against 1.30 m.
CROP_SIDE_MAX_W = 0.60

# Below this camera shape (points_v2.foreshortening of the quad: 1.0 is
# square-on, Tripp is 0.28) the crop is skipped and the detector sees the
# whole frame.
#
# WAS 0.40, LOWERED 2026-09-10. The 0.40 line was measured on 2026-09-06
# against the ball pipeline, to protect three rallies whose ball left the
# box sideways. The body pipeline shipped on 09-08 and the serve/rally edge
# rules on 09-09, so that trade was priced against a system that no longer
# exists. Scored against Adil's own scorekeeper taps on 09-10 (a rally is
# clean only when one card holds half of it and holds no other rally), what
# the line now costs is Terry 22 of 46 rallies and Koko 18 of 44 — the only
# two matches in the set that fall under it, and the only two whose activity
# gate lands off their own table (0% and 11% overlap; every other match is
# 100%). Rowel sits just above the old line at 0.46, keeps its crop, and
# loses nothing at all: 72 of 84 clean, zero lost. There is no evidence in
# that set of the crop hurting anywhere near the line, and forty lost
# rallies of evidence against the line itself. 0.20 keeps a floor for a quad
# so degenerate that its scale cannot be trusted, and admits everything real.
CROP_MIN_SHAPE = 0.20


def crop_allowed(corners_px):
    """(allowed, shape). A table that reads end-on is detected on the full
    frame; a quad whose shape cannot be measured is left to ball_crop_box,
    which refuses on its own terms."""
    shape = V2.foreshortening(corners_px) if corners_px else None
    if shape is None:
        return True, None
    return shape >= CROP_MIN_SHAPE, shape


def ball_crop_box(corners_px, width=1920, height=1080):
    """(x, y, w, h) around the table for ball detection, or None.

    Three rules learned from real matches, each the wrong way round first:

    THE SIDE ROOM IS MEASURED IN METRES, NOT FRACTIONS. A fraction of the
    hull's pixel width gives a side-on camera a fraction of the table's
    2.74 m length but an end-on camera a fraction of its 1.525 m width --
    Terry's servers got 0.61 m of side room against Kyle's 1.75 m, and of
    the 18 serves the first crop genuinely cut on the labelled 12-match
    corpus (2026-09-01), 13 left through the sides, 82% of them real.
    Every match with a sideways cut had under 1.1 m; every match with
    none had 1.3 m or more. So the pad is floored at CROP_SIDE_M,
    converted at the near end line's own scale -- and bounded above at
    CROP_SIDE_MAX_W of the hull, because that same near line is the closest
    thing in the picture and on an end-on camera it turns the margin into
    the box. See the constant for what the bound costs and where.

    NEVER COMPENSATE ACROSS THE FRAME. Holding 16:9 by widening the short
    axis reaches further into the room, and the room is where the other
    tables are. Jose's table sits against the left edge, so widening pulled
    a neighbouring court into the very crop meant to exclude one, and his
    gain was the smallest of four (+8% against +61% and +226%). When the
    box is too tall, the aspect is held by SHRINKING the height; when it
    is too wide, by GROWING the height -- vertical growth reaches floor
    and air at this table, never the court alongside.

    WHICH ALSO SAVES THE END-ON CASE. On a camera behind the players the
    table is squashed flat, so 1.6 m of air above it dominates the prism
    and compensating horizontally blew Terry's box out to 1776x1000 -- no
    crop at all.

    Even dimensions throughout: libx264 refuses odd ones.
    """
    hull = prism_polygon(corners_px)
    if hull is None or len(hull) < 3:
        return None
    pts = np.asarray(hull, float).reshape(-1, 2)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    if x1 <= x0 or y1 <= y0:
        return None
    near = sorted((p for n, p in corners_px.items() if "near" in n),
                  key=lambda p: p[0])
    A, B = near
    ppm = float(np.hypot(B[0] - A[0], B[1] - A[1])) / V2.W_M
    px = max((x1 - x0) * CROP_PAD_X,
             min(CROP_SIDE_M * ppm, (x1 - x0) * CROP_SIDE_MAX_W))
    py = (y1 - y0) * CROP_PAD_Y
    below = (y1 - y0) * CROP_PAD_BELOW
    cx0, cy0 = max(0.0, x0 - px), max(0.0, y0 - py)
    cx1, cy1 = min(float(width), x1 + px), min(float(height), y1 + below)
    w, h = cx1 - cx0, cy1 - cy0
    if w <= 0 or h <= 0:
        return None
    target = width / height
    if w / h < target:                      # too tall: the surplus is air
        # ANCHOR THE BOTTOM. A prism is a table plus 1.6 m of air above it,
        # so its vertical midpoint sits well over the surface, and trimming
        # symmetrically about it takes the table's own near edge off —
        # Terry's box came out 296-732 against a table reaching 741. The
        # air is what we can afford to lose; the surface is not.
        h2 = w / target
        cy1 = min(float(height), y1 + below)
        cy0 = max(0.0, cy1 - h2)
        cy1 = min(float(height), cy0 + h2)
    else:                                   # too wide: grow the height
        # The sides are where the servers stand and are never traded
        # away. Growing vertically reaches floor and air at this table,
        # never the court alongside; w <= frame width, so the 16:9
        # height always fits the frame. Bottom stays anchored just under
        # the near edge and the surplus goes to the air above, where the
        # serve toss and the rally live.
        h2 = w / target
        cy1 = min(float(height), y1 + below)
        cy0 = cy1 - h2
        if cy0 < 0.0:
            cy0 = 0.0
            cy1 = min(float(height), h2)
    bx, by = int(cx0) // 2 * 2, int(cy0) // 2 * 2
    bw, bh = int(cx1 - bx) // 2 * 2, int(cy1 - by) // 2 * 2
    if bw >= 0.92 * width and bh >= 0.92 * height:
        # a near-camera table plus real side room is most of the frame;
        # an encode that enlarges the ball by 8% is not worth running
        return None
    if bw < 64 or bh < 64:
        return None
    # A crop that is the whole frame buys nothing and costs an encode.
    if bw >= width and bh >= height:
        return None
    return (bx, by, bw, bh)


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


# Borrowed serves (2026-09-06). The serve detector is not blind on every
# match that lands here: on a serve-blind SIDE view (a PingPod booth whose
# calibration is a net-post diamond) it still accepts a serve on a third of
# the points, and even on the Westchester bench it finds 5, 4 and 31. Those
# contacts are offered to the segmentation as candidates, and the card that
# ends up holding one is stamped with it so placement and the serve
# statistics get what there is. Measured leave-one-match-out on koko, terry
# and tripp_rc (lab s71, s73, s79; docs/research/2026-09-06-endon-routing.md
# section 5): the bench is unchanged to the tick, 74% clean and zero lost,
# and every fold chose a lead of 0.0. On Anton's two side-view matches the
# stamps are right four times in five against the audio serve marks.
SERVE_LEAD_S = 0.0
# A contact deeper into the card than this is a mid-rally bounce pair the
# detector mistook for a serve, not the serve that opened the point: lead
# 2.2 s + HEAD_LEAD 1.6 s + slack. With the cap, stamp precision goes from
# 49% to 59% on the end-on bench and 82% to 86% on the side-view booth.
STAMP_MAX_OFFSET_S = 4.5


def stamp_serves(E, cards):
    """serve_s = the first accepted serve contact inside the card, if it sits
    within STAMP_MAX_OFFSET_S of the card's start; else None. serves_inside
    is the count of contacts in the card, kept for the diagnosis page (a
    card holding two is a fusion candidate). Mutates and returns cards."""
    sv = np.asarray(E.serves, float)
    for c in cards:
        inside = sv[(sv >= c["t0"]) & (sv <= c["t1"])] if len(sv) else sv
        c["serves_inside"] = int(len(inside))
        first = float(inside[0]) if len(inside) else None
        if first is not None and first - c["t0"] > STAMP_MAX_OFFSET_S:
            first = None
        c["serve_s"] = first
    return cards


def boundaries(E, z, zfps, exits, P, borrow_serves=True):
    """Candidate boundary ticks: freeze valleys, prism exits, chain gaps,
    and every accepted serve contact minus SERVE_LEAD_S. The segmentation
    still decides; a serve tick it does not like is ignored like any other.
    borrow_serves=False is the pre-2026-09-06 candidate set, kept so the
    faithfulness check can prove the port changes nothing else."""
    cand = [valleys(z, zfps, P["cand_pct"]), np.asarray(exits, float)]
    cr = np.asarray(E.cross, float)
    if len(cr):
        cand.append(np.asarray(
            [(cr[i] + cr[i + 1]) / 2 for i in range(len(cr) - 1)
             if cr[i + 1] - cr[i] > 2.0], float))
    if borrow_serves and len(E.serves):
        sv = np.asarray(E.serves, float) - SERVE_LEAD_S
        cand.append(sv[sv > 0])
    usable = [c for c in cand if len(c)]
    b = np.unique(np.concatenate(usable)) if usable else np.zeros(0)
    b = np.concatenate([[0.0], b, [E.duration]])
    ticks = np.unique((b / TICK).astype(int))
    return ticks[(ticks >= 0) & (ticks < E.n)]


def segment(E, z, zfps, exits, P, borrow_serves=True):
    """Viterbi over candidate boundaries, strictly alternating.

    f[j][0] is the best total for a segmentation whose segment ending at
    B[j] is DEAD; f[j][1] the same for POINT. Because the two states can
    only be reached from each other, the alternation is structural rather
    than a penalty that could be outweighed.
    """
    ev = play_evidence(E, z, zfps, P)
    s = np.concatenate([[0.0], np.cumsum(ev - P["theta"])])
    B = boundaries(E, z, zfps, exits, P, borrow_serves)
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


def build_cards(E, z, zfps, exits, P=None, borrow_serves=True, stamp=True):
    """Cards in SOURCE seconds, sorted and disjoint.

    serve_s is the detected serve contact the card holds (stamp_serves),
    and None wherever no contact lies within STAMP_MAX_OFFSET_S of the
    card's start. On a genuinely end-on camera that is most cards, and
    about four stamps in ten there are a mid-rally pair: downstream code
    must still treat None as the normal case, and placement's own checks
    (first bounce on the server's half, consecutive bounces, the trust
    threshold) are what stand between a wrong stamp and a wrong dot.
    """
    P = dict(CONFIG, **(P or {}))
    out = []
    for a, b in segment(E, z, zfps, exits, P, borrow_serves):
        out.append({"t0": max(0.0, a - P["lead"]),
                    "t1": min(E.duration, b + P["pad"]),
                    "serve_s": None, "why": "endon"})
    cards = V2.resolve(out)
    return stamp_serves(E, cards) if stamp else cards
