"""The v2 card assembly: points built against Adil's own boundaries.

Selected by `app_config.points_pipeline = 'v2'`; points_pipeline.py cmd_points
branches to build_cards() after calibration and feeds the result into the
same downstream every v1 play goes through (fit, classify, placement, clips,
cut segments). This module decides only where cards start and end.

Ported from TTVid/recall-lab (s4_ball.py + s21_pipeline.py) on 2026-08-17.
The lab is the reference: every constant here was swept or measured against
`public.point_boundaries` — 278 points he bounded at both ends — and the
lab's scorecard (s20) is the harness that produced them. Measured there,
against production on the same six matches:

    points lost            0 / 0        (the constraint, not a target)
    held whole in one card 91% / 91%
    split across two cards 2% / 8%
    cards butted together  0 / 346
    junk cards             27% / 32%

Full record: docs/research/2026-08-16-point-ends-and-junk.md and
docs/research/2026-08-17-serve-notes-analysis.md.

WHAT THIS NEEDS THAT v1 DOES NOT: the ball detector's four candidates per
frame ("c" in the detections jsonl, vendor/blurball_infer.py). The tracker's
single pick is a global argmax and time-shares with the neighbouring table's
ball; the continuity chain rebuilt from candidates is what took serve
detection from 36% coverage to ~90%. No candidates, no v2 — the caller
falls back to v1 rather than run this on the wrong track.

PHASE 1 SCOPE: calibrated matches only. A match with no table quad keeps
v1's behaviour entirely. The lab has a no-calibration path (bounce-cloud
axis); it is deliberately not ported yet — recalibration made no-table
matches rare, and smaller surface area beats coverage on day one.
"""
import json
import math

import cv2
import numpy as np

from table_coordinates import canonicalize_table_quad, table_homography

W_M, L_M = 1.525, 2.74
NET_V = L_M / 2.0

# --- track continuity (s4_ball) ---
MAX_JUMP_PX = 220.0      # per frame at 1920 wide; a smash crosses ~150px
RESEED_GAP = 8           # frames without a plausible successor before the
                         # chain restarts on the strongest candidate

# --- bounces ---
BOUNCE_MOTION_PX = 3.0   # a parked speck must not manufacture a bounce
BOUNCE_REVERSAL_PX = 1.0

# --- serve motif ---
PAIR_MAX_S = 1.60        # a serve's two bounces are close together
NET_MARGIN_M = 0.20      # clearly one side of the net
BACKTRACK_MAX_M = 0.50   # tolerated backward travel between the bounces
APEX_MIN_PX = 8.0        # the ball must leave the table between them
CONTACT_LOOKBACK_S = 0.81  # first bounce - K = contact (physical, not tuned)
# Both bounces of a serve land on the table. The flight corridor is
# deliberately generous; a bounce is a contact and has to be on the surface.
# Three of the pairs Adil picked out by eye were a floor, a barrier and a
# shoe (2026-08-17 notes analysis).
PAIR_SURFACE_PAD_M = 0.15
# Crossings in the 1.5s before the first bounce. Two means a rally was
# already running and this pair is two shots of it. One is allowed because
# the crossing detector fires on noise often enough that demanding zero
# costs 47 real serves their head.
PRIOR_CROSS_WINDOW_S = 1.5
PRIOR_CROSS_MAX = 1
CLUSTER_S = 1.5          # pairs this close together describe one serve
# NOTE deliberately absent: ranking a cluster by the turn angle between its
# bounces. Strongest single signal in the corpus (17° on a real serve, 132°
# mid-rally) and measured WORSE as a chooser — the old first-of-cluster rule
# was already within 0.27s of his tap against a 0.18s ceiling, and every
# "better" pick later in the rally clipped the serve off the front.
# s39_ablate in the lab has the table; do not re-add without re-measuring.

# --- crossings ---
DWELL = 2
TELEPORT_S = 0.35

