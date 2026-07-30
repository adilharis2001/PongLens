#!/usr/bin/env python3
"""Score the blinded service-motion experiment and freeze onset review."""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


ONSET_REVIEW_QUOTAS = {
    "visible": 4,
    "occluded": 12,
    "prior_wrong_server": 1,
}


def _truth_by_source(
    export_payload: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        str(item["source_id"]): {
            "side": (item.get("gold") or {}).get("scored_server_side"),
            "human_label": dict(item.get("human_label") or {}),
        }
        for item in export_payload.get("assignments") or []
    }


def _call_metrics(
    cases: Sequence[Mapping[str, Any]],
    field: str,
    truth: Mapping[str, Mapping[str, Any]],
    *,
    threshold: float = 0.0,
) -> dict[str, Any]:
    by_match: dict[str, dict[str, int]] = defaultdict(
        lambda: {"eligible": 0, "decided": 0, "correct": 0}
    )
    decided = 0
    correct = 0
    for case in cases:
        source_id = str(case["source_id"])
        match_id = str(case["source_match_id"])
        call = case.get(field) or {}
        by_match[match_id]["eligible"] += 1
        is_decided = (
            call.get("status") == "high_confidence"
            and call.get("side") in {"near", "far"}
            and float(call.get("confidence") or 0.0) >= threshold
        )
        if not is_decided:
            continue
        decided += 1
        by_match[match_id]["decided"] += 1
        is_correct = call.get("side") == (
            truth.get(source_id) or {}
        ).get("side")
        correct += int(is_correct)
        by_match[match_id]["correct"] += int(is_correct)
    eligible = len(cases)
    per_match = {}
    decided_precisions = []
    for match_id, counts in sorted(by_match.items()):
        precision = (
            counts["correct"] / counts["decided"]
            if counts["decided"]
            else None
        )
        if precision is not None:
            decided_precisions.append(precision)
        per_match[match_id] = {
            **counts,
            "precision": precision,
            "coverage": (
                counts["decided"] / counts["eligible"]
                if counts["eligible"]
                else 0.0
            ),
        }
    return {
        "eligible": eligible,
        "decided": decided,
        "correct": correct,
        "precision": correct / decided if decided else 0.0,
        "coverage": decided / eligible if eligible else 0.0,
        "abstention": 1.0 - decided / eligible if eligible else 0.0,
        "per_match": per_match,
        "worst_match_precision": (
            min(decided_precisions) if decided_precisions else 0.0
        ),
    }


def _first_server_metrics(stage_c: Mapping[str, Any]) -> dict[str, Any]:
    truth = {
        str(key): value
        for key, value in (stage_c.get("truth") or {}).items()
        if value in {"near", "far"}
    }
    decoders = stage_c.get("decoders") or {}
    per_match = {}
    decided = 0
    correct = 0
    missing_point_alignments = 0
    for match_id, expected in sorted(truth.items()):
        decoder = decoders.get(match_id) or {}
        is_decided = (
            decoder.get("status") == "high_confidence"
            and decoder.get("side") in {"near", "far"}
        )
        is_correct = is_decided and decoder.get("side") == expected
        decided += int(is_decided)
        correct += int(is_correct)
        alignment = decoder.get("alignment") or {}
        missing = int(alignment.get("missing_points") or 0)
        missing_point_alignments += int(is_decided and missing > 0)
        per_match[match_id] = {
            "expected": expected,
            "status": decoder.get("status", "withheld"),
            "predicted": decoder.get("side"),
            "confidence": float(decoder.get("confidence") or 0.0),
            "correct": bool(is_correct) if is_decided else None,
            "missing_points": missing if is_decided else None,
        }
    eligible = len(truth)
    return {
        "eligible": eligible,
        "decided": decided,
        "correct": correct,
        "precision": correct / decided if decided else 0.0,
        "coverage": decided / eligible if eligible else 0.0,
        "abstention": 1.0 - decided / eligible if eligible else 0.0,
        "missing_point_alignments": missing_point_alignments,
        "per_match": per_match,
    }


