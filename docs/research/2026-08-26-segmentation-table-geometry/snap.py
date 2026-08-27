"""Snap a nearly-correct table quad onto the image's own edges.

The SAM mask boundary is quantised by the model's internal resolution, so
its corners wobble by a few pixels even when the mask is right. The
table's physical edge, though, is one of the sharpest gradients in the
picture. Given a quad already within a few pixels of the truth, each edge
is re-found as the gradient ridge inside a narrow corridor around it, and
the corners are re-cut from the refined lines.

The 2026-08-18 study killed open-field edge locking — nothing classical
FINDS a table edge in a whole frame. This is the other regime: the edge is
already found to within a corridor, and inside a corridor the gradient
ridge is exactly where the edge is. The corridor is what makes it safe.
"""

from __future__ import annotations

import numpy as np
import cv2


def _gradients(gray):
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    return gx, gy


def _bilinear(img, xs, ys):
    h, w = img.shape[:2]
    xs = np.clip(xs, 0, w - 1.001)
    ys = np.clip(ys, 0, h - 1.001)
    x0, y0 = xs.astype(np.int32), ys.astype(np.int32)
    fx, fy = xs - x0, ys - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy)
            + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy
            + img[y0 + 1, x0 + 1] * fx * fy)


def snap_quad(gray, quad, corridor=9.0, step=6.0, iterations=2):
    """Refine each edge to the normal-gradient ridge beside it.

    Per edge: sample points along the middle 84%, walk the normal through
    the corridor, take the strongest |gradient . normal| response with a
    parabolic subpixel peak, and Huber-fit a line through the winners. A
    sample only counts when its peak clearly beats the corridor's median
    response, so featureless or occluded stretches abstain rather than
    vote. An edge with fewer than 8 voting samples keeps its line.

    Returns (refined quad, per-edge vote fractions).
    """
    gx, gy = _gradients(gray)
    votes = [0.0] * 4
    ts = np.arange(-corridor, corridor + 0.25, 0.5)
    for _ in range(iterations):
        lines = []
        for i in range(4):
            p, q = quad[i], quad[(i + 1) % 4]
            edge = q - p
            length = float(np.linalg.norm(edge))
            if length < 1e-6:
                return quad, votes
            d = edge / length
            n = np.array([-d[1], d[0]])
            m = max(int(length / step), 8)
            along = np.linspace(0.08, 0.92, m)[:, None] * length
            base = p[None, :] + along * d[None, :]
            # positions: (m, len(ts), 2)
            pos = base[:, None, :] + ts[None, :, None] * n[None, None, :]
            resp = np.abs(
                _bilinear(gx, pos[..., 0], pos[..., 1]) * n[0]
                + _bilinear(gy, pos[..., 0], pos[..., 1]) * n[1])
            peak_idx = resp.argmax(axis=1)
            peak_val = resp.max(axis=1)
            floor = np.median(resp, axis=1) * 2.0 + 1e-6
            good = (peak_val > floor) & (peak_idx > 0) \
                                      & (peak_idx < len(ts) - 1)
            if good.sum() < 8:
                lines.append(np.cross(np.append(p, 1.0), np.append(q, 1.0)))
                votes[i] = float(good.sum()) / m
                continue
            # parabolic subpixel offset around the discrete peak
            idx = peak_idx[good]
            rows = np.nonzero(good)[0]
            y0 = resp[rows, idx - 1]
            y1 = resp[rows, idx]
            y2 = resp[rows, idx + 1]
            denom = (y0 - 2 * y1 + y2)
            offset = np.where(np.abs(denom) > 1e-9,
                              0.5 * (y0 - y2) / denom, 0.0)
            t_star = ts[idx] + np.clip(offset, -0.5, 0.5) * 0.5
            snapped = base[good] + t_star[:, None] * n[None, :]
            vx, vy, x0, ly0 = cv2.fitLine(
                snapped.astype(np.float32), cv2.DIST_HUBER,
                0, 0.01, 0.01).flatten()
            lines.append(np.cross([x0, ly0, 1.0], [x0 + vx, ly0 + vy, 1.0]))
            votes[i] = float(good.sum()) / m
        new = []
        for i in range(4):
            c = np.cross(lines[(i - 1) % 4], lines[i])
            if abs(c[2]) < 1e-12:
                return quad, votes
            new.append(c[:2] / c[2])
        moved = np.array(new)
        # a snap is a refinement, not a jump: if any corner moved further
        # than the corridor allows, the ridge it found was something else
        if np.linalg.norm(moved - quad, axis=1).max() > corridor * 2.5:
            return quad, votes
        quad = moved
    return quad, votes
