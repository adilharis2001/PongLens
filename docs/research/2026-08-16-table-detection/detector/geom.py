"""Rectangle geometry for a table seen by an uncalibrated camera.

An ITTF table is 2.740m x 1.525m, so a correct quad is the perspective image
of a rectangle whose long/short ratio is 1.7967. That is a hard physical
fact, it needs no colour, and nothing in the current pipeline uses it.

Zhang & He (2006), "Whiteboard scanning and image enhancement", show that
for a planar rectangle imaged by a pinhole camera with square pixels and the
principal point at the image centre, the four image corners alone determine
both the focal length and the rectangle's aspect ratio. So a candidate quad
can be scored by how far the aspect it implies sits from 1.7967 -- a quad
stretched across a room implies an absurd ratio and is rejected on geometry,
with no reference to what colour anything is.
"""
from __future__ import annotations

import math

import numpy as np

TABLE_LENGTH_M = 2.740
TABLE_WIDTH_M = 1.525
TABLE_RATIO = TABLE_LENGTH_M / TABLE_WIDTH_M  # 1.7967


def _h(point, cx, cy):
    return np.array([point[0] - cx, point[1] - cy, 1.0], dtype=np.float64)


def recover_rectangle(quad, width, height):
    """Focal length and length/width ratio implied by a quad.

    quad is cyclic A_near_left, B_near_right, C_far_right, D_far_left.
    Returns None when the configuration is degenerate (parallel edges in the
    image, which happens for a perfectly fronto-parallel view and is not an
    error, just a case this cannot resolve).
    """
    quad = np.asarray(quad, dtype=np.float64)
    if quad.shape != (4, 2):
        return None
    cx, cy = width / 2.0, height / 2.0

    # Zhang-He wants m1,m2 one side and m1,m3 the adjacent side. Map the
    # table's far edge to m1-m2 and its left side to m1-m3.
    a, b, c, d = quad
    m1, m2, m3, m4 = _h(d, cx, cy), _h(c, cx, cy), _h(a, cx, cy), _h(b, cx, cy)

    try:
        den2 = np.dot(np.cross(m2, m4), m3)
        den3 = np.dot(np.cross(m3, m4), m2)
        if abs(den2) < 1e-12 or abs(den3) < 1e-12:
            return None
        k2 = np.dot(np.cross(m1, m4), m3) / den2
        k3 = np.dot(np.cross(m1, m4), m2) / den3

        n2 = k2 * m2 - m1
        n3 = k3 * m3 - m1

        # f^2 from the orthogonality of the two vanishing directions.
        if abs(n2[2]) < 1e-12 or abs(n3[2]) < 1e-12:
            return None
        f_sq = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2])
        if not np.isfinite(f_sq) or f_sq <= 0:
            return None
        f = math.sqrt(f_sq)

        m = np.diag([1.0 / f_sq, 1.0 / f_sq, 1.0])
        num = float(n2 @ m @ n2)
        den = float(n3 @ m @ n3)
        if den <= 0 or num <= 0:
            return None
        # n2 spans the far edge (table WIDTH), n3 the side (table LENGTH).
        width_over_length = math.sqrt(num / den)
        if width_over_length <= 0:
            return None
        return {"focal_px": f, "ratio": 1.0 / width_over_length}
    except (ValueError, ZeroDivisionError, FloatingPointError):
        return None


def ratio_error(quad, width, height):
    """How far the quad's implied length/width sits from a real table.

    Returned as a log ratio so that 2x too long and 2x too short score the
    same, and so the number stays meaningful across the huge range that
    wrong quads produce.
    """
    recovered = recover_rectangle(quad, width, height)
    if not recovered:
        return None
    return abs(math.log(recovered["ratio"] / TABLE_RATIO))


def quad_area(quad):
    quad = np.asarray(quad, dtype=np.float64)
    x, y = quad[:, 0], quad[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def is_convex(quad):
    # numpy 2 removed the 2-D cross product, so the z component is written
    # out. Silently returning a ValueError here cost a whole blind run.
    quad = np.asarray(quad, dtype=np.float64)
    signs = []
    for i in range(4):
        a, b, c = quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]
        u, v = b - a, c - b
        signs.append(np.sign(u[0] * v[1] - u[1] * v[0]))
    return all(s > 0 for s in signs) or all(s < 0 for s in signs)


def diagonal_intersection(quad):
    """Where the diagonals cross. Under perspective this is the image of the
    rectangle's centre, so the net -- which spans the midline -- must pass
    through it. A projective invariant, free to check."""
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = [tuple(p) for p in quad]
    d1 = np.cross([x1, y1, 1.0], [x3, y3, 1.0])
    d2 = np.cross([x2, y2, 1.0], [x4, y4, 1.0])
    p = np.cross(d1, d2)
    if abs(p[2]) < 1e-12:
        return None
    return (p[0] / p[2], p[1] / p[2])


def vanishing_points(quad):
    """Where the two pairs of opposite edges meet. Infinite (None) when an
    edge pair is parallel in the image."""
    a, b, c, d = [np.array([p[0], p[1], 1.0]) for p in quad]
    out = []
    for p, q, r, s in ((a, b, d, c), (a, d, b, c)):
        v = np.cross(np.cross(p, q), np.cross(r, s))
        out.append(None if abs(v[2]) < 1e-9 else (v[0] / v[2], v[1] / v[2]))
    return out
