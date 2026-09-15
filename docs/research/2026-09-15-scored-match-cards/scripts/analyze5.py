"""Time-gated first-three-balls, and the rally end versus the score tap."""
import json, math, os, sys
from collections import Counter, defaultdict
W, L = 1.525, 2.74; NET = L/2
SP = sys.argv[1]; CORPUS = os.path.join(SP, "corpus"); OUT = os.path.join(SP, "out")
manifest = json.load(open(os.path.join(CORPUS, "manifest.json")))
def half(v): return None if v is None else ("near" if v < NET else "far")
def inside(u, v): return u is not None and v is not None and 0 <= u <= W and 0 <= v <= L
def other(s): return "far" if s == "near" else "near"
def pct(a, b): return f"{100*a/b:.0f}%" if b else "-"
G = Counter(); per = defaultdict(Counter)
tapgap = []; tap_before_end = 0; tap_n = 0
recv = defaultdict(lambda: [0, 0])
third = defaultdict(lambda: [0, 0])
for m in manifest:
    slug = m["slug"]
    raw = json.load(open(os.path.join(CORPUS, f"{slug}.json")))
    serv = json.load(open(os.path.join(OUT, f"{slug}.serving.json")))
    srows = {r["pointId"]: r for r in serv["rows"]}
    fps = float(raw["match"].get("source_fps") or 30.0); fr = 1/fps
    pre = 1.2
    try: pre = float((raw["match"].get("clip_pads") or {}).get("pre", 1.2))
    except Exception: pass
    for p in raw["points"]:
        if p["deleted"] or not p["confirmed_winner"] or p.get("is_let"): continue
        pl = p.get("placement") or {}
        if pl.get("v") != 3: continue
        sr = srows.get(p["id"])
        if not sr or not sr["serverSide"]: continue
        server = sr["serverSide"]; receiver = other(server); user = sr["userPhysicalSide"]
        winner = user if p["confirmed_winner"] == "user" else other(user); loser = other(winner)
        def to_source(cut_s): return float(p["t0"]) - pre - float(p["cut_t0"]) + float(cut_s)
        rally_end = to_source(p["rally_end_cut_s"]) if p.get("rally_end_cut_s") is not None and p.get("cut_t0") is not None else None
        tap = to_source(p["scored_at_cut_s"]) if p.get("scored_at_cut_s") is not None and p.get("cut_t0") is not None else None
        if rally_end is not None and tap is not None:
            tap_n += 1; tapgap.append(tap - rally_end)
            if rally_end > tap: tap_before_end += 1
        if sr["rejection"] is not None: continue
        hyp = pl["hypotheses"][server]
        cands = sorted(pl.get("candidates") or [], key=lambda c: c["t"])
        bounces = [c for c in cands if c["kind"] == "bounce"]; contacts = [c for c in cands if c["kind"] == "contact"]
        for c in bounces: c["_nc"] = min((abs(c["t"] - k["t"]) for k in contacts), default=9) <= 2.5*fr
        serve_shot = next((s for s in hyp["shots"] if s["phase"] == "serve"), None)
        sland = serve_shot["landing"]
        idx = next((i for i, c in enumerate(bounces) if c["id"] == sland.get("event_id")), None)
        chain = []; expect = server; last_t = sland["t"]
        for c in bounces[idx+1:]:
            if rally_end is not None and c["t"] > rally_end + 0.3: break
            if not inside(c.get("u"), c.get("v")) or c["_nc"] or abs(c["v"] - NET) <= 0.15: continue
            if c["t"] - last_t < 0.08: continue
            if c["t"] - last_t > 1.5: break
            if half(c["v"]) == expect: chain.append(c); expect = other(half(c["v"])); last_t = c["t"]
            else: break
        k = len(chain)
        end_anchor = rally_end if rally_end is not None else None
        # any later ball evidence at all (bounce anywhere, contact) after the serve landing
        later = [c for c in cands if c["t"] > sland["t"] + 0.05 and (end_anchor is None or c["t"] <= end_anchor + 0.3)]
        last_seen = max((c["t"] for c in later), default=sland["t"])
        u, v = sland["u"], sland["v"]
        lat = "L" if u < W/3 else ("M" if u < 2*W/3 else "R")
        dist = (v - NET) if receiver == "far" else (NET - v)
        depth = "short" if dist < NET/3 else ("half" if dist < 2*NET/3 else "long")
        z = depth + lat
        if end_anchor is None: continue
        G["drawn_with_end"] += 1
        # ended on the receive: no clean return landing AND the rally ended quickly after the serve landing
        for gate_name, gate in (("gate_1.0s", 1.0), ("gate_1.5s", 1.5), ("gate_2.0s", 2.0)):
            if k == 0 and (end_anchor - sland["t"]) <= gate:
                G[f"{gate_name}_recv_n"] += 1
                if loser == receiver: G[f"{gate_name}_recv_ok"] += 1
        # stricter: also no later ball evidence at all after the serve landing beyond 0.8 s
        if k == 0 and (end_anchor - sland["t"]) <= 1.5 and (last_seen - sland["t"]) <= 1.2:
            G["strict_recv_n"] += 1
            if loser == receiver: G["strict_recv_ok"] += 1
            per[slug]["strict_n"] += 1
            if loser == receiver: per[slug]["strict_ok"] += 1
            if receiver == user:
                recv[z][1] += 1
                if loser == user: recv[z][0] += 1
        # ended on the third ball: exactly one clean return landing, then the point ends quickly
        if k == 1 and (end_anchor - chain[0]["t"]) <= 1.5:
            G["third_n"] += 1
            if loser == server: G["third_ok"] += 1
        # k=0 but long rally -> missed bounce (detection failure), what share of k=0 is that
        if k == 0:
            G["k0"] += 1
            if (end_anchor - sland["t"]) > 1.5: G["k0_long"] += 1
        per[slug]["drawn"] += 1
