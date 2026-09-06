"""Stage 2 of the pose retest: the July detector, on v2 boxes.

Runs in the July MMPose venv, against the identical checkpoint the July run
used (sha256 929f00f2...), on the identical cached clips, scored against the
identical truth. The only thing that differs is that the pose boxes come
from stage 1's person detection instead of from
`build_player_regions`'s two half-the-room boxes.

Arm A reproduces July's Stage A exactly: the window is anchored on the
owner's own labelled first bounce, so any change is attributable to the
boxes and nothing else. July scored 94.1% precision at 40.5% coverage
there, and the 22 cases it could not call came back
`service_motion_absent_or_ambiguous` — which is what a top-down pose model
locked onto a wall would produce, and equally what a genuinely occluded
contact would produce. This arm is what separates those.
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
sys.path.insert(0, WORKER)

from extract_service_motion_rtmpose import (                    # noqa: E402
    _player_summary, create_pose_model,
)
from service_motion import analyze_service_motion               # noqa: E402

ROOT = Path("/Users/adil/Library/Caches/PongLens/service-motion-rtmpose")
CONFIG = (ROOT / "source/mmpose-1.3.2/configs/body_2d_keypoint/rtmpose/coco/"
          "rtmpose-m_8xb256-420e_coco-256x192.py")
CHECKPOINT = ROOT / "model.pth"
LOOKBACK_S, LOOKAHEAD_S = 1.2, 0.1


def pose_window(video_path, cache, frames_wanted, pose_model, policy):
    """{frame: {"near": summary, "far": summary}} using stage 1's boxes."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video_path}")
    out, missing = {}, 0
    try:
        for f in frames_wanted:
            entry = cache["frames"].get(str(f))
            if not entry:
                continue
            sides, boxes = [], []
            for side in ("near", "far"):
                box = entry.get(side)
                if box is None and policy == "proposed":
                    box = entry.get(f"{side}_proposed")
                if box is not None:
                    sides.append(side)
                    boxes.append(list(box))
            if not boxes:
                missing += 1
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ok, img = cap.read()
            if not ok or img is None:
                continue
            kps, scores = pose_model(img, boxes)
            if len(kps) != len(boxes):
                continue
            out[f] = {
                side: _player_summary(box, np.asarray(kps[i]),
                                      np.asarray(scores[i]))
                for i, (side, box) in enumerate(zip(sides, boxes))
            }
            for i, side in enumerate(sides):
                out[f][side]["keypoints"] = [
                    [round(float(x), 1), round(float(y), 1), round(float(s_), 3)]
                    for (x, y), s_ in zip(np.asarray(kps[i]).tolist(),
                                          np.asarray(scores[i]).tolist())]
    finally:
        cap.release()
    return out, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--policy", default="confident",
                    choices=["confident", "proposed"])
    ap.add_argument("--only", default=None,
                    help="restrict to one stratum, e.g. visible")
    args = ap.parse_args()

    boxes = json.load(open(args.boxes))
    report = Path("/Users/adil/Desktop/PongLens-Reports/"
                  "service-motion-holdout-scored-20260730/results.json")
    cases = {c["source_id"]: c for c in json.load(open(report))["cases"]}

    pose_model = create_pose_model(CONFIG, CHECKPOINT, device="mps")
    results = {}
    for n, (sid, cache) in enumerate(sorted(boxes.items()), 1):
        if "error" in cache:
            continue
        if args.only and cache["stratum"] != args.only:
            continue
        fb = cache.get("first_bounce_t")
        if fb is None:
            results[sid] = {"status": "no_label", "stratum": cache["stratum"]}
            continue
        fps = cache["fps"]
        lo = max(0, int((fb - LOOKBACK_S) * fps))
        hi = int((fb + LOOKAHEAD_S) * fps)
        wanted = [int(f) for f in cache["frames"] if lo <= int(f) <= hi]
        poses, missing = pose_window(cache["media_path"], cache,
                                     sorted(wanted), pose_model, args.policy)
        di = cases[sid]["detector_input"]
        detections = {int(k): tuple(v)
                      for k, v in (di.get("detections") or {}).items()}
        try:
            r = analyze_service_motion(
                detections=detections, poses=poses, fps=fps,
                first_bounce_t=fb,
                audio_candidates=di.get("audio_candidates") or [])
        except Exception as e:                                  # noqa: BLE001
            r = {"status": "error", "reason": str(e), "side": None}
        july = cases[sid]["oracle_motion"]
        results[sid] = {
            "stratum": cache["stratum"], "truth": cache["truth"],
            "posed_frames": len(poses), "frames_without_boxes": missing,
            "keypoints": {str(f): {sd: p.get("keypoints")
                                   for sd, p in v.items()}
                          for f, v in poses.items()},
            "v2": {"status": r.get("status"), "side": r.get("side"),
                   "reason": r.get("reason"),
                   "confidence": r.get("confidence"),
                   "onset_t": r.get("onset_t"),
                   "contact_t": r.get("contact_t")},
            "july": {"status": july.get("status"), "side": july.get("side"),
                     "reason": july.get("reason"),
                     "confidence": july.get("confidence"),
                     "contact_t": july.get("contact_t")},
        }
        v = results[sid]
        print(f"[{n}] {sid[:8]} {v['stratum']:18s} truth={v['truth']:4s}  "
              f"july={str(v['july']['status'])[:14]:14s}/{str(v['july']['side']):4s}  "
              f"v2={str(v['v2']['status'])[:14]:14s}/{str(v['v2']['side']):4s}  "
              f"({len(poses)} frames posed)")
    json.dump(results, open(args.out, "w"), indent=1)
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
