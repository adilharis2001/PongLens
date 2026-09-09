"""Coverage from the body model's own dumps, deployed vs identity fix, scored with
bodyfirst.score against the same production/tap points the deploy run used. Needs no
compare page, so it works for matches whose crossings bundle was swept."""
import sys, os, glob, numpy as np
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"; L = f"{S}/poseretest"
os.chdir(L); sys.path.insert(0, L); os.environ.setdefault("V3_BF_SMOOTH", "0.5")
import bodyfirst
NAMES = {"77fc4dee":"Lester","89b35ee0":"Yu Yu Lin","d15aad4d":"Louis","10322849":"Rob","2eab3e3d":"Terry 2","7e02fbb9":"Julian",
         "bfc9b31b":"Anton Aug","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
ORDER = "89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
ALT = {"77fc4dee": f"{F}/bf_lester_hold.npz", "95a07786": f"{F}/bf_wayne_hold.npz"}
def sc(path, m):
    d = np.load(path, allow_pickle=True); T = d["T"]; segs = [tuple(s) for s in d["segs"]]
    y, pts = bodyfirst.labels(T, m, "VFINAL2")
    s = bodyfirst.score(pts, segs); s["segs"] = len(segs); return s
tot = {}
print(f"{'match':10s} {'pts':>4s} | {'points with a card':^19s} | {'own clean card':^15s} | {'fusedP':^11s} | {'split':^11s} | {'stray':^11s} | {'cards':^11s}")
print(f"{'':10s} {'':4s} | {'deployed':>9s} {'fix':>9s} | {'depl':>7s} {'fix':>7s} | {'depl':>5s} {'fix':>5s} | {'depl':>5s} {'fix':>5s} | {'depl':>5s} {'fix':>5s} | {'depl':>5s} {'fix':>5s}")
for m in ORDER:
    hp = ALT.get(m, f"{F}/bf_hold_{m}.npz"); dp = f"{F}/deployed_bodyfirst/bf_{m}.npz"
    if not (os.path.exists(hp) and os.path.exists(dp)): print(f"{NAMES[m]:10s} (not run)"); continue
    a, b = sc(dp, m), sc(hp, m)
    print(f"{NAMES[m]:10s} {a['points']:4d} | {a['found']:9d} {b['found']:9d} | {a['clean']:7d} {b['clean']:7d} | {a['fused_pts']:5d} {b['fused_pts']:5d} | {a['split']:5d} {b['split']:5d} | {a['stray']:5d} {b['stray']:5d} | {a['segs']:5d} {b['segs']:5d}")
    for k in ("points","found","clean","fused_pts","split","stray","segs"):
        tot.setdefault(k,[0,0]); tot[k][0]+=a[k]; tot[k][1]+=b[k]
if tot:
    P = tot["points"][0]
    print(f"{'TOTAL':10s} {P:4d} | {tot['found'][0]:9d} {tot['found'][1]:9d} | {tot['clean'][0]:7d} {tot['clean'][1]:7d} | {tot['fused_pts'][0]:5d} {tot['fused_pts'][1]:5d} | {tot['split'][0]:5d} {tot['split'][1]:5d} | {tot['stray'][0]:5d} {tot['stray'][1]:5d} | {tot['segs'][0]:5d} {tot['segs'][1]:5d}")
    print(f"\ncoverage: deployed {100*tot['found'][0]/P:.1f}%  fix {100*tot['found'][1]/P:.1f}%")
