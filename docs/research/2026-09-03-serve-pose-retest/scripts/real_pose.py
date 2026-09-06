"""Pose + service-motion on real matches, both arms, scored on the rotation.

ANCHORED cards get the July treatment: one call with the first bounce the
ball rule already found. UNANCHORED cards have no such mark, so the analyzer
is asked repeatedly across the front of the clip and the most confident
answer is kept — which is the only way a pose signal could ever rescue a
card the ball rule gave up on, and is what nobody has measured.

Ball detections come from the match's own evidence bundle, converted from
source seconds/pixels into the clip's. Without them the analyzer loses its
ball-departure and wrist-proximity features, which would understate pose
rather than test it.
"""
import argparse
import glob
import json
import os
import sys

import cv2
import numpy as np

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, HERE)

from extract_service_motion_rtmpose import (_player_summary,     # noqa: E402
                                            create_pose_model)
from service_motion import analyze_service_motion                # noqa: E402
from pathlib import Path                                          # noqa: E402

ROOT = Path("/Users/adil/Library/Caches/PongLens/service-motion-rtmpose")
CONFIG = (ROOT / "source/mmpose-1.3.2/configs/body_2d_keypoint/rtmpose/coco/"
          "rtmpose-m_8xb256-420e_coco-256x192.py")
CHECKPOINT = ROOT / "model.pth"
SCAN_FROM, SCAN_TO, SCAN_STEP = 1.2, 4.4, 0.2


def ball_for_clip(bundle, clip_t0, clip_w, src_w, fps, span):
    """Source-clock track -> {clip_frame: (x, y)} in clip pixels."""
    if not bundle:
        return {}
    k = clip_w / float(src_w)
    out = {}
    for t, x, y in bundle["track"]:
        local = float(t) - float(clip_t0)
        if not (span[0] - 1.0 <= local <= span[1] + 1.0):
            continue
        out[int(round(local * fps))] = (float(x) * k, float(y) * k)
    return out


def pose_frames(clip, cache, pose_model, policy="confident"):
    cap = cv2.VideoCapture(clip)
    out, kp = {}, {}
    try:
        for f_s, entry in sorted(cache["frames"].items(), key=lambda kv: int(kv[0])):
            sides, boxes = [], []
            for side in ("near", "far"):
                box = entry.get(side)
                if box is None and policy == "proposed":
                    box = entry.get(f"{side}_proposed")
                if box is not None:
                    sides.append(side)
                    boxes.append(list(box))
            if not boxes:
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(f_s))
            ok, img = cap.read()
            if not ok or img is None:
                continue
            k, s = pose_model(img, boxes)
            if len(k) != len(boxes):
                continue
            f = int(f_s)
            out[f] = {sd: _player_summary(b, np.asarray(k[i]), np.asarray(s[i]))
                      for i, (sd, b) in enumerate(zip(sides, boxes))}
            kp[f] = {sd: [[round(float(x), 1), round(float(y), 1), round(float(sc), 3)]
                          for (x, y), sc in zip(np.asarray(k[i]).tolist(),
                                                np.asarray(s[i]).tolist())]
                     for i, sd in enumerate(sides)}
    finally:
        cap.release()
    return out, kp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--match", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--policy", default="confident")
    args = ap.parse_args()

    cache = json.load(open(args.boxes))
    calib = json.load(open(f"{HERE}/real_calib.json"))[args.match]
    src_w = calib["source"]["width"]
    bundle = None
    for p in glob.glob(f"{HERE}/../servemiss/bundles/crossings/{args.match}.json"):
        bundle = json.load(open(p))
    if bundle is None:
        print("!! no evidence bundle; running without ball detections")

    pose_model = create_pose_model(CONFIG, CHECKPOINT, device="mps")
    results = {}
    for n, (pid, c) in enumerate(sorted(cache.items(), key=lambda kv: kv[1]["idx"]), 1):
        mp = calib["points"].get(str(c["idx"])) or {}
        poses, kp = pose_frames(c["clip"], c, pose_model, args.policy)
        span = (min((v["t"] for v in c["frames"].values()), default=0.0),
                max((v["t"] for v in c["frames"].values()), default=5.0))
        det = ball_for_clip(bundle, mp.get("clip_t0") or 0.0, c["w"], src_w,
                            c["fps"], span)
        best, tried = None, []
        if c["arm"] == "anchored":
            cands = [c["fb_local"]]
        else:
            cands = [SCAN_FROM + i * SCAN_STEP
                     for i in range(int((SCAN_TO - SCAN_FROM) / SCAN_STEP) + 1)]
        for fb in cands:
            try:
                r = analyze_service_motion(detections=det, poses=poses,
                                           fps=c["fps"], first_bounce_t=fb,
                                           audio_candidates=[])
            except Exception:
                continue
            tried.append({"fb": round(fb, 2), "status": r.get("status"),
                          "side": r.get("side"),
                          "confidence": r.get("confidence")})
            if r.get("status") == "high_confidence":
                if best is None or (r.get("confidence") or 0) > (best.get("confidence") or 0):
                    best = {"fb": round(fb, 2), **{k: r.get(k) for k in
                            ("status", "side", "confidence", "reason", "onset_t", "contact_t")}}
        if best is None:
            last = tried[-1] if tried else {}
            best = {"status": last.get("status") or "no_result",
                    "side": None, "confidence": 0.0,
                    "reason": "no confident window"}
        results[pid] = {
            "idx": c["idx"], "arm": c["arm"], "truth": c["truth"],
            "scored": c["scored"], "posed_frames": len(poses),
            "windows_tried": len(tried), "best": best, "keypoints": kp,
        }
        ok = "-" if best["side"] is None else ("RIGHT" if best["side"] == c["truth"] else "WRONG")
        print(f"[{n}/{len(cache)}] idx {c['idx']:3d} {c['arm']:10s} "
              f"truth={str(c['truth']):4s} -> {str(best['side']):4s} {ok:5s} "
              f"({len(poses)} frames, {len(tried)} windows)", flush=True)
    json.dump(results, open(args.out, "w"))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
