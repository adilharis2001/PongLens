"""Two more separations. (1) Does the body ONSET model (edge 'on' log-odds, the thing snap_on reads) agree
with the serve stamp? rescue vs nowhere vs covered. (2) Fused fault+re-serve vs single-point-with-two-stamps:
net crossings and on-table bounces between the two serve stamps."""
import json, glob, math, sys, numpy as np, os
os.chdir("poseretest"); sys.path.insert(0, os.getcwd())
import bodyfirst
names={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
hold={"5fd822ec","95a07786","5c90151a","1c08539e"}
c=bodyfirst._cfg(["dur_w=8.0","snap_on=1.0","ball_floor=0.6","ball_floor_tempo=3"])
A=dict(rescue=[], covered=[], nowhere=[]); B=dict(fused=[], single=[])
for m in MS:
    others=[k for k in MS if k!=m and k not in hold]
    key=bodyfirst._edgekey(m, others, c, "VFINAL2")
    ep=f"{os.environ.get('EDGE_DIR', '../fullframe/deployed_bodyedge')}/{key}.npz"
    if not os.path.exists(ep): print("no edge cache for", names[m], key); continue
    z=np.load(ep); on=z["on"]; off=z["off"]
    d=np.load(f"{os.environ.get('DUMP_DIR', 'bodyfirst')}/bf_{m}.npz"); T=d["T"]; p=d["p"]
    if len(on)!=len(T): print("edge/T mismatch", names[m], len(on), len(T)); continue
    mid=[x for x in glob.glob(f"../bodyfix/public/research/body-detector/{m}*")][0].split("/")[-1]
    rows=json.load(open(f"../bodyfix/public/research/body-detector/{mid}/compare.json"))["rows"]
    ov=json.load(open(f"../bodyfix/public/research/v3-serve-detector/{mid}/overlay.json")); sv=sorted(s[1] for s in ov["serves"])
    bx=json.load(open(f"ballx_{m}.json")); cr=np.asarray(sorted(bx["crossings"]),float); bo=np.asarray(sorted(b[0] for b in bx["bounces_on"]),float)
    def onmax(a,b):
        s=(T>=a)&(T<=b); return float(on[s].max()) if s.any() else -9.0
    cards=sorted([cc for r in rows for cc in r["mine"]], key=lambda cc:cc["t0"])
    prod=[(r["prod_t0"], r["prod_t1"], r["kind"], r.get("tap"), r["verdict"]) for r in rows if r.get("prod_t0") is not None]
    first_prod=min(q[0] for q in prod if q[2]=="point")
    for s in sv:
        if any(cc["t0"]-0.3<=s<=cc["t1"] for cc in cards) or s<first_prod: continue
        hit=[q for q in prod if q[0]-0.5<=s<=q[1]]
        f=dict(m=names[m], s=round(s,1), on=round(onmax(s-1.0,s+1.0),2), on2=round(onmax(s-2.0,s+2.0),2))
        if not hit: A["nowhere"].append(f)
        elif hit[0][2]=="junk": pass
        elif hit[0][4]=="missed": A["rescue"].append(f)
        else: A["covered"].append(f)
    for r in rows:
        if r["kind"]!="point": continue
        for cc in r["mine"]:
            ins=[s for s in sv if cc["t0"]<=s<=cc["t1"]]
            if len(ins)<2: continue
            npts=sum(1 for q in prod if q[2]=="point" and cc["t0"]<=(q[3] or q[1]) and cc["t1"]>=q[0]+1.0)
            s1,s2=ins[0],ins[1]
            f=dict(m=names[m], card=f"{cc['t0']:.1f}-{cc['t1']:.1f}", s1=round(s1,1), s2=round(s2,1), ncr=int(((cr>s1+0.2)&(cr<s2-0.2)).sum()), nbo=int(((bo>s1+0.2)&(bo<s2-0.2)).sum()), on2=round(onmax(s2-1.0,s2+1.0),2))
            (B["fused"] if npts>=2 else B["single"]).append(f)
def summ(name, rows, keys):
    print(f"\n{name}: n={len(rows)}")
    for k in keys:
        v=np.array([r[k] for r in rows],float)
        if len(v): print(f"   {k:5s} p10 {np.percentile(v,10):.2f} p25 {np.percentile(v,25):.2f} med {np.median(v):.2f} p75 {np.percentile(v,75):.2f} p90 {np.percentile(v,90):.2f}")
print("=== onset model at serve stamps outside every card ===")
for k in A: summ(k, A[k], ["on","on2"])
for thr in (0.0, 0.5, 1.0, 1.5, 2.0):
    print(f"  rule on(+-1s)>={thr}:", {k: f"{sum(1 for r in A[k] if r['on']>=thr)}/{len(A[k])}" for k in A})
print("\n=== between the two serve stamps of a card ===")
for k in B: summ(k, B[k], ["ncr","nbo","on2"])
for thr in (0,1):
    print(f"  rule crossings between <= {thr}: fused {sum(1 for r in B['fused'] if r['ncr']<=thr)}/{len(B['fused'])}  single {sum(1 for r in B['single'] if r['ncr']<=thr)}/{len(B['single'])}")
print("  rule crossings==0 & bounces<=2:", f"fused {sum(1 for r in B['fused'] if r['ncr']==0 and r['nbo']<=2)}/{len(B['fused'])} single {sum(1 for r in B['single'] if r['ncr']==0 and r['nbo']<=2)}/{len(B['single'])}")
print("\nfused cards, detail:"); [print("  ", r) for r in B["fused"]]
json.dump(dict(A=A,B=B), open("../fullframe/serve_witness.json","w"), indent=0)
