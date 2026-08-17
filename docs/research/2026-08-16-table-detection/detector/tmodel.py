"""A metric table template, and what it costs to place it on an image.

The table is 2.740 x 1.525 m and carries a net across the middle and a
centre line down its length. Those are known lengths, so the model is
fitted to the picture rather than assembled out of whatever fragments the
picture happens to offer.

Table coordinates: x along the length, y across the width, origin at the
centre of the playing surface.

    A = (-L/2, -W/2)   near left      A->B spans the WIDTH (an end line)
    B = (-L/2, +W/2)   near right     B->C spans the LENGTH (a side line)
    C = (+L/2, +W/2)   far right
    D = (+L/2, -W/2)   far left
    net        x = 0,  y in [-W/2, +W/2]
    centreline y = 0,  x in [-L/2, +L/2]
"""
from __future__ import annotations

import math

import numpy as np
import cv2

import geom

L = geom.TABLE_LENGTH_M
W = geom.TABLE_WIDTH_M

CORNERS = np.array([[-L / 2, -W / 2],
                    [-L / 2, +W / 2],
                    [+L / 2, +W / 2],
                    [+L / 2, -W / 2]], dtype=np.float64)


def _seg(p0, p1, n):
    t = (np.arange(n) + 0.5) / n
    p0 = np.asarray(p0, float)
    p1 = np.asarray(p1, float)
    pts = p0[None, :] + t[:, None] * (p1 - p0)[None, :]
    d = p1 - p0
    d = d / (np.linalg.norm(d) + 1e-12)
    return pts, np.tile(d, (n, 1))


def _build_template():
    outline_p, outline_d, outline_w = [], [], []
    per_m = 22.0  # sample density, points per metre of tape
    for i in range(4):
        a, b = CORNERS[i], CORNERS[(i + 1) % 4]
        n = max(6, int(round(np.linalg.norm(b - a) * per_m)))
        p, d = _seg(a, b, n)
        outline_p.append(p)
        outline_d.append(d)
        outline_w.append(np.full(n, 1.0))
    net_p, net_d = _seg((0, -W / 2), (0, +W / 2), int(W * per_m))
    ctr_p, ctr_d = _seg((-L / 2, 0), (+L / 2, 0), int(L * per_m))
    return {
        "outline_p": np.vstack(outline_p),
        "outline_d": np.vstack(outline_d),
        "net_p": net_p, "net_d": net_d,
        "ctr_p": ctr_p, "ctr_d": ctr_d,
    }


TPL = _build_template()


def _interior_grid():
    """Points strictly inside the surface, away from the net and the lines."""
    xs = np.linspace(-L / 2 * 0.86, L / 2 * 0.86, 22)
    ys = np.linspace(-W / 2 * 0.80, W / 2 * 0.80, 12)
    gx, gy = np.meshgrid(xs, ys)
    p = np.stack([gx.ravel(), gy.ravel()], axis=1)
    keep = (np.abs(p[:, 0]) > 0.18) & (np.abs(p[:, 1]) > 0.06)
    return p[keep]


INTERIOR = _interior_grid()

# A ring just outside the playing surface, used only for contrast.
_ring = []
for f in (1.14,):
    for i in range(4):
        a, b = CORNERS[i] * f, CORNERS[(i + 1) % 4] * f
        p, _ = _seg(a, b, 18)
        _ring.append(p)
RING = np.vstack(_ring)


def H_from_quad(quad):
    """Homography taking table metres to image pixels."""
    q = np.asarray(quad, dtype=np.float32)
    return cv2.getPerspectiveTransform(CORNERS.astype(np.float32), q)


def apply_H(H, pts):
    p = np.asarray(pts, dtype=np.float64)
    ph = np.concatenate([p, np.ones((len(p), 1))], axis=1)
    out = ph @ np.asarray(H, dtype=np.float64).T
    z = out[:, 2:3]
    bad = np.abs(z[:, 0]) < 1e-9
    z = np.where(np.abs(z) < 1e-9, 1e-9, z)
    xy = out[:, :2] / z
    return xy, bad


def quad_from_H(H):
    q, _ = apply_H(H, CORNERS)
    return q


def _sample(img, pts):
    """Bilinear lookup, clamped at the border.

    Written out rather than calling cv2.remap: the point sets here are a
    couple of hundred long and the per-call overhead dominated everything.
    """
    h, w = img.shape[:2]
    x = np.clip(pts[:, 0], 0, w - 1.001)
    y = np.clip(pts[:, 1], 0, h - 1.001)
    x0 = x.astype(np.int32)
    y0 = y.astype(np.int32)
    x1 = x0 + 1
    y1 = y0 + 1
    fx = x - x0
    fy = y - y0
    if img.ndim == 3:
        fx = fx[:, None]
        fy = fy[:, None]
    v = (img[y0, x0] * ((1 - fx) * (1 - fy))
         + img[y0, x1] * (fx * (1 - fy))
         + img[y1, x0] * ((1 - fx) * fy)
         + img[y1, x1] * (fx * fy))
    return v if img.ndim == 3 else v[:, None]


def _dirs_in_image(H, pts, dirs, eps=0.02):
    """Image-space tangent of a template direction, by finite difference."""
    a, _ = apply_H(H, pts)
    b, _ = apply_H(H, pts + dirs * eps)
    d = b - a
    n = np.linalg.norm(d, axis=1, keepdims=True)
    return d / np.maximum(n, 1e-9)


