"""Full-length clips of every fused card, straight from the original upload.

The cut video cannot show these: it drops the dead space between two cards,
so the join is invisible. The original is continuous, which is the only way
to see where one rally ends and the next begins.
"""
import json, os, re, subprocess, time
import boto3

LEAD, TAIL = 1.5, 1.5
env = {}
for line in open("/Users/adil/Desktop/Projects/PongLens/.env.local"):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip('"').strip("'")
s3 = boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                  aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
info = json.load(open("matchinfo.json"))
splits = json.load(open("splits.json"))
JUDGED = ("both halves scored: the split was right",
          "only the SECOND half scored: the first holds a rally with no winner",
          "only the first half scored, second deleted: the second was junk",
          "only the FIRST half scored, second kept but unscored")
todo = [s for s in splits if s["klass"] in JUDGED and info.get(s["mid"], {}).get("good")]
print(f"{len(todo)} judged splits with an original upload and a table quad")
os.makedirs("full", exist_ok=True)
urls = {}
for mid in {s["mid"] for s in todo}:
    bucket, key = info[mid]["raw"].replace("r2://", "").split("/", 1)
    urls[mid] = s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=14400)
t0 = time.time()
made = 0
for i, s in enumerate(todo):
    out = f"full/{s['mid'][:8]}_{s['a_idx']}_{s['b_idx']}.mp4"
    s["full"] = out
    s["clip_start"] = round(max(0.0, s["a0"] - LEAD), 3)
    s["clip_len"] = round(s["b1"] + TAIL - s["clip_start"], 2)
    if os.path.exists(out) and os.path.getsize(out) > 5000:
        made += 1
        continue
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s['clip_start']:.3f}", "-i", urls[s["mid"]],
                        "-t", f"{s['clip_len']:.2f}", "-vf", "scale=416:-2", "-r", "18",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "37", "-an",
                        "-movflags", "+faststart", out], capture_output=True, text=True, timeout=900)
    if r.returncode == 0 and os.path.exists(out):
        made += 1
    else:
        s["full"] = None
        print(f"  failed {s['mid'][:8]} {s['a_idx']}: {r.stderr[:120]}")
    if (i + 1) % 16 == 0:
        print(f"  {i+1}/{len(todo)} in {time.time()-t0:.0f}s", flush=True)
json.dump(splits, open("splits.json", "w"), indent=1)
tot = sum(os.path.getsize(s["full"]) for s in todo if s.get("full"))
print(f"{made} clips, {tot/1e6:.1f} MB of video ({tot*1.34/1e6:.1f} MB embedded)")