def _recommendation(
    point_metrics: Mapping[str, Any],
    first_server_metrics: Mapping[str, Any],
    lomo_metrics: Mapping[str, Any],
) -> str:
    precision = float(point_metrics.get("precision") or 0.0)
    worst = float(point_metrics.get("worst_match_precision") or 0.0)
    first_precision = float(first_server_metrics.get("precision") or 0.0)
    first_eligible = int(first_server_metrics.get("eligible") or 0)
    first_decided = int(first_server_metrics.get("decided") or 0)
    lomo_precision = float(lomo_metrics.get("precision") or 0.0)
    lomo_worst = float(lomo_metrics.get("worst_match_precision") or 0.0)
    if (
        precision >= 0.95
        and worst >= 0.90
        and first_eligible >= 5
        and first_decided >= 5
        and first_precision >= 0.95
        and lomo_precision >= 0.95
        and lomo_worst >= 0.90
    ):
        return "automatic"
    if (
        precision >= 0.90
        and first_eligible >= 5
        and first_decided >= 5
        and first_precision >= 0.90
        and lomo_precision >= 0.90
    ):
        return "prefill_only"
    return "research_only"


def score_experiment(
    results: Mapping[str, Any],
    export_payload: Mapping[str, Any],
) -> dict[str, Any]:
    truth = _truth_by_source(export_payload)
    cases = [dict(item) for item in results.get("cases") or []]
    unknown = {
        str(item["source_id"]) for item in cases
    } - set(truth)
    if unknown:
        raise ValueError("results contain sources absent from sealed export")
    oracle = _call_metrics(cases, "oracle_motion", truth)
    automatic = _call_metrics(cases, "detected_motion", truth)
    first_server = _first_server_metrics(results.get("stage_c") or {})
    onset_development = dict(results.get("onset_development") or {})
    lomo = leave_one_match_out(
        cases,
        [0.70, 0.75, 0.80, 0.85, 0.90, 0.95],
    )
    lomo_metrics = _lomo_metrics(lomo)
    by_stratum = {
        stratum: _call_metrics(
            [item for item in cases if item.get("stratum") == stratum],
            "detected_motion",
            truth,
        )
        for stratum in (
            "visible",
            "occluded",
            "prior_wrong_server",
        )
    }
    challenge_cases = [
        item
        for item in cases
        if item.get("stratum") in {"occluded", "prior_wrong_server"}
    ]
    contact_errors = []
    first_bounce_errors = []
    for item in cases:
        call = item.get("detected_motion") or {}
        evaluation = item.get("evaluation") or {}
        expected_contact = evaluation.get("serve_contact_s")
        if call.get("contact_t") is not None and expected_contact is not None:
            contact_errors.append(
                abs(float(call["contact_t"]) - float(expected_contact))
            )
        predicted_first = call.get("first_bounce") or {}
        expected_first = evaluation.get("first_bounce") or {}
        if (
            isinstance(predicted_first, Mapping)
            and predicted_first.get("t") is not None
            and expected_first.get("time_s") is not None
        ):
            first_bounce_errors.append(
                abs(
                    float(predicted_first["t"])
                    - float(expected_first["time_s"])
                )
            )
    return {
        "schema_version": 1,
        "batch_slug": (
            (export_payload.get("batch") or {}).get("slug")
        ),
        "oracle": oracle,
        "automatic": automatic,
        "full_batch": automatic,
        "challenge_set": _call_metrics(
            challenge_cases,
            "detected_motion",
            truth,
        ),
        "by_stratum": by_stratum,
        "timing": {
            "contact_mae_s": (
                sum(contact_errors) / len(contact_errors)
                if contact_errors
                else None
            ),
            "contact_count": len(contact_errors),
            "first_bounce_mae_s": (
                sum(first_bounce_errors) / len(first_bounce_errors)
                if first_bounce_errors
                else None
            ),
            "first_bounce_count": len(first_bounce_errors),
            "onset_accuracy_status": (
                "completed"
                if int(onset_development.get("eligible") or 0) > 0
                else "awaiting_human_labels"
            ),
        },
        "onset_development": onset_development,
        "leave_one_match_out": {**lomo, "summary": lomo_metrics},
        "recommendation": _recommendation(
            automatic,
            first_server,
            lomo_metrics,
        ),
        "compute": dict(results.get("compute") or {}),
        "stage_c": dict(results.get("stage_c") or {}),
        "first_server": first_server,
    }