# --- evidence grid (s6_regions subset) ---
TICK = 0.1
BALL_FAST_PX = 8.0
BIN_S = 0.5
MIN_FAST = 4

# --- the head (s21, swept against his boundaries) ---
HEAD_LEAD = 1.6
HEAD_LEAD_CROSS = 3.2    # first crossing comes +1.02s after his serve tap
HEAD_LEAD_BALL = 2.0

# --- the tail ---
# His winner click lands 1.45s after the last table bounce. The sweep would
# not shorten these: every attempt split points, and a split costs a manual
# join. s37 re-measured it: 2.6 -> 2.2 loses 3.6 points of whole for zero
# junk. s40 swept TAIL_AFTER_CROSS downward for the first time: no effect.
TAIL_AFTER_BOUNCE = 2.6
TAIL_AFTER_CROSS = 2.6
TAIL_MAX_S = 6.0

# --- rally extent ---
CROSS_GAP_S = 3.0        # a rally's crossings never pause longer than this
MIN_RALLY_S = 1.5
MIN_GAP_S = 0.3
MAX_RALLY_S = 40.0

# --- fallback ---
MIN_UNCLAIMED_S = 0.6
FALLBACK_MERGE_S = 3.5
MAX_FALLBACK_S = 30.0    # runaway guard only
FALLBACK_MIN_TABLE_BOUNCES = 1
# Every card, once, at the end: the ball must have touched HIS table.
# "when the neighbouring table is warming up, the thing keeps going as if
# it's her own points" — it was. Two is too far: that loses real points.
MIN_TABLE_BOUNCES = 1

# --- the veto ---
# Deliberately looser than the sweep wanted (4 bounces / 4.0s): the case
# being protected — a serve missed or netted, so the ball never crosses —
# is 1.4% of his marked points and he expects more among weaker players.
VETO_MIN_BOUNCES = 2
VETO_MIN_MOVING_S = 3.0
# Below this foreshortening the near/far separation a crossing needs is a
# few pixels and the veto switches itself off (Tripp is 0.28).
MIN_FORESHORTEN = 0.60

# --- resolve ---
MIN_CARD_S = 0.4
# MUST exceed the clip pads the player sees (0.3 + 0.4) or consecutive
# cards show overlapping video. At 0.4 the Gavin match read as one
# continuous stream; the scorecard now counts butted pairs to hold this.
MIN_DEAD_S = 1.2
# When two SERVE cards collide, both anchors are measured and what gives
# is margin: the earlier card's padded tail retreats, the dead gap
# compresses to this floor (pads 0.3+0.4 plus a visible quarter-second),
# and the later card keeps at least HEAD_MIN_S before its serve. Pushing
# the later card instead is how Rowel's points 5 and 82 came to open
# mid-serve (2026-08-17 analysis).
SQUEEZE_DEAD_S = 0.95
HEAD_MIN_S = 0.35
MAX_CARD_S = 20.0

# The clip pads that go with v2 cards. A card already carries its head lead
# and tail inside t0/t1, so the pads are context slivers, not the head —
# the lab scored every v2 number with exactly these.
CLIP_PRE_S = 0.3
CLIP_POST_S = 0.4


# ---------------------------------------------------------------------------
# detections with candidates
# ---------------------------------------------------------------------------
def load_multi(path):
    """{frame: [(x, y, score), ...]} from a candidates-carrying jsonl.

    Returns None when the file has no "c" fields at all — an old detections
    file from before the vendor patch — so the caller can fall back to v1
    instead of running the continuity chain on nothing.
    """
    out, any_c = {}, False
    with open(path) as fh:
        for line in fh:
            r = json.loads(line)
            c = r.get("c")
            if c is not None:
                any_c = True
                out[r["f"]] = [(p[0], p[1], p[2]) for p in c]
            elif r.get("x") is not None:
                out[r["f"]] = [(r["x"], r["y"], r.get("conf", 0.0))]
            else:
                out[r["f"]] = []
    return out if any_c else None


