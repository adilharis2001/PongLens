"""Does a knock SOUND like this table's ball, or like the room?

Audio reports about three knocks a second during a rally; the shipped
vision pipeline reports about one and a half. So either audio is half
noise, or vision is missing half the events. Every earlier study assumed
the first without testing it, and used vision as the arbiter — which
cannot distinguish "audio was wrong" from "vision did not see it".

This settles it without any new ground truth, using two sets of knocks
whose identity is not in doubt:

  YES — an audio peak sitting within 45 ms of a bounce or contact that
        vision projected onto the table with high confidence, inside a
        rally. That is this table's ball, seen and heard.
  NO  — an audio peak in the space BETWEEN two point cards. Nobody at this
        table is rallying there, so whatever made the sound, it was not
        our ball in play.

A small logistic regression on the acoustic description of each knock
learns the difference, trained leave-one-match-out so no match ever grades
itself. Then it is asked about the knocks nobody can label: the ones
during a rally that vision did not account for. If those score like the
YES pile, vision is the incomplete one and audio is carrying real events.
If they score like the NO pile, audio really is mostly room.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN

TOL = 0.045
MIN_VIS = 0.7
GAP_SHRINK = 1.5
Z_ON = 5.0
FEATS = ["snr_db", "peak_db", "decay_early_db", "decay_late_db", "tail_ratio",
         "centroid_hz", "b_low", "b_mid", "b_high", "b_vhigh", "b_top",
         "bright", "hf_lf", "rise_db", "z"]


def fit_logistic(X, y, iters=400, lr=0.4, l2=1e-3):
    X = np.asarray(X, float); y = np.asarray(y, float)
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    Z = np.hstack([Z, np.ones((len(Z), 1))])
    w = np.zeros(Z.shape[1])
    # class weights, because the two piles are not the same size
    cw = np.where(y > 0.5, 1.0 / max(y.sum(), 1), 1.0 / max((1 - y).sum(), 1))
    cw = cw / cw.mean()
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        g = Z.T @ ((p - y) * cw) / len(Z) + l2 * np.r_[w[:-1], 0.0]
        w -= lr * g * 20
    return {"w": w, "mu": mu, "sd": sd}


def predict(model, X):
    Z = (np.asarray(X, float) - model["mu"]) / model["sd"]
    Z = np.hstack([Z, np.ones((len(Z), 1))])
    return 1 / (1 + np.exp(-Z @ model["w"]))


def gather(slug):
    doc = CO.load(slug)
    if doc is None or not doc["wav"] or doc["clock"] != "source":
        return None
    samples, rate = AC.read_wav(doc["wav"])
    env = EN.envelopes(samples, rate)
    t, z = env["times"], env["high"]["z"]
    idx = EN.peaks(z, rate, Z_ON)
    pt, pz = t[idx], z[idx]

    cards = sorted((float(p["t0"]), float(p["t1"])) for p in doc["points"]
                   if not p["deleted"] and p["t0"] is not None and p["t1"] is not None)
    if len(cards) < 5:
        return None
    inplay = np.zeros(len(pt), bool)
    for a, b in cards:
        inplay |= (pt >= a) & (pt <= b)
    gap = np.zeros(len(pt), bool)
    for (a0, b0), (a1, b1) in zip(cards, cards[1:]):
        if a1 - b0 > 2 * GAP_SHRINK + 1.0:
            gap |= (pt > b0 + GAP_SHRINK) & (pt < a1 - GAP_SHRINK)

    vis = np.array(sorted(x for x in
                          (e["t"] for e in doc["events"]
                           if e["kind"] in ("bounce", "contact")
                           and (e["vis"] or 0) >= MIN_VIS) if x is not None))
    if len(vis) < 40:
        return None
    j = np.searchsorted(vis, pt)
    d = np.full(len(pt), 1e9)
    for off in (-1, 0):
        k = np.clip(j + off, 0, len(vis) - 1)
        d = np.minimum(d, np.abs(pt - vis[k]))
    matched = d <= TOL

    rows = []
    for i in range(len(pt)):
        if inplay[i] and matched[i]:
            label = 1
        elif gap[i]:
            label = 0
        elif inplay[i]:
            label = -1          # in a rally, unaccounted for
        else:
            continue
        f = AC.features_at(samples, rate, float(pt[i]))
        if f is None:
            continue
        f["z"] = float(pz[i])
        rows.append({"slug": slug, "t": float(pt[i]), "label": label,
                     "venue": doc["match"]["venue"],
                     **{k: f[k] for k in FEATS}})
    return rows


def main():
    slugs = sys.argv[1:] or ["cebaa6d4", "77fc4dee", "ec6490f4", "7e02fbb9",
                             "5bd279f4", "840b4635", "19a1efc7",
                             "d59d7610", "9e15ed10", "a52a6612",
                             "cb0e7027", "d4592913", "6a3777db"]
    allrows = []
    for slug in slugs:
        r = gather(slug)
        if not r:
            print(f"{slug}: skipped"); continue
        n = defaultdict(int)
        for x in r: n[x["label"]] += 1
        print(f"{slug} {str(r[0]['venue'])[:15]:15s} "
              f"seen+heard {n[1]:5d}   between points {n[0]:5d}   "
              f"heard in rally but unseen {n[-1]:5d}", flush=True)
        allrows.extend(r)
    json.dump(allrows, open("/Users/adil/ponglens-research-work/soundclass.json", "w"))

    print("\n=== leave-one-match-out: can a knock's sound tell the two piles apart? ===")
    byslug = defaultdict(list)
    for r in allrows:
        byslug[r["slug"]].append(r)
    summary = []
    for held in byslug:
        train = [r for s, rs in byslug.items() if s != held for r in rs
                 if r["label"] >= 0]
        test = byslug[held]
        if len(train) < 200:
            continue
        m = fit_logistic([[r[k] for k in FEATS] for r in train],
                         [r["label"] for r in train])
        pos = [r for r in test if r["label"] == 1]
        neg = [r for r in test if r["label"] == 0]
        unk = [r for r in test if r["label"] == -1]
        if not pos or not neg:
            continue
        sp = predict(m, [[r[k] for k in FEATS] for r in pos])
        sn = predict(m, [[r[k] for k in FEATS] for r in neg])
        su = predict(m, [[r[k] for k in FEATS] for r in unk]) if unk else np.array([])
        a = AC.auc(sp, sn)
        # where do the unlabelled ones fall between the two piles?
        share = float(np.mean(su > np.median(sn))) if len(su) else float("nan")
        like_ball = float(np.mean(su > np.median(sp))) if len(su) else float("nan")
        summary.append((held, test[0]["venue"], a, np.median(sp), np.median(sn),
                        np.median(su) if len(su) else np.nan, share, like_ball, len(unk)))
        print(f"  {held} {str(test[0]['venue'])[:15]:15s} AUC {a:.3f}   "
              f"median score  ball {np.median(sp):.2f}  room {np.median(sn):.2f}  "
              f"unaccounted {np.median(su) if len(su) else float('nan'):.2f}   "
              f"{share*100:4.0f}% of unaccounted score above the room median, "
              f"{like_ball*100:4.0f}% above the ball median", flush=True)
    json.dump([list(map(lambda x: float(x) if isinstance(x, (int, float, np.floating)) else x, s))
               for s in summary],
              open("/Users/adil/ponglens-research-work/soundclass_summary.json", "w"))


if __name__ == "__main__":
    main()
