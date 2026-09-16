"""Second pass: where the noise sits, card yields after filtering, examples."""
import json, math, os, sys
from collections import Counter, defaultdict
W, L = 1.525, 2.74; NET = L/2
SP = sys.argv[1]; CORPUS = os.path.join(SP, "corpus"); OUT = os.path.join(SP, "out")
manifest = json.load(open(os.path.join(CORPUS, "manifest.json")))
def half(v): return None if v is None else ("near" if v < NET else "far")
def inside(u, v): return u is not None and v is not None and 0 <= u <= W and 0 <= v <= L
def other(s): return "far" if s == "near" else "near"
def pct(a, b): return f"{100*a/b:.0f}%" if b else "-"

edge = Counter(); edge_contact = Counter()
depth_contact = defaultdict(lambda: [0, 0])  # bin -> [near_contact, total]
depth_user = defaultdict(lambda: Counter())
yields = {}
examples = []
chart = {"matches": []}
serve_flag_hits = Counter()
chain0_long = [0, 0]
dur_bins = Counter(); dur_win = Counter()
serve_depth = Counter(); serve_depth_won = Counter()
ending_zone = Counter()

for m in manifest:
    slug = m["slug"]
    raw = json.load(open(os.path.join(CORPUS, f"{slug}.json")))
    serv = json.load(open(os.path.join(OUT, f"{slug}.serving.json")))
    srows = {r["pointId"]: r for r in serv["rows"]}
    bounds = {b["point_id"]: b for b in raw["boundaries"] if b["usable"] and not b["deleted"]}
    fps = float(raw["match"].get("source_fps") or 30.0); fr = 1/fps
    Y = Counter()
    for p in raw["points"]:
        if p["deleted"] or not p["confirmed_winner"] or p.get("is_let"): continue
        pl = p.get("placement") or {}
        if pl.get("v") != 3: continue
        sr = srows.get(p["id"])
        if not sr or not sr["serverSide"]: continue
        Y["points"] += 1
        server = sr["serverSide"]; receiver = other(server); user = sr["userPhysicalSide"]
        winner = user if p["confirmed_winner"] == "user" else other(user); loser = other(winner)
        hyp = pl["hypotheses"][server]
        cands = sorted(pl.get("candidates") or [], key=lambda c: c["t"])
        bounces = [c for c in cands if c["kind"] == "bounce"]; contacts = [c for c in cands if c["kind"] == "contact"]
        serve_shot = next((s for s in hyp["shots"] if s["phase"] == "serve"), None)
        sfb = ((serve_shot or {}).get("serve_first_bounce") or {})
        sland = ((serve_shot or {}).get("landing") or {})
        b = bounds.get(p["id"])
        end_truth = float(b["end_source_s"]) if b else None
        # timing availability
        if p.get("rally_end_cut_s") is not None: Y["has_rally_end"] += 1
        if p.get("serve_start_at_cut_s") is not None: Y["has_serve_tap"] += 1
        if p.get("scored_at_cut_s") is not None: Y["has_scored_tap"] += 1
        # duration proxy: serve first bounce -> rally_end (cut clock -> source clock via cut_t0/t0)
        dur = None
        if sfb.get("t") is not None and p.get("rally_end_cut_s") is not None and p.get("cut_t0") is not None:
            pre = 1.2
            try:
                pre = float((raw["match"].get("clip_pads") or {}).get("pre", 1.2))
            except Exception: pass
            rally_end_source = float(p["t0"]) - pre - float(p["cut_t0"]) + float(p["rally_end_cut_s"])
            dur = rally_end_source - float(sfb["t"])
            if dur > 0.3:
                Y["dur_ok"] += 1
                k = "short <3s" if dur < 3 else ("mid 3-6s" if dur < 6 else "long 6s+")
                dur_bins[k] += 1
                if winner == user: dur_win[k] += 1
        # flags
        for c in bounces:
            u, v = c.get("u"), c.get("v")
            near_c = min((abs(c["t"] - k["t"]) for k in contacts), default=9) <= 2.5*fr
            c["_nc"] = near_c
            if u is not None:
                e = None
                if v < 0.08: e = "near end line"
                elif v > L-0.08: e = "far end line"
                elif u < 0.08: e = "camera-left sideline"
                elif u > W-0.08: e = "camera-right sideline"
                if e:
                    edge[e] += 1
                    if near_c: edge_contact[e] += 1
                if inside(u, v):
                    bi = min(5, int(v/L*6))
                    depth_contact[bi][1] += 1
                    if near_c: depth_contact[bi][0] += 1
        # does the near-contact filter touch drawn serves?
        if sr["rejection"] is None:
            Y["serve_drawn"] += 1
            for key, ref in (("first", sfb), ("landing", sland)):
                c = next((c for c in bounces if c["id"] == ref.get("event_id")), None)
                if c and c["_nc"]: serve_flag_hits[key] += 1
            # serve depth (receiver's half thirds) and outcome
            dist = (sland["v"] - NET) if receiver == "far" else (NET - sland["v"])
            d = "short" if dist < NET/3 else ("half-long" if dist < 2*NET/3 else "long")
            serve_depth[d] += 1
            if winner == server: serve_depth_won[d] += 1
        # receive (3rd ball): next inside bounce after serve landing, on server half, within 1.2 s
        recv = None
        if sr["rejection"] is None:
            idx = next((i for i, c in enumerate(bounces) if c["id"] == sland.get("event_id")), None)
            if idx is not None:
                nxt = [c for c in bounces[idx+1:] if not c["_nc"] and abs((c.get("v") or 9) - NET) > 0.15]
                if nxt:
                    c = nxt[0]
                    if inside(c.get("u"), c.get("v")) and half(c["v"]) == server and 0.08 < c["t"] - sland["t"] < 1.5:
                        recv = c; Y["receive"] += 1
        # point ending: last clean inside bounce before end; must be on loser half
        clean = [c for c in bounces if inside(c.get("u"), c.get("v")) and not c["_nc"] and abs(c["v"]-NET) > 0.15
                 and not (end_truth is not None and c["t"] > end_truth + 0.3)]
        # drop anything more than 1.5 s after its predecessor at the tail (dead play)
        while len(clean) >= 2 and clean[-1]["t"] - clean[-2]["t"] > 1.5:
            clean.pop()
        if clean:
            Y["ending_candidate"] += 1
            last = clean[-1]
            if half(last["v"]) == loser:
                Y["ending_on_loser"] += 1
                # zone on loser's half from the loser's perspective depth
                dist = (last["v"] - NET) if loser == "far" else (NET - last["v"])
                ending_zone["short" if dist < NET/3 else ("half-long" if dist < 2*NET/3 else "long")] += 1
        # chain 0 with long duration = missed bounces (boundary matches only)
        if b and sr["rejection"] is None:
            idx = next((i for i, c in enumerate(bounces) if c["id"] == sland.get("event_id")), None)
            after = [c for c in bounces[idx+1:] if inside(c.get("u"), c.get("v"))] if idx is not None else []
            if float(b["length_s"]) > 3.0:
                chain0_long[1] += 1
                if not after: chain0_long[0] += 1
        # examples from chris_aug22
        if slug == "chris_aug22" and len(examples) < 40:
            examples.append({"idx": p["idx"], "server": server, "user": user, "winner": winner, "serve": sr["rejection"] or "drawn",
                             "end_truth": end_truth,
                             "cands": [{"t": round(c["t"] - cands[0]["t"], 2), "kind": c["kind"], "u": c.get("u"), "v": c.get("v"), "x": c["x"], "y": c["y"],
                                        "nc": c.get("_nc", False), "sfb": c["id"] == sfb.get("event_id"), "sland": c["id"] == sland.get("event_id")} for c in cands]})
    yields[slug] = Y
    chart["matches"].append({"slug": slug, "opponent": m["opponent"], "venue": m["venue"], "points": Y["points"],
                             "serve": Y["serve_drawn"], "receive": Y["receive"], "ending": Y["ending_on_loser"], "dur": Y["dur_ok"],
                             "rally_end": Y["has_rally_end"]})

