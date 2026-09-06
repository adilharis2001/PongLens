"""Does a serve have a shape in the audio that nothing else has?

A serve is the one stroke with two bounces and no bat between them: the
ball is struck, lands on the server's own half, crosses, lands on the
receiver's half, and only then is it hit again. In the timing of the
knocks that should read as a distinctive little figure — a strike, then
two closely spaced landings, then a longer wait — which is a claim about
PATTERN rather than about loudness, and so it is not answered by anything
measured so far.

Three places are compared, all inside the same recordings:

  serve   — the twelve knocks around Adil's own serve tap
  rally   — a moment at least two seconds into a point
  pad     — a moment inside a card but outside any point, which is where
            the server bounces the ball before serving and where the loose
            ball rolls afterwards

The pad comparison is the one that matters. Telling a serve from mid-rally
is not useful on its own; the product already knows roughly where cards
are. Telling a serve from the second before it is the whole job.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
from soundclass import fit_logistic, predict, FEATS
from ceiling import ball_scores

SLUGS = ["cebaa6d4", "d59d7610", "9e15ed10"]
K = 6            # knocks either side of the anchor


def figure(pt, pz, ps, t):
    """The local pattern of knocks around an instant, as numbers."""
    i = int(np.searchsorted(pt, t))
    a, b = i - K, i + K
    if a < 1 or b >= len(pt) - 1:
        return None
    win = pt[a:b] - t
    gaps = np.diff(pt[a:b])
    f = {}
    for j, g in enumerate(gaps):
        f[f"gap{j}"] = float(g)
    for j, w in enumerate(win):
        f[f"t{j}"] = float(w)
    for j in range(len(win)):
        f[f"z{j}"] = float(pz[a + j])
        f[f"b{j}"] = float(ps[a + j])
    nxt = pt[pt > t][:4] - t
    prv = t - pt[pt < t][-4:][::-1]
    f["next1"] = float(nxt[0]) if len(nxt) > 0 else 9.0
    f["next2"] = float(nxt[1]) if len(nxt) > 1 else 9.0
    f["prev1"] = float(prv[0]) if len(prv) > 0 else 9.0
    f["prev2"] = float(prv[1]) if len(prv) > 1 else 9.0
    f["dens_before"] = float(np.sum((pt > t - 2) & (pt <= t)) / 2)
    f["dens_after"] = float(np.sum((pt > t) & (pt <= t + 2)) / 2)
    f["ball_before"] = float(np.sum(ps[(pt > t - 2) & (pt <= t)]) / 2)
    f["ball_after"] = float(np.sum(ps[(pt > t) & (pt <= t + 2)]) / 2)
    return f


def main():
    per = {}
    rng = np.random.default_rng(7)
    for slug in SLUGS:
        doc = CO.load(slug)
        bs = ball_scores(slug)
        if doc is None or bs is None:
            continue
        pt, pz, ps = bs
        spans = sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                       for b in doc["boundaries"] if not b.get("deleted")
                       and b.get("start_source_s") is not None)
        cards = sorted((float(p["t0"]), float(p["t1"])) for p in doc["points"]
                       if not p["deleted"] and p["t0"] is not None)
        rows = []
        for s, e in spans:
            f = figure(pt, pz, ps, s)
            if f: rows.append({"cls": "serve", **f})
            if e - s > 4.0:
                f = figure(pt, pz, ps, rng.uniform(s + 2.0, e - 1.0))
                if f: rows.append({"cls": "rally", **f})
        for c0, c1 in cards:
            for _ in range(2):
                t = rng.uniform(c0, c1)
                if any(a - 0.6 <= t <= b + 0.6 for a, b in spans):
                    continue
                f = figure(pt, pz, ps, t)
                if f: rows.append({"cls": "pad", **f})
        per[slug] = {"rows": rows, "venue": doc["match"]["venue"]}
        n = defaultdict(int)
        for r in rows: n[r["cls"]] += 1
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} "
              f"serves {n['serve']:3d}  mid-rally {n['rally']:3d}  pad {n['pad']:3d}",
              flush=True)

    keys = [k for k in per[SLUGS[0]]["rows"][0] if k != "cls"]
    for other in ("rally", "pad"):
        print(f"\n=== serve vs {other}, leave-one-match-out ===")
        S, L = [], []
        for held, d in per.items():
            train = [r for s, dd in per.items() if s != held for r in dd["rows"]
                     if r["cls"] in ("serve", other)]
            test = [r for r in d["rows"] if r["cls"] in ("serve", other)]
            if len(train) < 100 or len(test) < 30:
                continue
            m = fit_logistic([[r[k] for k in keys] for r in train],
                             [1.0 if r["cls"] == "serve" else 0.0 for r in train],
                             iters=600, l2=3e-2)
            s = predict(m, [[r[k] for k in keys] for r in test])
            lab = np.array([1 if r["cls"] == "serve" else 0 for r in test])
            S.append(s); L.append(lab)
            print(f"  {held} {str(d['venue'])[:12]:12s} "
                  f"AUC {AC.auc(s[lab == 1], s[lab == 0]):.3f}")
        S, L = np.concatenate(S), np.concatenate(L)
        print(f"  pooled AUC {AC.auc(S[L == 1], S[L == 0]):.3f}")


if __name__ == "__main__":
    main()
