"""First three balls, serve speed, duration anchors, shot-speed proxy, serve variety."""
import json, math, os, sys
from collections import Counter, defaultdict
W, L = 1.525, 2.74; NET = L/2
SP = sys.argv[1]; CORPUS = os.path.join(SP, "corpus"); OUT = os.path.join(SP, "out")
manifest = json.load(open(os.path.join(CORPUS, "manifest.json")))
def half(v): return None if v is None else ("near" if v < NET else "far")
def inside(u, v): return u is not None and v is not None and 0 <= u <= W and 0 <= v <= L
def other(s): return "far" if s == "near" else "near"
def pct(a, b): return f"{100*a/b:.0f}%" if b else "-"
def zone(u, v, who_half):
    dist = (v - NET) if who_half == "far" else (NET - v)
    d = "short" if dist < NET/3 else ("half" if dist < 2*NET/3 else "long")
    return d

K = defaultdict(Counter)          # per match: k -> consistent / total
KT = Counter(); KC = Counter()
speed = []                        # (m/s, server_won, depth, slug)
dur_pairs = []                    # (rally_end - last_clean_bounce)
durB = Counter(); durB_win = Counter()
dt_shots = []                     # contact->landing dt for rally shots
serve_dt = []
recv_err = defaultdict(lambda: [0, 0])   # their serve zone -> [receive errors, receives faced]
variety = {}
ending_gate = {}
for m in manifest:
    slug = m["slug"]
    raw = json.load(open(os.path.join(CORPUS, f"{slug}.json")))
    serv = json.load(open(os.path.join(OUT, f"{slug}.serving.json")))
    srows = {r["pointId"]: r for r in serv["rows"]}
    fps = float(raw["match"].get("source_fps") or 30.0); fr = 1/fps
    pre = 1.2
    try: pre = float((raw["match"].get("clip_pads") or {}).get("pre", 1.2))
    except Exception: pass
    zones_by_player = defaultdict(Counter)
    end_ok = [0, 0]
    for p in raw["points"]:
        if p["deleted"] or not p["confirmed_winner"] or p.get("is_let"): continue
        pl = p.get("placement") or {}
        if pl.get("v") != 3: continue
        sr = srows.get(p["id"])
        if not sr or not sr["serverSide"]: continue
        server = sr["serverSide"]; receiver = other(server); user = sr["userPhysicalSide"]
        winner = user if p["confirmed_winner"] == "user" else other(user); loser = other(winner)
        hyp = pl["hypotheses"][server]
        cands = sorted(pl.get("candidates") or [], key=lambda c: c["t"])
        bounces = [c for c in cands if c["kind"] == "bounce"]; contacts = [c for c in cands if c["kind"] == "contact"]
        for c in bounces:
            c["_nc"] = min((abs(c["t"] - k["t"]) for k in contacts), default=9) <= 2.5*fr
        serve_shot = next((s for s in hyp["shots"] if s["phase"] == "serve"), None)
        sfb = ((serve_shot or {}).get("serve_first_bounce") or {}); sland = ((serve_shot or {}).get("landing") or {})
        rally_end = None
        if p.get("rally_end_cut_s") is not None and p.get("cut_t0") is not None:
            rally_end = float(p["t0"]) - pre - float(p["cut_t0"]) + float(p["rally_end_cut_s"])
        if sr["rejection"] is not None: continue
        # ---- serve speed from the two serve bounces (both on the plane)
        if sfb.get("t") is not None and sland.get("t") is not None and sfb.get("u") is not None:
            d = math.hypot(sland["u"] - sfb["u"], sland["v"] - sfb["v"]); dt = sland["t"] - sfb["t"]
            if 0.05 < dt < 1.5 and d > 0.2:
                dist = (sland["v"] - NET) if receiver == "far" else (NET - sland["v"])
                depth = "short" if dist < NET/3 else ("half" if dist < 2*NET/3 else "long")
                speed.append((d/dt, winner == server, depth, slug)); serve_dt.append(dt)
        # ---- serve variety (zone entropy) per server
        u, v = sland["u"], sland["v"]
        lat = "L" if u < W/3 else ("M" if u < 2*W/3 else "R")
        zones_by_player[server][zone(u, v, receiver) + lat] += 1
        # ---- chain after the serve landing (clean, alternating)
        idx = next((i for i, c in enumerate(bounces) if c["id"] == sland.get("event_id")), None)
        chain = []; expect = server; last_t = sland["t"]; broke = False
        for c in bounces[idx+1:]:
            if rally_end is not None and c["t"] > rally_end + 0.3: break
            if not inside(c.get("u"), c.get("v")) or c["_nc"] or abs(c["v"] - NET) <= 0.15: continue
            if c["t"] - last_t < 0.08: continue
            if c["t"] - last_t > 1.5: break   # dead play
            if half(c["v"]) == expect:
                chain.append(c); expect = other(half(c["v"])); last_t = c["t"]
            else:
                broke = True; break
        k = len(chain)
        # parity: k even -> receiver lost; k odd -> server lost
        expected_loser = receiver if k % 2 == 0 else server
        kk = min(k, 3)
        K[slug][f"{kk}_tot"] += 1; KT[kk] += 1
        if loser == expected_loser:
            K[slug][f"{kk}_ok"] += 1; KC[kk] += 1
        if not broke: K[slug]["unbroken"] += 1
        # ---- receive error by their serve zone (user is receiver)
        if receiver == user:
            z = zone(u, v, receiver) + lat
            recv_err[z][1] += 1
            if k == 0 and loser == user: recv_err[z][0] += 1
        # ---- duration: first bounce -> last clean chain bounce (or serve landing when k = 0)
        last_b = chain[-1]["t"] if chain else sland["t"]
        dur_b = last_b - sfb["t"] if sfb.get("t") is not None else None
        if rally_end is not None and dur_b is not None:
            dur_pairs.append(rally_end - last_b)
        if dur_b is not None and dur_b > 0:
            key = "short <2s" if dur_b < 2 else ("mid 2-4s" if dur_b < 4 else "long 4s+")
            durB[key] += 1
            if winner == user: durB_win[key] += 1
        # ---- shot-speed proxy: contact -> next chain landing
        for c in chain:
            prev_contacts = [q for q in contacts if 0.12 < c["t"] - q["t"] < 0.9]
            if not prev_contacts: continue
            q = prev_contacts[-1]
            hitter = other(half(c["v"]))
            along = abs(c["v"] - (0.0 if hitter == "near" else L)) + 0.3   # contact assumed ~0.3 m behind the end line
            dt = c["t"] - q["t"]
            dt_shots.append((dt, along/dt, slug))
        # ---- ending self-check per match
        end_ok[1] += 1
        last_half = half(chain[-1]["v"]) if chain else half(sland["v"])
        if last_half == loser: end_ok[0] += 1
    ending_gate[slug] = end_ok
    def entropy(cnt):
        n = sum(cnt.values()); 
        return -sum(c/n*math.log2(c/n) for c in cnt.values()) if n else 0
    variety[slug] = {s: (round(entropy(c), 2), sum(c.values()), c.most_common(1)[0]) for s, c in zones_by_player.items()}

