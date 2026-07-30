import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np

from worker.eval.run_openai_table_calibration_experiment import (
    _openai_provider,
    estimate_trial_cost,
    freeze_reference_hash,
    run_case,
    run_experiment,
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
    def test_invalid_reference_does_not_poison_reference_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases, _, references = prepared_case(root)
            valid_corners = references["cases"][0]["corners"]
            references["cases"][0]["corners"] = None
            cases_path = root / "cases.json"
            references_path = root / "references.json"
            output_path = root / "run-v1.json"
            cases_path.write_text(json.dumps(cases))
            references_path.write_text(json.dumps(references))

            with self.assertRaisesRegex(ValueError, "corners"):
                run_experiment(
                    cases_path,
                    references_path,
                    output_path,
                    api_key="secret",
                )

            self.assertFalse((root / "reference-lock.json").exists())
            references["cases"][0]["corners"] = valid_corners
            references_path.write_text(json.dumps(references))
            with patch(
                "worker.eval.run_openai_table_calibration_experiment.run_case",
                return_value={"match_id": MATCH_ID},
            ):
                run_experiment(
                    cases_path,
                    references_path,
                    output_path,
                    api_key="secret",
                )

            self.assertTrue((root / "reference-lock.json").is_file())

    def test_reference_hash_is_frozen_before_provider_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases, _, references = prepared_case(root)
            references_path = root / "references.json"
            references_path.write_text(json.dumps(references))
            lock_path = root / "reference-lock.json"

            first_hash = freeze_reference_hash(references_path, lock_path)
            references["cases"][0]["corners"]["A_near_1"][0] += 1
            references_path.write_text(json.dumps(references))

            with self.assertRaisesRegex(ValueError, "reference lock"):
                freeze_reference_hash(references_path, lock_path)
            self.assertEqual(
                json.loads(lock_path.read_text())["sha256"],
                first_hash,
            )

    def test_existing_run_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases, _, references = prepared_case(root)
            cases_path = root / "cases.json"
            references_path = root / "references.json"
            output_path = root / "run-existing.json"
            cases_path.write_text(json.dumps(cases))
            references_path.write_text(json.dumps(references))
            output_path.write_text('{"existing":true}\n')

            with patch(
                "worker.eval.run_openai_table_calibration_experiment.run_case",
                side_effect=AssertionError("provider must not run"),
            ):
                with self.assertRaises(FileExistsError):
                    run_experiment(
                        cases_path,
                        references_path,
                        output_path,
                        api_key="secret",
                    )

            self.assertEqual(output_path.read_text(), '{"existing":true}\n')

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
    def test_provider_uses_experiment_only_reasoning_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            usage_output = Path(directory) / "usage.json"

            def proposal_request(image_paths, **kwargs):
                Path(os.environ["PONGLENS_COST_USAGE_OUTPUT"]).write_text(
                    json.dumps(
                        {
                            "response_id": "response",
                            "model": kwargs["model"],
                            "usage": {},
                        }
                    )
                )
                return proposal(GOOD_QUAD)

            with unittest.mock.patch(
                "worker.eval.run_openai_table_calibration_experiment."
                "request_corner_proposal",
                side_effect=proposal_request,
            ) as request:
                _openai_provider(
                    [Path(directory) / "image.jpg"],
                    api_key="secret",
                    model="gpt-5.6-sol",
                    usage_output=usage_output,
                )

            self.assertEqual(request.call_args.kwargs["reasoning_effort"], "low")
            self.assertEqual(request.call_args.kwargs["max_output_tokens"], 2400)

    def test_failed_trials_still_meter_usage_from_sidecar(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases, case, references = prepared_case(root)
            reference = references["cases"][0]

            def provider(
                image_paths,
                *,
                api_key,
                model,
                usage_output,
            ):
                Path(usage_output).write_text(
                    json.dumps(
                        {
                            "response_id": "failed-response",
                            "model": model,
                            "usage": {
                                "input_tokens": 100,
                                "output_tokens": 10,
                                "input_tokens_details": {
                                    "cached_tokens": 20,
                                },
                            },
                        }
                    )
                )
                raise ValueError("response had no proposal")

            result = run_case(
                case,
                reference,
                api_key="secret",
                model="gpt-5.6-sol",
                experiment_root=root,
                pricing=cases["pricing"],
                provider=provider,
            )

            self.assertEqual(
                result["provider"]["estimated_usd"],
                0.00071 * 3,
            )
            for trial in result["trials"]:
                self.assertEqual(trial["status"], "failed")
                self.assertEqual(trial["error"], "ValueError")
                self.assertEqual(trial["usage"]["output_tokens"], 10)
                self.assertEqual(trial["response_id"], "failed-response")

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
