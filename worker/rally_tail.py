"""Trim the dead air off the end of a point, using the players' bodies.

WHY THIS EXISTS. A card's end is set by the ball, and the ball is often not
there to set it: `rally_end_cut_s` is null by construction on an end-on
camera, on a fallback card with no crossing chain, and on the first half of
a split card. Where it is null the card simply runs to whatever the
assembler's tail allowed, and measured against Adil's own winner presses on
seven matches that is a median of 0.8s of dead air and, on one point in
four, more than two seconds of it. On the end-on matches -- the ones with
no ball reading at all -- it is one point in three.

The bodies still know. Between two points the players stop, and one of them
bends down to pick the ball up; both are plainly visible whatever the
camera can see of the ball. This module reads that.

WHAT IT IS NOT. It never lengthens a card and never moves its start, so it
cannot lose a rally that the assembler already captured and cannot renumber
or re-anchor anything. The worst it can do is take MAX_TRIM_S off an
ending, which is why that constant exists and is small. Where it has no
confident reading it returns None and the card is left exactly as it was.

MEASURED, 2026-09-07. Ruler: Adil's own winner press (points.scored_at_cut_s)
on the matches he vouches for. Held out means the play model never saw that
match. Scored over EVERY card carrying a press, not only the ones the model
found easy -- 236 points on four held-out matches, two of them end-on:

    endings more than 2s late   42 (18%) -> 22 ( 9%)
    endings more than 3s late   23 (10%) -> 11 ( 5%)
    endings more than 2s early   0       ->  2 ( 1%)
    90th percentile              2.93s   -> 1.79s

71 of the 236 cards move at all, by 0.44s on average across all of them. An
earlier reading of this rule looked twice as good because it scored only the
cards a whole-video decode cleanly owned; production has no such luxury, and
the honest population is the one above.

The ball's own `rally_end_cut_s` is deliberately not consulted, as a ruler
or as an input: measured against the same presses it lands more than two
seconds early on half of the points that carry it, and Adil's judgement of
that detector is that it is not to be relied on.

NO TABLE NEEDED. Every feature here is body geometry in pixels, divided by
the player's own box height or by the match's own median. Rebuilding them
with a deliberately wrong table calibration returns byte-identical values,
which was checked rather than assumed -- so a match whose table never
calibrated, which on an end-on camera is the common case, still gets its
endings trimmed.
"""

from __future__ import annotations

import json
import os
from typing import Any, Mapping, Sequence

import numpy as np

# COCO-17 joints, the layout RTMPose returns.
KP = dict(nose=0, ls=5, rs=6, le=7, re=8, lw=9, rw=10,
          lh=11, rh=12, lk=13, rk=14, la=15, ra=16)
MIN_KP = 0.3          # a keypoint scored under this is not there

# The frame rate the play model was fitted at, and the averaging window in
# seconds. Both are part of the model: resampling without refitting changes
# every rolling window in the feature set.
MODEL_FPS = 10.0
SMOOTH_S = 0.5

# The trim itself. PAD_S puts back the comfort the model does not know about
# -- it marks the moment play stopped, and a viewer wants a beat after that.
# MAX_TRIM_S bounds the damage when the model is wrong: no ending can move
# by more than this, whatever the model says. MIN_TRIM_S keeps the rule off
# cards it would barely change, so a re-cut is only ever spent on a card
# that visibly needed one.
PAD_S = 2.5
MAX_TRIM_S = 2.0
MIN_TRIM_S = 0.5
# Play is "still happening" at this probability, and has to hold for this
# many consecutive frames to count -- one frame over the line is noise.
PLAY_TH = 0.5
PLAY_RUN = 3

FEATURE_ORDER = (
    "beat_wrist", "beat_near_wrist", "beat_near_lat", "alternation", "strokes_s",
    "near_hip_drop", "near_head_over_hip", "near_hand_to_floor", "near_box_squat",
    "far_hip_drop", "far_head_over_hip", "far_hand_to_floor", "far_box_squat",
    "any_bending",
    "near_snap", "far_snap", "snap_both_quiet", "snap_quiet_run",
    "snap_drop", "snap_pre", "snap_post",
)

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "rally_tail_model.json")


# ---------------------------------------------------------------- helpers --

def _pt(kp: np.ndarray, j: int):
    return kp[j, :2] if kp[j, 2] >= MIN_KP else None


def _mean(pts):
    ps = [p for p in pts if p is not None]
    return np.mean(ps, axis=0) if ps else None


def _win(T: np.ndarray, secs: float) -> int:
    dt = float(np.median(np.diff(T)))
    return max(1, int(round(secs / dt)))


