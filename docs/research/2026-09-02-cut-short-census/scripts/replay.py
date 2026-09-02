"""Replay the v2 assembler from the evidence dumps, exactly, then measure two
rule changes against taps and Adil's census verdicts.

Fidelity first: the dump's own track is fed through the real Evidence class
(build_track patched to return it), and the result must reproduce the dump's
crossings, bounces, serves and cards before any variant is read.
"""
import json, os, re, sys, pickle, glob
from types import SimpleNamespace
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import numpy as np
import points_v2 as V2
from points_v2 import TICK

DUMPS = "/private/tmp/ponglens-inferred-bounce-eval"
CACHE = "/tmp/serve-diag/fix/cache"
os.makedirs(CACHE, exist_ok=True)
db = json.load(open("/tmp/serve-diag/fix/db.json"))
rows = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
meta, pts = db["meta"], db["points"]
SPLIT_MARGIN_S = 3.0

def settings(d):
    note = " ".join(d.get("notes") or [])
    m = re.search(r"surface pad ([\d.]+)", note); pad = float(m.group(1)) if m else 0.45
    m = re.search(r"merge ([\d.]+)s", note); merge = float(m.group(1)) if m else 2.5
    return pad, merge

def base(mid):
    cp = f"{CACHE}/{mid}.pkl"
    if os.path.exists(cp):
        return pickle.load(open(cp, "rb"))
    d = json.load(open(f"{DUMPS}/{mid}/evidence.json"))
    fps = float(d["fps"]); scale = d["w"] / 1920.0
    trk = {int(round(t * fps)): (float(x), float(y)) for t, x, y in d["track"]}
    pad, merge = settings(d)
    V2.PAIR_SURFACE_PAD_M, V2.CLUSTER_S = pad, merge
    H = V2.homography_from_corners(d["quad"])
    bnc = V2.bounces(trk, scale)
    old_bt = V2.build_track
    V2.build_track = lambda cand, s: trk
    try:
        E = V2.Evidence(None, d["quad"], None, fps, d["duration"], d["w"])
    finally:
        V2.build_track = old_bt
    V2.CLUSTER_S = 0.0
    try:
        motifs = V2.serve_motifs(trk, bnc, H, fps, scale, ())
    finally:
        V2.CLUSTER_S = merge
    out = dict(mid=mid, d=d, fps=fps, scale=scale, trk=trk, H=H, bnc=bnc, motifs=motifs, pad=pad, merge=merge,
               E=dict(cross=E.cross, bt=E.bt, bt_table=E.bt_table, serves=E.serves, dense=E.ball_dense,
                      shape=E.shape, calibrated=E.calibrated, n=E.n))
    pickle.dump(out, open(cp, "wb"))
    return out

def between(arr, a, b):
    return arr[(arr >= a) & (arr <= b)] if len(arr) else arr

def light_E(b, cross, cross_serves=None):
    d, fps, scale, trk, H = b["d"], b["fps"], b["scale"], b["trk"], b["H"]
    cross_serves = np.asarray(cross if cross_serves is None else cross_serves, float)
    V2.PAIR_SURFACE_PAD_M, V2.CLUSTER_S = b["pad"], b["merge"]
    duration = float(d["duration"]); n = int(duration / TICK) + 1
    bt, bt_table = [], []
    for f, x, y in b["bnc"]:
        p = V2.project(H, x, y)
        if not p or not V2.in_corridor(*p):
            continue
        bt.append(f / fps)
        if -0.15 <= p[0] <= V2.W_M + 0.15 and -0.15 <= p[1] <= V2.L_M + 0.15:
            bt_table.append(f / fps)
    cross = np.asarray(cross, float)
    kept = []
    for m in b["motifs"]:
        t0 = m["bounce1_s"]
        if len(cross_serves) and int(((cross_serves >= t0 - V2.PRIOR_CROSS_WINDOW_S) & (cross_serves < t0 - 0.05)).sum()) > V2.PRIOR_CROSS_MAX:
            continue
        kept.append(m)
    dedup, last = [], -99.0
    for m in sorted(kept, key=lambda m: m["bounce1_s"]):
        if m["bounce1_s"] - last > b["merge"]:
            dedup.append(m); last = m["bounce1_s"]
    serves = sorted({round(m["contact_s"], 2) for m in dedup})
    frames = sorted(trk); nbin = int(duration / V2.BIN_S) + 1; fastbin = np.zeros(nbin)
    for f0, f1 in zip(frames, frames[1:]):
        if f1 - f0 > 3:
            continue
        (xa, ya), (xb, yb) = trk[f0], trk[f1]
        if abs(xb - xa) + abs(yb - ya) >= V2.BALL_FAST_PX * scale:
            bi = int((f1 / fps) / V2.BIN_S)
            if bi < nbin:
                fastbin[bi] += 1
    dense = np.zeros(n, bool)
    for bi in np.nonzero(fastbin >= V2.MIN_FAST)[0]:
        V2._mark(dense, bi * V2.BIN_S, (bi + 1) * V2.BIN_S)
    for t in cross:
        V2._mark(dense, t - 0.2, t + 0.2)
    E = SimpleNamespace(duration=duration, fps=fps, n=n, shape=b["E"]["shape"], calibrated=b["E"]["calibrated"],
                        cross=cross, bt=np.asarray(bt, float), bt_table=np.asarray(bt_table, float),
                        serves=serves, ball_dense=dense, between=between)
    return E

