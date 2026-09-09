"""Points the body DECODER found (dump segments) that the page does not show: killed or truncated by the
confirm-mode refine / resolve step, not by the model. Also cards whose front the page cut off."""
import json, glob, math, numpy as np
NAMES={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
def covers(seg, a, ref): return seg[0] <= ref and seg[1] >= a + 1.0
tot=dict(points=0, page_missed=0, decoder_found_page_missed=0, decoder_missed=0, front_cut=0, front_cut_pts=0, end_cut=0, killed_list=[], cut_list=[])
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    mid=f.split("/")[-2]; m=mid[:8]; d=json.load(open(f)); rows=d["rows"]
    z=np.load(f"poseretest/bodyfirst/bf_{m}.npz"); segs=[(float(a)-0.4, float(b)+0.8) for a,b in np.asarray(z["segs"]).reshape(-1,2)]  # padded like cards
    cards=sorted([c for r in rows for c in r["mine"]], key=lambda c:c["t0"])
    first_prod=min(r["prod_t0"] for r in rows if r["kind"]=="point" and r.get("prod_t0") is not None)
    for r in rows:
        if r["kind"]!="point" or r.get("prod_t0") is None: continue
        a=r["prod_t0"]; ref=r.get("tap") or r["prod_t1"]
        tot["points"]+=1
        dseg=[s for s in segs if covers(s,a,ref)]; pc=[c for c in cards if covers((c["t0"],c["t1"]),a,ref)]
        if r["verdict"]=="missed":
            tot["page_missed"]+=1
            if dseg: tot["decoder_found_page_missed"]+=1; tot["killed_list"].append(f"{NAMES[m]} point {a:.1f}-{r['prod_t1']:.1f}: decoder seg {dseg[0][0]:.1f}-{dseg[0][1]:.1f}, page has nothing")
            else: tot["decoder_missed"]+=1
        elif dseg and pc:
            # same point: did refine cut the front or the end by > 1.5 s?
            ds=dseg[0]; c=pc[0]
            if c["t0"]-ds[0] > 1.5:
                tot["front_cut"]+=1
                if a >= first_prod: tot["cut_list"].append(f"{NAMES[m]} point {a:.1f}: decoder {ds[0]:.1f}-{ds[1]:.1f} -> page {c['t0']:.1f}-{c['t1']:.1f} (front -{c['t0']-ds[0]:.1f}s)")
            if ds[1]-c["t1"] > 1.5: tot["end_cut"]+=1
print({k:v for k,v in tot.items() if not k.endswith("_list")})
print("\nkilled by refine/resolve:"); [print("  ",x) for x in tot["killed_list"]]
print("\nfront cut by refine/resolve (>1.5 s):"); [print("  ",x) for x in tot["cut_list"][:60]]
