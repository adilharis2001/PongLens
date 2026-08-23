import json, os, subprocess
SC = os.environ["SC"]
data = json.load(open(f"{SC}/serve_frames.json"))
by = {r["idx"]: r for r in data["rows"]}
CW, CH, SX, SY = 720, 406, 720/1920, 406/1080
BOX, ZOOM, FPS = 150, 4, 29.976
for idx in (9, 92, 69):
    r = by[idx]; ev = r["landing"]
    clip = f"{SC}/clips/" + os.path.basename(r["clip"])
    cx, cy = ev["x"] * SX, ev["y"] * SY
    x0 = max(0, min(CW - BOX, int(cx - BOX / 2)))
    y0 = max(0, min(CH - BOX, int(cy - BOX / 2)))
    mx, my = (cx - x0) * ZOOM, (cy - y0) * ZOOM
    files = []
    for k, d in enumerate((-3, -2, -1, 0, 1, 2)):
        t = ev["t"] - r["clip_t0"] + d / FPS
        out = f"{SC}/servecheck/strip_{idx:03d}_{k}.png"
        vf = (f"crop={BOX}:{BOX}:{x0}:{y0},scale={BOX*ZOOM}:{BOX*ZOOM}:flags=lanczos,"
              f"drawbox=x={mx-24}:y={my-24}:w=48:h=48:color=#00E5FF@0.9:t=2")
        subprocess.run(["ffmpeg","-v","error","-y","-i",clip,"-ss",f"{max(0,t):.4f}",
                        "-frames:v","1","-vf",vf,out], check=True)
        files.append(out)
    cmd = ["ffmpeg","-v","error","-y"]
    for f in files: cmd += ["-i", f]
    chain = ";".join(f"[{i}:v]scale=300:300[c{i}]" for i in range(6))
    stack = "".join(f"[c{i}]" for i in range(6))
    layout = "|".join(f"{(i%6)*300}_0" for i in range(6))
    sheet = f"{SC}/sheets/strip_{idx:03d}.png"
    cmd += ["-filter_complex", f"{chain};{stack}xstack=inputs=6:layout={layout}[o]",
            "-map","[o]",sheet]
    subprocess.run(cmd, check=True)
    print(sheet)
