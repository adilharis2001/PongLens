"""The same search, with the one thing physics insists on: a serve crosses
the net BETWEEN its two bounces. So the landing is the first on-surface
bounce on the far half that comes after a net crossing that itself comes
after V3's first bounce."""
import json, glob, os, collections
NET_V = 2.74 / 2.0
def half_of(v): return "near" if v < NET_V else "far"

def landing(card, window, need_cross):
    a = card.get("serve_arrival_s"); sh = card.get("serve_half")
    if a is None or not sh: return None
    other = "far" if sh == "near" else "near"
    cr = card.get("crossings") or []
    for b in card.get("bounces", []):
        t = b["t"]
        if t <= a + 0.02: continue
        if t > a + window: break
        if not b.get("onSurface") or b.get("v") is None: continue
        if half_of(b["v"]) != other: continue
        if need_cross and not any(a < x < t for x in cr): continue
        return b
    return None

for need_cross in (False, True):
    tot = collections.Counter()
    for p in sorted(glob.glob("sj/*.json")):
        for c in json.load(open(p))["cards"]:
            if c.get("serve_source") != "v3": continue
            tot["v3"] += 1
            pair = c.get("serve_bounces")
            if pair: tot["pair"] += 1
            hit = landing(c, 1.6, need_cross)
            if hit: tot["hit"] += 1
            if pair and hit:
                tot["both"] += 1
                if abs(hit["t"] - pair[1]) < 0.06: tot["agree"] += 1
            if hit and not pair: tot["extra"] += 1
    label = "with the net-crossing rule" if need_cross else "without it"
    print(f"{label}")
    print(f"   landing found     {tot['hit']}/{tot['v3']} = {tot['hit']/tot['v3']*100:.0f}%")
    print(f"   agrees with motif {tot['agree']}/{tot['both']} = {tot['agree']/tot['both']*100:.1f}%")
    print(f"   new landings      {tot['extra']}")
    print()