def _roll(x, k, fn=np.nanmean, minn=2):
    n = len(x)
    out = np.full(n, np.nan)
    for i in range(n):
        seg = x[max(0, i - k): i + k + 1]
        if np.sum(~np.isnan(seg)) >= minn:
            out[i] = fn(seg)
    return out


def _speed(pos, T, bh, max_gap=2):
    """Speed of a point, in the player's own heights per second."""
    n = len(T)
    out = np.full(n, np.nan)
    ok = np.where(~np.isnan(pos[:, 0]))[0]
    for a, b in zip(ok, ok[1:]):
        if b - a <= max_gap and bh[b] > 0:
            out[b] = (float(np.linalg.norm(pos[b] - pos[a])) / bh[b]
                      / max(T[b] - T[a], 1e-6))
    return out


def _wrist_speed(wr, T, bh, max_gap=2):
    n = len(T)
    out = np.full(n, np.nan)
    prev = None
    for i in range(n):
        w = wr[i]
        if not w:
            prev = None
            continue
        if prev is not None and i - prev[1] <= max_gap and bh[i] > 0:
            d = [float(np.linalg.norm(a - b)) for a in w for b in prev[0]]
            out[i] = min(d) / bh[i] / max(T[i] - T[prev[1]], 1e-6)
        prev = (w, i)
    return out


def _beat(x, T, win_s=1.5, lo_s=0.25, hi_s=1.2):
    """How strongly a signal repeats: the best autocorrelation at a stroke's
    own period, over a window either side. A rally has one; walking does not."""
    dt = float(np.median(np.diff(T)))
    k = _win(T, win_s)
    lo, hi = max(1, int(round(lo_s / dt))), max(2, int(round(hi_s / dt)))
    n = len(x)
    out = np.full(n, np.nan)
    y = np.where(np.isnan(x), np.nan, x)
    for i in range(n):
        seg = y[max(0, i - k): i + k + 1]
        good = ~np.isnan(seg)
        if good.sum() < 2 * hi:
            continue
        s = np.where(good, seg, np.nanmean(seg[good])) - np.nanmean(seg[good])
        d = float(np.dot(s, s))
        if d <= 1e-9:
            out[i] = 0.0
            continue
        best = 0.0
        for lag in range(lo, min(hi, len(s) - 2) + 1):
            r = float(np.dot(s[:-lag], s[lag:])) / d
            if r > best:
                best = r
        out[i] = best
    return out


def _alternation(a, b, T, win_s=1.5, lo_s=0.15, hi_s=0.9):
    """Do the two players TAKE TURNS? The best correlation between one's
    activity and the other's, shifted by up to about one stroke, either way."""
    dt = float(np.median(np.diff(T)))
    k = _win(T, win_s)
    lo, hi = max(1, int(round(lo_s / dt))), max(2, int(round(hi_s / dt)))
    n = len(T)
    out = np.full(n, np.nan)
    for i in range(n):
        s0, s1 = max(0, i - k), min(n, i + k + 1)
        x, y = a[s0:s1], b[s0:s1]
        good = ~np.isnan(x) & ~np.isnan(y)
        if good.sum() < 2 * hi:
            continue
        x = np.where(good, x, np.nan)
        y = np.where(good, y, np.nan)
        mx, my = np.nanmean(x), np.nanmean(y)
        x = np.nan_to_num(x - mx)
        y = np.nan_to_num(y - my)
        nx, ny = float(np.dot(x, x)) ** 0.5, float(np.dot(y, y)) ** 0.5
        if nx < 1e-6 or ny < 1e-6:
            out[i] = 0.0
            continue
        best = 0.0
        for lag in range(lo, min(hi, len(x) - 2) + 1):
            for p, q in ((x[:-lag], y[lag:]), (y[:-lag], x[lag:])):
                r = float(np.dot(p, q)) / (nx * ny)
                if r > best:
                    best = r
        out[i] = best
    return out