def leave_one_match_out(
    cases: Sequence[Mapping[str, Any]],
    threshold_grid: Sequence[float],
) -> dict[str, Any]:
    """Fit a precision-preserving threshold without each held-out match."""

    truth = {
        str(item["source_id"]): {
            "side": (item.get("evaluation") or {}).get(
                "scored_server_side"
            )
        }
        for item in cases
    }
    folds = {}
    match_ids = sorted({str(item["source_match_id"]) for item in cases})
    for held_out in match_ids:
        train = [
            item
            for item in cases
            if str(item["source_match_id"]) != held_out
        ]
        test = [
            item
            for item in cases
            if str(item["source_match_id"]) == held_out
        ]
        candidates = []
        for threshold in sorted(set(float(item) for item in threshold_grid)):
            metrics = _call_metrics(
                train,
                "detected_motion",
                truth,
                threshold=threshold,
            )
            if metrics["precision"] >= 0.95:
                candidates.append((metrics["decided"], threshold))
        threshold = (
            max(candidates)[1]
            if candidates
            else max(float(item) for item in threshold_grid)
        )
        folds[held_out] = {
            "threshold": threshold,
            "train": _call_metrics(
                train,
                "detected_motion",
                truth,
                threshold=threshold,
            ),
            "test": _call_metrics(
                test,
                "detected_motion",
                truth,
                threshold=threshold,
            ),
        }
    return {"folds": folds}


def _lomo_metrics(result: Mapping[str, Any]) -> dict[str, Any]:
    tests = [
        fold.get("test") or {}
        for fold in (result.get("folds") or {}).values()
    ]
    decided = sum(int(item.get("decided") or 0) for item in tests)
    correct = sum(int(item.get("correct") or 0) for item in tests)
    eligible = sum(int(item.get("eligible") or 0) for item in tests)
    decided_match_precisions = [
        float(item["precision"])
        for item in tests
        if int(item.get("decided") or 0) > 0
    ]
    return {
        "eligible": eligible,
        "decided": decided,
        "correct": correct,
        "precision": correct / decided if decided else 0.0,
        "coverage": decided / eligible if eligible else 0.0,
        "worst_match_precision": (
            min(decided_match_precisions)
            if decided_match_precisions
            else 0.0
        ),
    }


def _stable_key(*parts: object) -> str:
    return hashlib.sha256(
        ":".join(str(item) for item in parts).encode()
    ).hexdigest()


def _round_robin_matches(
    cases: Sequence[Mapping[str, Any]],
    count: int,
    stratum: str,
) -> list[Mapping[str, Any]]:
    grouped: dict[str, deque[Mapping[str, Any]]] = {}
    for match_id in sorted(
        {str(item["source_match_id"]) for item in cases}
    ):
        values = sorted(
            (
                item
                for item in cases
                if str(item["source_match_id"]) == match_id
            ),
            key=lambda item: _stable_key(
                "onset-v3",
                stratum,
                item["source_id"],
            ),
        )
        grouped[match_id] = deque(values)
    chosen = []
    while len(chosen) < count and any(grouped.values()):
        for match_id in sorted(grouped):
            if grouped[match_id] and len(chosen) < count:
                chosen.append(grouped[match_id].popleft())
    return chosen


