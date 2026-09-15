import json, os, sys
from collections import Counter, defaultdict
W, L = 1.525, 2.74; NET = L/2
SP = sys.argv[1]; CORPUS = os.path.join(SP, "corpus"); OUT = os.path.join(SP, "out")
manifest = json.load(open(os.path.join(CORPUS, "manifest.json")))
def half(v): return None if v is None else ("near" if v < NET else "far")
def inside(u, v): return u is not None and v is not None and 0 <= u <= W and 0 <= v <= L
def other(s): return "far" if s == "near" else "near"
def pct(a, b): return f"{100*a/b:.0f}%" if b else "-"
side = defaultdict(Counter)
ending = Counter()
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
        user = sr["userPhysicalSide"]; winner = user if p["confirmed_winner"] == "user" else other(user); loser = other(winner)
        cands = sorted(pl.get("candidates") or [], key=lambda c: c["t"])
        bounces = [c for c in cands if c["kind"] == "bounce"]; contacts = [c for c in cands if c["kind"] == "contact"]
        for c in bounces:
            u, v = c.get("u"), c.get("v")
            if u is None or v is None: continue
            if u < 0.08: side[slug]["left"] += 1
            elif u > W - 0.08: side[slug]["right"] += 1
            if inside(u, v): side[slug]["inside"] += 1
        # ending variants
        rally_end = None
        if p.get("rally_end_cut_s") is not None and p.get("cut_t0") is not None:
            rally_end = float(p["t0"]) - pre - float(p["cut_t0"]) + float(p["rally_end_cut_s"])
        clean = [c for c in bounces if inside(c.get("u"), c.get("v")) and min((abs(c["t"]-k["t"]) for k in contacts), default=9) > 2.5*fr and abs(c["v"]-NET) > 0.15]
        if not clean or rally_end is None: continue
        ending["points_with_rally_end"] += 1
        # variant A: last clean bounce before rally_end + 0.2
        before = [c for c in clean if c["t"] <= rally_end + 0.2]
        if before:
            ending["A_cand"] += 1
            if half(before[-1]["v"]) == loser: ending["A_loser"] += 1
            # variant B: additionally within 1.5 s of rally end
            if rally_end - before[-1]["t"] <= 1.5:
                ending["B_cand"] += 1
                if half(before[-1]["v"]) == loser: ending["B_loser"] += 1
        # variant C: raw last inside bounce in the clip (no rally-end anchor)
        raw_last = [c for c in bounces if inside(c.get("u"), c.get("v"))]
        if raw_last:
            ending["C_cand"] += 1
            if half(raw_last[-1]["v"]) == loser: ending["C_loser"] += 1
print("=== sideline bounces per match (within 8 cm of the line) ===")
for slug, c in side.items(): print(f"  {slug:22s} left {c['left']:4d}  right {c['right']:4d}  of inside {c['inside']:5d}   left share {pct(c['left'], c['inside'])}")
print("\n=== point-ending rule variants (points with a worker rally end) ===", ending["points_with_rally_end"])
print(f"  C raw last inside bounce in clip:              cand {ending['C_cand']:4d}  on loser half {pct(ending['C_loser'], ending['C_cand'])}")
print(f"  A last clean bounce before rally end:          cand {ending['A_cand']:4d}  on loser half {pct(ending['A_loser'], ending['A_cand'])}")
print(f"  B ... and within 1.5 s of rally end:           cand {ending['B_cand']:4d}  on loser half {pct(ending['B_loser'], ending['B_cand'])}   (share of points {pct(ending['B_cand'], ending['points_with_rally_end'])})")