def _percol(raw_side: Sequence[Any]) -> dict:
    """Per-frame quantities for one player, before any smoothing.

    Everything is divided by that player's own box height, so a player eight
    metres away reads the same as one filling the frame, and nothing here
    consults the table.
    """
    n = len(raw_side)
    z = lambda: np.full(n, np.nan)                                  # noqa: E731
    bh = z()
    cen = np.full((n, 2), np.nan)
    aspect = z(); hipfoot = z(); headup = z(); reach = z()
    wr: list = [None] * n
    for i, f in enumerate(raw_side):
        if f is None:
            continue
        b = f["box"]; kp = f["kp"]
        h = max(1.0, b[3] - b[1])
        bh[i] = h
        sh = [_pt(kp, KP["ls"]), _pt(kp, KP["rs"])]
        hp = [_pt(kp, KP["lh"]), _pt(kp, KP["rh"])]
        wrist = [p for p in (_pt(kp, KP["lw"]), _pt(kp, KP["rw"])) if p is not None]
        ank = [_pt(kp, KP["la"]), _pt(kp, KP["ra"])]
        shc = _mean(sh); hpc = _mean(hp)
        c = _mean(sh + hp)
        if c is not None:
            cen[i] = c
        wr[i] = wrist
        # The box turning square is a player folded over: it needs no
        # keypoints at all, so it survives the frames where pose is thin.
        aspect[i] = (b[3] - b[1]) / max(1.0, b[2] - b[0])
        ankc = _mean([p for p in ank if p is not None])
        if hpc is not None and ankc is not None:
            hipfoot[i] = (ankc[1] - hpc[1]) / h
        if hpc is not None and (nz := _pt(kp, KP["nose"])) is not None:
            headup[i] = (hpc[1] - nz[1]) / h
        if ankc is not None and wrist:
            reach[i] = max((p[1] - ankc[1]) / h for p in wrist)   # + = below the feet
    return dict(bh=bh, cen=cen, wr=wr, aspect=aspect, hipfoot=hipfoot,
                headup=headup, reach=reach)


def play_features(T: np.ndarray, poses: Mapping[str, Sequence[Any]]):
    """The twenty-one columns the play model was fitted on, in its own order.

    `poses` is {"near": [...], "far": [...]}, one entry per frame of `T`,
    each either None or {"box": (x1,y1,x2,y2), "kp": (17,3) array}. Both
    sides must be the same length as T.
    """
    for side in ("near", "far"):
        if len(poses[side]) != len(T):
            raise ValueError(f"{side} poses do not line up with the time base")
    P = {s: _percol(poses[s]) for s in ("near", "far")}
    dt = float(np.median(np.diff(T)))
    k_half = _win(T, SMOOTH_S)
    sp, wsp = {}, {}
    for side in ("near", "far"):
        sp[side] = _speed(P[side]["cen"], T, P[side]["bh"])
        wsp[side] = _wrist_speed(P[side]["wr"], T, P[side]["bh"])
    cols: list = []
    names: list = []

    def add(nm, x):
        cols.append(np.asarray(x, dtype=float)); names.append(nm)

    # -- rhythm: a rally repeats and the players take turns; nothing else does
    both = np.nanmax(np.column_stack([wsp["near"], wsp["far"]]), axis=1)
    add("beat_wrist", _beat(both, T))
    add("beat_near_wrist", _beat(wsp["near"], T))
    add("beat_near_lat", _beat(
        P["near"]["cen"][:, 0] / np.where(P["near"]["bh"] > 0, P["near"]["bh"], np.nan),
        T, win_s=2.0, lo_s=0.4, hi_s=2.0))
    add("alternation", _alternation(wsp["near"], wsp["far"], T))
    pk = np.zeros(len(T))
    for side in ("near", "far"):
        x = _roll(wsp[side], max(1, _win(T, 0.15)))
        thr = np.nanpercentile(x, 60)
        for i in range(1, len(x) - 1):
            if x[i] > thr and x[i] >= x[i - 1] and x[i] > x[i + 1]:
                pk[i] += 1
    add("strokes_s", _roll(pk, _win(T, 1.5), np.nansum, minn=1) / 3.0)

    # -- floor: PICKING THE BALL UP. Hips down, head follows, a hand goes
    #    below the feet, the whole box turns square. All four are ratios, and
    #    each is read against this player's OWN median over the match, so
    #    "bent over" means bent for them rather than for some average player.
    for sd in ("near", "far"):
        pz = P[sd]
        hf = pz["hipfoot"]; med = np.nanmedian(hf)
        add(f"{sd}_hip_drop", _roll(med - hf, k_half))            # + = crouched
        add(f"{sd}_head_over_hip", _roll(pz["headup"], k_half))
        add(f"{sd}_hand_to_floor", _roll(pz["reach"], k_half))
        asp = pz["aspect"]; amed = np.nanmedian(asp)
        add(f"{sd}_box_squat", _roll(amed - asp, k_half))
    add("any_bending", np.fmax(
        np.nan_to_num(_roll(np.nanmedian(P["near"]["hipfoot"]) - P["near"]["hipfoot"], k_half)),
        np.nan_to_num(_roll(np.nanmedian(P["far"]["hipfoot"]) - P["far"]["hipfoot"], k_half))))

    # -- snap: THE SAME SIGNALS AT A TENTH OF THE SMOOTHING. Half a second is
    #    the right window for "is a rally happening" and the wrong one for
    #    "did it just stop". At a booth the players stay at the table and the
    #    next serve comes inside two seconds, so all that separates two points
    #    is a stillness under a second long.
    k_snap = max(1, _win(T, 0.15))
    act = {}
    for side in ("near", "far"):
        a = _roll(np.nanmax(np.column_stack([sp[side], wsp[side] / 3.0]), axis=1), k_snap)
        ref = np.nanpercentile(a, 70)
        act[side] = a / max(float(ref), 1e-6)
        add(f"{side}_snap", act[side])
    q = np.fmin(act["near"], act["far"])
    add("snap_both_quiet", q)
    quiet = np.nan_to_num(q, nan=1.0) < 0.5
    run = np.zeros(len(T)); acc = 0.0
    for i in range(len(T)):
        acc = acc + dt if quiet[i] else 0.0
        run[i] = min(acc, 4.0)
    add("snap_quiet_run", run)
    k1 = max(1, _win(T, 1.0))
    e = np.fmax(act["near"], act["far"])
    pre = np.array([np.nanmean(e[max(0, i - k1):i + 1]) if i > 0 else np.nan
                    for i in range(len(T))])
    post = np.array([np.nanmean(e[i:i + k1 + 1]) for i in range(len(T))])
    add("snap_drop", pre - post)
    add("snap_pre", pre)
    add("snap_post", post)

    if tuple(names) != FEATURE_ORDER:
        raise AssertionError("feature order drifted from the frozen model's")
    return np.column_stack(cols), names


