#!/usr/bin/env python3
"""Compare placement-v3 reconstruction under two table calibrations."""

from __future__ import annotations

import argparse
import copy
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import cv2

if __package__:
    from ..placement_backfill import (
        calibration_matrix,
        load_detections,
        reconstruct_existing_match,
    )
    from ..placement_retry_calibration import CORNER_NAMES, validate_quad
    from ..table_coordinates import canonicalize_table_quad
else:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from placement_backfill import (  # type: ignore
        calibration_matrix,
        load_detections,
        reconstruct_existing_match,
    )
    from placement_retry_calibration import (  # type: ignore
        CORNER_NAMES,
        validate_quad,
    )
    from table_coordinates import canonicalize_table_quad  # type: ignore


TABLE_WIDTH_M = 1.525
TABLE_LENGTH_M = 2.74
NET_V_M = TABLE_LENGTH_M / 2
TRUST_THRESHOLD = 0.70
BOUNDARY_MARGIN_M = 0.05
DEPTHS = ("short", "medium", "deep")
LATERALS = ("left", "middle", "right")


def _case_root(experiment_root: Path, case: Mapping[str, Any]) -> Path:
    root = (experiment_root / str(case["root"])).resolve()
    if not root.is_relative_to(experiment_root.resolve()):
        raise ValueError("case root escapes experiment root")
    return root


