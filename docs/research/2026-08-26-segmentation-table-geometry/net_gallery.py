"""Draw the geometry-derived net on real frames, one per match.

    venv/bin/python net_gallery.py --tag full_v1

The net needs no detector once the corners are known: it crosses the
table halfway along the 2.740 m sides, and the post feet stand 0.1525 m
outside the sidelines on that same line — all of it is one homography
from the model rectangle. This gallery is the validation: the drawn line
either sits on the visible net base in every venue or it does not.

The quad must be in canonical A,B,C,D order for "halfway along the
sides" to mean the real sides. Consensus quads are cyclic with arbitrary
start, so each is aligned to the hand truth first (the same alignment the
scorer uses). A production version would get the order from net
disambiguation or Zhang-He aspect recovery instead — see FINDINGS.md.
"""

from __future__ import annotations

import argparse
import json
import os

import cv2
import numpy as np

import common
from consensus import align


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="full_v1")
    args = ap.parse_args()
    out_dir = os.path.join(common.WORK, "out", args.tag)
    rows = json.load(open(os.path.join(out_dir, "consensus.json")))
    corpus = common.load_corpus()
    gallery = os.path.join(out_dir, "net_gallery")
    os.makedirs(gallery, exist_ok=True)

    made = 0
    for row in rows:
        if row.get("consensus_quad") is None:
            continue
        item = corpus[row["match"]]
        quad, _ = align(np.array(row["consensus_quad"]), item["truth"])
        frame = cv2.imread(item["frames"][len(item["frames"]) // 3])
        net = common.net_line_from_quad(quad)
        common.draw_quad(frame, quad, (0, 80, 255), 2, names=False)
        l = tuple(np.round(net["left"]).astype(int))
        r = tuple(np.round(net["right"]).astype(int))
        cv2.line(frame, l, r, (0, 255, 255), 2, cv2.LINE_AA)
        for k in ("post_left_foot", "post_right_foot"):
            p = tuple(np.round(net[k]).astype(int))
            cv2.circle(frame, p, 7, (0, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(frame, f"{row['match'][:8]} {row['venue']} "
                    f"cons {row['consensus']}%", (12, 36),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        cv2.imwrite(os.path.join(gallery, f"{row['match'][:8]}.jpg"),
                    frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        made += 1
    print(f"{made} net overlays in {gallery}")


if __name__ == "__main__":
    main()
