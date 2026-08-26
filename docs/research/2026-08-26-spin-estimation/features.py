"""Feature extraction that only uses what production PongLens has today:
 - pixel ball detections at 30 fps (with dropouts)
 - the table-plane homography from the calibrated quad
 - bounce events (time + table position) from the candidate detector

The ground track = H^-1 applied to each pixel. It equals the ball's true
(x, y) only when the ball is on the table; in flight it is displaced away
from the camera by parallax proportional to height. We do NOT try to
undo that here — features are built to be informative despite it (and
the parallax itself carries height information).
"""
import numpy as np
from sim import camera_from_H

G = 9.81

def parallax_corrected_hop(rec, ts, gs):
    """Physics-informed correction: during the hop b1->b2 the ball's
    height displaces its homography ground point radially away from the
    camera's ground footprint by z/(h-z) * (dist to footprint).  A
    ballistic hop's height profile is fixed by its duration alone:
    z(s) = (g T^2 / 8) * 4 s (1-s).  Camera footprint and height come
    from decomposing H with an assumed focal length.  Returns corrected
    ground points for hop observations, plus a lift residual: the extra
    apex scale k (fit jointly with in-plane curvature) that best
    straightens the track.  k > 1 = flies higher than ballistic
    (backspin lift), k < 1 = dives (topspin)."""
    try:
        cam = camera_from_H(np.array(rec["H"]), rec["cam"]["fx"])
    except Exception:
        return None
    C_xy, h = cam.pos[:2], cam.pos[2]
    if h < 0.3:
        return None
    b1t, b2t = rec["b1"]["t"], rec["b2"]["t"]
    T = b2t - b1t
    if T <= 0.08:
        return None
    m = (ts > b1t + 1e-4) & (ts < b2t - 1e-4)
    if m.sum() < 3:
        return None
    t = ts[m]; g = gs[m]
    s = (t - b1t) / T
    z_ap = G * T * T / 8.0
    z = np.clip(4.0 * z_ap * s * (1.0 - s), 0.0, h * 0.8)
    # corrected ground point: ball_xy = C + (g_obs - C) * (h - z)/h
    corr = C_xy + (g - C_xy) * ((h - z) / h)[:, None]
    b1 = np.array([rec["b1"]["x"], rec["b1"]["y"]])
    b2 = np.array([rec["b2"]["x"], rec["b2"]["y"]])
    chord = b2 - b1
    L = np.linalg.norm(chord)
    if L < 0.2:
        return None
    u = chord / L
    nvec = np.array([-u[1], u[0]])
    # joint fit: lateral deviation = k_extra * parallax_shape + c * curvature_shape
    dev = (corr - b1) @ nvec
    par_dir = ((g - C_xy) / np.maximum(
        np.linalg.norm(g - C_xy, axis=1), 1e-6)[:, None])
    par_lat = (par_dir @ nvec) * (z / (h - z)) * np.linalg.norm(g - C_xy, axis=1)
    shape = 4.0 * s * (1.0 - s)
    Amat = np.stack([par_lat, shape], axis=1)
    try:
        coef, *_ = np.linalg.lstsq(Amat, dev, rcond=None)
    except Exception:
        return None
    k_extra, c_curv = coef
    resid = dev - Amat @ coef
    # curvature of the exactly-corrected track (ballistic parallax
    # removed): mean signed lateral deviation from the chord
    curv_corr = float(np.mean(dev) / max(L, 1e-6))
    # heading drift start -> end of hop on corrected points: sidespin
    # curls the ground path continuously, so the exit heading differs
    # from the entry heading by the accumulated curvature
    drift = np.nan
    lo = np.vstack([b1, corr[s < 0.45][:3]] if (s < 0.45).sum() else [b1])
    hi = np.vstack([corr[s > 0.55][-3:], b2] if (s > 0.55).sum() else [b2])
    if len(lo) >= 2 and len(hi) >= 2:
        d0 = lo[-1] - lo[0]
        d1 = hi[-1] - hi[0]
        a0 = np.arctan2(d0[1], d0[0])
        a1 = np.arctan2(d1[1], d1[0])
        dd = a1 - a0
        while dd > np.pi: dd -= 2 * np.pi
        while dd < -np.pi: dd += 2 * np.pi
        drift = float(dd)
    return dict(corr=corr, t=t, k_extra=float(k_extra),
                c_curv=float(c_curv / max(L, 1e-6)),
                curv_corr=curv_corr, drift_corr=drift,
                resid=float(np.sqrt(np.mean(resid ** 2))))

