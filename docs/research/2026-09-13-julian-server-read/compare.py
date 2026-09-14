"""V3's end read against Adil's own scoring, on the match he verified."""
import json, collections
NET_V = 2.74/2.0
sj=json.load(open("sj.json")); rot=json.load(open("rotation.json"))
mj=json.load(open("mj.json"))
cards=sj["cards"]
print("notes:", [n for n in (mj.get("notes") or []) if "points v2" in n or "bodies" in n][:2])
src=collections.Counter(c.get("serve_source") for c in cards)
print("\nserve_source across", len(cards), "cards:", dict(src))

def card_for(t0):
    best=min(cards, key=lambda c: abs(c["t0"]-t0))
    return best if abs(best["t0"]-t0)<0.6 else None

rows=[]
for r in rot:
    c=card_for(r["t0"])
    if not c or c.get("serve_source")!="v3" or not c.get("serve_half"): continue
    if not r["server"] or not r["sideThisGame"]: continue
    v3_who = "user" if c["serve_half"]==r["sideThisGame"] else "opponent"
    rows.append(dict(idx=r["idx"], t0=r["t0"], rot=r["server"], src=r["source"],
                     half=c["serve_half"], v3=v3_who, ok=(v3_who==r["server"]), card=c))
agree=sum(1 for x in rows if x["ok"])
print(f"\nV3 named an end on {len(rows)} of the {len(rot)} scored points")
print(f"  agrees with your scoring : {agree}")
print(f"  disagrees                : {len(rows)-agree}   ({(len(rows)-agree)/len(rows)*100:.0f}%)")
json.dump([{k:v for k,v in x.items() if k!="card"} for x in rows], open("rows.json","w"), indent=1)
json.dump([x["idx"] for x in rows if not x["ok"]], open("bad.json","w"))
print("\nwrong on points:", [x["idx"] for x in rows if not x["ok"]])
