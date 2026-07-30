import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.vision_table_calibration import (
    reference_error,
    select_consensus,
    select_generic_representative_frames,
    validate_generic_candidate,
)


WIDTH = 320
HEIGHT = 180
GOOD_QUAD = np.asarray(
    [[131, 116], [96, 96], [179, 77], [221, 83]],
    dtype=np.float32,
)


def gray_table_frame(occluder_x: int | None = None) -> np.ndarray:
    image = np.full((HEIGHT, WIDTH, 3), 35, dtype=np.uint8)
    cv2.fillConvexPoly(image, GOOD_QUAD.astype(np.int32), (105, 105, 105))
    cv2.polylines(
        image,
        [GOOD_QUAD.astype(np.int32)],
        True,
        (235, 235, 235),
        2,
        cv2.LINE_AA,
    )
    if occluder_x is not None:
        cv2.rectangle(
            image,
            (occluder_x, 45),
            (min(WIDTH - 1, occluder_x + 24), 135),
            (15, 15, 15),
            -1,
        )
    return image


def proposal(corners: np.ndarray) -> dict:
    return {
        "width": WIDTH,
        "height": HEIGHT,
        "confidence": 0.93,
        "ambiguity_reason": "",
        "corners": {
            name: [float(point[0]), float(point[1])]
            for name, point in zip(
                ("A_near_1", "B_near_2", "C_far_2", "D_far_1"),
                corners,
            )
        },
    }


class GenericFrameSelectionTests(unittest.TestCase):
    def test_gray_table_produces_background_and_two_separated_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "gray-table.avi"
            writer = cv2.VideoWriter(
                str(video),
                cv2.VideoWriter_fourcc(*"MJPG"),
                12,
                (WIDTH, HEIGHT),
            )
            self.assertTrue(writer.isOpened())
            for frame in range(24):
                writer.write(gray_table_frame(20 + (frame * 9) % 250))
            writer.release()

            paths = select_generic_representative_frames(video, root / "out")

            self.assertEqual(
                [path.name for path in paths],
                [
                    "background.jpg",
                    "representative-1.jpg",
                    "representative-2.jpg",
                ],
            )
            self.assertTrue(
                all(
                    cv2.imread(str(path)).shape[:2] == (HEIGHT, WIDTH)
                    for path in paths
                )
            )


class GenericCandidateTests(unittest.TestCase):
    def setUp(self):
        self.image = gray_table_frame()
        self.detections = {
            frame: (145 + frame % 24, 90 + frame % 9)
            for frame in range(18)
        }

    def test_gray_table_is_accepted_without_colored_rim_evidence(self):
        result = validate_generic_candidate(
            raw=proposal(GOOD_QUAD),
            background=self.image,
            source_size=(WIDTH, HEIGHT),
            bounce_core=(90, 235, 65, 125),
            detections=self.detections,
        )

        self.assertTrue(result["accepted"], result)
        self.assertGreater(result["scores"]["edge_support"], 0.20)
        self.assertGreater(result["scores"]["projected_on_table"], 0)
        self.assertNotIn("magenta", json.dumps(result).lower())

    def test_floor_quad_is_rejected_by_local_evidence(self):
        shifted = GOOD_QUAD + np.asarray([0, 42], dtype=np.float32)
        result = validate_generic_candidate(
            raw=proposal(shifted),
            background=self.image,
            source_size=(WIDTH, HEIGHT),
            bounce_core=(90, 235, 65, 125),
            detections=self.detections,
        )

        self.assertFalse(result["accepted"])
        self.assertIn(
            result["reason"],
            {"geometry", "edge_support", "activity_overlap", "projection"},
        )


class ConsensusTests(unittest.TestCase):
    def test_two_close_trials_outvote_one_outlier(self):
        first = {"accepted": True, "corners": GOOD_QUAD.tolist()}
        close = {
            "accepted": True,
            "corners": (GOOD_QUAD + np.asarray([2, -1])).tolist(),
        }
        outlier = {
            "accepted": True,
            "corners": (GOOD_QUAD + np.asarray([45, 25])).tolist(),
        }

        consensus = select_consensus(
            [first, close, outlier],
            WIDTH,
            HEIGHT,
        )

        self.assertTrue(consensus["accepted"])
        self.assertEqual(consensus["agreeing_trials"], [0, 1])
        self.assertLessEqual(consensus["median_drift_ratio"], 0.02)
        self.assertLessEqual(consensus["maximum_drift_ratio"], 0.04)

    def test_reference_error_is_zero_for_identical_corners(self):
        result = reference_error(
            GOOD_QUAD,
            GOOD_QUAD,
            WIDTH,
            HEIGHT,
        )

        self.assertEqual(result["corner_ratios"], [0.0, 0.0, 0.0, 0.0])
        self.assertEqual(result["median_ratio"], 0.0)
        self.assertEqual(result["maximum_ratio"], 0.0)


if __name__ == "__main__":
    unittest.main()
