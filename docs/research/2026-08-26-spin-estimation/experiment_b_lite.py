"""Experiment B lite: same monocular physics-inverse fit, tighter
compute budget (coarser integration, capped iterations, 2 starts) so a
40-sample statistic lands in minutes."""
import json
import sys
import numpy as np
from scipy.optimize import least_squares
import experiment_b as B
import sim

def resim_fast(params, t_span, dt=4.5e-3):
    return sim.simulate(params[0:3], params[3:6], params[6:9],
                        t_max=t_span, dt=dt)
B.resim = resim_fast

def fit_lite(rec, rng):
    cam = sim.camera_from_H(np.array(rec["H"]), rec["cam"]["fx"])
    t_ref = rec["obs"][0]["t"]
    fn = B.make_residual(rec, cam, t_ref)
    x0 = B.init_guess(rec, t_ref)
    starts = [x0]
    x1 = x0.copy(); x1[6:9] = rng.normal(0, 250, 3)
    starts.append(x1)
    best = None
    for s in starts:
        try:
            r = least_squares(fn, s, method="lm", max_nfev=140)
        except Exception:
            continue
        if best is None or r.cost < best.cost:
            best = r
    return best

def main(n=40):
    recs = json.load(open("out/serves.json"))
    rng = np.random.default_rng(3)
    idx = rng.permutation(len(recs))[:n]
    rows = []
    for k, i in enumerate(idx):
        rec = recs[i]
        best = fit_lite(rec, rng)
        if best is None:
            continue
        w_fit = best.x[6:9]
        w_true = np.array(rec["w_true"])
        hop = np.array([rec["b2"]["x"] - rec["b1"]["x"],
                        rec["b2"]["y"] - rec["b1"]["y"]])
        heading = np.arctan2(hop[1], hop[0])
        tb_f, sd_f, mag_f = B.spin_class_from_w(w_fit, heading)
        tb_t, sd_t, mag_t = B.spin_class_from_w(w_true, heading)
        L = rec["labels"]
        rows.append(dict(tb_true=L["topback"], sd_true=L["side"],
                         mag_true=L["mag_rps"], tb_fit=tb_f, sd_fit=sd_f,
                         mag_fit=mag_f, w_true=w_true.tolist(),
                         w_fit=w_fit.tolist(), cost=float(best.cost)))
        print(f"  {k+1}/{n}", flush=True)
    tb_ok = np.mean([r["tb_true"] == r["tb_fit"] for r in rows])
    sd_ok = np.mean([r["sd_true"] == r["sd_fit"] for r in rows])
    print(f"\nn = {len(rows)}")
    print(f"top/back from fitted w: {tb_ok:.3f}")
    print(f"side from fitted w:     {sd_ok:.3f}")
    spun = [r for r in rows if r["mag_true"] > 12]
    rel = [abs(r["mag_fit"] - r["mag_true"]) / r["mag_true"] for r in spun]
    print(f"|w| relative error: median {np.median(rel):.2f}")
    json.dump(rows, open("out/expB_lite.json", "w"))

if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 40)
