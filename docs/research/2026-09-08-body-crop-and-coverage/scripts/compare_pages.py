"""Page ruler: the shipped payloads (fixed_export_keep) vs a candidate set (pages_<tag>)."""
import json, glob, os, sys
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"; F = f"{S}/fullframe"
tag = sys.argv[1] if len(sys.argv) > 1 else "ball"
NAMES = {"77fc4dee":"Lester","10322849":"Rob","2eab3e3d":"Terry 2","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
ORDER = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
K = ("cards","ok","missed","fused","extra","junk_deleted","short")
import os as _os
CALLS = json.load(open(f"{F}/verdicts_body-detector.json")) if _os.path.exists(f"{F}/verdicts_body-detector.json") else {}
def _key(r):
    import math
    if r.get("prod_t0") is not None: return f"{math.floor(r['prod_t0']*10+0.5)/10:.1f}"
    mm = r.get("mine") or []
    return f"{math.floor(mm[0]['t0']*10+0.5)/10:.1f}" if mm else None
def excused(m, r):
    k = _key(r); return bool(k) and (CALLS.get(m, {}).get(k) or {}).get("verdict") == "fine"
def problems_after_calls(m, rows):
    """flagged rows Adil has NOT excused: missed, fused, extra, early(>2s), junk"""
    n = dict(missed=0, fused=0, extra=0, early=0, junk=0)
    for r in rows:
        if excused(m, r): continue
        v = r.get("verdict")
        if r.get("kind") == "point":
            if v in n: n[v] += 1
            ref = r.get("tap") or r.get("prod_t1")
            if ref and any(ref - c["t1"] > 2 for c in (r.get("mine") or [])): n["early"] += 1
        elif v in ("junk_deleted", "junk_unknown"): n["junk"] += 1
    return n
def early(rows):
    n = 0
    for r in rows:
        if r.get("kind") != "point": continue
        ref = r.get("tap") or r.get("prod_t1")
        for c in r.get("mine") or []:
            if ref and ref - c["t1"] > 2: n += 1
    return n
print(f"{'match':10s} | {'shipped today':^50s} | {'with the ball family (' + tag + ')':^50s}")
print(f"{'':10s} | " + " ".join(f"{k[:5]:>5s}" for k in K) + " >2s-e | " + " ".join(f"{k[:5]:>5s}" for k in K) + " >2s-e")
T = {k: [0, 0] for k in K}; E = [0, 0]
for m in ORDER:
    a = glob.glob(f"{F}/fixed_export_keep/{m}-*.json"); b = glob.glob(f"{F}/pages_{tag}/{m}-*.json")
    if not a or not b: print(f"{NAMES[m]:10s} (not run)"); continue
    A = json.load(open(a[0])); B = json.load(open(b[0])); sa, sb = A["summary"], B["summary"]; ea, eb = early(A["rows"]), early(B["rows"])
    print(f"{NAMES[m]:10s} | " + " ".join(f"{sa[k]:5d}" for k in K) + f" {ea:5d} | " + " ".join(f"{sb[k]:5d}" for k in K) + f" {eb:5d}")
    for k in K: T[k][0] += sa[k]; T[k][1] += sb[k]
    E[0] += ea; E[1] += eb
print(f"{'TOTAL':10s} | " + " ".join(f"{T[k][0]:5d}" for k in K) + f" {E[0]:5d} | " + " ".join(f"{T[k][1]:5d}" for k in K) + f" {E[1]:5d}")
if CALLS:
    print("\nafter Adil's calls (rows he called fine set aside; only matches with calls change):")
    for m in ORDER:
        if m not in CALLS: continue
        a = glob.glob(f"{F}/fixed_export_keep/{m}-*.json"); b = glob.glob(f"{F}/pages_{tag}/{m}-*.json")
        if not a or not b: continue
        pa = problems_after_calls(m, json.load(open(a[0]))["rows"]); pb = problems_after_calls(m, json.load(open(b[0]))["rows"])
        print(f"  {NAMES[m]:10s} shipped: {pa}   candidate: {pb}   ({sum(len(v) for v in [CALLS[m]])} calls)")
b = glob.glob(f"{F}/pages_{tag}/95a07786-*.json")
if b:
    rows = json.load(open(b[0]))["rows"]
    for r in rows:
        if r.get("kind") == "point" and r.get("app_no") in (11, 21, 60, 61):
            print(f"  Wayne your card {r['app_no']}: production {r['prod_t0']:.1f}-{r['prod_t1']:.1f}; body " + ", ".join(f"{c['t0']:.1f}-{c['t1']:.1f}" for c in (r.get('mine') or [])))
