#!/usr/bin/env python3
"""A page of break windows, so findings can be checked by eye.

Numbers from a study like this have been wrong before in ways no metric
showed: a quad drawn off the frame still produced a full table of
plausible accuracies. Every claim in the write-up should be checkable
against the footage it came from, which is what this builds — a
filmstrip per break, boxes drawn, label and signals beside it.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != HERE]
sys.path.insert(0, str(HERE.parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from worker.break_signals import (  # noqa: E402
    WORKDIR, features, height_split, label_windows, labels, plausible,
    production_margins,
)
from worker.extract_side_changes_rtmpose import _named_corners  # noqa: E402

SHOTS = 6
THUMB_W = 300


def strip(folder: Path, window: dict, named: dict, split: float) -> list[str]:
    src = next((p for p in folder.glob("source.*")), None)
    frames = window.get("frames") or []
    if src is None or not frames:
        return []
    cap = cv2.VideoCapture(str(src))
    pick = [frames[int(round(i * (len(frames) - 1) / (SHOTS - 1)))]
            for i in range(SHOTS)] if len(frames) >= SHOTS else frames
    quad = np.array([named[k] for k in "ABCD"], np.int32)
    out = []
    for fr in pick:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fr["frame"])
        ok, img = cap.read()
        if not ok:
            continue
        cv2.polylines(img, [quad], True, (0, 255, 255), 2)
        keep = {id(p) for p in plausible(fr["people"], named)}
        for p in fr["people"]:
            b = [int(v) for v in p["box"]]
            on = any(p["box"] == q["box"] for q in plausible(
                fr["people"], named))
            near = split == split and p["h"] >= split
            colour = ((0, 200, 0) if near else (255, 120, 0)) if on \
                else (120, 120, 120)
            cv2.rectangle(img, (b[0], b[1]), (b[2], b[3]), colour, 3)
            cv2.putText(img, f"{'N' if near else 'F'} h={p['h']:.0f}",
                        (b[0], max(24, b[1] - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, colour, 2)
        h, w = img.shape[:2]
        img = cv2.resize(img, (THUMB_W, int(h * THUMB_W / w)))
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 62])
        if ok:
            out.append(base64.b64encode(buf).decode())
    cap.release()
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--only", nargs="*", default=["swapped", "quiet"])
    ap.add_argument("--max-quiet", type=int, default=40)
    args = ap.parse_args()

    ti = labels([])
    truth, tol = ti["truth"], ti["tolerance"]
    cards = []
    for folder in sorted(WORKDIR.iterdir()):
        bj = folder / "breaks.json"
        if not bj.is_file():
            continue
        data = json.loads(bj.read_text())
        named = _named_corners(data["corners"])
        hz = float(data.get("sample_hz") or 2.0)
        split = height_split([
            p["h"] for w in data["windows"] for fr in w.get("frames") or []
            for p in plausible(fr["people"], named)])
        m8 = folder.name[:8]
        prod = production_margins(folder.name)
        marks = label_windows(
            m8, [w["after_idx"] for w in data["windows"]], truth, tol)
        for window in data["windows"]:
            lab = marks[window["after_idx"]]
            if lab not in args.only:
                continue
            f = features(window, named, hz, split)
            cards.append({
                "match": m8, "idx": window["after_idx"], "label": lab,
                "dur": window["duration"], "fore": data.get("foreshortening"),
                "prod": prod.get(window["after_idx"]),
                "f": f, "folder": folder, "window": window, "named": named,
                "split": split,
            })

    quiet = [c for c in cards if c["label"] == "quiet"]
    quiet.sort(key=lambda c: -(c["f"].get("app_swap_body") or -1e9))
    keep = [c for c in cards if c["label"] != "quiet"] + quiet[:args.max_quiet]
    keep.sort(key=lambda c: (c["match"], c["idx"]))

    parts = ["<!doctype html><meta charset=utf-8><title>Break windows</title>",
             "<style>body{font:14px system-ui;background:#111;color:#eee;"
             "margin:24px}h1{font-size:20px}.row{margin:18px 0;padding:12px;"
             "background:#1b1b1b;border-radius:8px}.sw{border-left:4px solid "
             "#3c3}.qu{border-left:4px solid #555}img{margin-right:4px;"
             "vertical-align:top}code{color:#9cf}</style>",
             f"<h1>{len(keep)} break windows</h1>",
             "<p>Green box = near player by height, orange = far, grey = "
             "filtered out. Yellow quad is the table.</p>"]
    for c in keep:
        imgs = strip(c["folder"], c["window"], c["named"], c["split"])
        sig = c["f"]
        bits = " &nbsp; ".join(
            f"{k}=<code>{sig[k]:+.2f}</code>" for k in
            ("app_swap_body", "app_swap_body_norm", "player_separability",
             "held_player_flipped", "scale_exchange") if k in sig)
        prod = "n/a" if c["prod"] is None else f"{-c['prod']:+.3f}"
        parts.append(
            f"<div class='row {'sw' if c['label']=='swapped' else 'qu'}'>"
            f"<b>{c['match']}@{c['idx']}</b> {c['label']} &nbsp; "
            f"{c['dur']:.1f}s &nbsp; fore={c['fore']} &nbsp; "
            f"production={prod}<br>{bits}<br>"
            + "".join(f"<img src='data:image/jpeg;base64,{b}'>" for b in imgs)
            + "</div>")
    args.out.write_text("\n".join(parts))
    print(f"wrote {args.out} ({len(keep)} windows)")


if __name__ == "__main__":
    main()
