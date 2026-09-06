"""One video per point, with the sound drawn under the picture.

  ./venv/bin/python burn_clips.py <cards.json> <out-dir> [n]

The interactive page is better for browsing; this is for watching. The
graph is rendered once per clip, stacked under the video, and a playhead is
burned in by ffmpeg so it sweeps in step with the sound. Nothing to click.

Clips are chosen to show the argument rather than to be representative: the
ones with the most ball events landing off the table, the ones where the
detector is busiest, and a quiet one for contrast.
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np

CLIPS = "/Users/adil/Desktop/ponglens-serve-review/clipsun"
VW, VH = 960, 540          # video is 960x540
GH = 190                   # the graph strip under it
PAD_L, PAD_R = 8, 8

BG = (13, 11, 9)           # BGR
CURVE_HI = (248, 189, 56)
CURVE_LO = (70, 63, 63)
BAR = (11, 158, 245)
BOUNCE = (122, 222, 74)
CONTACT = (250, 139, 167)
OFF = (113, 113, 248)
INK = (215, 212, 212)


def render_graph(card):
    img = np.full((GH, VW, 3), BG, np.uint8)
    span = card["span"]
    x0, x1 = PAD_L, VW - PAD_R
    top, bot = 26, GH - 46

    def X(t):
        return int(x0 + t / span * (x1 - x0))

    # the window the assembler called a point
    cv2.rectangle(img, (X(card["card"][0]), 0), (X(card["card"][1]), GH),
                  (26, 24, 22), -1)
    # one-second ticks
    for s in range(1, int(span) + 1):
        cv2.line(img, (X(s), bot), (X(s), bot + 5), (45, 42, 40), 1)
        if s % 2 == 0:
            cv2.putText(img, f"{s}s", (X(s) - 8, bot + 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.34, (90, 86, 84), 1,
                        cv2.LINE_AA)

    def curve(series, colour, thick):
        pts = [(X(i / max(1, len(series) - 1) * span),
                int(bot - v / 100 * (bot - top))) for i, v in enumerate(series)]
        cv2.polylines(img, [np.array(pts, np.int32)], False, colour, thick,
                      cv2.LINE_AA)

    curve(card["lo"], CURVE_LO, 1)
    curve(card["hi"], CURVE_HI, 1)

    for t, z in card["phi"]:
        cv2.line(img, (X(t), top), (X(t), bot), BAR, 1, cv2.LINE_AA)
    for e in card["ev"]:
        centre = (X(e["t"]), bot + 16)
        cv2.circle(img, centre, 5,
                   BOUNCE if e["kind"] == "bounce" else CONTACT, -1,
                   cv2.LINE_AA)
        if not e["on"]:
            cv2.circle(img, centre, 8, OFF, 2, cv2.LINE_AA)

    off = sum(1 for e in card["ev"] if not e["on"])
    cv2.putText(img, "loudness of sharp sounds (10 kHz+)", (PAD_L, 16),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, CURVE_HI, 1, cv2.LINE_AA)
    label = (f"{len(card['phi'])} sounds called impacts   "
             f"{len(card['ev']) - off} ball events on the table   "
             f"{off} off the table")
    cv2.putText(img, label, (PAD_L, GH - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                INK, 1, cv2.LINE_AA)
    return img


def burn(card, out_dir):
    graph = render_graph(card)
    png = os.path.join(out_dir, "_graph.png")
    cv2.imwrite(png, graph)
    src = os.path.join(CLIPS, card["clip"])
    dest = os.path.join(
        out_dir,
        f"{card['i']:03d}_{card['who'].split()[0].lower()}_{card['reason']}.mp4")
    span = card["span"]
    # NOTE: drawbox in this ffmpeg build silently ignores a time
    # expression in `x` — a moving playhead written that way produces a
    # video with no playhead at all, and nothing warns you. Verified
    # against a lavfi probe: static x draws, `x='...t...'` draws nothing.
    # overlay honours the same expression, so the head is an overlaid
    # image instead. A translucent "already heard" wash was tried too and
    # removed: a lavfi colour source with an alpha suffix still arrives
    # opaque here, and it painted out the whole left half of the graph.
    head = f"{PAD_L}+(t/{span:.4f})*{VW - PAD_L - PAD_R}"
    chain = (
        f"[0:v]scale={VW}:{VH},setsar=1[v];"
        f"[v][1:v]vstack=inputs=2[st];"
        f"[st][2:v]overlay=x='({head})-2':y={VH - 18}[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-i", png,
         "-f", "lavfi", "-i", f"color=c=white:s=4x{GH + 18}:d={span:.3f}",
         "-filter_complex", chain, "-map", "[out]", "-map", "0:a?",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
         "-movflags", "+faststart", dest], check=True)
    os.remove(png)
    return dest


def main():
    cards = json.load(open(sys.argv[1]))
    out_dir = sys.argv[2]
    want = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    os.makedirs(out_dir, exist_ok=True)

    def off_count(c):
        return sum(1 for e in c["ev"] if not e["on"])

    chosen, seen = [], set()
    for key in (lambda c: -off_count(c),
                lambda c: -len(c["phi"]) / max(0.1, c["span"]),
                lambda c: len(c["phi"]) / max(0.1, c["span"])):
        for card in sorted(cards, key=key):
            if card["i"] in seen or not card["ev"]:
                continue
            seen.add(card["i"])
            chosen.append(card)
            break
    for card in sorted(cards, key=lambda c: -off_count(c)):
        if len(chosen) >= want:
            break
        if card["i"] not in seen and card["ev"]:
            seen.add(card["i"])
            chosen.append(card)

    made = []
    for card in chosen:
        print(f"  {card['i']:3d} {card['who']:8s} {card['reason']:22s} "
              f"{card['span']:5.1f}s  {len(card['phi']):3d} sounds  "
              f"{off_count(card):2d} off-table", flush=True)
        made.append(burn(card, out_dir))
    print(f"\n{len(made)} videos in {out_dir}")
    for path in made:
        print(f"  {os.path.basename(path)}  "
              f"{os.path.getsize(path) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
