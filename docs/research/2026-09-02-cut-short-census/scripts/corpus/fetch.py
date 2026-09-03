"""Pull each candidate's assembler record and per-card evidence from R2."""
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
cand = json.load(open("candidates.json"))
os.makedirs("mj", exist_ok=True); os.makedirs("sj", exist_ok=True)

conn = psycopg2.connect(kc("ponglens-db-url")); cur = conn.cursor()
cur.execute("""
  select p.match_id::text, p.idx, p.t0, p.t1, p.cut_t0, p.scored_at_cut_s, p.deleted,
         (m.clip_pads->>'pre')::float
  from points p join matches m on m.id = p.match_id
  where p.match_id = any(%s::uuid[]) order by p.match_id, p.t0""", ([c["mid"] for c in cand],))
taps = {}
for mid, idx, t0, t1, cut_t0, tap, deleted, pre in cur.fetchall():
    if tap is None or cut_t0 is None:
        continue
    taps.setdefault(mid, []).append(float(tap) - float(cut_t0) - (pre if pre is not None else 0.3) + float(t0))
conn.close()
json.dump({k: sorted(v) for k, v in taps.items()}, open("taps.json", "w"))

ok = 0
for c in cand:
    key = c["mjp"].replace("r2://ponglens-media/", "")
    for name, k in (("mj", key), ("sj", key.replace("match.json", "serves.json"))):
        dest = f"{name}/{c['mid']}.json"
        if os.path.exists(dest):
            continue
        try:
            s3.download_file("ponglens-media", k, dest)
        except Exception as e:
            print(f"  {c['owner'][:10]:10s} {c['opp'][:20]:20s} no {name}: {str(e)[:40]}")
    if os.path.exists(f"mj/{c['mid']}.json"):
        d = json.load(open(f"mj/{c['mid']}.json"))
        c["pipeline"] = d.get("pipeline")
        c["has_sj"] = os.path.exists(f"sj/{c['mid']}.json")
        ok += 1
json.dump(cand, open("candidates.json", "w"), indent=1)
from collections import Counter
print(f"\n{ok} match records pulled")
print("pipeline:", Counter(c.get("pipeline") for c in cand))
print("with per-card evidence:", sum(1 for c in cand if c.get("has_sj")))
print("v2 AND evidence:", sum(1 for c in cand if c.get("pipeline") == "v2" and c.get("has_sj")))
