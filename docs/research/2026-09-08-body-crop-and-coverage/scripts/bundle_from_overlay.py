"""Rebuild a crossings bundle (servemiss/bundles/crossings/<full id>.json) for a match
whose bundle was lost, from the page's own overlay.json (ball track, bounces, serves,
corners) plus real_calib.json. Fields are exactly those reload.Reloaded and
serve_v2rule.load read. Crossings come from ballx_<m>.json (points_v2.crossings over
the same track). For a match with no *_shifted.jsonl detection file the track is
written as one too (source pixels, one detection per frame).
  /usr/bin/python3 bundle_from_overlay.py <short id>"""
import sys, os, json, glob, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
m = sys.argv[1]
C = json.load(open(f"{HERE}/real_calib.json")); full = next(k for k in C if k.startswith(m))
ovp = glob.glob(f"{S}/v3deploy/public/research/v3-serve-detector/{m}-*/overlay.json")[0]
meta = json.load(open(os.path.dirname(ovp) + "/meta.json")); ov = json.load(open(ovp))
cx, cy = meta["crop"][0], meta["crop"][1]; fps = float(ov["fps"])
raw = f"{HERE}/crop/{m}_raw.mov"
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw], capture_output=True, text=True).stdout or 0) if os.path.exists(raw) else float(ov["ball"][-1][0]) + 5.0
track = [[round(float(t), 3), round(float(x) + cx, 2), round(float(y) + cy, 2)] for t, x, y, *_ in ov["ball"]]
bounces = [[round(float(b[0]), 3), 1 if b[3] == 1 else 0] for b in ov["bounces"]]
serves = sorted(round(float(r[0]), 2) for r in ov["serves"] if r[4] == 1)   # kept serves
crossings = json.load(open(f"{HERE}/ballx_{m}.json"))["crossings"]
# dense ball stretches: detections under 0.5 s apart, runs of at least 1 s
dense, a, prev = [], None, None
for t, _x, _y in track:
    if prev is None or t - prev > 0.5:
        if a is not None and prev - a >= 1.0: dense.append([round(a, 2), round(prev, 2)])
        a = t
    prev = t
if a is not None and prev is not None and prev - a >= 1.0: dense.append([round(a, 2), round(prev, 2)])
cmp_v3 = glob.glob(f"{S}/v3deploy/public/research/v3-serve-detector/{m}-*/compare.json")
cards = []
if cmp_v3:
    for r in json.load(open(cmp_v3[0]))["rows"]:
        for c in r.get("mine") or []: cards.append([round(c["t0"], 2), round(c["t1"], 2), None if c.get("serve_s") is None else round(c["serve_s"], 2)])
    cards.sort()
b = dict(duration=dur, fps=fps, w=1920, h=1080, quad=C[full]["corners"], calibration=C[full].get("calibration", "real_calib.json"),
         calibration_source="real_calib.json", camera=None, route="rebuilt from the page overlay (2026-09-08)",
         track=track, bounces=bounces, crossings=crossings, serves=serves, dense=dense, cards=cards)
out = f"{S}/servemiss/bundles/crossings/{full}.json"
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(b, open(out, "w"))
print(f"{m}: bundle {out}: {len(track)} track points, {len(bounces)} bounces ({sum(f for _, f in bounces)} on table), {len(crossings)} crossings, {len(serves)} kept serves, {len(dense)} dense runs, duration {dur:.1f}")
det = f"{HERE}/crop/{m}_shifted.jsonl"
if not os.path.exists(det):
    with open(det, "w") as fh:
        for t, x, y in track:
            fh.write(json.dumps({"f": int(round(t * fps)), "x": x, "y": y, "conf": 10.0, "c": [[x, y, 10.0]]}) + "\n")
    print(f"  wrote {det} from the overlay track ({len(track)} frames)")
