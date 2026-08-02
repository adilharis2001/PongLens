"""Option A's annotation layer: one transparent PNG per cue and per caption.

    worker/venv/bin/python scripts/demos/tutorial/overlays.py [chapter]

The Homebrew ffmpeg on this machine is built without freetype or libass, so
it has neither `drawtext` nor `subtitles`. Rather than rebuild ffmpeg, the
text is rendered here with Pillow and composited by ffmpeg as plain
`overlay` inputs. Pillow also draws nicer boxes than `drawbox` can: rounded
corners and a soft halo instead of a hard rectangle.

Every PNG is a full frame at the output size, so ffmpeg overlays it at 0,0
and the geometry stays here where it is easy to read. Writes a manifest
(overlay/manifest.json) that render-a.mjs turns into filter-graph entries.
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

DIR = os.path.dirname(os.path.abspath(__file__))
CHAPTER = sys.argv[1] if len(sys.argv) > 1 else "upload"
OUT = os.path.join(DIR, "out", "overlay", CHAPTER)

OUT_W = 720
CYAN = (34, 211, 238)
INK = (10, 10, 15)

BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"

with open(os.path.join(DIR, "raw", f"tut-{CHAPTER}.cues.json")) as f:
    cues = json.load(f)
with open(os.path.join(DIR, "voice", f"{CHAPTER}.json")) as f:
    voice = json.load(f)

K = OUT_W / cues["viewport"]["w"]          # CSS px -> output px
OUT_H = round(cues["viewport"]["h"] * K / 2) * 2
os.makedirs(OUT, exist_ok=True)


def frame():
    return Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_box(img, rect, label):
    d = ImageDraw.Draw(img)
    pad = 7
    x0 = rect["x"] * K - pad
    y0 = rect["y"] * K - pad
    x1 = x0 + rect["w"] * K + pad * 2
    y1 = y0 + rect["h"] * K + pad * 2
    # halo, then the ring — the same two-pass look the app uses for focus
    d.rounded_rectangle([x0 - 5, y0 - 5, x1 + 5, y1 + 5], radius=20,
                        outline=CYAN + (70,), width=10)
    d.rounded_rectangle([x0, y0, x1, y1], radius=15,
                        outline=CYAN + (245,), width=4)
    if not label:
        return
    font = ImageFont.truetype(BOLD, 25)
    tw = d.textlength(label, font=font)
    ch, cpad = 40, 14
    # above the box normally; below it when the box is near the top edge
    above = y0 > 70
    cy0 = y0 - ch - 10 if above else y1 + 10
    cx0 = min(max(x0, 12), OUT_W - tw - cpad * 2 - 12)
    d.rounded_rectangle([cx0, cy0, cx0 + tw + cpad * 2, cy0 + ch],
                        radius=ch // 2, fill=CYAN + (245,))
    d.text((cx0 + cpad, cy0 + ch / 2), label, font=font, fill=INK,
           anchor="lm")


def draw_tap(img, x, y):
    d = ImageDraw.Draw(img)
    cx, cy = x * K, y * K
    for r, a, w in ((46, 55, 3), (32, 235, 5)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CYAN + (a,), width=w)
    d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=CYAN + (45,))


def draw_caption(img, text):
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(BOLD, 33)
    lines = wrap(d, text, font, OUT_W - 150)
    lh = 44
    h = lh * len(lines) + 30
    bottom = OUT_H - 150            # clears the fixed bottom nav
    top = bottom - h
    d.rounded_rectangle([48, top, OUT_W - 48, bottom], radius=20,
                        fill=(10, 10, 15, 205))
    y = top + 15 + lh / 2
    for line in lines:
        d.text((OUT_W / 2, y), line, font=font, fill=(255, 255, 255, 255),
               anchor="mm")
        y += lh


manifest = []

for i, cue in enumerate(cues["cues"]):
    img = frame()
    if cue["kind"] == "box":
        draw_box(img, cue["rect"], cue.get("label"))
    elif cue["kind"] == "tap":
        draw_tap(img, cue["x"], cue["y"])
    else:
        continue
    name = f"cue{i}.png"
    img.save(os.path.join(OUT, name))
    manifest.append({"file": name, "start": cue["t"], "end": cue["end"]})

for i, line in enumerate(voice["lines"]):
    img = frame()
    draw_caption(img, line["text"])
    name = f"cap{i}.png"
    img.save(os.path.join(OUT, name))
    manifest.append({
        "file": name,
        "start": line["start"],
        "end": line["start"] + line["dur"] + 0.25,
    })

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump({"w": OUT_W, "h": OUT_H, "items": manifest}, f, indent=2)
print(f"{len(manifest)} overlays -> {OUT}")
