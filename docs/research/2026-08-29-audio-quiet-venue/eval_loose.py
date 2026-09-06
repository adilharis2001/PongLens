"""Does the loose-ball fingerprint find the end of the point?

Judged against Adil's winner tap. He presses when the point is decided,
which is a beat after the ball actually died, so the honest expectation is
that the detector lands slightly BEFORE the tap and that the median offset
is a small negative number rather than zero.

A chance control is included: the same detector run against the peak train
slid 7.31 s along the clock. If a shifted match scores nearly as well, the
fingerprint is finding nothing and the hit rate is just density.
"""
import json, os, sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN
import looseball as LB

Z_ON = 5.0
SEARCH_BACK, SEARCH_FWD = 1.5, 5.0


def spans_of(doc):
    return sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                  for b in doc["boundaries"] if not b.get("deleted")
                  and b.get("start_source_s") is not None
                  and b.get("end_source_s") is not None)


def main():
    slugs = sys.argv[1:] or ["cebaa6d4", "c27e196d", "d59d7610", "9e15ed10"]
    print("match                    n    found   median off   |err|<0.5  <1.0  <2.0   chance<1.0")
    allout = {}
    for slug in slugs:
        doc = CO.load(slug)
        if doc is None or not doc["wav"] or doc["clock"] != "source":
            print(f"{slug}: skipped (no source-clock audio)"); continue
        spans = spans_of(doc)
        if len(spans) < 15:
            print(f"{slug}: only {len(spans)} marked points"); continue
        samples, rate = AC.read_wav(doc["wav"])
        env = EN.envelopes(samples, rate)
        t = env["times"][EN.peaks(env["high"]["z"], rate, Z_ON)]
        trains = LB.find_trains(t)
        shifted = LB.find_trains(t + 7.31)
        offs, chance, found = [], 0, 0
        rows = []
        for a, b in spans:
            r = LB.rally_end_from(trains, b - SEARCH_BACK, b + SEARCH_FWD)
            s = LB.rally_end_from(shifted, b - SEARCH_BACK, b + SEARCH_FWD)
            if s is not None and abs(s["start"] - b) < 1.0:
                chance += 1
            if r is None:
                rows.append({"end": b, "hit": None}); continue
            found += 1
            offs.append(r["start"] - b)
            rows.append({"end": b, "hit": r["start"], "off": r["start"] - b,
                         "n": r["n"], "ratio": r["ratio"]})
        offs = np.array(offs)
        allout[slug] = {"venue": doc["match"]["venue"], "rows": rows,
                        "n_trains": len(trains)}
        def f(k):
            return f"{np.mean(np.abs(offs) < k)*100:5.0f}%" if len(offs) else "    -"
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} {len(spans):3d}  "
              f"{found/len(spans)*100:5.0f}%   {np.median(offs):+6.2f}s   "
              f"{f(0.5)} {f(1.0)} {f(2.0)}      "
              f"{chance/len(spans)*100:5.0f}%   "
              f"({len(trains)} loose-ball trains in the match)", flush=True)
    json.dump(allout, open("/Users/adil/ponglens-research-work/loose_eval.json", "w"))


if __name__ == "__main__":
    main()
