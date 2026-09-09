"""Fixed export vs baseline export (same bundles, same day), nine matches."""
import json, glob, os
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"; V = f"{S}/v3deploy/public/research/body-detector"
NAMES = {"77fc4dee":"Lester","10322849":"Rob","2eab3e3d":"Terry 2","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
ORDER = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
K = ("cards","ok","missed","fused","extra","junk_deleted","short")
print(f"{'match':10s} | {'baseline (deployed settings)':^44s} | {'fixed (ball end + after first)':^44s}")
print(f"{'':10s} | " + " ".join(f"{k[:5]:>5s}" for k in K) + "  | " + " ".join(f"{k[:5]:>5s}" for k in K))
T = {k: [0, 0] for k in K}
for m in ORDER:
    bp = glob.glob(f"{F}/base_export/{m}-*.json"); fp = glob.glob(f"{V}/{m}-*/compare.json")
    if not bp or not fp: print(f"{NAMES[m]:10s} (not run)"); continue
    a = json.load(open(bp[0]))["summary"]; b = json.load(open(fp[0]))["summary"]
    print(f"{NAMES[m]:10s} | " + " ".join(f"{a[k]:5d}" for k in K) + "  | " + " ".join(f"{b[k]:5d}" for k in K))
    for k in K: T[k][0] += a[k]; T[k][1] += b[k]
print(f"{'TOTAL':10s} | " + " ".join(f"{T[k][0]:5d}" for k in K) + "  | " + " ".join(f"{T[k][1]:5d}" for k in K))
fp = glob.glob(f"{V}/95a07786-*/compare.json")
if fp:
    rows = json.load(open(fp[0]))["rows"]
    cards = sorted({(c["n"], c["t0"], c["t1"], c.get("why")) for r in rows for c in (r.get("mine") or [])})
    print("\nWayne Wei, fixed: cards in the two stretches")
    for lo, hi in ((76, 90), (124, 143)):
        print(f"  {lo}-{hi}s:", [(n, round(a, 1), round(b, 1), w) for n, a, b, w in cards if b >= lo and a <= hi])
    ext = [c for c in cards if c[3] and "kept open" in c[3]]
    print(f"  cards whose end the ball kept open: {len(ext)} of {len(cards)}")
