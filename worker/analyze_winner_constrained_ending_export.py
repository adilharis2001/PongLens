#!/usr/bin/env python3
"""Score a winner-constrained research export against blinded human labels."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
from typing import Any, Mapping, Sequence


def _ratio(numerator: int | float, denominator: int | float) -> float | None:
    return float(numerator) / float(denominator) if denominator else None


def _variant_metrics(
    rows: Sequence[tuple[Mapping[str, Any], Mapping[str, Any]]],
) -> dict[str, Any]:
    point_count = len(rows)
    covered = [
        (truth, prediction)
        for truth, prediction in rows
        if prediction.get("status") == "predicted"
        and prediction.get("ending_family") != "unsure"
    ]
    exact_covered = sum(
        truth.get("ending_family") == prediction.get("ending_family")
        for truth, prediction in covered
    )
    exact_all = sum(
        truth.get("ending_family") == prediction.get("ending_family")
        for truth, prediction in rows
    )
    confusion: dict[str, Counter[str]] = defaultdict(Counter)
    for truth, prediction in rows:
        confusion[str(truth.get("ending_family") or "missing")][
            str(prediction.get("ending_family") or "missing")
        ] += 1
    net_truth = {
        index
        for index, (truth, _) in enumerate(rows)
        if truth.get("ending_family") == "net"
    }
    net_predictions = {
        index
        for index, (_, prediction) in enumerate(rows)
        if prediction.get("ending_family") == "net"
        and prediction.get("status") == "predicted"
    }
    true_net = len(net_truth & net_predictions)
    net_precision = _ratio(true_net, len(net_predictions))
    net_recall = _ratio(true_net, len(net_truth))
    net_f1 = (
        2 * net_precision * net_recall / (net_precision + net_recall)
        if net_precision is not None
        and net_recall is not None
        and net_precision + net_recall
        else None
    )
    contact_errors = []
    for truth, prediction in rows:
        truth_count = truth.get("contact_count")
        predicted_count = prediction.get("contact_count")
        if (
            isinstance(truth_count, int)
            and not isinstance(truth_count, bool)
            and isinstance(predicted_count, int)
            and not isinstance(predicted_count, bool)
        ):
            contact_errors.append(abs(truth_count - predicted_count))
    return {
        "point_count": point_count,
        "covered_count": len(covered),
        "coverage": _ratio(len(covered), point_count),
        "covered_accuracy": _ratio(exact_covered, len(covered)),
        "overall_exact_accuracy": _ratio(exact_all, point_count),
        "confusion": {
            truth: dict(sorted(predictions.items()))
            for truth, predictions in sorted(confusion.items())
        },
        "net_precision": net_precision,
        "net_recall": net_recall,
        "net_f1": net_f1,
        "contact_evaluated_count": len(contact_errors),
        "contact_exact_accuracy": _ratio(
            sum(error == 0 for error in contact_errors),
            len(contact_errors),
        ),
        "contact_mae": _ratio(sum(contact_errors), len(contact_errors)),
        "abstained_count": point_count - len(covered),
    }


def _paired_metrics(
    paired: Sequence[
        tuple[Mapping[str, Any], Mapping[str, Any], Mapping[str, Any]]
    ],
) -> dict[str, Any]:
    without_exact = sum(
        truth.get("ending_family") == without.get("ending_family")
        for truth, without, _ in paired
    )
    with_exact = sum(
        truth.get("ending_family") == with_result.get("ending_family")
        for truth, _, with_result in paired
    )
    net_improvement = sum(
        truth.get("ending_family") == "net"
        and without.get("ending_family") != "net"
        and with_result.get("ending_family") == "net"
        for truth, without, with_result in paired
    ) - sum(
        truth.get("ending_family") == "net"
        and without.get("ending_family") == "net"
        and with_result.get("ending_family") != "net"
        for truth, without, with_result in paired
    )
    return {
        "pair_count": len(paired),
        "without_exact": without_exact,
        "with_exact": with_exact,
        "exact_delta": with_exact - without_exact,
        "net_improvement": net_improvement,
    }


def analyze_export(payload: Mapping[str, Any]) -> dict[str, Any]:
    assignments = payload.get("assignments") or []
    submitted = [
        row
        for row in assignments
        if isinstance(row, Mapping)
        and row.get("status") == "submitted"
        and isinstance(row.get("human_label"), Mapping)
        and isinstance(row.get("gold"), Mapping)
    ]
    without_rows = []
    boundary_rows = []
    paired = []
    compatible_without_rows = []
    compatible_boundary_rows = []
    compatible_paired = []
    by_match = Counter()
    server_reviews = Counter()
    for row in submitted:
        truth = row["human_label"]
        server_review = str(truth.get("server_review") or "unreviewed")
        if server_review not in {"correct", "corrected", "unsure"}:
            server_review = "unreviewed"
        server_reviews[server_review] += 1
        scoring_compatible = server_review == "correct"
        gold = row["gold"]
        predictions = gold.get("predictions") or {}
        without = predictions.get("without_serve_boundary") or {}
        without_rows.append((truth, without))
        if scoring_compatible:
            compatible_without_rows.append((truth, without))
        by_match[str((gold.get("source") or {}).get("match_key"))] += 1
        boundary = predictions.get("with_detected_serve_boundary") or {}
        if boundary.get("available") is True and isinstance(
            boundary.get("result"),
            Mapping,
        ):
            with_result = boundary["result"]
            boundary_rows.append((truth, with_result))
            paired.append((truth, without, with_result))
            if scoring_compatible:
                compatible_boundary_rows.append((truth, with_result))
                compatible_paired.append((truth, without, with_result))

    without_metrics = _variant_metrics(without_rows)
    boundary_metrics = _variant_metrics(boundary_rows)
    reviewed_server_count = (
        server_reviews["correct"] + server_reviews["corrected"]
    )
    return {
        "schema_version": 1,
        "labels": {
            "assignment_count": len(assignments),
            "submitted": len(submitted),
            "by_match": dict(sorted(by_match.items())),
        },
        "server_review": {
            "correct": server_reviews["correct"],
            "corrected": server_reviews["corrected"],
            "unsure": server_reviews["unsure"],
            "unreviewed": server_reviews["unreviewed"],
            "correction_rate": _ratio(
                server_reviews["corrected"],
                reviewed_server_count,
            ),
        },
        "without_serve_boundary": without_metrics,
        "with_detected_serve_boundary": boundary_metrics,
        "serve_boundary_paired": _paired_metrics(paired),
        "scoring_compatible": {
            "excluded_wrong_or_uncertain_server": (
                len(submitted) - len(compatible_without_rows)
            ),
            "without_serve_boundary": _variant_metrics(
                compatible_without_rows
            ),
            "with_detected_serve_boundary": _variant_metrics(
                compatible_boundary_rows
            ),
            "serve_boundary_paired": _paired_metrics(compatible_paired),
        },
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    result = analyze_export(json.loads(args.export.read_text()))
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(text)
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
