"""Manifest for the Swift lock harness: frame, focal, truth corners."""

import json
import math
import os
import sys

sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import mine_record_poses as m  # noqa: E402

import numpy as np  # noqa: E402

SCRATCH = os.path.dirname(os.path.abspath(__file__))


def focal_and_pose(corners, w, h):
    image = np.asarray(corners, dtype=np.float64)
    H = m.homography(m.WORLD_CORNERS, image)
    best = None
    for focal in m.focal_candidates(H, w / 2.0, h / 2.0):
        centre = m.camera_centre(H, focal, w / 2.0, h / 2.0)
        if centre is None:
            continue
        x, y, z = (float(v) for v in centre)
        if not (0.3 < z < 6.0 and x < m.NEAR_X and abs(y) < 12.0):
            continue
        if best is None or z < best[1][2]:
            best = (focal, (x, y, z))
    return best


rows = m.fetch_rows()
out = []
for match_id, corners, w, h, verdict, placement, venue, dup in rows:
    if verdict in ("no_table", "unusable"):
        continue
    # Truth corners arrive in SOURCE pixels; frames on disk are the
    # pipeline's working size. The review row stores both sizes, but the
    # miner's fetch doesn't carry them — recover scale from the frame file
    # dimensions handled Swift-side instead: emit source-px corners plus
    # the source dims implied by the focal solve.
    best = focal_and_pose(corners, w, h)
    if best is None:
        continue
    focal, pose = best
    frame = os.path.join(SCRATCH, "frames", f"{match_id}.jpg")
    if not os.path.exists(frame):
        continue
    out.append({
        "match": str(match_id), "frame": frame, "venue": venue,
        "sourceWidth": w, "sourceHeight": h,
        "focal": focal, "corners": corners,
        "pose": {"x": pose[0], "y": pose[1], "z": pose[2]},
    })

path = os.path.join(SCRATCH, "lock_manifest.json")
with open(path, "w") as f:
    json.dump(out, f)
print(f"{len(out)} rows -> {path}")
