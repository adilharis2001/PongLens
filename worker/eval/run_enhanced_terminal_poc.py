"""Run the local enhanced terminal-analysis experiment and freeze holdout calls."""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any, Mapping, Sequence

from worker.eval.enhanced_terminal_analysis import (
    DEVELOPMENT_INDEXES,
    HOLDOUT_INDEXES,
    build_event_timeline,
    load_development_truth,
    rank_terminal_hypotheses,
    select_disjoint_holdout,
)
from worker.eval.winner_constrained_analysis import build_point_contexts
from worker.research_audio_candidates import analyze as analyze_audio


DETECTOR_CONFIG = {
    "name": "blurball",
    "step": 3,
    "threshold": 0.5,
}


def _canonical_json(value: Any, *, pretty: bool = False) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")


def cache_key(clip: Path, detector_config: Mapping[str, Any]) -> str:
    digest = hashlib.sha256()
    digest.update(clip.read_bytes())
    digest.update(b"\0")
    digest.update(_canonical_json(detector_config))
    return digest.hexdigest()


def validate_output_destination(path: Path) -> None:
    if path.exists() or path.is_symlink():
        raise FileExistsError(f"output destination already exists: {path}")
    if not path.parent.exists() or not path.parent.is_dir():
        raise FileNotFoundError(f"output parent does not exist: {path.parent}")


def freeze_holdout_predictions(
    predictions: Sequence[Mapping[str, Any]],
    destination: Path,
) -> str:
    destination.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "policy": (
            "Predictions frozen before holdout clip inspection; confirmed "
            "winner and server are permitted inference inputs."
        ),
        "points": [deepcopy(dict(item)) for item in predictions],
    }
    data = _canonical_json(payload, pretty=True)
    prediction_path = destination / "holdout-predictions.json"
    prediction_path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    (destination / "holdout-predictions.sha256").write_text(digest + "\n")
    return digest


def _safe_divide(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else float("nan")


def score_development(
    predictions: Sequence[Mapping[str, Any]],
    truth: Mapping[int, Mapping[str, Any]],
) -> dict[str, Any]:
    by_index = {int(item["idx"]): item for item in predictions}
    if set(by_index) != set(truth):
        raise ValueError("development predictions and truth indexes differ")
    specific = {
        "net_error",
        "net_cord_out",
        "long_error",
        "clean_winner",
        "complete_miss",
    }
    covered = [
        idx for idx, item in by_index.items()
        if item.get("prediction") in specific
    ]
    correct = sum(
        by_index[idx].get("prediction") == truth[idx].get("ending_family")
        for idx in covered
    )
    labels = sorted(specific)
    per_class: dict[str, dict[str, float]] = {}
    f1_values = []
    for label in labels:
        true_positive = sum(
            by_index[idx].get("prediction") == label
            and truth[idx].get("ending_family") == label
            for idx in truth
        )
        false_positive = sum(
            by_index[idx].get("prediction") == label
            and truth[idx].get("ending_family") != label
            for idx in truth
        )
        false_negative = sum(
            by_index[idx].get("prediction") != label
            and truth[idx].get("ending_family") == label
            for idx in truth
        )
        precision = _safe_divide(true_positive, true_positive + false_positive)
        recall = _safe_divide(true_positive, true_positive + false_negative)
        f1 = (
            2 * precision * recall / (precision + recall)
            if math.isfinite(precision)
            and math.isfinite(recall)
            and precision + recall
            else float("nan")
        )
        if math.isfinite(f1):
            f1_values.append(f1)
        per_class[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": sum(
                truth[idx].get("ending_family") == label for idx in truth
            ),
        }

    net_truth = {
        idx for idx, item in truth.items()
        if item.get("ending_family") in {"net_error", "net_cord_out"}
    }
    net_predicted = {
        idx for idx, item in by_index.items()
        if item.get("prediction") in {"net_error", "net_cord_out"}
    }
    contact_errors = [
        abs(
            int(by_index[idx].get("contact_count") or 0)
            - int(truth[idx]["contact_count"])
        )
        for idx in truth
    ]
    return {
        "point_count": len(truth),
        "covered_count": len(covered),
        "coverage": _safe_divide(len(covered), len(truth)),
        "covered_accuracy": _safe_divide(correct, len(covered)),
        "overall_exact_accuracy": _safe_divide(correct, len(truth)),
        "macro_f1": (
            sum(f1_values) / len(f1_values)
            if f1_values
            else float("nan")
        ),
        "per_class": per_class,
        "net_precision": _safe_divide(
            len(net_truth & net_predicted), len(net_predicted)
        ),
        "net_recall": _safe_divide(
            len(net_truth & net_predicted), len(net_truth)
        ),
        "contact_exact_accuracy": _safe_divide(
            sum(error == 0 for error in contact_errors), len(contact_errors)
        ),
        "contact_mae": _safe_divide(sum(contact_errors), len(contact_errors)),
    }


