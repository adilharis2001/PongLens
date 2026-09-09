"""Body cards under each treatment, against production's cards / Adil's presses.
Wayne Wei (95a07786) and Lester (77fc4dee)."""
import json, glob, os, statistics as st, numpy as np
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"
def deployed(m): return glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")[0]
def cards(rows): return sorted({(c["n"], c["t0"], c["t1"]) for r in rows for c in (r.get("mine") or [])})
def prod(rows): return sorted({(r["idx"], r["prod_t0"], r["prod_t1"]) for r in rows if r.get("kind") == "point" and r.get("prod_t0") is not None})
def early(rows):
    out = []
    for r in rows:
        if r.get("kind") != "point" or r.get("prod_t1") is None: continue
        for c in r.get("mine") or []: out.append(r["prod_t1"] - c["t1"])
    return out
def census(pose_path, cs):
    p = json.load(open(pose_path)); fps = p["fps"]; x0, y0, w, h = p["rect"]
    fr = {int(k)/fps: v for k, v in p["frames"].items()}; ts = np.array(sorted(fr))
    kinds = {"edge": 0, "swap": 0, "missing": 0, "clean": 0}
    for n, t0, t1 in cs:
        win = [t for t in ts if t1 - 1.5 <= t <= t1 + 0.3]; edge = swap = missing = False; prev = None
        for t in win:
            st_ = {s: (fr[t].get(s) or {}).get("box") for s in ("near", "far")}
            for s in ("near", "far"):
                b = st_[s]
                if not b: missing = True; continue
                if b[0] <= 1 or b[2] >= w - 1 or b[1] <= 1 or b[3] >= h - 1: edge = True
                if prev and prev.get(s) and abs((b[0]+b[2])/2 - (prev[s][0]+prev[s][2])/2) > 300: swap = True
            prev = st_
        kinds["edge" if edge else "swap" if swap else "missing" if missing else "clean"] += 1
    return kinds
RUNS = {
 "95a07786": [("window (deployed)", deployed("95a07786"), f"{F}/pose_95a07786_deployed.json"),
              ("window + hold 2s", f"{F}/wayne_hold/compare.json", f"{F}/pose_95a07786_hold.json"),
              ("full frame", f"{F}/body_95a07786/compare.json", f"{S}/poseretest/pose_95a07786_full.json"),
              ("full frame + hold 2s", f"{F}/wayne_fullhold/compare.json", f"{F}/pose_95a07786_fullhold.json")],
 "77fc4dee": [("window (deployed)", deployed("77fc4dee"), f"{F}/pose_77fc4dee_deployed.json"),
              ("window + hold 2s", f"{F}/lester_hold/compare.json", f"{F}/pose_77fc4dee_hold.json"),
              ("window + leave unknown", f"{F}/lester_nan/compare.json", f"{F}/pose_77fc4dee_nan.json"),
              ("full frame", f"{F}/lester_full/compare.json", f"{S}/poseretest/pose_77fc4dee_full.json"),
              ("full frame + hold 2s", f"{F}/lester_fullhold/compare.json", f"{F}/pose_77fc4dee_fullhold.json")],
}
NAMES = {"95a07786": "Wayne Wei (89 production points)", "77fc4dee": "Lester (105 scored points)"}
for m, runs in RUNS.items():
    print(f"\n##### {NAMES[m]}")
    print(f"{'treatment':26s} cards   ok  early  missed  fused  extra  junk   med-early  >2s-early   edge swap miss clean")
    base = None
    for name, path, pose in runs:
        if not os.path.exists(path): print(f"{name:26s} (not run)"); continue
        d = json.load(open(path)); s = d["summary"]; rows = d["rows"]; cs = cards(rows); e = early(rows)
        c = census(pose, cs) if os.path.exists(pose) else {}
        cz = "  ".join(f"{c.get(k, 0):3d}" for k in ("edge", "swap", "missing", "clean")) if c else ""
        print(f"{name:26s} {s['cards']:5d}  {s['ok']:3d}   {s['short']:4d}     {s['missed']:3d}    {s['fused']:3d}    {s['extra']:3d}   {s['junk_deleted']:3d}     {st.median(e):+6.2f}s   {sum(1 for x in e if x > 2):3d} of {len(e):3d}   {cz}")
        if base is None: base = rows
    if m == "95a07786":
        print("\n  the two cards Adil named (production's card, then each treatment's cards in that stretch):")
        pr = prod(base)
        for lo, hi in ((76.0, 83.0), (124.0, 131.0)):
            print(f"  {lo:.0f}-{hi:.0f}s  production: {[(round(a,1), round(b,1)) for _, a, b in pr if b >= lo and a <= hi]}")
            for name, path, _ in runs:
                if not os.path.exists(path): continue
                rows = json.load(open(path))["rows"]
                print(f"     {name:24s} {[(n, round(a,1), round(b,1)) for n, a, b in cards(rows) if b >= lo and a <= hi]}")
