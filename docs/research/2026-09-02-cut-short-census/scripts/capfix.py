"""Replace "the card is long" with "the point demonstrably ended here".

A rally in progress keeps producing events: the ball bounces on the table
or crosses the net every second or so. Between two points it does not. So
a long card is split only where the evidence itself shows a boundary, and
the cut goes AT that boundary rather than at the quietest tenth of a
second in the middle.
"""
import json, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/docs/research/2026-09-02-cut-short-census/scripts")
import numpy as np
from replay import base, light_E, dump_ids, taps_for, meta, census_on, pts
import points_v2 as V2
from points_v2 import TICK

EDGE = 2.0          # never cut within this of a card's own ends


def events(E, t0, t1):
    ev = sorted(set(list(E.between(E.bt_table, t0, t1)) + list(E.between(E.cross, t0, t1))))
    return [float(x) for x in ev]


def boundaries(E, c, gap_s):
    """Every place inside this card where the rally demonstrably stopped.

    The card's own ends count as events, so a long silence at either end is
    found as readily as one in the middle. Each break is returned as the
    pair of moments that bound it, so the cut can be placed where a normal
    card would end and the next begin rather than in the middle of nothing.
    """
    ev = [c["t0"]] + events(E, c["t0"], c["t1"]) + [c["t1"]]
    out = []
    for a, b in zip(ev, ev[1:]):
        if b - a >= gap_s:
            out.append((a, b))
    return out


def place(a, b):
    """Where the card before a break should end, and the next one begin."""
    t1 = a + V2.TAIL_AFTER_BOUNCE
    t0 = b - V2.HEAD_LEAD_BALL
    if t0 - t1 < V2.MIN_DEAD_S:
        mid = (a + b) / 2.0
        t1, t0 = mid - V2.MIN_DEAD_S / 2, mid + V2.MIN_DEAD_S / 2
    return t1, t0


def split_evidence(gap_s):
    def fn(E, cards):
        out = []
        for c in cards:
            if c["t1"] - c["t0"] <= V2.MAX_CARD_S:
                out.append(c); continue
            brk = [(a, b) for a, b in boundaries(E, c, gap_s)
                   if c["t0"] + EDGE <= (a + b) / 2.0 <= c["t1"] - EDGE]
            if not brk:
                out.append(c); continue          # one long rally: leave it alone
            pieces, start, first = [], c["t0"], True
            for pair in brk + [None]:
                if pair is None:
                    end, nxt = c["t1"], None
                else:
                    end, nxt = place(*pair)
                piece = {**c, "t0": start, "t1": end}
                if not first:
                    piece["serve_s"] = None
                    piece["why"] = c["why"] + " (split at a break in play)"
                if pair is not None:
                    piece["end_evidence_s"] = pair[0]
                if end - start >= V2.MIN_CARD_S:
                    pieces.append(V2.clamp_evidence(piece))
                if pair is None:
                    break
                start, first = nxt, False
            out.extend(pieces)
        return out
    return fn


def assemble(E, split_fn):
    cards = V2.serve_points(E)
    cards += V2.fallback_points(E, cards)
    cards, _ = V2.veto(E, cards)
    cards = V2.resolve(V2.merge_continuous(E, V2.resolve(cards)))
    return V2.on_own_table(E, V2.resolve(split_fn(E, cards))), cards


def ms(t):
    m = int(t) // 60
    return f"{m}:{t-60*m:05.2f}"


print("WHAT THE LONG CARDS LOOK LIKE INSIDE (nine matches, 32 cards over 20s)\n")
rows = []
for mid in dump_ids:
    b = base(mid); E = light_E(b, b["E"]["cross"])
    _, pre = assemble(E, V2.split_long)
    taps = taps_for(mid); taps = taps if len(taps) >= 20 else []
    for c in pre:
        if c["t1"] - c["t0"] <= V2.MAX_CARD_S:
            continue
        ev = [c["t0"]] + events(E, c["t0"], c["t1"]) + [c["t1"]]
        gaps = sorted((b_ - a for a, b_ in zip(ev, ev[1:])), reverse=True)
        tp = [t for t in taps if c["t0"] <= t <= c["t1"] + 0.5]
        rows.append(dict(mid=mid, t0=c["t0"], t1=c["t1"], dur=c["t1"] - c["t0"],
                         biggest=gaps[0] if gaps else 0.0, n_ev=len(ev) - 2, taps=len(tp) if taps else None))
