"""The pipeline's own dead-ball stretches (overlay/compare 'dead') as the splitter: inside a body card,
a dead stretch followed by a serve stamp = the first point ended and a second began. Fused vs single."""
import json, glob, math, numpy as np
NAMES={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
def key(t): return f"{math.floor(t*10+0.5)/10:.1f}"
V=json.load(open("fullframe/verdicts_body-detector.json"))
R=dict(fused=dict(n=0, dead_inside=0, dead_then_serve=0, ex=[]), single=dict(n=0, dead_inside=0, dead_then_serve=0, ex=[]))
ndead=0
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    mid=f.split("/")[-2]; m=mid[:8]; d=json.load(open(f)); rows=d["rows"]; dead=[tuple(x) for x in d.get("dead",[])]
    ndead+=len(dead)
    ov=json.load(open(f"bodyfix/public/research/v3-serve-detector/{mid}/overlay.json")); sv=sorted(s[1] for s in ov["serves"])
    prod=[(r["prod_t0"], r["prod_t1"], r["kind"], r.get("tap")) for r in rows if r.get("prod_t0") is not None]
    calls=V.get(m,{})
    for r in rows:
        if r["kind"]!="point": continue
        for cc in r["mine"]:
            pts=[q for q in prod if q[2]=="point" and cc["t0"]<=(q[3] or q[1]) and cc["t1"]>=q[0]+1.0]
            k="fused" if len(pts)>=2 else "single"
            R[k]["n"]+=1
            din=[(a,b) for a,b in dead if a>=cc["t0"]+0.5 and b<=cc["t1"]-0.5]
            if not din: continue
            R[k]["dead_inside"]+=1
            ins=[s for s in sv if cc["t0"]<=s<=cc["t1"]]
            # a serve stamp after a dead stretch, inside the card
            hit=[(a,b,s) for a,b in din for s in ins if b-0.3<=s<=b+4.0 and s>a]
            if hit:
                R[k]["dead_then_serve"]+=1
                call=calls.get(key(r["prod_t0"]),{}).get("verdict")
                if len(R[k]["ex"])<40: R[k]["ex"].append(f"{NAMES[m]} card {cc['t0']:.1f}-{cc['t1']:.1f} dead {hit[0][0]:.1f}-{hit[0][1]:.1f} serve {hit[0][2]:.1f} (prod pts {len(pts)}, call {call})")
print("dead stretches in the 13 payloads:", ndead)
for k in R: print(k, {kk:v for kk,v in R[k].items() if kk!="ex"})
print("\nfused, dead then serve (would split RIGHT):"); [print("  ",x) for x in R["fused"]["ex"]]
print("\nsingle, dead then serve (would split WRONG):"); [print("  ",x) for x in R["single"]["ex"]]
