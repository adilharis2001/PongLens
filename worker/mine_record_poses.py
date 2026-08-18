"""Where did good cameras stand? Mine the hand-marked calibration corpus.

Every corrected quad in table_calibration_review is four corners of a known
2.740 x 1.525 m rectangle, so each one pins down the camera that filmed it
(same single-plane math as table_keypoint_camera, kept here in full because
this script needs the whole camera centre, not just height and distance).

The output feeds the Record tab's placement ghost: the app renders the
table as it would appear from the median proven-good pose, and bounds its
step-back corridor by the envelope. Run it read-only against production:

    venv/bin/python mine_record_poses.py            # table to stdout
    venv/bin/python mine_record_poses.py --json     # envelope JSON

World frame, matching table_keypoint_fit.WORLD: x along the table length
(near end at -1.370), y across the width (camera-left positive), z up.
Corners arrive cyclic A near-left, B near-right, C far-right, D far-left.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys

import numpy as np

TABLE_LENGTH_M = 2.740
TABLE_WIDTH_M = 1.525
NEAR_X = -TABLE_LENGTH_M / 2.0

# A, B, C, D in the world frame (z = 0 plane).
WORLD_CORNERS = np.array(
    [
        [NEAR_X, TABLE_WIDTH_M / 2.0],
        [NEAR_X, -TABLE_WIDTH_M / 2.0],
        [-NEAR_X, -TABLE_WIDTH_M / 2.0],
        [-NEAR_X, TABLE_WIDTH_M / 2.0],
    ]
)


def keychain(service: str) -> str | None:
    try:
        return subprocess.run(
            ["security", "find-generic-password", "-a", "openclaw",
             "-s", service, "-w"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError:
        return None


def homography(world_xy: np.ndarray, image_xy: np.ndarray) -> np.ndarray:
    """Four-point DLT, world plane -> image pixels."""
    rows = []
    for (X, Y), (u, v) in zip(world_xy, image_xy):
        rows.append([X, Y, 1, 0, 0, 0, -u * X, -u * Y, -u])
        rows.append([0, 0, 0, X, Y, 1, -v * X, -v * Y, -v])
    _u, _s, vt = np.linalg.svd(np.asarray(rows, dtype=np.float64))
    return vt[-1].reshape(3, 3)


def focal_candidates(H: np.ndarray, cx: float, cy: float) -> list[float]:
    """Zhang's two single-plane constraints, each solved for f."""
    h1 = H[:, 0].copy()
    h2 = H[:, 1].copy()
    for column in (h1, h2):
        column[0] -= cx * column[2]
        column[1] -= cy * column[2]
    numerators = (
        h1[0] * h2[0] + h1[1] * h2[1],
        h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2,
    )
    denominators = (h1[2] * h2[2], h1[2] ** 2 - h2[2] ** 2)
    out = []
    for numerator, denominator in zip(numerators, denominators):
        if abs(denominator) <= 1e-12:
            continue
        value = -numerator / denominator
        if value > 0:
            out.append(math.sqrt(value))
    return out


def camera_centre(H: np.ndarray, focal: float, cx: float, cy: float):
    K = np.array([[focal, 0.0, cx], [0.0, focal, cy], [0.0, 0.0, 1.0]])
    M = np.linalg.inv(K) @ H
    # A homography is only defined up to sign; the physical decomposition
    # is the one that puts the camera above the table plane.
    for sign in (1.0, -1.0):
        Ms = M * sign
        n1 = float(np.linalg.norm(Ms[:, 0]))
        n2 = float(np.linalg.norm(Ms[:, 1]))
        if n1 < 1e-12 or n2 < 1e-12:
            continue
        Ms = Ms / ((n1 + n2) / 2.0)
        r1, r2, t = Ms[:, 0], Ms[:, 1], Ms[:, 2]
        R = np.stack([r1, r2, np.cross(r1, r2)], axis=1)
        U, _s, Vt = np.linalg.svd(R)
        R = U @ Vt
        centre = -R.T @ t
        if np.all(np.isfinite(centre)) and centre[2] > 0:
            return centre
    return None


