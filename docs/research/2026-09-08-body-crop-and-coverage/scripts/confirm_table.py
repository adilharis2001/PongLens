import json, glob, os
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"; F = f"{S}/fullframe"
NAMES = {"77fc4dee":"Lester","10322849":"Rob","2eab3e3d":"Terry 2","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
WITH = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
COLS = [("deployed (body alone)", lambda m: glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")[0]),
        ("deployed + ball splits", lambda m: f"{F}/cf_basec_{m}/compare.json"),
        ("bias 0.5 (body alone)", lambda m: f"{F}/cf_bias_{m}/compare.json"),
        ("bias 0.5 + ball splits", lambda m: f"{F}/cf_biasc_{m}/compare.json")]
tot = {}
print(f"{'':10s} " + " | ".join(f"{c[0]:^26s}" for c in COLS)); print(f"{'match':10s} " + " | ".join(f"{'ok':>4s} {'miss':>4s} {'fusd':>4s} {'xtra':>4s} {'junk':>4s}" for _ in COLS))
for m in WITH:
    cells = []
    for name, fn in COLS:
        try: p = fn(m)
        except IndexError: p = ""
        if not p or not os.path.exists(p): cells.append(f"{'(not run)':>26s}"); continue
        s = json.load(open(p))["summary"]; cells.append(f"{s['ok']:4d} {s['missed']:4d} {s['fused']:4d} {s['extra']:4d} {s['junk_deleted']:4d}")
        t = tot.setdefault(name, dict(ok=0, missed=0, fused=0, extra=0, junk=0, points=0)); t["ok"] += s["ok"]; t["missed"] += s["missed"]; t["fused"] += s["fused"]; t["extra"] += s["extra"]; t["junk"] += s["junk_deleted"]; t["points"] += s["points"]
    print(f"{NAMES[m]:10s} " + " | ".join(cells))
print(f"{'TOTAL':10s} " + " | ".join(f"{t['ok']:4d} {t['missed']:4d} {t['fused']:4d} {t['extra']:4d} {t['junk']:4d}" if (t := tot.get(name)) else f"{'':26s}" for name, _ in COLS))
print("points:", {k: v["points"] for k, v in tot.items()})
