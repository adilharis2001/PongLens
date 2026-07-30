import unittest

import cv2
import numpy as np

from worker.table_coordinates import (
    canonicalize_table_quad,
    table_homography,
)
from worker.points_pipeline import _canonical_calibration_geometry


def project(matrix: np.ndarray, point: tuple[float, float]) -> np.ndarray:
    source = np.asarray([[point]], dtype=np.float32)
    return cv2.perspectiveTransform(source, matrix)[0, 0]


class CanonicalTableQuadTests(unittest.TestCase):
    def setUp(self):
        self.near_left = [100.0, 300.0]
        self.near_right = [500.0, 300.0]
        self.far_right = [420.0, 100.0]
        self.far_left = [180.0, 100.0]

    def test_opposite_windings_project_to_identical_coordinates(self):
        forward = canonicalize_table_quad(
            [
                self.near_left,
                self.near_right,
                self.far_right,
                self.far_left,
            ],
            near_pair=(0, 1),
        )
        reverse = canonicalize_table_quad(
            [
                self.near_left,
                self.far_left,
                self.far_right,
                self.near_right,
            ],
            near_pair=(0, 3),
        )

        self.assertTrue(np.allclose(forward.corners, reverse.corners))
        self.assertTrue(
            np.allclose(
                project(table_homography(forward), (250.0, 210.0)),
                project(table_homography(reverse), (250.0, 210.0)),
            )
        )
        self.assertFalse(forward.reordered)
        self.assertTrue(reverse.reordered)

    def test_canonicalization_is_idempotent(self):
        first = canonicalize_table_quad(
            [
                self.near_left,
                self.near_right,
                self.far_right,
                self.far_left,
            ],
            near_pair=(0, 1),
        )
        second = canonicalize_table_quad(
            first.corners,
            near_pair=(0, 1),
        )

        self.assertTrue(np.array_equal(first.corners, second.corners))
        self.assertFalse(second.reordered)

    def test_near_edge_is_always_camera_left_to_right(self):
        result = canonicalize_table_quad(
            [
                self.near_right,
                self.near_left,
                self.far_left,
                self.far_right,
            ],
            near_pair=(0, 1),
        )

        self.assertEqual(result.corners[0].tolist(), self.near_left)
        self.assertEqual(result.corners[1].tolist(), self.near_right)
        self.assertEqual(result.corners[2].tolist(), self.far_right)
        self.assertEqual(result.corners[3].tolist(), self.far_left)

    def test_missing_or_degenerate_near_edge_is_rejected(self):
        corners = [
            self.near_left,
            self.near_right,
            self.far_right,
            self.far_left,
        ]
        with self.assertRaisesRegex(ValueError, "near pair"):
            canonicalize_table_quad(corners, near_pair=None)
        with self.assertRaisesRegex(ValueError, "near edge"):
            canonicalize_table_quad(
                [[100.0, 300.0], [100.0, 250.0], *corners[2:]],
                near_pair=(0, 1),
            )

    def test_deterministic_geometry_uses_canonical_winding(self):
        corners, matrix, axis, reordered = _canonical_calibration_geometry(
            np.asarray(
                [
                    self.near_right,
                    self.near_left,
                    self.far_left,
                    self.far_right,
                ],
                dtype=np.float32,
            )
        )

        self.assertEqual(corners[0].tolist(), self.near_left)
        self.assertEqual(corners[1].tolist(), self.near_right)
        self.assertTrue(reordered)
        self.assertAlmostEqual(float(np.linalg.norm(axis)), 1.0)
        self.assertTrue(
            np.allclose(
                project(matrix, (250.0, 210.0)),
                project(
                    table_homography(
                        canonicalize_table_quad(
                            corners,
                            near_pair=(0, 1),
                        )
                    ),
                    (250.0, 210.0),
                ),
            )
        )


if __name__ == "__main__":
    unittest.main()
