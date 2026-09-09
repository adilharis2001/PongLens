"""The page's numbers with Adil's row calls applied, per match: the same rules as
src/app/research/v3-serve-detector/rowCalls.ts (a flagged row he called "fine"
is the reference's fault and leaves both the count and its denominator).
  /usr/bin/python3 adjusted_numbers.py [page] [dir-of-compare.json-files]"""
import sys, os, json, glob
here = os.path.dirname(os.path.abspath(__file__))
page = sys.argv[1] if len(sys.argv) > 1 else "body-detector"
root = sys.argv[2] if len(sys.argv) > 2 else f"/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/v3deploy/public/research/{page}"
calls = json.load(open(f"{here}/verdicts_{page}.json")) if os.path.exists(f"{here}/verdicts_{page}.json") else {}
JUNK = {"junk_deleted", "junk_unknown"}
def row_key(r):
    t = r.get("prod_t0") if r.get("prod_t0") is not None else ((r.get("mine") or [{}])[0].get("t0") if r.get("mine") else None)
    import math
    return None if t is None else math.floor(t * 10 + 0.5) / 10
def call_of(m, r):
    k = row_key(r); return None if k is None else (calls.get(m, {}).get(f"{k:.1f}") or {}).get("verdict")
print(f"{'match':10s} {'pts':>4s} | {'missed':>12s} | {'fused':>12s} | {'extra':>12s} | {'early':>12s} | {'junk':>12s} | calls fine/wrong/unsure")
print(f"{'':10s} {'':4s} | {'flagged  adj':>12s} | {'flagged  adj':>12s} | {'flagged  adj':>12s} | {'flagged  adj':>12s} | {'flagged  adj':>12s} |")
T = {}
for p in sorted(glob.glob(f"{root}/*/compare.json")):
    mid = os.path.basename(os.path.dirname(p)); m = mid[:8]
    d = json.load(open(p)); rows = d["rows"]; s = d["summary"]
    pts = [r for r in rows if r.get("kind") == "point"]
    def n(pred): return sum(1 for r in rows if pred(r))
    def ex(pred): return sum(1 for r in rows if pred(r) and call_of(m, r) == "fine")
    missed = (n(lambda r: r.get("kind") == "point" and r.get("verdict") == "missed"), ex(lambda r: r.get("kind") == "point" and r.get("verdict") == "missed"))
    fused = (n(lambda r: r.get("kind") == "point" and r.get("verdict") == "fused"), ex(lambda r: r.get("kind") == "point" and r.get("verdict") == "fused"))
    extra = (n(lambda r: r.get("kind") == "point" and r.get("verdict") == "extra"), ex(lambda r: r.get("kind") == "point" and r.get("verdict") == "extra"))
    early = (n(lambda r: r.get("kind") == "point" and r.get("tap") is not None and r.get("holds_press") is False), ex(lambda r: r.get("kind") == "point" and r.get("tap") is not None and r.get("holds_press") is False))
    junk = (n(lambda r: r.get("verdict") in JUNK), ex(lambda r: r.get("verdict") in JUNK))
    cs = [call_of(m, r) for r in rows]; nc = (cs.count("fine"), cs.count("wrong"), cs.count("unsure"))
    print(f"{m:10s} {len(pts):4d} | {missed[0]:6d} {missed[0]-missed[1]:5d} | {fused[0]:6d} {fused[0]-fused[1]:5d} | {extra[0]:6d} {extra[0]-extra[1]:5d} | {early[0]:6d} {early[0]-early[1]:5d} | {junk[0]:6d} {junk[0]-junk[1]:5d} | {nc[0]}/{nc[1]}/{nc[2]}")
    for k, v in (("pts", (len(pts), 0)), ("missed", missed), ("fused", fused), ("extra", extra), ("early", early), ("junk", junk)):
        t = T.setdefault(k, [0, 0]); t[0] += v[0]; t[1] += v[1]
if T:
    print(f"{'TOTAL':10s} {T['pts'][0]:4d} | " + " | ".join(f"{T[k][0]:6d} {T[k][0]-T[k][1]:5d}" for k in ("missed","fused","extra","early","junk")) + " |")
