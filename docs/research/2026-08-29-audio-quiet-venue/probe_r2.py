"""Which candidate matches still have a source file in R2?

Raw video is swept at 30 days, so availability decides the corpus. This
asks R2 directly (HEAD, no download) rather than trusting matches.raw_path,
which reads null on rows whose file is still there.
"""
import os, subprocess, sys
import boto3, botocore
import psycopg2, psycopg2.extras

def keychain(s):
    return subprocess.check_output(["security","find-generic-password","-a","openclaw","-s",s,"-w"]).decode().strip()

conn = psycopg2.connect(os.environ.get("DATABASE_URL") or keychain("ponglens-db-url"))
conn.set_session(readonly=True)
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("""
select m.id, m.venue, m.opponent_name, m.created_at::date created, m.user_side,
       m.first_server, m.duration_s, m.cut_path, m.match_json_path, j.input_path,
       (select count(*) from public.points p where p.match_id=m.id and not coalesce(p.deleted,false)) live,
       (select count(*) from public.points p where p.match_id=m.id and p.confirmed_winner is not null and not coalesce(p.deleted,false)) sc,
       (select count(*) from public.points p where p.match_id=m.id and not coalesce(p.deleted,false) and (p.placement->>'v')='3') v3
from public.matches m left join public.jobs j on j.id=m.job_id
where (select count(*) from public.points p where p.match_id=m.id and p.confirmed_winner is not null and not coalesce(p.deleted,false)) >= 25
order by m.created_at desc
""")
rows = cur.fetchall()

acct = os.environ.get("R2_ACCOUNT_ID") or keychain("ponglens-r2-account")
s3 = boto3.client("s3", endpoint_url=f"https://{acct}.r2.cloudflarestorage.com",
                  aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID") or keychain("ponglens-r2-key-id"),
                  aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY") or keychain("ponglens-r2-secret"),
                  region_name="auto")

def size_of(path):
    if not path: return None
    try:
        bucket, key = path.replace("r2://", "").split("/", 1)
        return s3.head_object(Bucket=bucket, Key=key)["ContentLength"]
    except botocore.exceptions.ClientError:
        return None

print("date       venue            opp            sc   v3  side  raw(MB)  cut(MB)  id")
for r in rows:
    raw = size_of(r["input_path"]); cut = size_of(r["cut_path"])
    print("%-10s %-16s %-14s %4d %4d %-5s %8s %8s  %s" % (
        r["created"], str(r["venue"])[:16], str(r["opponent_name"])[:14], r["sc"], r["v3"],
        str(r["user_side"])[:5],
        f"{raw/1e6:.0f}" if raw else "-", f"{cut/1e6:.0f}" if cut else "-", r["id"]))