def ground_track(rec):
    Hinv = np.linalg.inv(np.array(rec["H"]))
    ts, gs = [], []
    for o in rec["obs"]:
        q = Hinv @ np.array([o["px"][0], o["px"][1], 1.0])
        gs.append(q[:2] / q[2])
        ts.append(o["t"])
    return np.array(ts), np.array(gs)

def seg_speeds(ts, gs, t0, t1):
    """Consecutive-gap ground speeds for observations in [t0, t1]."""
    m = (ts >= t0) & (ts <= t1)
    t = ts[m]; g = gs[m]
    if len(t) < 2:
        return None
    d = np.linalg.norm(np.diff(g, axis=0), axis=1)
    dt = np.diff(t)
    ok = dt > 1e-6
    return t[:-1][ok], d[ok] / dt[ok], g

def heading(ts, gs, t0, t1):
    m = (ts >= t0) & (ts <= t1)
    g = gs[m]
    if len(g) < 2:
        return None
    d = g[-1] - g[0]
    return np.arctan2(d[1], d[0])

def curvature_signed(ts, gs, t0, t1):
    """Signed lateral deviation of the ground track from the chord,
    normalised by chord length. Positive = curves left of travel."""
    m = (ts >= t0) & (ts <= t1)
    g = gs[m]
    if len(g) < 3:
        return None
    chord = g[-1] - g[0]
    L = np.linalg.norm(chord)
    if L < 0.05:
        return None
    u = chord / L
    n = np.array([-u[1], u[0]])
    devs = [(gi - g[0]) @ n for gi in g[1:-1]]
    return float(np.mean(devs) / L)

