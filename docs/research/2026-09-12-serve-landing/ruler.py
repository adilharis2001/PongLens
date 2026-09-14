import json, glob, collections, statistics as st
NET_V = 2.74/2.0
def half_of(v): return "near" if v < NET_V else "far"
def landing(card, window=1.6):
    a=card.get("serve_arrival_s"); sh=card.get("serve_half")
    if a is None or not sh: return None
    other = "far" if sh=="near" else "near"
    for b in card.get("bounces", []):
        t=b["t"]
        if t<=a+0.02: continue
        if t>a+window: break
        if not b.get("onSurface") or b.get("v") is None: continue
        if half_of(b["v"])==other: return b
    return None

same, diff, d1 = 0, 0, []
agree_same, both_same = 0, 0
for p in sorted(glob.glob("sj/*.json")):
    for c in json.load(open(p))["cards"]:
        if c.get("serve_source")!="v3": continue
        pair=c.get("serve_bounces"); a=c.get("serve_arrival_s")
        if not pair or a is None: continue
        gap = pair[0]-a
        d1.append(round(gap,2))
        if abs(gap) < 0.10:
            same += 1
            hit = landing(c)
            if hit:
                both_same += 1
                if abs(hit["t"]-pair[1]) < 0.06: agree_same += 1
        else:
            diff += 1
print(f"cards where V3 and the motif both spoke: {same+diff}")
print(f"  motif's FIRST bounce == V3's arrival (within 0.10s): {same}")
print(f"  motif describes a different flight               : {diff}")
print(f"  median |gap| {st.median(abs(x) for x in d1):.2f}s")
print()
print("Agreement on the LANDING, restricted to the cards where the two")
print("detectors are demonstrably describing the same serve:")
print(f"  {agree_same}/{both_same} = {agree_same/both_same*100:.1f}%")
