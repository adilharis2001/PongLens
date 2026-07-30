#!/usr/bin/env python3
"""Run three read-only OpenAI table-calibration trials per prepared match."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

if __package__:
    from ..placement_retry_calibration import (
        CORNER_NAMES,
        parse_corner_proposal,
        request_corner_proposal,
    )
    from ..points_pipeline import activity_gate, load_detections
    from ..vision_table_calibration import (
        reference_error,
        select_consensus,
        validate_generic_candidate,
    )
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from placement_retry_calibration import (  # type: ignore
        CORNER_NAMES,
        parse_corner_proposal,
        request_corner_proposal,
    )
    from points_pipeline import activity_gate, load_detections  # type: ignore
    from vision_table_calibration import (  # type: ignore
        reference_error,
        select_consensus,
        validate_generic_candidate,
    )


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _case_root(experiment_root: Path, case: dict) -> Path:
    root = (experiment_root / str(case["root"])).resolve()
    if not root.is_relative_to(experiment_root.resolve()):
        raise ValueError("case root escapes the experiment directory")
    return root


def validate_references(
    cases_payload: dict,
    references: dict,
    experiment_root: Path,
) -> None:
    """Prove references match the prepared images and contain valid corners."""
    cases = cases_payload.get("cases")
    reference_cases = references.get("cases")
    if not isinstance(cases, list) or not isinstance(reference_cases, list):
        raise ValueError("cases and references must contain case lists")
    references_by_id = {
        str(reference.get("match_id")): reference
        for reference in reference_cases
        if isinstance(reference, dict)
    }
    if set(references_by_id) != {
        str(case.get("match_id")) for case in cases
    }:
        raise ValueError("reference match IDs do not match prepared cases")
    for case in cases:
        match_id = str(case["match_id"])
        reference = references_by_id[match_id]
        if reference.get("size") != case.get("image_size"):
            raise ValueError(f"{match_id}: reference size does not match images")
        expected_hashes = [
            str(image["sha256"]) for image in case.get("images") or []
        ]
        if reference.get("image_sha256") != expected_hashes:
            raise ValueError(
                f"{match_id}: reference image hashes do not match preparation"
            )
        root = _case_root(Path(experiment_root), case)
        actual_hashes = [
            _file_sha256(root / str(image["path"]))
            for image in case.get("images") or []
        ]
        if actual_hashes != expected_hashes:
            raise ValueError(
                f"{match_id}: prepared image hashes changed after preparation"
            )
        corners = reference.get("corners")
        if not isinstance(corners, dict):
            raise ValueError(f"{match_id}: reference corners are required")
        width, height = (int(value) for value in reference["size"])
        parse_corner_proposal(
            {
                "width": width,
                "height": height,
                "confidence": 1.0,
                "ambiguity_reason": "",
                "corners": corners,
            },
            width,
            height,
        )


def estimate_trial_cost(usage: dict, rates: dict) -> float:
    details = usage.get("input_tokens_details") or {}
    total_input = max(0, int(usage.get("input_tokens") or 0))
    cached = min(total_input, max(0, int(details.get("cached_tokens") or 0)))
    output = max(0, int(usage.get("output_tokens") or 0))
    cost = (
        (total_input - cached) * float(rates["input_token"]["price"])
        + cached * float(rates["cached_input_token"]["price"])
        + output * float(rates["output_token"]["price"])
    )
    return round(cost, 9)


def _openai_provider(
    image_paths: list[Path],
    *,
    api_key: str,
    model: str,
    usage_output: Path,
) -> dict:
    previous = os.environ.get("PONGLENS_COST_USAGE_OUTPUT")
    os.environ["PONGLENS_COST_USAGE_OUTPUT"] = str(usage_output)
    started = time.perf_counter()
    try:
        raw = request_corner_proposal(
            image_paths,
            api_key=api_key,
            model=model,
        )
    finally:
        latency = time.perf_counter() - started
        if previous is None:
            os.environ.pop("PONGLENS_COST_USAGE_OUTPUT", None)
        else:
            os.environ["PONGLENS_COST_USAGE_OUTPUT"] = previous
    if not usage_output.is_file():
        raise RuntimeError("OpenAI trial did not produce usage metadata")
    sidecar = json.loads(usage_output.read_text())
    return {
        "proposal": raw,
        "response_id": str(sidecar.get("response_id") or ""),
        "model": str(sidecar.get("model") or model),
        "usage": sidecar.get("usage") or {},
        "latency_s": round(latency, 6),
    }


def _proposal_from_corners(
    corners: list[list[float]],
    width: int,
    height: int,
) -> dict:
    return {
        "width": width,
        "height": height,
        "confidence": 1.0,
        "ambiguity_reason": "",
        "corners": {
            name: [float(point[0]), float(point[1])]
            for name, point in zip(CORNER_NAMES, corners)
        },
    }


def run_case(
    case: dict,
    reference: dict,
    *,
    api_key: str,
    model: str,
    experiment_root: Path,
    pricing: dict,
    provider: Callable = _openai_provider,
) -> dict:
    """Run three proposals, local validation, consensus, and reference scoring."""
    root = _case_root(Path(experiment_root), case)
    image_paths = [
        root / str(image["path"]) for image in case.get("images") or []
    ]
    if len(image_paths) != 3:
        raise ValueError("each experiment case requires exactly three images")
    background = cv2.imread(str(image_paths[0]))
    if background is None:
        raise ValueError("experiment background image is unreadable")
    image_height, image_width = background.shape[:2]
    if case.get("image_size") != [image_width, image_height]:
        raise ValueError("prepared image dimensions changed")
    source_width, source_height = (
        int(value) for value in case["source_size"]
    )
    detections = load_detections(root / str(case["blurball"]))
    gate = activity_gate(detections, source_width, source_height)
    core = case.get("bounce_core") or (gate or {}).get("core")
    if core is not None:
        core = tuple(float(value) for value in core)

    trial_dir = root / "provider-trials"
    trial_dir.mkdir(parents=True, exist_ok=True)
    trials = []
    rates = pricing["rates"]
    for trial_index in range(3):
        usage_output = trial_dir / f"trial-{trial_index + 1}-usage.json"
        started = time.perf_counter()
        try:
            provider_result = provider(
                image_paths,
                api_key=api_key,
                model=model,
                usage_output=usage_output,
            )
            raw = provider_result["proposal"]
            validation = validate_generic_candidate(
                raw,
                background,
                (source_width, source_height),
                core,
                detections,
            )
            trial = {
                "index": trial_index,
                "status": "completed",
                "proposal": raw,
                "validation": validation,
                "response_id": str(
                    provider_result.get("response_id") or ""
                )[:160],
                "model": str(provider_result.get("model") or model)[:120],
                "usage": provider_result.get("usage") or {},
                "latency_s": round(
                    float(
                        provider_result.get(
                            "latency_s",
                            time.perf_counter() - started,
                        )
                    ),
                    6,
                ),
            }
            trial["estimated_usd"] = estimate_trial_cost(
                trial["usage"],
                rates,
            )
        except Exception as error:
            trial = {
                "index": trial_index,
                "status": "failed",
                "error": type(error).__name__,
                "validation": {
                    "accepted": False,
                    "reason": "provider_or_parse_error",
                },
                "latency_s": round(time.perf_counter() - started, 6),
                "estimated_usd": 0.0,
            }
        trials.append(trial)

    consensus = select_consensus(
        [trial["validation"] for trial in trials],
        image_width,
        image_height,
    )
    calibration = {
        "accepted": False,
        "reason": consensus.get("reason"),
        "corners": None,
        "scores": {},
    }
    accuracy = {
        "status": "not_measured",
        "corner_ratios": [],
        "median_ratio": None,
        "maximum_ratio": None,
    }
    if consensus.get("accepted"):
        median_raw = _proposal_from_corners(
            consensus["corners"],
            image_width,
            image_height,
        )
        calibration = validate_generic_candidate(
            median_raw,
            background,
            (source_width, source_height),
            core,
            detections,
        )
        if calibration["accepted"]:
            reference_points = [
                reference["corners"][name] for name in CORNER_NAMES
            ]
            accuracy = reference_error(
                calibration["corners"],
                reference_points,
                image_width,
                image_height,
            )
            accuracy["status"] = (
                "passes_reference_gate"
                if accuracy["median_ratio"] <= 0.02
                and accuracy["maximum_ratio"] <= 0.04
                else "fails_reference_gate"
            )

    return {
        "match_id": str(case["match_id"]),
        "image_sha256": [image["sha256"] for image in case["images"]],
        "reference_sha256": _canonical_sha256(reference),
        "trials": trials,
        "consensus": consensus,
        "calibration": calibration,
        "accuracy": accuracy,
        "provider": {
            "model": model,
            "request_count": 3,
            "estimated_usd": round(
                sum(float(trial["estimated_usd"]) for trial in trials),
                9,
            ),
            "pricing": pricing,
        },
    }


def _atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def run_experiment(
    cases_path: Path,
    references_path: Path,
    output_path: Path,
    *,
    api_key: str,
) -> dict:
    experiment_root = cases_path.resolve().parent
    output_path = output_path.resolve()
    if not output_path.is_relative_to(experiment_root):
        raise ValueError("experiment output must stay under the prepared root")
    cases = json.loads(cases_path.read_text())
    references = json.loads(references_path.read_text())
    validate_references(cases, references, experiment_root)
    references_by_id = {
        str(reference["match_id"]): reference
        for reference in references["cases"]
    }
    result = {
        "version": 1,
        "model": cases["model"],
        "pricing": cases["pricing"],
        "cases": [],
    }
    for case in cases["cases"]:
        result["cases"].append(
            run_case(
                case,
                references_by_id[str(case["match_id"])],
                api_key=api_key,
                model=cases["model"],
                experiment_root=experiment_root,
                pricing=cases["pricing"],
            )
        )
        _atomic_json(output_path, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate-references")
    validate.add_argument("--cases", type=Path, required=True)
    validate.add_argument("--references", type=Path, required=True)
    run = subparsers.add_parser("run")
    run.add_argument("--cases", type=Path, required=True)
    run.add_argument("--references", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text())
    references = json.loads(args.references.read_text())
    if args.command == "validate-references":
        validate_references(cases, references, args.cases.resolve().parent)
        print("all references match the prepared image set")
        return 0
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")
    result = run_experiment(
        args.cases,
        args.references,
        args.output,
        api_key=api_key,
    )
    print(f"completed {len(result['cases'])} experiment cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
