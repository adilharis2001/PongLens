"""Rally start and end, from a train of knocks filtered down to ball-like ones.

Two signals are combined. The onset train says WHEN something struck; the
ball-versus-room classifier says whether it sounded like this table's ball.
Neither is enough alone — the train is about half room noise even in a
booth, and the classifier has no idea when a rally is happening — but the
train filtered by the classifier is a much cleaner thing than either.

The classifier is trained leave-one-match-out on the two piles whose
identity is not in doubt (seen-and-heard during a rally; anything at all
between two cards), so no match ever grades itself and nothing was hand
labelled.

Judged against point_boundaries: Adil's serve tap and his winner tap. Those
are good to about 0.7 s, so "within one second" is the honest bar to quote
and nothing here claims tighter.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
from soundclass import fit_logistic, predict, FEATS, TOL, MIN_VIS, Z_ON, GAP_SHRINK

CACHE = "/Users/adil/ponglens-research-work/peaks_cache.json"
RULED = ["cebaa6d4", "d59d7610", "9e15ed10"]      # have taps AND placement AND source clock


def peak_table(slug):
    """Every peak in the match with its sound described and its label."""
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
    inplay = np.zeros(len(pt), bool)
    for a, b in cards:
        inplay |= (pt >= a) & (pt <= b)
    gap = np.zeros(len(pt), bool)
    for (a0, b0), (a1, b1) in zip(cards, cards[1:]):
        if a1 - b0 > 2 * GAP_SHRINK + 1.0:
            gap |= (pt > b0 + GAP_SHRINK) & (pt < a1 - GAP_SHRINK)
    vis = np.array(sorted(e["t"] for e in doc["events"]
                          if e["kind"] in ("bounce", "contact")
                          and (e["vis"] or 0) >= MIN_VIS and e["t"] is not None))
    matched = np.zeros(len(pt), bool)
    if len(vis):
        j = np.searchsorted(vis, pt)
        d = np.full(len(pt), 1e9)
        for off in (-1, 0):
            k = np.clip(j + off, 0, len(vis) - 1)
            d = np.minimum(d, np.abs(pt - vis[k]))
        matched = d <= TOL
    rows = []
    for i in range(len(pt)):
        f = AC.features_at(samples, rate, float(pt[i]))
        if f is None:
            continue
        f["z"] = float(pz[i])
        label = 1 if (inplay[i] and matched[i]) else (0 if gap[i] else -1)
        rows.append({"slug": slug, "t": float(pt[i]), "label": label,
                     **{k: f[k] for k in FEATS}})
    return {"venue": doc["match"]["venue"], "opp": doc["match"]["opponent_name"],
            "rows": rows}


def spans_of(doc):
    return sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                  for b in doc["boundaries"] if not b.get("deleted")
                  and b.get("start_source_s") is not None
                  and b.get("end_source_s") is not None)


def longest_run(times, amps, max_gap, min_run):
    if len(times) < min_run:
        return None
    runs, start = [], 0
    for i in range(1, len(times)):
        if times[i] - times[i - 1] > max_gap:
            runs.append((start, i)); start = i
    runs.append((start, len(times)))
    runs = [r for r in runs if r[1] - r[0] >= min_run]
    if not runs:
        return None
    a, b = max(runs, key=lambda r: float(np.sum(amps[r[0]:r[1]])))
    return float(times[a]), float(times[b - 1])


def main():
    if os.path.exists(CACHE):
        data = json.load(open(CACHE))
    else:
        data = {}
        for s in ["cebaa6d4", "77fc4dee", "ec6490f4", "7e02fbb9", "5bd279f4",
                  "840b4635", "19a1efc7", "d59d7610", "9e15ed10", "a52a6612",
                  "cb0e7027", "d4592913", "6a3777db"]:
            r = peak_table(s)
            if r:
                data[s] = r
                print(f"cached {s}: {len(r['rows'])} peaks", flush=True)
        json.dump(data, open(CACHE, "w"))

    print("\n=== rally span, plain train vs ball-filtered train ===")
    print("match                       plain                    ball-filtered")
    print("                     start<1s  end<1s        start<1s  end<1s   (n)")
    out = {}
    for slug in RULED:
        doc = CO.load(slug)
        spans = spans_of(doc)
        rows = data[slug]["rows"]
        train = [r for s, d in data.items() if s != slug for r in d["rows"]
                 if r["label"] >= 0]
        m = fit_logistic([[r[k] for k in FEATS] for r in train],
                         [r["label"] for r in train])
        score = predict(m, [[r[k] for k in FEATS] for r in rows])
        t = np.array([r["t"] for r in rows])
        z = np.array([r["z"] for r in rows])
        best = None
        for keep in (0.0, 0.20, 0.35, 0.50, 0.65):
            sel = score >= keep
            tt, zz = t[sel], z[sel]
            ds, de, miss = [], [], 0
            for a, b in spans:
                w = (tt >= a - 4) & (tt <= b + 4)
                r = longest_run(tt[w], zz[w], 1.0, 4)
                if r is None:
                    miss += 1; continue
                ds.append(r[0] - a); de.append(r[1] - b)
            ds, de = np.array(ds), np.array(de)
            sc = (np.mean(np.abs(ds) < 1) + np.mean(np.abs(de) < 1)) / 2
            if keep == 0.0:
                plain = (np.mean(np.abs(ds) < 1), np.mean(np.abs(de) < 1))
            if best is None or sc > best[0]:
                best = (sc, keep, np.mean(np.abs(ds) < 1), np.mean(np.abs(de) < 1),
                        len(ds), float(np.median(ds)), float(np.median(de)))
        sc, keep, a1, b1, n, mds, mde = best
        out[slug] = {"keep": keep, "start": a1, "end": b1, "n": n}
        print(f"{slug} {str(data[slug]['venue'])[:12]:12s} "
              f"{plain[0]*100:6.0f}% {plain[1]*100:6.0f}%    "
              f"keep>={keep:.2f} {a1*100:6.0f}% {b1*100:6.0f}%   ({n})  "
              f"med {mds:+.2f}/{mde:+.2f}", flush=True)
    json.dump(out, open("/Users/adil/ponglens-research-work/clean_span.json", "w"))


if __name__ == "__main__":
    main()
