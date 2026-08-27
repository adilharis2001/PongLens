"""Shared harness for the segmentation-table-geometry study, 2026-08-26.

Everything here is deliberately independent of the worker: the corpus, the
metric and the corner conventions are re-stated so this experiment can be
run and read on its own. Conventions match production exactly:

  Corners are A near-left, B near-right, C far-right, D far-left.
  "Near" is the end closest to the camera (lower in the frame), left and
  right as the camera sees them. A->B is a 1.525 m end, B->C a 2.740 m side.

Truth comes from ~/ponglens-data/table-corners/labels.json, which was
harvested from table_calibration_review.corrected_corners AFTER migration
118 rotated the seven mislabelled frames, so it is the authoritative set.

The metric is the 2026-08-16 study's, unchanged so numbers are comparable:

  error% = 100 * min over 4 cyclic rotations of
           (median euclidean corner distance) / hypot(W, H)
  gross > 5           good < 1

1% of a 1080p diagonal is ~22 px.
"""

from __future__ import annotations

import json
import math
import os

import cv2
import numpy as np

DATA = os.path.expanduser("~/ponglens-data/table-corners")
STUDY_CACHE = os.path.expanduser(
    "~/Library/Caches/PongLens/calibration-study")
WORK = os.path.expanduser("~/ponglens-research-work/segtable")

# ITTF table, metres. The model rectangle every homography maps from.
TABLE_L = 2.740
TABLE_W = 1.525
NET_OVERHANG = 0.1525   # posts stand this far outside each sideline
NET_HEIGHT = 0.1525

# The canonical model rectangle in table coordinates: A, B, C, D.
# A near-left is (0, 0); x runs A->B along the 1.525 m end, y runs A->D
# along the 2.740 m side. (This is a study-local frame, used only to fit
# homographies; nothing downstream reads it.)
MODEL_QUAD = np.array([
    [0.0, 0.0],           # A near-left
    [TABLE_W, 0.0],       # B near-right
    [TABLE_W, TABLE_L],   # C far-right
    [0.0, TABLE_L],       # D far-left
], dtype=np.float64)


# ---------------------------------------------------------------------------
# Corpus
# ---------------------------------------------------------------------------

def load_corpus():
    """All labelled matches: match id -> dict with truth and frame paths."""
    with open(os.path.join(DATA, "labels.json")) as f:
        labels = json.load(f)
    corpus = {}
    for match, meta in labels.items():
        frame_dir = os.path.join(DATA, "frames", match)
        if not os.path.isdir(frame_dir):
            continue
        frames = sorted(
            os.path.join(frame_dir, f)
            for f in os.listdir(frame_dir) if f.endswith(".jpg"))
        if not frames:
            continue
        corpus[match] = {
            "venue": (meta.get("venue") or "unknown").strip() or "unknown",
            "width": meta["sourceWidth"],
            "height": meta["sourceHeight"],
            "truth": np.array(meta["corners"], dtype=np.float64),
            "frames": frames,
        }
    return corpus


def sample_frames(paths, count):
    """Deterministic evenly spaced sample, mirroring production's habit."""
    if len(paths) <= count:
        return list(paths)
    idx = np.linspace(0, len(paths) - 1, count).round().astype(int)
    return [paths[i] for i in sorted(set(idx.tolist()))]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_quad(pred, truth, width, height):
    """The study metric plus honesty columns. pred/truth are (4,2) cyclic."""
    pred = np.asarray(pred, dtype=np.float64)
    truth = np.asarray(truth, dtype=np.float64)
    diag = math.hypot(width, height)
    best, best_rot, best_worst = None, 0, None
    for rot in range(4):
        d = np.linalg.norm(np.roll(pred, -rot, axis=0) - truth, axis=1)
        med = float(np.median(d))
        if best is None or med < best:
            best, best_rot = med, rot
            best_worst = float(d.max())
    exact = np.linalg.norm(pred - truth, axis=1)
    return {
        "err_pct": 100.0 * best / diag,
        "err_exact_pct": 100.0 * float(np.median(exact)) / diag,
        "worst_corner_pct": 100.0 * best_worst / diag,
        "rotation": best_rot,
    }


# ---------------------------------------------------------------------------
# Quad geometry
# ---------------------------------------------------------------------------

def order_cyclic(points):
    """Four points -> cyclic order matching the truth winding.

    All 61 truth quads share one signed-area sign in image coordinates
    (asserted by check_truth_winding). Sorting by angle about the centroid
    gives a cyclic order; we then flip if the winding disagrees.
    """
    pts = np.asarray(points, dtype=np.float64)
    if pts.shape != (4, 2):
        raise ValueError("need exactly four points")
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]
    if signed_area(pts) > 0:
        pts = pts[::-1]
    return pts