def _dt_lookup(ev, pts, dirs):
    """Directional chamfer: distance to the nearest edge of like orientation.

    Nearest-neighbour in space is enough here -- a distance transform is
    1-Lipschitz, so half a pixel of sampling error is half a pixel of cost
    error, and the value is truncated anyway.
    """
    nb, h, w = ev.dts.shape
    ang = np.arctan2(dirs[:, 1], dirs[:, 0]) % np.pi
    b = np.clip((ang / np.pi * nb).astype(np.int32), 0, nb - 1)
    xi = np.clip(pts[:, 0].astype(np.int32), 0, w - 1)
    yi = np.clip(pts[:, 1].astype(np.int32), 0, h - 1)
    return ev.dts[b, yi, xi]


AREA_LO = 0.004   # fraction of frame; below this a table is unreadably small
AREA_HI = 0.20    # above this the "table" is a wall or a floor
RATIO_CAP = 0.85  # the Zhang-He ratio is too unstable here to trust further


def cost(quad, ev, want_parts=False):
    """Lower is better. Returns +inf for a quad that is not a table at all."""
    quad = np.asarray(quad, dtype=np.float64)
    if not np.all(np.isfinite(quad)):
        return (math.inf, {}) if want_parts else math.inf
    if not geom.is_convex(quad):
        return (math.inf, {}) if want_parts else math.inf

    frame_area = float(ev.w * ev.h)
    area = geom.quad_area(quad)
    af = area / frame_area
    if af < AREA_LO * 0.5 or af > AREA_HI * 1.6:
        return (math.inf, {}) if want_parts else math.inf
    # a quad whose centre has left the picture is not a table in this frame
    cx, cy = quad[:, 0].mean(), quad[:, 1].mean()
    if not (-0.05 * ev.w <= cx <= 1.05 * ev.w and -0.05 * ev.h <= cy <= 1.05 * ev.h):
        return (math.inf, {}) if want_parts else math.inf
    # degenerate slivers
    el = np.linalg.norm(np.roll(quad, -1, axis=0) - quad, axis=1)
    if el.min() < 6.0:
        return (math.inf, {}) if want_parts else math.inf

    H = H_from_quad(quad)

    # --- boundary: the four tape lines -----------------------------------
    op, _ = apply_H(H, TPL["outline_p"])
    od = _dirs_in_image(H, TPL["outline_p"], TPL["outline_d"])
    dt = _dt_lookup(ev, op, od)
    trunc = float(ev.dts.max()) or 1.0
    chamfer = float(np.mean(np.minimum(dt, trunc)) / trunc)
    # support: how much of the outline actually sits on an edge at all
    support = float(np.mean(dt < ev.near_px))

    ridge = _sample(ev.ridge_n, op)[:, 0]
    ridge_sup = float(np.mean(ridge > 0.25))

    # --- interior: one surface, not a scene ------------------------------
    ip, _ = apply_H(H, INTERIOR)
    inside_ok = ((ip[:, 0] >= 0) & (ip[:, 0] < ev.w) & (ip[:, 1] >= 0) & (ip[:, 1] < ev.h))
    if inside_ok.mean() < 0.6:
        return (math.inf, {}) if want_parts else math.inf
    ls = _sample(ev.local_std_n, ip)[:, 0]
    uniform = float(np.mean(np.minimum(ls, 3.0)))

    lab_in = _sample(ev.lab, ip)
    med_in = np.median(lab_in, axis=0)
    rp, _ = apply_H(H, RING)
    lab_out = _sample(ev.lab, rp)
    d_out = np.linalg.norm(lab_out - med_in[None, :], axis=1)
    contrast = float(np.median(d_out) / ev.lab_scale)

    # --- the net and the centre line -------------------------------------
    np_, _ = apply_H(H, TPL["net_p"])
    lab_net = _sample(ev.lab, np_)
    net_diff = float(np.median(np.linalg.norm(lab_net - med_in[None, :], axis=1)) / ev.lab_scale)
    nd = _dirs_in_image(H, TPL["net_p"], TPL["net_d"])
    net_chamfer = float(np.mean(np.minimum(_dt_lookup(ev, np_, nd), trunc)) / trunc)

    cp, _ = apply_H(H, TPL["ctr_p"])
    ctr_ridge = float(np.mean(_sample(ev.ridge_n, cp)[:, 0] > 0.18))

    # --- priors ----------------------------------------------------------
    re = geom.ratio_error(quad, ev.w, ev.h)
    ratio_pen = RATIO_CAP if re is None else min(re, RATIO_CAP)
    lo, hi = math.log(AREA_LO), math.log(AREA_HI)
    la = math.log(max(af, 1e-6))
    area_pen = 0.0 if lo <= la <= hi else (min(abs(la - lo), abs(la - hi)) ** 2)

    total = (2.40 * chamfer
             - 0.90 * support
             - 0.55 * ridge_sup
             + 0.85 * uniform
             - 0.60 * min(contrast, 1.2)
             + 0.45 * net_chamfer
             - 0.35 * min(net_diff, 1.2)
             - 0.25 * ctr_ridge
             + 0.40 * ratio_pen
             + 0.60 * area_pen)

    if want_parts:
        return total, {"chamfer": chamfer, "support": support, "ridge": ridge_sup,
                       "uniform": uniform, "contrast": contrast,
                       "net_chamfer": net_chamfer, "net_diff": net_diff,
                       "ctr": ctr_ridge, "ratio": ratio_pen, "area_pen": area_pen,
                       "area_frac": af}
    return total
