"""What does N% corner error actually cost, in centimetres on the table?

    venv/bin/python physical.py --tag full_v1

Pixel error is the wrong unit for deciding "good enough". Placement maps,
bounce interpretation and camera guidance all consume TABLE coordinates,
so the question is how far a ball's landing point moves when the quad is
wrong by a given amount.

Method: build the true homography from the hand-marked quad and the
predicted one from the detector's quad. Take a grid of points across the
real 2.740 x 1.525 m surface, push each through the inverse of both, and
measure the displacement in metres. Reported as median and worst over
the grid, because a quad can be excellent near the camera and poor at
the far end — and the far end is where placement maps are read.

Also measures the NET: how far the geometry-derived net line sits from
the one the hand-marked corners imply. This isolates net error inherited
from corner error, which is the only kind this design has.
"""

from __future__ import annotations

import argparse
import glob
import json
import os

import numpy as np

import common


def table_points(nx=7, ny=11):
    xs = np.linspace(0.05, common.TABLE_W - 0.05, nx)
    ys = np.linspace(0.05, common.TABLE_L - 0.05, ny)
    gx, gy = np.meshgrid(xs, ys)
    return np.stack([gx.ravel(), gy.ravel()], axis=1)


def displacement_m(truth_quad, pred_quad):
    """Metres a table-plane point moves when pred is used instead of truth.

    A point at table coordinate p images at H_truth(p). Reading that
    pixel through the PREDICTED homography gives H_pred^-1(H_truth(p)),
    which is where the app would think the ball landed.
    """
    H_t = common.table_homography(truth_quad)
    H_p = common.table_homography(pred_quad)
    H_p_inv = np.linalg.inv(H_p)
    grid = table_points()
    pixels = common.project(H_t, grid)
    back = common.project(H_p_inv, pixels)
    d = np.linalg.norm(back - grid, axis=1)
    far_half = grid[:, 1] > common.TABLE_L / 2
    return {
        "median_m": float(np.median(d)),
        "worst_m": float(d.max()),
        "near_median_m": float(np.median(d[~far_half])),
        "far_median_m": float(np.median(d[far_half])),
    }


def net_error_px(truth_quad, pred_quad):
    """Pixel gap between the predicted net line and the true one."""
    t = common.net_line_from_quad(truth_quad)
    p = common.net_line_from_quad(pred_quad)
    return {
        "net_left_px": float(np.linalg.norm(t["left"] - p["left"])),
        "net_right_px": float(np.linalg.norm(t["right"] - p["right"])),
        "post_left_px": float(np.linalg.norm(
            t["post_left_foot"] - p["post_left_foot"])),
        "post_right_px": float(np.linalg.norm(
            t["post_right_foot"] - p["post_right_foot"])),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="full_v1")
    args = ap.parse_args()
    out_dir = os.path.join(common.WORK, "out", args.tag)
    corpus = common.load_corpus()
    rows = json.load(open(os.path.join(out_dir, "consensus.json")))
    from consensus import align

    phys, nets, errs = [], [], []
    for row in rows:
        if row.get("consensus_quad") is None:
            continue
        item = corpus[row["match"]]
        quad, _ = align(np.array(row["consensus_quad"]), item["truth"])
        d = displacement_m(item["truth"], quad)
        n = net_error_px(item["truth"], quad)
        phys.append(d)
        nets.append(n)
        errs.append(row["consensus"])

    if not phys:
        print("no answered matches")
        return

    def col(key, source):
        return np.array([p[key] for p in source])

    print(f"\n=== {args.tag}: {len(phys)} answered matches ===")
    print(f"corner error   median {np.median(errs):.2f}% of diagonal "
          f"(~{np.median(errs) * 22:.0f} px at 1080p)\n")
    print("ball landing displacement on the table, metres:")
    for key, label in (("median_m", "median over the surface"),
                       ("near_median_m", "near half"),
                       ("far_median_m", "far half"),
                       ("worst_m", "worst point")):
        v = col(key, phys)
        print(f"  {label:<24} median {100*np.median(v):6.1f} cm   "
              f"90th pct {100*np.percentile(v, 90):6.1f} cm   "
              f"max {100*v.max():6.1f} cm")
    print("\nnet line, pixels from the truth-derived net:")
    for key, label in (("net_left_px", "net at left sideline"),
                       ("net_right_px", "net at right sideline"),
                       ("post_left_px", "left post foot"),
                       ("post_right_px", "right post foot")):
        v = col(key, nets)
        print(f"  {label:<24} median {np.median(v):6.1f} px   "
              f"90th pct {np.percentile(v, 90):6.1f} px")

    print("\nreference points:")
    print("  a table tennis ball is 4.0 cm across")
    print("  a half of the table is 137 cm long, 152.5 cm wide")
    print("  the 'short' service box notion players use is ~30 cm deep")

    calibration_curve(corpus)


def calibrate_one(truth, rng, err_pct, width, height, trials=24):
    """Displacement produced by a quad wrong by err_pct, on this camera.

    Corners are pushed in uniformly random directions by a distance whose
    MEDIAN is err_pct of the diagonal, so the perturbed quad scores
    err_pct under the study metric by construction.
    """
    import math
    diag = math.hypot(width, height)
    target = err_pct / 100.0 * diag
    out = []
    for _ in range(trials):
        angles = rng.uniform(0, 2 * np.pi, 4)
        # scale so the MEDIAN corner distance is `target`
        mags = rng.uniform(0.5, 1.5, 4)
        mags *= target / np.median(mags)
        offset = np.stack([np.cos(angles), np.sin(angles)], axis=1) \
            * mags[:, None]
        out.append(displacement_m(truth, truth + offset)["median_m"])
    return float(np.median(out))


def calibration_curve(corpus):
    """How many centimetres is one per cent of corner error worth?"""
    rng = np.random.default_rng(17)
    print("\n=== what corner accuracy buys, across all 61 cameras ===")
    print(f"  {'corner err':>10} {'px @1080p':>10} "
          f"{'median displacement':>21}")
    for err_pct in (0.27, 0.5, 1.0, 1.75, 3.0):
        vals = [calibrate_one(item["truth"], rng, err_pct,
                              item["width"], item["height"])
                for item in corpus.values()]
        print(f"  {err_pct:9.2f}% {err_pct * 22:9.0f}  "
              f"{100 * np.median(vals):15.1f} cm")
    print("  (0.27% is the shipped keypoint detector; 1.75% is this study)")


if __name__ == "__main__":
    main()
