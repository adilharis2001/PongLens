"""One frame per case, with the corrected quad and every person drawn.

Cheap check before spending another detection pass: does the quad land on
the table, and does choose_players pick the two people playing?
"""
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_side_changes_rtmpose import (DET_INPUT_SIZE, choose_players,   # noqa: E402
                                          dedupe_boxes)
from corners import resolve                                     # noqa: E402

REPORT = Path("/Users/adil/Desktop/PongLens-Reports/"
              "service-motion-holdout-scored-20260730")
HERE = Path(os.path.dirname(os.path.abspath(__file__)))
COL = {"CHOSEN as the near player": (80, 240, 80),
       "CHOSEN as the far player": (240, 180, 60)}


def main(outdir, limit=8):
    outdir = Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    prod = json.load(open(HERE / "prod_calib.json"))
    cases = json.load(open(REPORT / "results.json"))["cases"]
    from rtmlib import RTMDet
    det = RTMDet(onnx_model=os.environ["DET_MODEL"],
                 model_input_size=DET_INPUT_SIZE,
                 backend="onnxruntime", device="cpu")
    done = 0
    seen_match = set()
    for case in cases:
        mid = case["source_match_id"]
        if mid in seen_match:
            continue                      # one frame per match is enough
        seen_match.add(mid)
        di, ev = case["detector_input"], case["evaluation"]
        v = di["video"]; cw, ch = int(v["width"]), int(v["height"])
        p = prod.get(mid)
        if not p:
            continue
        src = p["source"]
        corners = resolve(p["corners"], p.get("size"),
                          [src["width"], src["height"]], [cw, ch])
        fb = (ev.get("first_bounce") or {}).get("time_s") or 1.0
        cap = cv2.VideoCapture(str(di["media_path"]))
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fb * float(v["fps"])))
        ok, img = cap.read(); cap.release()
        if not ok:
            continue
        boxes = dedupe_boxes([list(map(float, b)) for b in det(img)])
        ch_ = choose_players(boxes, corners)
        quad = np.array([corners[k] for k in sorted(corners)], np.int32)
        cv2.polylines(img, [quad], True, (255, 220, 80), 2)
        for k, xy in corners.items():
            cv2.putText(img, k[0], (int(xy[0]) + 3, int(xy[1]) - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 220, 80), 1)
        for person in (ch_.get("boxes") or []):
            b = [int(x) for x in person["box"]]
            verdict = person.get("verdict") or ""
            colour = COL.get(verdict, (110, 110, 110))
            cv2.rectangle(img, (b[0], b[1]), (b[2], b[3]), colour, 2)
            cv2.putText(img, verdict[:26], (b[0], max(12, b[1] - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, colour, 1)
        tag = f"{p.get('src_name') or 'pink-rim'}  near={'Y' if ch_.get('near') else 'n'} far={'Y' if ch_.get('far') else 'n'}"
        cv2.putText(img, tag, (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (255, 255, 255), 1)
        out = outdir / f"{di['match_key']}-{case['source_id'][:8]}.png"
        cv2.imwrite(str(out), img)
        print(f"{di['match_key']:9s} {case['source_id'][:8]} people={len(boxes)} "
              f"near={bool(ch_.get('near'))} far={bool(ch_.get('far'))} -> {out.name}")
        done += 1
        if done >= int(limit):
            break


if __name__ == "__main__":
    main(*sys.argv[1:])
