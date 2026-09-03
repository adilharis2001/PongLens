"""Is there any axis that separates a cut rally from a correct split?"""
import json, statistics as st
splits = json.load(open("splits.json"))
cand = {c["mid"]: c for c in json.load(open("candidates.json"))}
meta = {}
for mid in {s["mid"] for s in splits}:
    if cand[mid].get("has_sj"):
        m = json.load(open(f"sj/{mid}.json"))["meta"]
        meta[mid] = m
for s in splits:
    m = meta.get(s["mid"], {})
    s["camera"] = m.get("camera"); s["route"] = m.get("route"); s["spm"] = m.get("serves_per_min")
    if s.get("n_ev") is not None:
        s["density"] = s["n_ev"] / s["span"]
GOOD = "both halves scored: the split was right"
BAD = "only the SECOND half scored: the first holds a rally with no winner"
def show(name, key, fmt="{:.2f}"):
    print(f"\n{name}")
    for k in (GOOD, BAD):
        v = [s[key] for s in splits if s["klass"] == k and s.get(key) is not None]
        if not v:
            print(f"   {'right' if k == GOOD else 'cut rally':10s} no data"); continue
        v = sorted(v)
        print(f"   {'right split' if k == GOOD else 'a cut rally':12s} n={len(v):3d}  "
              f"min {fmt.format(v[0])}  p25 {fmt.format(v[len(v)//4])}  median {fmt.format(v[len(v)//2])}  "
              f"p75 {fmt.format(v[3*len(v)//4])}  max {fmt.format(v[-1])}")
show("events per second inside the whole card (a dense card is one long rally)", "density")
show("length of the fused card", "span", "{:.1f}s")
show("quiet at the cut", "ev_gap", "{:.1f}s")
show("camera foreshortening (1.0 is square on, below 0.6 is nearly end-on)", "camera")
show("serves detected per minute in the match", "spm")
print("\nwhere the harm falls, by match")
from collections import Counter
bad = Counter((s["owner"], s["opp"], s["created"]) for s in splits if s["klass"] == BAD)
good = Counter((s["owner"], s["opp"], s["created"]) for s in splits if s["klass"] == GOOD)
print(f"  {'match':40s} {'cut rallies':>11s} {'right splits':>12s} {'camera':>7s} {'serves/min':>10s}")
for k in sorted(set(bad) | set(good), key=lambda k: -bad[k]):
    ex = next(s for s in splits if (s["owner"], s["opp"], s["created"]) == k)
    print(f"  {(k[0][:12] + ' / ' + k[1])[:40]:40s} {bad[k]:11d} {good[k]:12d} "
          f"{ex['camera'] if ex['camera'] is not None else '-'!s:>7} {ex['spm'] if ex['spm'] is not None else '-'!s:>10}")
print("\nfirst half of the pair opened on a detected serve?")
for k in (GOOD, BAD):
    v = [s for s in splits if s["klass"] == k]
    print(f"   {'right split' if k == GOOD else 'a cut rally':12s} {sum(1 for s in v if s['a_serve'] is not None)} of {len(v)}")