def extract(rec, serve_dir=None):
    """Feature dict for one serve record. Bounce events b1 (server half)
    and b2 (receiver half) are given, as production candidates are.
    serve_dir: +1 if serve travels +x, -1 if -x (from b1->b2)."""
    ts, gs = ground_track(rec)
    b1t, b2t = rec["b1"]["t"], rec["b2"]["t"]
    b1 = np.array([rec["b1"]["x"], rec["b1"]["y"]])
    b2 = np.array([rec["b2"]["x"], rec["b2"]["y"]])
    hop_vec = b2 - b1
    hop_len = np.linalg.norm(hop_vec)
    hop_t = b2t - b1t
    if serve_dir is None:
        serve_dir = 1.0 if hop_vec[0] > 0 else -1.0

    f = {}
    f["hop_len"] = hop_len
    f["hop_t"] = hop_t
    f["hop_speed"] = hop_len / max(hop_t, 1e-6)

    W = 0.17  # window seconds around each bounce
    pre1 = seg_speeds(ts, gs, b1t - W, b1t - 1e-4)
    post1 = seg_speeds(ts, gs, b1t + 1e-4, b1t + W)
    pre2 = seg_speeds(ts, gs, b2t - W, b2t - 1e-4)
    post2 = seg_speeds(ts, gs, b2t + 1e-4, b2t + W)

    def spd(seg):
        if seg is None or len(seg[1]) == 0:
            return np.nan
        return float(np.median(seg[1]))
    f["pre1_speed"] = spd(pre1)
    f["post1_speed"] = spd(post1)
    f["pre2_speed"] = spd(pre2)
    f["post2_speed"] = spd(post2)
    f["ratio1"] = f["post1_speed"] / f["pre1_speed"] if f["pre1_speed"] and not np.isnan(f["pre1_speed"]) else np.nan
    f["ratio2"] = f["post2_speed"] / f["pre2_speed"] if f["pre2_speed"] and not np.isnan(f["pre2_speed"]) else np.nan

    # apparent deceleration into the bounce: hop is ballistic; mean hop
    # ground speed vs speed near its apex encodes arc height (parallax).
    mid = seg_speeds(ts, gs, b1t + hop_t * 0.3, b1t + hop_t * 0.7)
    f["hop_mid_speed"] = spd(mid)
    f["hop_shape"] = f["hop_mid_speed"] / f["hop_speed"] if f["hop_speed"] else np.nan

    # heading changes (sidespin: flight curvature; corkscrew: bounce kick)
    h_pre1 = heading(ts, gs, b1t - W, b1t)
    h_post1 = heading(ts, gs, b1t, b1t + W)
    h_pre2 = heading(ts, gs, b2t - W, b2t)
    h_post2 = heading(ts, gs, b2t, b2t + W)
    # heading differences and signed curvature are already travel-relative
    # (left-of-travel positive) — do NOT flip by serve direction.
    def dh(a, b):
        if a is None or b is None:
            return np.nan
        d = b - a
        while d > np.pi: d -= 2 * np.pi
        while d < -np.pi: d += 2 * np.pi
        return float(d)
    f["kick1"] = dh(h_pre1, h_post1)
    f["kick2"] = dh(h_pre2, h_post2)

    # flight curvature of the hop (sidespin Magnus), signed left-of-travel
    c_hop = curvature_signed(ts, gs, b1t + 0.02, b2t - 0.02)
    f["curv_hop"] = c_hop if c_hop is not None else np.nan
    c_post2 = curvature_signed(ts, gs, b2t + 0.02, b2t + 0.45)
    f["curv_post2"] = c_post2 if c_post2 is not None else np.nan

    # timing: fraction of hop time to reach the ground-track midpoint of
    # the hop (asymmetric under drag/Magnus)
    m = (ts >= b1t) & (ts <= b2t)
    if m.sum() >= 3:
        g = gs[m]; t = ts[m]
        prog = np.linalg.norm(g - b1, axis=1) / max(hop_len, 1e-6)
        i = np.searchsorted(prog, 0.5)
        if 0 < i < len(t):
            f["hop_t50"] = float((t[i] - b1t) / max(hop_t, 1e-6))
        else:
            f["hop_t50"] = np.nan
    else:
        f["hop_t50"] = np.nan

    f["n_pre1"] = 0 if pre1 is None else len(pre1[1])
    f["n_hop"] = int(((ts > b1t) & (ts < b2t)).sum())

    # physics-informed: subtract predictable height parallax from the
    # hop's ground track (camera pose from H, ballistic apex from T)
    pc = parallax_corrected_hop(rec, ts, gs)
    if pc is not None:
        f["hop_k_extra"] = pc["k_extra"]     # lift residual (backspin +)
        f["hop_c_curv"] = pc["c_curv"]       # left-of-travel positive
        f["hop_curv_corr"] = pc["curv_corr"]
        f["hop_drift_corr"] = pc["drift_corr"]
        f["hop_fit_resid"] = pc["resid"]
    else:
        f["hop_k_extra"] = np.nan
        f["hop_c_curv"] = np.nan
        f["hop_curv_corr"] = np.nan
        f["hop_drift_corr"] = np.nan
        f["hop_fit_resid"] = np.nan
    return f

FEATURE_ORDER = ["hop_len", "hop_t", "hop_speed", "pre1_speed", "post1_speed",
                 "pre2_speed", "post2_speed", "ratio1", "ratio2",
                 "hop_mid_speed", "hop_shape", "kick1", "kick2",
                 "curv_hop", "curv_post2", "hop_t50", "n_pre1", "n_hop",
                 "hop_k_extra", "hop_c_curv", "hop_curv_corr",
                 "hop_drift_corr", "hop_fit_resid"]

def matrix(recs):
    X, rows = [], []
    for r in recs:
        f = extract(r)
        X.append([f[k] for k in FEATURE_ORDER])
        rows.append(f)
    return np.array(X, float), rows
