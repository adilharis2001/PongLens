"""Phase 2: re-detect the ball on a table-cropped video, then re-run the
emergence check.

Follows production exactly:
  trim the raw to the window the job was processed in (89b35ee0 was
    processed 243s-1771s, and skipping that puts every timestamp minutes
    out while looking entirely normal);
  compute the crop with the SHIPPED ball_crop_box, so this measures what
    production would do rather than a crop invented here;
  crop with ffmpeg, run BlurBall on the crop, then shift every detection
  back into full-frame coordinates — which is what shift_detections does
  in production, and is why nothing downstream has to know about the crop.
"""
import json
import os
import subprocess
import sys

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
from points_endon import ball_crop_box                            # noqa: E402
from points_v2 import shift_detections                            # noqa: E402

TTVID = "/Users/adil/Desktop/Projects/TTVid"
VENV = f"{TTVID}/vendor/venv/bin/python"
BLURBALL = f"{TTVID}/vendor/blurball_infer.py"


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd[:6]), "...", flush=True)
    subprocess.run(cmd, check=True, **kw)


def main(match, raw, trim_start, trim_end):
    calib = json.load(open(f"{HERE}/real_calib.json"))[match]
    src = calib["source"]
    W, H = int(src["width"]), int(src["height"])
    corners = calib["corners"]
    size = calib.get("size")
    if size:                       # corners stored in some other space
        k = W / float(size[0]), H / float(size[1])
        corners = {a: [b[0] * k[0], b[1] * k[1]] for a, b in corners.items()}
    box = ball_crop_box(corners, W, H)
    if not box:
        raise SystemExit("no crop box for this match")
    x, y, w, h = [int(v) for v in box]
    print(f"crop {w}x{h} at ({x},{y}) of {W}x{H} "
          f"= {w*h/(W*H)*100:.0f}% of frame, ball {W/w:.1f}x bigger")

    work = f"{HERE}/crop"
    trimmed = f"{work}/{match[:8]}_trim.mp4"
    if not os.path.exists(trimmed):
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(trim_start),
             "-i", raw, "-t", str(float(trim_end) - float(trim_start)),
             "-c", "copy", "-avoid_negative_ts", "make_zero", trimmed])
    cropped = f"{work}/{match[:8]}_crop.mp4"
    if not os.path.exists(cropped):
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", trimmed,
             "-vf", f"crop={w}:{h}:{x}:{y}", "-c:v", "libx264",
             "-preset", "veryfast", "-crf", "18", "-an", cropped])
    det_crop = f"{work}/{match[:8]}_crop.jsonl"
    if not os.path.exists(det_crop):
        print("  blurball on the crop (the slow part)…", flush=True)
        run([VENV, BLURBALL, "--video", cropped, "--out", det_crop])
    det_full = f"{work}/{match[:8]}_shifted.jsonl"
    n = shift_detections(det_crop, det_full, x, y)
    print(f"shifted {n} detections back into full-frame coordinates -> {det_full}")


if __name__ == "__main__":
    main(*sys.argv[1:])