for r in sorted(rows, key=lambda r: -(r["biggest"] or 0)):
    print(f"  {r['mid'][:8]} {ms(r['t0'])}-{ms(r['t1'])} {r['dur']:5.1f}s  {r['n_ev']:3d} events, "
          f"biggest gap between them {r['biggest']:5.2f}s   taps inside {r['taps'] if r['taps'] is not None else '-'}")

print("\nHOW MANY WOULD STILL BE SPLIT, BY THRESHOLD")
for g in (2.0, 2.5, 3.0, 3.5, 4.0):
    n = sum(1 for r in rows if (r["biggest"] or 0) >= g)
    print(f"  a break of {g:.1f}s or more: {n:2d} of {len(rows)} cards split, {len(rows)-n:2d} kept whole")
json.dump(rows, open("longcards_events.json", "w"), indent=1)


print("\n" + "=" * 78)
print("DOES IT ACTUALLY DO BETTER? scored against Adil's winner taps")
print("=" * 78)


def score(cards, taps):
    cards = sorted(cards, key=lambda c: c["t0"])
    if not taps:
        return None
    lo, hi = min(taps) - 30, max(taps) + 30
    inside = [c for c in cards if c["t1"] >= lo and c["t0"] <= hi]
    per = [sum(1 for t in taps if c["t0"] <= t <= c["t1"] + 0.5) for c in inside]
    fused = sum(1 for p in per if p >= 2)
    lost = sum(1 for t in taps if not any(c["t0"] <= t <= c["t1"] + 0.5 for c in inside))
    split = two = 0
    for a, b in zip(inside, inside[1:]):
        if b["t0"] - a["t1"] <= 1.8:
            ta = sum(1 for t in taps if a["t0"] <= t < b["t0"])
            tb = sum(1 for t in taps if b["t0"] <= t <= b["t1"] + 0.5)
            if ta + tb == 1:
                split += 1
            elif ta >= 1 and tb >= 1:
                two += 1
    return dict(n=len(inside), fused=fused, lost=lost, split=split, two=two)


VARIANTS = [("today: cut any card over 20s at its quietest moment", V2.split_long)]
for g in (2.5, 3.0, 3.5):
    VARIANTS.append((f"new: cut only where play stopped for {g:.1f}s or more", split_evidence(g)))

for name, fn in VARIANTS:
    tot = dict(n=0, fused=0, lost=0, split=0, two=0, cards=0, longkept=0)
    for mid in dump_ids:
        b = base(mid); E = light_E(b, b["E"]["cross"])
        cards, _ = assemble(E, fn)
        tot["cards"] += len(cards)
        tot["longkept"] += sum(1 for c in cards if c["t1"] - c["t0"] > V2.MAX_CARD_S)
        s = score(cards, taps_for(mid) if len(taps_for(mid)) >= 20 else [])
        if s:
            for k in ("n", "fused", "lost", "split", "two"):
                tot[k] += s[k]
    print(f"\n  {name}")
    print(f"     cards in total {tot['cards']:4d}   over 20s and left whole {tot['longkept']:2d}")
    print(f"     against the taps: cards holding two winners (cannot be scored) {tot['fused']:2d}"
          f"   one point split across a boundary {tot['split']:2d}"
          f"   boundaries that correctly separate two points {tot['two']:3d}"
          f"   taps in no card {tot['lost']:2d}")

print("\n" + "=" * 78)
print("THE FIVE ENDINGS ADIL CALLED CUT SHORT THAT CAME FROM THE 20s CAP")
print("=" * 78)
CAP = [("fa96cd0e-bfbd-403b-8c30-87714ee78030", "Kyle point 8", 118.08),
       ("47b83b9b-ae34-4106-827d-be74d4bdf677", "Anton 26 Aug point 58", 769.29)]
for mid, label, cut in CAP:
    b = base(mid); E = light_E(b, b["E"]["cross"])
    for name, fn in VARIANTS:
        cards, _ = assemble(E, fn)
        holds = [c for c in cards if c["t0"] < cut - 0.5 and c["t1"] > cut + 0.5]
        near = [c for c in cards if abs(c["t1"] - cut) < 1.0]
        verdict = ("kept whole" if holds else f"still cut at {ms(near[0]['t1'])}" if near else "boundary moved")
        print(f"  {label:24s} {name[:52]:52s} -> {verdict}")
    print()
