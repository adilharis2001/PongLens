"""The assembler's own card list against the rows that exist now.

serves.json is written at processing time, so its cards are what the
assembler produced. The points table is what survives editing. A flagged
ending that matches an assembler card is the pipeline's; one that does not
is an edit.
"""
import json, glob, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2

W = "/tmp/serve-diag/census"
rows = [r for r in json.load(open(f"{W}/verdicts_joined.json")) if r["verdict"] == "real"]
db = json.load(open(f"{W}/db_points.json"))
sj = {os.path.basename(p).split(".")[0]: json.load(open(p)) for p in glob.glob(f"{W}/*.serves.json")}

for r in sorted(rows, key=lambda r: (r["match"], r["point"])):
    mid = r["match_id"]; me = r["db"]["me"]
    L = sorted(db[mid], key=lambda k: k["t0"])
    cards = sorted(sj[mid]["cards"], key=lambda c: c["t0"]) if mid in sj else []
    lo, hi = me["t0"] - 26, me["t1"] + 26
    print(f"\n=== {r['match'][:40]} point {r['point']} — card {me['t0']:.2f}-{me['t1']:.2f} ({me['t1']-me['t0']:.1f}s)")
    print(f"    assembler's own cards nearby:")
    for c in cards:
        if not (lo <= c["t0"] <= hi):
            continue
        mark = "  <<< this one" if abs(c["t0"] - me["t0"]) < 0.4 and abs(c["t1"] - me["t1"]) < 0.4 else ""
        xs = c.get("crossings") or []
        tb = [b["t"] for b in c["bounces"] if b.get("onTable")]
        tail_b = f"{c['t1'] - tb[-1]:.2f}s after last table bounce" if tb else "no table bounce"
        tail_x = f"{c['t1'] - xs[-1]:.2f}s after last crossing" if xs else "no crossing"
        print(f"      {c['t0']:8.2f}-{c['t1']:8.2f} {c['dur']:5.1f}s serve={('%.2f' % c['serve_s']) if c.get('serve_s') is not None else '   -  '} "
              f"x{len(xs):<2d} | {tail_b:36s} {tail_x}{mark}")
    print(f"    rows in the database now:")
    for k in L:
        if not (lo <= k["t0"] <= hi):
            continue
        mark = "  <<< the flagged one" if k["idx"] == r["point"] else ""
        flags = "".join(f for f, v in (("D", k["deleted"]), ("S", k["scored"]), ("<", k["tight_start"]), (">", k["tight_end"])) if v)
        print(f"      idx {k['idx']:4d} {k['t0']:8.2f}-{k['t1']:8.2f} {k['t1']-k['t0']:5.1f}s {flags:5s}{mark}")
    # split test on the assembler's own list
    here = [c for c in cards if abs(c["t0"] - me["t0"]) < 0.4]
    if here:
        c = here[0]; i = cards.index(c)
        nxt = cards[i + 1] if i + 1 < len(cards) else None
        if nxt:
            gap = nxt["t0"] - c["t1"]; span = nxt["t1"] - c["t0"]
            xs = c.get("crossings") or []; tb = [b["t"] for b in c["bounces"] if b.get("onTable")]
            tail_fits = (tb and abs(c["t1"] - tb[-1] - V2.TAIL_AFTER_BOUNCE) < 0.15) or (xs and abs(c["t1"] - xs[-1] - V2.TAIL_AFTER_CROSS) < 0.15)
            verdict = ("ends on its own tail rule" if tail_fits else
                       "LONG-CARD SPLIT" if (abs(gap - V2.MIN_DEAD_S) < 0.05 and nxt.get("serve_s") is None and span > V2.MAX_CARD_S) else
                       f"squeezed for the next serve" if (nxt.get("serve_s") is not None and abs(c["t1"] - (nxt["serve_s"] - 1.3)) < 0.25) else
                       "no rule fits — look closer")
            print(f"    -> gap to next {gap:.2f}s, next serve {nxt.get('serve_s')}, combined span {span:.1f}s: {verdict}")
