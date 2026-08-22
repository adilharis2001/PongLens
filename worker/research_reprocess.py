"""Re-run the points pipeline on a finished match, for review only.

  ./venv/bin/python research_reprocess.py <match-id> [<match-id> ...]
  ./venv/bin/python research_reprocess.py --ids-file ids.txt

Why this exists rather than a "silent" flag on the real job:

A research re-run and a production re-run want opposite things. Production
must replace what it computed before, so `create_match` deletes every point
row and lets the cascade take the notes, tags, share links and cut labels
with it — and then tells the owner their match is ready. Neither half is
wanted here. We are looking at a match, not rebuilding it.

So this writes NOTHING to `jobs`, `matches` or `points`. There is no code
path from here to `notify_job_done` or to the `matches_notify_status`
trigger, which means no email and no bell can fire by accident rather than
by a flag someone remembered to set. The owner of the video never learns
this ran. That property is structural, and the moment this module starts
updating a match row it stops being true.

What it produces, per match, under `research/endon/<match-id>` in the media
bucket:

    .json   every signal the assembler saw, from --evidence-dump, plus the
            cards production currently has, so the review page can draw the
            old and the new against each other
    .mp4    the source at 960w with audio, which is what the page scrubs

Credentials come from the same login-Keychain items the worker uses, so a
research run and the job it reproduces cannot drift onto different targets.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

import boto3
import psycopg2

TTVID = "/Users/adil/Desktop/Projects/TTVid"
VENV_PY = f"{TTVID}/vendor/venv/bin/python"
BLURBALL_INFER = f"{TTVID}/vendor/blurball_infer.py"
POINTS_PIPELINE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "points_pipeline.py")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_BUCKET = "ponglens-media"
PREFIX = "research/endon"
REVIEW_W = 960


def keychain(service):
    """Same login-Keychain items the worker reads. A research run that
    invented its own credential source would eventually be reproducing the
    pipeline against a different database than the one it runs in."""
    try:
        return subprocess.check_output(
            ["security", "find-generic-password", "-a", "openclaw",
             "-s", service, "-w"], stderr=subprocess.DEVNULL).decode().strip()
    except subprocess.CalledProcessError:
        return None


def config():
    env = {}
    for key, service in (
        ("DATABASE_URL", "ponglens-db-url"),
        ("R2_ACCOUNT_ID", "ponglens-r2-account"),
        ("R2_ACCESS_KEY_ID", "ponglens-r2-key-id"),
        ("R2_SECRET_ACCESS_KEY", "ponglens-r2-secret"),
    ):
        value = os.environ.get(key) or keychain(service)
        if not value:
            raise SystemExit(f"missing {key} (env or Keychain '{service}')")
        env[key] = value
    return env


def s3_client(env):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def resolve(conn, match_id):
    """Where the raw video is, and what production currently believes.

    `matches.raw_path` is not the authority — the column only started being
    filled partway through August 2026, so older rows read null while the
    object sits in R2 untouched. `jobs.input_path` is.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select m.id, m.opponent_name, m.venue, m.created_at::date, "
            "       j.input_path, m.match_json_path "
            "from public.matches m left join public.jobs j on j.id = m.job_id "
            "where m.id = %s", (match_id,))
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"{match_id}: no such match")
        if not row[4]:
            raise SystemExit(f"{match_id}: no jobs.input_path; raw unresolvable")
        cur.execute(
            "select idx, t0, t1 from public.points "
            "where match_id = %s and not deleted order by idx", (match_id,))
        prod = [[float(t0), float(t1)] for _idx, t0, t1 in cur.fetchall()]
    return {
        "id": str(row[0]), "opponent": row[1], "venue": row[2],
        "created": row[3].isoformat(), "input_path": row[4],
        "prod_cards": prod,
    }


def download(s3, uri, dest):
    bucket, key = uri.replace("r2://", "").split("/", 1)
    head = s3.head_object(Bucket=bucket, Key=key)
    size = head["ContentLength"]
    print(f"  downloading {size / 1e6:.0f} MB from {bucket}/{key}")
    s3.download_file(bucket, key, dest)
    return size


