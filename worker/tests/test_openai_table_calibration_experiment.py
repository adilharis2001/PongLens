import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from worker.eval.run_openai_table_calibration_experiment import (
    estimate_trial_cost,
    run_case,
    validate_references,
)


MATCH_ID = "5721edd0-a80e-4eb8-a605-a6d3c8dbe41f"
IMAGE_WIDTH = 320
IMAGE_HEIGHT = 180
SOURCE_WIDTH = 640
SOURCE_HEIGHT = 360
GOOD_QUAD = np.asarray(
    [[131, 116], [96, 96], [179, 77], [221, 83]],
    dtype=np.float32,
)
CORNER_NAMES = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")


def proposal(corners: np.ndarray) -> dict:
    return {
        "width": IMAGE_WIDTH,
        "height": IMAGE_HEIGHT,
        "confidence": 0.93,
        "ambiguity_reason": "",
        "corners": {
            name: [float(point[0]), float(point[1])]
            for name, point in zip(CORNER_NAMES, corners)
        },
    }


def write_gray_table(path: Path) -> None:
    image = np.full((IMAGE_HEIGHT, IMAGE_WIDTH, 3), 35, dtype=np.uint8)
    cv2.fillConvexPoly(image, GOOD_QUAD.astype(np.int32), (105, 105, 105))
    cv2.polylines(
        image,
        [GOOD_QUAD.astype(np.int32)],
        True,
        (235, 235, 235),
        2,
        cv2.LINE_AA,
    )
    cv2.imwrite(str(path), image)


def prepared_case(root: Path) -> tuple[dict, dict, dict]:
    case_root = root / "cases" / MATCH_ID
    images_dir = case_root / "images"
    images_dir.mkdir(parents=True)
    images = []
    for name in (
        "background.jpg",
        "representative-1.jpg",
        "representative-2.jpg",
    ):
        path = images_dir / name
        write_gray_table(path)
        images.append(
            {
                "path": f"images/{name}",
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    blurball = case_root / "blurball.jsonl"
    blurball.write_text(
        "".join(
            json.dumps(
                {
                    "f": frame,
                    "x": 290 + (frame % 24) * 2,
                    "y": 180 + (frame % 9) * 2,
                }
            )
            + "\n"
            for frame in range(18)
        )
    )
    case = {
        "match_id": MATCH_ID,
        "root": f"cases/{MATCH_ID}",
        "source_size": [SOURCE_WIDTH, SOURCE_HEIGHT],
        "image_size": [IMAGE_WIDTH, IMAGE_HEIGHT],
        "blurball": "blurball.jsonl",
        "images": images,
        "bounce_core": [180, 470, 130, 250],
        "points": [],
    }
    pricing = {
        "model": "gpt-5.6-sol",
        "rates": {
            "input_token": {"price": 0.000005},
            "cached_input_token": {"price": 0.0000005},
            "output_token": {"price": 0.00003},
        },
    }
    cases = {
        "version": 1,
        "model": "gpt-5.6-sol",
        "pricing": pricing,
        "cases": [case],
    }
    reference = {
        "version": 1,
        "cases": [
            {
                "match_id": MATCH_ID,
                "size": [IMAGE_WIDTH, IMAGE_HEIGHT],
                "image_sha256": [image["sha256"] for image in images],
                "corners": proposal(GOOD_QUAD)["corners"],
            }
        ],
    }
    return cases, case, reference


class ReferenceTests(unittest.TestCase):
    def test_reference_hashes_must_match_prepared_images(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, _, references = prepared_case(Path(directory))
            references["cases"][0]["image_sha256"][1] = "0" * 64

            with self.assertRaisesRegex(ValueError, "image hashes"):
                validate_references(cases, references, Path(directory))

    def test_null_reference_cannot_start_provider_trials(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, _, references = prepared_case(Path(directory))
            references["cases"][0]["corners"] = None

            with self.assertRaisesRegex(ValueError, "corners"):
                validate_references(cases, references, Path(directory))


class CostTests(unittest.TestCase):
    def test_cost_separates_cached_from_uncached_input(self):
        usage = {
            "input_tokens": 100,
            "output_tokens": 10,
            "input_tokens_details": {"cached_tokens": 20},
        }
        rates = {
            "input_token": {"price": 0.000005},
            "cached_input_token": {"price": 0.0000005},
            "output_token": {"price": 0.00003},
        }

        cost = estimate_trial_cost(usage, rates)

        self.assertAlmostEqual(cost, 0.00071)


class TrialTests(unittest.TestCase):
    def test_three_trials_select_consensus_and_measure_accuracy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases, case, references = prepared_case(root)
            reference = references["cases"][0]
            outputs = [
                proposal(GOOD_QUAD),
                proposal(GOOD_QUAD + np.asarray([2, -1])),
                proposal(GOOD_QUAD + np.asarray([45, 25])),
            ]
            calls = []

            def provider(
                image_paths,
                *,
                api_key,
                model,
                usage_output,
            ):
                calls.append(
                    {
                        "images": [Path(path).name for path in image_paths],
                        "api_key": api_key,
                        "model": model,
                        "usage_output": Path(usage_output).name,
                    }
                )
                index = len(calls) - 1
                return {
                    "proposal": outputs[index],
                    "response_id": f"response-{index}",
                    "model": model,
                    "usage": {
                        "input_tokens": 100,
                        "output_tokens": 10,
                        "input_tokens_details": {"cached_tokens": 20},
                    },
                    "latency_s": 0.1 + index,
                }

            result = run_case(
                case,
                reference,
                api_key="secret",
                model="gpt-5.6-sol",
                experiment_root=root,
                pricing=cases["pricing"],
                provider=provider,
            )

            self.assertEqual(len(calls), 3)
            self.assertEqual(
                {call["usage_output"] for call in calls},
                {"trial-1-usage.json", "trial-2-usage.json", "trial-3-usage.json"},
            )
            self.assertEqual(
                result["consensus"]["agreeing_trials"],
                [0, 1],
            )
            self.assertTrue(result["calibration"]["accepted"], result)
            self.assertEqual(
                result["accuracy"]["status"],
                "passes_reference_gate",
            )
            self.assertAlmostEqual(
                result["provider"]["estimated_usd"],
                0.00071 * 3,
            )
            self.assertEqual(result["reference_sha256"], hashlib.sha256(
                json.dumps(
                    reference,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest())


if __name__ == "__main__":
    unittest.main()
