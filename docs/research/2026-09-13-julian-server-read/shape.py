import json, collections, itertools
sj=json.load(open("sj.json")); rot=json.load(open("rotation.json"))
cards=sj["cards"]
def card_for(t0):
    b=min(cards, key=lambda c: abs(c["t0"]-t0))
    return b if abs(b["t0"]-t0)<0.6 else None
seq=[]
for r in rot:
    c=card_for(r["t0"])
    if not c or c.get("serve_source")!="v3" or not c.get("serve_half"): continue
    if not r["server"] or not r["sideThisGame"]: continue
    v3="user" if c["serve_half"]==r["sideThisGame"] else "opponent"
    seq.append((r["idx"], r["server"], v3, c["serve_half"], r["source"]))

cm=collections.Counter((t,p) for _,t,p,_,_ in seq)
print("confusion  (rows = your scoring, cols = V3)")
print(f"{'':12s} {'V3 user':>9s} {'V3 opp':>9s}")
for t in ("user","opponent"):
    print(f"  {t:10s} {cm[(t,'user')]:9d} {cm[(t,'opponent')]:9d}")
print()
print("V3 said 'user' on", sum(1 for _,_,p,_,_ in seq if p=="user"), "of", len(seq))
print("you  said 'user' on", sum(1 for _,t,_,_,_ in seq if t=="user"), "of", len(seq))
print()
print("the two sequences, in order (U = the uploader served):")
print("  yours :", "".join("U" if t=="user" else "o" for _,t,_,_,_ in seq))
print("  V3    :", "".join("U" if p=="user" else "o" for _,_,p,_,_ in seq))
print("  match :", "".join("." if t==p else "X" for _,t,p,_,_ in seq))
runs_you=[len(list(g)) for _,g in itertools.groupby(t for _,t,_,_,_ in seq)]
runs_v3=[len(list(g)) for _,g in itertools.groupby(p for _,_,p,_,_ in seq)]
print(f"\nrun lengths — yours: {dict(collections.Counter(runs_you))}")
print(f"run lengths — V3   : {dict(collections.Counter(runs_v3))}")
