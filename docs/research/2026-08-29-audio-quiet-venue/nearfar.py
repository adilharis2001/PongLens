"""Can the sound alone say which HALF of the table the ball bounced on?

The phone stands in one place. The far end of the table is 2.74 m further
from it than the near end, so every bounce over there is quieter, duller
and more reverberant than the same bounce over here. If that difference is
measurable, audio gives an independent read of which half a ball landed
on — which is the serve rule the placement checklist already asks
(`serve_first_bounce_on_receiver_half`), and, more importantly, it is a
read that does not care where the camera is standing. End-on footage,
where the table is foreshortened into a sliver and vision struggles,
sounds exactly the same as side-on footage.

Ground truth is the shipped pipeline's own v3 placement: every bounce it
projected onto the table carries a `v` coordinate along the table's length
(0 at the near end line, 2.74 at the far one), so near and far are simply
either side of 1.37.

Reported as AUC — the chance that a randomly chosen far bounce scores
higher than a randomly chosen near one. 0.50 is a coin flip. Everything is
measured WITHIN a match, because level and timbre differ between rooms and
between phones and pooling would manufacture a result out of that.
"""
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC
import corpus as CO

FEATURES = ["snr_db", "peak_db", "decay_early_db", "decay_late_db", "tail_ratio",
            "centroid_hz", "b_low", "b_mid", "b_high", "b_vhigh", "b_top",
            "bright", "hf_lf", "rise_db"]


def run(slug, min_vis=0.7, min_rise=0.0):
    doc = CO.load(slug)
    if doc is None or not doc["wav"]:
        return None
    samples, rate = AC.read_wav(doc["wav"])
    evs = CO.bounces(doc, min_vis=min_vis)
    rows = []
    for ev in evs:
        f = AC.features_at(samples, rate, ev["ta"])
        if f is None or f["rise_db"] < min_rise:
            continue
        rows.append((float(ev["v"]), float(ev["u"]), f))
    if len(rows) < 40:
        return {"slug": slug, "n": len(rows), "venue": doc["match"]["venue"],
                "opponent": doc["match"]["opponent_name"], "thin": True}
    near = [f for v, u, f in rows if v < CO.NET_V]
    far = [f for v, u, f in rows if v >= CO.NET_V]
    out = {"slug": slug, "venue": doc["match"]["venue"], "clock": doc["clock"],
           "opponent": doc["match"]["opponent_name"], "user_side": doc["match"]["user_side"],
           "n": len(rows), "n_near": len(near), "n_far": len(far), "auc": {}, "mean": {}}
    for key in FEATURES:
        out["auc"][key] = AC.auc([f[key] for f in near], [f[key] for f in far])
        out["mean"][key] = [float(np.median([f[key] for f in near])),
                            float(np.median([f[key] for f in far]))]
    out["rows"] = [{"v": v, "u": u, **{k: fe[k] for k in FEATURES}} for v, u, fe in rows]
    return out


def main():
    slugs = sys.argv[2:] or CO.all_slugs()
    results = []
    for slug in slugs:
        r = run(slug)
        if r is None:
            print(f"{slug}: no audio"); continue
        if r.get("thin"):
            print(f"{slug}: only {r['n']} usable bounces"); continue
        results.append(r)
        top = sorted(r["auc"].items(), key=lambda kv: -abs(kv[1] - 0.5))[:4]
        print(f"{slug} {str(r['venue'])[:16]:16s} {str(r['opponent'])[:10]:10s} "
              f"n={r['n']:4d} (near {r['n_near']:4d} / far {r['n_far']:4d})  " +
              "  ".join(f"{k} {v:.3f}" for k, v in top), flush=True)
    json.dump(results, open(sys.argv[1], "w"))
    if results:
        print("\n=== AUC by feature, median across matches (0.50 = chance) ===")
        for key in FEATURES:
            vals = [r["auc"][key] for r in results if np.isfinite(r["auc"][key])]
            print("  %-14s median %.3f   range %.3f..%.3f" %
                  (key, float(np.median(vals)), min(vals), max(vals)))


if __name__ == "__main__":
    main()
