import json, os, subprocess
SC = os.environ["SC"]
data = json.load(open(f"{SC}/serve_frames.json"))
C = data["corners"]
rows = [r for r in data["rows"] if r["filter"] == "theirServes"]   # Chris serving to Adil
# The ones the map draws hard to the RIGHT (labelled FH for a right-hander).
# u_norm is normalized; recompute it the way the app does: user is near, so
# u_norm = W - u_raw.
W = 1.525
for r in rows:
    r["u_norm"] = W - r["landing"]["u"]
rows.sort(key=lambda r: -r["u_norm"])
picks = rows[:4]

CW, CH, SX, SY = 720, 406, 720/1920, 406/1080
def P(pt): return (pt[0]*SX, pt[1]*SY)
A, B, Cc, D = P(C["A_near_1"]), P(C["B_near_2"]), P(C["C_far_2"]), P(C["D_far_1"])
nearMid = ((A[0]+B[0])/2, (A[1]+B[1])/2)
farMid  = ((Cc[0]+D[0])/2, (Cc[1]+D[1])/2)

files = []
for r in picks:
    ev = r["landing"]
    clip = f"{SC}/clips/" + os.path.basename(r["clip"])
    t = ev["t"] - r["clip_t0"]
    cx, cy = ev["x"]*SX, ev["y"]*SY
    Z = 2
    def line(p, q, col, w=2):
        # No drawline in this build; draw a thin rotated box per segment by
        # stamping small dots along it. Crude, dependable, good enough to see.
        import math
        n = 90
        out = []
        for k in range(n + 1):
            x = p[0] + (q[0] - p[0]) * k / n
            y = p[1] + (q[1] - p[1]) * k / n
            out.append(f"drawbox=x={x*Z-w}:y={y*Z-w}:w={2*w}:h={2*w}"
                       f":color={col}@1.0:t=fill")
        return ",".join(out)
    parts = [f"scale={CW*Z}:{CH*Z}:flags=lanczos"]
    for p, q in ((A,B),(B,Cc),(Cc,D),(D,A)):
        parts.append(line(p, q, "#FF2D95", 2))
    parts.append(line(nearMid, farMid, "#FFFFFF", 2))          # centre line
    parts.append(f"drawbox=x={cx*Z-26}:y={cy*Z-26}:w=52:h=52:color=#00E5FF@1.0:t=4")
    out = f"{SC}/servecheck/wide_{r['idx']:03d}.png"
    subprocess.run(["ffmpeg","-v","error","-y","-i",clip,"-ss",f"{t:.3f}",
                    "-frames:v","1","-vf",",".join(parts),out], check=True)
    files.append((out, r["idx"], round(r["u_norm"],2)))

cmd = ["ffmpeg","-v","error","-y"]
for f,_,_ in files: cmd += ["-i", f]
n = len(files)
chain = ";".join(f"[{i}:v]scale=700:395[c{i}]" for i in range(n))
stack = "".join(f"[c{i}]" for i in range(n))
layout = "|".join(f"{(i%2)*700}_{(i//2)*395}" for i in range(n))
sheet = f"{SC}/sheets/flip_evidence.png"
cmd += ["-filter_complex", f"{chain};{stack}xstack=inputs={n}:layout={layout}[o]",
        "-map","[o]",sheet]
subprocess.run(cmd, check=True)
print(json.dumps({"sheet": sheet,
    "picks (idx, u_norm — all drawn at the map's RIGHT = FH)": [(i,u) for _,i,u in files]}))
