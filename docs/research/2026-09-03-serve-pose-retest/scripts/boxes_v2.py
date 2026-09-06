"""Stage 1 of the pose retest: v2 person boxes for the July 42.

Runs in the rtmpose-production venv (rtmlib + onnxruntime), because that is
where the RTMDet person detector lives. Writes a per-frame box cache that
stage 2 reads from the July MMPose venv, so the two runtimes never have to
be merged and the ONLY thing that changes between the July run and this one
is where the pose boxes come from.

July derived them from table geometry alone: two boxes, each 52% of the
frame's width by 85% of its height, centred beyond each end of the table
(`build_player_regions`). Half the room per box. A top-down pose model
always returns a pose for whatever box it is given, so on side-on footage
the far box — mostly table and back wall — returned poses of televisions
and posters. That was measured on 2026-08-26 and is why the side-change
work replaced it.

v2, reused here verbatim from `extract_side_changes_rtmpose.choose_players`:
detect actual people, keep those within 1.1x their own height of the table
quad, take the biggest as NEAR and the biggest one whose box overlaps the
table as FAR. Measured 92% / 74% against 144 hand-labelled frames.
"""
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
sys.path.insert(0, WORKER)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from corners import resolve as resolve_corners
from extract_side_changes_rtmpose import (                      # noqa: E402
    DET_INPUT_SIZE, choose_players, dedupe_boxes,
)

REPORT = Path("/Users/adil/Desktop/PongLens-Reports/"
              "service-motion-holdout-scored-20260730")
SAMPLE_FPS = 15.0


PROD = json.load(open(Path(os.path.dirname(os.path.abspath(__file__))) / "prod_calib.json"))


def main():
    from rtmlib import RTMDet
    cases = json.load(open(REPORT / "results.json"))["cases"]
    det = RTMDet(onnx_model=os.environ["DET_MODEL"],
                 model_input_size=DET_INPUT_SIZE,
                 backend="onnxruntime", device="cpu")
    out = {}
    for n, case in enumerate(cases, 1):
        di = case["detector_input"]
        video = di["video"]
        w, h, fps = int(video["width"]), int(video["height"]), float(video["fps"])
        frames = int(video["frame_count"])
        p = PROD.get(case["source_match_id"])
        corners = None if not p else resolve_corners(
            p["corners"], p.get("size"),
            [p["source"]["width"], p["source"]["height"]], [w, h])
        if not corners:
            out[case["source_id"]] = {"error": "no usable calibration"}
            print(f"[{n}/{len(cases)}] {case['source_id'][:8]} SKIP no calibration")
            continue
        step = max(1, int(round(fps / SAMPLE_FPS)))
        want = list(range(0, frames, step))
        cap = cv2.VideoCapture(str(di["media_path"]))
        if not cap.isOpened():
            out[case["source_id"]] = {"error": "cannot open clip"}
            continue
        per_frame, found = {}, 0
        for f in want:
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, img = cap.read()
            if not ok or img is None:
                continue
            boxes = dedupe_boxes([list(map(float, b)) for b in det(img)])
            chosen = choose_players(boxes, corners)
            # `near`/`far` are the confident picks; `*_proposed` is the pick
            # the rule would have made before the ambiguity guard refused it.
            # Both are kept so stage 2 can measure either policy without a
            # second detection pass.
            near, far = chosen.get("near"), chosen.get("far")
            per_frame[str(f)] = {
                "near": None if near is None else [round(float(v), 1) for v in near],
                "far": None if far is None else [round(float(v), 1) for v in far],
                "near_proposed": [round(float(v), 1) for v in chosen["near_proposed"]]
                                 if chosen.get("near_proposed") else None,
                "far_proposed": [round(float(v), 1) for v in chosen["far_proposed"]]
                                if chosen.get("far_proposed") else None,
                "n_people": len(boxes),
                "near_ambiguous": chosen.get("near_ambiguous"),
                "far_ambiguous": chosen.get("far_ambiguous"),
            }
            found += (near is not None) + (far is not None)
        cap.release()
        out[case["source_id"]] = {
            "fps": fps, "width": w, "height": h, "frame_count": frames,
            "step": step, "frames": per_frame,
            "media_path": di["media_path"],
            "calib_rung": (p.get("src_name") or "pink-rim (retired)"),
            "first_bounce_t": (case["evaluation"].get("first_bounce") or {}).get("time_s"),
            "first_bounce_status": (case["evaluation"].get("first_bounce") or {}).get("status"),
            "truth": case["evaluation"].get("scored_server_side"),
            "stratum": case["stratum"],
        }
        print(f"[{n}/{len(cases)}] {case['source_id'][:8]} {case['stratum']:18s} "
              f"{len(per_frame):4d} frames, {found} player boxes "
              f"({found/max(1,2*len(per_frame))*100:.0f}% of slots filled)")
    json.dump(out, open(sys.argv[1], "w"))
    print(f"\nwrote {sys.argv[1]}")


if __name__ == "__main__":
    main()