def build_track(cand, scale=1.0):
    """Continuity chain over the candidate cloud -> {frame: (x, y)}.

    Greedy with a constant-velocity prediction: the ball is ballistic
    between contacts, and the confusers (a neighbouring table's ball, a
    shoe, a light) do not follow our ball's velocity.
    """
    frames = sorted(cand)
    track = {}
    prev = prev2 = None
    gap = 0
    for f in frames:
        cs = cand[f]
        if not cs:
            gap += 1
            if gap >= RESEED_GAP:
                prev = prev2 = None
            continue
        if prev is None:
            best = max(cs, key=lambda c: c[2])
        else:
            if prev2 is not None:
                pred = (2 * prev[0] - prev2[0], 2 * prev[1] - prev2[1])
            else:
                pred = prev
            scored = sorted(
                ((math.hypot(c[0] - pred[0], c[1] - pred[1]), c) for c in cs),
                key=lambda s: s[0])
            d, best = scored[0]
            if d > MAX_JUMP_PX * scale * max(1, gap + 1):
                gap += 1
                if gap >= RESEED_GAP:
                    prev = prev2 = None
                continue
        track[f] = (best[0], best[1])
        prev2, prev, gap = prev, (best[0], best[1]), 0
    return track


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------
def homography_from_corners(corners_px):
    names = list(corners_px)
    corners = [corners_px[n] for n in names]
    near = tuple(i for i, n in enumerate(names) if "near" in n)
    quad = canonicalize_table_quad(corners, near_pair=near)
    return table_homography(quad)


def project(H, x, y):
    w = H[2, 0] * x + H[2, 1] * y + H[2, 2]
    if abs(w) < 1e-9:
        return None
    return ((H[0, 0] * x + H[0, 1] * y + H[0, 2]) / w,
            (H[1, 0] * x + H[1, 1] * y + H[1, 2]) / w)


def in_corridor(u, v):
    return -0.7 <= u <= W_M + 0.7 and -1.5 <= v <= L_M + 1.5


def on_surface(p, pad=PAIR_SURFACE_PAD_M):
    return bool(-pad <= p[0] <= W_M + pad and -pad <= p[1] <= L_M + pad)


PRISM_H_M = 1.6          # how high above the table the ball plausibly lives


def prism_polygon(corners_px):
    """The image region vertically above the table, from Adil's framing:

      "The region that is exactly vertically on top of the table is really
       the region you can expect the ball to travel to."

    The prism over the table projects to the hull of the quad and the quad
    lifted vertically, per-corner: a metre of height is more pixels at the
    near edge than the far one, and the table's own edges are the ruler
    (the near edge is 1.525m across, so its pixel length over 1.525 is
    that corner's pixels-per-metre). Derived from the calibration, which
    is measured — unlike the activity gate, which is a density guess and
    pointed at the wrong third of the frame on both side-on matches.
    """
    near = sorted((p for n, p in corners_px.items() if "near" in n),
                  key=lambda p: p[0])
    far = sorted((p for n, p in corners_px.items() if "far" in n),
                 key=lambda p: p[0])
    ppm_near = float(np.hypot(near[1][0] - near[0][0],
                              near[1][1] - near[0][1])) / W_M
    ppm_far = float(np.hypot(far[1][0] - far[0][0],
                             far[1][1] - far[0][1])) / W_M
    pts = []
    for P, ppm in ((near[0], ppm_near), (near[1], ppm_near),
                   (far[0], ppm_far), (far[1], ppm_far)):
        pts.append([P[0], P[1]])
        pts.append([P[0], P[1] - ppm * PRISM_H_M])
    return cv2.convexHull(np.asarray(pts, np.float32))


def in_prism(hull, x, y):
    return cv2.pointPolygonTest(hull, (float(x), float(y)), False) >= 0


