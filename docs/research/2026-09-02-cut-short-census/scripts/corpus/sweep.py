"""Would the break test have made each of these splits?

The gap measured here runs from the last event in the first card to the
first event in the second, so it spans the 1.2s of dead space the split
itself inserted. Any event inside that dead space is invisible, which makes
every gap here an UPPER bound on the real one — so this test credits the
break rule with splitting slightly more often than it truly would, which is
the conservative direction for the claim being made.
"""
import json
from collections import Counter
splits = json.load(open("splits.json"))
have = [s for s in splits if s.get("ev_gap") is not None]
judged = [s for s in have if s["verdict"] in ("one point", "two points")]
print(f"{len(splits)} splits; {len(have)} with per-card evidence; {len(judged)} of those judged by taps")
one = [s for s in judged if s["verdict"] == "one point"]
two = [s for s in judged if s["verdict"] == "two points"]
def pct(xs, k=lambda s: s["ev_gap"]):
    v = sorted(k(s) for s in xs)
    n = len(v)
    return f"n={n:3d} p10 {v[n//10]:4.1f}s median {v[n//2]:4.1f}s p90 {v[min(n-1,9*n//10)]:5.1f}s"
print(f"\ngap in play at the cut, where a single point was cut in half: {pct(one)}")
print(f"gap in play at the cut, where two points were separated:      {pct(two)}")
print(f"\n{'threshold':>9s} {'wrong splits prevented':>23s} {'good splits lost':>18s} {'unscored splits dropped':>24s}")
for g in (2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0):
    prevented = sum(1 for s in one if s["ev_gap"] < g)
    lost = sum(1 for s in two if s["ev_gap"] < g)
    uns = sum(1 for s in have if s["verdict"] == "unscored" and s["ev_gap"] < g)
    print(f"  {g:5.1f}s  {prevented:3d} of {len(one)} ({prevented/len(one)*100:3.0f}%)       "
          f"{lost:3d} of {len(two)} ({lost/len(two)*100:3.0f}%)        {uns:3d} of "
          f"{sum(1 for s in have if s['verdict']=='unscored')}")
print("\nthe wrong splits the rule would still make, at 3.0s:")
for s in sorted((s for s in one if s["ev_gap"] >= 3.0), key=lambda s: -s["ev_gap"]):
    print(f"   {s['owner'][:11]:11s} {s['opp'][:18]:18s} points {s['a_idx']}/{s['b_idx']}  "
          f"span {s['span']:4.1f}s  quiet at the cut {s['ev_gap']:4.1f}s")
print("\nthe good splits it would lose, at 3.0s:")
for s in sorted((s for s in two if s["ev_gap"] < 3.0), key=lambda s: s["ev_gap"]):
    print(f"   {s['owner'][:11]:11s} {s['opp'][:18]:18s} points {s['a_idx']}/{s['b_idx']}  "
          f"span {s['span']:4.1f}s  quiet at the cut {s['ev_gap']:4.1f}s")
