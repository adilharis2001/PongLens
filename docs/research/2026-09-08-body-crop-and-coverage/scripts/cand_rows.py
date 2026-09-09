"""Adil's marked rows on Wayne Wei under the shipped page and each candidate."""
import json, glob, sys
F = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe"
tags = sys.argv[1:] or ["floor50", "floor60t3"]
WANT = {11: "end cut, lob rally", 21: "end cut, near left frame", 42: "split mid-rally", 66: "split mid-rally", 74: "split mid-rally", 79: "split mid-rally", 80: "glued into 79's 2nd card", 14: "end ~0.5 s early", 18: "end early, near out of frame", 20: "end early, near out of frame"}
def cards(path):
    rows = json.load(open(path))["rows"]; out = {}
    for r in rows:
        if r.get("kind") == "point" and r.get("app_no") in WANT:
            out[r["app_no"]] = (r["prod_t0"], r["prod_t1"], [(c["t0"], c["t1"]) for c in (r.get("mine") or [])])
    return out
sets = [("shipped", glob.glob(f"{F}/fixed_export_keep/95a07786-*.json")[0])] + [(t, p) for t in tags for p in glob.glob(f"{F}/pages_{t}/95a07786-*.json")]
data = {n: cards(p) for n, p in sets}
for no, why in WANT.items():
    print(f"\nyour card {no} ({why}):")
    for n, _ in sets:
        d = data[n].get(no)
        if not d: print(f"  {n:10s} (row missing)"); continue
        t0, t1, cs = d
        print(f"  {n:10s} production {t0:.1f}-{t1:.1f}   body " + (", ".join(f"{a:.1f}-{b:.1f}" for a, b in cs) or "none"))
