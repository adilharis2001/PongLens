"""Identity fix (hold 2s) vs the deployed window cards, every match of the body corpus.
Adil's ruler (2026-09-08): COVERAGE first -- every scored point has a card behind it.
Missed = a point with nothing behind it; fused = two points under one card. Early/late
against the taps is secondary: the taps are right 70-80% of the time, fuzzier on splits."""
import json, glob, os, statistics as st
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"
NAMES = {"77fc4dee":"Lester","89b35ee0":"Yu Yu Lin","d15aad4d":"Louis","10322849":"Rob","2eab3e3d":"Terry 2","7e02fbb9":"Julian",
         "bfc9b31b":"Anton Aug","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
ORDER = "89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
tot = {}
print(f"{'match':10s} {'pts':>4s} | {'points with a card':^21s} | {'fused':^9s} | {'extra':^9s} | {'end before tap':^14s}")
print(f"{'':10s} {'':4s} | {'deployed':>9s} {'fix':>9s} | {'depl':>4s} {'fix':>4s} | {'depl':>4s} {'fix':>4s} | {'depl':>6s} {'fix':>6s}")
for m in ORDER:
    dep = glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")
    hp = f"{F}/hold_{m}/compare.json"
    if not dep or not os.path.exists(hp): print(f"{NAMES[m]:10s} (not run)"); continue
    a = json.load(open(dep[0]))["summary"]; b = json.load(open(hp))["summary"]
    ca, cb = a["points"] - a["missed"], b["points"] - b["missed"]
    print(f"{NAMES[m]:10s} {a['points']:4d} | {ca:5d} ({a['missed']:2d} missed) {cb:5d} ({b['missed']:2d} missed) | {a['fused']:4d} {b['fused']:4d} | {a['extra']:4d} {b['extra']:4d} | {a['short']:6d} {b['short']:6d}")
    for k in ("points","missed","fused","extra","short","ok","cards"):
        tot.setdefault(k,[0,0]); tot[k][0]+=a[k]; tot[k][1]+=b[k]
if tot:
    P=tot['points'][0]
    print(f"{'TOTAL':10s} {P:4d} | {P-tot['missed'][0]:5d} ({tot['missed'][0]:2d} missed) {P-tot['missed'][1]:5d} ({tot['missed'][1]:2d} missed) | {tot['fused'][0]:4d} {tot['fused'][1]:4d} | {tot['extra'][0]:4d} {tot['extra'][1]:4d} | {tot['short'][0]:6d} {tot['short'][1]:6d}")
    print(f"\ncoverage: deployed {100*(P-tot['missed'][0])/P:.1f}%  fix {100*(P-tot['missed'][1])/P:.1f}%   (points with their own clean card: {tot['ok'][0]} -> {tot['ok'][1]})")
