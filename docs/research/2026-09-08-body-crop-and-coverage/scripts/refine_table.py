import json, glob, os
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"; F = f"{S}/fullframe"
WITH = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
def tot(paths):
    t = dict(points=0, ok=0, missed=0, fused=0, extra=0, junk=0, short=0, cards=0, n=0)
    for p in paths:
        if not os.path.exists(p): continue
        s = json.load(open(p))["summary"]; t["n"] += 1
        for k, kk in (("points","points"),("ok","ok"),("missed","missed"),("fused","fused"),("extra","extra"),("junk","junk_deleted"),("short","short"),("cards","cards")): t[k] += s[kk]
    return t
rows = [("deployed dumps, body alone", [glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")[0] for m in WITH])]
for cfg in ("quiet","split","endcross","endboth","afterfirst","tidy","tidyend"): rows.append((f"deployed + {cfg}", [f"{F}/rf_base_{cfg}_{m}/compare.json" for m in WITH]))
rows.append(("bias 0.5, body alone", [f"{F}/cf_bias_{m}/compare.json" for m in WITH]))
for cfg in ("quiet","split","afterfirst","tidy","tidyend"): rows.append((f"bias 0.5 + {cfg}", [f"{F}/rf_bias_{cfg}_{m}/compare.json" for m in WITH]))
print(f"{'nine matches, 617 points':30s} {'n':>2s} {'cards':>5s} {'ok':>4s} {'missed':>6s} {'fused':>5s} {'extra':>5s} {'junk':>4s} {'early':>5s}")
for name, paths in rows:
    t = tot(paths)
    if t["n"] == 0: print(f"{name:30s} (not run)"); continue
    print(f"{name:30s} {t['n']:2d} {t['cards']:5d} {t['ok']:4d} {t['missed']:6d} {t['fused']:5d} {t['extra']:5d} {t['junk']:4d} {t['short']:5d}")
