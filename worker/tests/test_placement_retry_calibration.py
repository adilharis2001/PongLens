import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

from worker.placement_retry_calibration import (
    CANONICAL_CORNER_NAMES,
    _write_cost_usage_sidecar,
    calibrate_for_retry,
    parse_corner_proposal,
    request_corner_proposal,
    validate_quad,
)


VALID = {
    "width": 1920,
    "height": 1080,
    "confidence": 0.91,
    "ambiguity_reason": "",
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
    def test_cost_sidecar_contains_only_aggregate_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "usage.json"
            with patch.dict(
                "os.environ",
                {"PONGLENS_COST_USAGE_OUTPUT": str(output)},
            ):
                _write_cost_usage_sidecar(
                    {
                        "id": "resp-1",
                        "usage": {
                            "input_tokens": 100,
                            "output_tokens": 20,
                            "input_tokens_details": {"cached_tokens": 10},
                        },
                        "output": [{"private": "model output"}],
                    },
                    "gpt-5.6-sol",
                )
            payload = json.loads(output.read_text())
            self.assertEqual(
                payload["usage"],
                {
                    "input_tokens": 100,
                    "output_tokens": 20,
                    "input_tokens_details": {"cached_tokens": 10},
                },
            )
            self.assertNotIn("output", payload)
            self.assertNotIn("private", str(payload))

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

    def test_request_defines_table_without_assuming_rim_color(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "frame.jpg"
            cv2.imwrite(
                str(image_path),
                np.zeros((108, 192, 3), dtype=np.uint8),
            )
            response = Mock()
            response.raise_for_status.return_value = None
            response.json.return_value = {
                "id": "resp-1",
                "usage": {"input_tokens": 10, "output_tokens": 5},
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        **VALID,
                                        "width": 192,
                                        "height": 108,
                                        "corners": {
                                            name: [value[0] / 10, value[1] / 10]
                                            for name, value in VALID[
                                                "corners"
                                            ].items()
                                        },
                                    }
                                ),
                            }
                        ],
                    }
                ],
            }
            with patch(
                "worker.placement_retry_calibration.requests.post",
                return_value=response,
            ) as post:
                request_corner_proposal(
                    [image_path],
                    api_key="secret",
                    model="test-model",
                )
                request_corner_proposal(
                    [image_path],
                    api_key="secret",
                    model="test-model",
                    reasoning_effort="low",
                    max_output_tokens=2400,
                )

            payload = post.call_args_list[0].kwargs["json"]
            prompt = payload["input"][0]["content"][0]["text"].lower()
            schema = payload["text"]["format"]["schema"]
            self.assertFalse(payload["store"])
            self.assertIn("visible playing surface", prompt)
            self.assertIn("not any paint color", prompt)
            self.assertIn("ambiguity_reason", schema["required"])
            self.assertEqual(
                set(schema["properties"]["corners"]["required"]),
                set(CANONICAL_CORNER_NAMES),
            )
            self.assertNotIn("reasoning", payload)
            self.assertEqual(payload["max_output_tokens"], 500)
            experiment_payload = post.call_args_list[1].kwargs["json"]
            self.assertEqual(
                experiment_payload["reasoning"]["effort"],
                "low",
            )
            self.assertEqual(experiment_payload["max_output_tokens"], 2400)


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
        self.assertEqual(
            outcome.calibration["table_corners_px"],
            {
                "A_near_1": [578.0, 577.0],
                "B_near_2": [783.0, 697.0],
                "C_far_2": [1327.0, 499.0],
                "D_far_1": [1074.0, 461.0],
            },
        )
        self.assertEqual(outcome.calibration["orientation"], "canonical-v1")
        self.assertTrue(outcome.calibration["legacy_reordered"])
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
            [578.0, 577.0],
        )
        self.assertEqual(
            outcome.calibration["table_corners_px"]["B_near_2"],
            [783.0, 697.0],
        )
        self.assertEqual(
            outcome.calibration["table_corners_px"]["C_far_2"],
            [1327.0, 499.0],
        )
        self.assertEqual(
            outcome.calibration["table_corners_px"]["D_far_1"],
            [1074.0, 461.0],
        )
        self.assertEqual(outcome.calibration["orientation"], "canonical-v1")
        self.assertTrue(outcome.calibration["legacy_reordered"])
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
