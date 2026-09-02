"""Replay the v2 assembler on Anton m1-m6 from the local crop detections
and say, for every census card, which rule set its end.

The replay is checked against the production cards first: a stage trace
is only worth reading if the cards it produces are the cards Adil saw.
"""
import json, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import numpy as np
import points_v2 as V2, points_endon as EO

MIDS = {"m1": "c8d94769-bd21-4b56-b584-9cd8ddc1bb23", "m2": None, "m3": None,
        "m4": "ad634efd-751d-43cf-a5c4-02de2bb2986c",
        "m5": "3477975a-e7c5-43ba-953a-e7b07f183063",
        "m6": "41a18e3d-0055-4910-acfe-a3b723e3ef50"}
FPS = 30000 / 1001
cor_all = json.load(open("/tmp/serve-diag/corners.json"))
out_all = json.load(open("/tmp/serve-diag/anton_out.json"))
db = json.load(open("/tmp/serve-diag/census/db_points.json"))
verd = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
labels = {r["match_id"]: r["match"] for r in verd}
# fill in m2/m3 ids from the labels
for mid, lab in labels.items():
    for m in ("m2", "m3"):
        if lab.startswith(f"Adil / Anton {m} ("):
            MIDS[m] = mid

def load(path, dx, dy):
    cand = V2.load_multi(path)
    return {f: [(x + dx, y + dy, s) for x, y, s in L] for f, L in cand.items()}

def trace(m):
    mid = MIDS[m]
    if mid is None or mid not in db:
        print(f"{m}: no production cards to compare"); return
    cor = cor_all[m]
    import os
    d = f"/tmp/serve-diag/anton/{m}"
    crop2 = f"{d}/crop2_Anton{m}.jsonl"
    if os.path.exists(crop2):
        bx, by, bw, bh = EO.ball_crop_box(cor); path = crop2
    else:
        bx, by, bw, bh = out_all[m]["box"]; path = f"{d}/crop.jsonl"
    cand = load(path, bx, by)
    dur = float(out_all[m]["dur"])
    E = V2.Evidence(cand, cor, None, FPS, dur, 1920)

    # --- instrument rally_end_ev ---
    trace_ev = {}
    orig = V2.rally_end_ev
    def traced(E_, contact_s):
        last = contact_s
        for t in E_.cross:
            if t < contact_s: continue
            if t - last > V2.CROSS_GAP_S: break
            last = t
        b = E_.between(E_.bt_table, contact_s, last + 2.0)
        padded, ev = orig(E_, contact_s)
        term = ("bounce+2.6" if len(b) and abs(padded - (float(b[-1]) + V2.TAIL_AFTER_BOUNCE)) < 1e-6
                else ("cross+2.6+6.0cap" if len(b) else "no-bounce: cross+2.6"))
        trace_ev[round(float(contact_s), 3)] = dict(chain_end=float(last), n_chain_x=int(((E_.cross >= contact_s) & (E_.cross <= last)).sum()),
                                                    last_chain_bounce=(float(b[-1]) if len(b) else None), padded=float(padded), ev=float(ev), term=term)
        return padded, ev
    V2.rally_end_ev = traced

    S = V2.serve_points(E)
    F = V2.fallback_points(E, S)
    Vc, _ = V2.veto(E, S + F)
    R1 = V2.resolve(Vc)
    M = V2.merge_continuous(E, R1)
    R2 = V2.resolve(M)
    SL = V2.split_long(E, R2)
    R3 = V2.resolve(SL)
    final = V2.on_own_table(E, R3)
    V2.rally_end_ev = orig

    prod = sorted((k for k in db[mid]), key=lambda k: k["t0"])
    # replay fidelity
    hit = 0
    for k in prod:
        if any(abs(c["t0"] - k["t0"]) < 0.2 and abs(c["t1"] - k["t1"]) < 0.2 for c in final): hit += 1
    print(f"\n### {m}  {labels.get(mid, mid[:8])}: replay {len(final)} cards vs production {len(prod)}; "
          f"{hit} of {len(prod)} production cards reproduced within 0.2s")

    flagged = [r for r in verd if r["match_id"] == mid]
    def stage_t1(cards, t0, serve):
        # the card at this stage that will become the final one: same serve, else nearest t0
        if serve is not None:
            for c in cards:
                if c.get("serve_s") is not None and abs(c["serve_s"] - serve) < 1e-6: return c["t1"]
        best = min(cards, key=lambda c: abs(c["t0"] - t0), default=None)
        return best["t1"] if best and abs(best["t0"] - t0) < 2.0 else None
    for r in sorted(flagged, key=lambda r: r["t1"]):
        k = next((k for k in prod if k["idx"] == r["point"]), None)
        c = min(final, key=lambda c: abs(c["t1"] - k["t1"]))
        if abs(c["t1"] - k["t1"]) > 0.3:
            print(f"  pt {r['point']:3d} [{r['verdict']}] production {k['t0']:.1f}-{k['t1']:.1f}: NOT reproduced (nearest replay card {c['t0']:.1f}-{c['t1']:.1f})"); continue
        s = c.get("serve_s")
        t1s = {name: stage_t1(cards, c["t0"], s) for name, cards in (("serve/fallback", S + F), ("veto", Vc), ("resolve1", R1), ("merge", M), ("resolve2", R2), ("split", SL), ("resolve3", R3))}
        ev = trace_ev.get(round(float(s), 3)) if s is not None else None
        why = c.get("why")
        # what happened right after t1
        t1 = c["t1"]
        late_b = [float(t) for t in E.bt_table if t1 - 2.6 < t <= t1 + 3.0]
        late_x = [float(t) for t in E.cross if t1 - 3.0 < t <= t1 + 3.0]
        nxt = next((n for n in final if n["t0"] > c["t0"]), None)
        print(f"  pt {r['point']:3d} [{r['verdict']:4s}] {c['t0']:.1f}-{c['t1']:.1f} ({c['t1']-c['t0']:.1f}s) why={why!s:24s} | t1 by stage: " +
              " ".join(f"{n}={v:.1f}" if v is not None else f"{n}=-" for n, v in t1s.items()))
        if ev:
            print(f"           rally_end_ev: chain of {ev['n_chain_x']} crossings ends {ev['chain_end']:.1f}, last chain bounce {ev['last_chain_bounce']}, padded {ev['padded']:.1f} via {ev['term']}, evidence {ev['ev']:.1f}")
        print(f"           table bounces t1-2.6..t1+3: {[round(t - t1, 1) for t in late_b]}   crossings t1-3..t1+3: {[round(t - t1, 1) for t in late_x]}"
              + (f"   next card {nxt['t0']:.1f}-{nxt['t1']:.1f} why={nxt.get('why')} serve={nxt.get('serve_s')}" if nxt else ""))

for m in ("m1", "m2", "m3", "m4", "m5", "m6"):
    trace(m)
