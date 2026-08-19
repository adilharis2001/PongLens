"""Does edge energy along the table outline identify the true table pose?

The alignment idea scores a hypothesized table outline by the image
gradient energy under its edges. For that to support a fit ring, cues and
a lock, the TRUE outline must outscore plausible wrong ones, and the score
must decay smoothly as the outline slides away from truth (a basin a local
search can descend).

For every corpus frame: score the hand-marked quad (plus its net line,
interpolated at the quad's midpoints) against (a) the same quad translated
and scaled away, and (b) other frames' quads rescaled here as impostors.
Report the truth quad's rank and the basin shape.
"""

import json
import math
import os
import subprocess

import cv2
import numpy as np

SCRATCH = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(SCRATCH, "frames")


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


def gradient_field(path):
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return None
    image = cv2.GaussianBlur(image, (3, 3), 0)
    gx = cv2.Sobel(image, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(image, cv2.CV_32F, 0, 1, ksize=3)
    return np.hypot(gx, gy)


def outline_segments(quad):
    """Table edges plus the net line (midpoints of the two long sides)."""
    a, b, c, d = [np.asarray(p, dtype=np.float64) for p in quad]
    net = ((a + d) / 2, (b + c) / 2)      # left mid to right mid, at x=0
    return [(a, b), (b, c), (c, d), (d, a), net]


def score(grad, quad, samples=48):
    h, w = grad.shape
    total, count = 0.0, 0
    for p, q in outline_segments(quad):
        for t in np.linspace(0.02, 0.98, samples):
            x, y = p + (q - p) * t
            xi, yi = int(round(x)), int(round(y))
            if 0 <= xi < w and 0 <= yi < h:
                total += grad[yi, xi]
                count += 1
    return total / count if count else 0.0


def transformed(quad, dx=0.0, dy=0.0, s=1.0):
    quad = np.asarray(quad, dtype=np.float64)
    centre = quad.mean(axis=0)
    return (quad - centre) * s + centre + np.array([dx, dy])


def main():
    rows = fetch_rows()
    all_quads = {}
    for mid, fw, fh, sw, sh, truth, venue in rows:
        sx, sy = fw / sw, fh / sh
        all_quads[str(mid)] = (
            [(x * sx, y * sy) for x, y in truth], fw, fh, venue)

    ranks, basins, rows_out = [], [], []
    for mid, (truth, fw, fh, venue) in all_quads.items():
        path = os.path.join(FRAMES, f"{mid}.jpg")
        grad = gradient_field(path)
        if grad is None:
            continue
        diag = math.hypot(fw, fh)
        truth_score = score(grad, truth)

        rivals = []
        # The same outline, slid and scaled away from the answer.
        for frac in (0.03, 0.06, 0.12):
            r = frac * diag
            for angle in range(0, 360, 45):
                rivals.append(transformed(
                    truth, r * math.cos(math.radians(angle)),
                    r * math.sin(math.radians(angle))))
        for s in (0.7, 0.85, 1.15, 1.3):
            rivals.append(transformed(truth, s=s))
        # Other frames' tables, rescaled here: shaped like real tables,
        # placed where this table is not.
        for other, (oq, ow, oh, _v) in all_quads.items():
            if other == mid or len(rivals) > 60:
                continue
            rivals.append([(x * fw / ow, y * fh / oh) for x, y in oq])

        rival_scores = [score(grad, r) for r in rivals]
        rank = 1 + sum(1 for s_ in rival_scores if s_ > truth_score)
        ranks.append((mid[:8], venue, rank, truth_score,
                      max(rival_scores) if rival_scores else 0))

        # Basin: score as the outline slides right, in % of truth score.
        basin = [score(grad, transformed(truth, dx=f * diag)) / truth_score
                 for f in (0.01, 0.02, 0.04, 0.08)]
        basins.append(basin)

    top1 = sum(1 for r in ranks if r[2] == 1)
    top3 = sum(1 for r in ranks if r[2] <= 3)
    print(f"truth outline ranks 1st on {top1}/{len(ranks)} frames, "
          f"top-3 on {top3}/{len(ranks)}\n")
    basin = np.mean(np.asarray(basins), axis=0)
    print("mean score vs truth as outline slides away "
          "(1%, 2%, 4%, 8% of diagonal):")
    print("  " + "  ".join(f"{v:.2f}" for v in basin))
    losers = [r for r in ranks if r[2] > 1]
    if losers:
        print("\nframes where a rival outscored truth:")
        for mid, venue, rank, ts, rs in sorted(losers, key=lambda r: -r[2])[:10]:
            print(f"  {mid}  {venue:<16} rank {rank}  "
                  f"truth {ts:.1f} vs best rival {rs:.1f}")


if __name__ == "__main__":
    main()