def foreshortening(corners_px):
    """How square-on the camera is. 1.0 is honest; Tripp is 0.28."""
    near = [p for n, p in corners_px.items() if "near" in n]
    far = [p for n, p in corners_px.items() if "far" in n]
    if len(near) != 2 or len(far) != 2:
        return None
    width = np.linalg.norm(np.asarray(near[0]) - np.asarray(near[1]))
    length = np.linalg.norm(np.mean(far, axis=0) - np.mean(near, axis=0))
    return float(length / max(width, 1e-6)) / (L_M / W_M)


# ---------------------------------------------------------------------------
# ball events (s4_ball)
# ---------------------------------------------------------------------------
def bounces(track, scale=1.0):
    """Local image-y maxima of a MOVING ball -> [(frame, x, y)]."""
    out = []
    fr = sorted(track)
    idx = {f: i for i, f in enumerate(fr)}
    for f in fr:
        i = idx[f]
        if i < 2 or i > len(fr) - 3:
            continue
        w = [track[fr[j]] for j in range(i - 2, i + 3)]
        if any(fr[j + 1] - fr[j] > 3 for j in range(i - 2, i + 2)):
            continue
        ys = [p[1] for p in w]
        if not (ys[2] >= ys[1] and ys[2] >= ys[3]
                and ys[2] - ys[0] >= BOUNCE_REVERSAL_PX * scale
                and ys[2] - ys[4] >= BOUNCE_REVERSAL_PX * scale):
            continue
        if math.hypot(w[2][0] - w[1][0],
                      w[2][1] - w[1][1]) < BOUNCE_MOTION_PX * scale:
            continue
        out.append((f, track[f][0], track[f][1]))
    return out


def crossings(track, H, fps):
    """Dwell-confirmed net crossings -> [t_seconds]."""
    pts = []
    for f in sorted(track):
        p = project(H, *track[f])
        if p and in_corridor(*p):
            pts.append((f / fps, p[1]))
    out, side, streak, last = [], 0, 0, None
    for t, v in pts:
        s = 1 if v > NET_V + NET_MARGIN_M else (
            -1 if v < NET_V - NET_MARGIN_M else 0)
        if s == 0 or (last is not None and t - last > TELEPORT_S):
            streak = 0 if s == 0 else 1
            if s != 0 and last is not None and t - last > TELEPORT_S:
                side = 0
            last = t
            if s != 0 and side == 0:
                side = s
            continue
        last = t
        streak += 1
        if s != side and streak >= DWELL and side != 0:
            out.append(t)
            side, streak = s, 1
        elif side == 0:
            side, streak = s, 1
    return out


