"""Serve stamps as EVIDENCE, not rules: can the bodies' own reading separate a real serve from a ball pass?
(a) serves outside every body card: body p after them, by category
(b) two-serve cards: fused vs single-point, by spacing / min p between / ball silence between
(c) serves shortly before a card start: same-point vs not, by continuity"""
import json, glob, math, bisect, numpy as np
names={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
A=dict(rescue=[], covered=[], nowhere=[], prodjunk=[])
B=dict(fused=[], single=[])
C=dict(same=[], other=[])
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    mid=f.split("/")[-2]; m=mid[:8]; d=json.load(open(f)); rows=d["rows"]
    ov=json.load(open(f"bodyfix/public/research/v3-serve-detector/{mid}/overlay.json"))
    sv=sorted(s[1] for s in ov["serves"])
    bx=json.load(open(f"poseretest/ballx_{m}.json")); cr=np.asarray(sorted(bx["crossings"]),float)
    z=np.load(f"poseretest/bodyfirst/bf_{m}.npz"); T=z["T"]; p=z["p"]
    def pwin(a,b):
        s=(T>=a)&(T<=b); return p[s] if s.any() else np.array([0.0])
    def p1max(a,b):  # max 1-second mean of p in [a,b]
        best=0.0
        for t0 in np.arange(a,b,0.25):
            q=pwin(t0,t0+1.0); best=max(best,float(q.mean()))
        return best
    def silence(a,b):  # longest gap between ball crossings in [a,b], gap to edges included
        x=cr[(cr>=a)&(cr<=b)]
        pts=np.concatenate([[a],x,[b]]); return float(np.max(np.diff(pts)))
    cards=sorted([c for r in rows for c in r["mine"]], key=lambda c:c["t0"])
    prod=[(r["prod_t0"], r["prod_t1"], r["kind"], r.get("tap"), r["verdict"]) for r in rows if r.get("prod_t0") is not None]
    first_prod=min(q[0] for q in prod if q[2]=="point")
    for s in sv:
        if any(c["t0"]-0.3<=s<=c["t1"] for c in cards) or s<first_prod: continue
        hit=[q for q in prod if q[0]-0.5<=s<=q[1]]
        feat=dict(m=names[m], s=round(s,1), p1=round(p1max(s-0.5,s+3.0),2), pmean=round(float(pwin(s,s+3).mean()),2), ncr=int(((cr>=s)&(cr<=s+3)).sum()))
        if not hit: A["nowhere"].append(feat)
        elif hit[0][2]=="junk": A["prodjunk"].append(feat)
        elif hit[0][4]=="missed": A["rescue"].append(feat)
        else: A["covered"].append(feat)
    for r in rows:
        if r["kind"]!="point": continue
        for c in r["mine"]:
            ins=[s for s in sv if c["t0"]<=s<=c["t1"]]
            if len(ins)<2: continue
            npts=sum(1 for q in prod if q[2]=="point" and c["t0"]<=(q[3] or q[1]) and c["t1"]>=q[0]+1.0)
            gap=ins[-1]-ins[0]; a,b=ins[0],ins[-1]
            feat=dict(m=names[m], card=f"{c['t0']:.1f}-{c['t1']:.1f}", spacing=round(gap,1), pmin=round(float(pwin(a+0.3,b-0.3).min()) if b-a>0.6 else 1.0,2), silence=round(silence(a,b),1))
            (B["fused"] if npts>=2 else B["single"]).append(feat)
    for i,c in enumerate(cards):
        prev_end=cards[i-1]["t1"] if i else -1
        before=[s for s in sv if max(c["t0"]-4.0, prev_end)<=s<c["t0"]-0.3]
        if not before: continue
        s=before[-1]
        same=[q for q in prod if q[2]=="point" and q[0]-0.5<=s<=q[1] and c["t0"]<=(q[3] or q[1]) and c["t1"]>=q[0]]
        feat=dict(m=names[m], s=round(s,1), lead=round(c["t0"]-s,1), silence=round(silence(s,c["t0"]),1), pmin=round(float(pwin(s,c["t0"]).min()),2))
        (C["same"] if same else C["other"]).append(feat)
def summ(name, rows, keys):
    print(f"\n{name}: n={len(rows)}")
    for k in keys:
        v=np.array([r[k] for r in rows],float)
        if len(v): print(f"   {k:8s} p10 {np.percentile(v,10):.2f} p25 {np.percentile(v,25):.2f} med {np.median(v):.2f} p75 {np.percentile(v,75):.2f} p90 {np.percentile(v,90):.2f}")
print("=== (a) serves outside every body card ===")
for k in A: summ(k, A[k], ["p1","pmean","ncr"])
for thr in (0.5,0.6,0.7):
    print(f"  rule 'serve + body p1max>={thr}':", {k: sum(1 for r in A[k] if r['p1']>=thr) for k in A})
print("\n=== (b) cards holding two serves ===")
for k in B: summ(k, B[k], ["spacing","pmin","silence"])
for sp in (3.0,3.5,4.0):
    for si in (1.0,1.5,2.0):
        print(f"  rule spacing>={sp} & silence>={si}: fused {sum(1 for r in B['fused'] if r['spacing']>=sp and r['silence']>=si)}/{len(B['fused'])}  single {sum(1 for r in B['single'] if r['spacing']>=sp and r['silence']>=si)}/{len(B['single'])}")
for pm in (0.3,0.4,0.5):
    print(f"  rule pmin<={pm}: fused {sum(1 for r in B['fused'] if r['pmin']<=pm)}/{len(B['fused'])}  single {sum(1 for r in B['single'] if r['pmin']<=pm)}/{len(B['single'])}")
print("\n=== (c) a serve shortly before a card start ===")
for k in C: summ(k, C[k], ["lead","silence","pmin"])
for si in (0.8,1.0,1.2,1.5):
    print(f"  rule silence<={si}: same {sum(1 for r in C['same'] if r['silence']<=si)}/{len(C['same'])}  other {sum(1 for r in C['other'] if r['silence']<=si)}/{len(C['other'])}")
json.dump(dict(A=A,B=B,C=C), open("fullframe/serve_evidence.json","w"), indent=0)
