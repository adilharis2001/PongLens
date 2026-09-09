import re, os
F = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe"
NAMES = {"77fc4dee":"Lester","89b35ee0":"YYL","d15aad4d":"Louis","10322849":"Rob","2eab3e3d":"Terry2","7e02fbb9":"Julian","bfc9b31b":"AntonAug","cebaa6d4":"Rowel","f3237587":"Koko2","1c08539e":"Tim","5c90151a":"Hugo22","5fd822ec":"Hugo11","95a07786":"Wayne"}
def rows(path):
    out = {}
    for ln in open(path):
        mm = re.match(r"^([0-9a-f]{8})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([+-][\d.]+)\s+([+-][\d.]+)", ln)
        if mm: out[mm.group(1)] = dict(points=int(mm.group(2)), found=int(mm.group(3)), clean=int(mm.group(4)), fusedP=int(mm.group(5)), split=int(mm.group(6)), stray=int(mm.group(7)), segs=int(mm.group(8)), cost=int(mm.group(9)), d0=float(mm.group(10)), d1=float(mm.group(11)))
    return out
print(f"{'run':14s} {'points':>6s} {'found':>6s} {'missed':>6s} {'clean':>6s} {'fusedP':>6s} {'split':>6s} {'stray':>6s} {'cards':>6s}   end vs press (median s, +early)")
for tag in ("base", "ball", "ball_durw4", "ball_bias05"):
    p = f"{F}/rt_{tag}.log"
    if not os.path.exists(p): print(f"{tag:14s} (not run)"); continue
    r = rows(p)
    if not r: print(f"{tag:14s} (no rows) {open(p).read()[-300:]}"); continue
    t = {k: sum(v[k] for v in r.values()) for k in ("points","found","clean","fusedP","split","stray","segs")}
    d1 = sorted(v["d1"] for v in r.values())
    print(f"{tag:14s} {t['points']:6d} {t['found']:6d} {t['points']-t['found']:6d} {t['clean']:6d} {t['fusedP']:6d} {t['split']:6d} {t['stray']:6d} {t['segs']:6d}   per-match d1 median {d1[len(d1)//2]:+.1f}")
    if tag != "base":
        b = rows(f"{F}/rt_base.log")
        print("   per match found (base -> this):", ", ".join(f"{NAMES[m]} {b[m]['found']}->{r[m]['found']}" for m in r if m in b and b[m]['found'] != r[m]['found']) or "no change")
        print("   per match end shift d1 (base -> this):", ", ".join(f"{NAMES[m]} {b[m]['d1']:+.1f}->{r[m]['d1']:+.1f}" for m in r if m in b and abs(b[m]['d1'] - r[m]['d1']) >= 0.2) or "no change")