def serve_motifs(track, bnc, H, fps, scale=1.0, cross=()):
    """Bounce pairs that only a serve produces -> [dict].

    Pair rules, in the order they earn their keep:
      1. both bounces on the playing surface (a bounce is a contact)
      2. opposite sides of the net (a serve must cross)
      3. within PAIR_MAX_S (they are one flight)
      4. the ball leaves the table between them (APEX) — a ball rolled back
         to the server bounces on both halves and is otherwise perfect
      5. it does not travel backwards on the way (no bat in between)
      6. no rally was already running when it started
    """
    cross = np.asarray(cross, float)
    proj = {}
    for f in track:
        p = project(H, *track[f])
        if p:
            proj[f] = p
    marked = [(f, proj.get(f)) for f, _x, _y in bnc]
    marked = [(f, p) for f, p in marked if p and on_surface(p)]
    out = []
    for i, (f0, p0) in enumerate(marked):
        s0 = 1 if p0[1] > NET_V else -1
        for f1, p1 in marked[i + 1:]:
            dt = (f1 - f0) / fps
            if dt <= 0.05:
                continue
            if dt > PAIR_MAX_S:
                break
            s1 = 1 if p1[1] > NET_V else -1
            if s1 == s0:
                continue
            if (abs(p0[1] - NET_V) < NET_MARGIN_M
                    or abs(p1[1] - NET_V) < NET_MARGIN_M):
                continue
            span = [f for f in track if f0 < f < f1]
            if len(span) < 2:
                continue
            ys = [track[f][1] for f in span]
            apex = min(ys)
            if min(track[f0][1], track[f1][1]) - apex < APEX_MIN_PX * scale:
                continue
            vs = [proj[f][1] for f in span if f in proj]
            if not vs:
                continue
            direction = 1 if p1[1] > p0[1] else -1
            back, run = 0.0, p0[1]
            for v in vs:
                d = (v - run) * direction
                if d < 0:
                    back = max(back, -d)
                run = v
            if back > BACKTRACK_MAX_M:
                continue
            t0 = f0 / fps
            if len(cross) and int(((cross >= t0 - PRIOR_CROSS_WINDOW_S)
                                   & (cross < t0 - 0.05)).sum()) > PRIOR_CROSS_MAX:
                continue
            out.append({
                "bounce1_s": round(t0, 3),
                "bounce2_s": round(f1 / fps, 3),
                "contact_s": round(t0 - CONTACT_LOOKBACK_S, 3),
                "server_side": "far" if s0 > 0 else "near",
            })
            break
    # one motif per neighbourhood: the earliest of any cluster
    dedup, last = [], -99.0
    for m in sorted(out, key=lambda m: m["bounce1_s"]):
        if m["bounce1_s"] - last > CLUSTER_S:
            dedup.append(m)
            last = m["bounce1_s"]
    return dedup


# ---------------------------------------------------------------------------
# evidence grid (the s6 subset the card assembly reads)
# ---------------------------------------------------------------------------
def _mark(arr, t0, t1):
    a = max(0, int(t0 / TICK))
    b = min(len(arr) - 1, int(t1 / TICK))
    if b >= a:
        arr[a:b + 1] = True


def runs(mask, min_len=1):
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            if j - i + 1 >= min_len:
                out.append((i * TICK, (j + 1) * TICK))
            i = j + 1
        else:
            i += 1
    return out


