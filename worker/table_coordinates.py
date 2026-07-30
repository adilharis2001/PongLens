"""Canonical physical table coordinates shared by placement calibrations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np


TABLE_WIDTH_M = 1.525
TABLE_LENGTH_M = 2.74


@dataclass(frozen=True)
class CanonicalQuad:
    corners: np.ndarray
    reordered: bool
    source_winding: str


def _signed_area(corners: np.ndarray) -> float:
    x = corners[:, 0]
    y = corners[:, 1]
    return float(
        0.5
        * (
            np.dot(x, np.roll(y, -1))
            - np.dot(y, np.roll(x, -1))
        )
    )


def canonicalize_table_quad(
    corners: Sequence[Sequence[float]],
    *,
    near_pair: tuple[int, int] | None,
) -> CanonicalQuad:
    """Return near-left, near-right, far-right, far-left image corners."""

    quad = np.asarray(corners, dtype=np.float32)
    if quad.shape != (4, 2) or not np.isfinite(quad).all():
        raise ValueError("table corners must be four finite points")
    if near_pair is None:
        raise ValueError("near pair is required")
    near_indices = tuple(int(value) for value in near_pair)
    if (
        len(set(near_indices)) != 2
        or any(index < 0 or index >= 4 for index in near_indices)
    ):
        raise ValueError("near pair must identify two distinct corners")

    near = quad[list(near_indices)]
    if abs(float(near[0, 0]) - float(near[1, 0])) <= 1e-4:
        raise ValueError("near edge left/right orientation is ambiguous")
    near_left, near_right = near[np.argsort(near[:, 0])]

    far_indices = [
        index for index in range(4) if index not in set(near_indices)
    ]
    far = quad[far_indices]
    if abs(float(far[0, 0]) - float(far[1, 0])) <= 1e-4:
        raise ValueError("far edge left/right orientation is ambiguous")
    far_left, far_right = far[np.argsort(far[:, 0])]

    canonical = np.asarray(
        [near_left, near_right, far_right, far_left],
        dtype=np.float32,
    )
    if not cv2.isContourConvex(canonical.astype(np.int32)):
        raise ValueError("canonical table quad is not convex")
    area = _signed_area(canonical)
    if abs(area) <= 1e-4:
        raise ValueError("canonical table quad is degenerate")

    source_area = _signed_area(quad)
    source_winding = (
        "counterclockwise" if source_area > 0 else "clockwise"
    )
    return CanonicalQuad(
        corners=canonical,
        reordered=not np.array_equal(quad, canonical),
        source_winding=source_winding,
    )


def table_homography(quad: CanonicalQuad) -> np.ndarray:
    destination = np.asarray(
        [
            [0.0, 0.0],
            [TABLE_WIDTH_M, 0.0],
            [TABLE_WIDTH_M, TABLE_LENGTH_M],
            [0.0, TABLE_LENGTH_M],
        ],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(quad.corners, destination)
    if (
        not np.isfinite(matrix).all()
        or abs(float(np.linalg.det(matrix))) <= 1e-10
    ):
        raise ValueError("canonical table homography is singular")
    return matrix
