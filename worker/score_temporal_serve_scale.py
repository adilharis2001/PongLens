#!/usr/bin/env python3
"""Score the scaled temporal serve experiment and enforce production gates."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import statistics
import tempfile
from typing import Any, Mapping, Sequence


def _wilson(successes: int, trials: int, z: float = 1.96) -> list[float]:
    if trials <= 0:
        return [0.0, 0.0]
    proportion = successes / trials
    denominator = 1.0 + z * z / trials
    centre = (proportion + z * z / (2.0 * trials)) / denominator
    margin = (
        z
        * math.sqrt(
            proportion * (1.0 - proportion) / trials
            + z * z / (4.0 * trials * trials)
        )
        / denominator
    )
    return [round(max(0.0, centre - margin), 6), round(min(1.0, centre + margin), 6)]


def _call_metrics(
    rows: Sequence[Mapping[str, Any]], call_key: str = "fused"
) -> dict[str, Any]:
    eligible = 0
    decided = 0
    correct = 0
    by_match: dict[str, dict[str, int]] = {}
    for row in rows:
        truth = (row.get("evaluation") or {}).get("expected_server_side")
        if truth not in {"near", "far"}:
            continue
        eligible += 1
        match = by_match.setdefault(
            str(row.get("match_id") or "unknown"),
            {"eligible": 0, "decided": 0, "correct": 0},
        )
        match["eligible"] += 1
        call = row.get(call_key) or {}
        is_decided = (
            call.get("status") == "high_confidence"
            and call.get("side") in {"near", "far"}
        )
        if is_decided:
            decided += 1
            match["decided"] += 1
            if call.get("side") == truth:
                correct += 1
                match["correct"] += 1
    detailed = {}
    for match_id, values in sorted(by_match.items()):
        detailed[match_id] = {
            **values,
            "precision": round(values["correct"] / values["decided"], 6)
            if values["decided"]
            else 0.0,
            "coverage": round(values["decided"] / values["eligible"], 6)
            if values["eligible"]
            else 0.0,
        }
    return {
        "eligible": eligible,
        "decided": decided,
        "correct": correct,
        "precision": round(correct / decided, 6) if decided else 0.0,
        "precision_ci95": _wilson(correct, decided),
        "coverage": round(decided / eligible, 6) if eligible else 0.0,
        "per_match": detailed,
    }


def _first_server_truth(run: Mapping[str, Any]) -> dict[str, str]:
    explicit = {
        str(key): str(value)
        for key, value in (run.get("match_truth") or {}).items()
        if value in {"near", "far"}
    }
    if explicit:
        return explicit
    earliest: dict[str, tuple[int, str]] = {}
    for row in (run.get("predictions") or {}).get("holdout") or []:
        truth = (row.get("evaluation") or {}).get("expected_server_side")
        match_id = str(row.get("match_id") or "")
        if not match_id or truth not in {"near", "far"}:
            continue
        index = int(row.get("source_point_idx") or 0)
        current = earliest.get(match_id)
        if current is None or index < current[0]:
            earliest[match_id] = (index, str(truth))
    return {match_id: value[1] for match_id, value in earliest.items()}


def _first_server_metrics(run: Mapping[str, Any]) -> dict[str, Any]:
    truth = _first_server_truth(run)
    holdout_match_ids = {
        str(row.get("match_id") or "")
        for row in (run.get("predictions") or {}).get("holdout") or []
        if row.get("match_id")
    }
    if holdout_match_ids:
        truth = {
            match_id: side
            for match_id, side in truth.items()
            if match_id in holdout_match_ids
        }
    predictions = run.get("match_predictions") or {}
    rows = []
    correct = 0
    decided = 0
    for match_id, expected in sorted(truth.items()):
        prediction = predictions.get(match_id) or {}
        is_decided = (
            prediction.get("status") == "high_confidence"
            and prediction.get("side") in {"near", "far"}
        )
        is_correct = is_decided and prediction.get("side") == expected
        decided += int(is_decided)
        correct += int(is_correct)
        rows.append(
            {
                "match_id": match_id,
                "expected": expected,
                "predicted": prediction.get("side"),
                "status": prediction.get("status", "withheld"),
                "confidence": float(prediction.get("confidence") or 0.0),
                "correct": bool(is_correct) if is_decided else None,
            }
        )
    eligible = len(rows)
    truth_balance = {
        side: sum(row["expected"] == side for row in rows)
        for side in ("near", "far")
    }
    return {
        "eligible": eligible,
        "decided": decided,
        "correct": correct,
        "precision": round(correct / decided, 6) if decided else 0.0,
        "precision_ci95": _wilson(correct, decided),
        "coverage": round(decided / eligible, 6) if eligible else 0.0,
        "truth_balance": truth_balance,
        "matches": rows,
    }


def _raw_argmax_metrics(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Report the model's unthresholded discrimination separately from coverage."""

    eligible = correct = 0
    for row in rows:
        truth = (row.get("evaluation") or {}).get("expected_server_side")
        temporal = row.get("temporal") or {}
        if truth not in {"near", "far"}:
            continue
        near = temporal.get("near")
        far = temporal.get("far")
        if near is None or far is None:
            continue
        eligible += 1
        predicted = "near" if float(near) >= float(far) else "far"
        correct += int(predicted == truth)
    return {
        "eligible": eligible,
        "decided": eligible,
        "correct": correct,
        "accuracy": round(correct / eligible, 6) if eligible else 0.0,
    }


