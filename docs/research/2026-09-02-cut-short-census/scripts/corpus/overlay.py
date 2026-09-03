"""Per split: everything needed to draw the evidence over the video.

Times are converted to the clip's own clock so the page never has to know
about source seconds. Positions stay as fractions of the frame, so the
overlay survives any display size.
"""
import json

W_M, L_M, NET_V = 1.525, 2.74, 1.37
splits = json.load(open("splits.json"))
taps_all = json.load(open("taps.json"))
out = {}
for s in splits:
    if not s.get("full"):
        continue
    mid = s["mid"]
    sj = json.load(open(f"sj/{mid}.json"))
    w, h = float(sj["w"]), float(sj["h"])
    cards = sorted(sj["cards"], key=lambda c: c["t0"])
    A = min(cards, key=lambda c: abs(c["t0"] - s["a0"]))
    B = min(cards, key=lambda c: abs(c["t0"] - s["b0"]))
    z = s["clip_start"]
    track, bounces, crossings = [], [], []
    for c, half in ((A, 0), (B, 1)):
        for t, x, y in c.get("track") or []:
            track.append([round(t - z, 2), round(x, 4), round(y, 4), half])
        for b in c.get("bounces") or []:
            bounces.append(dict(t=round(b["t"] - z, 2), x=round(b["x"], 4), y=round(b["y"], 4),
                                u=b.get("u"), v=b.get("v"), on=bool(b.get("onTable")), half=half))
        for x in c.get("crossings") or []:
            crossings.append(round(x - z, 2))
    track.sort(key=lambda r: r[0])
    bounces.sort(key=lambda b: b["t"])
    crossings.sort()
    quad = [[round(p[0] / w, 4), round(p[1] / h, 4)] for p in sj["quad"]]
    net = sj.get("net")
    net = [[round(p[0] / w, 4), round(p[1] / h, 4)] for p in net] if net else None
    taps = [round(t - z, 2) for t in taps_all.get(mid, []) if z <= t <= z + s["clip_len"]]
    out[f"{mid[:8]}-{s['a_idx']}"] = dict(
        dur=s["clip_len"], quad=quad, net=net, track=track, bounces=bounces, crossings=crossings,
        taps=taps, a0=round(s["a0"] - z, 2), a1=round(s["a1"] - z, 2),
        b0=round(s["b0"] - z, 2), b1=round(s["b1"] - z, 2))
json.dump(out, open("overlay.json", "w"), separators=(",", ":"))
import os
print(f"{len(out)} splits, overlay payload {os.path.getsize('overlay.json')/1000:.0f} KB")
n_tr = sum(len(v["track"]) for v in out.values()); n_b = sum(len(v["bounces"]) for v in out.values())
print(f"{n_tr} tracked ball positions, {n_b} bounces, {sum(len(v['crossings']) for v in out.values())} net crossings")
one = list(out.values())[0]
print("sample:", {k: (v[:2] if isinstance(v, list) else v) for k, v in one.items() if k != 'track'})