def crossings_lob(trk, H, fps, lob_s, tracked_only=False, bounce_s=0.0, bt_table=None):
    pts, times = [], []
    for f in sorted(trk):
        t = f / fps; times.append(t)
        p = V2.project(H, *trk[f])
        if p and V2.in_corridor(*p):
            pts.append((t, p[1]))
    times = np.asarray(times)
    def seen_between(a, b_):
        i = np.searchsorted(times, a, side="right"); j = np.searchsorted(times, b_, side="left")
        return j > i
    bt_table = np.asarray(bt_table if bt_table is not None else [], float)
    out, side, streak, last, pending = [], 0, 0, None, False
    for t, v in pts:
        s = 1 if v > V2.NET_V + V2.NET_MARGIN_M else (-1 if v < V2.NET_V - V2.NET_MARGIN_M else 0)
        gap = None if last is None else t - last
        if s == 0 or (gap is not None and gap > V2.TELEPORT_S):
            streak = 0 if s == 0 else 1
            if s != 0 and gap is not None and gap > V2.TELEPORT_S:
                keep = gap <= lob_s and (not tracked_only or seen_between(last, t))
                if keep:
                    pending = True
                else:
                    side = 0; pending = False
            last = t
            if s != 0 and side == 0:
                side = s
            continue
        last = t
        streak += 1
        if s != side and streak >= V2.DWELL and side != 0:
            ok = True
            if pending and bounce_s > 0:
                ok = bool(len(bt_table)) and bool(((bt_table >= t) & (bt_table <= t + bounce_s)).any())
            if ok:
                out.append(t)
            side, streak, pending = s, 1, False
        elif side == 0:
            side, streak = s, 1
        if pending and streak >= 3:
            pending = False
    return out

def alt_crossings(b, base_cross, alt_s):
    """Add a crossing between consecutive table bounces on opposite halves within alt_s
    when no crossing already sits between them."""
    H, fps = b["H"], b["fps"]
    tb = []
    for f, x, y in b["bnc"]:
        p = V2.project(H, x, y)
        if p and -0.15 <= p[0] <= V2.W_M + 0.15 and -0.15 <= p[1] <= V2.L_M + 0.15:
            tb.append((f / fps, 1 if p[1] > V2.NET_V else -1))
    cross = np.asarray(base_cross, float); add = []
    for (t0, h0), (t1, h1) in zip(tb, tb[1:]):
        if h0 != h1 and t1 - t0 <= alt_s and not ((cross > t0) & (cross < t1)).any():
            add.append((t0 + t1) / 2.0)
    return np.asarray(sorted(list(cross) + add), float)


def split_variant(pause_s, wide):
    def fn(E, cards):
        out = []
        for c in cards:
            if c["t1"] - c["t0"] <= V2.MAX_CARD_S:
                out.append(c); continue
            i0, i1 = int(c["t0"] / TICK), int(c["t1"] / TICK)
            dense = E.ball_dense[i0:i1]
            if wide:
                m = int(SPLIT_MARGIN_S / TICK); lo, hi = m, len(dense) - m
            else:
                mid, win = len(dense) // 2, max(1, len(dense) // 4); lo, hi = mid - win, mid + win
            seg = dense[lo:hi]
            best_len, best_start, run, start = 0, None, 0, None
            for i, v in enumerate(seg):
                if not v:
                    if run == 0:
                        start = i
                    run += 1
                    if run > best_len:
                        best_len, best_start = run, start
                else:
                    run = 0
            if best_len * TICK < pause_s:
                out.append(c); continue
            cut = c["t0"] + (lo + best_start + best_len / 2.0) * TICK
            out.append(V2.clamp_evidence({**c, "t1": cut - V2.MIN_DEAD_S / 2, "end_evidence_s": None}))
            out.append(V2.clamp_evidence({**c, "t0": cut + V2.MIN_DEAD_S / 2, "serve_s": None, "why": c["why"] + " (long card split)"}))
        return out
    return fn