def _load_json(path: Path) -> Mapping[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, Mapping):
        raise ValueError(f"expected JSON object: {path}")
    return value


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _probe_fps(path: Path) -> float:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    numerator, denominator = completed.stdout.strip().split("/")
    return float(numerator) / float(denominator)


def _load_blurball(path: Path) -> dict[int, tuple[float, float]]:
    detections: dict[int, tuple[float, float]] = {}
    with path.open() as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("x") is None or record.get("y") is None:
                continue
            detections[int(record["f"])] = (
                float(record["x"]),
                float(record["y"]),
            )
    return detections


def _run_blurball(
    clip: Path,
    output: Path,
    python_path: Path,
    script_path: Path,
) -> None:
    completed = subprocess.run(
        [
            str(python_path),
            str(script_path),
            "--video",
            str(clip),
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
        raise RuntimeError(f"BlurBall failed for {clip}: {detail}")


def _match_id(value: Mapping[str, Any]) -> str | None:
    match = value.get("match") if isinstance(value.get("match"), Mapping) else value
    identifier = match.get("id") if isinstance(match, Mapping) else None
    return str(identifier) if identifier else None


def _normalise_winner(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("value")
    return value if value in {"user", "opponent"} else None


def _join_contexts(
    analysis: Mapping[str, Any],
    production: Mapping[str, Any],
) -> dict[int, dict[str, Any]]:
    if _match_id(analysis) != _match_id(production):
        raise ValueError("analysis and production match IDs differ")
    production_points = production.get("points")
    match = production.get("match")
    if not isinstance(production_points, list) or not isinstance(match, Mapping):
        raise ValueError("production context requires match and points")
    by_index = {
        int(point["idx"]): point
        for point in production_points
        if isinstance(point, Mapping)
    }
    contexts = {
        int(context["idx"]): dict(context)
        for context in build_point_contexts(production_points, match)
    }
    result = {}
    for point in analysis.get("points") or []:
        idx = int(point["idx"])
        production_point = by_index.get(idx)
        context = contexts.get(idx)
        if production_point is None or context is None:
            raise ValueError(f"point {idx} lacks production score context")
        winner = _normalise_winner(production_point.get("confirmed_winner"))
        if winner is None:
            raise ValueError(f"point {idx} lacks confirmed winner")
        context["confirmed_winner"] = winner
        result[idx] = context
    return result


def _analyse_one(
    point: Mapping[str, Any],
    clip: Path,
    detection_path: Path,
    context: Mapping[str, Any],
    calibration: Mapping[str, Any],
) -> dict[str, Any]:
    audio = analyze_audio(clip)
    context_with_media = {
        **dict(context),
        "fps": _probe_fps(clip),
        "calibration": deepcopy(dict(calibration)),
    }
    timeline = build_event_timeline(
        point,
        _load_blurball(detection_path),
        audio["candidates"],
        context_with_media,
    )
    ranked = rank_terminal_hypotheses(timeline, context_with_media)
    selected_features = ranked.get("terminal_features") or {}
    return {
        "idx": int(point["idx"]),
        "clip": f"clips/point-{int(point['idx']):03d}.mp4",
        "server": context.get("server"),
        "server_side": context.get("server_side"),
        "confirmed_winner": context.get("confirmed_winner"),
        "prediction": ranked["prediction"],
        "contact_count": ranked["contact_count"],
        "observed_contact_count": ranked.get(
            "observed_contact_count",
            timeline["observed_contact_count"],
        ),
        "inferred_contact_count": ranked.get(
            "inferred_contact_count",
            timeline["inferred_contact_count"],
        ),
        "confidence_margin": ranked["confidence_margin"],
        "final_hitter": ranked["final_hitter"],
        "terminal_stroke_side": selected_features.get(
            "terminal_stroke_side", "unknown"
        ),
        "top_candidate": ranked["top_candidate"],
        "runner_up": ranked["runner_up"],
        "candidates": ranked["candidates"],
        "events": timeline["events"],
        "terminal_features": selected_features,
        "diagnostics": {
            "audio_candidate_count": len(audio["candidates"]),
            "blurball_detection_count": len(_load_blurball(detection_path)),
            "legacy_ending": (point.get("raw_suggestion") or {}).get("ending"),
        },
    }


def run_experiment(
    *,
    analysis_path: Path,
    production_context_path: Path,
    review_fixture_path: Path,
    source_report_dir: Path,
    calibration_path: Path,
    blurball_python: Path,
    blurball_script: Path,
    output_dir: Path,
) -> Path:
    validate_output_destination(output_dir)
    inputs = [
        analysis_path,
        production_context_path,
        review_fixture_path,
        calibration_path,
        blurball_python,
        blurball_script,
    ]
    missing = [str(path) for path in inputs if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing required inputs: {missing}")

    analysis = _load_json(analysis_path)
    production = _load_json(production_context_path)
    calibration = _load_json(calibration_path)
    truth = load_development_truth(review_fixture_path)
    holdout = select_disjoint_holdout(analysis, DEVELOPMENT_INDEXES)
    if set(holdout) & DEVELOPMENT_INDEXES:
        raise ValueError("development and holdout points overlap")
    contexts = _join_contexts(analysis, production)
    points = {
        int(point["idx"]): point
        for point in analysis.get("points") or []
        if isinstance(point, Mapping)
    }

    staging = Path(tempfile.mkdtemp(
        prefix=f".{output_dir.name}.",
        dir=str(output_dir.parent),
    ))
    try:
        clips_dir = staging / "clips"
        evidence_dir = staging / "evidence"
        clips_dir.mkdir()
        evidence_dir.mkdir()
        results = []
        for idx in sorted(DEVELOPMENT_INDEXES | HOLDOUT_INDEXES):
            source_clip = source_report_dir / "clips" / f"point-{idx:03d}.mp4"
            if not source_clip.exists():
                raise FileNotFoundError(f"missing point clip: {source_clip}")
            clip = clips_dir / source_clip.name
            shutil.copy2(source_clip, clip)
            key = cache_key(clip, DETECTOR_CONFIG)
            detection_path = evidence_dir / f"point-{idx:03d}-{key[:12]}.jsonl"
            _run_blurball(
                clip,
                detection_path,
                blurball_python,
                blurball_script,
            )
            results.append(_analyse_one(
                points[idx],
                clip,
                detection_path,
                contexts[idx],
                calibration,
            ))

        development = [
            item for item in results if item["idx"] in DEVELOPMENT_INDEXES
        ]
        holdout_predictions = [
            item for item in results if item["idx"] in HOLDOUT_INDEXES
        ]
        metrics = score_development(development, truth)
        holdout_digest = freeze_holdout_predictions(
            holdout_predictions,
            staging,
        )
        payload = {
            "version": 1,
            "experiment": "enhanced_winner_constrained_terminal_poc",
            "match_id": _match_id(analysis),
            "development_indexes": sorted(DEVELOPMENT_INDEXES),
            "holdout_indexes": holdout,
            "detector_config": DETECTOR_CONFIG,
            "source_hashes": {
                "analysis": _file_sha256(analysis_path),
                "production_context": _file_sha256(production_context_path),
                "review_fixture": _file_sha256(review_fixture_path),
                "calibration": _file_sha256(calibration_path),
            },
            "development_metrics": metrics,
            "development_points": development,
            "holdout_prediction_sha256": holdout_digest,
            "holdout_points": holdout_predictions,
            "production_changed": False,
        }
        (staging / "enhanced-terminal-poc.json").write_bytes(
            _canonical_json(payload, pretty=True)
        )
        os.replace(staging, output_dir)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return output_dir


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--analysis", required=True, type=Path)
    parser.add_argument("--production-context", required=True, type=Path)
    parser.add_argument("--review-fixture", required=True, type=Path)
    parser.add_argument("--source-report-dir", required=True, type=Path)
    parser.add_argument("--calibration", required=True, type=Path)
    parser.add_argument("--blurball-python", required=True, type=Path)
    parser.add_argument("--blurball-script", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    print(run_experiment(
        analysis_path=args.analysis,
        production_context_path=args.production_context,
        review_fixture_path=args.review_fixture,
        source_report_dir=args.source_report_dir,
        calibration_path=args.calibration,
        blurball_python=args.blurball_python,
        blurball_script=args.blurball_script,
        output_dir=args.output_dir,
    ))


if __name__ == "__main__":
    main()
