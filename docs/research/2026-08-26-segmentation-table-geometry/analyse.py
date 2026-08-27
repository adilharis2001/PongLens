"""The comparisons the study exists to make.

    venv/bin/python analyse.py --tag full_v1

Four questions, each answered on the same 61 matches:

  1. Does multi-frame consensus beat single-frame detection? Compared
     ONLY on the matches consensus answers, because comparing an answered
     subset against a full set flatters whichever one refuses more.
  2. What does the per-frame gate cost and buy, swept over thresholds?
  3. Is the wrong-table failure per-frame noise or a whole-match verdict?
     (If every frame of a match agrees on the same wrong table, pooling
     cannot save it — the 2026-08-16 study's central warning.)
  4. Is estimating from the FIRST half of the video as good as sampling
     the whole thing?
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os

import numpy as np

import common
from consensus import align, frame_gate, pool


def load(tag):
    out_dir = os.path.join(common.WORK, "out", tag)
    corpus = common.load_corpus()
    matches = []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        if os.path.basename(path).startswith("consensus"):
            continue
        data = json.load(open(path))
        item = corpus.get(data["match"])
        if item is not None:
            matches.append((data, item))
    return out_dir, matches


def pooled_error(data, item, gate_support, gate_iou, frames=None,
                 tol_frac=0.015, min_cluster=3, min_share=0.5):
    W, H = item["width"], item["height"]
    diag = math.hypot(W, H)
    rows = frames if frames is not None else data["frames"]
    kept = []
    for f in rows:
        ok, _ = frame_gate(f, W, H, gate_support, gate_iou)
        if ok:
            kept.append(np.array(f["quad"]))
    pooled, why = pool(kept, diag, tol_frac, min_cluster, min_share)
    if pooled is None:
        return None, why, len(kept)
    score = common.score_quad(pooled["quad"], item["truth"], W, H)
    return score["err_pct"], "", len(kept)


def q1_consensus_vs_single(matches):
    print("\n=== 1. consensus vs single frame, on the SAME matches ===")
    both = []
    for data, item in matches:
        err, why, kept = pooled_error(data, item, 0.55, 0.85)
        singles = [f["score"]["err_pct"] for f in data["frames"]
                   if f.get("ok")]
        if err is None or not singles:
            continue
        both.append((err, float(np.median(singles)), singles))
    if not both:
        print("  nothing to compare")
        return
    cons = np.array([b[0] for b in both])
    sing = np.array([b[1] for b in both])
    every = np.array([e for b in both for e in b[2]])
    print(f"  matches answered by consensus: {len(both)}")
    print(f"  consensus     median {np.median(cons):5.2f}%  "
          f"gross>5% {(cons > 5).sum():2d}  good<1% {(cons < 1).sum()}")
    print(f"  single median median {np.median(sing):5.2f}%  "
          f"gross>5% {(sing > 5).sum():2d}  good<1% {(sing < 1).sum()}")
    print(f"  ANY single frame (the per-frame lottery): "
          f"median {np.median(every):5.2f}%  "
          f"gross {(every > 5).sum()}/{len(every)} "
          f"({100 * (every > 5).mean():.0f}%)")
    better = int((cons < sing).sum())
    print(f"  consensus beats that match's median frame: "
          f"{better}/{len(both)}")


def q2_gate_sweep(matches):
    print("\n=== 2. per-frame gate sweep ===")
    print(f"  {'support':>7} {'iou':>5} {'answered':>9} {'median':>7} "
          f"{'gross':>6} {'worst':>7}")
    for gs in (0.0, 0.35, 0.45, 0.55, 0.65):
        for gi in (0.0, 0.85, 0.90):
            errs = []
            for data, item in matches:
                err, _, _ = pooled_error(data, item, gs, gi)
                if err is not None:
                    errs.append(err)
            if not errs:
                print(f"  {gs:7.2f} {gi:5.2f} {0:9d}")
                continue
            e = np.array(errs)
            print(f"  {gs:7.2f} {gi:5.2f} {len(e):9d} "
                  f"{np.median(e):6.2f}% {(e > 5).sum():6d} "
                  f"{e.max():6.1f}%")


def q2b_quorum_sweep(matches):
    """The agreement tolerance was borrowed from a 0.27%-error detector.

    For a detector whose own frames scatter by ~3%, two CORRECT frames
    routinely disagree by more than 1.5% of the diagonal, so the quorum
    rule refuses matches it should answer. Sweeping it is the difference
    between measuring the method and measuring my threshold.
    """
    print("\n=== 2b. agreement tolerance / quorum sweep ===")
    print(f"  {'tol%':>5} {'minclu':>7} {'answered':>9} {'median':>7} "
          f"{'gross':>6} {'worst':>7}")
    for tol in (0.015, 0.025, 0.04, 0.06):
        for min_cluster in (2, 3):
            errs = []
            for data, item in matches:
                err, _, _ = pooled_error(data, item, 0.45, 0.85,
                                         tol_frac=tol,
                                         min_cluster=min_cluster)
                if err is not None:
                    errs.append(err)
            e = np.array(errs) if errs else np.array([np.nan])
            print(f"  {100*tol:5.1f} {min_cluster:7d} {len(errs):9d} "
                  f"{np.nanmedian(e):6.2f}% {(e > 5).sum():6d} "
                  f"{np.nanmax(e):6.1f}%")


def q3_wrong_table(matches):
    print("\n=== 3. is a wrong table a frame accident or a match verdict? ===")
    stubborn = []
    for data, item in matches:
        errs = [f["score"]["err_pct"] for f in data["frames"]
                if f.get("ok")]
        if not errs:
            continue
        e = np.array(errs)
        if (e > 15).mean() >= 0.5:          # half the frames wildly wrong
            stubborn.append((data["match"][:8], item["venue"],
                             float(np.median(e)), float(e.min()),
                             len(e)))
    print(f"  matches where >=50% of frames are >15% off: "
          f"{len(stubborn)}/{len(matches)}")
    for m, v, med, best, n in sorted(stubborn, key=lambda r: -r[2]):
        print(f"    {m} {v:<16} median {med:5.1f}%  best frame "
              f"{best:5.1f}%  ({n} frames)")
    print("  A match whose BEST frame is still far off cannot be pooled")
    print("  back to correct: every frame agrees on the same wrong table.")


def q4_first_half(matches):
    print("\n=== 4. first half of the video vs all of it ===")
    rows = []
    for data, item in matches:
        n = len(data["frames"])
        first = data["frames"][:max(n // 2, 1)]
        a, _, _ = pooled_error(data, item, 0.55, 0.85)
        b, _, _ = pooled_error(data, item, 0.55, 0.85, frames=first)
        rows.append((a, b))
    all_ans = [r[0] for r in rows if r[0] is not None]
    fh_ans = [r[1] for r in rows if r[1] is not None]
    both = [(a, b) for a, b in rows if a is not None and b is not None]
    print(f"  all frames : answered {len(all_ans)}/{len(rows)}, "
          f"median {np.median(all_ans):.2f}%")
    print(f"  first half : answered {len(fh_ans)}/{len(rows)}, "
          f"median {np.median(fh_ans):.2f}%")
    if both:
        d = np.array([b - a for a, b in both])
        print(f"  on the {len(both)} both answer: first-half is "
              f"{np.median(d):+.2f}% different (median), "
              f"worst {d.max():+.2f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="full_v1")
    args = ap.parse_args()
    _, matches = load(args.tag)
    print(f"{args.tag}: {len(matches)} matches")
    q1_consensus_vs_single(matches)
    q2_gate_sweep(matches)
    q2b_quorum_sweep(matches)
    q3_wrong_table(matches)
    q4_first_half(matches)


if __name__ == "__main__":
    main()