def assemble(E, split_fn=None):
    cards = V2.serve_points(E)
    cards += V2.fallback_points(E, cards)
    cards, _ = V2.veto(E, cards)
    cards = V2.resolve(V2.merge_continuous(E, V2.resolve(cards)))
    return V2.on_own_table(E, V2.resolve((split_fn or V2.split_long)(E, cards)))

# --- rulers -----------------------------------------------------------------
raw_of = {mid: os.path.basename(str(m.get("raw"))) for mid, m in meta.items()}
dump_ids = sorted(os.path.basename(p) for p in glob.glob(f"{DUMPS}/*"))
dump_by_raw = {raw_of[m]: m for m in dump_ids}
census_on = {m: [] for m in dump_ids}
for r in rows:
    dm = dump_by_raw.get(raw_of.get(r["match_id"]))
    if not dm:
        continue
    L = sorted(pts.get(r["match_id"], []), key=lambda p: p["t0"])
    me = next((p for p in L if p["idx"] == r["point"]), None)
    nx = next((p for p in L if me and p["t0"] > me["t0"] + 0.01), None)
    if me and nx:
        r = dict(r, db=dict(me=me, nxt=nx)); census_on[dm].append(r)

def taps_for(mid):
    return sorted(p["tap"] for p in pts.get(mid, []) if p["tap"] is not None)

def score(cards, taps, census):
    cards = sorted(cards, key=lambda c: c["t0"])
    n = len(cards); footage = sum(c["t1"] - c["t0"] for c in cards); nlong = sum(1 for c in cards if c["t1"] - c["t0"] > V2.MAX_CARD_S)
    taps = taps if len(taps) >= 20 else []
    allc = cards
    if taps:
        cards = [c for c in cards if c["t1"] >= min(taps) - 30 and c["t0"] <= max(taps) + 30]
    per = [sum(1 for t in taps if c["t0"] <= t <= c["t1"] + 0.5) for c in cards]
    lost = sum(1 for t in taps if not any(c["t0"] <= t <= c["t1"] + 0.5 for c in cards))
    split = two = 0
    for a, b_ in zip(cards, cards[1:]):
        if b_["t0"] - a["t1"] <= 1.6 and taps:
            ta = sum(1 for t in taps if a["t0"] <= t < b_["t0"]); tb = sum(1 for t in taps if b_["t0"] <= t <= b_["t1"] + 0.5)
            if ta + tb == 1: split += 1
            elif ta >= 1 and tb >= 1: two += 1
    cj = {"real": [0, 0], "no": [0, 0], "unsure": [0, 0]}
    detail = {}
    for r in census:
        me, nx = r["db"]["me"], r["db"]["nxt"]
        joined = any(c["t0"] <= me["t1"] - 0.5 and c["t1"] >= nx["t0"] + 0.5 for c in allc)
        cj[r["verdict"]][0] += 1; cj[r["verdict"]][1] += int(joined)
        detail[(r["match_id"], r["point"])] = joined
    return dict(n=n, footage=footage, nlong=nlong, t0=per.count(0), t1=per.count(1), t2=sum(1 for p in per if p >= 2), lost=lost,
                split=split, two=two, cj=cj, detail=detail)

def add(tot, s):
    for k in ("n", "footage", "nlong", "t0", "t1", "t2", "lost", "split", "two"):
        tot[k] = tot.get(k, 0) + s[k]
    for v, (a, b_) in s["cj"].items():
        tot.setdefault("cj", {}).setdefault(v, [0, 0]); tot["cj"][v][0] += a; tot["cj"][v][1] += b_
    tot.setdefault("detail", {}).update(s["detail"])


