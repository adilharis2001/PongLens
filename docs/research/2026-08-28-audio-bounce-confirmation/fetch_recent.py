"""Audio only, for the most recent uploads across all users.

  ./venv/bin/python fetch_recent.py <work-dir> [--days 6] [--per-user 2]

The inspection page needs to show what the detector heard on real, current
uploads rather than only on the seven-match study corpus. Audio is cheap:
no ball detector, no GPU, about a second a match. The raw video is deleted
as soon as its audio is out.

Both a mono mix (what the detector reads) and, when the source is stereo,
the two channels kept apart. The second one exists to answer a question the
study could not: a phone records two microphones about 15 cm apart, and if
the venue's other tables sit off to one side, the difference between the
channels is the only signal in the file that could say which table a
bounce came from.
"""
import argparse
import json
import os
import subprocess
import sys

import boto3
import psycopg2
import psycopg2.extras


def keychain(service):
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"]).decode().strip()


def probe_audio(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=channels,sample_rate,codec_name,channel_layout",
         "-of", "json", path]).decode()
    streams = json.loads(out).get("streams") or [{}]
    return streams[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("work")
    parser.add_argument("--days", type=int, default=6)
    parser.add_argument("--min-points", type=int, default=25)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    conn = psycopg2.connect(os.environ.get("DATABASE_URL")
                            or keychain("ponglens-db-url"))
    conn.set_session(readonly=True)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            select m.id, m.user_id, m.opponent_name, m.venue,
                   m.created_at::date as created, j.input_path,
                   m.match_json_path, m.user_side, m.first_server,
                   count(p.id) filter (where not p.deleted) as pts,
                   count(p.id) filter (where not p.deleted
                                       and (p.placement->>'v') = '3') as v3
            from public.matches m
            join public.jobs j on j.id = m.job_id
            join public.points p on p.match_id = m.id
            where m.created_at > now() - interval '%s days'
              and j.input_path is not null
            group by 1,2,3,4,5,6,7,8,9
            having count(p.id) filter (where not p.deleted) >= %s
            order by m.created_at desc
            limit %s
        """, (args.days, args.min_points, args.limit))
        matches = [dict(r) for r in cur.fetchall()]

    account = os.environ.get("R2_ACCOUNT_ID") or keychain("ponglens-r2-account")
    s3 = boto3.client(
        "s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=(os.environ.get("R2_ACCESS_KEY_ID")
                           or keychain("ponglens-r2-key-id")),
        aws_secret_access_key=(os.environ.get("R2_SECRET_ACCESS_KEY")
                               or keychain("ponglens-r2-secret")),
        region_name="auto")

    manifest = []
    for match in matches:
        slug = str(match["id"])[:8]
        work = os.path.join(args.work, slug)
        os.makedirs(work, exist_ok=True)
        mono = os.path.join(work, "audio.wav")
        stereo = os.path.join(work, "stereo.wav")
        info_path = os.path.join(work, "audio_info.json")
        raw = os.path.join(work, "raw.mp4")
        print(f"\n=== {slug} {match['opponent_name'] or '-'} "
              f"{match['venue'] or '-'} {match['created']} "
              f"{match['pts']} points ===", flush=True)

        if not os.path.exists(info_path):
            if not os.path.exists(mono):
                bucket, key = match["input_path"].replace("r2://", "").split("/", 1)
                print("  downloading raw…", flush=True)
                s3.download_file(bucket, key, raw + ".part")
                os.replace(raw + ".part", raw)
            info = probe_audio(raw)
            print(f"  audio: {info.get('codec_name')} "
                  f"{info.get('channels')} ch {info.get('sample_rate')} Hz "
                  f"({info.get('channel_layout')})", flush=True)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                            "-vn", "-ac", "1", "-ar", "48000",
                            "-c:a", "pcm_s16le", mono], check=True)
            if int(info.get("channels") or 1) >= 2:
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                                "-vn", "-ac", "2", "-ar", "48000",
                                "-c:a", "pcm_s16le", stereo], check=True)
            json.dump(info, open(info_path, "w"))
            if os.path.exists(raw):
                os.remove(raw)
        else:
            info = json.load(open(info_path))

        for path in (match["match_json_path"],):
            dest = os.path.join(work, "match.json")
            if path and not os.path.exists(dest):
                bucket, key = path.replace("r2://", "").split("/", 1)
                s3.download_file(bucket, key, dest)

        manifest.append({k: (str(v) if k in ("id", "user_id", "created") else v)
                         for k, v in match.items()} | {"slug": slug,
                                                       "audio": info})
    json.dump(manifest, open(os.path.join(args.work, "manifest.json"), "w"),
              indent=2, default=str)
    print(f"\n{len(manifest)} matches, "
          f"{sum(m['pts'] for m in manifest)} live points")
    print("stereo:", sum(1 for m in manifest
                         if int(m['audio'].get('channels') or 1) >= 2),
          "of", len(manifest))


if __name__ == "__main__":
    main()
