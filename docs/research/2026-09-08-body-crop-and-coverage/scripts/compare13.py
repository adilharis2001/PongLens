"""All 13 matches, correct names: shipped payloads (fixed_export_keep) vs pages_<tag>; the page ruler,
the problems left after Adil's calls, and what happened to every row he called wrong or unsure."""
import json, glob, os, sys, math
S=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); F=f"{S}/fullframe"
tag=sys.argv[1]
NAMES={"10322849":"Rob","1c08539e":"Tim","2eab3e3d":"Terry 2","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","77fc4dee":"Lester","7e02fbb9":"Julian","89b35ee0":"Yu Yu Lin","95a07786":"Wayne Wei","bfc9b31b":"Anton","cebaa6d4":"Rowel","d15aad4d":"Louis","f3237587":"Koko 2"}
ORDER="77fc4dee 89b35ee0 7e02fbb9 bfc9b31b d15aad4d 10322849 2eab3e3d f3237587 cebaa6d4 5fd822ec 5c90151a 95a07786 1c08539e".split()
CALLS=json.load(open(f"{F}/verdicts_body-detector.json"))
def key(t): return f"{math.floor(t*10+0.5)/10:.1f}"
def rkey(r):
    if r.get("prod_t0") is not None: return key(r["prod_t0"])
    return key(r["mine"][0]["t0"]) if r.get("mine") else None
def early(rows):
    n=0
    for r in rows:
        if r.get("kind")!="point": continue
        ref=r.get("tap") or r.get("prod_t1")
        n+=sum(1 for c in r.get("mine") or [] if ref and ref-c["t1"]>2)
    return n
def after_calls(m, rows):
    n=dict(missed=0,fused=0,extra=0,early=0,junk=0)
    for r in rows:
        k=rkey(r)
        if k and (CALLS.get(m,{}).get(k) or {}).get("verdict")=="fine": continue
        v=r["verdict"]
        if r["kind"]=="point":
            if v in n: n[v]+=1
            ref=r.get("tap") or r.get("prod_t1")
            if ref and any(ref-c["t1"]>2 for c in r.get("mine") or []): n["early"]+=1
        elif v in ("junk_deleted","junk_unknown"): n["junk"]+=1
    return n
K=("cards","ok","missed","fused","extra","junk_deleted","short")
print(f"{'match':10s} | {'shipped':^48s} | {tag:^48s}")
print(f"{'':10s} | "+" ".join(f"{k[:5]:>5s}" for k in K)+" >2s-e | "+" ".join(f"{k[:5]:>5s}" for k in K)+" >2s-e")
T={k:[0,0] for k in K}; E=[0,0]; AC=[dict(missed=0,fused=0,extra=0,early=0,junk=0) for _ in range(2)]
for m in ORDER:
    ids=[os.path.basename(x)[:-5] for x in glob.glob(f"{F}/fixed_export_keep/{m}*.json")]
    if not ids: continue
    a=json.load(open(f"{F}/fixed_export_keep/{ids[0]}.json")); bp=f"{F}/pages_{tag}/{ids[0]}.json"
    if not os.path.exists(bp): print(f"{NAMES[m]:10s} | (no candidate page)"); continue
    b=json.load(open(bp))
    line=f"{NAMES[m]:10s} | "
    for i,d in enumerate((a,b)):
        s=d["summary"]; line+=" ".join(f"{s.get(k,0):5d}" for k in K)+f" {early(d['rows']):5d} | "
        for k in K: T[k][i]+=s.get(k,0)
        E[i]+=early(d["rows"])
        ac=after_calls(m,d["rows"])
        for k in ac: AC[i][k]+=ac[k]
    print(line)
print(f"{'TOTAL':10s} | "+" ".join(f"{T[k][0]:5d}" for k in K)+f" {E[0]:5d} | "+" ".join(f"{T[k][1]:5d}" for k in K)+f" {E[1]:5d}")
print("problems left after your calls (fine rows excused):  shipped", AC[0], " ", tag, AC[1])
print("\nYour wrong/unsure rows, shipped -> candidate:")
for m in ORDER:
    ids=[os.path.basename(x)[:-5] for x in glob.glob(f"{F}/fixed_export_keep/{m}*.json")]
    if not ids or not os.path.exists(f"{F}/pages_{tag}/{ids[0]}.json"): continue
    a=json.load(open(f"{F}/fixed_export_keep/{ids[0]}.json")); b=json.load(open(f"{F}/pages_{tag}/{ids[0]}.json"))
    def bykey(d): return {rkey(r):r for r in d["rows"] if rkey(r)}
    A,Bk=bykey(a),bykey(b)
    for k,c in sorted(CALLS.get(m,{}).items(), key=lambda kv: float(kv[0])):
        if c["verdict"]=="fine": continue
        ra=A.get(k); rb=Bk.get(k)
        def desc(r):
            if r is None: return "(row gone)"
            mine="; ".join(f"{x['t0']:.1f}-{x['t1']:.1f}" for x in r["mine"]) or "no card"
            return f"{r['verdict']:12s} {mine}"
        changed = "" if (ra and rb and desc(ra)==desc(rb)) else "  <-- changed"
        print(f"  {NAMES[m]:9s} {c['verdict']:6s} row {k:>7s}: {desc(ra)}  ->  {desc(rb)}{changed}")
