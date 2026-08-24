"""Re-run BlurBall over the point clips of two matches, for review only.

Production keeps the touches it decided on, not the track they came from.
This produces the track, in the CLIP's own pixel space and clock, so it
lines up with the video the research page plays rather than with the source
video the worker tracked.

Writes src/app/research/serve-accuracy/tracks.json:

    { "<pointId>": [[tSeconds, xFraction, yFraction, conf], ...] }

Fractions rather than pixels so the overlay survives whatever size the
video element ends up.
"""
import json, os, subprocess, sys, time

SC = os.environ["SC"]
PY = "/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python"
INFER = "/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py"
OUT = ("/Users/adil/Desktop/Projects/PongLens/src/app/research/"
       "serve-accuracy/tracks.json")

MATCHES = [("chris", "clips"), ("julian", "jclips")]
tracks, skipped = {}, []
started = time.time()

for name, folder in MATCHES:
    match = json.load(open(f"{SC}/{name}.json"))
    rows = json.load(open(f"{SC}/{name}_points.json"))
    by_idx = {r["idx"]: r["id"] for r in rows}
    fps = match["source"]["fps"]
    for p in match["points"]:
        clip = p.get("clip")
        pid = by_idx.get(p["idx"])
        if not clip or not pid:
            continue
        path = f"{SC}/{folder}/" + os.path.basename(clip)
        if not os.path.exists(path):
            skipped.append((name, p["idx"], "clip missing"))
            continue
        tmp = f"/tmp/bb_{name}_{p['idx']}.jsonl"
        try:
            subprocess.run(
                [PY, INFER, "--video", path, "--out", tmp],
                check=True, capture_output=True, timeout=600,
            )
        except Exception as exc:
            skipped.append((name, p["idx"], str(exc)[:60]))
            continue
        # The clip's own dimensions; blurball reports pixels in them.
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
            capture_output=True, text=True,
        ).stdout.strip().split(",")
        w, h = int(probe[0]), int(probe[1])
        track = []
        for line in open(tmp):
            r = json.loads(line)
            if r.get("x") is None:
                continue
            track.append([
                round(r["f"] / fps, 3),
                round(r["x"] / w, 4),
                round(r["y"] / h, 4),
                round(r.get("conf", 0), 2),
            ])
        os.remove(tmp)
        tracks[pid] = track
        done = len(tracks)
        if done % 20 == 0:
            print(f"{done} clips, {time.time()-started:.0f}s", flush=True)

json.dump(tracks, open(OUT, "w"), separators=(",", ":"))
print(f"wrote {OUT}: {len(tracks)} points, "
      f"{sum(len(t) for t in tracks.values())} detections, "
      f"{os.path.getsize(OUT)/1e6:.1f} MB, {time.time()-started:.0f}s")
if skipped:
    print("skipped:", skipped[:10], f"({len(skipped)} total)")
