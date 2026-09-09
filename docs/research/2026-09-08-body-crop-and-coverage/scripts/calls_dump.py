"""Join Adil's row calls to the live page rows and print them for reading."""
import json, math, glob, os, sys
names={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
def key(t): return math.floor(t*10+0.5)/10
v=json.load(open("fullframe/verdicts_body-detector.json"))
only=set(sys.argv[1:])  # verdict filter
for f in sorted(glob.glob("bodyfix/public/research/body-detector/*/compare.json")):
    m=f.split("/")[-2][:8]
    if m not in v: continue
    d=json.load(open(f)); calls=v[m]
    print(f"\n######## {names[m]} ({m})  page summary: {json.dumps({k:d['summary'][k] for k in ['cards','points','ok','short','extra','missed','fused','junk_deleted','junk_unknown']})}")
    seen=set()
    for r in d["rows"]:
        t = r["prod_t0"] if r.get("prod_t0") is not None else (r["mine"][0]["t0"] if r["mine"] else None)
        if t is None: continue
        k=f"{key(t):.1f}"
        if k not in calls: continue
        seen.add(k); c=calls[k]
        if only and c["verdict"] not in only: continue
        mine="; ".join(f"[{x['t0']:.1f}-{x['t1']:.1f} {x['why']}{' HOLDS' if x.get('holds_tap') else ''}]" for x in r["mine"]) or "(no card)"
        prod=f"prod {r['prod_t0']}-{r['prod_t1']} tap {r['tap']}" if r.get("prod_t0") is not None else "prod: none"
        print(f"  {c['verdict'].upper():6s} row {k:>7s} {r['kind']:5s} idx={r.get('idx')} page={r['verdict']:12s} | {prod} | mine {mine}")
        print(f"         page note: {r.get('note')}")
        if c.get("note"): print(f"         ADIL: {c['note']}")
    miss=[k for k in calls if k not in seen]
    if miss: print("  (calls with no row on the live page:", miss, ")")
