"""Ball as CONTINUITY, not last sighting: extend a body card's end only while ball
events keep coming at rally rhythm (gap <= G) from before the body's end; stop at the
first silence. Same 328 points, same ruler (Adil's presses)."""
import sys, os, json, glob, bisect, numpy as np, statistics as st
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"; L = f"{S}/poseretest"; os.chdir(L)
NAMES = {"77fc4dee":"Lester","10322849":"Rob","2eab3e3d":"Terry 2","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
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
    for kind, ev in (("crossings only", sorted(set(b.get("crossings") or []))),
                     ("crossings + table bounces", sorted(set(list(b.get("crossings") or []) + [t for t, on in (b.get("bounces") or []) if on])))):
        d = np.load(f"{F}/deployed_bodyfirst/bf_{m}.npz", allow_pickle=True); segs = [tuple(s) for s in d["segs"]]
        page = json.load(open(glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")[0]))["rows"]
        pts = sorted((r["prod_t0"], r.get("tap"), r["prod_t1"]) for r in page if r.get("kind") == "point" and r.get("prod_t0") is not None)
        for i, (t0, tap, t1) in enumerate(pts):
            if not tap: continue
            nxt = pts[i + 1][0] if i + 1 < len(pts) else t1 + 8.0
            cov = [s for s in segs if covers(s, (t0, tap, t1))]
            if not cov: continue
            rows.append(dict(kind=kind, m=m, t0=t0, tap=tap, nxt=nxt, body=max(s[1] for s in cov), ev=ev))
for kind in ("crossings only", "crossings + table bounces"):
    R = [r for r in rows if r["kind"] == kind]
    print(f"\n=== {kind} ===  ({len(R)} points)")
    base = [r["tap"] - r["body"] for r in R]
    print(f"  {'body alone':28s} median {st.median(base):+.2f}  ±1s {share(base,-1,1):.0%}  ±2s {share(base,-2,2):.0%}   >2s early {sum(x>2 for x in base):3d}   >2s late {sum(x<-2 for x in base):3d}")
    for G in (0.8, 1.2, 1.6, 2.0):
        e = []; fixed = worsened = 0
        for r in R:
            ev = r["ev"]; end = r["body"]
            # the chain must be alive AT the body's end: an event within G before it
            j = bisect.bisect_right(ev, end)
            if j > 0 and end - ev[j - 1] <= G:
                t = ev[j - 1]
                while j < len(ev) and ev[j] - t <= G and ev[j] < r["nxt"] - 0.3: t = ev[j]; j += 1
                end = max(end, min(t + PAD, r["nxt"] - 0.3))
            x = r["tap"] - end; e.append(x)
            fixed += (r["tap"] - r["body"] > 2) and x <= 2
            worsened += (r["tap"] - r["body"] >= -2) and x < -2
        print(f"  {'chain, gap <= %.1fs' % G:28s} median {st.median(e):+.2f}  ±1s {share(e,-1,1):.0%}  ±2s {share(e,-2,2):.0%}   >2s early {sum(x>2 for x in e):3d}   >2s late {sum(x<-2 for x in e):3d}   repaired {fixed:2d}  pushed late {worsened:2d}")
