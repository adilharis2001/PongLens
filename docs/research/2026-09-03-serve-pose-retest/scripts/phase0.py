"""Phase 0: does the crop that already ships contain the players?

Free — reuses the RTMDet person boxes already computed for the three
matches. If the players fall inside production's crop, then "crop for the
ball" and "crop that keeps both players" are the same box and there is no
arm C to build.

Reported per match:
  the crop production would cut (ball_crop_box, the shipped function)
  the smallest box containing the table AND both players' full bodies
  each as a share of the frame, and what each does to the ball's size
  after the detector's 512x288 resize
"""
import json
import os
import sys

import numpy as np

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
from points_endon import ball_crop_box                            # noqa: E402

DET_W = 512.0            # the detector's own input width


def union(boxes):
    a = np.asarray(boxes, float)
    return [a[:, 0].min(), a[:, 1].min(), a[:, 2].max(), a[:, 3].max()]


def main():
    names = {"89b35ee0": "Yu Yu Lin (Westchester, 3 tables)",
             "77fc4dee": "Lester (Pingpod booth)",
             "98a9c15c": "PingPod W37"}
    for short, label in names.items():
        path = f"{HERE}/real_boxes_{short}.json"
        if not os.path.exists(path):
            continue
        B = json.load(open(path))
        first = next(iter(B.values()))
        W, H = first["w"], first["h"]
        corners = {k: v for k, v in first["corners"].items()}
        crop = ball_crop_box(corners, W, H)
        # every confidently chosen player box, over every analysed frame
        near, far, both = [], [], []
        for c in B.values():
            for f in c["frames"].values():
                if f.get("near"):
                    near.append(f["near"])
                if f.get("far"):
                    far.append(f["far"])
                if f.get("near") and f.get("far"):
                    both.append(f["near"]); both.append(f["far"])
        quad = np.asarray([corners[k] for k in sorted(corners)], float)
        tbox = [quad[:, 0].min(), quad[:, 1].min(), quad[:, 0].max(), quad[:, 1].max()]
        players = union(both) if both else None
        want = union([tbox, players]) if players is not None else tbox

        def share(b):
            return (b[2] - b[0]) * (b[3] - b[1]) / (W * H) * 100

        def gain(bw):
            return (DET_W / bw) / (DET_W / W)

        print(f"\n=== {label}   frame {W}x{H}, {len(B)} cards")
        if crop:
            cx, cy, cw, chh = crop
            cb = [cx, cy, cx + cw, cy + chh]
            print(f"  production's ball crop : {cw:.0f}x{chh:.0f} "
                  f"= {share(cb):.0f}% of frame,  ball {gain(cw):.1f}x bigger")
        else:
            cb = None
            print("  production's ball crop : none (would not crop)")
        print(f"  table bounding box     : {tbox[2]-tbox[0]:.0f}x{tbox[3]-tbox[1]:.0f} "
              f"= {share(tbox):.0f}% of frame")
        if players is not None:
            print(f"  table + BOTH players   : {want[2]-want[0]:.0f}x{want[3]-want[1]:.0f} "
                  f"= {share(want):.0f}% of frame,  ball {gain(want[2]-want[0]):.1f}x bigger")
            if cb:
                inside = (want[0] >= cb[0] - 1 and want[1] >= cb[1] - 1
                          and want[2] <= cb[2] + 1 and want[3] <= cb[3] + 1)
                print(f"  do the players fit inside production's crop?  "
                      f"{'YES — arm B and arm C are the same box' if inside else 'NO'}")
                if not inside:
                    print(f"     needs {max(0, cb[0]-want[0]):.0f}px more left, "
                          f"{max(0, want[2]-cb[2]):.0f} right, "
                          f"{max(0, cb[1]-want[1]):.0f} top, "
                          f"{max(0, want[3]-cb[3]):.0f} bottom")
            # how often does each player sit outside the shipped crop?
            if cb:
                out = sum(1 for b in both
                          if b[0] < cb[0] or b[1] < cb[1] or b[2] > cb[2] or b[3] > cb[3])
                print(f"  player boxes falling outside the shipped crop: "
                      f"{out}/{len(both)} = {out/len(both)*100:.0f}%")


if __name__ == "__main__":
    main()
