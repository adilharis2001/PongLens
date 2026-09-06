"""The honest ceiling: everything audio knows, combined, judged on the product's terms.

Separate features were tried one at a time and the best single one — the
mean onset strength in the 10 kHz band, measured against a thirty-second
reference — reached AUC 0.82 pooled. This asks what happens when all of it
is used at once: the loudness statistics, the spacing of the knocks, the
periodicity, and the ball-versus-room classifier's opinion of every knock
in the window.

Trained leave-one-match-out, so no match ever grades itself, and reported
as the operating curve rather than as an AUC. The operating curve is the
only form the product can read: with 99% of rally seconds kept — and
keeping them is not negotiable, because a clip that loses the end of a
point is worse than one with a second of dead air — how much of the time
between points can be dropped?
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
from soundclass import fit_logistic, predict, FEATS
import inplay as IP

WIN_S = 2.0
HOP_S = 0.25
SHRINK = 0.6
SLUGS = ["cebaa6d4", "c27e196d", "d59d7610", "9e15ed10"]
PEAKS = json.load(open("/Users/adil/ponglens-research-work/peaks_cache.json"))


def ball_scores(slug):
    """Every peak in this match with a leave-one-out ball-likeness score."""
    if slug not in PEAKS:
        return None
    rows = PEAKS[slug]["rows"]
    train = [r for s, d in PEAKS.items() if s != slug for r in d["rows"]
             if r["label"] >= 0]
    m = fit_logistic([[r[k] for k in FEATS] for r in train],
                     [r["label"] for r in train])
    s = predict(m, [[r[k] for k in FEATS] for r in rows])
    return np.array([r["t"] for r in rows]), np.array([r["z"] for r in rows]), s


def window_features(env, pt, pz, ps, t0, t1):
    f = IP.describe(env, t0, t1)
    if f is None:
        return None
    m = (pt >= t0) & (pt < t1)
    span = t1 - t0
    s = ps[m]
    f["ball_rate"] = float(len(s) / span)
    f["ball_sum"] = float(s.sum() / span)
    f["ball_max"] = float(s.max()) if len(s) else 0.0
    f["ball_mean"] = float(s.mean()) if len(s) else 0.0
    f["ball_n50"] = float((s > 0.5).sum() / span)
    f["ball_n80"] = float((s > 0.8).sum() / span)
    f["loud_ball"] = float((pz[m] * s).sum() / span) if len(s) else 0.0
    return f


def main():
    per = {}
    for slug in SLUGS:
        doc = CO.load(slug)
        bs = ball_scores(slug)
        if doc is None or not doc["wav"] or bs is None:
            print(f"{slug}: skipped"); continue
        pt, pz, ps = bs
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        key = ("start_source_s", "end_source_s")
        spans = sorted((float(b[key[0]]), float(b[key[1]])) for b in doc["boundaries"]
                       if not b.get("deleted") and b.get(key[0]) is not None)
        wins = []
        for s0, e0 in spans:
            t = s0 + SHRINK
            while t + WIN_S <= e0 - SHRINK:
                wins.append((t, t + WIN_S, 1)); t += HOP_S
        for (a0, b0), (a1, b1) in zip(spans, spans[1:]):
            t = b0 + SHRINK
            while t + WIN_S <= a1 - SHRINK:
                wins.append((t, t + WIN_S, 0)); t += HOP_S
        rows = []
        for t0, t1, lab in wins:
            f = window_features(env, pt, pz, ps, t0, t1)
            if f is None:
                continue
            rows.append({"lab": lab, "t0": t0, **f})
        per[slug] = {"rows": rows, "venue": doc["match"]["venue"]}
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} "
              f"{sum(1 for r in rows if r['lab']==1)} rally windows, "
              f"{sum(1 for r in rows if r['lab']==0)} gap windows", flush=True)

    keys = [k for k in per[SLUGS[0]]["rows"][0] if k not in ("lab", "t0")
            and all(np.isfinite([r[k] for d in per.values() for r in d["rows"]]))]
    print(f"\n{len(keys)} features")
    print("\n=== leave-one-match-out, pooled operating curve ===")
    S, L, V = [], [], []
    for held, d in per.items():
        train = [r for s, dd in per.items() if s != held for r in dd["rows"]]
        m = fit_logistic([[r[k] for k in keys] for r in train],
                         [r["lab"] for r in train], iters=600)
        s = predict(m, [[r[k] for k in keys] for r in d["rows"]])
        S.append(s); L.append(np.array([r["lab"] for r in d["rows"]]))
        V.extend([d["venue"]] * len(s))
        pos, neg = s[L[-1] == 1], s[L[-1] == 0]
        print(f"  {held} {str(d['venue'])[:12]:12s} AUC {AC.auc(pos, neg):.3f}   "
              f"gap dropped at 99% rally kept "
              f"{np.mean(neg < np.quantile(pos, 0.01))*100:5.1f}%   "
              f"at 95% {np.mean(neg < np.quantile(pos, 0.05))*100:5.1f}%")
    S = np.concatenate(S); L = np.concatenate(L); V = np.array(V)
    pos, neg = S[L == 1], S[L == 0]
    print(f"\n  pooled AUC {AC.auc(pos, neg):.3f}")
    print("  rally kept   gap dropped")
    for target in (0.995, 0.99, 0.98, 0.95, 0.90, 0.85, 0.80):
        th = np.quantile(pos, 1 - target)
        print(f"     {target*100:5.1f}%     {np.mean(neg < th)*100:6.1f}%")
    print("\n  by venue, at 99% rally kept overall")
    th = np.quantile(pos, 0.01)
    for venue in sorted(set(V)):
        m = V == venue
        p, n = S[m & (L == 1)], S[m & (L == 0)]
        print(f"    {str(venue)[:14]:14s} rally kept {np.mean(p >= th)*100:5.1f}%   "
              f"gap dropped {np.mean(n < th)*100:5.1f}%")
    print("\n  best single features (pooled AUC)")
    for k in sorted(keys, key=lambda k: -abs(AC.auc(
            [r[k] for d in per.values() for r in d["rows"] if r["lab"] == 1],
            [r[k] for d in per.values() for r in d["rows"] if r["lab"] == 0]) - 0.5))[:8]:
        a = AC.auc([r[k] for d in per.values() for r in d["rows"] if r["lab"] == 1],
                   [r[k] for d in per.values() for r in d["rows"] if r["lab"] == 0])
        print(f"    {k:22s} {a:.3f}")


if __name__ == "__main__":
    main()