print("=== 'ENDED ON THE RECEIVE' with a time gate (drawn serves with a rally end) ===", G["drawn_with_end"])
for gn in ("gate_1.0s", "gate_1.5s", "gate_2.0s"):
    print(f"  no return landing and rally ended within {gn[5:]} of the serve landing: n={G[gn+'_recv_n']:4d}  receiver lost {pct(G[gn+'_recv_ok'], G[gn+'_recv_n'])}")
print(f"  strict (also no ball seen 1.2 s after the serve landing):                  n={G['strict_recv_n']:4d}  receiver lost {pct(G['strict_recv_ok'], G['strict_recv_n'])}   share of drawn serves {pct(G['strict_recv_n'], G['drawn_with_end'])}")
print(f"  of all k=0 points, rally continued past 1.5 s (a missed return bounce): {pct(G['k0_long'], G['k0'])} of {G['k0']}")
print(f"  'ended on the third ball' (one return landing, then the end within 1.5 s): n={G['third_n']}  server lost {pct(G['third_ok'], G['third_n'])}")
print("\n  per match, strict receive errors: n and agreement with the score")
for slug, d in per.items(): print(f"    {slug:22s} n={d['strict_n']:3d}  ok {pct(d['strict_ok'], d['strict_n'])}   of {d['drawn']} drawn")
print("\n=== RECEIVE ERRORS by their serve zone, strict gate (you receiving) ===")
for z, (e, t) in sorted(recv.items(), key=lambda kv: -kv[1][1]): print(f"  {z:8s} faced {t:4d}  receive error {pct(e, t)}")
print("\n=== YOUR SCORE TAP minus the worker's rally end (s), points with both ===", tap_n)
tg = sorted(tapgap); n = len(tg)
print(f"  p5={tg[n//20]:.2f}  p10={tg[n//10]:.2f}  p25={tg[n//4]:.2f}  median={tg[n//2]:.2f}  p75={tg[3*n//4]:.2f}  p90={tg[9*n//10]:.2f}")
print(f"  rally end AFTER the tap (dead play would show here): {pct(tap_before_end, tap_n)}   rally end more than 4 s before the tap: {pct(sum(1 for x in tg if x > 4), n)}")