def signed_area(quad):
    x, y = quad[:, 0], quad[:, 1]
    return 0.5 * float(
        np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def start_at_near_left(quad_cyclic, near_pair):
    """Rotate a cyclic quad so index 0 is A near-left.

    near_pair is the cyclic index of the edge chosen as the near 1.525 m
    end (edge i joins vertex i and i+1). The near end's left vertex, as
    the camera sees it, is the one with smaller x of that edge... except
    left/right on an end line means "as seen from the camera", which for
    the NEAR end is simply image left/right.
    """
    q = np.roll(quad_cyclic, -near_pair, axis=0)
    if q[0, 0] > q[1, 0]:
        # winding put near-right first; reverse direction, keep cyclic order
        q = np.roll(q[::-1], 1, axis=0)
    return q


def quad_edge_lengths(quad):
    return np.linalg.norm(np.roll(quad, -1, axis=0) - quad, axis=1)


# ---------------------------------------------------------------------------
# Homography / net geometry
# ---------------------------------------------------------------------------

def table_homography(quad_abcd):
    """Homography from model table coords (metres) to image pixels."""
    H, _ = cv2.findHomography(
        MODEL_QUAD.astype(np.float32),
        np.asarray(quad_abcd, dtype=np.float32))
    return H


def project(H, pts_m):
    pts = np.asarray(pts_m, dtype=np.float64)
    ones = np.ones((len(pts), 1))
    p = (H @ np.hstack([pts, ones]).T).T
    return p[:, :2] / p[:, 2:3]


def net_line_from_quad(quad_abcd):
    """The net line on the table plane, from geometry alone.

    The net crosses the table halfway along the 2.740 m sides. Returns the
    two points where the net tape meets the sidelines, plus the post feet
    0.1525 m outside each sideline — all on the table plane, all pure
    homography, no camera model needed.
    """
    H = table_homography(quad_abcd)
    y_mid = TABLE_L / 2.0
    on_table = project(H, [[0.0, y_mid], [TABLE_W, y_mid]])
    feet = project(H, [[-NET_OVERHANG, y_mid], [TABLE_W + NET_OVERHANG, y_mid]])
    return {"left": on_table[0], "right": on_table[1],
            "post_left_foot": feet[0], "post_right_foot": feet[1], "H": H}


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

CORNER_NAMES = "ABCD"


def draw_quad(image, quad, color, thickness=2, names=True):
    q = np.asarray(quad).round().astype(int)
    cv2.polylines(image, [q.reshape(-1, 1, 2)], True, color, thickness,
                  cv2.LINE_AA)
    if names:
        for i, (x, y) in enumerate(q):
            cv2.circle(image, (x, y), 5, color, -1, cv2.LINE_AA)
            cv2.putText(image, CORNER_NAMES[i], (x + 8, y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)
    return image


def debug_panel(frame, mask, pred_quad, truth_quad, net, text_lines):
    """Original | mask | overlay, side by side, annotated."""
    h, w = frame.shape[:2]
    overlay = frame.copy()
    if mask is not None:
        tint = np.zeros_like(frame)
        tint[mask > 0] = (0, 200, 255)
        overlay = cv2.addWeighted(overlay, 1.0, tint, 0.25, 0)
    if truth_quad is not None:
        draw_quad(overlay, truth_quad, (60, 220, 60), 2, names=False)
    if pred_quad is not None:
        draw_quad(overlay, pred_quad, (0, 80, 255), 2)
    if net is not None:
        l = tuple(np.round(net["left"]).astype(int))
        r = tuple(np.round(net["right"]).astype(int))
        cv2.line(overlay, l, r, (255, 200, 0), 2, cv2.LINE_AA)
        for k in ("post_left_foot", "post_right_foot"):
            p = tuple(np.round(net[k]).astype(int))
            cv2.circle(overlay, p, 6, (255, 200, 0), 2, cv2.LINE_AA)
    mask_rgb = (np.dstack([mask] * 3) if mask is not None
                else np.zeros_like(frame))
    if mask_rgb.dtype != np.uint8:
        mask_rgb = (mask_rgb > 0).astype(np.uint8) * 255
    panel = np.hstack([frame, mask_rgb, overlay])
    y = 30
    for line in text_lines:
        cv2.putText(panel, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (255, 255, 255), 2, cv2.LINE_AA)
        y += 30
    return panel


# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------

def check_truth_winding(corpus):
    """All truth quads must share one winding; report the near-end habit."""
    signs = []
    for match, item in corpus.items():
        signs.append((match, signed_area(item["truth"]) > 0))
    positive = sum(1 for _, s in signs if s)
    return {"n": len(signs), "positive_area": positive,
            "negative_area": len(signs) - positive}


if __name__ == "__main__":
    corpus = load_corpus()
    print(f"{len(corpus)} matches")
    print(check_truth_winding(corpus))
    # sanity: near end (A-B midpoint) should sit lower than far (C-D)
    lower = 0
    for item in corpus.values():
        t = item["truth"]
        if (t[0, 1] + t[1, 1]) / 2 > (t[2, 1] + t[3, 1]) / 2:
            lower += 1
    print(f"near end lower in frame: {lower}/{len(corpus)}")
