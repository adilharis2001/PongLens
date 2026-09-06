"""The dead space that actually costs: the pad inside a kept clip.

The assembler already throws away the long break between points. What
survives into the cut is each point's card, and a card is deliberately
generous at both ends — it opens before the serve and runs past the point.
The project's own note on dead space calls that Kind 3 and puts it at 29%
of everything kept, with a serve detector named as the blocker.

So the evaluation here is restricted to seconds that are INSIDE a card,
and asks only about those: labelled rally where Adil's taps say a point
was running, and dead where they say it was not. Dropping a second that
the product already drops is worth nothing, and every earlier version of
this measurement was quietly taking credit for exactly that.

The bar is deliberately lopsided. Losing a second of rally is a visible
defect — the clip cuts off the end of the point — while leaving a second
of dead air in is merely untidy. So the curve is read at 99% of rally
kept, not at the balanced point.
"""
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
from soundclass import fit_logistic, predict, FEATS
import inplay as IP
from ceiling import ball_scores, window_features, WIN_S, HOP_S, SHRINK

SLUGS = ["cebaa6d4", "d59d7610", "9e15ed10"]


def main():
    per = {}
    for slug in SLUGS:
        doc = CO.load(slug)
        bs = ball_scores(slug)
        if doc is None or not doc["wav"] or bs is None:
            continue
        pt, pz, ps = bs
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        spans = sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                       for b in doc["boundaries"] if not b.get("deleted")
                       and b.get("start_source_s") is not None)
        cards = sorted((float(p["t0"]), float(p["t1"])) for p in doc["points"]
                       if not p["deleted"] and p["t0"] is not None)
        rows, kept_s, dead_s = [], 0.0, 0.0
        for c0, c1 in cards:
            t = c0
            while t + WIN_S <= c1:
                mid = t + WIN_S / 2
                inrally = any(a + SHRINK <= mid <= b - SHRINK for a, b in spans)
                indead = not any(a - SHRINK <= mid <= b + SHRINK for a, b in spans)
                if inrally or indead:
                    f = window_features(env, pt, pz, ps, t, t + WIN_S)
                    if f is not None:
                        rows.append({"lab": 1 if inrally else 0, "t0": t, **f})
                t += HOP_S
            kept_s += c1 - c0
            dead_s += (c1 - c0) - sum(max(0.0, min(c1, b) - max(c0, a))
                                      for a, b in spans)
        per[slug] = {"rows": rows, "venue": doc["match"]["venue"],
                     "kept": kept_s, "dead": dead_s}
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} "
              f"cards hold {kept_s:5.0f}s, of which {dead_s:5.0f}s "
              f"({dead_s/kept_s*100:.0f}%) is outside any point   "
              f"[{sum(1 for r in rows if r['lab']==1)} rally / "
              f"{sum(1 for r in rows if r['lab']==0)} dead windows]", flush=True)

    keys = [k for k in per[SLUGS[0]]["rows"][0] if k not in ("lab", "t0")
            and all(np.isfinite([r[k] for d in per.values() for r in d["rows"]]))]
    print(f"\n=== leave-one-match-out, INSIDE the kept clips only ===")
    S, L, V = [], [], []
    for held, d in per.items():
        train = [r for s, dd in per.items() if s != held for r in dd["rows"]]
        m = fit_logistic([[r[k] for k in keys] for r in train],
                         [r["lab"] for r in train], iters=600)
        s = predict(m, [[r[k] for k in keys] for r in d["rows"]])
        lab = np.array([r["lab"] for r in d["rows"]])
        S.append(s); L.append(lab); V.extend([d["venue"]] * len(s))
        pos, neg = s[lab == 1], s[lab == 0]
        print(f"  {held} {str(d['venue'])[:12]:12s} AUC {AC.auc(pos, neg):.3f}   "
              f"pad dropped at 99% rally kept {np.mean(neg < np.quantile(pos, 0.01))*100:5.1f}%"
              f"   at 95% {np.mean(neg < np.quantile(pos, 0.05))*100:5.1f}%")
    S = np.concatenate(S); L = np.concatenate(L); V = np.array(V)
    pos, neg = S[L == 1], S[L == 0]
    print(f"\n  pooled AUC {AC.auc(pos, neg):.3f}")
    print("  rally kept   pad dropped   footage saved (of everything kept today)")
    dead_share = sum(d["dead"] for d in per.values()) / sum(d["kept"] for d in per.values())
    for target in (0.995, 0.99, 0.98, 0.95, 0.90):
        th = np.quantile(pos, 1 - target)
        drop = float(np.mean(neg < th))
        print(f"     {target*100:5.1f}%      {drop*100:6.1f}%          "
              f"{drop*dead_share*100:5.1f}%")
    print("\n  per-match self-calibrated threshold (no labels: each match's own")
    print("  score distribution split at the valley between its two humps)")
    off = 0
    for held, d in per.items():
        n = len(d["rows"]); s = S[off:off+n]; lab = L[off:off+n]; off += n
        hist, edges = np.histogram(s, bins=40, range=(0, 1))
        mid = (edges[:-1] + edges[1:]) / 2
        # Otsu: the split that most separates the two sides of the histogram
        w = np.cumsum(hist) / max(hist.sum(), 1)
        mu = np.cumsum(hist * mid) / max(hist.sum(), 1)
        muT = mu[-1]
        var = (muT * w - mu) ** 2 / np.maximum(w * (1 - w), 1e-9)
        th = mid[int(np.argmax(var))]
        print(f"    {held} {str(d['venue'])[:12]:12s} threshold {th:.2f}   "
              f"rally kept {np.mean(s[lab==1] >= th)*100:5.1f}%   "
              f"pad dropped {np.mean(s[lab==0] < th)*100:5.1f}%")


if __name__ == "__main__":
    main()