class Evidence:
    """Everything a card needs, computed once per match.

    Unlike the lab's version this takes its inputs in memory — the caller
    (cmd_points) already has the detections, the calibration and the gate.
    """

    def __init__(self, cand, corners_px, gate_bbox, fps, duration, width):
        self.duration = float(duration)
        self.fps = fps
        scale = width / 1920.0
        self.n = int(duration / TICK) + 1
        self.shape = foreshortening(corners_px)
        self.calibrated = self.shape is not None
        self.geometric = True     # phase 1: only called with a quad

        track = build_track(cand, scale)
        self.track = track
        H = homography_from_corners(corners_px)
        bnc = bounces(track, scale)
        self.cross = np.asarray(crossings(track, H, fps), float)

        bt, bt_table = [], []
        for f, x, y in bnc:
            p = project(H, x, y)
            if not p or not in_corridor(*p):
                continue
            bt.append(f / fps)
            # the playing surface, not the floor beside it: a rally ends on
            # the table and retrieval bounces on the floor
            if (-0.15 <= p[0] <= W_M + 0.15 and -0.15 <= p[1] <= L_M + 0.15):
                bt_table.append(f / fps)
        self.bt = np.asarray(bt, float)
        self.bt_table = np.asarray(bt_table, float)

        motifs = serve_motifs(track, bnc, H, fps, scale, self.cross)
        # No gate test on a calibrated match: serve_motifs already proved
        # both bounces sit on the calibrated table surface, which is a
        # stronger claim than the activity gate's guessed box. On the
        # side-on Westchester matches the guess landed on the wrong third
        # of the frame and killed all 8 real serve pairs the two matches
        # had; on every good-camera corpus match the two tests agree and
        # removing this one changes nothing (re-measured 2026-08-17,
        # corpus scorecard identical). Evidence is calibrated-only in
        # phase 1, so the flag is simply true.
        for m in motifs:
            m["ingate"] = True
        self.motifs = motifs
        self.serves = sorted({round(m["contact_s"], 2) for m in motifs})

        # ball_dense: half-second bins with rally-strength fast motion, plus
        # a window around every crossing. Motion counts only INSIDE the play
        # prism: a ball persistently outside the region above the table is
        # someone else's, and unfiltered it stretched guess-card extents and
        # propped up the veto on the side-on matches (Terry's median card
        # fell from 15.8s to 7.2s when this gate landed; the corpus
        # scorecard did not move by a single point — s47_prism).
        hull = prism_polygon(corners_px)
        frames = sorted(track)
        nbin = int(duration / BIN_S) + 1
        fastbin = np.zeros(nbin)
        ingate = np.zeros(self.n, bool)
        for f0, f1 in zip(frames, frames[1:]):
            if f1 - f0 > 3:
                continue
            (xa, ya), (xb, yb) = track[f0], track[f1]
            if (abs(xb - xa) + abs(yb - ya) >= BALL_FAST_PX * scale
                    and in_prism(hull, xb, yb)):
                b = int((f1 / fps) / BIN_S)
                if b < nbin:
                    fastbin[b] += 1
                if gate_bbox and (gate_bbox[0] <= xb <= gate_bbox[1]
                                  and gate_bbox[2] <= yb <= gate_bbox[3]):
                    _mark(ingate, f0 / fps, f1 / fps)
        dense = np.zeros(self.n, bool)
        for b in np.nonzero(fastbin >= MIN_FAST)[0]:
            _mark(dense, b * BIN_S, (b + 1) * BIN_S)
        for t in self.cross:
            _mark(dense, t - 0.2, t + 0.2)
        self.ball_dense = dense
        self.ingate = ingate

    def between(self, arr, a, b):
        if not len(arr):
            return arr
        return arr[(arr >= a) & (arr <= b)]


# ---------------------------------------------------------------------------
# card assembly (s21, verbatim in structure)
# ---------------------------------------------------------------------------
def rally_end_ev(E, contact_s):
    """(padded end, evidence end) for the rally opened by this serve.

    The chain of net crossings bounds it, and the last bounce on the table
    inside that chain says where the ball actually died. The PADDED end
    adds the tail margin so his winner click lands inside; the EVIDENCE
    end is the last moment the rally itself was observed. The two were one
    number until Rowel ate a point: the next serve landed 0.41s inside the
    previous card's margin and was skipped as mid-rally.
    """
    last = contact_s
    for t in E.cross:
        if t < contact_s:
            continue
        if t - last > CROSS_GAP_S:
            break
        last = t
    b = E.between(E.bt_table, contact_s, last + 2.0)
    if len(b):
        ev = max(float(b[-1]), last)
        return (min(float(b[-1]) + TAIL_AFTER_BOUNCE,
                    last + TAIL_AFTER_CROSS + TAIL_MAX_S), ev)
    return last + TAIL_AFTER_CROSS, last


def rally_end(E, contact_s):
    return rally_end_ev(E, contact_s)[0]


def serve_points(E):
    """One card per accepted serve, opening HEAD_LEAD before contact.

    The skip test runs against the previous rally's EVIDENCE end, not its
    padded end: a serve after the last observed rally event is a new
    point, whatever the padding says.
    """
    out, open_ev = [], -1e9
    for c in E.serves:
        if c < open_ev + MIN_GAP_S:
            continue                      # inside the previous rally itself
        end, ev = rally_end_ev(E, c)
        end = min(end, c + MAX_RALLY_S)
        out.append({"t0": max(0.0, c - HEAD_LEAD),
                    "t1": min(E.duration, end),
                    "serve_s": c, "why": "serve"})
        open_ev = min(ev, end)
    return out


