"""Multi-frame consensus over per-frame quads, and the comparison that
justifies (or kills) it.

    venv/bin/python consensus.py --tag full_v1

Mirrors the production pooling philosophy from the 2026-08-16 study:
filter each frame first, then take the largest agreeing cluster — never a
plain medoid, which tie-breaks toward failures on a bimodal set. Gates
and thresholds are stated here, applied identically to every match.

Prints per-match and aggregate numbers for:
  single      each frame scored independently (what continuous per-frame
              tracking would give)
  consensus   gated frames -> largest cluster -> per-corner median
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os

import numpy as np

import common

GATE_SUPPORT = 0.45
GATE_IOU = 0.85
# 4% of the diagonal, swept in analyse.py q2b. The production keypoint
# pooler can use a much tighter figure because its frames scatter by
# 0.27%; these scatter by ~2.9%, so two CORRECT frames routinely differ
# by more than 1.5% and a tight tolerance refuses matches it should
# answer. This is a property of the detector, not a knob to copy across.
AGREE_TOL_FRAC = 0.04
MIN_CLUSTER = 3
MIN_SHARE = 0.5


def align(pred, ref):
    """Best cyclic rotation of pred against ref, and its mean distance."""
    best, best_q = None, None
    for rot in range(4):
        q = np.roll(pred, -rot, axis=0)
        d = float(np.linalg.norm(q - ref, axis=1).mean())
        if best is None or d < best:
            best, best_q = d, q
    return best_q, best


def frame_gate(rec, width, height, gate_support=GATE_SUPPORT,
               gate_iou=GATE_IOU):
    if not rec.get("ok"):
        return False, rec.get("reason", "failed")
    if rec["edge_support"] < gate_support:
        return False, f"support {rec['edge_support']:.2f}"
    if rec["quad_iou"] < gate_iou:
        return False, f"iou {rec['quad_iou']:.2f}"
    quad = np.array(rec["quad"])
    pad = 0.05 * math.hypot(width, height)
    if (quad[:, 0].min() < -pad or quad[:, 0].max() > width + pad
            or quad[:, 1].min() < -pad or quad[:, 1].max() > height + pad):
        return False, "corner far outside frame"
    e = common.quad_edge_lengths(quad)
    if e.min() < 1 or e.max() / e.min() > 6:
        return False, "degenerate edge ratio"
    return True, ""


def pool(quads, diag, tol_frac=AGREE_TOL_FRAC, min_cluster=MIN_CLUSTER,
         min_share=MIN_SHARE):
    """Largest agreeing cluster -> per-corner median. None if no quorum."""
    n = len(quads)
    if n == 0:
        return None, "no frames survived the gate"
    tol = tol_frac * diag
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            _, d = align(quads[j], quads[i])
            if d <= tol:
                pi, pj = find(i), find(j)
                if pi != pj:
                    parent[pj] = pi
    clusters = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)
    sizes = sorted((len(v), k) for k, v in clusters.items())
    biggest = clusters[sizes[-1][1]]
    if len(sizes) > 1 and sizes[-1][0] == sizes[-2][0]:
        return None, "tie between clusters"
    if len(biggest) < min_cluster or len(biggest) < min_share * n:
        return None, (f"cluster {len(biggest)}/{n} below quorum")
    ref = quads[biggest[0]]
    aligned = [align(quads[i], ref)[0] for i in biggest]
    pooled = np.median(np.stack(aligned), axis=0)
    return {"quad": pooled, "used": len(biggest), "kept": n}, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="full_v1")
    ap.add_argument("--subset", default="all",
                    choices=["all", "first_half", "last_half"],
                    help="which sampled frames to pool — first_half "
                         "answers whether estimating near the start of "
                         "the video is enough")
    args = ap.parse_args()

    corpus = common.load_corpus()
    out_dir = os.path.join(common.WORK, "out", args.tag)
    rows = []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.json"))):
        if os.path.basename(path).startswith("consensus"):
            continue
        data = json.load(open(path))
        match = data["match"]
        item = corpus.get(match)
        if item is None:
            continue
        W, H, truth = item["width"], item["height"], item["truth"]
        diag = math.hypot(W, H)
        frames = data["frames"]
        if args.subset == "first_half":
            frames = frames[:max(len(frames) // 2, 1)]
        elif args.subset == "last_half":
            frames = frames[len(frames) // 2:]
        single = [f["score"]["err_pct"] for f in frames if f.get("ok")]
        kept, reasons = [], []
        for f in frames:
            ok, why = frame_gate(f, W, H)
            if ok:
                kept.append(np.array(f["quad"]))
            else:
                reasons.append(why)
        pooled, why = pool(kept, diag)
        row = {
            "match": match, "venue": item["venue"],
            "frames": len(frames),
            "single_ok": len(single),
            "single_median": (round(float(np.median(single)), 3)
                              if single else None),
            "single_gross": sum(1 for e in single if e > 5),
            "gate_kept": len(kept),
            "gate_reasons": reasons,
        }
        if pooled is None:
            row["consensus"] = None
            row["refused"] = why
        else:
            score = common.score_quad(pooled["quad"], truth, W, H)
            row["consensus"] = round(score["err_pct"], 3)
            row["consensus_worst"] = round(score["worst_corner_pct"], 3)
            row["consensus_used"] = pooled["used"]
            row["consensus_quad"] = pooled["quad"].tolist()
        rows.append(row)

    suffix = "" if args.subset == "all" else f"_{args.subset}"
    with open(os.path.join(out_dir, f"consensus{suffix}.json"), "w") as f:
        json.dump(rows, f, indent=1)

    answered = [r for r in rows if r["consensus"] is not None]
    refused = [r for r in rows if r["consensus"] is None]
    singles = [r["single_median"] for r in rows
               if r["single_median"] is not None]
    all_single_gross = sum(r["single_gross"] for r in rows)
    all_single_n = sum(r["single_ok"] for r in rows)
    cons = [r["consensus"] for r in answered]
    print(f"\n=== {args.tag}: {len(rows)} matches ===")
    print(f"single-frame: median-of-medians "
          f"{np.median(singles):.2f}%  | frames gross "
          f"{all_single_gross}/{all_single_n} "
          f"({100*all_single_gross/max(all_single_n,1):.0f}%)")
    print(f"consensus: answered {len(answered)}/{len(rows)}, "
          f"median {np.median(cons):.2f}%, "
          f"gross>5% {sum(1 for c in cons if c > 5)}, "
          f"good<1% {sum(1 for c in cons if c < 1)}")
    print(f"refused: {len(refused)}")
    for r in refused:
        print(f"  {r['match'][:8]} {r['venue']:<16} {r['refused']}")
    print("\nworst answered:")
    for r in sorted(answered, key=lambda r: -r["consensus"])[:8]:
        print(f"  {r['match'][:8]} {r['venue']:<16} "
              f"cons {r['consensus']:.2f}% "
              f"(single med {r['single_median']}%, "
              f"used {r['consensus_used']}/{r['gate_kept']})")


if __name__ == "__main__":
    main()
