"""Every split the 20-second cap made across the scored corpus, judged.

A split shows up in the assembler's own record as two cards exactly
MIN_DEAD_S apart whose combined span passes the cap, where the first card's
end is not explained by its own tail rule and the second opens on no serve.

Adil's winner taps judge it: one tap across the pair means one point was cut
in two, two taps mean two points were correctly separated.
"""
import json, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2

cand = {c["mid"]: c for c in json.load(open("candidates.json"))}
taps_all = json.load(open("taps.json"))

def ms(t):
    m = int(t) // 60
    return f"{m}:{t - 60 * m:05.2f}"

def events_of(card):
    ev = [b["t"] for b in card.get("bounces", []) if b.get("onTable")]
    ev += list(card.get("crossings") or [])
    return sorted(ev)

splits = []
for mid, c in cand.items():
    if c.get("pipeline") != "v2":
        continue
    P = sorted(json.load(open(f"mj/{mid}.json"))["points"], key=lambda p: p["t0"])
    sj = json.load(open(f"sj/{mid}.json")) if c.get("has_sj") else None
    cards = sorted(sj["cards"], key=lambda k: k["t0"]) if sj else None
    taps = taps_all.get(mid, [])
    for A, B in zip(P, P[1:]):
        gap, span = B["t0"] - A["t1"], B["t1"] - A["t0"]
        if not (abs(gap - V2.MIN_DEAD_S) < 0.05 and B.get("serve_s") is None and span > V2.MAX_CARD_S):
            continue
        rec = dict(mid=mid, owner=c["owner"], opp=c["opp"], created=c["created"],
                   a_idx=A["idx"], b_idx=B["idx"], a0=A["t0"], a1=A["t1"], b0=B["t0"], b1=B["t1"],
                   span=span, a_serve=A.get("serve_s"))
        # the tail rule, to be sure this is the cap and not an ordinary ending
        if cards:
            ca = min(cards, key=lambda k: abs(k["t0"] - A["t0"]))
            cb = min(cards, key=lambda k: abs(k["t0"] - B["t0"]))
            if abs(ca["t0"] - A["t0"]) > 0.5 or abs(cb["t0"] - B["t0"]) > 0.5:
                rec["evidence"] = False
            else:
                ea, eb = events_of(ca), events_of(cb)
                tb = [b["t"] for b in ca.get("bounces", []) if b.get("onTable")]
                rec["tail_explains"] = bool(tb) and abs(A["t1"] - (tb[-1] + V2.TAIL_AFTER_BOUNCE)) < 0.25
                rec["evidence"] = True
                rec["last_event_a"] = ea[-1] if ea else None
                rec["first_event_b"] = eb[0] if eb else None
                rec["ev_gap"] = (eb[0] - ea[-1]) if (ea and eb) else None
                rec["n_ev"] = len(ea) + len(eb)
        else:
            rec["evidence"] = False
        ta = [t for t in taps if A["t0"] <= t <= A["t1"] + 0.5]
        tb_ = [t for t in taps if B["t0"] <= t <= B["t1"] + 0.5]
        rec["taps_a"], rec["taps_b"] = len(ta), len(tb_)
        rec["verdict"] = ("two points" if ta and tb_ else
                          "one point" if len(ta) + len(tb_) == 1 else
                          "unscored" if not ta and not tb_ else "more than two")
        splits.append(rec)

json.dump(splits, open("splits.json", "w"), indent=1)
from collections import Counter
print(f"Splits the 20-second cap made across {len({s['mid'] for s in splits})} scored v2 matches: {len(splits)}")
print("judged by Adil's winner taps:", dict(Counter(s["verdict"] for s in splits)))
real = [s for s in splits if s["verdict"] in ("one point", "two points")]
print(f"\nof the {len(real)} with tap evidence: "
      f"{sum(1 for s in real if s['verdict']=='two points')} correctly separated two points, "
      f"{sum(1 for s in real if s['verdict']=='one point')} cut a single point in half "
      f"({sum(1 for s in real if s['verdict']=='one point')/len(real)*100:.0f}%)")
print("\nper match:")
print(f"  {'owner':12s} {'opponent':22s} {'date':11s} {'splits':>6s} {'two':>4s} {'one':>4s} {'unscored':>8s}")
for mid in sorted({s["mid"] for s in splits}, key=lambda m: -sum(1 for s in splits if s["mid"] == m)):
    g = [s for s in splits if s["mid"] == mid]
    print(f"  {g[0]['owner'][:12]:12s} {g[0]['opp'][:22]:22s} {g[0]['created']:11s} {len(g):6d} "
          f"{sum(1 for s in g if s['verdict']=='two points'):4d} {sum(1 for s in g if s['verdict']=='one point'):4d} "
          f"{sum(1 for s in g if s['verdict']=='unscored'):8d}")
