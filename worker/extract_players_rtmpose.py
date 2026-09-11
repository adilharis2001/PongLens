"""Both players' skeletons over a whole match, for the body-first assembler.

    python extract_players_rtmpose.py --video <file> --output players.json \
        --rect x,y,w,h --corners '{"A_near_1":[x,y],...}' \
        --model <rtmpose end2end.onnx> [--det-model URL|path] \
        [--backend onnxruntime] [--device cpu] [--sample-fps 10] \
        [--start S --end S] [--progress PATH]

Runs in the rtmpose-production venv. Every 1/sample_fps seconds OF
PRESENTATION TIME (not every Nth frame: phone recordings are variable rate
and counting frames drifts by seconds over a match) it crops the window out
of the frame, RTMDet finds the people in it, production's own
`choose_players` names the near and far player from the table corners, and
RTMPose gives each 17 COCO keypoints. Boxes and keypoints are written in
WINDOW pixels and the rect is written into the file, so a reader puts them
back into source pixels without knowing anything else.

Output shape (read by body_features.load_players):
  {"sample_fps": 10, "rect": [x, y, w, h], "video": ..., "device": ...,
   "frames": [{"t": 12.3, "near": {"box": [...], "kp": [[x, y, s], ...]},
               "far": {...}, "all": [[x0, y0, x1, y1], ...]}, ...],
   "samples": N, "both": M}

`all` is every person box the detector found at that sample, which is what
the V3 serve rule reads; `near`/`far` are the two the chooser named.

`--progress PATH` is rewritten every 200 samples with {"t": ..., "of": ...}
so the worker can advance jobs.progress while this runs; a 20-minute silent
stage reads as a dead worker on the processing page.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from extract_side_changes_rtmpose import (        # noqa: E402
    DET_MODEL_URL, _create_det_model, choose_players, dedupe_boxes)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--rect", required=True, help="x,y,w,h in the video's pixels")
    ap.add_argument("--corners", required=True,
                    help="JSON dict of the table corners in the video's pixels (A..D names)")
    ap.add_argument("--model", required=True, help="RTMPose ONNX (end2end.onnx)")
    ap.add_argument("--det-model", default=os.environ.get("DET_MODEL", DET_MODEL_URL))
    ap.add_argument("--backend", default="onnxruntime")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--sample-fps", type=float, default=10.0)
    ap.add_argument("--det-every", type=int, default=2,
                    help="run the person detector on every Nth sample and reuse its "
                         "boxes in between (the lab detected at 6/s and posed at 10/s); "
                         "the pose model still runs on every sample")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--progress", default=None)
    a = ap.parse_args()

    from rtmlib import RTMPose
    # "coreml" is this Mac's GPU. rtmlib builds the session itself and knows
    # nothing about MLProgram, so the tools are built for cpu and the sessions
    # swapped underneath. Anything that fails here degrades to the processor
    # rather than failing the match.
    rtm_device = "cpu" if a.device == "coreml" else a.device
    det = _create_det_model(a.det_model, a.backend, rtm_device)
    pose = RTMPose(onnx_model=a.model, model_input_size=(192, 256),
                   to_openpose=False, backend=a.backend, device=rtm_device)

    def pose_call(img, bb):
        return pose(img, bboxes=bb)          # rtmlib's own one-at-a-time loop

    provider = "cpu"
    if a.device == "coreml":
        try:
            from rtm_accel import accelerate, pose_fixed_batch2
            accelerate(det, pose, cache_dir=os.path.expanduser(
                "~/Library/Caches/PongLens/coreml-cache"))

            def pose_call(img, bb):          # noqa: F811
                return pose_fixed_batch2(pose, img, bb)

            provider = "coreml"
            # Say which provider actually TOOK the nodes. A silent fall back
            # to the processor keeps the answers correct and only shows up in
            # the clock, so it has to be visible in the log.
            print(f"  providers: det={det.session.get_providers()} "
                  f"pose={pose.session.get_providers()}", flush=True)
        except Exception as exc:                               # noqa: BLE001
            print(f"  coreml unavailable ({exc}); falling back to cpu",
                  file=sys.stderr, flush=True)

    x0, y0, w, h = [int(round(float(v))) for v in a.rect.split(",")]
    corners_src = json.loads(a.corners)
    corners = {k: [float(v[0]) - x0, float(v[1]) - y0] for k, v in corners_src.items()}

    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        print(f"cannot open {a.video}", file=sys.stderr)
        return 2
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    total_s = a.end if a.end is not None else (n_frames / fps if n_frames else None)
    step_s = 1.0 / a.sample_fps
    print(f"{a.video}: {fps:.3f} fps, window {x0},{y0} {w}x{h}, sampling every "
          f"{step_s:.2f}s of presentation time from {a.start:.1f}s"
          + (f" to {total_s:.1f}s" if total_s else ""), flush=True)

    frames = []
    next_t = float(a.start)
    last_t = None
    f_index = 0
    samples = 0
    both = 0
    last_boxes = None
    t_start = time.time()
    last_report = 0
    while True:
        if not cap.grab():
            break
        # presentation time of the frame just grabbed; OpenCV reads it from
        # the container, so a variable-rate phone recording keeps its clock
        t_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
        t_pos = (t_ms / 1000.0) if t_ms and t_ms > 0 else None
        # ONE monotonic clock. The container's timestamp when it has one and
        # it moves forward; otherwise one frame period on from the last
        # frame. Mixing the two clocks (index for the frames without a
        # timestamp, container time for the rest) sampled 16 times a second
        # instead of 10 on the first production run.
        if last_t is None:
            t = t_pos if t_pos is not None else 0.0
        elif t_pos is not None and t_pos > last_t:
            t = t_pos
        else:
            t = last_t + 1.0 / fps
        f_index += 1
        last_t = t
        if a.end is not None and t > a.end:
            break
        if t + 1e-6 < next_t:
            continue
        ok, img = cap.retrieve()
        if not ok or img is None:
            continue
        while next_t <= t:
            next_t += step_s
        sub = img[y0:y0 + h, x0:x0 + w]
        rec = {"t": round(float(t), 3)}
        if samples % max(1, a.det_every) == 0 or last_boxes is None:
            try:
                boxes = dedupe_boxes([list(map(float, b)) for b in det(sub)])
            except Exception as exc:                               # noqa: BLE001
                print(f"  detector failed at {t:.1f}s: {exc}", file=sys.stderr)
                boxes = []
            last_boxes = boxes
        else:
            boxes = last_boxes
        if boxes:
            try:
                ch = choose_players(boxes, corners)
            except Exception as exc:                               # noqa: BLE001
                print(f"  chooser failed at {t:.1f}s: {exc}", file=sys.stderr)
                ch = {}
            sides = [s for s in ("near", "far") if ch.get(s)]
            if sides:
                bb = np.asarray([ch[s]["box"] if isinstance(ch[s], dict) else ch[s]
                                 for s in sides], dtype=np.float32)
                kps, scs = pose_call(sub, bb)
                for i, s in enumerate(sides):
                    box = bb[i]
                    rec[s] = {"box": [round(float(v), 1) for v in box],
                              "kp": [[round(float(kps[i][j][0]), 1), round(float(kps[i][j][1]), 1),
                                      round(float(scs[i][j]), 3)] for j in range(kps.shape[1])]}
        # EVERYBODY IN THE WINDOW, not only the two who are playing.
        #
        # The serve rule asks "was the ball inside anyone's box" and "how much
        # of the run-up did a person cover", and in the lab it asked that of
        # every box the detector found, spectators included. Keeping only the
        # chosen pair would answer those questions differently — more
        # permissively — for reasons no reader could reconstruct from the
        # file. Window pixels, like the boxes above.
        if boxes:
            rec["all"] = [[round(float(v), 1) for v in b[:4]] for b in boxes]
        if "near" in rec and "far" in rec:
            both += 1
        frames.append(rec)
        samples += 1
        if samples - last_report >= 200:
            last_report = samples
            elapsed = time.time() - t_start
            print(f"  {t:7.1f}s  {samples} samples, both players in {both}, "
                  f"{elapsed:.0f}s elapsed", flush=True)
            if a.progress:
                try:
                    tmp = a.progress + ".tmp"
                    with open(tmp, "w") as fh:
                        json.dump({"t": round(float(t), 1), "of": total_s,
                                   "samples": samples, "both": both}, fh)
                    os.replace(tmp, a.progress)
                except Exception:                                  # noqa: BLE001
                    pass
    cap.release()
    out = {"sample_fps": a.sample_fps, "rect": [x0, y0, w, h],
           "video": os.path.basename(a.video), "device": a.device,
           # which chip actually produced these skeletons
           "provider": provider,
           "det_model": os.path.basename(str(a.det_model)),
           "frames": frames, "samples": samples, "both": both,
           "keypoints": "COCO-17: nose,l_eye,r_eye,l_ear,r_ear,l_shoulder,r_shoulder,"
                        "l_elbow,r_elbow,l_wrist,r_wrist,l_hip,r_hip,l_knee,r_knee,l_ankle,r_ankle"}
    tmp = a.output + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(out, fh)
    os.replace(tmp, a.output)
    print(f"wrote {a.output}: {samples} samples, both players in {both} "
          f"({(both / samples if samples else 0):.0%}), {time.time() - t_start:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
