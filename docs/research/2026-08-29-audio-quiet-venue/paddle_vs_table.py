"""Racket or table? The one distinction that would actually pay.

The published work (Sony AI, arXiv 2409.11760) separates racket, table and
floor at 0.97 F1 — but from a directional microphone half a metre away, on
a dataset licensed for non-commercial use only. The question here is
whether the same distinction survives a phone on a tripod across the room,
learned from labels we already own.

Those labels come free: the shipped pipeline already calls each event a
`bounce` or a `contact`, and it decides that from the ball's TRAJECTORY —
did the ball reverse off the table, or off a bat — which is independent of
how the event sounded. So sound is being asked to reproduce a judgement
made from geometry, with no circularity.

It matters because of `not_consecutive`: a serve is the one shot whose two
bounces have nothing in between, and every serve the last audio study
gained came from that rule. Deciding "that middle knock was a bat, not the
table" is exactly what the rule needs.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
from soundclass import fit_logistic, predict, FEATS, TOL, MIN_VIS, Z_ON

CACHE = "/Users/adil/ponglens-research-work/pvt_cache.json"


def gather(slug):
    doc = CO.load(slug)
    if doc is None or not doc["wav"] or doc["clock"] != "source":
        return None
    samples, rate = AC.read_wav(doc["wav"])
    env = EN.envelopes(samples, rate)
    t, z = env["times"], env["high"]["z"]
    idx = EN.peaks(z, rate, Z_ON)
    pt, pz = t[idx], z[idx]
    evs = [e for e in doc["events"]
           if e["kind"] in ("bounce", "contact") and (e["vis"] or 0) >= MIN_VIS
           and e["t"] is not None]
    rows = []
    for e in evs:
        k = int(np.argmin(np.abs(pt - e["t"])))
        if abs(pt[k] - e["t"]) > TOL:
            continue
        f = AC.features_at(samples, rate, float(pt[k]))
        if f is None:
            continue
        f["z"] = float(pz[k])
        rows.append({"slug": slug, "venue": doc["match"]["venue"],
                     "kind": e["kind"], "t": float(pt[k]),
                     "on_table": e["u"] is not None,
                     **{c: f[c] for c in FEATS}})
    return rows


def main():
    slugs = ["cebaa6d4", "77fc4dee", "ec6490f4", "7e02fbb9", "5bd279f4",
             "840b4635", "19a1efc7", "d59d7610", "9e15ed10", "a52a6612",
             "cb0e7027", "d4592913", "6a3777db"]
    if os.path.exists(CACHE):
        allrows = json.load(open(CACHE))
        print(f"cache: {len(allrows)} matched events")
    else:
        allrows = []
        for s in slugs:
            r = gather(s)
            if not r:
                print(f"{s}: skipped"); continue
            n = defaultdict(int)
            for x in r: n[x["kind"]] += 1
            print(f"{s} {str(r[0]['venue'])[:15]:15s} "
                  f"table bounces {n['bounce']:5d}   bat contacts {n['contact']:5d}",
                  flush=True)
            allrows.extend(r)
        json.dump(allrows, open(CACHE, "w"))

    print("\n=== leave-one-match-out: does a bat sound different from the table? ===")
    byslug = defaultdict(list)
    for r in allrows:
        byslug[r["slug"]].append(r)
    for held, test in byslug.items():
        train = [r for s, rs in byslug.items() if s != held for r in rs]
        if len(train) < 300:
            continue
        y = [1.0 if r["kind"] == "bounce" else 0.0 for r in train]
        if min(sum(y), len(y) - sum(y)) < 100:
            continue
        m = fit_logistic([[r[k] for k in FEATS] for r in train], y)
        b = [r for r in test if r["kind"] == "bounce"]
        c = [r for r in test if r["kind"] == "contact"]
        if len(b) < 20 or len(c) < 20:
            print(f"  {held}: too few of one kind ({len(b)}/{len(c)})"); continue
        sb = predict(m, [[r[k] for k in FEATS] for r in b])
        sc = predict(m, [[r[k] for k in FEATS] for r in c])
        print(f"  {held} {str(test[0]['venue'])[:15]:15s} "
              f"bounces {len(b):4d}  contacts {len(c):4d}   AUC {AC.auc(sb, sc):.3f}")

    print("\n=== which parts of the sound carry it (pooled, standardised) ===")
    y = np.array([1.0 if r["kind"] == "bounce" else 0.0 for r in allrows])
    X = np.array([[r[k] for k in FEATS] for r in allrows], float)
    for i, k in enumerate(FEATS):
        print(f"  {k:14s} AUC {AC.auc(X[y == 1, i], X[y == 0, i]):.3f}   "
              f"median bounce {np.median(X[y==1, i]):9.3f}   "
              f"contact {np.median(X[y==0, i]):9.3f}")


if __name__ == "__main__":
    main()
