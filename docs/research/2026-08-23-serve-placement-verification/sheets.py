import json, os, subprocess, math
SC = os.environ["SC"]
rows = json.load(open(f"{SC}/serve_frames.json"))["rows"]
rows.sort(key=lambda r: r["idx"])
CELL, COLS = 240, 5
os.makedirs(f"{SC}/sheets", exist_ok=True)
made = []
for page, start in enumerate(range(0, len(rows), 20)):
    chunk = rows[start:start+20]
    inputs, filters, labels = [], [], []
    for i, r in enumerate(chunk):
        inputs += ["-i", f"{SC}/servecheck/{r['idx']:03d}_land.png"]
        filters.append(f"[{i}:v]scale={CELL}:{CELL}[c{i}]")
        labels.append(f"{r['idx']}")
    n = len(chunk)
    rowsN = math.ceil(n / COLS)
    chain = ";".join(filters)
    stack = "".join(f"[c{i}]" for i in range(n))
    out = f"{SC}/sheets/landings_{page+1}.png"
    cmd = ["ffmpeg","-v","error","-y",*inputs,"-filter_complex",
           f"{chain};{stack}xstack=inputs={n}:layout=" +
           "|".join(f"{(i%COLS)*CELL}_{(i//COLS)*CELL}" for i in range(n)) +
           f"[out]","-map","[out]",out]
    r = subprocess.run(cmd, capture_output=True)
    made.append((out, r.returncode, labels))
print(json.dumps([{"file": m[0], "rc": m[1], "idx": m[2]} for m in made], indent=1))