def fallback_points(E, taken):
    """Cards for the points whose serve was never detected.

    The head walks back to the burst's first net crossing and opens a lead
    before THAT — a boundary derived from the rally rather than from noise.
    """
    claimed = np.zeros(E.n, bool)
    for p in taken:
        _mark(claimed, p["t0"], p["t1"])
    merged = []
    for a, b in runs(E.ball_dense & ~claimed,
                     min_len=int(MIN_UNCLAIMED_S / TICK)):
        if (merged and a - merged[-1][1] <= FALLBACK_MERGE_S
                and b - merged[-1][0] <= MAX_FALLBACK_S):
            merged[-1][1] = b
        else:
            merged.append([a, b])

    out = []
    for a, b in merged:
        cr = E.between(E.cross, a - 0.5, b + 0.5)
        on_table = int(((E.bt >= a - 0.5) & (E.bt <= b + 0.5)).sum())
        if not len(cr) and on_table < FALLBACK_MIN_TABLE_BOUNCES:
            continue
        head = (float(cr[0]) - HEAD_LEAD_CROSS if len(cr)
                else a - HEAD_LEAD_BALL)
        end = rally_end(E, b) if len(cr) else b + 1.6
        out.append({"t0": max(0.0, min(head, a)),
                    "t1": min(E.duration, max(end, b)),
                    "serve_s": None, "why": "no serve seen"})
    return out


def veto(E, cards):
    """Drop cards with no net crossing, unless the ball says otherwise.

    Off entirely when the camera is too square-on for a crossing to mean
    anything. The protection: a failed serve still puts a bouncing, moving
    ball on the table, and two of his marked points are exactly that.
    """
    if E.calibrated and E.shape < MIN_FORESHORTEN:
        return cards, 0
    kept, cut = [], 0
    for c in cards:
        if c["serve_s"] is not None or len(E.between(E.cross, c["t0"], c["t1"])):
            kept.append(c)
            continue
        nb = int(((E.bt >= c["t0"]) & (E.bt <= c["t1"])).sum())
        i0, i1 = int(c["t0"] / TICK), int(c["t1"] / TICK) + 1
        moving = float(E.ball_dense[i0:i1].sum()) * TICK
        if nb >= VETO_MIN_BOUNCES or moving >= VETO_MIN_MOVING_S:
            kept.append(c)
        else:
            cut += 1
    return kept, cut


def merge_continuous(E, cards):
    """Join two cards that are really one rally.

    If the last crossing of one card and the first of the next are closer
    together than a rally's own pause, nothing ended in between. A card
    that opens on a detected serve is never absorbed.
    """
    out = []
    for c in sorted(cards, key=lambda c: c["t0"]):
        if not out:
            out.append(dict(c))
            continue
        prev = out[-1]
        if c["serve_s"] is not None or prev["t1"] + CROSS_GAP_S < c["t0"]:
            out.append(dict(c))
            continue
        a = E.between(E.cross, prev["t0"], prev["t1"])
        b = E.between(E.cross, c["t0"], c["t1"])
        if len(a) and len(b) and float(b[0]) - float(a[-1]) <= CROSS_GAP_S:
            prev["t1"] = max(prev["t1"], c["t1"])
            prev["why"] += " + continued"
        else:
            out.append(dict(c))
    return out


