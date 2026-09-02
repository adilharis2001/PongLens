"""Cards that look cut mid-rally, across every recent upload, from
production data alone.

Per card, serves.json carries the serve mark, the net crossings and the
tracked spans; the points table carries the card numbers Adil sees and,
on his own matches, his winner taps. The taps calibrate the signature
first — a flagged pair whose taps say "one point" is a hit, "two points"
is a false alarm — so the list handed over has a known hit rate.

Signature candidates for a pair of consecutive cards (prev, next):
  S1  next opens within ADJ_S of prev's end and has no serve of its own
  S2  next's first net crossing comes within CROSS_SOON_S of prev's end
      (a new point needs dead time plus a serve first; a rally does not)
  S3  prev's ball was still tracked in its final 0.6 s (something in play)
"""
import json, os, re, subprocess, sys
import numpy as np

sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import psycopg2
import boto3

W = "/tmp/serve-diag/census"
os.makedirs(W, exist_ok=True)
ADJ_S, CROSS_SOON_S = 1.6, 4.5
SINCE = "2026-08-22"


def keychain(service):
    for args in (["-s", service, "-w"], ["-a", "openclaw", "-s", service, "-w"]):
        r = subprocess.run(["security", "find-generic-password", *args],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    raise RuntimeError(f"keychain item {service} not found")


def r2():
    env = {}
    for line in open("/Users/adil/Desktop/Projects/PongLens/.env.local"):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            env[m.group(1)] = m.group(2).strip('"').strip("'")
    return boto3.client(
        "s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


conn = psycopg2.connect(os.environ.get("DATABASE_URL") or keychain("ponglens-db-url"))
cur = conn.cursor()
cur.execute("""
  select m.id, m.opponent_name, coalesce(u.raw_user_meta_data->>'full_name', u.email) as owner,
         m.created_at::date, m.match_json_path
  from matches m join auth.users u on u.id = m.user_id
  where m.created_at >= %s and m.status = 'ready'
    and (select count(*) from points p where p.match_id = m.id) >= 15
  order by m.created_at""", (SINCE,))
matches = cur.fetchall()
cur.execute("""
  select p.match_id, p.idx, p.t0, p.t1, p.deleted,
         p.t0 - (m.clip_pads->>'pre')::numeric - p.cut_t0 + p.scored_at_cut_s as tap_src
  from points p join matches m on m.id = p.match_id
  where m.created_at >= %s""", (SINCE,))
pts = {}
for mid, idx, t0, t1, deleted, tap in cur.fetchall():
    pts.setdefault(str(mid), []).append(dict(idx=idx, t0=float(t0), t1=float(t1), deleted=deleted,
                                             tap=float(tap) if tap is not None else None))
conn.close()

c = r2()
report = []
calib = []
for mid, opp, owner, created, mjp in matches:
    mid = str(mid)
    key = mjp.replace("r2://ponglens-media/", "").replace("match.json", "serves.json")
    cache = f"{W}/{mid}.serves.json"
    try:
        if not os.path.exists(cache):
            body = c.get_object(Bucket="ponglens-media", Key=key)["Body"].read()
            open(cache, "wb").write(body)
        sj = json.load(open(cache))
    except Exception as e:                                    # noqa: BLE001
        print(f"  {opp or owner}: no serves.json ({str(e)[:60]})")
        continue
    cards = sorted(sj["cards"], key=lambda k: k["t0"])
    rows = pts.get(mid, [])
    taps = sorted(r["tap"] for r in rows if r["tap"] is not None)
    label = f"{owner.split()[0] if owner else '?'} / {opp or 'untitled'}"

    def idx_of(t0):
        best = min(rows, key=lambda r: abs(r["t0"] - t0), default=None)
        return best["idx"] if best and abs(best["t0"] - t0) < 0.6 else None

    for a, b in zip(cards, cards[1:]):
        gap = b["t0"] - a["t1"]
        s1 = gap <= ADJ_S and b.get("serve_s") is None
        cr = b.get("crossings") or []
        s2 = bool(cr) and (cr[0] - a["t1"]) <= CROSS_SOON_S
        seen = a.get("seen") or []
        s3 = bool(seen) and seen[-1][1] >= a["t1"] - 0.6
        if not (s1 or s2):
            continue
        tp = [t for t in taps if a["t0"] <= t < b["t0"]]     # prev card plus the gap
        tn = [t for t in taps if b["t0"] <= t <= b["t1"]]
        verdict = None
        if taps:
            if len(tp) + len(tn) == 1:
                verdict = "same"
            elif len(tp) >= 1 and len(tn) >= 1:
                verdict = "two"
        rec = dict(match=label, match_id=mid, prev_idx=idx_of(a["t0"]), next_idx=idx_of(b["t0"]),
                   prev_t1=a["t1"], next_t0=b["t0"], gap=round(gap, 2),
                   next_serve=b.get("serve_s") is not None,
                   dt_cross=round(cr[0] - a["t1"], 2) if cr else None,
                   s1=s1, s2=s2, s3=s3, verdict=verdict)
        report.append(rec)
        if verdict:
            calib.append(rec)

json.dump(report, open(f"{W}/report.json", "w"), indent=1)

print(f"{len(matches)} matches, {len(report)} candidate pairs, {len(calib)} decided by taps\n")
print("CALIBRATION against Adil's taps (same point = hit, two points = false alarm)")
for name, fn in (("S1 adjacent+serveless", lambda r: r["s1"]),
                 ("S2 crossing within 4.5s", lambda r: r["s2"]),
                 ("S1 and S2", lambda r: r["s1"] and r["s2"]),
                 ("S1 and S3", lambda r: r["s1"] and r["s3"]),
                 ("S1 and S2 and S3", lambda r: r["s1"] and r["s2"] and r["s3"]),
                 ("S2 and dt<=3.0", lambda r: r["s2"] and r["dt_cross"] is not None and r["dt_cross"] <= 3.0),
                 ("S1 and S2 and dt<=3.0", lambda r: r["s1"] and r["s2"] and r["dt_cross"] is not None and r["dt_cross"] <= 3.0)):
    sel = [r for r in calib if fn(r)]
    same = sum(1 for r in sel if r["verdict"] == "same")
    two = len(sel) - same
    print(f"  {name:26s} flagged {len(sel):3d}   same point {same:3d}   two points {two:3d}   "
          f"precision {same / len(sel) * 100 if sel else 0:5.1f}%")
