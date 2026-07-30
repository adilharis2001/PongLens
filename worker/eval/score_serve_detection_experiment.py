#!/usr/bin/env python3
"""Score sealed serve predictions against content-locked blind references."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence


OBSERVABLE = "observable"
VISIBILITY_VALUES = {OBSERVABLE, "ambiguous", "serve_missing"}
SIDE_VALUES = {"near", "far"}


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def contact_is_correct(
    predicted: float | None,
    actual: float | None,
    tolerance_s: float = 0.4,
) -> bool:
    if predicted is None or actual is None:
        return False
    return abs(float(predicted) - float(actual)) <= tolerance_s + 1e-9


def wilson_interval(
    successes: int,
    total: int,
    z: float = 1.96,
) -> tuple[float | None, float | None]:
    if total <= 0:
        return None, None
    if not 0 <= successes <= total:
        raise ValueError("successes must be between zero and total")
    proportion = successes / total
    denominator = 1.0 + z * z / total
    center = (proportion + z * z / (2.0 * total)) / denominator
    radius = (
        z
        * math.sqrt(
            proportion * (1.0 - proportion) / total
            + z * z / (4.0 * total * total)
        )
        / denominator
    )
    return round(max(0.0, center - radius), 6), round(
        min(1.0, center + radius),
        6,
    )


def _validate_references(
    references: Sequence[Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    by_key = {}
    for reference in references:
        key = str(reference.get("point_key") or "")
        if not key:
            raise ValueError("reference point_key is required")
        if key in by_key:
            raise ValueError(f"duplicate reference point_key: {key}")
        visibility = reference.get("visibility")
        if visibility not in VISIBILITY_VALUES:
            raise ValueError(f"reference visibility is invalid: {key}")
        side = reference.get("server_side")
        if visibility == OBSERVABLE and side not in SIDE_VALUES:
            raise ValueError(
                f"observable reference server_side is invalid: {key}"
            )
        contact_t = reference.get("serve_contact_t")
        if visibility == OBSERVABLE and contact_t is None:
            raise ValueError(
                f"observable reference contact time is required: {key}"
            )
        by_key[key] = reference
    return by_key


def score_points(
    predictions: Sequence[Mapping[str, Any]],
    references: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    reference_by_key = _validate_references(references)
    prediction_by_key = {}
    for prediction in predictions:
        key = str(prediction.get("point_key") or "")
        if not key:
            raise ValueError("prediction point_key is required")
        if key in prediction_by_key:
            raise ValueError(f"duplicate prediction point_key: {key}")
        prediction_by_key[key] = prediction
    if set(prediction_by_key) != set(reference_by_key):
        missing = sorted(set(reference_by_key) - set(prediction_by_key))
        extra = sorted(set(prediction_by_key) - set(reference_by_key))
        raise ValueError(
            f"prediction/reference points differ; missing={missing}, extra={extra}"
        )

    observable = 0
    automated = 0
    correct = 0
    contact_eligible = 0
    contact_correct = 0
    hard_negative_false_selections = 0
    errors = []
    for key, reference in reference_by_key.items():
        if reference["visibility"] != OBSERVABLE:
            continue
        observable += 1
        prediction = prediction_by_key[key]
        selected = (
            prediction.get("status") == "high_confidence"
            and prediction.get("server_side") in SIDE_VALUES
        )
        if not selected:
            continue
        automated += 1
        side_correct = (
            prediction.get("server_side") == reference.get("server_side")
        )
        if side_correct:
            correct += 1
        predicted_contact = (prediction.get("serve") or {}).get(
            "contact_t"
        )
        actual_contact = reference.get("serve_contact_t")
        contact_eligible += 1
        localized = contact_is_correct(predicted_contact, actual_contact)
        if localized:
            contact_correct += 1
        if reference.get("hard_negatives") and not localized:
            hard_negative_false_selections += 1
        if not side_correct or not localized:
            errors.append(
                {
                    "point_key": key,
                    "side_correct": side_correct,
                    "contact_correct": localized,
                }
            )

    precision = correct / automated if automated else None
    coverage = automated / observable if observable else None
    contact_accuracy = (
        contact_correct / contact_eligible if contact_eligible else None
    )
    precision_low, precision_high = wilson_interval(correct, automated)
    return {
        "total_references": len(references),
        "observable": observable,
        "automated": automated,
        "correct": correct,
        "precision": (
            round(precision, 6) if precision is not None else None
        ),
        "precision_wilson_95": [precision_low, precision_high],
        "coverage": (
            round(coverage, 6) if coverage is not None else None
        ),
        "contact_eligible": contact_eligible,
        "contact_correct": contact_correct,
        "contact_accuracy": (
            round(contact_accuracy, 6)
            if contact_accuracy is not None
            else None
        ),
        "hard_negative_false_selections": (
            hard_negative_false_selections
        ),
        "errors": errors,
    }


def _gate(name: str, status: str, actual: Any, target: str) -> dict:
    return {
        "name": name,
        "status": status,
        "actual": actual,
        "target": target,
    }


def evaluate_gates(
    point_metrics: Mapping[str, Any],
    match_metrics: Mapping[str, Any],
    subgroups: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    precision = point_metrics.get("precision")
    coverage = point_metrics.get("coverage")
    hard_negative = point_metrics.get("hard_negative_false_selections")
    decided_matches = int(match_metrics.get("decided_matches") or 0)
    match_accuracy = match_metrics.get("accuracy")
    gates = [
        _gate(
            "server_precision",
            (
                "unproven"
                if precision is None
                else "passed"
                if float(precision) >= 0.98
                else "failed"
            ),
            precision,
            ">= 0.98",
        ),
        _gate(
            "observable_coverage",
            (
                "unproven"
                if coverage is None
                else "passed"
                if float(coverage) >= 0.60
                else "failed"
            ),
            coverage,
            ">= 0.60",
        ),
        _gate(
            "first_server_accuracy",
            (
                "unproven"
                if decided_matches < 5
                else "passed"
                if match_accuracy == 1.0
                else "failed"
            ),
            {
                "decided_matches": decided_matches,
                "accuracy": match_accuracy,
            },
            "1.0 across >= 5 decided matches",
        ),
        _gate(
            "hard_negative_false_selections",
            (
                "unproven"
                if hard_negative is None
                else "passed"
                if int(hard_negative) == 0
                else "failed"
            ),
            hard_negative,
            "0",
        ),
    ]
    eligible = {
        name: values
        for name, values in subgroups.items()
        if int(values.get("count") or 0) >= 20
    }
    subgroup_status = (
        "unproven"
        if not eligible
        else "passed"
        if all(
            values.get("precision") is not None
            and float(values["precision"]) >= 0.95
            for values in eligible.values()
        )
        else "failed"
    )
    gates.append(
        _gate(
            "subgroup_precision",
            subgroup_status,
            eligible,
            ">= 0.95 for every subgroup with >= 20 examples",
        )
    )
    return gates


def freeze_reference_hash(
    references_path: Path,
    lock_path: Path,
) -> str:
    references_path = Path(references_path)
    payload = json.loads(references_path.read_text())
    _validate_references(payload.get("points") or [])
    prediction_sha256 = str(payload.get("prediction_sha256") or "")
    if len(prediction_sha256) != 64:
        raise ValueError("references must identify the sealed prediction hash")
    digest = _canonical_sha256(payload)
    lock_path = Path(lock_path)
    if lock_path.exists():
        existing = json.loads(lock_path.read_text())
        if existing.get("sha256") != digest:
            raise ValueError("serve references changed")
        return digest
    _write_json(
        lock_path,
        {
            "version": 1,
            "sha256": digest,
            "prediction_sha256": prediction_sha256,
        },
    )
    return digest


def score_experiment(
    results_path: Path,
    references_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    results_path = Path(results_path)
    references_path = Path(references_path)
    output_path = Path(output_path)
    if output_path.exists():
        raise FileExistsError(f"output already exists: {output_path.name}")
    results = json.loads(results_path.read_text())
    references = json.loads(references_path.read_text())
    prediction_sha256 = hashlib.sha256(results_path.read_bytes()).hexdigest()
    if references.get("prediction_sha256") != prediction_sha256:
        raise ValueError("references do not match sealed predictions")
    reference_hash = freeze_reference_hash(
        references_path,
        references_path.parent / "serve-reference-lock.json",
    )
    evaluated_arms = {}
    for arm, arm_result in (results.get("arms") or {}).items():
        metrics = score_points(
            arm_result.get("points") or [],
            references.get("points") or [],
        )
        match_metrics = {
            "decided_matches": 0,
            "correct_matches": 0,
            "accuracy": None,
        }
        subgroups = {}
        evaluated_arms[arm] = {
            "metrics": metrics,
            "match_metrics": match_metrics,
            "subgroups": subgroups,
            "gates": evaluate_gates(
                metrics,
                match_metrics,
                subgroups,
            ),
        }
    evaluated = {
        "version": 1,
        "run_id": results.get("run_id"),
        "prediction_sha256": prediction_sha256,
        "reference_sha256": reference_hash,
        "arms": evaluated_arms,
    }
    _write_json(output_path, evaluated)
    return evaluated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evaluated = score_experiment(
        args.results,
        args.references,
        args.output,
    )
    print(
        json.dumps(
            {
                "run_id": evaluated["run_id"],
                "arms": sorted(evaluated["arms"]),
                "output": str(args.output),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
