"""Experiment B: monocular physics-inverse fit.

For each simulated serve: given the 30 fps pixel observations, the
camera (granted: in production the quad + assumed iPhone intrinsics give
this), and the two bounce events, fit 9 parameters (p0, v0, w) of the
forward physics model by least-squares reprojection error. Score how
well the fitted spin vector recovers the true one.

This answers: is the spin vector *identifiable* from one camera at
30 fps, when the physics model is exactly right? (Real life is harder:
model mismatch, calibration error. This is the upper bound for the
inverse-physics route.)
"""
import json
import sys
import numpy as np
from scipy.optimize import least_squares
from sim import simulate, camera_from_H, TABLE_L, TABLE_W

def resim(params, t_span, dt=3e-3):
    p0 = params[0:3]; v0 = params[3:6]; w = params[6:9]
    return simulate(p0, v0, w, t_max=t_span, dt=dt)

def make_residual(rec, cam, t_ref):
    obs_t = np.array([o["t"] for o in rec["obs"]]) - t_ref
    obs_px = np.array([o["px"] for o in rec["obs"]])
    m = obs_t >= 0
    obs_t, obs_px = obs_t[m], obs_px[m]
    t_span = obs_t[-1] + 0.05
    b1 = rec["b1"]; b2 = rec["b2"]
    b1_t = b1["t"] - t_ref; b2_t = b2["t"] - t_ref

    def fn(params):
        tr = resim(params, t_span)
        res = []
        # reprojection residuals (sigma 2.5 px)
        for t, px in zip(obs_t, obs_px):
            i = min(np.searchsorted(tr["t"], t), len(tr["t"]) - 1)
            pred = cam.project(tr["p"][i])
            if pred is None:
                res.extend([25.0, 25.0])
            else:
                res.extend(((pred - px) / 2.5).tolist())
        # bounce residuals: position (sigma 4 cm), time (sigma 12 ms)
        bl = [b for b in tr["bounces"]]
        for want, have in zip([(b1_t, b1["x"], b1["y"]), (b2_t, b2["x"], b2["y"])],
                              bl[:2]):
            res.append((have["t"] - want[0]) / 0.012)
            res.append((have["x"] - want[1]) / 0.04)
            res.append((have["y"] - want[2]) / 0.04)
        while len(bl) < 2:
            res.extend([50.0, 50.0, 50.0])
            bl.append(None)
        return np.array(res)
    return fn

def init_guess(rec, t_ref):
    """Crude start: table-plane ground track velocity + fixed height."""
    Hinv = np.linalg.inv(np.array(rec["H"]))
    def g(px):
        q = Hinv @ np.array([px[0], px[1], 1.0])
        return q[:2] / q[2]
    obs = [o for o in rec["obs"] if o["t"] >= t_ref]
    g0, g1 = g(obs[0]["px"]), g(obs[2]["px"])
    dt = obs[2]["t"] - obs[0]["t"]
    v_xy = (g1 - g0) / max(dt, 1e-3)
    p0 = np.array([g0[0], g0[1], 0.30])
    v0 = np.array([v_xy[0], v_xy[1], -0.5])
    return np.concatenate([p0, v0, np.zeros(3)])

def fit_one(rec, n_starts=2, rng=None, fx_scale=1.0):
    rng = rng or np.random.default_rng(0)
    cam = camera_from_H(np.array(rec["H"]), rec["cam"]["fx"] * fx_scale)
    t_ref = rec["obs"][0]["t"]
    fn = make_residual(rec, cam, t_ref)
    best = None
    x0 = init_guess(rec, t_ref)
    starts = [x0]
    for _ in range(n_starts - 1):
        x = x0.copy()
        x[6:9] = rng.normal(0, 250, 3)   # random spin start (rad/s)
        starts.append(x)
    for s in starts:
        try:
            r = least_squares(fn, s, method="lm", max_nfev=400)
        except Exception:
            continue
        if best is None or r.cost < best.cost:
            best = r
    return best, cam, t_ref

RPS = 2 * np.pi

def spin_class_from_w(w, serve_heading):
    """Map a spin vector to (topback, side) labels using flight frame."""
    c, s = np.cos(serve_heading), np.sin(serve_heading)
    # left-of-flight unit vector
    left = np.array([-s, c, 0.0])
    w_tb = w @ left                      # + = topspin
    w_sd = w[2]                          # + = L sidespin
    mag = np.linalg.norm(w) / RPS
    tb = "top" if w_tb > 12 * RPS else ("back" if w_tb < -12 * RPS else "none")
    sd = "L" if w_sd > 12 * RPS else ("R" if w_sd < -12 * RPS else "none")
    return tb, sd, mag

def main(path, n=150, seed=3):
    recs = json.load(open(path))
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(recs))[:n]
    rows = []
    for k, i in enumerate(idx):
        rec = recs[i]
        # verify the H-recovered camera reproduces stored pixels
        cam = camera_from_H(np.array(rec["H"]), rec["cam"]["fx"])
        o0 = rec["obs"][0]
        pred = cam.project(np.array(o0["p_true"]))
        cam_ok = pred is not None and np.linalg.norm(pred - np.array(o0["px"])) < 12
        if not cam_ok:
            continue
        best, cam, t_ref = fit_one(rec, rng=rng)
        if best is None:
            continue
        w_fit = best.x[6:9]
        w_true = np.array(rec["w_true"])
        hop = np.array([rec["b2"]["x"] - rec["b1"]["x"],
                        rec["b2"]["y"] - rec["b1"]["y"]])
        heading = np.arctan2(hop[1], hop[0])
        tb_f, sd_f, mag_f = spin_class_from_w(w_fit, heading)
        tb_t, sd_t, mag_t = spin_class_from_w(w_true, heading)
        L = rec["labels"]
        rows.append(dict(
            tb_true=L["topback"], sd_true=L["side"], mag_true=L["mag_rps"],
            tb_fit=tb_f, sd_fit=sd_f, mag_fit=mag_f,
            w_true=w_true.tolist(), w_fit=w_fit.tolist(),
            cost=float(best.cost)))
        if (k + 1) % 20 == 0:
            print(f"  fitted {k+1}/{n}", flush=True)
    json.dump(rows, open("out/expB_fits.json", "w"))
    # report
    tb_ok = np.mean([r["tb_true"] == r["tb_fit"] for r in rows])
    sd_ok = np.mean([r["sd_true"] == r["sd_fit"] for r in rows])
    print(f"\nn fitted = {len(rows)}")
    print(f"top/back class from fitted w: {tb_ok:.3f}")
    print(f"side class from fitted w:     {sd_ok:.3f}")
    spun = [r for r in rows if r["mag_true"] > 12]
    if spun:
        rel = [abs(r["mag_fit"] - r["mag_true"]) / r["mag_true"] for r in spun]
        print(f"|w| relative error (spun serves): median {np.median(rel):.2f}")
        ax_err = []
        for r in spun:
            a = np.array(r["w_true"]); b = np.array(r["w_fit"])
            if np.linalg.norm(b) > 1:
                cosang = a @ b / (np.linalg.norm(a) * np.linalg.norm(b))
                ax_err.append(np.degrees(np.arccos(np.clip(cosang, -1, 1))))
        print(f"spin axis error: median {np.median(ax_err):.0f} deg")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/serves.json",
         n=int(sys.argv[2]) if len(sys.argv) > 2 else 150)
