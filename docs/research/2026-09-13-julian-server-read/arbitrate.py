"""Neither side is ground truth here, so ask the ball.

A serve's signature is unmistakable: a bounce on one half, a net crossing,
then a bounce on the other half within about half a second. Where the card
shows that, the first half IS the server's, and it can judge both V3 and
the rotation.
"""
import json, collections
NET_V=2.74/2.0
sj=json.load(open("sj.json")); rot=json.load(open("rotation.json"))
cards=sj["cards"]
def card_for(t0):
    b=min(cards, key=lambda c: abs(c["t0"]-t0))
    return b if abs(b["t0"]-t0)<0.6 else None

def geometry_says(c):
    """The half the serve's first bounce is on, from the pair signature."""
    onsurf=[b for b in c["bounces"] if b.get("onSurface") and b.get("v") is not None]
    cr=sorted(c.get("crossings") or [])
    for i, b in enumerate(onsurf):
        h = "near" if b["v"]<NET_V else "far"
        for nxt in onsurf[i+1:]:
            dt = nxt["t"]-b["t"]
            if dt > 0.70: break
            if dt < 0.15: continue
            h2 = "near" if nxt["v"]<NET_V else "far"
            if h2 == h: continue
            if not any(b["t"] < x < nxt["t"] for x in cr): continue
            return h, b["t"], dt
        if i >= 2: break     # only the opening of the card can be the serve
    return None, None, None

tab=collections.Counter(); rows=[]
for r in rot:
    c=card_for(r["t0"])
    if not c or c.get("serve_source")!="v3" or not c.get("serve_half"): continue
    if not r["server"] or not r["sideThisGame"]: continue
    v3_half=c["serve_half"]
    rot_half = r["sideThisGame"] if r["server"]=="user" else ("far" if r["sideThisGame"]=="near" else "near")
    g, gt, gdt = geometry_says(c)
    agree = v3_half==rot_half
    if g is None: verdict="ball is silent"
    elif g==v3_half and g!=rot_half: verdict="V3 right, ROTATION wrong"
    elif g==rot_half and g!=v3_half: verdict="rotation right, V3 wrong"
    elif g==v3_half and g==rot_half: verdict="both right"
    else: verdict="ball disagrees with both"
    tab[(("agree" if agree else "disagree"), verdict)] += 1
    if not agree: rows.append((r["idx"], r["source"], v3_half, rot_half, g, gdt))

print("Where V3 and your scoring DISAGREE (17 points), what does the ball say?")
for (a,v),n in sorted(tab.items()):
    if a=="disagree": print(f"   {v:28s} {n:3d}")
print("\nWhere they agree (35 points), as a control:")
for (a,v),n in sorted(tab.items()):
    if a=="agree": print(f"   {v:28s} {n:3d}")
print(f"\n{'pt':>4s} {'rotation from':>14s} {'V3':>6s} {'rotation':>9s} {'ball':>6s} {'flight':>7s}")
for idx,src,v3h,rh,g,gdt in rows:
    print(f"{idx:4d} {src:>14s} {v3h:>6s} {rh:>9s} {str(g):>6s} "
          f"{(f'{gdt:.2f}s' if gdt else '—'):>7s}")
