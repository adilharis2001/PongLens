"""Score the retest against July, on July's own definitions.

Precision is over DECIDED cases only (status high_confidence); coverage is
decided over eligible. That is how the July gate was written, so the two
numbers are comparable line for line. Reported per stratum as well as
pooled, because the cohort is 23 occluded contacts against 9 clean ones and
a pooled number hides which of them moved.
"""
import json
import sys
from collections import defaultdict


def tally(rows, key):
    dec = cor = 0
    for r in rows:
        v = r[key]
        if v.get("status") == "high_confidence":
            dec += 1
            cor += (v.get("side") == r["truth"])
    n = len(rows)
    return {"eligible": n, "decided": dec, "correct": cor,
            "coverage": dec / n if n else 0.0,
            "precision": cor / dec if dec else 0.0}


def line(name, t):
    return (f"  {name:22s} decided {t['decided']:3d}/{t['eligible']:3d} "
            f"(coverage {t['coverage']*100:5.1f}%)   "
            f"correct {t['correct']:3d}/{t['decided']:3d} "
            f"(precision {t['precision']*100:5.1f}%)")


def main(path):
    data = json.load(open(path))
    rows = [r for r in data.values() if "v2" in r and r.get("truth")]
    print(f"{len(rows)} scorable cases\n")
    print("POOLED")
    print(line("July (v1 boxes)", tally(rows, "july")))
    print(line("v2 person boxes", tally(rows, "v2")))
    by = defaultdict(list)
    for r in rows:
        by[r["stratum"]].append(r)
    for s in ("visible", "occluded", "prior_wrong_server"):
        if not by[s]:
            continue
        print(f"\n{s.upper()}  (n={len(by[s])})")
        print(line("July", tally(by[s], "july")))
        print(line("v2", tally(by[s], "v2")))
    # what changed, case by case
    print("\nCASES WHERE THE VERDICT MOVED")
    moved = 0
    for sid, r in sorted(data.items()):
        if "v2" not in r or not r.get("truth"):
            continue
        j, v = r["july"], r["v2"]
        jd, vd = j.get("status") == "high_confidence", v.get("status") == "high_confidence"
        if jd == vd and j.get("side") == v.get("side"):
            continue
        moved += 1
        jc = "-" if not jd else ("RIGHT" if j["side"] == r["truth"] else "WRONG")
        vc = "-" if not vd else ("RIGHT" if v["side"] == r["truth"] else "WRONG")
        print(f"  {sid[:8]} {r['stratum']:18s} truth={r['truth']:4s}  "
              f"July {str(j.get('status'))[:12]:12s} {jc:5s} -> "
              f"v2 {str(v.get('status'))[:12]:12s} {vc:5s}   "
              f"({v.get('reason')}; {r['posed_frames']} frames posed, "
              f"{r['frames_without_boxes']} with no box)")
    if not moved:
        print("  none")
    # box availability, which is the thing the swap was supposed to fix
    tot = sum(r["posed_frames"] for r in rows)
    nb = sum(r["frames_without_boxes"] for r in rows)
    print(f"\nframes posed {tot}, frames skipped for having no person box {nb}")


if __name__ == "__main__":
    main(sys.argv[1])
