"""By Adil's ruler: WHICH scored points have no body card behind them, and why; and
what glues two points under one card. Deployed dumps and deployed poses."""
import sys, os, json, bisect, numpy as np, statistics as st
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"; L = f"{S}/poseretest"
os.chdir(L); sys.path.insert(0, L); os.environ.setdefault("V3_BF_SMOOTH", "0.5")
import bodyfirst
NAMES = {"77fc4dee":"Lester","89b35ee0":"Yu Yu Lin","d15aad4d":"Louis","10322849":"Rob","2eab3e3d":"Terry 2","7e02fbb9":"Julian",
         "bfc9b31b":"Anton Aug","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
ORDER = "89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
def covers(seg, pt):
    t0, tap, t1 = pt; a, b = seg
    return a <= min(tap, t1) and b >= t0 + 1.0
def posestate(P, keys, fps, t0, t1):
    a = bisect.bisect_left(keys, int(t0 * fps)); b = bisect.bisect_right(keys, int(t1 * fps)); ks = keys[a:b]
    if not ks: return None
    x0, y0, w, h = P["rect"]; nm = fm = ne = both = 0
    for k in ks:
        fr = P["frames"][str(k)]; n = (fr.get("near") or {}).get("box"); f = (fr.get("far") or {}).get("box")
        if not n: nm += 1
        if not f: fm += 1
        if n and f: both += 1
        if n and (n[0] <= 1 or n[2] >= w - 1 or n[1] <= 1 or n[3] >= h - 1): ne += 1
    N = len(ks); return dict(n=N, near_missing=nm / N, far_missing=fm / N, both=both / N, near_edge=ne / N)
TOT = dict(missed=0, m_bothlow=0, m_pose=0, fused=0, f_dip=0, f_short=0)
for m in ORDER:
    dp = f"{F}/deployed_bodyfirst/bf_{m}.npz"; pp = f"{F}/deployed_poses/pose_{m}.json"
    if not (os.path.exists(dp) and os.path.exists(pp)): print(f"{NAMES[m]}: missing inputs"); continue
    d = np.load(dp, allow_pickle=True); T = d["T"]; p = d["p"]; segs = [tuple(s) for s in d["segs"]]
    y, pts = bodyfirst.labels(T, m, "VFINAL2")
    P = json.load(open(pp)); fps = P["fps"]; keys = sorted(int(k) for k in P["frames"])
    missed = [q for q in pts if not any(covers(s, q) for s in segs)]
    print(f"\n### {NAMES[m]}: {len(pts)} points, {len(missed)} with no card")
    for q in missed:
        t0, tap, t1 = q; end = min(tap, t1); i0, i1 = np.searchsorted(T, t0), np.searchsorted(T, end)
        pm = float(p[i0:i1].max()) if i1 > i0 else float("nan"); pmean = float(p[i0:i1].mean()) if i1 > i0 else float("nan")
        near = [s for s in segs if s[1] >= t0 - 3 and s[0] <= end + 3]
        ps = posestate(P, keys, fps, t0, end) or {}
        why = "model never says play" if pm < 0.5 else "model says play, decoder dropped it"
        if ps and (ps["near_missing"] > 0.3 or ps["far_missing"] > 0.3): why = f"a player missing ({ps['near_missing']:.0%} near, {ps['far_missing']:.0%} far)"
        TOT["missed"] += 1; TOT["m_bothlow" if pm < 0.5 else "m_pose"] += 0
        print(f"  {t0:7.1f}-{end:7.1f} ({end-t0:4.1f}s)  p max {pm:.2f} mean {pmean:.2f}  both present {ps.get('both',float('nan')):.0%}  near on edge {ps.get('near_edge',float('nan')):.0%}  cards nearby {[(round(a,1),round(b,1)) for a,b in near]}  -> {why}")
    fused = [(s, [q for q in pts if covers(s, q)]) for s in segs]; fused = [(s, qs) for s, qs in fused if len(qs) >= 2]
    gaps, dips = [], []
    for s, qs in fused:
        for q1, q2 in zip(qs, qs[1:]):
            g0, g1 = min(q1[1], q1[2]), q2[0]; gaps.append(g1 - g0)
            i0, i1 = np.searchsorted(T, g0), np.searchsorted(T, g1); dips.append(float(p[i0:i1].min()) if i1 > i0 else 1.0)
    if fused:
        print(f"  fused cards {len(fused)}: gap between the two points median {st.median(gaps):.1f}s (<2s: {sum(g<2 for g in gaps)}, >5s: {sum(g>5 for g in gaps)}); model dipped below 0.5 inside the gap on {sum(x<0.5 for x in dips)} of {len(dips)}, below 0.3 on {sum(x<0.3 for x in dips)}")
        TOT["fused"] += len(gaps); TOT["f_dip"] += sum(x < 0.5 for x in dips); TOT["f_short"] += sum(g < 2 for g in gaps)
print(f"\nTOTAL missed {TOT['missed']}; fused pairs {TOT['fused']}, of which the model dipped below 0.5 in the gap on {TOT['f_dip']} and the gap was under 2s on {TOT['f_short']}")
