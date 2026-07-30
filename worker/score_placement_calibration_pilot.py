#!/usr/bin/env python3
"""Score latest labels from the cross-venue placement calibration pilot."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np


ARMS = ("legacy_current", "canonical_current", "openai")
TABLE_WIDTH_M = 1.525


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    return round(float(np.percentile(np.asarray(values), percentile)), 2)


def _distance_cm(
    truth: Mapping[str, Any],
    prediction: Mapping[str, Any],
) -> float:
    return 100 * math.hypot(
        float(prediction["u"]) - float(truth["table_u"]),
        float(prediction["v"]) - float(truth["table_v"]),
    )


def score_labels(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    observability = Counter()
    exclusions = Counter()
    eligible = []
    for row in rows:
        if row.get("is_repeat"):
            continue
        label = row.get("analysis_label") or row.get("human_label") or {}
        result = str(label.get("result") or "missing")
        if result == "excluded":
            reason = str(label.get("exclusion_reason") or "excluded")
            exclusions[reason] += 1
            continue
        observability[result] += 1
        if result != "landed":
            exclusions[result] += 1
            continue
        if label.get("confidence") == "unsure":
            exclusions["unsure"] += 1
            continue
        if label.get("table_u") is None or label.get("table_v") is None:
            exclusions["incomplete"] += 1
            continue
        eligible.append((row, label))

    arm_results = {}
    for arm in ARMS:
        distances = []
        mirror_better = 0
        predictions = 0
        zone_matches = 0
        zone_denominator = 0
        for row, truth in eligible:
            proposal = row.get("proposal") or {}
            prediction = (proposal.get("predictions") or {}).get(arm)
            if not prediction:
                continue
            predictions += 1
            distance = _distance_cm(truth, prediction)
            distances.append(distance)
            mirrored = {
                **prediction,
                "u": TABLE_WIDTH_M - float(prediction["u"]),
            }
            if _distance_cm(truth, mirrored) + 10 < distance:
                mirror_better += 1
            human_zone = truth.get("zone")
            predicted_zone = prediction.get("zone")
            if human_zone and predicted_zone:
                zone_denominator += 1
                zone_matches += int(human_zone == predicted_zone)
        arm_results[arm] = {
            "coverage": {
                "numerator": predictions,
                "denominator": len(eligible),
            },
            "distance_cm": {
                "median": _percentile(distances, 50),
                "p90": _percentile(distances, 90),
                "maximum": round(max(distances), 2) if distances else None,
            },
            "mirror_rate": {
                "numerator": mirror_better,
                "denominator": predictions,
            },
            "zone_accuracy": {
                "numerator": zone_matches,
                "denominator": zone_denominator,
            },
        }
    return {
        "version": 2,
        "engineering_holdout": (
            "This is a reviewer-labeled engineering holdout, not a "
            "population-level accuracy claim."
        ),
        "assignments": len(rows),
        "eligible_landings": len(eligible),
        "observability": dict(sorted(observability.items())),
        "exclusions": dict(sorted(exclusions.items())),
        "arms": arm_results,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    payload = json.loads(args.input.read_text())
    rows = payload.get("assignments") or payload
    result = score_labels(rows)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        f"scored {result['eligible_landings']} landings "
        f"from {result['assignments']} assignments"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
