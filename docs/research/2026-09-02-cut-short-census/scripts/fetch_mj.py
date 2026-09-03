import json, os, re, subprocess
import boto3, psycopg2
def keychain(s):
    return subprocess.run(["security","find-generic-password","-a","openclaw","-s",s,"-w"],capture_output=True,text=True).stdout.strip()
env = {}
for line in open("/Users/adil/Desktop/Projects/PongLens/.env.local"):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
    if m: env[m.group(1)] = m.group(2).strip('"').strip("'")
c = boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")
rows = [r for r in json.load(open("/tmp/serve-diag/census/verdicts_joined.json")) if r["verdict"] == "real"]
mids = sorted({r["match_id"] for r in rows})
conn = psycopg2.connect(keychain("ponglens-db-url")); cur = conn.cursor()
cur.execute("select id::text, match_json_path from matches where id = any(%s::uuid[])", (mids,))
paths = dict(cur.fetchall())
cur.execute("""select column_name from information_schema.columns where table_name='points' order by ordinal_position""")
print("points columns:", [r[0] for r in cur.fetchall()])
conn.close()
os.makedirs("mj", exist_ok=True)
for mid, p in paths.items():
    dest = f"mj/{mid}.json"
    if not os.path.exists(dest):
        c.download_file("ponglens-media", p.replace("r2://ponglens-media/", ""), dest)
    d = json.load(open(dest))
    pts = d.get("points") or []
    print(f"{mid[:8]} {len(pts)} points, keys {list(pts[0].keys()) if pts else '-'}")
