#!/usr/bin/env python3
"""Run the blinded service-motion / first-server research experiment."""

from __future__ import annotations

import argparse
from collections import defaultdict
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Callable, Mapping, Sequence

import cv2

from worker.build_serve_detection_research import (
    MEDIA_BUCKET,
    _pre_roll_for_match,
    parse_r2_uri,
)
from worker.build_winner_constrained_ending_research import (
    align_placement_to_clip,
)
from worker.extract_service_motion_rtmpose import (
    create_pose_model,
    extract_pose_window,
    window_frame_indices,
)
from worker.eval.run_enhanced_terminal_poc import DETECTOR_CONFIG
from worker.first_server_decoder import decode_first_server
from worker.match_structure import build_player_regions
from worker.service_motion import analyze_service_motion
from worker.service_motion_chains import (
    enumerate_serve_chains,
    fuse_chain_and_motion,
)
from worker.score_service_onset_labels import score_onset_labels


BATCH_SLUG = "serve-detection-cross-match-v1"
FOLLOWUP_COUNT = 42
FORBIDDEN_DETECTOR_KEYS = {
    "first_server",
    "gold",
    "human_label",
    "reviewer_id",
    "scored_server",
    "scored_server_player",
    "scored_server_side",
    "winner",
}


def _followup(assignment: Mapping[str, Any]) -> Mapping[str, Any]:
    label = assignment.get("human_label") or {}
    value = label.get("followup") or {}
    return value if isinstance(value, Mapping) else {}