def main():
    # (name, lob_s, tracked_only, bounce_s, strict_serves, split)
    variants = [("baseline", 0.0, False, 0.0, False, None),
                ("lob2.0 raw", 2.0, False, 0.0, False, None),
                ("lob2.0 strict-serves", 2.0, False, 0.0, True, None),
                ("lob2.0 bounce", 2.0, False, 1.5, False, None),
                ("lob2.0 bounce strict", 2.0, False, 1.5, True, None),
                ("lob2.0 seen+bounce strict", 2.0, True, 1.5, True, None),
                ("lob1.5 bounce strict", 1.5, False, 1.5, True, None),
                ("lob3.0 bounce strict", 3.0, False, 1.5, True, None),
                ("lob2.0 bounce1.0 strict", 2.0, False, 1.0, True, None),
                ("split guard 0.6 mid", 0.0, False, 0.0, False, (0.6, False)),
                ("split guard 0.6 wide", 0.0, False, 0.0, False, (0.6, True)),
                ("split guard 1.0 wide", 0.0, False, 0.0, False, (1.0, True)),
                ("split guard 1.0 mid", 0.0, False, 0.0, False, (1.0, False)),
            ("split guard 1.5 mid", 0.0, False, 0.0, False, (1.5, False)),
            ("alt2.0 strict", "alt2.0", False, 0.0, True, None),
            ("alt3.0 strict", "alt3.0", False, 0.0, True, None),
            ("alt4.0 strict", "alt4.0", False, 0.0, True, None),
            ("lob1.5 bounce + alt2.0 strict", "lob1.5alt2.0", False, 1.5, True, None)]

    totals = {v[0]: {} for v in variants}
    print("FIDELITY (real Evidence from the dump's track vs the dump itself)")
    for mid in dump_ids:
        b = base(mid); d = b["d"]; E0 = b["E"]
        same_cross = len(E0["cross"]) == len(d["crossings"]) and np.allclose(np.round(E0["cross"], 2), d["crossings"], atol=0.011)
        same_serves = [round(s, 2) for s in E0["serves"]] == d["serves"]
        L = light_E(b, E0["cross"])
        light_ok = (np.array_equal(np.round(L.bt, 3), np.round(E0["bt"], 3)) and np.array_equal(np.round(L.bt_table, 3), np.round(E0["bt_table"], 3))
                    and [round(s, 2) for s in L.serves] == [round(s, 2) for s in E0["serves"]] and np.array_equal(L.ball_dense, E0["dense"]))
        final = assemble(L)
        dc = d["cards"]; hit = sum(1 for c in dc if any(abs(f["t0"] - c[0]) < 0.05 and abs(f["t1"] - c[1]) < 0.05 for f in final))
        prod = [p for p in pts.get(mid, [])]
        hitp = sum(1 for p in prod if any(abs(f["t0"] - p["t0"]) < 0.05 and abs(f["t1"] - p["t1"]) < 0.05 for f in final))
        print(f"  {mid[:8]} {meta[mid]['owner']:7s} {str(meta[mid]['opp'])[:14]:14s} crossings {'same' if same_cross else 'DIFF'} serves {'same' if same_serves else 'DIFF'} light-E {'exact' if light_ok else 'DIFF'}  cards {len(final)} vs dump {len(dc)} (exact {hit}) vs prod {len(prod)} (exact {hitp})  taps {len(taps_for(mid))} census rows {len(census_on[mid])}")

    print("\nVARIANTS")
    for name, lob, tracked, bounce_s, strict, sp in variants:
        for mid in dump_ids:
            b = base(mid)
            if lob == 0:
                cross = b["E"]["cross"]
            elif isinstance(lob, str) and lob.startswith("alt"):
                cross = alt_crossings(b, b["E"]["cross"], float(lob[3:]))
            elif isinstance(lob, str):
                cross = alt_crossings(b, crossings_lob(b["trk"], b["H"], b["fps"], 1.5, tracked, bounce_s, b["E"]["bt_table"]), 2.0)
            else:
                cross = crossings_lob(b["trk"], b["H"], b["fps"], lob, tracked, bounce_s, b["E"]["bt_table"])
            E = light_E(b, cross, b["E"]["cross"] if strict else None)
            cards = assemble(E, split_variant(*sp) if sp else None)
            s = score(cards, taps_for(mid), census_on[mid]); s["ncross"] = len(cross); s["nserves"] = len(E.serves)
            add(totals[name], s)
            totals[name]["ncross"] = totals[name].get("ncross", 0) + len(cross); totals[name]["nserves"] = totals[name].get("nserves", 0) + len(E.serves)
        t = totals[name]; cj = t["cj"]
        print(f"  {name:22s} cards {t['n']:4d} footage {t['footage']/60:6.1f}min long>20s {t['nlong']:2d} cross {t['ncross']:5d} serves {t['nserves']:4d} | taps: 0-tap cards {t['t0']:3d} 1-tap {t['t1']:3d} 2+tap {t['t2']:3d} lost {t['lost']:2d} | adjacent pairs split {t['split']:2d} two-points {t['two']:3d} | census joined real {cj['real'][1]}/{cj['real'][0]} no {cj['no'][1]}/{cj['no'][0]}")

    print("\nCENSUS REAL ROWS ON DUMP FOOTAGE (joined under each variant)")
    names = [v[0] for v in variants]
    reals = [r for m in dump_ids for r in census_on[m] if r["verdict"] == "real"]
    for r in reals:
        k = (r["match_id"], r["point"])
        print(f"  {r['match'][:30]:30s} pt {r['point']:3d} t1 {r['t1']:7.1f}  " + " ".join(f"{i}:{'J' if totals[n]['detail'].get(k) else '.'}" for i, n in enumerate(names)))
    print("  columns: " + "  ".join(f"{i}={n}" for i, n in enumerate(names)))
    print("\nCENSUS NO ROWS that a variant joins (bad)")
    for m in dump_ids:
        for r in census_on[m]:
            if r["verdict"] != "no": continue
            k = (r["match_id"], r["point"]); flags = [totals[n]["detail"].get(k) for n in names]
            if any(flags) and not all(flags):
                print(f"  {r['match'][:30]:30s} pt {r['point']:3d} t1 {r['t1']:7.1f}  " + " ".join(f"{i}:{'J' if f else '.'}" for i, f in enumerate(flags)))

    print("\nLONG CARDS before the cap (baseline), with the pause each guard reads")
    for mid in dump_ids:
        b = base(mid); E = light_E(b, b["E"]["cross"]); taps = taps_for(mid); taps = taps if len(taps) >= 20 else []
        cards = V2.serve_points(E); cards += V2.fallback_points(E, cards); cards, _ = V2.veto(E, cards)
        R = V2.resolve(V2.merge_continuous(E, V2.resolve(cards)))
        for c in R:
            dur = c["t1"] - c["t0"]
            if dur <= V2.MAX_CARD_S:
                continue
            i0, i1 = int(c["t0"] / TICK), int(c["t1"] / TICK); dense = E.ball_dense[i0:i1]
            def longest(seg):
                best = run_ = 0
                for v in seg:
                    run_ = run_ + 1 if not v else 0; best = max(best, run_)
                return best * TICK
            mid_, win = len(dense) // 2, max(1, len(dense) // 4); m3 = int(SPLIT_MARGIN_S / TICK)
            tp = [t for t in taps if c["t0"] <= t <= c["t1"] + 0.5]
            vs = [f"{r['point']}:{r['verdict']}" for r in census_on[mid] if c["t0"] - 0.5 <= r["db"]["me"]["t0"] <= c["t1"]]
            seg = dense[mid_-win:mid_+win].astype(float); k = int(np.argmin(np.convolve(seg, np.ones(6) / 6, "same"))); cut_now = c["t0"] + (mid_ - win + k) * TICK
            cuts = {}
            for nm, sp in (("mid0.6", (0.6, False)), ("wide0.6", (0.6, True)), ("mid1.0", (1.0, False))):
                halves = split_variant(*sp)(E, [c]); cuts[nm] = round(halves[0]["t1"] + V2.MIN_DEAD_S / 2, 1) if len(halves) == 2 else "whole"
            print(f"  {mid[:8]} {str(meta[mid]['opp'])[:10]:10s} {c['t0']:7.1f}-{c['t1']:7.1f} {dur:5.1f}s serve={c.get('serve_s') is not None!s:5s} pause mid {longest(dense[mid_-win:mid_+win]):4.1f}s wide {longest(dense[m3:len(dense)-m3]):4.1f}s taps {[round(t,1) for t in tp] if taps else '-'}  cut now {cut_now:.1f} -> {cuts}  census {' '.join(vs) or '-'}")

if __name__ == '__main__':
    main()