print("=== FIRST THREE BALLS: does the bounce count agree with the scored winner? (drawn-serve points) ===")
print("k = clean alternating in-table bounces after the serve landing. k=0 -> receiver should have lost, k=1 -> server, k=2 -> receiver, 3+ pooled")
print(f"{'match':22s} " + " ".join(f"{'k='+str(k):>12}" for k in range(4)) + "  unbroken")
for slug in [m["slug"] for m in manifest]:
    d = K[slug]; tot = sum(d[f"{k}_tot"] for k in range(4))
    print(f"{slug:22s} " + " ".join(f"{pct(d[f'{k}_ok'], d[f'{k}_tot']):>5}/{d[f'{k}_tot']:<5}" for k in range(4)) + f"  {pct(d['unbroken'], tot)}")
print(f"{'ALL':22s} " + " ".join(f"{pct(KC[k], KT[k]):>5}/{KT[k]:<5}" for k in range(4)))

print("\n=== SERVE SPEED from the two serve bounces (m/s along the table plane) ===")
sp = sorted(s for s, *_ in speed)
n = len(sp)
print(f"  n={n}  p10={sp[n//10]:.1f}  p25={sp[n//4]:.1f}  median={sp[n//2]:.1f}  p75={sp[3*n//4]:.1f}  p90={sp[9*n//10]:.1f}   serve dt median={sorted(serve_dt)[len(serve_dt)//2]:.2f}s")
q1, q3 = sp[n//3], sp[2*n//3]
for name, lo, hi in (("slow", 0, q1), ("medium", q1, q3), ("fast", q3, 99)):
    sel = [(w, d) for s, w, d, _ in speed if lo <= s < hi]
    print(f"  {name:7s} n={len(sel):4d}  server won {pct(sum(1 for w,_ in sel if w), len(sel))}   depth mix " + ", ".join(f"{d}:{sum(1 for _,x in sel if x==d)}" for d in ("short","half","long")))
hist = Counter(min(12, int(s)) for s in sp)
print("  histogram m/s: " + " ".join(f"{k}:{hist[k]}" for k in sorted(hist)))

print("\n=== DURATION ANCHORS: worker rally end minus last clean bounce (s) ===")
dp = sorted(dur_pairs); n = len(dp)
print(f"  n={n}  p10={dp[n//10]:.2f}  p25={dp[n//4]:.2f}  median={dp[n//2]:.2f}  p75={dp[3*n//4]:.2f}  p90={dp[9*n//10]:.2f}   within 1.5 s: {pct(sum(1 for x in dp if abs(x) <= 1.5), n)}")
print("=== WIN RATE by bounce-measured duration (first serve bounce -> last clean bounce), uploader ===")
for k in ("short <2s", "mid 2-4s", "long 4s+"): print(f"  {k:10s} n={durB[k]:4d}  won {pct(durB_win[k], durB[k])}")

print("\n=== SHOT-SPEED PROXY: contact -> landing time for rally shots ===")
ds = sorted(d for d, *_ in dt_shots); n = len(ds)
if n:
    print(f"  n={n}  dt p10={ds[n//10]:.2f} p25={ds[n//4]:.2f} median={ds[n//2]:.2f} p75={ds[3*n//4]:.2f} p90={ds[9*n//10]:.2f}")
    h = Counter(int(d/0.05) for d in ds)
    print("  dt histogram (50 ms bins): " + " ".join(f"{k*50}:{h[k]}" for k in sorted(h)))
    vs = sorted(v for _, v, _ in dt_shots)
    print(f"  implied speed m/s p10={vs[n//10]:.1f} median={vs[n//2]:.1f} p90={vs[9*n//10]:.1f}")

print("\n=== RECEIVE ERRORS by their serve zone (you receiving; k=0 and you lost) ===")
for z, (e, t) in sorted(recv_err.items(), key=lambda kv: -kv[1][1]): print(f"  {z:8s} faced {t:4d}  missed {pct(e, t)}")

print("\n=== SERVE VARIETY: zone entropy (bits, max 3.17 over 9 zones) and top zone, per server ===")
for slug, d in variety.items():
    print(f"  {slug:22s} " + "   ".join(f"{s}: H={v[0]} n={v[1]} top={v[2][0]} {pct(v[2][1], v[1])}" for s, v in d.items()))

print("\n=== ENDING self-check per match (last chain landing on loser's half, drawn-serve points) ===")
for slug, (ok, tot) in ending_gate.items(): print(f"  {slug:22s} {pct(ok, tot):>5} of {tot}")
