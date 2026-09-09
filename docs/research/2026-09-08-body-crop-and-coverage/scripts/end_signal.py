"""Where does the point end? The body card's end vs the ball's last event (net crossing
or table bounce) vs Adil's press, on every scored point whose match still has a
crossings bundle. Then: does letting the ball EXTEND a body card's end (never create
a card) fix the early endings without junk?"""
import sys, os, json, glob, bisect, numpy as np, statistics as st
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
F = f"{S}/fullframe"; L = f"{S}/poseretest"
os.chdir(L); sys.path.insert(0, L); os.environ.setdefault("V3_BF_SMOOTH", "0.5")
import bodyfirst
NAMES = {"77fc4dee":"Lester","10322849":"Rob","2eab3e3d":"Terry 2","cebaa6d4":"Rowel","f3237587":"Koko 2","1c08539e":"Tim","5c90151a":"Hugo 22m","5fd822ec":"Hugo 11m","95a07786":"Wayne Wei"}
WITH = "77fc4dee 10322849 2eab3e3d cebaa6d4 f3237587 5fd822ec 95a07786 5c90151a 1c08539e".split()
PAD = 0.8  # reaction after the last ball event before the point is over
def covers(seg, pt):
    t0, tap, t1 = pt; a, b = seg
    return a <= min(tap, t1) and b >= t0 + 1.0
def share(xs, lo, hi): return sum(1 for x in xs if lo <= x <= hi) / max(len(xs), 1)
rows = []
for m in WITH:
    bp = glob.glob(f"{S}/servemiss/bundles/crossings/{m}-*.json")
    if not bp: continue
    b = json.load(open(bp[0])); ev = sorted(set(list(b.get("crossings") or []) + [t for t, on in (b.get("bounces") or []) if on]))
    d = np.load(f"{F}/deployed_bodyfirst/bf_{m}.npz", allow_pickle=True); segs = [tuple(s) for s in d["segs"]]
    page = json.load(open(glob.glob(f"{S}/endon-deploy/public/research/body-detector/{m}-*/compare.json")[0]))["rows"]
    pts = sorted((r["prod_t0"], r.get("tap"), r["prod_t1"]) for r in page if r.get("kind") == "point" and r.get("prod_t0") is not None)
    for i, (t0, tap, t1) in enumerate(pts):
        if not tap: continue                      # only Adil's presses are a ruler for ENDS
        nxt = pts[i + 1][0] if i + 1 < len(pts) else t1 + 8.0
        cov = [s for s in segs if covers(s, (t0, tap, t1))]
        body_end = max(s[1] for s in cov) if cov else None
        j0, j1 = bisect.bisect_left(ev, t0), bisect.bisect_left(ev, nxt - 0.5)
        last = ev[j1 - 1] if j1 > j0 else None
        rows.append(dict(m=m, t0=t0, tap=tap, nxt=nxt, body=body_end, last=last))
print(f"scored points with a press, in the nine bundle matches: {len(rows)}")
have_body = [r for r in rows if r["body"] is not None]
print(f"\nBODY card end vs press ({len(have_body)} points with a card):")
e = [r["tap"] - r["body"] for r in have_body]
print(f"  press minus end: median {st.median(e):+.2f}s  P10 {np.percentile(e,10):+.2f}  P90 {np.percentile(e,90):+.2f}   within ±1s {share(e,-1,1):.0%}  within ±2s {share(e,-2,2):.0%}   ends >2s EARLY {sum(x>2 for x in e)}   >2s LATE {sum(x<-2 for x in e)}")
have_ball = [r for r in rows if r["last"] is not None]
print(f"\nBALL last crossing/bounce + {PAD}s vs press ({len(have_ball)} of {len(rows)} points have any ball event; {len(rows)-len(have_ball)} have none):")
e2 = [r["tap"] - (r["last"] + PAD) for r in have_ball]
print(f"  press minus end: median {st.median(e2):+.2f}s  P10 {np.percentile(e2,10):+.2f}  P90 {np.percentile(e2,90):+.2f}   within ±1s {share(e2,-1,1):.0%}  within ±2s {share(e2,-2,2):.0%}   >2s EARLY {sum(x>2 for x in e2)}   >2s LATE {sum(x<-2 for x in e2)}")
print(f"\nCOMBINED: body end, extended to the ball's last event + {PAD}s when the ball saw something AFTER the body's end (capped 0.3s before the next point). No card is ever created.")
e3 = []; fixed = 0; worsened = 0
for r in have_body:
    end = r["body"]
    if r["last"] is not None and r["last"] + PAD > end: end = min(r["last"] + PAD, r["nxt"] - 0.3)
    x = r["tap"] - end; e3.append(x)
    if r["tap"] - r["body"] > 2 and x <= 2: fixed += 1
    if r["tap"] - r["body"] >= -2 and x < -2: worsened += 1
print(f"  press minus end: median {st.median(e3):+.2f}s  P10 {np.percentile(e3,10):+.2f}  P90 {np.percentile(e3,90):+.2f}   within ±1s {share(e3,-1,1):.0%}  within ±2s {share(e3,-2,2):.0%}   >2s EARLY {sum(x>2 for x in e3)}   >2s LATE {sum(x<-2 for x in e3)}")
print(f"  early endings repaired: {fixed}   ends pushed >2s late that were not before: {worsened}")
print("\nper match, ends >2s early: body / combined")
for m in WITH:
    rr = [r for r in have_body if r["m"] == m]
    if not rr: continue
    eb = sum(1 for r in rr if r["tap"] - r["body"] > 2)
    ec = 0
    for r in rr:
        end = r["body"]
        if r["last"] is not None and r["last"] + PAD > end: end = min(r["last"] + PAD, r["nxt"] - 0.3)
        ec += r["tap"] - end > 2
    print(f"  {NAMES[m]:10s} {len(rr):3d} points   {eb:3d} / {ec:3d}")
