"""Ball continuity gated by the bodies: extend a body card while table bounces (or
crossings) keep coming at gap <= G AND the body model's play reading stays >= PMIN
over the extension. Same 320 points, Adil's presses."""
import os, json, glob, bisect, numpy as np, statistics as st
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"; F = f"{S}/fullframe"
WITH = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
PAD = 0.8
def covers(seg, pt):
    t0, tap, t1 = pt; a, b = seg
    return a <= min(tap, t1) and b >= t0 + 1.0
def share(xs, lo, hi): return sum(1 for x in xs if lo <= x <= hi) / max(len(xs), 1)
rows = []
for m in WITH:
    bp = glob.glob(f"{S}/servemiss/bundles/crossings/{m}-*.json")
    if not bp: continue
    b = json.load(open(bp[0]))
    cr = sorted(set(b.get("crossings") or [])); bt = sorted(set([t for t, on in (b.get("bounces") or []) if on]))
    d = np.load(f"{F}/deployed_bodyfirst/bf_{m}.npz", allow_pickle=True); segs = [tuple(s) for s in d["segs"]]; T = d["T"]; p = d["p"]
    page = json.load(open(glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")[0]))["rows"]
    pts = sorted((r["prod_t0"], r.get("tap"), r["prod_t1"]) for r in page if r.get("kind") == "point" and r.get("prod_t0") is not None)
    for i, (t0, tap, t1) in enumerate(pts):
        if not tap: continue
        nxt = pts[i + 1][0] if i + 1 < len(pts) else t1 + 8.0
        cov = [s for s in segs if covers(s, (t0, tap, t1))]
        if not cov: continue
        rows.append(dict(m=m, t0=t0, tap=tap, nxt=nxt, body=max(s[1] for s in cov), cr=cr, bt=bt, T=T, p=p))
def pmin_over(r, a, b):
    i0, i1 = np.searchsorted(r["T"], a), np.searchsorted(r["T"], b)
    return float(r["p"][i0:i1].min()) if i1 > i0 else 1.0
base = [r["tap"] - r["body"] for r in rows]
print(f"{len(rows)} points.  body alone: median {st.median(base):+.2f}  ±2s {share(base,-2,2):.0%}  >2s early {sum(x>2 for x in base)}  >2s late {sum(x<-2 for x in base)}")
print(f"{'rule':44s} {'median':>7s} {'±2s':>5s} {'early':>5s} {'late':>5s} {'repaired':>8s} {'pushed':>6s}")
for evname in ("bounces", "cross+bounces"):
    for G in (1.2, 1.6, 2.0, 2.5):
        for PMIN in (None, 0.2, 0.3, 0.4):
            e = []; fixed = worsened = 0
            for r in rows:
                ev = r["bt"] if evname == "bounces" else sorted(set(r["cr"] + r["bt"]))
                end = r["body"]; j = bisect.bisect_right(ev, end)
                if j > 0 and end - ev[j - 1] <= G:
                    t = ev[j - 1]
                    while j < len(ev) and ev[j] - t <= G and ev[j] < r["nxt"] - 0.3:
                        if PMIN is not None and pmin_over(r, t, ev[j]) < PMIN: break
                        t = ev[j]; j += 1
                    end = max(end, min(t + PAD, r["nxt"] - 0.3))
                x = r["tap"] - end; e.append(x)
                fixed += (r["tap"] - r["body"] > 2) and x <= 2
                worsened += (r["tap"] - r["body"] >= -2) and x < -2
            print(f"{evname + ' gap<=%.1f' % G + (' p>=%.1f' % PMIN if PMIN else ' (no body gate)'):44s} {st.median(e):+7.2f} {share(e,-2,2):5.0%} {sum(x>2 for x in e):5d} {sum(x<-2 for x in e):5d} {fixed:8d} {worsened:6d}")
# Wayne card 12 specifically
w = [r for r in rows if r["m"] == "95a07786"]
print("Wayne points with a press:", [(round(r["t0"],1), round(r["tap"],1), round(r["body"],1)) for r in w])
