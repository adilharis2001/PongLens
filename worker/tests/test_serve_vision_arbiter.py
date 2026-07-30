import base64
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.eval.serve_vision_arbiter import (
    apply_arbiter,
    arbitrate,
    build_request,
    extract_candidate_frames,
    parse_response,
)


def image_url(marker: int) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(
        bytes([marker])
    ).decode("ascii")


class ServeVisionArbiterTests(unittest.TestCase):
    def test_request_contains_at_most_twelve_anonymous_frames(self):
        request = build_request(
            {
                "candidate-1": [image_url(index) for index in range(9)],
                "candidate-2": [
                    image_url(index) for index in range(9, 18)
                ],
            },
            model="test-model",
        )

        serialized = json.dumps(request)
        image_inputs = [
            part
            for item in request["input"]
            for part in item["content"]
            if part["type"] == "input_image"
        ]
        self.assertLessEqual(len(image_inputs), 12)
        self.assertEqual(len(image_inputs), 12)
        self.assertNotIn("match_id", serialized)
        self.assertNotIn("first_server", serialized)
        self.assertFalse(request["store"])
        self.assertTrue(request["text"]["format"]["strict"])

    def test_request_rejects_non_anonymous_candidate_ids(self):
        with self.assertRaisesRegex(ValueError, "anonymous"):
            build_request({"vaibhav-serve": [image_url(1)]})

    def test_api_cannot_override_hard_geometry_contradiction(self):
        local = {
            "status": "needs_review",
            "server_side": None,
            "reason": "selected_hypothesis_has_hard_contradiction",
        }
        result = apply_arbiter(
            local,
            {
                "candidate_id": "candidate-1",
                "server_side": "near",
                "confidence": 0.99,
                "reason": "looks like a serve",
            },
            allowed_candidate_ids={"candidate-1"},
        )
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["server_side"])
        self.assertEqual(
            result["api_status"],
            "blocked_by_geometry",
        )

    def test_high_confidence_api_can_resolve_margin_only_abstention(self):
        local = {
            "status": "needs_review",
            "server_side": None,
            "reason": "score_margin_too_small",
        }
        result = apply_arbiter(
            local,
            {
                "candidate_id": "candidate-2",
                "server_side": "far",
                "confidence": 0.94,
                "reason": "ordered serve sequence",
            },
            allowed_candidate_ids={"candidate-1", "candidate-2"},
        )
        self.assertEqual(result["status"], "high_confidence")
        self.assertEqual(result["server_side"], "far")
        self.assertEqual(result["source"], "vision_api")

    def test_provider_failure_preserves_local_abstention(self):
        local = {
            "status": "needs_review",
            "server_side": None,
            "reason": "score_margin_too_small",
        }

        def failing_provider(_request):
            raise RuntimeError("provider unavailable")

        result = arbitrate(
            local,
            {"candidate-1": [image_url(1)]},
            failing_provider,
        )
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["server_side"])
        self.assertEqual(result["api_status"], "failed")
        self.assertNotIn("provider unavailable", json.dumps(result))

    def test_response_parser_returns_usage_without_identity_fields(self):
        result = parse_response(
            {
                "id": "response-secret",
                "model": "test-model",
                "usage": {
                    "input_tokens": 123,
                    "output_tokens": 17,
                    "input_tokens_details": {"cached_tokens": 3},
                },
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "candidate_id": "candidate-1",
                                        "server_side": "near",
                                        "confidence": 0.91,
                                        "reason": "two ordered bounces",
                                    }
                                ),
                            }
                        ],
                    }
                ],
            },
            allowed_candidate_ids={"candidate-1"},
        )
        self.assertEqual(result["candidate_id"], "candidate-1")
        self.assertEqual(result["usage"]["input_tokens"], 123)
        self.assertNotIn("response-secret", json.dumps(result))

    def test_extract_candidate_frames_is_bounded_and_chronological(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            clip = Path(temp_dir) / "clip.avi"
            writer = cv2.VideoWriter(
                str(clip),
                cv2.VideoWriter_fourcc(*"MJPG"),
                10.0,
                (64, 48),
            )
            self.assertTrue(writer.isOpened())
            for index in range(30):
                writer.write(
                    np.full((48, 64, 3), index * 5, dtype=np.uint8)
                )
            writer.release()

            frames = extract_candidate_frames(
                clip,
                {
                    "candidate-1": 1.0,
                    "candidate-2": 2.0,
                    "candidate-3": 2.5,
                },
            )

        self.assertEqual(list(frames), ["candidate-1", "candidate-2"])
        self.assertLessEqual(sum(map(len, frames.values())), 12)
        self.assertTrue(all(len(values) <= 6 for values in frames.values()))


if __name__ == "__main__":
    unittest.main()
