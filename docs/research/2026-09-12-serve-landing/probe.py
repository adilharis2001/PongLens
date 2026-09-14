"""Can the serve's LANDING be recovered by anchoring on V3's own serve?

V3 names the contact, the first bounce (the server's own half) and which
half that was. It never names the second bounce, because not needing a
pair is the whole point of it. The question is whether the landing can be
found afterwards, knowing where to look.

The search: the first bounce after V3's arrival that is on the playing
surface and on the OTHER half. That is all. Every gate the old bounce-pair
rule applies — the apex, the backtrack test, the prior-crossing veto — is
there to decide IS THIS A SERVE, and V3 has already answered that.

The motif's own second bounce, where it found one, is the ruler: if the
anchored search picks the same bounce wherever the motif spoke, then using
it where the motif was silent is justified rather than hopeful.
"""
import json, glob, os, collections

NET_V = 2.74 / 2.0

def half_of(v):
    return "near" if v < NET_V else "far"

def landing(card, window):
    arrival = card.get("serve_arrival_s")
    server_half = card.get("serve_half")
    if arrival is None or not server_half:
        return None
    other = "far" if server_half == "near" else "near"
    for b in card.get("bounces", []):
        t = b["t"]
        if t <= arrival + 0.02:
            continue
        if t > arrival + window:
            break
        if not b.get("onSurface") or b.get("v") is None:
            continue
        if half_of(b["v"]) == other:
            return b
    return None

WINDOWS = [0.8, 1.2, 1.6, 2.0]
tot = collections.Counter()
per = {}
for p in sorted(glob.glob("sj/*.json")):
    name = os.path.basename(p)[:-5]
    cards = [c for c in json.load(open(p))["cards"] if c.get("serve_source") == "v3"]
    if not cards:
        continue
    row = {"v3": len(cards), "pair": 0}
    for w in WINDOWS:
        row[w] = 0
    row["agree"] = 0; row["both"] = 0; row["extra"] = 0
    for c in cards:
        pair = c.get("serve_bounces")
        if pair:
            row["pair"] += 1
        for w in WINDOWS:
            if landing(c, w):
                row[w] += 1
        hit = landing(c, 1.6)
        if pair and hit:
            row["both"] += 1
            if abs(hit["t"] - pair[1]) < 0.06:
                row["agree"] += 1
        if hit and not pair:
            row["extra"] += 1
    per[name] = row
    for k, v in row.items():
        tot[k] += v

hdr = f"{'match':16s} {'V3':>4s} {'motif pair':>10s}" + "".join(f"{('±'+str(w)+'s'):>8s}" for w in WINDOWS) + f"{'agree':>12s}{'new':>6s}"
print(hdr); print("-" * len(hdr))
for name, r in per.items():
    ag = f"{r['agree']}/{r['both']}" if r["both"] else "-"
    print(f"{name:16s} {r['v3']:4d} {r['pair']:10d}" + "".join(f"{r[w]:8d}" for w in WINDOWS)
          + f"{ag:>12s}{r['extra']:6d}")
print("-" * len(hdr))
ag = f"{tot['agree']}/{tot['both']}"
print(f"{'TOTAL':16s} {tot['v3']:4d} {tot['pair']:10d}" + "".join(f"{tot[w]:8d}" for w in WINDOWS)
      + f"{ag:>12s}{tot['extra']:6d}")
print()
print(f"coverage today (motif pair borrowed): {tot['pair']}/{tot['v3']} = {tot['pair']/tot['v3']*100:.0f}%")
print(f"coverage anchored at 1.6s           : {tot[1.6]}/{tot['v3']} = {tot[1.6]/tot['v3']*100:.0f}%")
print(f"agreement where the motif also spoke: {tot['agree']}/{tot['both']} = "
      f"{tot['agree']/tot['both']*100:.1f}%" if tot['both'] else "")
print(f"landings the motif never gave       : {tot['extra']}")
