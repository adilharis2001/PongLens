"""Cards longer than the 20s cap, replayed from the full evidence dumps.
Is there a real pause inside them (two points merged) or not (one long
rally)? Judged by Adil's winner taps where the match is scored."""
import json, glob, sys, subprocess
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import numpy as np
import points_v2 as V2

db = json.load(open("/tmp/serve-diag/census/db_points.json"))
rows = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
labels = {r["match_id"]: r["match"] for r in rows}
verd = {(r["match_id"], r["point"]): r["verdict"] for r in rows}

class FakeE:
    def __init__(self, d):
        self.duration = float(d["duration"]); self.fps = float(d["fps"])
        self.n = int(self.duration / V2.TICK) + 1
        self.shape = d.get("camera"); self.calibrated = d.get("quad") is not None or d.get("calibration") is not None
        self.cross = np.asarray(d["crossings"], float)
        self.bt = np.asarray([t for t, _ in d["bounces"]], float)
        self.bt_table = np.asarray([t for t, f in d["bounces"] if f], float)
        self.serves = sorted(float(s) for s in d.get("serves", []))
        dense = np.zeros(self.n, bool)
        for a, b in d["dense"]:
            i0, i1 = max(0, int(a / V2.TICK)), min(self.n, int(b / V2.TICK) + 1)
            dense[i0:i1] = True
        self.ball_dense = dense
    def between(self, arr, a, b):
        if not len(arr): return arr
        return arr[(arr >= a) & (arr <= b)]

def src(k, cut): return None if cut is None or k["cut_t0"] is None else cut - k["cut_t0"] - k["pre"] + k["t0"]

allrows = []
for p in sorted(glob.glob("/private/tmp/ponglens-inferred-bounce-eval/*/evidence.json")):
    mid = p.split("/")[-2]
    if mid not in db: continue
    d = json.load(open(p))
    if "serves" not in d: print(mid[:8], "no serves in dump"); continue
    E = FakeE(d)
    S = V2.serve_points(E); F = V2.fallback_points(E, S); Vc, _ = V2.veto(E, S + F)
    R2 = V2.resolve(V2.merge_continuous(E, V2.resolve(Vc)))
    final = V2.on_own_table(E, V2.resolve(V2.split_long(E, R2)))
    # fidelity against the dump's own cards (same inputs -> should be exact)
    dc = d["cards"]; hit = sum(1 for c in dc if any(abs(f["t0"]-c[0]) < 0.05 and abs(f["t1"]-c[1]) < 0.05 for f in final))
    taps = sorted(src(k, k["tap_cut"]) for k in db[mid] if k["tap_cut"] is not None)
    prod = sorted(db[mid], key=lambda k: k["t0"])
    longs = [c for c in R2 if c["t1"] - c["t0"] > V2.MAX_CARD_S]
    print(f"\n{mid[:8]} {labels[mid][:38]:38s} replay {len(final)} vs dump {len(dc)} (exact {hit}); long cards before split: {len(longs)}; taps {len(taps)}")
    for c in longs:
        i0, i1 = int(c["t0"] / V2.TICK), int(c["t1"] / V2.TICK)
        dense = E.ball_dense[i0:i1]
        mid_, win = len(dense) // 2, max(1, len(dense) // 4)
        seg = dense[mid_ - win: mid_ + win].astype(float)
        sm = np.convolve(seg, np.ones(6) / 6, "same")
        k = int(np.argmin(sm)); cut_frac = (mid_ - win + k) / len(dense)
        # longest run of NO dense ball anywhere in the middle half, seconds
        best = run = 0
        for v in seg:
            run = run + 1 if not v else 0; best = max(best, run)
        pause = best * V2.TICK
        # the same pause measured over the whole card
        best = run = 0
        for v in dense:
            run = run + 1 if not v else 0; best = max(best, run)
        pause_all = best * V2.TICK
        xs = E.between(E.cross, c["t0"], c["t1"]); xgap = float(np.max(np.diff(xs))) if len(xs) > 1 else None
        inner_serves = [s for s in E.serves if c["t0"] + 2.0 < s < c["t1"] - 2.0]
        tp = [t for t in taps if c["t0"] <= t <= c["t1"] + 0.5]
        # census verdict on the production card this long card begins as
        pa = min(prod, key=lambda k: abs(k["t0"] - c["t0"])); v = verd.get((mid, pa["idx"])) if abs(pa["t0"] - c["t0"]) < 0.8 else None
        allrows.append(dict(mid=mid, dur=c["t1"]-c["t0"], pause=pause, pause_all=pause_all, xgap=xgap, inner_serves=len(inner_serves), taps=len(tp) if taps else None, verdict=v, smin=float(sm[k]), cut_frac=cut_frac, serve=c.get("serve_s") is not None))
        print(f"   {c['t0']:7.1f}-{c['t1']:7.1f} {c['t1']-c['t0']:5.1f}s serve={str(c.get('serve_s') is not None):5s} pause(mid half) {pause:4.1f}s  pause(all) {pause_all:4.1f}s  max crossing gap {xgap if xgap is None else round(xgap,1)!s:5s}  serves inside {len(inner_serves)}  smoothed min {sm[k]:.2f} cut at {cut_frac*100:3.0f}%  taps {len(tp) if taps else '-'}  census {v}")
json.dump(allrows, open("/tmp/serve-diag/census/longcards.json", "w"), indent=1)
print("\n=== SUMMARY over long cards with a tap verdict ===")
one = [r for r in allrows if r["taps"] == 1]; two = [r for r in allrows if r["taps"] is not None and r["taps"] >= 2]
for name, L in (("one point (a live rally the cap would cut)", one), ("two+ points (the cap rescues a merge)", two)):
    if not L: print(name, "none"); continue
    print(f"{name}: n={len(L)}  pause in middle half: {sorted(round(r['pause'],1) for r in L)}")
    print(f"      max crossing gap: {sorted(round(r['xgap'],1) for r in L if r['xgap'] is not None)}   serves inside: {[r['inner_serves'] for r in L]}   smoothed min: {sorted(round(r['smin'],2) for r in L)}")
for thr in (0.6, 1.0, 1.5, 2.0):
    keep_one = sum(1 for r in one if r["pause"] < thr); lose_two = sum(1 for r in two if r["pause"] < thr)
    print(f"  rule 'split only if the middle half has >= {thr:.1f}s with no moving ball': live rallies kept whole {keep_one}/{len(one)}, merged pairs left unsplit {lose_two}/{len(two)}")
