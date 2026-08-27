"""Run segmentation -> corners over the labelled corpus.

    venv=~/ponglens-research-work/segtable/venv
    $venv/bin/python run_seg.py --frames 8 --tag gdino_sam21
    $venv/bin/python run_seg.py --matches 2f7168db,1c268ac1 --frames 3 \
        --panels all --tag smoke

Writes under ~/ponglens-research-work/segtable/out/<tag>/:
    <match>.json        per-frame quads, quality, error vs hand truth
    panels/*.jpg        original | mask | overlay debug panels
Resumable: a match with a finished JSON is skipped.
"""

from __future__ import annotations

import argparse
import json
import os
import time

import cv2
import numpy as np
from PIL import Image

import common
import corners as C
import segment
import snap as S


def run_frame(backend, path, item, zoom=True, do_snap=True):
    frame = cv2.imread(path)
    pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    t0 = time.perf_counter()
    candidates, whole, seg_record = backend.segment(pil)
    record = {"frame": os.path.basename(path), "seg": seg_record}
    if not candidates:
        record["ok"] = False
        record["seg_s"] = round(time.perf_counter() - t0, 2)
        record["reason"] = seg_record.get("reason", "no mask")
        return record, frame, None, None
    anchors = [seg_record.get("near_point"), seg_record.get("far_point")]
    anchors = [a for a in anchors if a is not None]
    fit, mask, audit, reason = C.select_surface(candidates, whole, anchors)
    record["candidates"] = audit
    if fit is None:
        record["ok"] = False
        record["seg_s"] = round(time.perf_counter() - t0, 2)
        record["reason"] = reason
        return record, frame, whole, None
    quad = fit["quad"]
    record["err_stage1"] = common.score_quad(
        quad, item["truth"], item["width"], item["height"])["err_pct"]

    if zoom:
        zc, zwhole, zrec = segment.zoom_pass(backend, pil, quad, anchors)
        if zc:
            zfit, zmask, zaudit, _ = C.select_surface(zc, zwhole, anchors)
            record["zoom"] = zrec
            record["zoom_candidates"] = zaudit
            # a zoom result replaces stage 1 only on STRICT quality
            # improvement: smooth-but-displaced masks (SAM3-LiteText s0)
            # can hold support ~1.0 while being several px off, so parity
            # is not evidence the zoom is better
            if zfit is not None and (
                    zfit["edge_support"] * np.sqrt(zfit["quad_iou"])
                    > 1.02 * fit["selected"]["score"]):
                fit, mask, quad = zfit, zmask, zfit["quad"]
        record["err_zoom"] = common.score_quad(
            quad, item["truth"], item["width"], item["height"])["err_pct"]

    if do_snap:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32)
        quad, votes = S.snap_quad(gray, quad)
        quad = common.order_cyclic(quad)
        record["snap_votes"] = [round(v, 2) for v in votes]

    record.update({
        "ok": True,
        "quad": quad.tolist(),
        "edge_support": fit["edge_support"],
        "quad_iou": fit["quad_iou"],
        "mask_px": fit["mask_px"],
        "picked_prompt": fit["selected"]["prompt"],
        "seg_s": round(time.perf_counter() - t0, 2),
    })
    record["score"] = common.score_quad(
        quad, item["truth"], item["width"], item["height"])
    return record, frame, mask, quad


def panel_for(frame, mask, quad, item, record):
    net = None
    if quad is not None and record.get("ok"):
        try:
            # align the cyclic quad to truth's ABCD so the net geometry
            # (halfway along the 2.740 m sides) is applied to real sides
            aligned = np.roll(quad, -record["score"]["rotation"], axis=0)
            net = common.net_line_from_quad(aligned)
        except Exception:
            net = None
    lines = [record["frame"]]
    if record.get("ok"):
        s = record["score"]
        lines.append(f"err {s['err_pct']:.2f}%  worst {s['worst_corner_pct']:.2f}%"
                     f"  support {record['edge_support']:.2f}"
                     f"  iou {record['quad_iou']:.2f}")
    else:
        lines.append(f"FAILED: {record.get('reason')}")
    small = C.clean_mask(mask) * 255 if mask is not None else None
    return common.debug_panel(frame, small, quad, item["truth"], net, lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", default="all")
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--backend", default="gdino_sam21")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--tag", default=None)
    ap.add_argument("--panels", default="first",
                    choices=["first", "all", "none"])
    ap.add_argument("--no-zoom", action="store_true")
    ap.add_argument("--no-snap", action="store_true")
    args = ap.parse_args()

    tag = args.tag or args.backend
    out_dir = os.path.join(common.WORK, "out", tag)
    panel_dir = os.path.join(out_dir, "panels")
    os.makedirs(panel_dir, exist_ok=True)

    corpus = common.load_corpus()
    if args.matches != "all":
        wanted = args.matches.split(",")
        corpus = {m: v for m, v in corpus.items()
                  if any(m.startswith(w) for w in wanted)}
    print(f"{len(corpus)} matches, {args.frames} frames each, "
          f"backend {args.backend}", flush=True)

    backend = segment.make_backend(args.backend, args.device)
    print("backend loaded", flush=True)

    for n, (match, item) in enumerate(sorted(corpus.items())):
        match_json = os.path.join(out_dir, f"{match}.json")
        if os.path.exists(match_json):
            continue
        frames = common.sample_frames(item["frames"], args.frames)
        records = []
        for k, path in enumerate(frames):
            record, frame, mask, quad = run_frame(
                backend, path, item,
                zoom=not args.no_zoom, do_snap=not args.no_snap)
            records.append(record)
            want_panel = (args.panels == "all"
                          or (args.panels == "first" and k == 0)
                          or not record.get("ok"))
            if want_panel and frame is not None:
                p = panel_for(frame, mask, quad, item, record)
                name = f"{match[:8]}_{record['frame'].replace('.jpg','')}.jpg"
                cv2.imwrite(os.path.join(panel_dir, name), p,
                            [cv2.IMWRITE_JPEG_QUALITY, 80])
        ok = [r for r in records if r.get("ok")]
        errs = sorted(r["score"]["err_pct"] for r in ok)
        med = errs[len(errs) // 2] if errs else None
        with open(match_json, "w") as f:
            json.dump({"match": match, "venue": item["venue"],
                       "truth": item["truth"].tolist(),
                       "frames": records}, f, indent=1)
        print(f"[{n+1}/{len(corpus)}] {match[:8]} {item['venue']:<16} "
              f"ok {len(ok)}/{len(records)} "
              f"median {med if med is None else round(med, 2)}%", flush=True)


if __name__ == "__main__":
    main()
