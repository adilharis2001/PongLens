"""A clip per split: the seconds before the cut, then what plays next."""
import json, os, re, subprocess
import boto3, psycopg2

def kc(s):
    return subprocess.run(["security", "find-generic-password", "-a", "openclaw", "-s", s, "-w"],
                          capture_output=True, text=True).stdout.strip()

env = {}
for line in open("/Users/adil/Desktop/Projects/PongLens/.env.local"):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip('"').strip("'")
s3 = boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                  aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
splits = json.load(open("splits.json"))
mids = sorted({s["mid"] for s in splits})
conn = psycopg2.connect(kc("ponglens-db-url")); cur = conn.cursor()
cur.execute("select id::text, cut_path, coalesce((clip_pads->>'pre')::float, 0.3) from matches where id = any(%s::uuid[])", (mids,))
cut = {r[0]: dict(path=r[1], pre=r[2]) for r in cur.fetchall()}
cur.execute("select match_id::text, t0, t1, cut_t0 from points where match_id = any(%s::uuid[]) and cut_t0 is not null order by match_id, t0", (mids,))
rows = {}
for mid, t0, t1, c0 in cur.fetchall():
    rows.setdefault(mid, []).append((float(t0), float(t1), float(c0)))
conn.close()

urls = {}
for mid in mids:
    p = cut.get(mid, {}).get("path")
    if p:
        urls[mid] = s3.generate_presigned_url(
            "get_object", Params={"Bucket": "ponglens-media", "Key": p.replace("r2://ponglens-media/", "")},
            ExpiresIn=7200)
os.makedirs("clips", exist_ok=True)
made = skipped = 0
for i, s in enumerate(splits):
    mid = s["mid"]
    out = f"clips/{mid[:8]}_{s['a_idx']}_{s['b_idx']}.mp4"
    s["clip"] = None
    if mid not in urls or mid not in rows:
        skipped += 1; continue
    pre = cut[mid]["pre"]
    ra = min(rows[mid], key=lambda r: abs(r[0] - s["a0"]))
    rb = min(rows[mid], key=lambda r: abs(r[0] - s["b0"]))
    if abs(ra[0] - s["a0"]) > 0.8 or abs(rb[0] - s["b0"]) > 0.8:
        skipped += 1; continue
    a_end = ra[2] + pre + (ra[1] - ra[0])          # where card A ends in the cut video
    b_start = rb[2] + pre
    start = max(0.0, a_end - 4.0)
    mark = a_end - start
    length = min(14.0, mark + (b_start - a_end) + 8.0)
    if os.path.exists(out) and os.path.getsize(out) > 5000:
        s["clip"] = out; made += 1; continue
    vf = (f"scale=560:-2,drawbox=x=0:y=0:w=iw:h=ih:color=cyan@0.85:t=5:"
          f"enable='between(t,{mark:.2f},{mark + 0.5:.2f})'")
    r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", urls[mid],
                        "-t", f"{length:.2f}", "-vf", vf, "-r", "24", "-c:v", "libx264",
                        "-preset", "veryfast", "-crf", "33", "-an", "-movflags", "+faststart", out],
                       capture_output=True, text=True, timeout=420)
    if r.returncode == 0 and os.path.exists(out):
        s["clip"] = out; made += 1
    else:
        skipped += 1
    if (i + 1) % 15 == 0:
        print(f"  {i+1}/{len(splits)} ({made} made)", flush=True)
json.dump(splits, open("splits.json", "w"), indent=1)
print(f"{made} clips, {skipped} skipped")
print("total", f"{sum(os.path.getsize(s['clip']) for s in splits if s['clip'])/1e6:.1f} MB")
