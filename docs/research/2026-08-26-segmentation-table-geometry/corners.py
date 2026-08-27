"""Segmentation mask -> four subpixel table corners.

The mask's boundary is ragged wherever a player, the net or motion blur
crosses the table edge, so single-pixel vertices are never trusted. The
shape that survives occlusion is the LINE each edge lies on:

  1. largest connected component, holes filled
  2. convex hull -> cv2.approxPolyN(4) for an initial quadrilateral
  3. each quad edge is re-fitted to the contour points that lie in a thin
     band around it (occluded stretches simply contribute no points), with
     a Huber loss so a few stragglers cannot drag the line
  4. adjacent lines intersect -> subpixel corners; iterate

Quality is reported, never assumed:
  quad_iou      filled quad vs raw mask (occlusion lowers it, honestly)
  edge_support  fraction of the quad's perimeter with mask boundary nearby
                — the strongest signal that the mask is actually a table
                top and not a blob
"""

from __future__ import annotations

import numpy as np
import cv2

import common


def clean_mask(mask):
    """Largest connected component with its holes filled, or None."""
    binary = (mask > 0).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if n < 2:
        return None
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    component = (labels == largest).astype(np.uint8)
    contours, _ = cv2.findContours(
        component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    filled = np.zeros_like(component)
    cv2.drawContours(filled, contours, -1, 1, cv2.FILLED)
    return filled


def initial_quad(contour):
    """Convex hull -> exactly four vertices."""
    hull = cv2.convexHull(contour)
    approx = cv2.approxPolyN(hull.reshape(-1, 2), 4, ensure_convex=True)
    return approx.reshape(4, 2).astype(np.float64)


def _line_through(p, q):
    """Homogeneous line through two points."""
    a, b = np.append(p, 1.0), np.append(q, 1.0)
    return np.cross(a, b)


def _intersect(l1, l2):
    p = np.cross(l1, l2)
    if abs(p[2]) < 1e-12:
        return None
    return p[:2] / p[2]


def refine_quad(quad, contour_pts, iterations=3):
    """Re-fit each edge line to nearby contour points, re-intersect.

    Band width scales with apparent table size. Points near a corner are
    ambiguous between two edges and are excluded by trimming each edge's
    span. An edge with fewer than 30 supporting points keeps its current
    line — a fully occluded edge should not be invented from noise.
    """
    pts = contour_pts.astype(np.float64)
    for _ in range(iterations):
        area = abs(common.signed_area(quad))
        band = float(np.clip(0.02 * np.sqrt(max(area, 1.0)), 3.0, 20.0))
        lines = []
        for i in range(4):
            p, q = quad[i], quad[(i + 1) % 4]
            edge = q - p
            length = np.linalg.norm(edge)
            if length < 1e-6:
                return None, None
            direction = edge / length
            normal = np.array([-direction[1], direction[0]])
            rel = pts - p
            along = rel @ direction
            dist = np.abs(rel @ normal)
            keep = (dist <= band) & (along >= 0.08 * length) \
                                  & (along <= 0.92 * length)
            support = pts[keep]
            if len(support) >= 30:
                vx, vy, x0, y0 = cv2.fitLine(
                    support.astype(np.float32), cv2.DIST_HUBER,
                    0, 0.01, 0.01).flatten()
                lines.append(np.cross([x0, y0, 1.0],
                                      [x0 + vx, y0 + vy, 1.0]))
            else:
                lines.append(_line_through(p, q))
        new = []
        for i in range(4):
            corner = _intersect(lines[(i - 1) % 4], lines[i])
            if corner is None:
                return None, None
            new.append(corner)
        # intersection of edge i-1 and i is the corner at vertex i
        quad = np.array(new)
    support_frac = edge_support(quad, pts)
    return quad, support_frac


def edge_support(quad, contour_pts, tol=4.0):
    """Fraction of quad-perimeter samples with a contour point nearby."""
    samples = []
    for i in range(4):
        p, q = quad[i], quad[(i + 1) % 4]
        n = max(int(np.linalg.norm(q - p) / 12), 4)
        t = np.linspace(0.03, 0.97, n)[:, None]
        samples.append(p[None, :] * (1 - t) + q[None, :] * t)
    samples = np.vstack(samples)
    d = np.sqrt(((samples[:, None, :] -
                  contour_pts[None, :, :]) ** 2).sum(-1)).min(axis=1)
    return float((d <= tol).mean())


def quad_mask_iou(quad, mask):
    canvas = np.zeros(mask.shape, dtype=np.uint8)
    cv2.fillPoly(canvas, [np.round(quad).astype(np.int32)], 1)
    inter = int(np.logical_and(canvas, mask).sum())
    union = int(np.logical_or(canvas, mask).sum())
    return inter / union if union else 0.0


def contains_point(quad, point, tol=6.0):
    return cv2.pointPolygonTest(
        quad.astype(np.float32),
        (float(point[0]), float(point[1])), True) >= -tol


def select_surface(candidates, whole_mask, anchor_points=()):
    """Pick the candidate mask that is the PLAYING SURFACE, by geometry.

    SAM's granularities for a table are roughly whole-furniture, top, and
    one half of the top. The surface is the one whose boundary is actually
    a projective rectangle, so each candidate is fitted and judged:

      - its quad must contain every anchor point — one derived point per
        table half, both known to lie ON the surface. This kills the
        half-table candidates (a half cannot hold the other half's point).
        A silhouette-top test was tried first and failed: the net tape,
        not the far edge, is often the top of the table silhouette.
      - it must hold at least 30% of the silhouette's area (kills slivers)
      - among survivors, highest edge_support * sqrt(quad_iou) wins: legs
        and wheels make the whole-furniture quad both leak (iou) and
        wobble (support), while the true surface scores near 1 on both

    Returns (fit, mask, audit, reason-if-none).
    """
    whole_px = int((whole_mask > 0).sum()) if whole_mask is not None else 0
    audit, best = [], None
    for cand in candidates:
        entry = {"prompt": cand["prompt"], "sam_iou": cand["sam_iou"],
                 "px": int((cand["mask"] > 0).sum())}
        fit, reason = corners_from_mask(cand["mask"])
        if fit is None:
            entry["rejected"] = reason
            audit.append(entry)
            continue
        entry.update(edge_support=round(fit["edge_support"], 3),
                     quad_iou=round(fit["quad_iou"], 3))
        if whole_px and entry["px"] < 0.30 * whole_px:
            entry["rejected"] = "too small vs table silhouette"
            audit.append(entry)
            continue
        missing = [i for i, p in enumerate(anchor_points)
                   if p is not None and not contains_point(fit["quad"], p)]
        if missing:
            entry["rejected"] = f"anchor point {missing} outside quad"
            audit.append(entry)
            continue
        entry["score"] = fit["edge_support"] * np.sqrt(fit["quad_iou"])
        audit.append(entry)
        if best is None or entry["score"] > best[1]["score"]:
            best = (fit, entry, cand)
    if best is None:
        return None, None, audit, "no candidate survived selection"
    fit, entry, cand = best
    fit["selected"] = entry
    return fit, cand["mask"], audit, None


def corners_from_mask(mask):
    """Mask -> dict with cyclic quad + quality, or None with a reason."""
    filled = clean_mask(mask)
    if filled is None or int(filled.sum()) < 500:
        return None, "mask empty or tiny"
    contours, _ = cv2.findContours(
        filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea).reshape(-1, 2)
    if len(contour) < 40:
        return None, "contour too short"
    try:
        quad0 = initial_quad(contour)
    except cv2.error as err:
        return None, f"approxPolyN: {err}"
    quad, support = refine_quad(quad0, contour)
    if quad is None:
        return None, "refinement degenerated"
    quad = common.order_cyclic(quad)
    return {
        "quad": quad,
        "quad_initial": common.order_cyclic(quad0),
        "edge_support": support,
        "quad_iou": quad_mask_iou(quad, filled),
        "mask_px": int(filled.sum()),
    }, None
