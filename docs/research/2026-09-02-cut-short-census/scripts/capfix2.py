"""Three shapes of the same idea, judged on the boundaries the rule itself makes.

Adil judged a hundred card endings. The ones the 20-second cap produced are
the population this rule is answerable for, so each variant is scored on
whether it reproduces the boundaries he called correct and drops the ones he
called wrong.
"""
import json, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/docs/research/2026-09-02-cut-short-census/scripts")
import numpy as np
from replay import base, light_E, dump_ids, taps_for
from capfix import events, boundaries, place, assemble, ms, EDGE
import points_v2 as V2

# ---- which of the hundred boundaries the cap made, and what Adil said -----
rows = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
cap_rows = []
for r in rows:
    mid = r["match_id"]
    P = sorted(json.load(open(f"mj/{mid}.json"))["points"], key=lambda p: p["t0"])
    C = min(P, key=lambda p: abs(p["t0"] - r["db"]["me"]["t0"]))
    i = P.index(C); N = P[i + 1] if i + 1 < len(P) else None
    if not N:
        continue
    gap, span = N["t0"] - C["t1"], N["t1"] - C["t0"]
    if abs(gap - V2.MIN_DEAD_S) < 0.05 and N.get("serve_s") is None and span > V2.MAX_CARD_S:
        cap_rows.append(dict(mid=mid, match=r["match"], pt=r["point"], t1=C["t1"],
                             verdict=r["verdict"], span=span))
from collections import Counter
print("Boundaries in your hundred that the 20-second cap made:", len(cap_rows))
print("  your verdicts:", dict(Counter(c["verdict"] for c in cap_rows)))
print("  so on this rule's own output you judged it right",
      f"{sum(1 for c in cap_rows if c['verdict'] == 'no')} times and wrong",
      f"{sum(1 for c in cap_rows if c['verdict'] == 'real')} times")
have = [c for c in cap_rows if c["mid"] in dump_ids or c["mid"] in
        {"25765e26-cdf7-4025-b9c7-c4d45d3bcd07", "47b83b9b-ae34-4106-827d-be74d4bdf677",
         "840b4635-7791-4538-b722-9cd17ae6ed34", "fa96cd0e-bfbd-403b-8c30-87714ee78030"}]
print(f"  of those, {len(have)} sit on a match I can replay\n")

# ---- variants -------------------------------------------------------------
def once(gap_s, at_break):
    """Split at most once: keep today's shape, change only when and where."""
    def fn(E, cards):
        out = []
        for c in cards:
            if c["t1"] - c["t0"] <= V2.MAX_CARD_S:
                out.append(c); continue
            brk = [(a, b) for a, b in boundaries(E, c, gap_s)
                   if c["t0"] + EDGE <= (a + b) / 2.0 <= c["t1"] - EDGE]
            if not brk:
                out.append(c); continue
            if at_break:
                a, b = max(brk, key=lambda p: p[1] - p[0])
                t1, t0 = place(a, b)
                ev_end = a
            else:
                i0, i1 = int(c["t0"] / V2.TICK), int(c["t1"] / V2.TICK)
                dense = E.ball_dense[i0:i1].astype(float)
                mid, win = len(dense) // 2, max(1, len(dense) // 4)
                seg = dense[mid - win:mid + win]
                k = int(np.argmin(np.convolve(seg, np.ones(6) / 6, "same"))) if len(seg) else 0
                cut = c["t0"] + (mid - win + k) * V2.TICK
                t1, t0, ev_end = cut - V2.MIN_DEAD_S / 2, cut + V2.MIN_DEAD_S / 2, None
            out.append(V2.clamp_evidence({**c, "t1": t1, "end_evidence_s": ev_end}))
            out.append(V2.clamp_evidence({**c, "t0": t0, "serve_s": None,
                                          "why": c["why"] + " (long card split)"}))
        return out
    return fn

from capfix import split_evidence
VARIANTS = [("today", V2.split_long)]
for g in (2.5, 3.0, 3.5):
    VARIANTS.append((f"guard {g}, cut where it is quietest", once(g, False)))
    VARIANTS.append((f"guard {g}, cut at the break", once(g, True)))
    VARIANTS.append((f"guard {g}, cut at every break", split_evidence(g)))

print(f"{'variant':44s} {'agrees with you':>16s} {'disagrees':>10s} {'cards':>6s} {'2-tap':>6s} {'1-pt split':>11s}")
for name, fn in VARIANTS:
    agree = dis = ncards = fused = split1 = 0
    for mid in sorted({c["mid"] for c in have} | set(dump_ids)):
        if mid not in dump_ids:
            continue
        b = base(mid); E = light_E(b, b["E"]["cross"])
        cards, _ = assemble(E, fn)
        ncards += len(cards)
        taps = taps_for(mid); taps = taps if len(taps) >= 20 else []
        if taps:
            ins = [c for c in cards if c["t1"] >= min(taps) - 30 and c["t0"] <= max(taps) + 30]
            fused += sum(1 for c in ins if sum(1 for t in taps if c["t0"] <= t <= c["t1"] + 0.5) >= 2)
            for x, y in zip(ins, ins[1:]):
                if y["t0"] - x["t1"] <= 1.8:
                    ta = sum(1 for t in taps if x["t0"] <= t < y["t0"])
                    tb = sum(1 for t in taps if y["t0"] <= t <= y["t1"] + 0.5)
                    if ta + tb == 1:
                        split1 += 1
        for c0 in have:
            if c0["mid"] != mid:
                continue
            here = any(abs(c["t1"] - c0["t1"]) < 1.2 for c in cards)
            want = c0["verdict"] == "no"          # he said the cut was right
            if here == want:
                agree += 1
            else:
                dis += 1
    print(f"  {name:42s} {agree:>16d} {dis:>10d} {ncards:>6d} {fused:>6d} {split1:>11d}")
