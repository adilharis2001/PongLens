"""Harvest the table-corner training set while the footage still exists.

Every match with a trusted quad has a static camera, so the quad labels
every frame of its cut video. Cut objects die at 30 days (the 2026-07-22
cohort has ~3 days left as of 2026-08-18), so this samples frames over
presigned HTTPS with ffmpeg seeks — no full downloads — into a cache
outside the repo, with the label carried per match:

    ~/ponglens-data/table-corners/frames/<match>/NNN.jpg
    ~/ponglens-data/table-corners/labels.json

Labels prefer corrected_corners (hand truth) over proposals.production.
Corners are SOURCE pixels; frames keep the video's own size, and the
label records both so training can scale. Resume-safe: matches with a
complete frame directory are skipped.

    venv/bin/python build_table_corner_dataset.py [--frames 40] [--workers 8]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

DATA_ROOT = os.path.expanduser("~/ponglens-data/table-corners")


def keychain(service: str) -> str:
    return subprocess.run(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"],
        capture_output=True, text=True, check=True).stdout.strip()


def r2_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=(f"https://{keychain('ponglens-r2-account')}"
                      ".r2.cloudflarestorage.com"),
        aws_access_key_id=keychain("ponglens-r2-key-id"),
        aws_secret_access_key=keychain("ponglens-r2-secret"),
        region_name="auto")


def fetch_rows():
    import psycopg2
    with psycopg2.connect(keychain("ponglens-db-url")) as conn, \
            conn.cursor() as cur:
        cur.execute("""
            select r.match_id, m.cut_path, m.duration_s,
                   coalesce(r.venue, m.venue, ''),
                   r.source_width, r.source_height,
                   coalesce(r.corrected_corners,
                            r.proposals->'production'->'corners'),
                   (r.corrected_corners is not null) as hand_truth
              from public.table_calibration_review r
              join public.matches m on m.id = r.match_id
             where coalesce(r.verdict, '') not in ('no_table', 'unusable')
               and m.cut_path is not null
               and coalesce(r.corrected_corners,
                            r.proposals->'production'->'corners') is not null
        """)
        return cur.fetchall()


def fetch_new_rows(client, known: set):
    """Ready matches the review table never saw: their quad lives in the
    match.json the points pipeline wrote. This is how the dataset grows
    by itself — every future match that calibrates becomes training data
    the next time this script runs."""
    import psycopg2
    with psycopg2.connect(keychain("ponglens-db-url")) as conn, \
            conn.cursor() as cur:
        cur.execute("""
            select m.id, m.user_id, m.cut_path, m.duration_s,
                   coalesce(m.venue, '')
              from public.matches m
              left join public.table_calibration_review r
                     on r.match_id = m.id
             where m.status = 'ready' and m.cut_path is not null
               and r.match_id is null
        """)
        rows = []
        for match_id, user_id, cut_path, duration, venue in cur.fetchall():
            if str(match_id) in known:
                continue
            key = f"points/{user_id}/{match_id}/match.json"
            try:
                body = client.get_object(
                    Bucket="ponglens-media", Key=key)["Body"].read()
                doc = json.loads(body)
            except Exception:
                continue
            calib = (doc or {}).get("calibration") or {}
            video = (doc or {}).get("video") or {}
            corners = calib.get("table_corners_px")
            if not (calib.get("ok") and corners
                    and video.get("width") and video.get("height")):
                continue
            rows.append((match_id, cut_path, duration, venue,
                         video["width"], video["height"], corners, False))
        return rows


def parse_r2(path: str):
    if not path.startswith("r2://"):
        return None
    bucket, _, key = path[5:].partition("/")
    return bucket, key


def sample_match(client, row, frame_count):
    (match_id, cut_path, duration, venue, sw, sh, corners, hand) = row
    match_id = str(match_id)
    out_dir = os.path.join(DATA_ROOT, "frames", match_id)
    done_marker = os.path.join(out_dir, "done")
    if os.path.exists(done_marker):
        return match_id, "cached", 0
    location = parse_r2(cut_path)
    if location is None:
        return match_id, "bad path", 0
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": location[0], "Key": location[1]},
        ExpiresIn=3 * 3600)

    if not duration or duration <= 0:
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", url],
            capture_output=True, text=True)
        try:
            duration = float(probe.stdout.strip())
        except ValueError:
            return match_id, "no duration", 0

    os.makedirs(out_dir, exist_ok=True)
    written = 0
    for i in range(frame_count):
        # Skip the first/last 3% like the content check does.
        t = duration * (0.03 + 0.94 * i / max(1, frame_count - 1))
        dest = os.path.join(out_dir, f"{i:03d}.jpg")
        if os.path.exists(dest):
            written += 1
            continue
        result = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", url,
             "-frames:v", "1", "-q:v", "4", "-y", dest],
            capture_output=True, text=True, timeout=120)
        if result.returncode == 0 and os.path.exists(dest):
            written += 1
    if written >= frame_count * 3 // 4:
        open(done_marker, "w").close()
        return match_id, "ok", written
    return match_id, "partial", written


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames", type=int, default=40)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    rows = fetch_rows()
    client = r2_client()
    rows += fetch_new_rows(client, {str(r[0]) for r in rows})
    print(f"{len(rows)} labeled matches with a cut video", flush=True)
    os.makedirs(DATA_ROOT, exist_ok=True)

    labels = {}
    for row in rows:
        (match_id, _cut, _dur, venue, sw, sh, corners, hand) = row
        labels[str(match_id)] = {
            "venue": venue, "sourceWidth": sw, "sourceHeight": sh,
            "corners": corners, "handTruth": hand,
        }
    with open(os.path.join(DATA_ROOT, "labels.json"), "w") as f:
        json.dump(labels, f)

    results = {"ok": 0, "cached": 0, "partial": 0, "failed": 0}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(sample_match, client, row, args.frames)
                   for row in rows]
        for future in futures:
            try:
                match_id, status, written = future.result()
            except Exception as e:
                print(f"  worker died: {e}", file=sys.stderr, flush=True)
                results["failed"] += 1
                continue
            results[status if status in results else "failed"] += 1
            print(f"  {match_id[:8]} {status} ({written})", flush=True)
    print(json.dumps(results), flush=True)


if __name__ == "__main__":
    main()
