"""Taps and card rows for the nine dump matches, plus match.json durations
for the census matches without dumps (to see whether Anton's re-uploads are
the same videos as his originals)."""
import json, os, re, subprocess, glob
import boto3, psycopg2

def keychain(s):
    return subprocess.run(["security","find-generic-password","-a","openclaw","-s",s,"-w"],capture_output=True,text=True).stdout.strip()
def r2():
    env = {}
    for line in open("/Users/adil/Desktop/Projects/PongLens/.env.local"):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m: env[m.group(1)] = m.group(2).strip('"').strip("'")
    return boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")

dumps = [os.path.basename(p) for p in glob.glob("/private/tmp/ponglens-inferred-bounce-eval/*")]
rows = json.load(open("/tmp/serve-diag/census/verdicts_joined.json"))
census = sorted({r["match_id"] for r in rows})
mids = sorted(set(dumps) | set(census))
conn = psycopg2.connect(keychain("ponglens-db-url")); cur = conn.cursor()
cur.execute("""select p.match_id::text, p.idx, p.t0, p.t1, p.cut_t0, p.scored_at_cut_s, p.confirmed_winner is not null, p.deleted,
                      (m.clip_pads->>'pre')::float
               from points p join matches m on m.id = p.match_id where p.match_id = any(%s::uuid[]) order by p.match_id, p.t0""", (mids,))
pts = {}
for mid, idx, t0, t1, cut_t0, tap_cut, scored, deleted, pre in cur.fetchall():
    pre = pre if pre is not None else 0.3
    tap = None if (tap_cut is None or cut_t0 is None) else float(tap_cut) - float(cut_t0) - pre + float(t0)
    pts.setdefault(mid, []).append(dict(idx=idx, t0=float(t0), t1=float(t1), tap=tap, scored=scored, deleted=deleted))
cur.execute("""select m.id::text, m.opponent_name, m.created_at::date::text, m.match_json_path, m.raw_path,
                      coalesce(u.raw_user_meta_data->>'full_name', u.email)
               from matches m join auth.users u on u.id = m.user_id where m.id = any(%s::uuid[])""", (mids,))
meta = {mid: dict(opp=opp, created=cr, mjp=mjp, raw=raw, owner=(owner or "?").split()[0]) for mid, opp, cr, mjp, raw, owner in cur.fetchall()}
conn.close()
c = r2()
for mid, m in meta.items():
    try:
        key = m["mjp"].replace("r2://ponglens-media/", "")
        mj = json.loads(c.get_object(Bucket="ponglens-media", Key=key)["Body"].read())
        m["duration"] = (mj.get("source") or {}).get("duration"); m["fps"] = (mj.get("source") or {}).get("fps")
        m["trim"] = {k: v for k, v in (mj.get("options") or {}).items() if "trim" in k or "crop" in k}
        m["notes"] = mj.get("notes")
    except Exception as e:
        m["err"] = str(e)[:80]
json.dump(dict(points=pts, meta=meta), open("/tmp/serve-diag/fix/db.json", "w"))
for mid in mids:
    m = meta[mid]; n = len(pts.get(mid, [])); taps = sum(1 for p in pts.get(mid, []) if p["tap"] is not None)
    print(f"{mid[:8]} {'DUMP' if mid in dumps else '    '} {m['owner']:8s} {str(m['opp'])[:26]:26s} {m['created']} dur {m.get('duration')!s:>8s} fps {m.get('fps')!s:>7s} cards {n:3d} taps {taps:3d} trim {m.get('trim')} raw {os.path.basename(str(m.get('raw')))[:40]}")
