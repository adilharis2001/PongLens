#!/usr/bin/env python3
"""Privacy blur for demo VIDEO clips — people and venue branding.

    scripts/demos/venv-blur/bin/python scripts/demos/blur_video.py in.mp4 [out.mp4]

The video counterpart of blur.py, sharing its detectors and guards.
Detection runs per frame, but each frame blurs the UNION of boxes from a
sliding window around it, so a detector missing one frame (or a box
jittering) never makes the blur flicker — the cost is a slightly larger
blurred region at motion edges, which is fine for privacy.

  * people: YOLOv8n on every frame, union over +/-PERSON_WIN frames;
  * neon sign / booking TV: template matching (same templates and
    variance/pink guards as blur.py) sampled every TMPL_STEP frames,
    union over +/-TMPL_WIN frames.

Output is h264 yuv420p via ffmpeg, ready for the web. Default output:
<input stem>-blur.mp4 beside the input.
"""

import subprocess
import sys
from pathlib import Path

import cv2
from ultralytics import YOLO

from blur import ASSETS, TEMPLATES, PERSON_CONF, blur_box, template_boxes

PERSON_WIN = 3   # frames of person-box union on each side
TMPL_STEP = 5    # run template matching every Nth frame
TMPL_WIN = 10    # frames of template-box union on each side


def union_window(per_frame, i, win):
    boxes = []
    for j in range(max(0, i - win), min(len(per_frame), i + win + 1)):
        boxes.extend(per_frame[j])
    return boxes


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_name(
        f"{src.stem}-blur.mp4")

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        sys.exit(f"cannot open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    model = YOLO("yolov8n.pt")
    templates = [
        cv2.cvtColor(cv2.imread(str(ASSETS / t)), cv2.COLOR_BGR2GRAY)
        for t in TEMPLATES
    ]

    # pass 1 — detect
    persons, marks = [], []
    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        r = model(frame, classes=[0], conf=PERSON_CONF, verbose=False)[0]
        persons.append(
            [tuple(b) for b in r.boxes.xyxy.cpu().numpy().astype(int)])
        if n % TMPL_STEP == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            found = []
            for tmpl in templates:
                found.extend(
                    (x1, y1, x2, y2)
                    for x1, y1, x2, y2, _ in template_boxes(frame, gray, tmpl))
            marks.append(found)
        else:
            marks.append([])
        n += 1
        if n % 50 == 0:
            print(f"  detect {n} frames…", flush=True)
    cap.release()
    print(f"{src.name}: {n} frames, "
          f"{sum(len(p) for p in persons)} person boxes, "
          f"{sum(len(m) for m in marks)} branding boxes")

    # pass 2 — blur with temporal union, pipe straight into ffmpeg
    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
         "-r", f"{fps}", "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2",
         str(dst)],
        stdin=subprocess.PIPE,
    )
    cap = cv2.VideoCapture(str(src))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        for box in union_window(persons, i, PERSON_WIN):
            blur_box(frame, *box)
        for box in union_window(marks, i, TMPL_WIN):
            blur_box(frame, *box)
        ff.stdin.write(frame.tobytes())
        i += 1
    cap.release()
    ff.stdin.close()
    ff.wait()
    if ff.returncode:
        sys.exit("ffmpeg failed")
    print(f"-> {dst}")


if __name__ == "__main__":
    main()
