"""Score frozen and backtracked service onsets against owner labels."""

from __future__ import annotations

from statistics import median
from typing import Any, Mapping, Sequence


def _metrics(
    rows: Sequence[Mapping[str, Any]],
    field: str,
) -> dict[str, Any]:
    decided = [
        row
        for row in rows
        if row.get(field) is not None
    ]
    signed = [
        float(row[field]) - float(row["actual"])
        for row in decided
    ]
    absolute = [abs(value) for value in signed]
    eligible = len(rows)
    return {
        "eligible": eligible,
        "decided": len(decided),
        "coverage": round(len(decided) / eligible, 6) if eligible else 0.0,
        "mean_signed_error_s": (
            round(sum(signed) / len(signed), 6) if signed else None
        ),
        "mae_s": (
            round(sum(absolute) / len(absolute), 6) if absolute else None
        ),
        "median_absolute_error_s": (
            round(median(absolute), 6) if absolute else None
        ),
        "within_0_1_s": sum(value <= 0.1 + 1e-9 for value in absolute),
        "within_0_2_s": sum(value <= 0.2 + 1e-9 for value in absolute),
        "within_0_5_s": sum(value <= 0.5 + 1e-9 for value in absolute),
    }


def score_onset_labels(
    export_payload: Mapping[str, Any],
    cases: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Join exact onset labels to frozen v1 and newly inferred v2 onsets."""

    case_ids = [str(case.get("source_id") or "") for case in cases]
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("cases contain duplicate source IDs")
    cases_by_id = {
        source_id: case
        for source_id, case in zip(case_ids, cases)
        if source_id
    }
    assignments = export_payload.get("assignments") or []
    assignment_ids = [
        str(assignment.get("source_id") or "")
        for assignment in assignments
    ]
    nonempty_ids = [source_id for source_id in assignment_ids if source_id]
    if len(nonempty_ids) != len(set(nonempty_ids)):
        raise ValueError("export contains duplicate source IDs")

    rows = []
    for assignment in assignments:
        onset_prefill = (
            (assignment.get("prefill") or {}).get("onset_v3") or {}
        )
        human_onset = (
            (assignment.get("human_label") or {}).get("onset") or {}
        )
        if (
            not onset_prefill.get("included")
            or human_onset.get("status") != "exact"
            or human_onset.get("time_s") is None
        ):
            continue
        source_id = str(assignment.get("source_id") or "")
        case = cases_by_id.get(source_id) or {}
        frozen = (
            (assignment.get("proposal") or {})
            .get("service_motion", {})
            .get("onset_t")
        )
        backtracked = (
            (case.get("oracle_motion") or {}).get("onset_t")
        )
        rows.append(
            {
                "source_id": source_id,
                "stratum": str(
                    onset_prefill.get("stratum") or "unspecified"
                ),
                "actual": float(human_onset["time_s"]),
                "frozen_v1": (
                    float(frozen) if frozen is not None else None
                ),
                "backtracked_v2": (
                    float(backtracked)
                    if backtracked is not None
                    else None
                ),
            }
        )

    strata = {}
    for stratum in sorted({str(row["stratum"]) for row in rows}):
        subset = [row for row in rows if row["stratum"] == stratum]
        strata[stratum] = {
            "eligible": len(subset),
            "frozen_v1": _metrics(subset, "frozen_v1"),
            "backtracked_v2": _metrics(subset, "backtracked_v2"),
        }
    return {
        "eligible": len(rows),
        "frozen_v1": _metrics(rows, "frozen_v1"),
        "backtracked_v2": _metrics(rows, "backtracked_v2"),
        "strata": strata,
        "rows": rows,
    }