n = sum(y["points"] for y in yields.values())
print("=== EDGE-BAND bounces by edge, and share within 2.5 frames of a contact ===")
for e, c in edge.most_common(): print(f"  {e:22s} {c:5d}   near a contact: {pct(edge_contact[e], c)}")
print("\n=== INSIDE bounces by depth bin (near end -> far end): share near a contact ===")
for bi in range(6): print(f"  bin {bi} v={bi*L/6:.2f}-{(bi+1)*L/6:.2f}m  n={depth_contact[bi][1]:5d}  near contact {pct(depth_contact[bi][0], depth_contact[bi][1])}")
print(f"\n=== drawn serves whose bounce is within 2.5 frames of a contact: first={serve_flag_hits['first']} landing={serve_flag_hits['landing']} of {sum(y['serve_drawn'] for y in yields.values())}")
print(f"\n=== boundary matches: drawn-serve points lasting >3 s with NO inside bounce after the serve landing: {chain0_long[0]} of {chain0_long[1]}")
print("\n=== CARD YIELDS (share of scored points) ===")
print(f"{'match':22s} {'pts':>4} {'serve':>6} {'receive':>8} {'ending':>7} {'duration':>9} {'rallyEnd':>9} {'serveTap':>9} {'scoredTap':>10}")
T = Counter()
for slug, Y in yields.items():
    for k, v in Y.items(): T[k] += v
    print(f"{slug:22s} {Y['points']:4d} {pct(Y['serve_drawn'], Y['points']):>6} {pct(Y['receive'], Y['points']):>8} {pct(Y['ending_on_loser'], Y['points']):>7} {pct(Y['dur_ok'], Y['points']):>9} {pct(Y['has_rally_end'], Y['points']):>9} {pct(Y['has_serve_tap'], Y['points']):>9} {pct(Y['has_scored_tap'], Y['points']):>10}")
