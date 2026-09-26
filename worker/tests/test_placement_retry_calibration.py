import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

from worker import placement_retry_calibration as retry_calibration
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

    def test_normal_generation_never_calls_vision_after_deterministic_failure(self):
        vision_calls = []
        probe_patch, gate_patch, frames_patch = self.patches()
        with probe_patch, gate_patch, frames_patch:
            outcome = retry_calibration.calibrate_for_retry(
                "source.mp4",
                self.blurball,
                self.root,
                api_key="unused",
                model="unused",
                allow_vision=False,
                deterministic_calibrator=lambda *args, **kwargs: None,
                vision_request=lambda *args, **kwargs: vision_calls.append(True),
            )

        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.code, "keypoint_calibration_declined")
        self.assertEqual(vision_calls, [])

    def test_stronger_strategy_still_calls_vision_after_deterministic_failure(self):
        probe_patch, gate_patch, frames_patch = self.patches()
        with probe_patch, gate_patch, frames_patch:
            outcome = retry_calibration.calibrate_for_retry(
                "source.mp4",
                self.blurball,
                self.root,
                api_key="test",
                model="test-model",
                allow_vision=True,
                deterministic_calibrator=lambda *args, **kwargs: None,
                vision_request=lambda *args, **kwargs: VALID,
                rim_snapper=lambda *args, **kwargs: GOOD_QUAD.copy(),
            )

        self.assertTrue(outcome.ok)

    def test_calibrate_cli_exposes_deterministic_and_stronger_strategies(self):
        source = Path(retry_calibration.__file__).read_text()
        self.assertIn('"--strategy"', source)
        self.assertIn('choices=("deterministic", "stronger")', source)

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


# ---------------------------------------------------------------------------
# Reusing a table an earlier cut of the same upload found (audit D)
# ---------------------------------------------------------------------------
FIXTURE_636F = json.loads(
    (Path(__file__).parent / "fixtures" / "prior-table-636f3f37.json").read_text())
RAW = "r2://ponglens-raw/owner/original.mov"


def stored(calibration=None, *, source=None, document_raw=RAW, raw=RAW,
           relation="replaced"):
    automatic = FIXTURE_636F["automatic"]
    return {
        "document": {
            "calibration": calibration or automatic["calibration"],
            "source": source or automatic["source"],
        },
        "document_raw_path": document_raw,
        "raw_path": raw,
        "reused_from": {"relation": relation, "match_id": "m",
                        "processing_version_id": "8bdf5aad",
                        "match_json_path": "r2://ponglens-media/points/x/match.json"},
    }


class ReuseStoredTableTests(unittest.TestCase):
    def test_636f3f37s_table_comes_back_as_a_fresh_table_would(self):
        from worker.points_pipeline import _canonical_calibration_geometry

        outcome = retry_calibration.reuse_stored_table(stored(), 1920, 1080)
        self.assertTrue(outcome.ok)
        table = outcome.calibration
        corners = FIXTURE_636F["automatic"]["calibration"]["table_corners_px"]
        quad = np.asarray([corners[n] for n in retry_calibration.CORNER_NAMES],
                          dtype=np.float32)
        expected, _h, axis, reordered = _canonical_calibration_geometry(quad)
        self.assertEqual(table["table_corners_px"], {
            name: [round(float(p[0]), 1), round(float(p[1]), 1)]
            for name, p in zip(retry_calibration.CORNER_NAMES, expected)})
        self.assertEqual(table["length_axis"], [float(axis[0]), float(axis[1])])
        self.assertEqual(table["orientation"], "canonical-v1")
        self.assertIs(table["legacy_reordered"], bool(reordered))
        self.assertEqual(table["source"], "vision")
        self.assertTrue(table["note"].startswith("vision-proposed quad"),
                        "the admin page reads the note's front")
        self.assertTrue(table["note"].endswith(
            "; reused from the cut this one replaced"))
        self.assertEqual(table["reused_from"]["processing_version_id"], "8bdf5aad")
        self.assertEqual(set(json.loads(json.dumps(
            retry_calibration.asdict(outcome)))), {"ok", "code", "calibration"})

    def test_near_and_far_come_from_the_picture_not_the_labels(self):
        """A stored quad whose labels name the far end line 'near' is put
        right, exactly as _canonical_calibration_geometry puts a fresh one
        right: the near end line is the one lower in the frame."""
        right = FIXTURE_636F["automatic"]["calibration"]["table_corners_px"]
        swapped = dict(FIXTURE_636F["automatic"]["calibration"])
        swapped["table_corners_px"] = {
            "A_near_1": right["D_far_1"], "B_near_2": right["C_far_2"],
            "C_far_2": right["B_near_2"], "D_far_1": right["A_near_1"]}
        outcome = retry_calibration.reuse_stored_table(
            stored(swapped), 1920, 1080)
        self.assertTrue(outcome.ok)
        self.assertEqual(outcome.calibration["table_corners_px"], {
            name: [float(v) for v in right[name]]
            for name in retry_calibration.CORNER_NAMES})
        self.assertTrue(outcome.calibration["legacy_reordered"])

    def test_every_refusal(self):
        automatic = FIXTURE_636F["automatic"]["calibration"]
        pink = dict(automatic, source="pink_rim")
        degenerate = dict(automatic, table_corners_px={
            "A_near_1": [100, 500], "B_near_2": [200, 500],
            "C_far_2": [300, 500], "D_far_1": [400, 500]})
        cases = {
            "pink rim": (stored(pink), 1920, 1080),
            "another upload": (stored(document_raw="r2://ponglens-raw/owner/other.mov"),
                               1920, 1080),
            "frame size differs from the probe": (stored(), 1280, 720),
            "stored frame size differs": (
                stored(source={"width": 3840, "height": 2160}), 1920, 1080),
            "absent": (stored({"ok": False}), 1920, 1080),
            "degenerate": (stored(degenerate), 1920, 1080),
            "not a request": (None, 1920, 1080),
        }
        for name, (request, width, height) in cases.items():
            with self.subTest(name):
                outcome = retry_calibration.reuse_stored_table(request, width, height)
                self.assertFalse(outcome.ok)
                self.assertIsNone(outcome.calibration)
                self.assertEqual(outcome.code, "stored_table_refused")

    def test_the_cuts_own_table_keeps_where_it_came_from(self):
        carried = retry_calibration.reuse_stored_table(stored(), 1920, 1080).calibration
        again = retry_calibration.reuse_stored_table(
            stored(carried, relation="own"), 1920, 1080).calibration
        self.assertEqual(again["table_corners_px"], carried["table_corners_px"])
        self.assertEqual(again["note"], carried["note"], "no second suffix")
        self.assertEqual(again["reused_from"], carried["reused_from"])

    def test_the_command_probes_the_video_itself(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "stored.json").write_text(json.dumps(stored()))
            for probed, ok in (((1920, 1080), True), ((1280, 720), False)):
                with self.subTest(probed=probed), \
                        patch.object(retry_calibration, "probe", return_value={
                            "width": probed[0], "height": probed[1],
                            "fps": 59.947, "duration": 964.42}) as probe, \
                        patch("sys.argv", [
                            "placement_retry_calibration.py", "reuse",
                            "--stored", str(root / "stored.json"),
                            "--video", str(root / "source.mp4"),
                            "--output", str(root / "out.json")]):
                    self.assertEqual(retry_calibration.main(), 0)
                    probe.assert_called_once_with(str(root / "source.mp4"))
                    result = json.loads((root / "out.json").read_text())
                    self.assertEqual(set(result), {"ok", "code", "calibration"})
                    self.assertIs(result["ok"], ok)
