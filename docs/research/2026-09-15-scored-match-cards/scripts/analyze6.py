"""Duration card with the end bounded by the score tap, split by server; serve speed by player."""
import json, math, os, sys
from collections import Counter, defaultdict
W, L = 1.525, 2.74; NET = L/2
SP = sys.argv[1]; CORPUS = os.path.join(SP, "corpus"); OUT = os.path.join(SP, "out")
manifest = json.load(open(os.path.join(CORPUS, "manifest.json")))
def other(s): return "far" if s == "near" else "near"
def pct(a, b): return f"{100*a/b:.0f}%" if b else "-"
D = Counter(); DW = Counter(); per = defaultdict(Counter)
SPD = defaultdict(list)
for m in manifest:
    slug = m["slug"]
    raw = json.load(open(os.path.join(CORPUS, f"{slug}.json")))
    serv = json.load(open(os.path.join(OUT, f"{slug}.serving.json")))
    srows = {r["pointId"]: r for r in serv["rows"]}
    pre = 1.2
    try: pre = float((raw["match"].get("clip_pads") or {}).get("pre", 1.2))
    except Exception: pass
    for p in raw["points"]:
        if p["deleted"] or not p["confirmed_winner"] or p.get("is_let"): continue
        pl = p.get("placement") or {}
        if pl.get("v") != 3: continue
        sr = srows.get(p["id"])
        if not sr or not sr["serverSide"]: continue
        server = sr["serverSide"]; user = sr["userPhysicalSide"]
        winner = user if p["confirmed_winner"] == "user" else other(user)
        per[slug]["points"] += 1
        def to_source(cut_s): return float(p["t0"]) - pre - float(p["cut_t0"]) + float(cut_s)
        rally_end = to_source(p["rally_end_cut_s"]) if p.get("rally_end_cut_s") is not None and p.get("cut_t0") is not None else None
        tap = to_source(p["scored_at_cut_s"]) if p.get("scored_at_cut_s") is not None and p.get("cut_t0") is not None else None
        ends = [x for x in (rally_end, tap) if x is not None]
        if not ends: continue
        end = min(ends)
        cands = sorted(pl.get("candidates") or [], key=lambda c: c["t"])
        bounces = [c for c in cands if c["kind"] == "bounce"]
        hyp = pl["hypotheses"][server]
        serve_shot = next((s for s in hyp["shots"] if s["phase"] == "serve"), None)
        start = None
        if sr["rejection"] is None and serve_shot and serve_shot.get("serve_first_bounce"):
            start = serve_shot["serve_first_bounce"]["t"]; per[slug]["start_serve"] += 1
        else:
            on = [c for c in bounces if c.get("u") is not None and 0 <= c["u"] <= W and 0 <= c["v"] <= L and c["t"] < end]
            if on: start = on[0]["t"]; per[slug]["start_first_bounce"] += 1
        if start is None or end - start < 0.3: continue
        dur = end - start
        per[slug]["covered"] += 1
        b = "short <3s" if dur < 3 else ("mid 3-6s" if dur < 6 else "long 6s+")
        who = "your serve" if server == user else "their serve"
        D[(who, b)] += 1
        if winner == user: DW[(who, b)] += 1
        D[("all", b)] += 1
        if winner == user: DW[("all", b)] += 1
        # serve speed by player
        if sr["rejection"] is None and serve_shot and serve_shot.get("serve_first_bounce") and serve_shot["serve_first_bounce"].get("u") is not None:
            a, c = serve_shot["serve_first_bounce"], serve_shot["landing"]
            d = math.hypot(c["u"]-a["u"], c["v"]-a["v"]); dt = c["t"] - a["t"]
            if 0.05 < dt < 1.5 and d > 0.2: SPD[who].append((d/dt, winner == server))
print("=== POINT LENGTH: serve's first bounce -> earlier of rally end and your score tap; uploader win rate ===")
for who in ("all", "your serve", "their serve"):
    print("  " + who)
    for b in ("short <3s", "mid 3-6s", "long 6s+"):
        print(f"     {b:10s} n={D[(who,b)]:4d}  you won {pct(DW[(who,b)], D[(who,b)])}")
tot = sum(v["points"] for v in per.values()); cov = sum(v["covered"] for v in per.values())
print(f"  coverage {pct(cov, tot)} of {tot} scored points  (start from a drawn serve {sum(v['start_serve'] for v in per.values())}, from the first in-table bounce {sum(v['start_first_bounce'] for v in per.values())})")
print("\n=== SERVE SPEED by player, thirds within each ===")
for who, lst in SPD.items():
    s = sorted(x for x, _ in lst); n = len(s); q1, q3 = s[n//3], s[2*n//3]
    print(f"  {who}: n={n} median {s[n//2]:.1f} m/s")
    for name, lo, hi in (("slow", 0, q1), ("medium", q1, q3), ("fast", q3, 99)):
        sel = [w for x, w in lst if lo <= x < hi]
        print(f"     {name:7s} n={len(sel):4d}  server won {pct(sum(sel), len(sel))}")
json.dump({"per": {k: dict(v) for k, v in per.items()},
           "dur": {f"{w}|{b}": [D[(w,b)], DW[(w,b)]] for w in ("all","your serve","their serve") for b in ("short <3s","mid 3-6s","long 6s+")},
           "speed": {w: [[round(x,2), bool(s)] for x, s in lst] for w, lst in SPD.items()}},
          open(os.path.join(OUT, "chart6.json"), "w"))