# ------------------------------------------------------------ the model --

def load_model(path: str = MODEL_PATH) -> dict:
    with open(path) as fh:
        model = json.load(fh)
    if list(model["features"]) != list(FEATURE_ORDER):
        raise ValueError("the frozen model was fitted on different features")
    return model


def play_probability(X: np.ndarray, model: Mapping[str, Any]) -> np.ndarray:
    """Per-frame probability that a rally is happening.

    A plain logistic on standardised features; the last weight is the bias
    column. A missing feature standardises to its own mean, which is the
    right default: a frame we cannot read should not argue either way.
    """
    mu = np.asarray(model["mu"], dtype=float)
    sd = np.asarray(model["sd"], dtype=float)
    w = np.asarray(model["weights"], dtype=float)
    Z = np.nan_to_num((np.asarray(X, dtype=float) - mu) / sd)
    Z = np.column_stack([Z, np.ones(len(Z))])
    return 1.0 / (1.0 + np.exp(-(Z @ w)))


def rally_tail_end(T: np.ndarray, p: np.ndarray, t0: float, t1: float,
                   threshold: float = PLAY_TH, run: int = PLAY_RUN):
    """The last moment inside this card that still looks like play.

    Specifically the END OF THE LONGEST sustained run of play in the card,
    not the last frame anywhere above the line. The difference is the whole
    rule: a card that overruns picks up the start of the next point's
    knock-up, or a player practising a stroke while they walk back, and the
    last frame above the line sits in THAT rather than in the rally. The
    longest run is the rally; anything after it is why the card is too long.
    Measured against Adil's presses on four held-out matches, taking the
    longest run instead of the last frame moves endings more than two
    seconds late from 29 to 22 of 236.

    Read INSIDE the card the assembler already made, never outside it, so
    this can only ever answer "the rally had stopped by here". Returns None
    when no run of frames inside the card clears the threshold -- a card we
    cannot read is a card we leave alone.
    """
    T = np.asarray(T, dtype=float)
    p = np.asarray(p, dtype=float)
    inside = (T >= t0) & (T <= t1)
    if not inside.any():
        return None
    tw, pw = T[inside], p[inside]
    hot = (pw >= threshold).astype(int)
    if run > 1:
        held = np.convolve(hot, np.ones(run, dtype=int), "same") >= run
    else:
        held = hot.astype(bool)
    best_len, best_end, start = 0, None, None
    for i, h in enumerate(held):
        if h and start is None:
            start = i
        if start is not None and (not h or i == len(held) - 1):
            end = i if not h else i + 1
            if end - start > best_len:
                best_len, best_end = end - start, end - 1
            start = None
    if best_end is None:
        return None
    return float(tw[best_end])


def trimmed_end(t1: float, tail_end: float | None,
                pad_s: float = PAD_S, max_trim_s: float = MAX_TRIM_S,
                min_trim_s: float = MIN_TRIM_S):
    """The card's new end, or None to leave it exactly as it is.

    Three guards, in the order they matter. The pad puts back the beat a
    viewer wants after the ball dies. The cap means no ending can move more
    than max_trim_s however wrong the model is, which bounds the damage
    rather than trusting the model not to do any. The floor keeps the rule
    off cards it would barely change, so no re-cut is spent for nothing.
    """
    if tail_end is None:
        return None
    candidate = max(float(t1) - max_trim_s, float(tail_end) + pad_s)
    if float(t1) - candidate <= min_trim_s:
        return None
    return candidate
