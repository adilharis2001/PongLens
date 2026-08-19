"""Can Vision find the table? Measure against the hand-marked corpus.

Downloads every table_calibration_review frame (median background at the
pipeline's working size), runs the compiled detect_rects Vision CLI over a
small parameter grid, and scores detections against corrected_corners.

Truth corners are SOURCE pixels in canonical order A near-left, B near-right,
C far-right, D far-left; frames are scaled to frame_width x frame_height.
Vision's named corners map by construction: the near end sits lower in the
frame, so bl->A, br->B, tr->C, tl->D.
"""

import json
import math
import os
import subprocess
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(SCRATCH, "frames")
DETECT = os.path.join(SCRATCH, "detect_rects")
FRAME_PREFIX = "research/table-calibration/v1/frames"


def keychain(service):
    return subprocess.run(
        ["security", "find-generic-password", "-a", "openclaw", "-s", service, "-w"],
        capture_output=True, text=True, check=True).stdout.strip()


def fetch_rows():
    import psycopg2
    with psycopg2.connect(keychain("ponglens-db-url")) as conn, conn.cursor() as cur:
        cur.execute("""
            select match_id, frame_width, frame_height, source_width,
                   source_height, corrected_corners, coalesce(venue, '')
              from public.table_calibration_review
             where corrected_corners is not null
               and coalesce(verdict, '') not in ('no_table', 'unusable')
        """)
        return cur.fetchall()


def download(match_ids):
    import boto3
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{keychain('ponglens-r2-account')}.r2.cloudflarestorage.com",
        aws_access_key_id=keychain("ponglens-r2-key-id"),
        aws_secret_access_key=keychain("ponglens-r2-secret"),
        region_name="auto")
    os.makedirs(FRAMES, exist_ok=True)
    have = 0
    for mid in match_ids:
        dest = os.path.join(FRAMES, f"{mid}.jpg")
        if os.path.exists(dest):
            have += 1
            continue
        try:
            client.download_file("ponglens-media", f"{FRAME_PREFIX}/{mid}.jpg", dest)
            have += 1
        except Exception as e:
            print(f"  no frame for {mid[:8]}: {e}", file=sys.stderr)
    return have


def score(rows, min_aspect, quad_tol, min_conf):
    hits, misses, top1 = [], [], 0
    for mid, fw, fh, sw, sh, truth, venue in rows:
        frame = os.path.join(FRAMES, f"{mid}.jpg")
        if not os.path.exists(frame):
            continue
        sx, sy = fw / sw, fh / sh
        t = [(x * sx, y * sy) for x, y in truth]     # A B C D in frame px
        diag = math.hypot(fw, fh)
        raw = subprocess.run(
            [DETECT, frame, str(min_aspect), str(quad_tol), str(min_conf), "10"],
            capture_output=True, text=True).stdout.strip()
        quads = json.loads(raw or "[]")
        best = None
        for rank, q in enumerate(
                sorted(quads, key=lambda q: -q["confidence"])):
            d = [q["bl"], q["br"], q["tr"], q["tl"]]
            errs = [math.dist(t[i], d[i]) / diag for i in range(4)]
            mean = sum(errs) / 4
            if best is None or mean < best[0]:
                best = (mean, max(errs), rank)
        if best and best[0] < 0.04 and best[1] < 0.08:
            hits.append((mid[:8], venue, best[0], best[2]))
            if best[2] == 0:
                top1 += 1
        else:
            misses.append((mid[:8], venue, best[0] if best else None))
    return hits, misses, top1


def main():
    rows = fetch_rows()
    have = download([str(r[0]) for r in rows])
    print(f"{len(rows)} corpus rows, {have} frames on disk\n")

    for (ma, qt, mc) in [(0.15, 30, 0.2), (0.15, 45, 0.2), (0.1, 45, 0.1),
                         (0.2, 20, 0.3)]:
        hits, misses, top1 = score(rows, ma, qt, mc)
        total = len(hits) + len(misses)
        print(f"aspect>={ma} tol={qt} conf>={mc}:  "
              f"recall {len(hits)}/{total} ({100*len(hits)/total:.0f}%)  "
              f"top-1 {top1}/{total}")
        by_venue = {}
        for _, venue, *_ in hits:
            by_venue.setdefault(venue or "?", [0, 0])[0] += 1
        for _, venue, *_ in misses:
            by_venue.setdefault(venue or "?", [0, 0])[1] += 1
        for venue, (h, m) in sorted(by_venue.items()):
            print(f"    {venue or '(unknown)':<18} {h}/{h+m}")
        if misses:
            worst = ", ".join(
                f"{m[0]}({(m[2]*100):.0f}%)" if m[2] is not None else f"{m[0]}(none)"
                for m in misses[:8])
            print(f"    missed: {worst}")
        print()


if __name__ == "__main__":
    main()
