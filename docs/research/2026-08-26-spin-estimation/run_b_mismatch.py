"""Experiment B robustness: fit with deliberately wrong physics and
camera — the data was generated with (ez=0.90, mu=0.25, Cl slope 0.60,
kD=0.112, true fx); fit believing (ez=0.86, mu=0.32, Cl slope 0.50,
kD 10% low, fx 8% high). This is the honest version of the inverse-
physics route: in production none of these are known exactly."""
import json
import numpy as np
import sim
import experiment_b as B

# wrong beliefs
sim.EZ = 0.86
sim.MU = 0.32
sim.CL_SLOPE = 0.50
sim.KD = sim.KD * 0.90

def main():
    recs = json.load(open("out/serves.json"))
    rng = np.random.default_rng(11)
    idx = rng.permutation(len(recs))[:60]
    rows = []
    for k, i in enumerate(idx):
        rec = recs[i]
        best, cam, t_ref = B.fit_one(rec, rng=rng, fx_scale=1.08)
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
                         mag_fit=mag_f))
        if (k + 1) % 20 == 0:
            print(f"  fitted {k+1}/60", flush=True)
    tb_ok = np.mean([r["tb_true"] == r["tb_fit"] for r in rows])
    sd_ok = np.mean([r["sd_true"] == r["sd_fit"] for r in rows])
    print(f"n = {len(rows)} (wrong physics + wrong focal)")
    print(f"top/back class: {tb_ok:.3f}")
    print(f"side class:     {sd_ok:.3f}")
    json.dump(rows, open("out/expB_mismatch.json", "w"))

if __name__ == "__main__":
    main()
