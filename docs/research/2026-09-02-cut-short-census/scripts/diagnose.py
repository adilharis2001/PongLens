"""For each of the 18 endings Adil called cut short: which rule set t1, and
what the ball was doing at that moment.

Production's own per-card diagnosis (serves.json) is the source: the serve
mark, the net crossings, every bounce with its table coordinates, and the
tracked positions. The card rows come from the database, so a hand-made
boundary is visible as tight_end.
"""
import json, os, sys, glob
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import numpy as np
import points_v2 as V2

W = "/tmp/serve-diag/census"
rows = json.load(open(f"{W}/verdicts_joined.json"))
db = json.load(open(f"{W}/db_points.json"))
real = [r for r in rows if r["verdict"] == "real"]
serves = {}
for p in glob.glob(f"{W}/*.serves.json"):
    serves[os.path.basename(p).split(".")[0]] = json.load(open(p))

def card_for(sj, t0):
    return min(sj["cards"], key=lambda c: abs(c["t0"] - t0)) if sj else None

def fmt(v, n=2):
    return "-" if v is None else f"{v:.{n}f}"

out = []
for r in sorted(real, key=lambda r: (r["match"], r["point"])):
    mid = r["match_id"]; sj = serves.get(mid)
    L = sorted(db[mid], key=lambda k: k["t0"])
    me = next(k for k in L if k["idx"] == r["point"])
    i = L.index(me)
    nxt = L[i + 1] if i + 1 < len(L) else None
    # the next card in TIME (the DB list is sorted by t0 already)
    c = card_for(sj, me["t0"]) if sj else None
    cn = card_for(sj, nxt["t0"]) if (sj and nxt) else None
    if c and abs(c["t0"] - me["t0"]) > 0.6:
        c = None
    if cn and nxt and abs(cn["t0"] - nxt["t0"]) > 0.6:
        cn = None
    rec = dict(match=r["match"], mid=mid, pt=r["point"], t0=me["t0"], t1=me["t1"], dur=me["t1"] - me["t0"],
               tight_end=me["tight_end"], tight_start=me["tight_start"], deleted=me["deleted"], scored=me["scored"],
               tap=r["db"].get("tap_src"), nxt_idx=nxt["idx"] if nxt else None,
               nxt_t0=nxt["t0"] if nxt else None, gap=(nxt["t0"] - me["t1"]) if nxt else None,
               nxt_tight_start=nxt["tight_start"] if nxt else None, nxt_dur=(nxt["t1"] - nxt["t0"]) if nxt else None)
    if c:
        tb = [b["t"] for b in c["bounces"] if b.get("onTable")]
        ts = [b["t"] for b in c["bounces"] if b.get("onSurface")]
        xs = c.get("crossings") or []
        seen = c.get("seen") or []
        rec.update(serve_s=c.get("serve_s"), n_cross=len(xs), last_cross=xs[-1] if xs else None,
                   last_tb=tb[-1] if tb else None, last_any_b=c["bounces"][-1]["t"] if c["bounces"] else None,
                   last_seen=seen[-1][1] if seen else None, cross_gaps=[round(b - a, 2) for a, b in zip(xs, xs[1:])],
                   n_track=len(c.get("track") or []))
        # which rule set t1
        why = []
        if me["tight_end"]:
            why.append("hand-made boundary (tight_end)")
        if tb and abs(me["t1"] - (tb[-1] + V2.TAIL_AFTER_BOUNCE)) < 0.15:
            why.append(f"2.6s after the last table bounce ({tb[-1]:.2f})")
        if xs and abs(me["t1"] - (xs[-1] + V2.TAIL_AFTER_CROSS)) < 0.15:
            why.append(f"2.6s after the last crossing ({xs[-1]:.2f})")
        if xs and abs(me["t1"] - (xs[-1] + V2.TAIL_AFTER_CROSS + V2.TAIL_MAX_S)) < 0.15:
            why.append(f"tail cap 8.6s after the last crossing ({xs[-1]:.2f})")
        if cn and cn.get("serve_s") is not None and abs(me["t1"] - (cn["serve_s"] - V2.HEAD_MIN_S - V2.SQUEEZE_DEAD_S)) < 0.2:
            why.append(f"squeezed back to clear the next serve ({cn['serve_s']:.2f})")
        if nxt and abs(rec["gap"] - V2.MIN_DEAD_S) < 0.03 and cn and cn.get("serve_s") is None:
            why.append("long-card split (exactly 1.2s to a serveless next card)")
        if c.get("serve_s") is not None and abs(me["t1"] - (c["serve_s"] + V2.MAX_RALLY_S)) < 0.2:
            why.append("40s rally cap")
        rec["why"] = why or ["unexplained by the card's own evidence"]
    if cn:
        xs2 = cn.get("crossings") or []
        tb2 = [b["t"] for b in cn["bounces"] if b.get("onTable")]
        seen2 = cn.get("seen") or []
        rec.update(nxt_serve=cn.get("serve_s"), nxt_first_cross=xs2[0] if xs2 else None,
                   nxt_first_tb=tb2[0] if tb2 else None, nxt_first_seen=seen2[0][0] if seen2 else None,
                   nxt_n_cross=len(xs2))
    out.append(rec)

json.dump(out, open("/tmp/serve-diag/eighteen/diag.json", "w"), indent=1, default=float)
print(f"{'match':34s} {'pt':>4s} {'dur':>5s} {'srv':>6s} {'#x':>3s} {'lastX':>7s} {'lastTB':>7s} {'lastSeen':>8s} {'t1':>7s} | {'gap':>5s} {'nxt':>4s} {'nxtSrv':>7s} {'nxt1stX':>8s} {'nxt1stB':>8s}")
for r in out:
    print(f"{r['match'][:34]:34s} {r['pt']:4d} {r['dur']:5.1f} {fmt(r.get('serve_s')):>6s} {r.get('n_cross','-')!s:>3s} "
          f"{fmt(r.get('last_cross')):>7s} {fmt(r.get('last_tb')):>7s} {fmt(r.get('last_seen')):>8s} {r['t1']:7.2f} | "
          f"{fmt(r.get('gap'),1):>5s} {r['nxt_idx']!s:>4s} {fmt(r.get('nxt_serve')):>7s} {fmt(r.get('nxt_first_cross')):>8s} {fmt(r.get('nxt_first_tb')):>8s}")
print("\nWHY EACH ENDED THERE")
for r in out:
    print(f"  {r['match'][:30]:30s} pt {r['pt']:3d}  " + "; ".join(r.get("why", ["no production diagnosis file"])))
    if r["tight_end"] or r.get("nxt_tight_start"):
        print(f"      (hand edit markers: this card tight_end={r['tight_end']}, next card {r['nxt_idx']} tight_start={r.get('nxt_tight_start')})")
