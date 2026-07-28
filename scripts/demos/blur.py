#!/usr/bin/env python3
"""Privacy blur for showcase screenshots — people and venue branding.

    scripts/demos/venv-blur/bin/python scripts/demos/blur.py [files...]

Runs after shots.mjs (defaults to every jpg in public/showcase/):
  * people: YOLOv8n person boxes, Gaussian-blurred with padding;
  * the venue's neon sign and booking TV: multi-scale template matches
    (templates in scripts/demos/assets/, cropped from the same fixed
    camera scene), blurred the same way.

In-place. Re-run after any re-shoot; the pipeline stays one command:
shots.mjs -> blur.py.
"""

import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[2]
SHOWCASE = ROOT / "public" / "showcase"
ASSETS = Path(__file__).resolve().parent / "assets"

# Per-template guards, calibrated on real vs false matches (the app's own
# magenta accents can satisfy a loose pink test, and TM_CCOEFF_NORMED
# scores flat UI spuriously high):
#   sign: true matches are SATURATED pink (fraction >= 0.72 observed;
#         false ones <= 0.05), so the pink floor does the work;
#   tv:   true matches score >= 0.85; false ones <= 0.79, so the match
#         threshold does the work (its true pink fraction is only ~0.15).
TEMPLATES = [
    {"file": "sign.png", "thresh": 0.55, "pink_min": 0.30},
    {"file": "tv.png", "thresh": 0.82, "pink_min": 0.05},
]
SCALES = np.geomspace(0.12, 1.25, 16)
PERSON_CONF = 0.25
PAD_FRAC = 0.18


def blur_box(img, x1, y1, x2, y2):
    h, w = img.shape[:2]
    pw, ph = int((x2 - x1) * PAD_FRAC), int((y2 - y1) * PAD_FRAC)
    x1, y1 = max(0, x1 - pw), max(0, y1 - ph)
    x2, y2 = min(w, x2 + pw), min(h, y2 + ph)
    if x2 <= x1 or y2 <= y1:
        return
    roi = img[y1:y2, x1:x2]
    # strong enough that SMALL regions (a sign inside an embedded
    # thumbnail) are unreadable, not just softened — double pass
    k = max(25, (min(roi.shape[0], roi.shape[1]) // 2) | 1)
    roi = cv2.GaussianBlur(roi, (k, k), 0)
    img[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (k, k), 0)


def pink_fraction(img, x1, y1, x2, y2):
    """Share of clearly pink pixels (r above g, blue up too) in a box.
    Both templates are magenta-family; the per-template pink_min floor
    kills the degenerate high scores TM_CCOEFF_NORMED gives flat or
    grey/blue UI regions."""
    roi = img[y1:y2, x1:x2].astype(np.int16)
    if roi.size == 0:
        return 0.0
    b, g, r = roi[..., 0], roi[..., 1], roi[..., 2]
    pink = (r > g + 25) & (b > g + 5) & (r > 70)
    return float(pink.mean())


def template_boxes(img, gray, tmpl, thresh, pink_min):
    th, tw = tmpl.shape[:2]
    boxes = []
    for s in SCALES:
        stw, sth = int(tw * s), int(th * s)
        if stw < 12 or sth < 8 or stw >= gray.shape[1] or sth >= gray.shape[0]:
            continue
        scaled = cv2.resize(tmpl, (stw, sth), interpolation=cv2.INTER_AREA)
        res = cv2.matchTemplate(gray, scaled, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(res >= thresh)
        for x, y in zip(xs, ys):
            x1, y1, x2, y2 = int(x), int(y), int(x) + stw, int(y) + sth
            # variance guard: flat regions score spuriously high
            if gray[y1:y2, x1:x2].std() < 12:
                continue
            if pink_fraction(img, x1, y1, x2, y2) < pink_min:
                continue
            boxes.append((x1, y1, x2, y2, float(res[y, x])))
    # greedy dedupe: keep the best-scoring box of each overlapping cluster
    boxes.sort(key=lambda b: -b[4])
    kept = []
    for b in boxes:
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if any(k[0] - 20 <= cx <= k[2] + 20 and k[1] - 20 <= cy <= k[3] + 20
               for k in kept):
            continue
        kept.append(b)
    return kept


def main():
    # --marks-only: blur venue branding but leave people visible (used
    # when the footage is consented and shot so no face shows).
    marks_only = "--marks-only" in sys.argv
    files = ([Path(a) for a in sys.argv[1:] if not a.startswith("--")]
             or sorted(SHOWCASE.glob("*.jpg")))
    model = None if marks_only else YOLO("yolov8n.pt")
    templates = [
        {
            **t,
            "gray": cv2.cvtColor(
                cv2.imread(str(ASSETS / t["file"])), cv2.COLOR_BGR2GRAY
            ),
        }
        for t in TEMPLATES
    ]

    for f in files:
        img = cv2.imread(str(f))
        if img is None:
            print(f"skip {f} (unreadable)")
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        n_people = n_marks = 0

        if model is not None:
            for r in model(img, classes=[0], conf=PERSON_CONF, verbose=False):
                for box in r.boxes.xyxy.cpu().numpy().astype(int):
                    blur_box(img, *box)
                    n_people += 1

        for t in templates:
            for x1, y1, x2, y2, _score in template_boxes(
                img, gray, t["gray"], t["thresh"], t["pink_min"]
            ):
                blur_box(img, x1, y1, x2, y2)
                n_marks += 1

        cv2.imwrite(str(f), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print(f"{f.name}: {n_people} people, {n_marks} branding")


if __name__ == "__main__":
    main()
