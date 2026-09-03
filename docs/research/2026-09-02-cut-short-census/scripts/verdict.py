"""One named cause per flagged ending.

match.json is the assembler's own output (the points table can have been
edited since), serves.json carries the bounces and crossings it saw. Each
branch below is a boundary rule in points_v2, tested against the numbers
that rule would have produced.
"""
import json, glob, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2

W = "/tmp/serve-diag/census"
rows = [r for r in json.load(open(f"{W}/verdicts_joined.json")) if r["verdict"] == "real"]
sj = {os.path.basename(p).split(".")[0]: json.load(open(p)) for p in glob.glob(f"{W}/*.serves.json")}
NEAR = lambda a, b, tol=0.08: a is not None and b is not None and abs(a - b) < tol

out = []
for r in sorted(rows, key=lambda r: (r["match"], r["point"])):
    mid = r["match_id"]; me_db = r["db"]["me"]
    P = sorted(json.load(open(f"mj/{mid}.json"))["points"], key=lambda p: p["t0"])
    C = min(P, key=lambda p: abs(p["t0"] - me_db["t0"])); i = P.index(C)
    N = P[i + 1] if i + 1 < len(P) else None
    cards = sorted(sj[mid]["cards"], key=lambda c: c["t0"])
    sc = min(cards, key=lambda c: abs(c["t0"] - C["t0"]))
    xs = sc.get("crossings") or []
    tb = [b["t"] for b in sc["bounces"] if b.get("onTable")]
    # the chain rally_end_ev would have walked from the serve (or the card start)
    start = C.get("serve_s") if C.get("serve_s") is not None else C["t0"]
    last = start
    for t in xs:
        if t < start: continue
        if t - last > V2.CROSS_GAP_S: break
        last = t
    chain_b = [t for t in tb if start <= t <= last + 2.0]
    tail_end = (min(chain_b[-1] + V2.TAIL_AFTER_BOUNCE, last + V2.TAIL_AFTER_CROSS + V2.TAIL_MAX_S)
                if chain_b else last + V2.TAIL_AFTER_CROSS)
    broke = [round(b - a, 2) for a, b in zip(xs, xs[1:]) if b - a > V2.CROSS_GAP_S and a >= start]
    t1, gap = C["t1"], (N["t0"] - C["t1"]) if N else None
    span = (N["t1"] - C["t0"]) if N else None
    cause = detail = None
    if me_db["tight_end"]:
        cause, detail = "your own split", f"you cut here by hand; the row after it starts at the same instant"
    elif N and N.get("serve_s") is not None and NEAR(t1, N["t0"] - V2.MIN_DEAD_S, 0.06):
        cause = "cut back for a serve that was detected next"
        detail = (f"a serve was read at {N['serve_s']:.2f}, so its card had to open at {N['t0']:.2f}; "
                  f"this card was pulled back the 1.2s of dead space that must sit between two cards")
    elif N and N.get("serve_s") is not None and NEAR(t1, N["serve_s"] - V2.HEAD_MIN_S - V2.SQUEEZE_DEAD_S, 0.1):
        cause = "cut back for a serve that was detected next"
        detail = (f"a serve was read at {N['serve_s']:.2f}; two cards that both open on a serve are squeezed together, "
                  f"and what gives is this card's tail, cut to 1.3s before that serve")
    elif C.get("serve_s") is not None and N and N.get("serve_s") is not None and NEAR(t1, C["serve_s"] + V2.MIN_RALLY_S, 0.1):
        cause = "squeezed to the shortest a rally may be"
        detail = (f"two serves were read 	{N['serve_s'] - C['serve_s']:.1f}s apart ({C['serve_s']:.2f} and {N['serve_s']:.2f}); "
                  f"the first card was compressed to 1.5s after its own serve to make room for the second")
    elif NEAR(t1, tail_end, 0.2):
        if broke:
            cause = "the rally chain broke on a gap between net crossings"
            detail = (f"crossings {[round(x,2) for x in xs]} with a {broke[0]}s hole, longer than the 3.0s a rally is "
                      f"allowed to pause; everything after that hole was ignored, so the tail was measured from "
                      f"{chain_b[-1] if chain_b else last:.2f} and the card ended 2.6s later")
        else:
            late = [t for t in tb if t > last + 2.0]
            cause = "the 2.6s tail, measured from the last bounce it counted"
            detail = (f"last counted table bounce {chain_b[-1]:.2f}, last crossing {last:.2f}"
                      + (f"; {len(late)} further table bounce(s) at {[round(t,2) for t in late]} fell outside the "
                         f"2s window the rule looks in and were ignored" if late else ""))
    elif gap is not None and NEAR(gap, V2.MIN_DEAD_S, 0.05) and N.get("serve_s") is None and span and span > V2.MAX_CARD_S:
        cause = "the 20-second cap cut the rally in half"
        detail = (f"this card plus the next spans {span:.1f}s, over the 20s a single card may run; it was cut at the "
                  f"quietest moment in the middle and the two halves sit 1.2s apart")
    else:
        cause, detail = "not matched", f"t1 {t1}, tail rule would give {tail_end:.2f}, gap {gap}, span {span}"
    out.append(dict(match=r["match"], pt=r["point"], t1=t1, cause=cause, detail=detail,
                    dur=C["t1"] - C["t0"], serve=C.get("serve_s"), n_cross=len(xs), broke=broke))

from collections import Counter
print("CAUSE OF EACH ENDING\n")
for c, n in Counter(o["cause"] for o in out).most_common():
    print(f"  {n:2d}  {c}")
for c, _ in Counter(o["cause"] for o in out).most_common():
    print(f"\n--- {c} ---")
    for o in out:
        if o["cause"] != c: continue
        print(f"  {o['match'][:34]:34s} pt {o['pt']:3d}  ends {o['t1']:8.2f} ({o['dur']:4.1f}s card)")
        print(f"      {o['detail']}")
json.dump(out, open("causes.json", "w"), indent=1)
