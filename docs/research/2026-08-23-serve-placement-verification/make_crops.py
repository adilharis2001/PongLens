import json, os, subprocess, sys, math

SC = os.environ["SC"]
data = json.load(open(f"{SC}/serve_frames.json"))
rows = data["rows"]
SRC_W, SRC_H = data["width"], data["height"]
OUT = f"{SC}/servecheck"
os.makedirs(OUT, exist_ok=True)

# Clips are 720 wide against a 1920-wide source.
probe = subprocess.run(["ffprobe","-v","error","-select_streams","v:0",
    "-show_entries","stream=width,height","-of","csv=p=0",
    f"{SC}/clips/03.mp4"], capture_output=True, text=True).stdout.strip()
CW, CH = [int(x) for x in probe.split(",")[:2]]
SX, SY = CW / SRC_W, CH / SRC_H
BOX = 120          # crop side in clip pixels
ZOOM = 4           # upscale so a 5px ball is judgeable

made, missing = [], []
for r in rows:
    clip = f"{SC}/clips/" + os.path.basename(r["clip"])
    if not os.path.exists(clip):
        missing.append(r["idx"]); continue
    for label, ev in (("land", r["landing"]), ("first", r["first"])):
        if not ev or ev.get("x") is None:
            continue
        t = ev["t"] - r["clip_t0"]
        cx, cy = ev["x"] * SX, ev["y"] * SY
        x0 = max(0, min(CW - BOX, int(cx - BOX / 2)))
        y0 = max(0, min(CH - BOX, int(cy - BOX / 2)))
        # Marker centre inside the crop, after zoom.
        mx, my = (cx - x0) * ZOOM, (cy - y0) * ZOOM
        out = f"{OUT}/{r['idx']:03d}_{label}.png"
        vf = (f"crop={BOX}:{BOX}:{x0}:{y0},scale={BOX*ZOOM}:{BOX*ZOOM}:flags=neighbor,"
              f"drawbox=x={mx-26}:y={my-26}:w=52:h=52:color=#00E5FF@0.95:t=2")
        # -ss AFTER -i: decode from the start and discard. Slower, and the
        # only way the frame shown is the frame the detector measured. With
        # a fast seek the picture can be a frame or two off, and at 30fps a
        # served ball moves far enough in one frame to make a correct
        # landing look like a miss.
        cmd = ["ffmpeg","-v","error","-y","-i",clip,"-ss",f"{t:.3f}",
               "-frames:v","1","-vf",vf,out]
        if subprocess.run(cmd, capture_output=True).returncode == 0:
            made.append(out)
        else:
            missing.append((r["idx"], label))
print(json.dumps({"clip": [CW,CH], "made": len(made), "missing": missing[:10]}))