def validate_export(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Validate and return the frozen 42-assignment follow-up cohort."""

    batch = payload.get("batch") or {}
    if batch.get("slug") != BATCH_SLUG:
        raise ValueError("export belongs to another research batch")
    assignments = payload.get("assignments") or []
    if not isinstance(assignments, Sequence):
        raise ValueError("export assignments must be a list")
    source_ids = [str(item.get("source_id") or "") for item in assignments]
    if not all(source_ids) or len(source_ids) != len(set(source_ids)):
        raise ValueError("export contains duplicate or missing source IDs")
    completed = [
        dict(item)
        for item in assignments
        if _followup(item).get("submitted_at")
    ]
    if len(completed) != FOLLOWUP_COUNT:
        raise ValueError(
            f"export must contain exactly {FOLLOWUP_COUNT} submitted "
            "follow-up assignments"
        )
    for item in completed:
        if not _followup(item).get("submitted_at"):
            raise ValueError("every included follow-up must be submitted")
    return completed


def _sha256_materialized(source: Mapping[str, Any]) -> str:
    payload = source.get("media_bytes")
    if isinstance(payload, bytes):
        return hashlib.sha256(payload).hexdigest()
    path = source.get("media_path")
    if path:
        digest = hashlib.sha256()
        with Path(path).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    raise RuntimeError("materialized source has no media bytes or path")


def _validate_or_write_stage_c_manifest(
    path: Path,
    entries: Sequence[Mapping[str, Any]],
) -> None:
    sealed = {
        "schema_version": 1,
        "points": sorted(
            [dict(item) for item in entries],
            key=lambda item: (
                str(item["source_match_id"]),
                int(item["source_point_idx"]),
                str(item["source_point_id"]),
            ),
        ),
    }
    if path.exists():
        if json.loads(path.read_text()) != sealed:
            raise RuntimeError(
                "Stage C point selection or media changed from sealed manifest"
            )
        return
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(sealed, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def _json_safe(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _assert_blinded(value: Any, path: str = "detector_input") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).lower()
            if normalized in FORBIDDEN_DETECTOR_KEYS:
                raise ValueError(
                    f"forbidden detector input key at {path}.{key}"
                )
            _assert_blinded(child, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            _assert_blinded(child, f"{path}[{index}]")


def _align_hypothesis_times(
    placement: Mapping[str, Any],
) -> dict[str, Any]:
    """Copy clip-relative candidate times into nested reconstruction events."""

    aligned = deepcopy(dict(placement))
    candidate_times = {
        str(item.get("id")): (
            float(item["t"]),
            float(item.get("source_t", item["t"])),
        )
        for item in aligned.get("candidates") or []
        if isinstance(item, Mapping)
        and item.get("id")
        and item.get("t") is not None
    }
    hypotheses = aligned.get("hypotheses") or {}
    if not isinstance(hypotheses, Mapping):
        return aligned
    for hypothesis in hypotheses.values():
        if not isinstance(hypothesis, Mapping):
            continue
        for shot in hypothesis.get("shots") or []:
            if not isinstance(shot, Mapping):
                continue
            for key in ("serve_first_bounce", "landing", "contact"):
                event = shot.get(key)
                if not isinstance(event, dict):
                    continue
                event_id = str(event.get("event_id") or event.get("id") or "")
                times = candidate_times.get(event_id)
                if times is None:
                    continue
                event["t"], event["source_t"] = times
                if key == "contact":
                    shot["contact_t"] = times[0]
    return aligned


def _detector_input(
    source: Mapping[str, Any],
    detections: Mapping[int, Sequence[float]],
) -> dict[str, Any]:
    allowed = {
        key: source.get(key)
        for key in (
            "source_id",
            "source_match_id",
            "source_point_id",
            "source_point_idx",
            "match_key",
            "media_path",
            "video",
            "placement",
            "calibration",
            "audio_candidates",
        )
        if source.get(key) is not None
    }
    allowed["detections"] = dict(detections)
    result = _json_safe(allowed)
    _assert_blinded(result)
    return result


def _precision(
    calls: Sequence[Mapping[str, Any]],
    truth: Mapping[str, str | None],
) -> dict[str, Any]:
    decided = [
        item
        for item in calls
        if item.get("status") == "high_confidence"
        and item.get("side") in {"near", "far"}
    ]
    correct = sum(
        item.get("side") == truth.get(str(item.get("source_id")))
        for item in decided
    )
    return {
        "eligible": len(calls),
        "decided": len(decided),
        "correct": correct,
        "precision": round(correct / len(decided), 6) if decided else 0.0,
        "coverage": round(len(decided) / len(calls), 6) if calls else 0.0,
    }


def _sum_compute(compute: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        "decoded_frames": sum(
            int(item.get("decoded_frames") or 0) for item in compute
        ),
        "posed_frames": sum(
            int(item.get("posed_frames") or 0) for item in compute
        ),
        "inference_s": round(
            sum(float(item.get("inference_s") or 0.0) for item in compute),
            6,
        ),
        "elapsed_s": round(
            sum(float(item.get("elapsed_s") or 0.0) for item in compute),
            6,
        ),
        "peak_rss_mb": max(
            (float(item.get("peak_rss_mb") or 0.0) for item in compute),
            default=0.0,
        ),
    }


def _compute_totals(
    cases: Sequence[Mapping[str, Any]],
    early_calls: Mapping[str, Sequence[Mapping[str, Any]]] | None = None,
) -> dict[str, Any]:
    stage_a = _sum_compute(
        [
            (case.get("oracle_motion") or {}).get("compute") or {}
            for case in cases
        ]
    )
    stage_b = _sum_compute(
        [
            (case.get("detected_motion") or {}).get("compute") or {}
            for case in cases
        ]
    )
    stage_c = _sum_compute(
        [
            item.get("compute") or {}
            for calls in (early_calls or {}).values()
            for item in calls
        ]
    )
    total = _sum_compute([stage_a, stage_b, stage_c])
    return {
        "stage_a": stage_a,
        "stage_b": stage_b,
        "stage_c": stage_c,
        "total": total,
    }


def _motion_call(source_id: str, motion: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "source_id": source_id,
        "status": motion.get("status"),
        "side": motion.get("side"),
        "confidence": float(motion.get("confidence") or 0.0),
    }


def _rotation_side(first_side: str, position: int) -> str:
    if first_side not in {"near", "far"}:
        raise ValueError("first side must be near or far")
    if position < 0:
        raise ValueError("position must be non-negative")
    if (position // 2) % 2 == 0:
        return first_side
    return "far" if first_side == "near" else "near"


def _held_out_point_metrics(
    calls_by_match: Mapping[str, Sequence[Mapping[str, Any]]],
    first_server_truth: Mapping[str, str],
) -> dict[str, Any]:
    eligible = 0
    decided = 0
    correct = 0
    per_match = {}
    for match_id, expected_first in sorted(first_server_truth.items()):
        calls = sorted(
            calls_by_match.get(match_id) or [],
            key=lambda item: int(item.get("position") or 0),
        )
        match_decided = 0
        match_correct = 0
        rows = []
        for call in calls:
            position = int(call.get("position") or 0)
            expected = _rotation_side(expected_first, position)
            is_decided = (
                call.get("status") == "high_confidence"
                and call.get("side") in {"near", "far"}
            )
            is_correct = is_decided and call.get("side") == expected
            eligible += 1
            decided += int(is_decided)
            correct += int(is_correct)
            match_decided += int(is_decided)
            match_correct += int(is_correct)
            rows.append(
                {
                    "source_point_id": call.get("source_point_id"),
                    "position": position,
                    "expected": expected,
                    "predicted": call.get("side"),
                    "status": call.get("status", "withheld"),
                    "correct": bool(is_correct) if is_decided else None,
                }
            )
        per_match[match_id] = {
            "eligible": len(calls),
            "decided": match_decided,
            "correct": match_correct,
            "precision": (
                round(match_correct / match_decided, 6)
                if match_decided
                else 0.0
            ),
            "points": rows,
        }
    return {
        "eligible": eligible,
        "decided": decided,
        "correct": correct,
        "precision": round(correct / decided, 6) if decided else 0.0,
        "coverage": round(decided / eligible, 6) if eligible else 0.0,
        "per_match": per_match,
    }


def _automatic_motion(
    detector_input: Mapping[str, Any],
    pose_model: Any,
) -> dict[str, Any]:
    chains = enumerate_serve_chains(detector_input.get("placement") or {})
    if not chains:
        return {
            "status": "withheld",
            "side": None,
            "confidence": 0.0,
            "reason": "no_legal_bounce_chain",
            "chains_considered": 0,
        }
    candidates = []
    motion_compute = []
    for chain in chains[:3]:
        motion = pose_model.analyze(
            detector_input,
            float(chain["first_bounce"]["t"]),
        )
        fused = fuse_chain_and_motion(chain, motion)
        fused["motion"] = motion
        candidates.append(fused)
        motion_compute.append(motion.get("compute") or {})
    candidates.sort(
        key=lambda item: (
            float(item.get("confidence") or 0.0),
            float(item.get("chain_score") or 0.0),
        ),
        reverse=True,
    )
    best = {
        **candidates[0],
        "chains_considered": len(candidates),
        "compute": _sum_compute(motion_compute),
    }
    return best


def _ablation_rows(
    cases: Sequence[Mapping[str, Any]],
    truth: Mapping[str, str | None],
) -> list[dict[str, Any]]:
    def calls(field: str) -> list[dict[str, Any]]:
        return [
            _motion_call(str(case["source_id"]), case.get(field) or {})
            for case in cases
        ]

    unanchored = []
    for case in cases:
        detector = case.get("unanchored_pose") or {}
        unanchored.append(
            {
                "source_id": case["source_id"],
                "status": detector.get("status"),
                "side": detector.get("server_side"),
                "confidence": float(detector.get("confidence") or 0.0),
            }
        )
    automatic = calls("detected_motion")
    oracle = calls("oracle_motion")
    return [
        {"name": "unanchored_pose", **_precision(unanchored, truth)},
        {
            "name": "bounce_geometry_only",
            **_precision(
                [
                    {
                        "source_id": case["source_id"],
                        "status": "withheld",
                        "side": None,
                        "confidence": 0.0,
                    }
                    for case in cases
                ],
                truth,
            ),
        },
        {"name": "oracle_bounce_plus_pose", **_precision(oracle, truth)},
        {"name": "detected_bounce_plus_pose", **_precision(automatic, truth)},
        {
            "name": "detected_bounce_pose_audio",
            **_precision(automatic, truth),
        },
    ]


def run_experiment(
    export_payload: Mapping[str, Any],
    output_dir: Path,
    production: Any,
    pose_model: Any,
    blurball_runner: Callable[[Mapping[str, Any]], Mapping[int, Sequence[float]]],
    *,
    stage_a_minimum_precision: float = 0.90,
) -> dict[str, Any]:
    """Run oracle-anchored inference, then conditionally automatic inference."""

    cohort = validate_export(export_payload)
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = output_dir / "cache"
    cache_dir.mkdir(exist_ok=True)
    truth: dict[str, str | None] = {}
    cases: list[dict[str, Any]] = []
    for assignment in cohort:
        source_id = str(assignment["source_id"])
        source = production.materialize_research_source(
            assignment,
            cache_dir,
        )
        expected_hash = str(source.get("media_sha256") or "")
        actual_hash = _sha256_materialized(source)
        if not expected_hash or actual_hash != expected_hash:
            raise RuntimeError(
                f"source media SHA changed for {source_id}"
            )
        empty_input = _detector_input(source, {})
        detections = blurball_runner(empty_input) or {}
        detector_input = _detector_input(source, detections)
        gold = assignment.get("gold") or {}
        truth[source_id] = gold.get("scored_server_side")
        followup = _followup(assignment)
        first = followup.get("first_bounce") or {}
        unanchored = dict(
            (assignment.get("proposal") or {}).get("detector") or {}
        )
        prior_wrong = (
            unanchored.get("server_side") in {"near", "far"}
            and unanchored.get("server_side") != truth[source_id]
        )
        occluded = (
            first.get("status") == "not_visible"
            or bool(
                (assignment.get("human_label") or {}).get(
                    "no_observable_serve"
                )
            )
        )
        stratum = (
            "prior_wrong_server"
            if prior_wrong
            else "occluded"
            if occluded
            else "visible"
        )
        if first.get("status") == "exact" and first.get("time_s") is not None:
            oracle_motion = pose_model.analyze(
                detector_input,
                float(first["time_s"]),
            )
        else:
            oracle_motion = {
                "status": "unavailable",
                "side": None,
                "confidence": 0.0,
                "reason": "first_bounce_not_visible",
            }
        cases.append(
            {
                "source_id": source_id,
                "source_match_id": str(assignment["source_match_id"]),
                "source_point_id": str(assignment["source_point_id"]),
                "source_point_idx": int(assignment["source_point_idx"]),
                "stratum": stratum,
                "detector_input": detector_input,
                "evaluation": {
                    "scored_server_side": truth[source_id],
                    "first_bounce": dict(first),
                    "second_bounce": dict(
                        followup.get("second_bounce") or {}
                    ),
                    "serve_contact_s": (
                        assignment.get("human_label") or {}
                    ).get("actual_serve_contact_s"),
                    "no_observable_serve": (
                        assignment.get("human_label") or {}
                    ).get("no_observable_serve"),
                },
                "unanchored_pose": unanchored,
                "oracle_motion": oracle_motion,
                "detected_motion": {
                    "status": "not_run",
                    "side": None,
                    "confidence": 0.0,
                },
            }
        )
    oracle_calls = [
        _motion_call(str(case["source_id"]), case["oracle_motion"])
        for case in cases
    ]
    stage_a = _precision(oracle_calls, truth)
    if stage_a["precision"] < stage_a_minimum_precision:
        stage_b = {
            "status": "skipped_gate",
            "minimum_precision": stage_a_minimum_precision,
            "reason": "oracle_initiating_player_precision_below_gate",
        }
    else:
        for case in cases:
            case["detected_motion"] = _automatic_motion(
                case["detector_input"],
                pose_model,
            )
        automatic_calls = [
            _motion_call(str(case["source_id"]), case["detected_motion"])
            for case in cases
        ]
        stage_b = {
            "status": "completed",
            "minimum_precision": stage_a_minimum_precision,
            **_precision(automatic_calls, truth),
        }

    source_match_ids = sorted(
        {str(item["source_match_id"]) for item in cohort}
    )
    holdout_match_ids = []
    if stage_b["status"] == "completed":
        if hasattr(production, "eligible_holdout_matches"):
            holdout_match_ids = list(
                production.eligible_holdout_matches(
                    source_match_ids,
                    10,
                )
            )
            if len(holdout_match_ids) != 10:
                raise RuntimeError(
                    "exactly ten eligible held-out matches are required"
                )
        else:
            holdout_match_ids = source_match_ids
    first_points = (
        production.first_retained_points(holdout_match_ids, 5)
        if holdout_match_ids
        else []
    )
    calls_by_match: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in first_points:
        media_hash = _sha256_materialized(item)
        if media_hash != str(item.get("media_sha256") or ""):
            raise RuntimeError(
                f"early-point media SHA changed for {item.get('source_id')}"
            )
        base_input = _detector_input(item, {})
        early_detections = blurball_runner(base_input) or {}
        early_input = _detector_input(item, early_detections)
        motion = _automatic_motion(early_input, pose_model)
        match_id = str(item["source_match_id"])
        calls_by_match[match_id].append(
            {
                "idx": int(item["source_point_idx"]),
                "position": int(item["position"]),
                "side": motion.get("side"),
                "status": motion.get("status", "withheld"),
                "confidence": float(motion.get("confidence") or 0.0),
                "compute": dict(motion.get("compute") or {}),
                "media_sha256": str(item.get("media_sha256") or ""),
                "source_point_id": str(item.get("source_point_id") or ""),
            }
        )
    decoders = {
        match_id: decode_first_server(
            sorted(items, key=lambda item: item["position"])
        )
        for match_id, items in sorted(calls_by_match.items())
    }
    first_server_truth = (
        production.first_server_truth(holdout_match_ids)
        if hasattr(production, "first_server_truth")
        else {}
    )
    point_metrics = _held_out_point_metrics(
        calls_by_match,
        first_server_truth,
    )
    result = {
        "schema_version": 1,
        "batch_slug": BATCH_SLUG,
        "model": {
            "family": "RTMPose",
            "sha256": str(getattr(pose_model, "model_sha256", "")),
        },
        "cohorts": {
            "anchor_rich": len(cohort),
            "oracle_first_bounce_exact": sum(
                (case["evaluation"]["first_bounce"] or {}).get("status")
                == "exact"
                for case in cases
            ),
            "held_out_matches": len(holdout_match_ids),
            "first_retained_points": len(first_points),
        },
        "stage_a": stage_a,
        "stage_b": stage_b,
        "stage_c": {
            "status": "completed" if first_points else "not_run",
            "decoders": decoders,
            "truth": dict(first_server_truth),
            "point_calls": dict(calls_by_match),
            "point_metrics": point_metrics,
            "cohort_match_ids": holdout_match_ids,
        },
        "onset_development": score_onset_labels(
            export_payload,
            cases,
        ),
        "ablations": _ablation_rows(cases, truth),
        "compute": _compute_totals(cases, calls_by_match),
        "cases": cases,
    }
    for case in result["cases"]:
        _assert_blinded(case["detector_input"])
    temporary = output_dir / ".results.json.tmp"
    temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    temporary.replace(output_dir / "results.json")
    return result


def _video_metadata(path: Path) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise RuntimeError(f"could not open experiment clip: {path}")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frames = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH)))
        height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    finally:
        capture.release()
    if fps <= 0 or frames <= 0 or width <= 0 or height <= 0:
        raise RuntimeError(f"invalid experiment clip metadata: {path}")
    return {
        "fps": fps,
        "frame_count": frames,
        "duration_s": frames / fps,
        "width": width,
        "height": height,
    }


def _scaled_corners(
    calibration: Mapping[str, Any],
    width: int,
    height: int,
) -> dict[str, list[float]]:
    corners = calibration.get("table_corners_px") or {}
    size = calibration.get("size") or [width, height]
    source_width = float(size[0])
    source_height = float(size[1])
    if source_width <= 0 or source_height <= 0:
        raise ValueError("invalid calibration source size")
    return {
        str(key): [
            float(value[0]) * width / source_width,
            float(value[1]) * height / source_height,
        ]
        for key, value in corners.items()
    }


def _safe_player_regions(
    corners: Mapping[str, Sequence[float]],
    width: int,
    height: int,
) -> dict[str, list[float]]:
    try:
        return build_player_regions(corners, width, height)
    except ValueError:
        named = {
            str(key).lower(): value for key, value in corners.items()
        }
        near = [value for key, value in named.items() if "near" in key]
        far = [value for key, value in named.items() if "far" in key]
        if len(near) != 2 or len(far) != 2:
            raise
        near_x = sum(float(item[0]) for item in near) / 2.0
        near_y = sum(float(item[1]) for item in near) / 2.0
        far_x = sum(float(item[0]) for item in far) / 2.0
        far_y = sum(float(item[1]) for item in far) / 2.0
        if abs(near_x - far_x) >= abs(near_y - far_y):
            left = [0.0, 0.0, round(width * 0.55, 3), float(height)]
            right = [
                round(width * 0.45, 3),
                0.0,
                float(width),
                float(height),
            ]
            return (
                {"near": left, "far": right}
                if near_x < far_x
                else {"near": right, "far": left}
            )
        top = [0.0, 0.0, float(width), round(height * 0.65, 3)]
        bottom = [
            0.0,
            round(height * 0.35, 3),
            float(width),
            float(height),
        ]
        return (
            {"near": bottom, "far": top}
            if near_y > far_y
            else {"near": top, "far": bottom}
        )


class RTMPoseWindowAnalyzer:
    """Adapter from one sanitized case to bounded RTMPose motion analysis."""

    def __init__(
        self,
        config_path: Path,
        checkpoint_path: Path,
        *,
        device: str = "mps",
    ):
        self._pose = create_pose_model(
            config_path,
            checkpoint_path,
            device=device,
        )
        self.model_sha256 = hashlib.sha256(
            checkpoint_path.read_bytes()
        ).hexdigest()

    def analyze(
        self,
        detector_input: Mapping[str, Any],
        first_bounce_t: float,
    ) -> dict[str, Any]:
        video_path = Path(str(detector_input["media_path"]))
        video = detector_input.get("video") or _video_metadata(video_path)
        width = int(video["width"])
        height = int(video["height"])
        fps = float(video["fps"])
        frames = int(video["frame_count"])
        corners = _scaled_corners(
            detector_input.get("calibration") or {},
            width,
            height,
        )
        regions = _safe_player_regions(corners, width, height)
        indices = window_frame_indices(
            first_bounce_t,
            fps,
            frames,
        )
        poses, compute = extract_pose_window(
            video_path,
            indices,
            regions,
            self._pose,
        )
        detections = {
            int(frame): tuple(position)
            for frame, position in (
                detector_input.get("detections") or {}
            ).items()
        }
        result = analyze_service_motion(
            detections=detections,
            poses=poses,
            fps=fps,
            first_bounce_t=first_bounce_t,
            audio_candidates=(
                detector_input.get("audio_candidates") or []
            ),
        )
        result["compute"] = compute
        return result


class CachedBlurBallRunner:
    """Run the existing BlurBall detector once per immutable media hash."""

    def __init__(
        self,
        cache_dir: Path,
        *,
        python_path: Path,
        script_path: Path,
    ):
        self.cache_dir = cache_dir
        self.python_path = python_path
        self.script_path = script_path

    def __call__(
        self,
        detector_input: Mapping[str, Any],
    ) -> dict[int, tuple[float, float]]:
        media = Path(str(detector_input["media_path"]))
        source_id = str(detector_input["source_id"])
        output = self.cache_dir / f"{source_id}-blurball.jsonl"
        if not output.exists():
            completed = subprocess.run(
                [
                    str(self.python_path),
                    str(self.script_path),
                    "--video",
                    str(media),
                    "--out",
                    str(output),
                    "--step",
                    str(DETECTOR_CONFIG["step"]),
                    "--threshold",
                    str(DETECTOR_CONFIG["threshold"]),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode != 0 or not output.exists():
                detail = (completed.stderr or completed.stdout).strip()
                raise RuntimeError(
                    f"BlurBall failed for {source_id}: {detail}"
                )
        detections = {}
        for line in output.read_text().splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            if item.get("x") is None or item.get("y") is None:
                continue
            detections[int(item.get("f", item.get("frame")))] = (
                float(item["x"]),
                float(item["y"]),
            )
        return detections


class ResearchProduction:
    """Read-only Supabase/R2 adapter for the frozen research cohort."""

    def __init__(self, production: Any, cache_dir: Path):
        self.production = production
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._calibrations: dict[str, dict[str, Any]] = {}

    def _download(
        self,
        *,
        bucket: str,
        key: str,
        destination: Path,
        force: bool = False,
    ) -> None:
        if force or not destination.exists():
            self.production.r2.download_file(
                bucket,
                key,
                str(destination),
            )

    def _calibration(
        self,
        match_id: str,
        match_json_path: str,
    ) -> dict[str, Any]:
        if match_id in self._calibrations:
            return self._calibrations[match_id]
        bucket, key = parse_r2_uri(match_json_path)
        path = self.cache_dir / f"match-{match_id}.json"
        self._download(bucket=bucket, key=key, destination=path)
        payload = json.loads(path.read_text())
        calibration = payload.get("calibration") or {}
        if (
            not calibration.get("ok")
            or not calibration.get("table_corners_px")
        ):
            raise RuntimeError(f"match {match_id} lacks table calibration")
        self._calibrations[match_id] = dict(calibration)
        return self._calibrations[match_id]

    def _audio(self, source_id: str, clip: Path) -> list[dict[str, Any]]:
        path = self.cache_dir / f"{source_id}-audio.json"
        if not path.exists():
            from worker.research_audio_candidates import analyze

            path.write_text(
                json.dumps(analyze(clip), indent=2) + "\n"
            )
        return list((json.loads(path.read_text()).get("candidates") or []))

    def _match(self, match_id: str) -> dict[str, Any]:
        rows = self.production.rest_get(
            "matches",
            select=(
                "id,job_id,match_json_path,first_server,"
                "first_server_source,user_side"
            ),
            id=f"eq.{match_id}",
        )
        if len(rows) != 1:
            raise RuntimeError(f"match unavailable: {match_id}")
        return dict(rows[0])

    def first_server_truth(
        self,
        match_ids: Sequence[str],
    ) -> dict[str, str]:
        truth = {}
        for match_id in match_ids:
            match = self._match(match_id)
            first_server = str(match.get("first_server") or "")
            source = str(match.get("first_server_source") or "")
            user_side = str(match.get("user_side") or "")
            if (
                first_server not in {"user", "opponent"}
                or source != "user"
                or user_side not in {"near", "far"}
            ):
                continue
            truth[str(match_id)] = (
                user_side
                if first_server == "user"
                else ("far" if user_side == "near" else "near")
            )
        return truth

    def eligible_holdout_matches(
        self,
        excluded_match_ids: Sequence[str],
        limit: int,
    ) -> list[str]:
        excluded = {str(item) for item in excluded_match_ids}
        rows = self.production.rest_get(
            "matches",
            select=(
                "id,played_at,match_json_path,first_server,"
                "first_server_source,user_side"
            ),
            first_server_source="eq.user",
            order="played_at.desc,id.asc",
            limit="5000",
        )
        candidates = [
            dict(row)
            for row in rows
            if str(row.get("id") or "") not in excluded
            and row.get("match_json_path")
            and row.get("first_server") in {"user", "opponent"}
            and row.get("user_side") in {"near", "far"}
        ]
        candidates.sort(key=lambda row: str(row.get("id") or ""))
        candidates.sort(
            key=lambda row: str(row.get("played_at") or ""),
            reverse=True,
        )
        selected = []
        for match in candidates:
            match_id = str(match["id"])
            points = self.production.rest_get(
                "points",
                select="id",
                match_id=f"eq.{match_id}",
                deleted="eq.false",
                confirmed_winner="not.is.null",
                is_let="eq.false",
                server_override="is.null",
                clip_path="not.is.null",
                order="idx.asc",
                limit="5",
            )
            if len(points) < 5:
                continue
            try:
                self._calibration(
                    match_id,
                    str(match["match_json_path"]),
                )
            except (RuntimeError, ValueError, OSError, json.JSONDecodeError):
                continue
            selected.append(match_id)
            if len(selected) == limit:
                break
        return selected

    def materialize_research_source(
        self,
        assignment: Mapping[str, Any],
        cache_dir: Path,
    ) -> dict[str, Any]:
        del cache_dir
        source_id = str(assignment["source_id"])
        sources = self.production.rest_get(
            "research_sources",
            select=(
                "id,source_match_id,source_point_id,source_point_idx,"
                "media_key,media_sha256,prefill"
            ),
            id=f"eq.{source_id}",
        )
        if len(sources) != 1:
            raise RuntimeError(f"research source unavailable: {source_id}")
        source = dict(sources[0])
        points = self.production.rest_get(
            "points",
            select="id,t0,t1,tight_start,placement",
            id=f"eq.{source['source_point_id']}",
        )
        if len(points) != 1:
            raise RuntimeError(f"source point unavailable: {source_id}")
        match_id = str(source["source_match_id"])
        match = self._match(match_id)
        clip = self.cache_dir / f"{source_id}.mp4"
        self._download(
            bucket=MEDIA_BUCKET,
            key=str(source["media_key"]),
            destination=clip,
        )
        video = _video_metadata(clip)
        point = dict(points[0])
        pre_roll = 1.0
        jobs = (
            self.production.rest_get(
                "jobs",
                select="id,options",
                id=f"eq.{match['job_id']}",
            )
            if match.get("job_id")
            else []
        )
        if jobs:
            pre_roll = _pre_roll_for_match(
                match,
                {str(jobs[0]["id"]): dict(jobs[0].get("options") or {})},
            )
        clip_start = max(
            0.0,
            float(point.get("t0") or 0.0)
            - (min(pre_roll, 0.3) if point.get("tight_start") else pre_roll),
        )
        placement = _align_hypothesis_times(
            align_placement_to_clip(
                point.get("placement") or {},
                clip_start_s=clip_start,
                duration_s=float(video["duration_s"]),
            )
        )
        return {
            "source_id": source_id,
            "source_match_id": match_id,
            "source_point_id": str(source["source_point_id"]),
            "source_point_idx": int(source["source_point_idx"]),
            "match_key": (
                (source.get("prefill") or {}).get("match_key")
                or match_id
            ),
            "media_path": clip,
            "media_sha256": str(source["media_sha256"]),
            "video": video,
            "placement": placement,
            "calibration": self._calibration(
                match_id,
                str(match["match_json_path"]),
            ),
            "audio_candidates": self._audio(source_id, clip),
        }

    def first_retained_points(
        self,
        match_ids: Sequence[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        output = []
        manifest_path = self.cache_dir.parent / "holdout-manifest.json"
        refresh_media = not manifest_path.exists()
        manifest_entries = []
        for match_id in match_ids:
            match = self._match(match_id)
            rows = self.production.rest_get(
                "points",
                select=(
                    "id,match_id,idx,t0,t1,tight_start,clip_path,placement"
                ),
                match_id=f"eq.{match_id}",
                deleted="eq.false",
                confirmed_winner="not.is.null",
                is_let="eq.false",
                server_override="is.null",
                clip_path="not.is.null",
                order="idx.asc",
                limit=str(limit),
            )
            if len(rows) != limit:
                raise RuntimeError(
                    f"match {match_id} lacks five scored opening clips"
                )
            jobs = (
                self.production.rest_get(
                    "jobs",
                    select="id,options",
                    id=f"eq.{match['job_id']}",
                )
                if match.get("job_id")
                else []
            )
            pre_roll = _pre_roll_for_match(
                match,
                {
                    str(item["id"]): dict(item.get("options") or {})
                    for item in jobs
                },
            )
            for position, point in enumerate(rows):
                source_id = f"early-{point['id']}"
                bucket, key = parse_r2_uri(str(point["clip_path"]))
                clip = self.cache_dir / f"{source_id}.mp4"
                self._download(
                    bucket=bucket,
                    key=key,
                    destination=clip,
                    force=refresh_media,
                )
                video = _video_metadata(clip)
                media_sha = _sha256_materialized({"media_path": clip})
                manifest_entries.append(
                    {
                        "source_match_id": str(match_id),
                        "source_point_id": str(point["id"]),
                        "source_point_idx": int(point["idx"]),
                        "clip_path": str(point["clip_path"]),
                        "media_sha256": media_sha,
                    }
                )
                clip_start = max(
                    0.0,
                    float(point.get("t0") or 0.0)
                    - (
                        min(pre_roll, 0.3)
                        if point.get("tight_start")
                        else pre_roll
                    ),
                )
                output.append(
                    {
                        "source_id": source_id,
                        "source_match_id": match_id,
                        "source_point_id": str(point["id"]),
                        "source_point_idx": int(point["idx"]),
                        "position": position,
                        "media_path": clip,
                        "media_sha256": media_sha,
                        "video": video,
                        "placement": _align_hypothesis_times(
                            align_placement_to_clip(
                                point.get("placement") or {},
                                clip_start_s=clip_start,
                                duration_s=float(video["duration_s"]),
                            )
                        ),
                        "calibration": self._calibration(
                            match_id,
                            str(match["match_json_path"]),
                        ),
                        "audio_candidates": self._audio(source_id, clip),
                    }
                )
        _validate_or_write_stage_c_manifest(
            manifest_path,
            manifest_entries,
        )
        return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--runtime-root",
        type=Path,
        default=Path(
            "/Users/adil/Library/Caches/PongLens/service-motion-rtmpose"
        ),
    )
    parser.add_argument(
        "--blurball-python",
        type=Path,
        default=Path(
            os.environ.get(
                "PONGLENS_BLURBALL_PYTHON",
                "/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python",
            )
        ),
    )
    parser.add_argument(
        "--blurball-script",
        type=Path,
        default=Path(
            os.environ.get(
                "PONGLENS_BLURBALL_SCRIPT",
                "/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py",
            )
        ),
    )
    args = parser.parse_args()
    from worker.build_research_pilot import Production

    cache = args.output / "cache"
    production = ResearchProduction(Production(), cache)
    config = (
        args.runtime_root
        / "source/mmpose-1.3.2/configs/body_2d_keypoint/rtmpose/coco/"
        "rtmpose-m_8xb256-420e_coco-256x192.py"
    )
    pose = RTMPoseWindowAnalyzer(
        config,
        args.runtime_root / "model.pth",
    )
    blurball = CachedBlurBallRunner(
        cache,
        python_path=args.blurball_python,
        script_path=args.blurball_script,
    )
    run_experiment(
        json.loads(args.export.read_text()),
        args.output,
        production,
        pose,
        blurball,
    )
    print(args.output / "results.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