def _temporal_only_rows(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        temporal = row.get("temporal") or {}
        near = float(temporal.get("near") or 0.0)
        far = float(temporal.get("far") or 0.0)
        side = "near" if near >= far else "far"
        probability = max(near, far)
        margin = abs(near - far)
        call = {
            "status": "high_confidence"
            if probability >= 0.90 and margin >= 0.55
            else "withheld",
            "side": side if probability >= 0.90 and margin >= 0.55 else None,
            "confidence": probability,
        }
        output.append({**dict(row), "temporal_only": call})
    return output


def _onset_metrics(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    errors = []
    for row in rows:
        actual = (row.get("evaluation") or {}).get("actual_serve_contact_s")
        predicted = (row.get("temporal") or {}).get("onset_t")
        if actual is not None and predicted is not None:
            errors.append(abs(float(actual) - float(predicted)))
    return {
        "labeled": len(errors),
        "median_absolute_error_s": round(statistics.median(errors), 6)
        if errors
        else None,
        "mean_absolute_error_s": round(statistics.fmean(errors), 6)
        if errors
        else None,
    }


def _compute_projection(compute: Mapping[str, Any]) -> dict[str, Any]:
    points = int(compute.get("points") or 0)
    elapsed = float(compute.get("elapsed_s") or 0.0)
    hourly_rate = 0.40
    return {
        "observed_points": points,
        "observed_elapsed_s": round(elapsed, 6),
        "seconds_per_point": round(elapsed / points, 6) if points else None,
        "estimated_cloud_rate_usd_per_hour": hourly_rate,
        "estimated_cost_per_100_points_usd": round(
            (elapsed / max(points, 1)) * 100.0 / 3600.0 * hourly_rate,
            4,
        )
        if points
        else None,
        "peak_rss_mb": float(compute.get("peak_rss_mb") or 0.0),
    }


def score_run(run: Mapping[str, Any]) -> dict[str, Any]:
    if run.get("experiment") != "temporal-serve-scale-v1":
        raise ValueError("results belong to another experiment")
    holdout_rows = list((run.get("predictions") or {}).get("holdout") or [])
    first_server = _first_server_metrics(run)
    point_calls = _call_metrics(holdout_rows)
    temporal_rows = _temporal_only_rows(holdout_rows)
    temporal_only = _call_metrics(temporal_rows, "temporal_only")
    baseline_rows = [row for row in holdout_rows if row.get("baseline")]
    baseline = _call_metrics(baseline_rows, "baseline") if baseline_rows else None
    preliminary = (
        run.get("manifest_status") == "preliminary"
        or first_server["eligible"] < 10
    )
    recommendation = "research_only"
    if not preliminary and first_server["decided"] >= 10:
        if (
            first_server["precision"] >= 0.95
            and first_server["coverage"] >= 0.60
        ):
            recommendation = "automatic"
        elif first_server["precision"] >= 0.90:
            recommendation = "prefill_only"
    canaries = list(run.get("holdout_canaries") or [])
    canary_results = [
        row for row in first_server["matches"] if row["match_id"] in canaries
    ]
    worst_matches = sorted(
        point_calls["per_match"].items(),
        key=lambda item: (item[1]["precision"], -item[1]["decided"], item[0]),
    )[:5]
    split_rows = run.get("predictions") or {}
    cohort = {
        "points": sum(len(split_rows.get(split) or []) for split in ("train", "development", "holdout")),
        "matches": {
            split: len({str(row.get("match_id")) for row in (split_rows.get(split) or [])})
            for split in ("train", "development", "holdout")
        },
        "points_by_split": {
            split: len(split_rows.get(split) or [])
            for split in ("train", "development", "holdout")
        },
    }
    return {
        "schema_version": 1,
        "experiment": "temporal-serve-scale-v1",
        "manifest_sha256": run.get("manifest_sha256"),
        "preliminary": preliminary,
        "recommendation": recommendation,
        "cohort": cohort,
        "production_gate": {
            "automatic": {
                "minimum_decided_matches": 10,
                "minimum_precision": 0.95,
                "minimum_coverage": 0.60,
            },
            "prefill_only": {
                "minimum_decided_matches": 10,
                "minimum_precision": 0.90,
            },
        },
        "holdout": {
            "first_server": first_server,
            "point_calls": point_calls,
            "raw_argmax": _raw_argmax_metrics(holdout_rows),
            "onset": _onset_metrics(holdout_rows),
        },
        "ablations": {
            "temporal_only": temporal_only,
            "fused": point_calls,
            "frozen_baseline": baseline,
        },
        "holdout_canaries": canaries,
        "canary_results": canary_results,
        "worst_matches": [
            {"match_id": match_id, **metrics}
            for match_id, metrics in worst_matches
        ],
        "compute": _compute_projection(run.get("compute") or {}),
    }


def select_active_review(
    rows: Sequence[Mapping[str, Any]], limit: int = 60
) -> list[dict[str, Any]]:
    if limit < 0:
        raise ValueError("limit must be non-negative")
    ranked = []
    for row in rows:
        truth = (row.get("evaluation") or {}).get("expected_server_side")
        call = row.get("fused") or {}
        predicted = call.get("side")
        temporal = row.get("temporal") or {}
        near = float(temporal.get("near") or 0.0)
        far = float(temporal.get("far") or 0.0)
        if (
            call.get("status") == "high_confidence"
            and truth in {"near", "far"}
            and predicted in {"near", "far"}
            and predicted != truth
        ):
            priority, reason = 0, "confident_truth_contradiction"
        elif call.get("reason") == "temporal_chain_disagreement":
            priority, reason = 1, "evidence_disagreement"
        elif abs(near - far) <= 0.15:
            priority, reason = 2, "ambiguous_temporal_evidence"
        elif call.get("status") != "high_confidence":
            priority, reason = 3, "withheld_coverage_case"
        else:
            priority, reason = 4, "correct_control"
        ranked.append(
            {
                "priority": priority,
                "reason": reason,
                "source_id": row.get("source_id"),
                "match_id": row.get("match_id"),
                "source_point_idx": row.get("source_point_idx"),
                "expected_side": truth,
                "predicted_side": predicted,
                "confidence": float(call.get("confidence") or 0.0),
                "candidate_onset_s": temporal.get("onset_t"),
                "temporal_near": near,
                "temporal_far": far,
            }
        )
    ranked.sort(
        key=lambda row: (
            row["priority"],
            -row["confidence"],
            str(row["match_id"]),
            int(row["source_point_idx"] or 0),
        )
    )
    selected = []
    per_match: dict[str, int] = {}
    match_cap = max(2, math.ceil(max(limit, 1) / 8))
    for row in ranked:
        match_id = str(row["match_id"])
        if per_match.get(match_id, 0) >= match_cap:
            continue
        selected.append({key: value for key, value in row.items() if key != "priority"})
        per_match[match_id] = per_match.get(match_id, 0) + 1
        if len(selected) >= limit:
            break
    return selected


def render_report(score: Mapping[str, Any]) -> str:
    match = score["holdout"]["first_server"]
    point = score["holdout"]["point_calls"]
    onset = score["holdout"]["onset"]
    raw = score["holdout"]["raw_argmax"]
    cohort = score["cohort"]
    balance = match["truth_balance"]
    canaries = ", ".join(score.get("holdout_canaries") or []) or "none"
    qualification = "preliminary" if score.get("preliminary") else "complete"
    return f"""# Temporal serve-detection scale report

## Decision

- Recommendation: **{score['recommendation']}**
- Cohort qualification: **{qualification}**
- Holdout canary match(es): {canaries}

## Cohort

- {cohort['points']} points across {sum(cohort['matches'].values())} matches: {cohort['points_by_split']['train']} train / {cohort['points_by_split']['development']} development / {cohort['points_by_split']['holdout']} holdout.
- Match split: {cohort['matches']['train']} train / {cohort['matches']['development']} development / {cohort['matches']['holdout']} holdout.
- Holdout first-server truth balance: {balance['near']} near / {balance['far']} far. This imbalance makes an always-near headline accuracy misleading.

## Holdout results

- First server: {match['correct']}/{match['decided']} correct decisions from {match['eligible']} eligible matches; precision {match['precision']:.1%}, coverage {match['coverage']:.1%}.
- Point server: {point['correct']}/{point['decided']} correct decisions from {point['eligible']} eligible points; precision {point['precision']:.1%}, coverage {point['coverage']:.1%}.
- Raw temporal argmax (no abstention): {raw['correct']}/{raw['eligible']} correct points; accuracy {raw['accuracy']:.1%}.
- Labeled onset cases: {onset['labeled']}; median absolute error {onset['median_absolute_error_s']} seconds.

## Compute

- Observed seconds per point: {score['compute']['seconds_per_point']}
- Estimated cloud cost per 100 points: ${score['compute']['estimated_cost_per_100_points_usd']}
- Peak resident memory: {score['compute']['peak_rss_mb']} MB

## Model and licensing provenance

- Player motion: RTMPose/MMPose (Apache 2.0).
- Ball/table evidence: production BlurBall placement events (MIT).
- No YOLO, Ultralytics, OpenPose, or AGPL dependency is used by this experiment.

The automatic gate requires at least ten decided holdout matches, at least 95% precision, and at least 60% coverage. A preliminary cohort cannot advance regardless of its headline score.
"""


def _atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_score_artifacts(
    run: Mapping[str, Any], output_dir: Path
) -> dict[str, Path]:
    score = score_run(run)
    holdout_rows = list((run.get("predictions") or {}).get("holdout") or [])
    review = {
        "schema_version": 1,
        "manifest_sha256": run.get("manifest_sha256"),
        "items": select_active_review(holdout_rows, limit=60),
    }
    paths = {
        "score": output_dir / "score.json",
        "report": output_dir / "report.md",
        "active_review": output_dir / "active-review.json",
    }
    _atomic_text(paths["score"], json.dumps(score, indent=2, sort_keys=True) + "\n")
    _atomic_text(paths["report"], render_report(score))
    _atomic_text(paths["active_review"], json.dumps(review, indent=2, sort_keys=True) + "\n")
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or args.run.parent
    paths = write_score_artifacts(json.loads(args.run.read_text()), output)
    print(paths["report"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "render_report",
    "score_run",
    "select_active_review",
    "write_score_artifacts",
]