def pose_for(corners, width: int, height: int):
    """The physically plausible camera for one quad, or None."""
    image = np.asarray(corners, dtype=np.float64)
    if image.shape != (4, 2):
        return None
    H = homography(WORLD_CORNERS, image)
    best = None
    for focal in focal_candidates(H, width / 2.0, height / 2.0):
        centre = camera_centre(H, focal, width / 2.0, height / 2.0)
        if centre is None:
            continue
        x, y, z = (float(v) for v in centre)
        # A camera filming table tennis stands behind the near end, above
        # the floor, below the ceiling. Reject decompositions that don't.
        if not (0.3 < z < 6.0 and x < NEAR_X and abs(y) < 12.0):
            continue
        if best is None or z < best[2]:      # prefer the lower, likelier one
            best = (x, y, z)
    return best


def fetch_rows():
    import psycopg2

    dsn = keychain("ponglens-db-url")
    if not dsn:
        sys.exit("no ponglens-db-url in the keychain")
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            select match_id, corrected_corners, source_width, source_height,
                   coalesce(verdict, ''), coalesce(placement_status, ''),
                   coalesce(venue, ''), duplicate_of
              from public.table_calibration_review
             where corrected_corners is not null
            """
        )
        return cur.fetchall()


def main() -> None:
    rows = fetch_rows()
    seen_duplicates: set = set()
    poses = []
    for match_id, corners, w, h, verdict, placement, venue, dup in rows:
        if verdict in ("no_table", "unusable"):
            continue
        if dup is not None:
            if dup in seen_duplicates:
                continue
            seen_duplicates.add(dup)
        pose = pose_for(corners, w, h)
        if pose is None:
            continue
        x, y, z = pose
        poses.append(
            {
                "match": str(match_id)[:8],
                "venue": venue,
                "placement": placement,
                "behind_m": round(NEAR_X - x, 2),   # metres behind near end
                "lateral_m": round(y, 2),           # +left / -right of centre
                "height_m": round(z, 2),
                "side": "left" if y > 0 else "right",
            }
        )

    if not poses:
        sys.exit("no usable poses")

    def pct(values, q):
        return float(np.percentile(np.asarray(values), q))

    behinds = [p["behind_m"] for p in poses]
    laterals = [abs(p["lateral_m"]) for p in poses]
    heights = [p["height_m"] for p in poses]
    rights = sum(1 for p in poses if p["side"] == "right")

    envelope = {
        "source": "table_calibration_review corrected corners, "
                  f"{len(poses)} matches",
        "golden": {
            "behind_m": round(pct(behinds, 50), 2),
            "lateral_m": round(pct(laterals, 50), 2),
            "height_m": round(pct(heights, 50), 2),
        },
        "envelope": {
            "behind_m": [round(pct(behinds, 15), 2), round(pct(behinds, 85), 2)],
            "lateral_m": [round(pct(laterals, 15), 2), round(pct(laterals, 85), 2)],
            "height_m": [round(pct(heights, 15), 2), round(pct(heights, 85), 2)],
        },
        "right_side_share": round(rights / len(poses), 2),
    }

    if "--json" in sys.argv:
        print(json.dumps(envelope, indent=2))
        return

    poses.sort(key=lambda p: p["behind_m"])
    print(f"{'match':<10}{'venue':<18}{'placement':<12}"
          f"{'behind':>7}{'lateral':>9}{'height':>8}  side")
    for p in poses:
        print(f"{p['match']:<10}{p['venue'][:16]:<18}{p['placement']:<12}"
              f"{p['behind_m']:>7.2f}{p['lateral_m']:>9.2f}"
              f"{p['height_m']:>8.2f}  {p['side']}")
    print()
    print(json.dumps(envelope, indent=2))


if __name__ == "__main__":
    main()
