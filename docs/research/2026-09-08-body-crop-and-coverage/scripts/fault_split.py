"""Fused fault-then-re-serve vs a single point carrying two serve stamps (a let, or a false stamp):
what did the ball do between the two stamps? crossings and on-table bounces."""
import json, glob, numpy as np
NAMES={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
import math
def key(t): return f"{math.floor(t*10+0.5)/10:.1f}"
V=json.load(open("fullframe/verdicts_body-detector.json"))
B=dict(fused=[], single=[])
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    mid=f.split("/")[-2]; m=mid[:8]; rows=json.load(open(f))["rows"]
    ov=json.load(open(f"bodyfix/public/research/v3-serve-detector/{mid}/overlay.json")); sv=sorted(s[1] for s in ov["serves"])
    bx=json.load(open(f"poseretest/ballx_{m}.json")); cr=np.asarray(sorted(bx["crossings"]),float); bo=np.asarray(sorted(b[0] for b in bx["bounces_on"]),float)
    z=np.load(f"poseretest/bodyfirst/bf_{m}.npz"); T=z["T"]; p=z["p"]
    prod=[(r["prod_t0"], r["prod_t1"], r["kind"], r.get("tap")) for r in rows if r.get("prod_t0") is not None]
    calls=V.get(m,{})
    for r in rows:
        if r["kind"]!="point": continue
        for cc in r["mine"]:
            ins=[s for s in sv if cc["t0"]<=s<=cc["t1"]]
            if len(ins)<2: continue
            pts=[q for q in prod if q[2]=="point" and cc["t0"]<=(q[3] or q[1]) and cc["t1"]>=q[0]+1.0]
            s1,s2=ins[0],ins[1]
            sel=(T>=s1+0.3)&(T<=s2-0.3)
            fe=dict(m=NAMES[m], card=f"{cc['t0']:.1f}-{cc['t1']:.1f}", s1=round(s1,1), s2=round(s2,1), gap=round(s2-s1,1),
                    ncr=int(((cr>s1+0.2)&(cr<s2-0.2)).sum()), nbo=int(((bo>s1+0.2)&(bo<s2-0.2)).sum()),
                    pmin=round(float(p[sel].min()),2) if sel.any() else 1.0,
                    call=calls.get(key(r["prod_t0"]),{}).get("verdict"))
            (B["fused"] if len(pts)>=2 else B["single"]).append(fe)
for k in B:
    v=B[k]; print(f"\n{k}: n={len(v)}")
    for kk in ("gap","ncr","nbo","pmin"):
        a=np.array([x[kk] for x in v],float); print(f"   {kk:5s} p10 {np.percentile(a,10):.2f} p25 {np.percentile(a,25):.2f} med {np.median(a):.2f} p75 {np.percentile(a,75):.2f} p90 {np.percentile(a,90):.2f}")
for thr in (0,1):
    print(f"rule crossings between the two serves <= {thr}: fused {sum(1 for x in B['fused'] if x['ncr']<=thr)}/{len(B['fused'])}  single {sum(1 for x in B['single'] if x['ncr']<=thr)}/{len(B['single'])}")
print("rule crossings==0 and bounces<=2:", f"fused {sum(1 for x in B['fused'] if x['ncr']==0 and x['nbo']<=2)}/{len(B['fused'])}  single {sum(1 for x in B['single'] if x['ncr']==0 and x['nbo']<=2)}/{len(B['single'])}")
print("rule crossings==0 and gap>=3.0:", f"fused {sum(1 for x in B['fused'] if x['ncr']==0 and x['gap']>=3.0)}/{len(B['fused'])}  single {sum(1 for x in B['single'] if x['ncr']==0 and x['gap']>=3.0)}/{len(B['single'])}")
print("\nfused, the ones you called wrong/unsure:")
for x in B["fused"]:
    if x["call"] in ("wrong","unsure"): print("  ", x)
print("\nsingle with 0 crossings between (would be false splits):")
for x in B["single"]:
    if x["ncr"]==0: print("  ", x)
