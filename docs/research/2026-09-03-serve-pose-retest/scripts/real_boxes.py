"""Person boxes for the real-match test, per point clip.

Two arms, and the second is the one that matters:

  ANCHORED   the card carries a serve mark, so the window is the 2 s ending
             just after the serve's first bounce. This measures whether pose
             can name the server when it already knows where to look.
  UNANCHORED the card has NO serve mark — the ball rule gave up. The window
             is the first 4.5 s of the clip, because the assembler opens a
             card shortly before the serve whether or not it found one.
             These are the cards a pose signal would have to rescue, and
             nothing has ever been measured on them.
"""
import json
import os
import sys
from pathlib import Path

import cv2

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, HERE)

from corners import resolve as resolve_corners                   # noqa: E402
from extract_side_changes_rtmpose import (DET_INPUT_SIZE,        # noqa: E402
                                          choose_players, dedupe_boxes)

CONTACT_LOOKBACK_S = 0.81      # points_v2: contact = first bounce - K
SAMPLE_FPS = 15.0
ANCHORED = (-1.6, 0.4)         # around the first bounce
UNANCHORED = (0.3, 4.8)        # from the clip's own start


def main(mid, out_path):
    calib = json.load(open(f"{HERE}/real_calib.json"))[mid]
    truth = json.load(open(f"{HERE}/truth.json"))
    pts = json.load(open(f"{HERE}/real_points.json"))["points"]
    rows = [r for r in pts if r["match_id"] == mid and not r["deleted"]]
    src = calib["source"]
    from rtmlib import RTMDet
    det = RTMDet(onnx_model=os.environ["DET_MODEL"],
                 model_input_size=DET_INPUT_SIZE,
                 backend="onnxruntime", device="cpu")
    out = {}
    for n, r in enumerate(sorted(rows, key=lambda x: x["idx"]), 1):
        clip = Path(f"{HERE}/real/clips/{mid[:8]}/{r['idx']}.mp4")
        if not clip.exists():
            continue
        mp = calib["points"].get(str(r["idx"])) or {}
        cap = cv2.VideoCapture(str(clip))
        if not cap.isOpened():
            continue
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        nframes = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        corners = resolve_corners(calib["corners"], calib.get("size"),
                                  [src["width"], src["height"]], [w, h])
        serve_s, clip_t0 = mp.get("serve_s"), mp.get("clip_t0")
        if serve_s is not None and clip_t0 is not None:
            fb_local = (float(serve_s) + CONTACT_LOOKBACK_S) - float(clip_t0)
            lo_s, hi_s = fb_local + ANCHORED[0], fb_local + ANCHORED[1]
            arm = "anchored"
        else:
            fb_local = None
            lo_s, hi_s = UNANCHORED
            arm = "unanchored"
        step = max(1, int(round(fps / SAMPLE_FPS)))
        lo = max(0, int(lo_s * fps))
        hi = min(nframes - 1, int(hi_s * fps))
        frames, filled = {}, 0
        for f in range(lo, hi + 1, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, img = cap.read()
            if not ok or img is None:
                continue
            boxes = dedupe_boxes([list(map(float, b)) for b in det(img)])
            ch = choose_players(boxes, corners)
            frames[str(f)] = {
                "t": round(f / fps, 3),
                "near": ch.get("near"), "far": ch.get("far"),
                "near_proposed": ch.get("near_proposed"),
                "far_proposed": ch.get("far_proposed"),
                "people": [{"box": [round(x, 1) for x in p["box"]],
                            "verdict": p.get("verdict")}
                           for p in (ch.get("boxes") or [])],
            }
            filled += bool(ch.get("near")) + bool(ch.get("far"))
        cap.release()
        t = truth.get(r["id"]) or {}
        out[r["id"]] = {
            "idx": r["idx"], "arm": arm, "fb_local": fb_local,
            "clip": str(clip), "fps": fps, "w": w, "h": h,
            "corners": corners, "truth": t.get("side"),
            "scored": t.get("scored"), "is_let": t.get("is_let"),
            "frames": frames,
        }
        print(f"[{n}/{len(rows)}] idx {r['idx']:3d} {arm:10s} truth={t.get('side')} "
              f"{len(frames):3d} frames, {filled} boxes", flush=True)
    json.dump(out, open(out_path, "w"))
    print("wrote", out_path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
