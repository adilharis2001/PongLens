"""Impact lists for the placement replay, filtered by ball-likeness.

The previous study handed placement every peak the detector found, scored
by a local z. Its measured failure was precise: a neighbouring table's
bounce is confirmed exactly as readily as ours, because the confidence
said only "something struck", never "something struck HERE".

This writes the same peaks with the same z-scores, minus the ones the
ball-versus-room classifier does not believe. Only the membership of the
list changes, so the scale placement expects — a z-score it maps through
1 - exp(-c/2), and compares against 2.5 for a standalone candidate — is
left exactly as it was.

The classifier is trained leave-one-match-out, so a match's own impacts
are never chosen by a model that has seen it.
"""
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corpus as CO
from soundclass import fit_logistic, predict, FEATS

PEAKS = json.load(open("/Users/adil/ponglens-research-work/peaks_cache.json"))
SLUG_TO_NAME = {v: k for k, v in CO.BY_SLUG.items()}


def main():
    out_dir = sys.argv[1]
    keep = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    os.makedirs(out_dir, exist_ok=True)
    for slug, name in CO.BY_SLUG.items():
        if slug not in PEAKS:
            print(f"{name}: no cached peaks"); continue
        rows = PEAKS[slug]["rows"]
        train = [r for s, d in PEAKS.items() if s != slug for r in d["rows"]
                 if r["label"] >= 0]
        m = fit_logistic([[r[k] for k in FEATS] for r in train],
                         [r["label"] for r in train])
        score = predict(m, [[r[k] for k in FEATS] for r in rows])
        impacts = [{"t": round(float(r["t"]), 4),
                    "confidence": round(float(r["z"]), 3)}
                   for r, s in zip(rows, score) if s >= keep]
        json.dump(impacts, open(os.path.join(out_dir, f"{name}.json"), "w"))
        print(f"{name:9s} {len(impacts):5d} of {len(rows):5d} peaks kept "
              f"({len(impacts)/len(rows)*100:.0f}%)")


if __name__ == "__main__":
    main()