def review_video(src, dest):
    """960w with audio. The ear is a sensor here — the bounce ticks are
    audible, and Adil marks boundaries partly by sound."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src,
         "-vf", f"scale={REVIEW_W}:-2", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "26", "-c:a", "aac", "-b:a", "96k",
         "-movflags", "+faststart", dest],
        check=True)


def run_one(conn, s3, env, match_id, workroot, skip_video=False):
    info = resolve(conn, match_id)
    work = os.path.join(workroot, match_id)
    os.makedirs(work, exist_ok=True)
    ext = os.path.splitext(info["input_path"])[1] or ".mp4"
    raw = os.path.join(work, f"raw{ext}")
    t0 = time.time()

    download(s3, info["input_path"], raw)

    blurball = os.path.join(work, "blurball.jsonl")
    if not os.path.exists(blurball):
        print("  blurball inference (the slow part)…")
        subprocess.run([VENV_PY, BLURBALL_INFER, "--video", raw,
                        "--out", blurball], check=True)

    outdir = os.path.join(work, "points_out")
    dump = os.path.join(work, "evidence.json")
    print("  points pipeline (v2 + endon fallback, exactly as production)…")
    subprocess.run(
        [VENV_PY, POINTS_PIPELINE, "points", "--blurball", blurball,
         "--video", raw, "--outdir", outdir, "--strictness", "normal",
         "--cut-mode", "plays", "--pipeline", "v2", "--endon-fallback",
         "--evidence-dump", dump],
        check=True, cwd=work)

    if not os.path.exists(dump):
        # v2 declined (no table, or pre-patch detections). The match.json
        # notes say which, and that is worth surfacing rather than a crash.
        with open(os.path.join(outdir, "match.json")) as fh:
            mj = json.load(fh)
        print(f"  !! no evidence dump — pipeline={mj.get('pipeline')} "
              f"notes={mj.get('notes')}")
        return {"id": match_id, "ok": False, "notes": mj.get("notes")}

    with open(dump) as fh:
        blob = json.load(fh)
    blob["match_id"] = match_id
    blob["opponent"] = info["opponent"]
    blob["venue"] = info["venue"]
    blob["created"] = info["created"]
    blob["prod_cards"] = [[round(a, 2), round(b, 2)]
                          for a, b in info["prod_cards"]]
    with open(dump, "w") as fh:
        json.dump(blob, fh, separators=(",", ":"))

    s3.upload_file(dump, MEDIA_BUCKET, f"{PREFIX}/{match_id}.json",
                   ExtraArgs={"ContentType": "application/json"})

    if not skip_video:
        mp4 = os.path.join(work, "review.mp4")
        if not os.path.exists(mp4):
            print("  encoding the review video…")
            review_video(raw, mp4)
        s3.upload_file(mp4, MEDIA_BUCKET, f"{PREFIX}/{match_id}.mp4",
                       ExtraArgs={"ContentType": "video/mp4"})
        print(f"  uploaded review.mp4 ({os.path.getsize(mp4) / 1e6:.0f} MB)")

    os.remove(raw)  # 12 GB of raws will not fit if we keep them
    mins = (time.time() - t0) / 60
    print(f"  done in {mins:.1f} min — {len(blob['cards'])} cards, "
          f"route {blob['route']}, {blob['serves_per_min']} serves/min "
          f"(production has {len(blob['prod_cards'])})")
    return {"id": match_id, "ok": True, "route": blob["route"],
            "cards": len(blob["cards"]), "prod": len(blob["prod_cards"]),
            "rate": blob["serves_per_min"], "camera": blob["camera"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--ids-file")
    ap.add_argument("--workroot", default=None)
    ap.add_argument("--skip-video", action="store_true")
    args = ap.parse_args()

    ids = list(args.ids)
    if args.ids_file:
        with open(args.ids_file) as fh:
            ids += [l.strip() for l in fh if l.strip()
                    and not l.startswith("#")]
    if not ids:
        ap.error("give at least one match id")

    env = config()
    s3 = s3_client(env)
    workroot = args.workroot or tempfile.mkdtemp(prefix="research-reprocess-")
    os.makedirs(workroot, exist_ok=True)
    print(f"workroot {workroot}\n")

    results = []
    with psycopg2.connect(env["DATABASE_URL"]) as conn:
        for i, mid in enumerate(ids, 1):
            print(f"[{i}/{len(ids)}] {mid}")
            try:
                results.append(run_one(conn, s3, env, mid, workroot,
                                       skip_video=args.skip_video))
            except Exception as e:                       # noqa: BLE001
                print(f"  !! failed: {e}")
                results.append({"id": mid, "ok": False, "error": str(e)})
            print()

    print("=" * 72)
    for r in results:
        if r.get("ok"):
            print(f"{r['id'][:8]}  {r['route']:14s} {r['cards']:4d} new "
                  f"vs {r['prod']:4d} prod   {r['rate']:5.2f}/min  "
                  f"camera {r['camera']}")
        else:
            print(f"{r['id'][:8]}  FAILED  {r.get('error') or r.get('notes')}")
    ok = sum(1 for r in results if r.get("ok"))
    print(f"\n{ok}/{len(results)} succeeded")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