def resolve(cards):
    """Order them, stop them overlapping, and leave real gap between them.

    Also the one place card times are coerced to plain floats: several
    boundaries come out of numpy arrays, and a numpy scalar reaching
    psycopg2 renders as `np.float64(...)` inside the SQL text.
    """
    for c in cards:
        c["t0"], c["t1"] = float(c["t0"]), float(c["t1"])
        if c.get("serve_s") is not None:
            c["serve_s"] = float(c["serve_s"])
    cards = sorted(cards, key=lambda c: (c["t0"], c["serve_s"] is None))
    out = []
    for c in cards:
        c = dict(c)
        if out:
            prev = out[-1]
            if c["t0"] < prev["t1"] + MIN_DEAD_S:
                mine = c["serve_s"] is not None
                theirs = prev["serve_s"] is not None
                if mine and not theirs:
                    prev["t1"] = min(prev["t1"], c["t0"] - MIN_DEAD_S)
                    if prev["t1"] - prev["t0"] < MIN_CARD_S:
                        out.pop()
                elif theirs and not mine:
                    c["t0"] = prev["t1"] + MIN_DEAD_S
                    if c["t1"] - c["t0"] < MIN_CARD_S:
                        continue
                elif mine and theirs:
                    # Two serve cards colliding: both anchors are measured,
                    # so what gives is margin. Trim the earlier card's
                    # padded tail far enough that this card keeps a minimum
                    # head before its own serve, compressing the dead gap
                    # to the squeeze floor. Pushing the later card instead
                    # is how a card came to open half a second AFTER its
                    # own serve contact.
                    want_t1 = c["serve_s"] - HEAD_MIN_S - SQUEEZE_DEAD_S
                    floor = (prev["serve_s"] + MIN_RALLY_S
                             if prev.get("serve_s") is not None
                             else prev["t0"] + MIN_CARD_S)
                    prev["t1"] = max(floor, min(prev["t1"], want_t1))
                    c["t0"] = max(min(c["t0"], c["serve_s"] - HEAD_MIN_S),
                                  prev["t1"] + SQUEEZE_DEAD_S)
                    if c["t1"] - c["t0"] < MIN_CARD_S:
                        continue
                else:
                    if c["t1"] <= prev["t1"] + MIN_DEAD_S:
                        prev["t1"] = max(prev["t1"], c["t1"])
                        continue
                    c["t0"] = prev["t1"] + MIN_DEAD_S
                    if c["t1"] - c["t0"] < MIN_CARD_S:
                        continue
        out.append(c)
    return [c for c in out if c["t1"] - c["t0"] >= MIN_CARD_S]


def on_own_table(E, cards):
    """Drop any card where the ball never touched the user's own table."""
    return [c for c in cards
            if int(((E.bt_table >= c["t0"])
                    & (E.bt_table <= c["t1"])).sum()) >= MIN_TABLE_BOUNCES]


def split_long(E, cards):
    """Cut a card longer than any single rally, at its quietest moment."""
    out = []
    for c in cards:
        if c["t1"] - c["t0"] <= MAX_CARD_S:
            out.append(c)
            continue
        i0, i1 = int(c["t0"] / TICK), int(c["t1"] / TICK)
        dense = E.ball_dense[i0:i1].astype(float)
        mid, win = len(dense) // 2, max(1, len(dense) // 4)
        seg = dense[mid - win:mid + win]
        k = (int(np.argmin(np.convolve(seg, np.ones(6) / 6, "same")))
             if len(seg) else 0)
        cut = c["t0"] + (mid - win + k) * TICK
        out.append({**c, "t1": cut - MIN_DEAD_S / 2})
        out.append({**c, "t0": cut + MIN_DEAD_S / 2, "serve_s": None,
                    "why": c["why"] + " (long card split)"})
    return out


def build_cards(cand, corners_px, gate_bbox, fps, duration, width):
    """The whole assembly. Returns (cards, evidence).

    cards: [{t0, t1, serve_s, why}] in SOURCE seconds, sorted, disjoint,
    with at least MIN_DEAD_S of dead space between consecutive cards.
    """
    E = Evidence(cand, corners_px, gate_bbox, fps, duration, width)
    cards = serve_points(E)
    cards += fallback_points(E, cards)
    cards, _cut = veto(E, cards)
    cards = resolve(merge_continuous(E, resolve(cards)))
    # order matters and mirrors the lab exactly: split, resolve, THEN the
    # own-table test outermost — dropping a card after resolve leaves a
    # gap, which is correct; resolving after a drop could re-butt two
    # survivors across it
    return on_own_table(E, resolve(split_long(E, cards))), E
