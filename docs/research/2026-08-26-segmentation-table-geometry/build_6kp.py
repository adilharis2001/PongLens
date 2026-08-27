"""Turn the 4-corner truth into a 6-keypoint dataset, for free.

    venv/bin/python build_6kp.py [--out ~/ponglens-data/table-6kp]

The long-term proposal is a model predicting four table corners plus two
net posts. The obvious objection is that nobody has marked net posts on
anything, so the labels would have to be hand-made all over again.

They do not. A regulation table is a known rectangle and the net crosses
it halfway along the 2.740 m sides, with the posts standing 0.1525 m
outside each sideline. So the two net-post FEET are an exact projective
function of the four corners that are already marked — the same
homography the app uses for placement. Every one of the 61 hand-marked
matches becomes a 6-keypoint label with no new marking.

What this cannot manufacture is the post TOPS (0.1525 m above the plane),
which need a camera pose rather than a plane homography. Feet are what a
corner model would want anyway: they are on the table plane, so they
constrain the same homography the corners do.

Writes labels_6kp.json alongside a sample of drawn overlays so the
derived points can be eyeballed before anyone trains on them.
"""

from __future__ import annotations

import argparse
import json
import os

import cv2
import numpy as np

import common

KEYPOINTS = ["A_near_left", "B_near_right", "C_far_right", "D_far_left",
             "net_post_left_foot", "net_post_right_foot"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.expanduser(
        "~/ponglens-data/table-6kp"))
    ap.add_argument("--overlays", type=int, default=12)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    overlay_dir = os.path.join(args.out, "overlays")
    os.makedirs(overlay_dir, exist_ok=True)

    corpus = common.load_corpus()
    labels, drawn = {}, 0
    for match, item in sorted(corpus.items()):
        truth = item["truth"]
        net = common.net_line_from_quad(truth)
        pts = np.vstack([truth,
                         net["post_left_foot"],
                         net["post_right_foot"]])
        inside = bool(
            (pts[:, 0] > -0.1 * item["width"]).all()
            and (pts[:, 0] < 1.1 * item["width"]).all()
            and (pts[:, 1] > -0.1 * item["height"]).all()
            and (pts[:, 1] < 1.1 * item["height"]).all())
        labels[match] = {
            "venue": item["venue"],
            "sourceWidth": item["width"],
            "sourceHeight": item["height"],
            "keypoints": {name: [float(x), float(y)]
                          for name, (x, y) in zip(KEYPOINTS, pts)},
            "frames": len(item["frames"]),
            "allPointsInFrame": inside,
            "derivedFrom": "corrected_corners + table homography",
        }
        if drawn < args.overlays:
            frame = cv2.imread(item["frames"][len(item["frames"]) // 3])
            common.draw_quad(frame, truth, (60, 220, 60), 2, names=False)
            l = tuple(np.round(net["left"]).astype(int))
            r = tuple(np.round(net["right"]).astype(int))
            cv2.line(frame, l, r, (0, 255, 255), 2, cv2.LINE_AA)
            for name, p in zip(KEYPOINTS, pts):
                q = tuple(np.round(p).astype(int))
                colour = ((0, 255, 255) if "post" in name
                          else (60, 220, 60))
                cv2.circle(frame, q, 8, colour, -1, cv2.LINE_AA)
            cv2.putText(frame, f"{match[:8]} {item['venue']}", (12, 36),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            cv2.imwrite(os.path.join(overlay_dir, f"{match[:8]}.jpg"),
                        frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            drawn += 1

    path = os.path.join(args.out, "labels_6kp.json")
    with open(path, "w") as f:
        json.dump(labels, f, indent=1)

    total_frames = sum(v["frames"] for v in labels.values())
    outside = [m for m, v in labels.items() if not v["allPointsInFrame"]]
    print(f"{len(labels)} matches -> {path}")
    print(f"{total_frames} labelled frames available "
          f"(the camera is static, so one label serves every frame)")
    print(f"post feet inside the picture: "
          f"{len(labels) - len(outside)}/{len(labels)}")
    for m in outside:
        print(f"  outside: {m[:8]} {labels[m]['venue']}")
    print(f"{drawn} overlays in {overlay_dir}")


if __name__ == "__main__":
    main()
