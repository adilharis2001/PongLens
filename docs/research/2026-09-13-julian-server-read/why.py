"""What separates the 17 V3 got wrong from the 35 it got right."""
import json, collections, statistics as st
NET_V=2.74/2.0
sj=json.load(open("sj.json")); rot=json.load(open("rotation.json"))
cards=sj["cards"]
def card_for(t0):
    b=min(cards, key=lambda c: abs(c["t0"]-t0))
    return b if abs(b["t0"]-t0)<0.6 else None

groups=collections.defaultdict(list)
for r in rot:
    c=card_for(r["t0"])
    if not c or c.get("serve_source")!="v3" or not c.get("serve_half"): continue
    if not r["server"] or not r["sideThisGame"]: continue
    v3="user" if c["serve_half"]==r["sideThisGame"] else "opponent"
    groups["right" if v3==r["server"] else "wrong"].append((r,c))

def feats(c):
    a=c["serve_arrival_s"]; s=c["serve_s"]
    bs=c.get("bounces") or []
    cr=sorted(c.get("crossings") or [])
    # is V3's bounce one the normal detector also saw?
    match=next((b for b in bs if abs(b["t"]-a)<0.05), None)
    # how far from the net is it, if we can see it?
    dist=None if not match or match.get("v") is None else abs(match["v"]-NET_V)
    # did the ball already cross before V3's bounce? then it is not the first
    crossed_before = any(s < t < a for t in cr)
    # does the crossing ORDER dispute the half?
    after=[t for t in cr if t>s]
    disputes=False
    if after and a < after[0]:
        nxt=next((b for b in bs if b["t"]>after[0] and b.get("v") is not None
                  and b.get("onSurface")), None)
        if nxt:
            recv = "near" if nxt["v"]<NET_V else "far"
            disputes = ("far" if recv=="near" else "near") != c["serve_half"]
    return dict(in_list=match is not None, dist=dist,
                crossed_before=crossed_before, disputes=disputes)

print(f"{'':22s} {'right (35)':>12s} {'wrong (17)':>12s}")
rows=[]
for k in ("right","wrong"):
    rows.append([feats(c) for _r,c in groups[k]])
R,W=rows
def pct(g, f): return f"{sum(1 for x in g if f(x))}/{len(g)} ({sum(1 for x in g if f(x))/len(g)*100:.0f}%)"
print(f"{'V3 bounce not in the':22s} {pct(R, lambda x: not x['in_list']):>12s} {pct(W, lambda x: not x['in_list']):>12s}")
print(f"{'  normal bounce list':22s}")
print(f"{'ball had ALREADY':22s} {pct(R, lambda x: x['crossed_before']):>12s} {pct(W, lambda x: x['crossed_before']):>12s}")
print(f"{'  crossed the net':22s}")
print(f"{'crossing order':22s} {pct(R, lambda x: x['disputes']):>12s} {pct(W, lambda x: x['disputes']):>12s}")
print(f"{'  disputes the half':22s}")
for k,g in (("right",R),("wrong",W)):
    d=[x["dist"] for x in g if x["dist"] is not None]
    if d: print(f"  {k}: distance of V3's bounce from the net, median {st.median(d):.2f} m (n={len(d)})")
