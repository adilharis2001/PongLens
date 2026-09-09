"""Does the ball leave the ball crop on the rallies the bodies cut short? Ball
detections per second inside each pressed point: the early-ending points vs the rest."""
import json, glob, statistics as st, numpy as np
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
WITH = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
NAMES = {"77fc4dee":"Lester","10322849":"Rob","2eab3e3d":"Terry 2","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
early_all, rest_all = [], []
print(f"{'match':10s} {'points':>6s}  {'det/s early-ending':>20s} {'det/s the rest':>16s}   {'gap>1.5s early':>14s} {'gap>1.5s rest':>13s}")
for m in WITH:
    b = json.load(open(glob.glob(f"{S}/servemiss/bundles/crossings/{m}-*.json")[0]))
    tr = np.array([t for t, x, y in b["track"]]); fps = b["fps"]
    rows = json.load(open(glob.glob(f"{S}/bodyfix/public/research/body-detector/{m}-*/compare.json")[0]))["rows"]
    early, rest = [], []
    for r in rows:
        if r.get("kind") != "point" or r.get("prod_t0") is None: continue
        end = r.get("tap") or r["prod_t1"]; t0 = r["prod_t0"]
        if end - t0 < 2: continue
        seg = tr[(tr >= t0) & (tr <= end)]
        dens = len(seg) / (end - t0); gaps = np.diff(seg) if len(seg) > 1 else np.array([])
        big = int((gaps > 1.5).sum())
        cards = r.get("mine") or []
        cut = bool(cards) and max(c["t1"] for c in cards) < end - 2.0
        (early if cut else rest).append((dens, big))
    if early: early_all += early
    rest_all += rest
    f = lambda xs, i: (st.median([x[i] for x in xs]) if xs else float("nan"))
    print(f"{NAMES[m]:10s} {len(early)+len(rest):6d}  {f(early,0):20.1f} {f(rest,0):16.1f}   {f(early,1):14.1f} {f(rest,1):13.1f}   ({len(early)} early-ending)")
f = lambda xs, i: st.median([x[i] for x in xs])
print(f"\nALL: early-ending points {len(early_all)}: median {f(early_all,0):.1f} detections/s, {f(early_all,1):.1f} gaps over 1.5 s;  the rest {len(rest_all)}: {f(rest_all,0):.1f} det/s, {f(rest_all,1):.1f} gaps")
print("share of early-ending points with at least one ball gap over 1.5 s:", f"{sum(1 for d,g in early_all if g>0)/max(len(early_all),1):.0%}", " the rest:", f"{sum(1 for d,g in rest_all if g>0)/max(len(rest_all),1):.0%}")
