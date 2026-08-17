"""Recover a camera from a table-plane homography.

A homography from a metric plane to the image is K [r1 r2 t] up to scale.
With a pinhole K whose only unknown is the focal length, r1 and r2 must come
out unit length and perpendicular, and that pins the focal length down.

This exists to answer one question: could anybody have set this camera up?
A quad stitched out of two different tables — the near half of one and the
far half of its neighbour — still gives a mathematically valid homography,
but the camera it implies is usually below the playing surface, which is not
a camera that can see the playing surface. That is the cheapest test there
is for a hypothesis that spans two tables, and on the 2026-08-16 corpus it
is the only thing that saves `cb0e7027`, where eight frames land on the
neighbouring table and agree with each other to 0.16%.

No table-tennis knowledge here beyond the plane itself; see
table_keypoint_fit.py for what uses it.
"""

from __future__ import annotations

import math

import numpy as np


def focal_from_homography(H, cx: float, cy: float) -> list[float]:
    """Zhang's two single-plane constraints, each solved for f.

    Returns nothing when neither constraint has a positive solution — that
    is a homography no pinhole camera produces, and the caller treats an
    empty list as "cannot judge" rather than as a rejection.
    """
    h1 = np.asarray(H, dtype=np.float64)[:, 0].copy()
    h2 = np.asarray(H, dtype=np.float64)[:, 1].copy()
    for column in (h1, h2):                     # strip the principal point
        column[0] -= cx * column[2]
        column[1] -= cy * column[2]

    # r1 . r2 = 0    ->  (h1x h2x + h1y h2y) / f^2 + h1z h2z = 0
    # |r1| = |r2|    ->  (h1x^2 + h1y^2 - h2x^2 - h2y^2) / f^2
    #                     + h1z^2 - h2z^2 = 0
    numerators = (
        h1[0] * h2[0] + h1[1] * h2[1],
        h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2,
    )
    denominators = (h1[2] * h2[2], h1[2] ** 2 - h2[2] ** 2)

    focals = []
    for numerator, denominator in zip(numerators, denominators):
        if abs(denominator) <= 1e-12:
            continue
        value = -numerator / denominator
        if value > 0:
            focals.append(math.sqrt(value))
    return focals


def pose_from_homography(H, focal: float, cx: float, cy: float) -> dict | None:
    """Camera centre in table coordinates (metres), given a focal length."""
    K = np.array([[focal, 0.0, cx], [0.0, focal, cy], [0.0, 0.0, 1.0]])
    M = np.linalg.inv(K) @ np.asarray(H, dtype=np.float64)
    n1 = float(np.linalg.norm(M[:, 0]))
    n2 = float(np.linalg.norm(M[:, 1]))
    if n1 < 1e-12 or n2 < 1e-12:
        return None
    M = M * (1.0 / ((n1 + n2) / 2.0))
    r1, r2, t = M[:, 0], M[:, 1], M[:, 2]
    R = np.stack([r1, r2, np.cross(r1, r2)], axis=1)
    U, _s, Vt = np.linalg.svd(R)                # nearest true rotation
    R = U @ Vt
    centre = -R.T @ t
    if not np.all(np.isfinite(centre)):
        return None
    return {
        "height": float(centre[2]),
        "distance": float(math.hypot(centre[0], centre[1])),
        "focal": float(focal),
    }


def camera_candidates(H, canvas=(1920, 1080)) -> list[dict]:
    """Every camera consistent with this homography. Often two, sometimes none."""
    cx, cy = canvas[0] / 2.0, canvas[1] / 2.0
    out = []
    for focal in focal_from_homography(H, cx, cy):
        pose = pose_from_homography(H, focal, cx, cy)
        if pose is not None:
            out.append(pose)
    return out
