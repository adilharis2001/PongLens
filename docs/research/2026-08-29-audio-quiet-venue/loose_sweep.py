"""Tighten the loose-ball rule toward the physics, and check it is real.

Two things are asked. First, a sweep: how long must the run be and how
consistent the decay before the detector stops firing on coincidences.
Second, and more important, a validation that does not depend on any tap —
the DECAY RATIO itself. A table tennis ball dropped on a table comes back
between 0.89 and 0.93 of its height by ITTF rule, and the gap between
bounces falls in the same proportion. If the trains being found are real
loose balls their ratios should pile up in that region; if they are
coincidences among unrelated knocks the ratios should be spread flat
across whatever band the rule allows.

The same detector run over the peak list slid 7.31 s along the clock gives
the coincidence rate its own row.
"""
import itertools, json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
import looseball as LB

SLUGS = ["cebaa6d4", "c27e196d", "d59d7610", "9e15ed10"]
Z_ON = 5.0


def spans_of(doc):
    return sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                  for b in doc["boundaries"] if not b.get("deleted")
                  and b.get("start_source_s") is not None
                  and b.get("end_source_s") is not None)


def main():
    data = {}
    for slug in SLUGS:
        doc = CO.load(slug)
        if doc is None or not doc["wav"] or doc["clock"] != "source":
            continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        t = env["times"][EN.peaks(env["high"]["z"], rate, Z_ON)]
        data[slug] = (t, spans_of(doc), doc["match"]["venue"])
        print(f"loaded {slug}: {len(t)} peaks, {len(data[slug][1])} marked points",
              flush=True)

    print("\n run ratio-band  tol |  hit within 1s of a point end   chance   lift")
    best = None
    for min_run, (lo, hi), tol in itertools.product(
            (4, 5, 6), ((0.62, 1.00), (0.75, 0.98), (0.80, 0.96)), (0.22, 0.10, 0.05)):
        hits = tots = ch = 0
        for slug, (t, spans, _v) in data.items():
            tr = LB.find_trains(t, min_run, lo, hi, tol=tol)
            sh = LB.find_trains(t + 7.31, min_run, lo, hi, tol=tol)
            st = np.array([x["start"] for x in tr]) if tr else np.array([])
            ss = np.array([x["start"] for x in sh]) if sh else np.array([])
            for a, b in spans:
                tots += 1
                if len(st) and np.min(np.abs(st - b)) < 1.0: hits += 1
                if len(ss) and np.min(np.abs(ss - b)) < 1.0: ch += 1
        r, c = hits / tots, ch / tots
        print(f"  {min_run}  {lo:.2f}-{hi:.2f}  {tol:.2f} |  "
              f"{r*100:5.1f}%                      {c*100:5.1f}%   {r-c:+.3f}")
        if best is None or (r - c) > best[0]:
            best = (r - c, min_run, lo, hi, tol, r, c)

    _, min_run, lo, hi, tol, r, c = best
    print(f"\n=== best lift: at least {min_run} bounces, ratio {lo}-{hi}, "
          f"spread under {tol} -> {r*100:.0f}% vs {c*100:.0f}% by chance ===")

    print("\n=== are the decay ratios where a ping-pong ball's should be? ===")
    print("    (ITTF: a ball dropped 30cm must rebound 24-26cm, so gaps shrink by 0.89-0.93)")
    for slug, (t, spans, venue) in data.items():
        tr = LB.find_trains(t, 4, 0.62, 1.00, tol=0.22)
        sh = LB.find_trains(t + 7.31, 4, 0.62, 1.00, tol=0.22)
        rr = np.array([x["ratio"] for x in tr])
        rs = np.array([x["ratio"] for x in sh])
        # only the ones that land on a real point end
        ends = np.array([b for _a, b in spans])
        near = np.array([bool(len(ends)) and np.min(np.abs(ends - x["start"])) < 1.0
                         for x in tr])
        print(f"  {slug} {str(venue)[:12]:12s} "
              f"all trains median {np.median(rr):.3f}  "
              f"near a point end {np.median(rr[near]) if near.any() else float('nan'):.3f} "
              f"(n={int(near.sum())})  "
              f"time-shifted control {np.median(rs):.3f}")
    print("\n  ratio histogram, trains landing on a point end vs the shifted control")
    allr, allc = [], []
    for slug, (t, spans, _v) in data.items():
        tr = LB.find_trains(t, 4, 0.62, 1.00, tol=0.22)
        ends = np.array([b for _a, b in spans])
        for x in tr:
            (allr if np.min(np.abs(ends - x["start"])) < 1.0 else allc).append(x["ratio"])
    for lo2 in np.arange(0.62, 1.0, 0.04):
        a = np.mean((np.array(allr) >= lo2) & (np.array(allr) < lo2 + 0.04)) * 100
        b = np.mean((np.array(allc) >= lo2) & (np.array(allc) < lo2 + 0.04)) * 100
        print(f"   {lo2:.2f}-{lo2+0.04:.2f}  on a point end {'#'*int(a):20s} {a:4.1f}%"
              f"   elsewhere {'#'*int(b):20s} {b:4.1f}%")


if __name__ == "__main__":
    main()
