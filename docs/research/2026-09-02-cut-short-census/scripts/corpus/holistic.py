"""One authoritative count of what the 20-second cap actually does.

Rebuilt from scratch rather than from the running notes, with both
corrections applied at source:
  * route comes from the assembler's own note, so end-on matches — where a
    different assembler replaced the cards and this rule never ran — are
    excluded rather than counted against it;
  * a winner tap landing in the 1.2s dead gap belongs to the card BEFORE it,
    because that gap is manufactured by the split itself.
"""
import json, os, sys
from collections import Counter
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2

cand = {c["mid"]: c for c in json.load(open("candidates.json"))}
taps_all = json.load(open("taps.json"))

def route_of(mid):
    j = json.load(open(f"mj/{mid}.json"))
    for n in (j.get("notes") or []):
        if "route end-on" in n:
            return "end-on"
        if "route serve-anchored" in n:
            return "serve-anchored"
    # the route note was added later; infer from how many cards carry a serve
    pts = j["points"]
    n_serve = sum(1 for p in pts if p.get("serve_s") is not None)
    return "serve-anchored (inferred)" if n_serve > 0.4 * len(pts) else "end-on (inferred)"

rows = []
for mid, c in cand.items():
    if c.get("pipeline") != "v2":
        continue
    j = json.load(open(f"mj/{mid}.json"))
    P = sorted(j["points"], key=lambda p: p["t0"])
    r = route_of(mid)
    sj = json.load(open(f"sj/{mid}.json")) if c.get("has_sj") else None
    cards = sorted(sj["cards"], key=lambda k: k["t0"]) if sj else None
    taps = taps_all.get(mid, [])
    splits = []
    for A, B in zip(P, P[1:]):
        gap, span = B["t0"] - A["t1"], B["t1"] - A["t0"]
        if not (abs(gap - V2.MIN_DEAD_S) < 0.05 and B.get("serve_s") is None
                and span > V2.MAX_CARD_S):
            continue
        # CORRECTED attribution: the dead gap the split manufactured is A's
        ta = [t for t in taps if A["t0"] <= t < B["t0"]]
        tb = [t for t in taps if B["t0"] <= t <= B["t1"] + 0.5]
        # does the detector, run today, find a serve inside the SECOND half?
        b_serve_now = None
        if cards:
            cb = min(cards, key=lambda k: abs(k["t0"] - B["t0"]))
            if abs(cb["t0"] - B["t0"]) <= 0.5:
                b_serve_now = cb.get("serve_s")
        splits.append(dict(mid=mid, owner=c["owner"], opp=c["opp"], created=c["created"],
                           route=r, a_idx=A["idx"], b_idx=B["idx"], span=span,
                           a_serve_prod=A.get("serve_s"), b_serve_now=b_serve_now,
                           taps_a=len(ta), taps_b=len(tb),
                           verdict=("two points" if ta and tb else
                                    "one point" if len(ta) + len(tb) == 1 else
                                    "unscored" if not ta and not tb else "more than two")))
    rows.append(dict(mid=mid, owner=c["owner"], opp=c["opp"], created=c["created"],
                     route=r, cards=len(P), taps=len(taps),
                     serves=sum(1 for p in P if p.get("serve_s") is not None),
                     splits=splits))

json.dump(rows, open("holistic.json", "w"), indent=1)

def band(title, keep):
    sel = [r for r in rows if keep(r)]
    sp = [s for r in sel for s in r["splits"]]
    v = Counter(s["verdict"] for s in sp)
    judged = v["two points"] + v["one point"] + v["more than two"]
    print(f"\n{title}")
    print(f"  {len(sel)} matches, {sum(r['cards'] for r in sel)} cards, {len(sp)} splits")
    if sp:
        print(f"    split was right (two taps)      {v['two points']:3d}")
        print(f"    cut one point in half (one tap) {v['one point']:3d}")
        print(f"    a point plus a leftover         {v['more than two']:3d}")
        print(f"    neither half scored             {v['unscored']:3d}")
        if judged:
            print(f"    -> harmful in {v['one point']}/{judged} judged = "
                  f"{v['one point']/judged*100:.0f}%")
    return sel, sp

print(f"CORPUS: {len(cand)} matches with >= 15 winner taps; "
      f"{len(rows)} of them cut by v2 with an assembler record")
print("routes:", dict(Counter(r["route"] for r in rows)))

allm, allsp = band("EVERYTHING (what I was reporting before the route correction)",
                   lambda r: True)
sa, sasp = band("SERVE-ANCHORED ONLY -- the matches this rule actually ran on",
                lambda r: r["route"].startswith("serve-anchored"))
eo, eosp = band("END-ON -- a different assembler made these cuts",
                lambda r: r["route"].startswith("end-on"))

print("\n\nPER MATCH, serve-anchored only")
print(f"  {'owner':10s} {'opponent':20s} {'date':11s} {'cards':>5s} {'serve%':>6s} "
      f"{'splits':>6s} {'/100':>5s} {'right':>5s} {'cut':>4s}")
for r in sorted(sa, key=lambda r: -len(r["splits"])):
    v = Counter(s["verdict"] for s in r["splits"])
    print(f"  {r['owner'][:10]:10s} {r['opp'][:20]:20s} {r['created']:11s} {r['cards']:5d} "
          f"{r['serves']/r['cards']*100:5.0f}% {len(r['splits']):6d} "
          f"{len(r['splits'])/r['cards']*100:5.1f} {v['two points']:5d} {v['one point']:4d}")

print("\n\nTHE HARMFUL ONES (serve-anchored, one tap across the pair)")
for s in sasp:
    if s["verdict"] == "one point":
        print(f"  {s['owner'][:10]:10s} {s['opp'][:18]:18s} {s['created']} "
              f"points {s['a_idx']}/{s['b_idx']}  span {s['span']:.1f}s  "
              f"prod serve on A: {s['a_serve_prod']}  detector finds one in B now: {s['b_serve_now']}")
