import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

from worker.placement_retry_calibration import (
    calibrate_for_retry,
    parse_corner_proposal,
    validate_quad,
)


VALID = {
    "width": 1920,
    "height": 1080,
    "confidence": 0.91,
    "corners": {
        "A_near_1": [783, 697],
        "B_near_2": [578, 577],
        "C_far_2": [1074, 461],
        "D_far_1": [1327, 499],
    },
}

GOOD_QUAD = np.array(
    [[783, 697], [578, 577], [1074, 461], [1327, 499]],
    dtype=np.float32,
)


class ProposalTests(unittest.TestCase):
    def test_parses_finite_in_frame_corner_proposal(self):
        proposal = parse_corner_proposal(VALID, 1920, 1080)
        self.assertEqual(proposal.corners.shape, (4, 2))
        self.assertGreater(proposal.confidence, 0.8)

    def test_rejects_out_of_frame_or_low_confidence_proposal(self):
        bad = {**VALID, "confidence": 0.2}
        with self.assertRaisesRegex(ValueError, "confidence"):
            parse_corner_proposal(bad, 1920, 1080)
        bad = {
            **VALID,
            "corners": {**VALID["corners"], "D_far_1": [2500, 499]},
        }
        with self.assertRaisesRegex(ValueError, "frame"):
            parse_corner_proposal(bad, 1920, 1080)

    def test_quad_validation_rejects_nonconvex_and_accepts_table_geometry(self):
        validated = validate_quad(
            GOOD_QUAD,
            1920,
            1080,
            bounce_core=(512, 1280, 448, 640),
        )
        np.testing.assert_allclose(validated, GOOD_QUAD)
        bad = GOOD_QUAD[[0, 2, 1, 3]]
        with self.assertRaisesRegex(ValueError, "convex"):
            validate_quad(bad, 1920, 1080, bounce_core=None)


class CalibrationCascadeTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.blurball = self.root / "blurball.jsonl"
        self.blurball.write_text(
            json.dumps({"f": 1, "x": 900, "y": 550}) + "\n"
        )
        self.background = self.root / "background.jpg"
        cv2.imwrite(
            str(self.background),
            np.zeros((1080, 1920, 3), dtype=np.uint8),
        )
        self.det_result = {
            "corners_px": VALID["corners"],
            "e": [0.5, -0.86],
            "note": "deterministic",
        }

    def tearDown(self):
        self.tempdir.cleanup()

    def patches(self):
        return (
            patch(
                "worker.placement_retry_calibration.probe",
                return_value={
                    "width": 1920,
                    "height": 1080,
                    "fps": 30,
                    "duration": 10,
                },
            ),
            patch(
                "worker.placement_retry_calibration.activity_gate",
                return_value={"core": (512, 1280, 448, 640)},
            ),
            patch(
                "worker.placement_retry_calibration.representative_frames",
                return_value=[self.background],
            ),
        )

    def test_deterministic_success_skips_openai(self):
        deterministic = Mock(return_value=self.det_result)
        vision = Mock()
        probe_patch, gate_patch, frames_patch = self.patches()
        with probe_patch, gate_patch, frames_patch:
            outcome = calibrate_for_retry(
                "source.mp4",
                self.blurball,
                self.root,
                api_key="test",
                model="test-model",
                deterministic_calibrator=deterministic,
                vision_request=vision,
            )
        self.assertTrue(outcome.ok)
        self.assertEqual(outcome.calibration["note"], "deterministic")
        vision.assert_not_called()

    def test_deterministic_failure_calls_openai_once_and_uses_snapped_quad(self):
        deterministic = Mock(return_value=None)
        vision = Mock(return_value=VALID)
        snapper = Mock(return_value=GOOD_QUAD.copy())
        probe_patch, gate_patch, frames_patch = self.patches()
        with probe_patch, gate_patch, frames_patch:
            outcome = calibrate_for_retry(
                "source.mp4",
                self.blurball,
                self.root,
                api_key="test",
                model="test-model",
                deterministic_calibrator=deterministic,
                vision_request=vision,
                rim_snapper=snapper,
            )
        self.assertTrue(outcome.ok)
        vision.assert_called_once()
        self.assertEqual(
            outcome.calibration["table_corners_px"]["A_near_1"],
            [783.0, 697.0],
        )
        self.assertEqual(len(outcome.calibration["length_axis"]), 2)

    def test_invalid_vision_proposal_returns_expected_rejection(self):
        deterministic = Mock(return_value=None)
        vision = Mock(return_value={**VALID, "confidence": 0.1})
        probe_patch, gate_patch, frames_patch = self.patches()
        with probe_patch, gate_patch, frames_patch:
            outcome = calibrate_for_retry(
                "source.mp4",
                self.blurball,
                self.root,
                api_key="test",
                model="test-model",
                deterministic_calibrator=deterministic,
                vision_request=vision,
            )
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.code, "vision_calibration_rejected")
        self.assertIsNone(outcome.calibration)