def choose_onset_review_subset(
    cases: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Freeze every reviewable Stage A onset, balanced where possible."""

    values = [dict(item) for item in cases]
    selected = []
    used = set()
    for stratum, quota in ONSET_REVIEW_QUOTAS.items():
        eligible = [
            item
            for item in values
            if item.get("stratum") == stratum
            and str(item["source_id"]) not in used
            and (item.get("oracle_motion") or {}).get("status")
            == "high_confidence"
            and (item.get("oracle_motion") or {}).get("onset_t")
            is not None
        ]
        chosen = _round_robin_matches(eligible, quota, stratum)
        if len(chosen) != quota:
            raise ValueError(
                f"onset subset lacks {quota} unique {stratum} sources"
            )
        selected.extend((stratum, item) for item in chosen)
        used.update(str(item["source_id"]) for item in chosen)
    selected.sort(
        key=lambda pair: (
            {"visible": 0, "occluded": 1, "prior_wrong_server": 2}[
                pair[0]
            ],
            _stable_key("onset-v3-order", pair[1]["source_id"]),
        )
    )
    output = []
    for order, (stratum, item) in enumerate(selected, start=1):
        # The onset-review subset is intentionally oracle-windowed: Stage A
        # passed the player-attribution gate, while automatic bounce selection
        # did not produce coverage. The reviewer is validating the motion
        # onset proposal, not the already-known first-bounce anchor.
        proposal = item.get("oracle_motion") or {}
        evaluation = item.get("evaluation") or {}
        first = proposal.get("first_bounce") or {}
        second = proposal.get("second_bounce") or {}
        output.append(
            {
                "source_id": str(item["source_id"]),
                "source_match_id": str(item["source_match_id"]),
                "order": order,
                "stratum": stratum,
                "proposal": {
                    "status": proposal.get("status"),
                    "side": proposal.get("side"),
                    "onset_t": proposal.get("onset_t"),
                    "contact_t": proposal.get("contact_t"),
                    "first_bounce_t": (
                        first.get("t")
                        if isinstance(first, Mapping)
                        and first.get("t") is not None
                        else evaluation.get("first_bounce", {}).get("time_s")
                    ),
                    "second_bounce_t": (
                        second.get("t")
                        if isinstance(second, Mapping)
                        and second.get("t") is not None
                        else evaluation.get("second_bounce", {}).get("time_s")
                    ),
                },
            }
        )
    return output


def render_markdown_report(score: Mapping[str, Any]) -> str:
    oracle = score["oracle"]
    automatic = score["automatic"]
    first_server = score["first_server"]
    onset = score.get("onset_development") or {}
    onset_v1 = onset.get("frozen_v1") or {}
    onset_v2 = onset.get("backtracked_v2") or {}
    compute = (score.get("compute") or {}).get("total") or {}
    lines = [
            "# Service-motion first-server experiment",
            "",
            f"- Recommendation: **{score['recommendation']}**",
            (
                "- Oracle-window player precision: "
                f"{oracle['precision']:.1%} "
                f"({oracle['decided']}/{oracle['eligible']} decided)"
            ),
            (
                "- Automatic player precision: "
                f"{automatic['precision']:.1%}; "
                f"coverage {automatic['coverage']:.1%}"
            ),
            (
                "- Worst-match automatic precision: "
                f"{automatic['worst_match_precision']:.1%}"
            ),
            (
                "- First-server decoding: "
                f"{first_server['correct']}/{first_server['decided']} "
                f"correct decisions across {first_server['eligible']} matches; "
                f"coverage {first_server['coverage']:.1%}"
            ),
            (
                "- End-to-end bounded pose compute: "
                f"{float(compute.get('inference_s') or 0.0):.1f}s inference, "
                f"{int(compute.get('posed_frames') or 0)} player-frame poses"
            ),
    ]
    if int(onset.get("eligible") or 0) > 0:
        lines.extend(
            [
                (
                    "- Frozen onset MAE: "
                    f"{float(onset_v1.get('mae_s') or 0.0):.3f}s"
                ),
                (
                    "- Backtracked onset MAE: "
                    f"{float(onset_v2.get('mae_s') or 0.0):.3f}s; "
                    f"coverage "
                    f"{float(onset_v2.get('coverage') or 0.0):.1%}"
                ),
            ]
        )
    else:
        lines.append(
            "- Onset timing accuracy is awaiting human labels."
        )
    lines.extend(["", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--export", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    results = json.loads(args.results.read_text())
    export = json.loads(args.export.read_text())
    score = score_experiment(results, export)
    onset = choose_onset_review_subset(results.get("cases") or [])
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "score.json").write_text(
        json.dumps(score, indent=2, sort_keys=True) + "\n"
    )
    (args.output / "onset-review.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "batch_slug": score["batch_slug"],
                "model_sha256": (
                    (results.get("model") or {}).get("sha256")
                ),
                "selected": onset,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    (args.output / "report.md").write_text(render_markdown_report(score))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