print(f"{'TOTAL':22s} {T['points']:4d} {pct(T['serve_drawn'], T['points']):>6} {pct(T['receive'], T['points']):>8} {pct(T['ending_on_loser'], T['points']):>7} {pct(T['dur_ok'], T['points']):>9} {pct(T['has_rally_end'], T['points']):>9} {pct(T['has_serve_tap'], T['points']):>9} {pct(T['has_scored_tap'], T['points']):>10}")
print(f"  ending candidates that were on the loser's half: {pct(T['ending_on_loser'], T['ending_candidate'])} of {T['ending_candidate']}")
print("\n=== SERVE DEPTH (drawn serves) and server win rate ===")
for d in ("short", "half-long", "long"): print(f"  {d:10s} n={serve_depth[d]:4d}  server won {pct(serve_depth_won[d], serve_depth[d])}")
print("\n=== POINT DURATION (serve first bounce -> worker rally end) and uploader win rate ===")
for k in ("short <3s", "mid 3-6s", "long 6s+"): print(f"  {k:10s} n={dur_bins[k]:4d}  user won {pct(dur_win[k], dur_bins[k])}")
print("\n=== ENDING depth on loser's half ===", dict(ending_zone))
chart["edge"] = dict(edge); chart["edge_contact"] = dict(edge_contact)
chart["depth_contact"] = {str(k): v for k, v in depth_contact.items()}
chart["serve_depth"] = {d: [serve_depth[d], serve_depth_won[d]] for d in serve_depth}
chart["dur"] = {k: [dur_bins[k], dur_win[k]] for k in dur_bins}
chart["totals"] = dict(T)
json.dump(chart, open(os.path.join(OUT, "chart.json"), "w"), indent=1)
json.dump(examples, open(os.path.join(OUT, "examples.json"), "w"), indent=1)
