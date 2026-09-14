import json
NET_V=2.74/2.0
sj=json.load(open("sj.json")); rot=json.load(open("rotation.json"))
cards=sj["cards"]
def card_for(t0):
    b=min(cards, key=lambda c: abs(c["t0"]-t0))
    return b if abs(b["t0"]-t0)<0.6 else None
BAD=set(json.load(open("bad.json")))
shown=0
for r in rot:
    if r["idx"] not in BAD: continue
    c=card_for(r["t0"])
    if not c: continue
    a=c["serve_arrival_s"]
    print(f"\n=== point {r['idx']}  card {c['t0']:.2f}-{c['t1']:.2f}  "
          f"you say {r['server']} ({r['source']}), V3 says {c['serve_half']} end")
    print(f"    V3's bounce at {a:.2f} (contact stamped {c['serve_s']:.2f} = arrival - 0.81)")
    onsurf=[b for b in c["bounces"] if b.get("onSurface") and b.get("v") is not None]
    print(f"    on-surface bounces in the card:")
    for b in onsurf[:7]:
        half = "near" if b["v"]<NET_V else "far"
        mark = "  <-- V3 qualified here" if abs(b["t"]-a)<0.05 else ""
        first = "  (FIRST in the card)" if b is onsurf[0] else ""
        print(f"      {b['t']:7.2f}  {half:4s}  v={b['v']:.2f}{first}{mark}")
    if not any(abs(b["t"]-a)<0.05 for b in onsurf):
        print(f"      (V3's bounce at {a:.2f} is NOT among them — only V3 saw it)")
    print(f"    crossings: {[round(x,2) for x in (c.get('crossings') or [])][:8]}")
    shown += 1
    if shown >= 5: break