def calibration_from_consensus(
    case: Mapping[str, Any],
    result: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Convert accepted prepared-image corners into source-video calibration."""
    consensus = result.get("consensus") or {}
    calibration = result.get("calibration") or {}
    if not consensus.get("accepted") or not calibration.get("accepted"):
        return None
    image_width, image_height = (
        int(value) for value in case["image_size"]
    )
    source_width, source_height = (
        int(value) for value in case["source_size"]
    )
    if min(image_width, image_height, source_width, source_height) <= 0:
        raise ValueError("calibration dimensions must be positive")
    corners = np.asarray(calibration.get("corners"), dtype=np.float32)
    if corners.shape != (4, 2):
        raise ValueError("accepted calibration must contain four corners")
    corners *= np.asarray(
        [source_width / image_width, source_height / image_height],
        dtype=np.float32,
    )
    corners = validate_quad(
        corners,
        source_width,
        source_height,
        bounce_core=None,
        min_aspect=0.25,
    )
    canonical = canonicalize_table_quad(corners, near_pair=(0, 1))
    corners = canonical.corners
    A, B, C, D = corners
    axis = ((D - A) + (C - B)) / 2.0
    norm = float(np.linalg.norm(axis))
    if not math.isfinite(norm) or norm <= 1e-8:
        raise ValueError("accepted calibration has a degenerate length axis")
    axis /= norm
    return {
        "ok": True,
        "table_corners_px": {
            name: [round(float(point[0]), 3), round(float(point[1]), 3)]
            for name, point in zip(CORNER_NAMES, corners)
        },
        "length_axis": [float(axis[0]), float(axis[1])],
        "orientation": "canonical-v1",
        "legacy_reordered": canonical.reordered,
        "note": "read-only OpenAI calibration A/B experiment",
    }


def _third(value: float, total: float, labels: Sequence[str]) -> str:
    if value < total / 3:
        return str(labels[0])
    if value < total * 2 / 3:
        return str(labels[1])
    return str(labels[2])


def _receiver_coordinates(
    landing: Mapping[str, Any],
    receiver_side: str,
) -> tuple[float, float] | None:
    try:
        u = float(landing["u"])
        v = float(landing["v"])
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(u) or not math.isfinite(v):
        return None
    if not -1e-6 <= u <= TABLE_WIDTH_M + 1e-6:
        return None
    if not -1e-6 <= v <= TABLE_LENGTH_M + 1e-6:
        return None
    if receiver_side == "far":
        lateral = u
        depth = v - NET_V_M
    elif receiver_side == "near":
        lateral = TABLE_WIDTH_M - u
        depth = NET_V_M - v
    else:
        return None
    if not -1e-6 <= depth <= NET_V_M + 1e-6:
        return None
    return (
        min(max(lateral, 0.0), TABLE_WIDTH_M),
        min(max(depth, 0.0), NET_V_M),
    )


def landing_zone(
    landing: Mapping[str, Any],
    receiver_side: str,
) -> str | None:
    coordinates = _receiver_coordinates(landing, receiver_side)
    if coordinates is None:
        return None
    lateral, depth = coordinates
    return (
        f"{_third(depth, NET_V_M, DEPTHS)}_"
        f"{_third(lateral, TABLE_WIDTH_M, LATERALS)}"
    )


def _near_boundary(
    landing: Mapping[str, Any],
    receiver_side: str,
) -> bool:
    coordinates = _receiver_coordinates(landing, receiver_side)
    if coordinates is None:
        return False
    lateral, depth = coordinates
    boundaries = (
        TABLE_WIDTH_M / 3,
        TABLE_WIDTH_M * 2 / 3,
        NET_V_M / 3,
        NET_V_M * 2 / 3,
    )
    values = (lateral, lateral, depth, depth)
    return any(
        abs(value - boundary) <= BOUNDARY_MARGIN_M
        for value, boundary in zip(values, boundaries)
    )


def _status_counts(
    placements: Mapping[int, Mapping[str, Any]],
) -> dict[str, int]:
    counts = Counter()
    for placement in placements.values():
        status = str(placement.get("status") or "")
        if status not in {"ready", "review", "unavailable"}:
            hypothesis_statuses = {
                str(item.get("status") or "unavailable")
                for item in (placement.get("hypotheses") or {}).values()
            }
            status = (
                "ready"
                if "ready" in hypothesis_statuses
                else "review"
                if "review" in hypothesis_statuses
                else "unavailable"
            )
        counts[status] += 1
    return {
        name: int(counts[name])
        for name in ("ready", "review", "unavailable")
    }


def _landing_records(
    placements: Mapping[int, Mapping[str, Any]],
    match_id: str,
    *,
    trust_threshold: float = TRUST_THRESHOLD,
    allowed_statuses: set[str] | None = None,
) -> dict[tuple[Any, ...], dict[str, Any]]:
    allowed_statuses = allowed_statuses or {"ready", "review"}
    records = {}
    for point_idx, placement in placements.items():
        hypotheses = placement.get("hypotheses") or {}
        for hypothesis_key, hypothesis in hypotheses.items():
            server_side = str(
                hypothesis.get("server_side")
                or hypothesis.get("serverSide")
                or hypothesis_key
            )
            if server_side not in {"near", "far"}:
                continue
            if hypothesis.get("status") not in allowed_statuses:
                continue
            hypothesis_confidence = float(
                hypothesis.get("confidence") or 0.0
            )
            if hypothesis_confidence < trust_threshold:
                continue
            for shot in hypothesis.get("shots") or []:
                landing = shot.get("landing")
                if not isinstance(landing, Mapping):
                    continue
                landing_confidence = float(
                    landing.get("confidence", hypothesis_confidence) or 0.0
                )
                confidence = min(hypothesis_confidence, landing_confidence)
                if confidence < trust_threshold:
                    continue
                hitter_side = str(shot.get("hitter_side") or "")
                if hitter_side not in {"near", "far"}:
                    continue
                receiver_side = "far" if hitter_side == "near" else "near"
                zone = landing_zone(landing, receiver_side)
                if zone is None:
                    continue
                try:
                    shot_seq = int(shot["seq"])
                except (KeyError, TypeError, ValueError):
                    continue
                phase = str(shot.get("phase") or "rally")
                identity = (
                    str(match_id),
                    int(point_idx),
                    server_side,
                    shot_seq,
                    phase,
                    hitter_side,
                )
                records[identity] = {
                    "identity": {
                        "match_id": str(match_id),
                        "point_idx": int(point_idx),
                        "server_side": server_side,
                        "shot_seq": shot_seq,
                        "phase": phase,
                        "hitter_side": hitter_side,
                    },
                    "u": float(landing["u"]),
                    "v": float(landing["v"]),
                    "t": (
                        float(landing["t"])
                        if landing.get("t") is not None
                        else None
                    ),
                    "confidence": confidence,
                    "zone": zone,
                    "near_boundary": _near_boundary(landing, receiver_side),
                    "terminal_kind": (
                        (shot.get("terminal") or {}).get("kind")
                    ),
                }
    return records


def _frozen_prediction(
    record: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "u": round(float(record["u"]), 6),
        "v": round(float(record["v"]), 6),
        "t": record.get("t"),
        "confidence": round(float(record["confidence"]), 6),
        "zone": str(record["zone"]),
    }


def freeze_event_candidates(
    legacy: Mapping[int, Mapping[str, Any]],
    canonical: Mapping[int, Mapping[str, Any]],
    openai: Mapping[int, Mapping[str, Any]],
    match_id: str,
) -> list[dict[str, Any]]:
    """Freeze prediction arms for every trusted scored-event candidate."""
    arms = {
        "legacy_current": _landing_records(
            legacy,
            match_id,
            trust_threshold=0.25,
            allowed_statuses={"ready", "review", "unavailable"},
        ),
        "canonical_current": _landing_records(
            canonical,
            match_id,
            trust_threshold=0.25,
            allowed_statuses={"ready", "review", "unavailable"},
        ),
        "openai": _landing_records(
            openai,
            match_id,
            trust_threshold=0.25,
            allowed_statuses={"ready", "review", "unavailable"},
        ),
    }
    identities = sorted(set().union(*(set(records) for records in arms.values())))
    events = []
    for identity in identities:
        predictions = {
            name: _frozen_prediction(records.get(identity))
            for name, records in arms.items()
        }
        current = predictions["canonical_current"]
        proposed = predictions["openai"]
        if (current is None) != (proposed is None):
            comparison_class = "one_arm_abstention"
        elif current is None:
            continue
        else:
            displacement_cm = 100 * math.hypot(
                float(proposed["u"]) - float(current["u"]),
                float(proposed["v"]) - float(current["v"]),
            )
            comparison_class = (
                "agreement"
                if displacement_cm <= 15
                and proposed["zone"] == current["zone"]
                else "disagreement"
            )
        identity_payload = next(
            dict(record["identity"])
            for records in arms.values()
            if (record := records.get(identity)) is not None
        )
        shot_seq = int(identity_payload["shot_seq"])
        raw_phase = str(identity_payload["phase"])
        phase = (
            "serve"
            if shot_seq == 1
            else "return"
            if shot_seq == 2
            else "rally"
        )
        event_time = next(
            (
                prediction["t"]
                for prediction in (
                    predictions["canonical_current"],
                    predictions["openai"],
                    predictions["legacy_current"],
                )
                if prediction is not None and prediction.get("t") is not None
            ),
            None,
        )
        events.append(
            {
                "identity": {
                    **identity_payload,
                    "phase": phase,
                    "raw_phase": raw_phase,
                },
                "event_time_s": event_time,
                "comparison_class": comparison_class,
                **predictions,
            }
        )
    return events


def reproject_placement_landings(
    placements: Mapping[int, Mapping[str, Any]],
    calibration: Mapping[str, Any] | None,
) -> dict[int, dict[str, Any]]:
    """Project frozen landing pixels through one calibration arm."""
    if not calibration or not calibration.get("ok"):
        return {}
    H = calibration_matrix(calibration)
    projected = copy.deepcopy(dict(placements))
    for placement in projected.values():
        for hypothesis in (placement.get("hypotheses") or {}).values():
            for shot in hypothesis.get("shots") or []:
                landing = shot.get("landing")
                if not isinstance(landing, dict):
                    continue
                try:
                    x = float(landing["x"])
                    y = float(landing["y"])
                except (KeyError, TypeError, ValueError):
                    landing.pop("u", None)
                    landing.pop("v", None)
                    continue
                table = cv2.perspectiveTransform(
                    np.asarray([[[x, y]]], dtype=np.float32),
                    H,
                )[0, 0]
                u, v = (float(table[0]), float(table[1]))
                if (
                    math.isfinite(u)
                    and math.isfinite(v)
                    and -0.15 <= u <= TABLE_WIDTH_M + 0.15
                    and -0.15 <= v <= TABLE_LENGTH_M + 0.15
                ):
                    landing["u"] = min(max(u, 0.0), TABLE_WIDTH_M)
                    landing["v"] = min(max(v, 0.0), TABLE_LENGTH_M)
                else:
                    landing.pop("u", None)
                    landing.pop("v", None)
    return projected


def _percentile(values: Sequence[float], percentile: float) -> float | None:
    if not values:
        return None
    return round(
        float(np.percentile(np.asarray(values), percentile)),
        2,
    )


def _zone_counts(records: Mapping[tuple[Any, ...], Mapping[str, Any]]) -> dict:
    counts = Counter(str(item["zone"]) for item in records.values())
    return dict(sorted((zone, int(count)) for zone, count in counts.items()))


def compare_placements(
    current: Mapping[int, Mapping[str, Any]],
    proposed: Mapping[int, Mapping[str, Any]],
    match_id: str,
) -> dict[str, Any]:
    """Compare trusted landings matched by complete physical identity."""
    current_records = _landing_records(current, match_id)
    proposed_records = _landing_records(proposed, match_id)
    current_keys = set(current_records)
    proposed_keys = set(proposed_records)
    matched_keys = sorted(current_keys & proposed_keys)
    displacements = []
    zone_flips = 0
    lateral_flips = 0
    depth_flips = 0
    boundary_entries = 0
    boundary_exits = 0
    changed_points = []
    for key in matched_keys:
        left = current_records[key]
        right = proposed_records[key]
        displacement_cm = 100 * math.hypot(
            float(right["u"]) - float(left["u"]),
            float(right["v"]) - float(left["v"]),
        )
        displacements.append(displacement_cm)
        left_depth, left_lateral = str(left["zone"]).split("_", 1)
        right_depth, right_lateral = str(right["zone"]).split("_", 1)
        depth_changed = left_depth != right_depth
        lateral_changed = left_lateral != right_lateral
        zone_changed = depth_changed or lateral_changed
        if depth_changed:
            depth_flips += 1
        if lateral_changed:
            lateral_flips += 1
        if zone_changed:
            zone_flips += 1
        entered = not left["near_boundary"] and right["near_boundary"]
        exited = left["near_boundary"] and not right["near_boundary"]
        boundary_entries += int(entered)
        boundary_exits += int(exited)
        if zone_changed or entered or exited:
            changed_points.append(
                {
                    "identity": dict(left["identity"]),
                    "displacement_cm": round(displacement_cm, 2),
                    "current": dict(left),
                    "proposed": dict(right),
                }
            )
    return {
        "current_status": _status_counts(current),
        "proposed_status": _status_counts(proposed),
        "current_trusted_landings": len(current_records),
        "proposed_trusted_landings": len(proposed_records),
        "matched_landings": len(matched_keys),
        "current_only_landings": len(current_keys - proposed_keys),
        "proposed_only_landings": len(proposed_keys - current_keys),
        "displacement_cm": {
            "median": _percentile(displacements, 50),
            "p90": _percentile(displacements, 90),
            "maximum": (
                round(max(displacements), 2) if displacements else None
            ),
        },
        "lateral_flips": lateral_flips,
        "depth_flips": depth_flips,
        "zone_flips": zone_flips,
        "zone_flip_rate": {
            "numerator": zone_flips,
            "denominator": len(matched_keys),
        },
        "boundary_entries": boundary_entries,
        "boundary_exits": boundary_exits,
        "current_zones": _zone_counts(current_records),
        "proposed_zones": _zone_counts(proposed_records),
        "changed_points": changed_points,
    }


def _corner_displacement(
    current: Mapping[str, Any],
    proposed: Mapping[str, Any],
    source_size: Sequence[int],
) -> dict[str, Any]:
    current_corners = current.get("table_corners_px") or {}
    proposed_corners = proposed.get("table_corners_px") or {}
    if not all(name in current_corners for name in CORNER_NAMES):
        return {"status": "current_unavailable"}
    if not all(name in proposed_corners for name in CORNER_NAMES):
        return {"status": "proposed_unavailable"}
    left = np.asarray([current_corners[name] for name in CORNER_NAMES])
    right = np.asarray([proposed_corners[name] for name in CORNER_NAMES])
    distances = np.linalg.norm(right - left, axis=1)
    diagonal = math.hypot(float(source_size[0]), float(source_size[1]))
    return {
        "status": "measured",
        "corner_px": [round(float(value), 2) for value in distances],
        "median_px": round(float(np.median(distances)), 2),
        "maximum_px": round(float(np.max(distances)), 2),
        "median_frame_diagonal_ratio": round(
            float(np.median(distances)) / diagonal,
            6,
        ),
        "maximum_frame_diagonal_ratio": round(
            float(np.max(distances)) / diagonal,
            6,
        ),
    }


def _merge_points(
    match: Mapping[str, Any],
    case: Mapping[str, Any],
) -> list[dict[str, Any]]:
    stored = {
        int(point["idx"]): dict(point)
        for point in match.get("points") or []
    }
    merged = []
    for authoritative in case.get("points") or []:
        index = int(authoritative["idx"])
        point = stored.get(index, {"idx": index})
        point.update(dict(authoritative))
        merged.append(point)
    return merged


def compare_case(
    case: Mapping[str, Any],
    result: Mapping[str, Any],
    experiment_root: Path,
) -> dict[str, Any]:
    match_id = str(case["match_id"])
    if str(result.get("match_id")) != match_id:
        raise ValueError("OpenAI result does not match prepared case")
    root = _case_root(Path(experiment_root), case)
    match_path = (root / str(case["match_json"])).resolve()
    blurball_path = (root / str(case["blurball"])).resolve()
    if not match_path.is_relative_to(root) or not blurball_path.is_relative_to(
        root
    ):
        raise ValueError("prepared input path escapes case root")
    match = json.loads(match_path.read_text())
    points = _merge_points(match, case)
    detections = load_detections(blurball_path)
    current_calibration = match.get("calibration")
    proposed_calibration = calibration_from_consensus(case, result)
    current = (
        reconstruct_existing_match(
            match,
            points,
            detections,
            current_calibration,
        )
        if isinstance(current_calibration, Mapping)
        and current_calibration.get("ok")
        else {}
    )
    proposed = (
        reconstruct_existing_match(
            match,
            points,
            detections,
            proposed_calibration,
        )
        if proposed_calibration is not None
        else {}
    )
    legacy = {
        int(point["idx"]): point.get("placement") or {}
        for point in match.get("points") or []
    }
    canonical_projection = reproject_placement_landings(
        legacy,
        current_calibration,
    )
    openai_projection = reproject_placement_landings(
        legacy,
        proposed_calibration,
    )
    comparison = compare_placements(current, proposed, match_id)
    clip_root = str(case.get("clips") or "clips")
    for changed in comparison["changed_points"]:
        point_idx = int(changed["identity"]["point_idx"])
        changed["clip"] = f"{clip_root}/point-{point_idx:03d}.mp4"
    return {
        "match_id": match_id,
        "source_size": list(case["source_size"]),
        "image_size": list(case["image_size"]),
        "representative_image": case["images"][1]["path"],
        "current_calibration": current_calibration,
        "proposed_calibration": proposed_calibration,
        "openai": {
            "consensus": result.get("consensus") or {},
            "calibration": result.get("calibration") or {},
            "provider": result.get("provider") or {},
            "accuracy": result.get("accuracy") or {},
        },
        "corner_displacement": _corner_displacement(
            current_calibration or {},
            proposed_calibration or {},
            case["source_size"],
        ),
        "placement": comparison,
        "event_candidates": freeze_event_candidates(
            legacy,
            canonical_projection,
            openai_projection,
            match_id,
        ),
    }


def compare_experiment(
    cases_path: Path,
    results_path: Path,
) -> dict[str, Any]:
    cases_payload = json.loads(Path(cases_path).read_text())
    results_payload = json.loads(Path(results_path).read_text())
    cases = cases_payload.get("cases") or []
    results = results_payload.get("cases") or []
    results_by_id = {
        str(result["match_id"]): result for result in results
    }
    case_ids = [str(case["match_id"]) for case in cases]
    if len(case_ids) != len(set(case_ids)) or set(case_ids) != set(
        results_by_id
    ):
        raise ValueError("prepared and OpenAI result match IDs differ")
    root = Path(cases_path).resolve().parent
    comparisons = [
        compare_case(case, results_by_id[str(case["match_id"])], root)
        for case in cases
    ]
    total_matched = sum(
        item["placement"]["matched_landings"] for item in comparisons
    )
    total_flips = sum(
        item["placement"]["zone_flips"] for item in comparisons
    )
    total_cost = sum(
        float(
            ((item["openai"].get("provider") or {}).get("estimated_usd"))
            or 0.0
        )
        for item in comparisons
    )
    return {
        "version": 1,
        "run_id": results_payload.get("run_id"),
        "model": results_payload.get("model"),
        "summary": {
            "matches": len(comparisons),
            "accepted_openai_calibrations": sum(
                int(item["proposed_calibration"] is not None)
                for item in comparisons
            ),
            "matched_landings": total_matched,
            "zone_flips": total_flips,
            "zone_flip_rate": {
                "numerator": total_flips,
                "denominator": total_matched,
            },
            "estimated_usd": round(total_cost, 9),
        },
        "cases": comparisons,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--openai-results", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    output = args.output.resolve()
    experiment_root = args.cases.resolve().parent
    if not output.is_relative_to(experiment_root):
        raise ValueError("comparison output must stay under experiment root")
    payload = compare_experiment(args.cases, args.openai_results)
    output.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"compared {len(payload['cases'])} calibration cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
