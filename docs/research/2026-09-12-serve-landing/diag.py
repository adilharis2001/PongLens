import json, glob, os, collections, statistics as st
NET_V = 2.74 / 2.0
def half_of(v): return "near" if v < NET_V else "far"

def cands(card, window):
    arrival = card.get("serve_arrival_s"); sh = card.get("serve_half")
    if arrival is None or not sh: return []
    other = "far" if sh == "near" else "near"
    out = []
    for b in card.get("bounces", []):
        t = b["t"]
        if t <= arrival + 0.02: continue
        if t > arrival + window: break
        if not b.get("onSurface") or b.get("v") is None: continue
        if half_of(b["v"]) == other: out.append(b)
    return out

deltas, earlier, later = [], 0, 0
cross_between = collections.Counter()
for p in sorted(glob.glob("sj/*.json")):
    for c in json.load(open(p))["cards"]:
        if c.get("serve_source") != "v3": continue
        pair = c.get("serve_bounces")
        cs = cands(c, 1.6)
        if not pair or not cs: continue
        mine = cs[0]
        d = round(mine["t"] - pair[1], 2)
        if abs(d) < 0.06: continue
        deltas.append(d)
        if d < 0: earlier += 1
        else: later += 1
        # does a net crossing sit between V3's arrival and my pick?
        cr = c.get("crossings") or []
        a = c.get("serve_arrival_s")
        cross_between["mine has a crossing" if any(a < t < mine["t"] for t in cr)
                      else "mine has NO crossing"] += 1
print(f"{len(deltas)} disagreements")
print(f"  my pick EARLIER than the motif's landing: {earlier}")
print(f"  my pick LATER   than the motif's landing: {later}")
print(f"  median gap {st.median(deltas):+.2f}s, range {min(deltas):+.2f} to {max(deltas):+.2f}")
print("  net crossing between V3's first bounce and my pick:", dict(cross_between))
print()
# how many candidates are there, when there is more than one?
n = collections.Counter()
for p in sorted(glob.glob("sj/*.json")):
    for c in json.load(open(p))["cards"]:
        if c.get("serve_source") != "v3": continue
        n[len(cands(c, 1.6))] += 1
print("candidate bounces on the far half within 1.6s of V3's first bounce:", dict(sorted(n.items())))
