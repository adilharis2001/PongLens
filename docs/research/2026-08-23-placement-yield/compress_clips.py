import json, os, subprocess, concurrent.futures as cf
diag=json.load(open("diag.json"))
m=json.load(open("chris.json"))
clip={p["idx"]:os.path.basename(p["clip"]) for p in m["points"]}
want=[(p["idx"], clip.get(p["idx"])) for p in diag["points"]]
def go(a):
    idx,name=a
    if not name or not os.path.exists(f"clips/{name}"): return (idx,None)
    out=f"small/{idx:03d}.mp4"
    if not os.path.exists(out):
        subprocess.run(["ffmpeg","-y","-v","error","-i",f"clips/{name}",
          "-vf","scale=480:-2,fps=15","-c:v","libx264","-crf","30",
          "-preset","veryfast","-pix_fmt","yuv420p","-movflags","+faststart",
          "-an",out],check=True)
    return (idx, os.path.getsize(out))
with cf.ThreadPoolExecutor(max_workers=8) as ex: res=list(ex.map(go,want))
ok=[r for r in res if r[1]]
tot=sum(r[1] for r in ok)
print(f"clips {len(ok)}/{len(want)}  total {tot/1e6:.2f} MB  base64 ~{tot*4/3/1e6:.2f} MB")
print("missing:", [r[0] for r in res if not r[1]])
