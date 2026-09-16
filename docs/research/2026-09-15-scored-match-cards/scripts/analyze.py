"""Noise and feasibility analysis over scored, v3-placement points.

Joins: points.placement candidates (worker) + app's serve rotation/diagnosis
(emit_serving.ts) + confirmed winner + hand-marked boundaries where present.
"""
import json, math, os, sys
from collections import Counter, defaultdict

W, L = 1.525, 2.74
NET = L / 2
SP = sys.argv[1]
CORPUS = os.path.join(SP, "corpus")
OUT = os.path.join(SP, "out")

manifest = json.load(open(os.path.join(CORPUS, "manifest.json")))

def half(v):
    return None if v is None else ("near" if v < NET else "far")

def inside(u, v):
    return u is not None and v is not None and 0 <= u <= W and 0 <= v <= L

def other(s):
    return "far" if s == "near" else "near"

rows_all = []
per_match = {}
dt_hist = Counter()
for m in manifest:
    slug = m["slug"]
    raw = json.load(open(os.path.join(CORPUS, f"{slug}.json")))
    serv = json.load(open(os.path.join(OUT, f"{slug}.serving.json")))
    srows = {r["pointId"]: r for r in serv["rows"]}
    bounds = {b["point_id"]: b for b in raw["boundaries"] if b["usable"] and not b["deleted"]}
    fps = float(raw["match"].get("source_fps") or 30.0)
    frame_s = 1.0 / fps

    S = Counter()
    hard = Counter()
    status = Counter()
    rej = Counter()
    half_counts = Counter()
    depth_bins = Counter()
    y_by_half = defaultdict(list)
    chain_lens = []
    rally_bounces_per_s = []
    sugg = Counter()
    sugg_how = Counter()
    dts = []

    for p in raw["points"]:
        if p["deleted"] or not p["confirmed_winner"] or p.get("is_let"):
            continue
        pl = p.get("placement") or {}
        if pl.get("v") != 3:
            continue
        sr = srows.get(p["id"])
        if not sr or not sr["serverSide"]:
            continue
        S["points"] += 1
        server_side = sr["serverSide"]
        receiver_side = other(server_side)
        user_phys = sr["userPhysicalSide"]
        winner_side = user_phys if p["confirmed_winner"] == "user" else other(user_phys)
        loser_side = other(winner_side)
        hyp = pl["hypotheses"][server_side]
        hyp_other = pl["hypotheses"][other(server_side)]
        status[hyp["status"]] += 1
        for r in hyp["hard_reasons"]:
            hard[r] += 1
        # reconstruction's own preferred server vs the rotation
        if hyp["score"] > hyp_other["score"]:
            S["recon_prefers_true_server"] += 1
        elif hyp["score"] < hyp_other["score"]:
            S["recon_prefers_wrong_server"] += 1
        else:
            S["recon_tie"] += 1
        # app's unsupervised pick (no rotation): confidence gap >= .18 and no hard reasons
        ordered = sorted([h for h in pl["hypotheses"].values() if not h["hard_reasons"]], key=lambda h: -h["confidence"])
        if ordered and ordered[0]["status"] != "unavailable" and (len(ordered) < 2 or ordered[0]["confidence"] - ordered[1]["confidence"] >= 0.18):
            S["auto_pick_made"] += 1
            if ordered[0]["server_side"] == server_side:
                S["auto_pick_right"] += 1
        # worker suggestion vs truth
        sg = p.get("suggestion") or {}
        if sg.get("winner"):
            sugg["given"] += 1
            sw = sg["winner"]
            if sw == p["confirmed_winner"]:
                sugg["right"] += 1
            sugg_how[sg.get("how")] += 1
        rej[sr["rejection"] or "drawn"] += 1

        cands = sorted(pl.get("candidates") or [], key=lambda c: c["t"])
        bounces = [c for c in cands if c["kind"] == "bounce"]
        contacts = [c for c in cands if c["kind"] == "contact"]
        S["bounces"] += len(bounces)
        S["contacts"] += len(contacts)
        serve_shot = next((s for s in hyp["shots"] if s["phase"] == "serve"), None)
        serve_first_t = (serve_shot or {}).get("serve_first_bounce", {}) or {}
        serve_first_t = serve_first_t.get("t")
        serve_land = (serve_shot or {}).get("landing") or {}
        serve_land_id = serve_land.get("event_id")
        terminal_t = None
        for s in hyp["shots"]:
            if s.get("terminal") and s["terminal"].get("t"):
                terminal_t = s["terminal"]["t"]
        b = bounds.get(p["id"])
        start_truth = float(b["start_source_s"]) if b else None
        end_truth = float(b["end_source_s"]) if b else None
        if b:
            S["with_boundaries"] += 1

        # per-bounce flags
        flagged_ids = set()
        prev_t = None
        for i, c in enumerate(bounces):
            u, v = c.get("u"), c.get("v")
            proj = "none" if u is None else ("band" if c.get("projection_safety_band") else "inside")
            S[f"proj_{proj}"] += 1
            flags = []
            if u is not None:
                if abs(v - NET) <= 0.15:
                    flags.append("net_band")
                if u < 0.08 or u > W - 0.08 or v < 0.08 or v > L - 0.08:
                    flags.append("edge_band")
                if proj == "inside":
                    half_counts[half(v)] += 1
                    depth_bins[min(5, int(v / L * 6))] += 1
                    y_by_half[half(v)].append(c["y"])
            near_c = min((abs(c["t"] - k["t"]) for k in contacts), default=9)
            if near_c <= 2.5 * frame_s:
                flags.append("near_contact")
            if serve_first_t is not None and c["t"] < serve_first_t - 0.02:
                flags.append("pre_serve")
            elif start_truth is not None and c["t"] < start_truth - 0.3:
                flags.append("pre_serve_truth")
            if end_truth is not None and c["t"] > end_truth + 0.3:
                flags.append("post_end_truth")
            elif terminal_t is not None and c["t"] > terminal_t + 0.05:
                flags.append("post_terminal")
            cluster = sum(1 for k in bounces if k is not c and abs(k["t"] - c["t"]) <= 2.0 and math.hypot(k["x"] - c["x"], k["y"] - c["y"]) <= 15)
            if cluster >= 2:
                flags.append("repeat_spot")
            if prev_t is not None:
                dt = c["t"] - prev_t
                dts.append(dt)
                dt_hist[min(20, int(dt / 0.05))] += 1
                if dt < 0.08:
                    flags.append("fast_pair")
            prev_t = c["t"]
            for f in flags:
                S[f"flag_{f}"] += 1
            if flags:
                S["flag_any"] += 1
                flagged_ids.add(c["id"])
            c["_flags"] = flags

        # rally chain from the serve landing, alternating halves, inside table only
        chain = 0
        chain_ok = None
        last_half = None
        receive_ok = False
        if sr["rejection"] is None and serve_land_id:
            idx = next((i for i, c in enumerate(bounces) if c["id"] == serve_land_id), None)
            if idx is not None:
                expect = server_side  # after serve lands on receiver half, next landing is on server's half
                last_half = receiver_side
                broke = False
                last_t = bounces[idx]["t"]
                for c in bounces[idx + 1:]:
                    if end_truth is not None and c["t"] > end_truth + 0.3:
                        break
                    if "post_terminal" in c["_flags"] and end_truth is None:
                        pass
                    u, v = c.get("u"), c.get("v")
                    if not inside(u, v):
                        continue  # off-table: ignore, do not break
                    if c["t"] - last_t < 0.08:
                        continue  # double detection
                    h = half(v)
                    if h == expect:
                        chain += 1
                        if chain == 1:
                            receive_ok = True
                        last_half = h
                        expect = other(h)
                        last_t = c["t"]
                    else:
                        broke = True
                        break
                chain_ok = not broke
                chain_lens.append(chain)
                S["chain_evaluated"] += 1
                if chain_ok:
                    S["chain_clean"] += 1
                if receive_ok:
                    S["receive_landing"] += 1
                # last landing on loser's half?
                if last_half == loser_side:
                    S["last_half_is_loser"] += 1
                if chain_ok and last_half == loser_side:
                    S["chain_clean_and_consistent"] += 1
                if b:
                    dur = float(b["length_s"])
                    if dur > 0:
                        rally_bounces_per_s.append((chain + 2) / dur)
        # last inside bounce (raw, no chain) on loser's half
        inside_b = [c for c in bounces if inside(c.get("u"), c.get("v")) and not (end_truth is not None and c["t"] > end_truth + 0.3)]
        if inside_b:
            S["has_inside_bounce"] += 1
            if half(inside_b[-1]["v"]) == loser_side:
                S["raw_last_inside_on_loser"] += 1
        # current rally rule (trusted observations): count landings passing app filter
        if hyp["status"] == "ready" and hyp["confidence"] >= 0.7 and not hyp["hard_reasons"]:
            S["rally_rule_points"] += 1
            for s in hyp["shots"]:
                ld = s.get("landing")
                if ld and s["confidence"] >= 0.7 and ld["confidence"] >= 0.7 and inside(ld.get("u"), ld.get("v")):
                    S["rally_rule_landings"] += 1
        # scorecard richness
        if p.get("serve_spin") or p.get("serve_length"):
            S["serve_described"] += 1
        if p.get("loss_reasons"):
            S["loss_reason_given"] += 1
        if p.get("direction"):
            S["direction_given"] += 1

        rows_all.append({"slug": slug, "point": p["idx"], "server": server_side, "user": user_phys, "winner": winner_side,
                         "n_b": len(bounces), "n_c": len(contacts), "flags": Counter(f for c in bounces for f in c["_flags"]),
                         "serve": sr["rejection"] or "drawn", "chain": chain, "chain_ok": chain_ok,
                         "status": hyp["status"], "hard": hyp["hard_reasons"], "dur": float(b["length_s"]) if b else None})

    per_match[slug] = {"S": S, "hard": hard, "status": status, "rej": rej, "half": half_counts, "depth": depth_bins,
                       "y_med": {h: (sorted(v)[len(v)//2] if v else None) for h, v in y_by_half.items()},
                       "chain_lens": chain_lens, "sugg": sugg, "sugg_how": sugg_how, "user_side": m["user_side"],
                       "bps": rally_bounces_per_s}

def pct(a, b):
    return f"{100*a/b:.0f}%" if b else "-"

print("\n=== SERVE RULER (scored points, server known) ===")
print(f"{'match':22s} {'pts':>4} {'drawn':>6} {'no_land':>8} {'wrong_h':>8} {'1st_wh':>7} {'off':>5} {'noncons':>8} {'noserve':>8}")
T = Counter()
for slug, d in per_match.items():
    r = d["rej"]; n = d["S"]["points"]
    for k, v in r.items(): T[k] += v
    T["pts"] += n
    print(f"{slug:22s} {n:4d} {pct(r['drawn'], n):>6} {r['no_landing']:8d} {r['wrong_half']:8d} {r['first_bounce_wrong_half']:7d} {r['off_table']:5d} {r['not_consecutive']:8d} {r['no_serve_shot']:8d}")
print(f"{'TOTAL':22s} {T['pts']:4d} {pct(T['drawn'], T['pts']):>6} {T['no_landing']:8d} {T['wrong_half']:8d} {T['first_bounce_wrong_half']:7d} {T['off_table']:5d} {T['not_consecutive']:8d} {T['no_serve_shot']:8d}")

print("\n=== BOUNCE INVENTORY AND NOISE FLAGS (share of all bounce candidates) ===")
keys = ["proj_none", "proj_band", "proj_inside", "flag_near_contact", "flag_net_band", "flag_edge_band", "flag_pre_serve", "flag_pre_serve_truth", "flag_post_end_truth", "flag_post_terminal", "flag_repeat_spot", "flag_fast_pair", "flag_any"]
print(f"{'match':22s} {'pts':>4} {'b/pt':>5} {'c/pt':>5} " + " ".join(f"{k.replace('flag_','').replace('proj_','p:')[:10]:>10}" for k in keys))
TT = Counter()
for slug, d in per_match.items():
    S = d["S"]; n = S["points"]; nb = S["bounces"]
    for k in keys + ["bounces", "contacts", "points"]: TT[k] += S[k]
    print(f"{slug:22s} {n:4d} {nb/n:5.1f} {S['contacts']/n:5.1f} " + " ".join(f"{pct(S[k], nb):>10}" for k in keys))
n = TT["points"]; nb = TT["bounces"]
print(f"{'TOTAL':22s} {n:4d} {nb/n:5.1f} {TT['contacts']/n:5.1f} " + " ".join(f"{pct(TT[k], nb):>10}" for k in keys))

print("\n=== HALF DENSITY of inside-table bounces (camera near vs far) and median pixel y ===")
print(f"{'match':22s} {'user':>5} {'near':>6} {'far':>6} {'near%':>6} {'y_near':>7} {'y_far':>6}   depth bins near->far (6)")
for slug, d in per_match.items():
    h = d["half"]; tot = h["near"] + h["far"]
    ym = d["y_med"]
    print(f"{slug:22s} {d['user_side']:>5} {h['near']:6d} {h['far']:6d} {pct(h['near'], tot):>6} {str(ym.get('near')):>7} {str(ym.get('far')):>6}   " + " ".join(f"{d['depth'][i]:4d}" for i in range(6)))

print("\n=== RALLY FEASIBILITY (rotation hypothesis) ===")
print(f"{'match':22s} {'pts':>4} {'ready':>6} {'rallyRule':>10} {'landings':>9} {'chainEval':>9} {'clean':>6} {'consist':>8} {'recv':>5} {'lastLoser':>9} {'rawLastLoser':>12} {'reconSrv':>8} {'autoPick':>9} {'suggWin':>8}")
for slug, d in per_match.items():
    S = d["S"]; n = S["points"]
    print(f"{slug:22s} {n:4d} {pct(d['status']['ready'], n):>6} {pct(S['rally_rule_points'], n):>10} {S['rally_rule_landings']:9d} {S['chain_evaluated']:9d} {pct(S['chain_clean'], S['chain_evaluated']):>6} {pct(S['chain_clean_and_consistent'], S['chain_evaluated']):>8} {pct(S['receive_landing'], S['chain_evaluated']):>5} {pct(S['last_half_is_loser'], S['chain_evaluated']):>9} {pct(S['raw_last_inside_on_loser'], S['has_inside_bounce']):>12} {pct(S['recon_prefers_true_server'], n):>8} {pct(S['auto_pick_right'], S['auto_pick_made'])+'/'+str(S['auto_pick_made']):>9} {pct(d['sugg']['right'], d['sugg']['given']):>8}")

print("\n=== HARD REASONS on the rotation hypothesis (share of points) ===")
HT = Counter()
for d in per_match.values():
    for k, v in d["hard"].items(): HT[k] += v
for k, v in HT.most_common():
    print(f"  {k:45s} {v:5d}  {pct(v, n)}")

print("\n=== CHAIN LENGTH distribution (bounces after the serve landing, alternating, inside) ===")
CL = Counter()
for d in per_match.values():
    for c in d["chain_lens"]: CL[min(c, 8)] += 1
tot = sum(CL.values())
print("  " + "  ".join(f"{k}:{pct(CL[k], tot)}" for k in sorted(CL)))

print("\n=== INTER-BOUNCE dt histogram (50 ms bins, all consecutive bounce pairs) ===")
tot = sum(dt_hist.values())
print("  " + "  ".join(f"{k*50}ms:{pct(dt_hist[k], tot)}" for k in sorted(dt_hist)))

print("\n=== SUGGESTION 'how' distribution ===")
SH = Counter()
for d in per_match.values():
    for k, v in d["sugg_how"].items(): SH[k] += v
print("  ", dict(SH))

print("\n=== SCORECARD richness ===")
for slug, d in per_match.items():
    S = d["S"]
    print(f"  {slug:22s} serve described {pct(S['serve_described'], S['points']):>4}  loss reason {pct(S['loss_reason_given'], S['points']):>4}  direction {pct(S['direction_given'], S['points']):>4}")

json.dump(rows_all, open(os.path.join(OUT, "rows.json"), "w"), default=lambda o: dict(o) if isinstance(o, Counter) else str(o))
