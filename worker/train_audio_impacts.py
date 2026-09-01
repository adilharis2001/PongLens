#!/usr/bin/env python3
"""Train and evaluate PongLens audio-impact models without production writes.

Round A/B human labels are development data. Round C is accepted only by the
sealed scoring command and is never used for fitting, threshold selection, or
feature selection. The required baseline uses NumPy/SciPy; PyTorch is optional.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from hashlib import sha256
from importlib import import_module
import json
import math
from pathlib import Path
import re
import subprocess
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
from scipy.signal import resample_poly


SAMPLE_RATE = 48_000
WINDOW_SECONDS = 0.2
WINDOW_SAMPLES = 9_600
AUDIO_IMPACT_CLASSES = (
    "paddle",
    "table",
    "floor",
    "shoe",
    "net",
    "background",
    "other",
    "no_impact",
)
EXCLUDED_CLASSES = {"unsure"}
DEVELOPMENT_ROUNDS = {"A", "B"}
SEALED_ROUND = "C"
MIN_DEVELOPMENT_EXAMPLES = 30
MIN_SEALED_EXAMPLES = 15
MEDIA_BUCKET = "ponglens-media"
MEDIA_PREFIX = "research/audio-impacts/v1/sources"


@dataclass(frozen=True)
class AudioWindow:
    samples: np.ndarray
    sample_rate: int
    left_padding: int
    right_padding: int


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_hash(value: Any) -> str:
    return sha256(canonical_json(value)).hexdigest()


def fixed_audio_window(
    samples: np.ndarray,
    *,
    event_time_s: float,
    source_rate: int,
) -> AudioWindow:
    """Return a centered 200 ms mono window with explicit target-rate padding."""
    if source_rate <= 0:
        raise ValueError("source_rate must be positive")
    mono = np.asarray(samples, dtype=np.float32)
    if mono.ndim == 2:
        mono = mono.mean(axis=1, dtype=np.float32)
    if mono.ndim != 1:
        raise ValueError("audio samples must be mono or frames-by-channels")

    if source_rate != SAMPLE_RATE:
        divisor = math.gcd(source_rate, SAMPLE_RATE)
        mono = resample_poly(
            mono,
            SAMPLE_RATE // divisor,
            source_rate // divisor,
        ).astype(np.float32, copy=False)

    center = int(round(float(event_time_s) * SAMPLE_RATE))
    start = center - WINDOW_SAMPLES // 2
    end = start + WINDOW_SAMPLES
    left_padding = min(WINDOW_SAMPLES, max(0, -start))
    right_padding = min(WINDOW_SAMPLES, max(0, end - len(mono)))
    source_start = max(0, start)
    source_end = min(len(mono), end)
    window = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
    destination_start = left_padding
    available = max(0, source_end - source_start)
    window[destination_start : destination_start + available] = mono[
        source_start:source_end
    ]
    return AudioWindow(
        samples=window,
        sample_rate=SAMPLE_RATE,
        left_padding=left_padding,
        right_padding=right_padding,
    )


def _round_for(row: Mapping[str, Any]) -> str:
    return str(row.get("round") or (row.get("prefill") or {}).get("round") or "")


def _kind_for(row: Mapping[str, Any]) -> str | None:
    value = row.get("kind")
    return str(value) if value is not None else None


def prepare_gold_examples(
    rows: Iterable[Mapping[str, Any]],
    *,
    partition: str,
) -> list[dict[str, Any]]:
    """Filter normalized human events into development or sealed partitions."""
    if partition not in {"development", "sealed"}:
        raise ValueError("partition must be development or sealed")
    allowed_rounds = DEVELOPMENT_ROUNDS if partition == "development" else {SEALED_ROUND}
    examples = []
    for raw in rows:
        row = dict(raw)
        kind = _kind_for(row)
        if kind in EXCLUDED_CLASSES or kind is None:
            continue
        if kind not in AUDIO_IMPACT_CLASSES:
            raise ValueError(f"unknown audio-impact class {kind!r}")
        if _round_for(row) not in allowed_rounds:
            continue
        if row.get("human_gold") is False:
            continue
        examples.append(row)
    return examples


def normalize_research_export(
    payload: Mapping[str, Any],
    *,
    media_dir: Path,
) -> list[dict[str, Any]]:
    """Flatten the admin research export into one row per human-labeled event."""
    batch = payload.get("batch") or {}
    if batch.get("slug") != "audio-impact-labeling-recent-v1":
        raise ValueError("export is not the audio-impact-labeling-recent-v1 batch")
    rows: list[dict[str, Any]] = []
    for assignment in payload.get("assignments") or []:
        label = assignment.get("human_label") or {}
        prefill = assignment.get("prefill") or {}
        if assignment.get("status") != "submitted" or not label.get("sequence_complete"):
            continue
        source_id = str(assignment.get("source_id") or "")
        if not source_id:
            raise ValueError("assignment is missing source_id")
        for human_event in label.get("events") or []:
            rows.append(
                {
                    "event_id": str(human_event.get("id") or ""),
                    "kind": human_event.get("kind"),
                    "time_s": float(human_event.get("time_s")),
                    "source_id": source_id,
                    "source_recording_id": str(
                        prefill.get("source_recording_id")
                        or assignment.get("source_match_id")
                        or ""
                    ),
                    "venue": str(prefill.get("venue_category") or "unknown"),
                    "round": str(prefill.get("round") or ""),
                    "media_path": str(media_dir / f"{source_id}.mp4"),
                    "human_gold": True,
                    "point_id": prefill.get("point_id") or assignment.get("source_point_id"),
                }
            )
    return rows


def fetch_frozen_media(
    payload: Mapping[str, Any],
    output_dir: Path,
    *,
    production: Any,
    exists: Callable[[Path], bool] = Path.exists,
) -> int:
    """Download immutable research clips by deterministic source ID."""
    batch = payload.get("batch") or {}
    if batch.get("slug") != "audio-impact-labeling-recent-v1":
        raise ValueError("export is not the audio-impact-labeling-recent-v1 batch")
    source_ids = sorted(
        {
            str(assignment.get("source_id") or "")
            for assignment in payload.get("assignments") or []
        }
    )
    if any(not re.fullmatch(r"[A-Za-z0-9-]+", source_id) for source_id in source_ids):
        raise ValueError("export contains an invalid source_id")
    output_dir.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for source_id in source_ids:
        destination = output_dir / f"{source_id}.mp4"
        if exists(destination):
            continue
        production.r2.download_file(
            MEDIA_BUCKET,
            f"{MEDIA_PREFIX}/{source_id}.mp4",
            str(destination),
        )
        fetched += 1
    return fetched


def build_grouped_folds(
    rows: Sequence[Mapping[str, Any]],
    *,
    fold_count: int = 3,
) -> list[dict[str, list[int]]]:
    if fold_count < 2:
        raise ValueError("fold_count must be at least two")
    group_indices: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        group = str(row.get("source_recording_id") or "")
        if not group:
            raise ValueError("every example needs source_recording_id")
        group_indices.setdefault(group, []).append(index)
    if len(group_indices) < 2:
        raise ValueError("grouped validation needs at least two source recordings")
    actual_folds = min(fold_count, len(group_indices))
    buckets: list[list[str]] = [[] for _ in range(actual_folds)]
    sizes = [0] * actual_folds
    ordered = sorted(group_indices, key=lambda key: (-len(group_indices[key]), key))
    for group in ordered:
        target = min(range(actual_folds), key=lambda index: (sizes[index], index))
        buckets[target].append(group)
        sizes[target] += len(group_indices[group])

    all_indices = set(range(len(rows)))
    folds = []
    for groups in buckets:
        validation = sorted(
            index for group in groups for index in group_indices[group]
        )
        folds.append(
            {
                "train_indices": sorted(all_indices.difference(validation)),
                "validation_indices": validation,
            }
        )
    return folds


def _class_metrics(
    truth: Sequence[str],
    predictions: Sequence[str | None],
    *,
    partition: str,
) -> dict[str, dict[str, Any]]:
    minimum = (
        MIN_DEVELOPMENT_EXAMPLES
        if partition == "development"
        else MIN_SEALED_EXAMPLES
    )
    result = {}
    for kind in AUDIO_IMPACT_CLASSES:
        true_positive = sum(t == kind and p == kind for t, p in zip(truth, predictions))
        false_positive = sum(t != kind and p == kind for t, p in zip(truth, predictions))
        false_negative = sum(t == kind and p != kind for t, p in zip(truth, predictions))
        count = sum(t == kind for t in truth)
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
        recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        result[kind] = {
            "true_positive": true_positive,
            "false_positive": false_positive,
            "false_negative": false_negative,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            f"{partition}_count": count,
            "status": "sufficient" if count >= minimum else "data_insufficient",
        }
    return result


def _paddle_table_balanced_accuracy(
    truth: Sequence[str], predictions: Sequence[str | None]
) -> float | None:
    recalls = []
    for kind in ("paddle", "table"):
        indices = [index for index, value in enumerate(truth) if value == kind]
        if not indices:
            return None
        recalls.append(sum(predictions[index] == kind for index in indices) / len(indices))
    return sum(recalls) / 2


def _paddle_table_roc_auc(
    truth: Sequence[str], probabilities: np.ndarray | None
) -> float | None:
    if probabilities is None:
        return None
    paddle_index = AUDIO_IMPACT_CLASSES.index("paddle")
    positives = [
        float(probabilities[index, paddle_index])
        for index, kind in enumerate(truth)
        if kind == "paddle"
    ]
    negatives = [
        float(probabilities[index, paddle_index])
        for index, kind in enumerate(truth)
        if kind == "table"
    ]
    if not positives or not negatives:
        return None
    comparisons = [
        1.0 if positive > negative else 0.5 if positive == negative else 0.0
        for positive in positives
        for negative in negatives
    ]
    return sum(comparisons) / len(comparisons)


def evaluate_predictions(
    examples: Sequence[Mapping[str, Any]],
    predictions: Sequence[str | None],
    *,
    partition: str,
    probabilities: np.ndarray | None = None,
) -> dict[str, Any]:
    if partition not in {"development", "sealed"}:
        raise ValueError("partition must be development or sealed")
    if len(examples) != len(predictions):
        raise ValueError("examples and predictions must have the same length")
    if probabilities is not None and probabilities.shape != (
        len(examples),
        len(AUDIO_IMPACT_CLASSES),
    ):
        raise ValueError("probability matrix has the wrong shape")
    truth = [str(row["kind"]) for row in examples]
    accepted = sum(value is not None for value in predictions)
    classes = _class_metrics(truth, predictions, partition=partition)
    supported_f1 = [
        value["f1"] for value in classes.values() if value[f"{partition}_count"] > 0
    ]
    report: dict[str, Any] = {
        "partition": partition,
        "example_count": len(examples),
        "coverage": accepted / len(examples) if examples else 0.0,
        "accuracy": (
            sum(left == right for left, right in zip(truth, predictions)) / len(examples)
            if examples
            else 0.0
        ),
        "macro_f1": sum(supported_f1) / len(supported_f1) if supported_f1 else 0.0,
        "paddle_table_balanced_accuracy": _paddle_table_balanced_accuracy(truth, predictions),
        "paddle_table_roc_auc": _paddle_table_roc_auc(truth, probabilities),
        "classes": classes,
        "confusion_matrix": {
            actual: {
                predicted: sum(
                    left == actual and (right or "abstain") == predicted
                    for left, right in zip(truth, predictions)
                )
                for predicted in (*AUDIO_IMPACT_CLASSES, "abstain")
            }
            for actual in AUDIO_IMPACT_CLASSES
        },
        "venues": {},
        "recordings": {},
    }
    venues = sorted({str(row.get("venue") or "unknown") for row in examples})
    for venue in venues:
        indices = [
            index
            for index, row in enumerate(examples)
            if str(row.get("venue") or "unknown") == venue
        ]
        venue_truth = [truth[index] for index in indices]
        venue_predictions = [predictions[index] for index in indices]
        venue_classes = _class_metrics(
            venue_truth,
            venue_predictions,
            partition=partition,
        )
        report["venues"][venue] = {
            "example_count": len(indices),
            "coverage": (
                sum(value is not None for value in venue_predictions) / len(indices)
                if indices
                else 0.0
            ),
            "classes": venue_classes,
            "paddle_table_balanced_accuracy": _paddle_table_balanced_accuracy(
                venue_truth, venue_predictions
            ),
            "paddle_table_roc_auc": _paddle_table_roc_auc(
                venue_truth,
                probabilities[indices] if probabilities is not None else None,
            ),
        }
    recordings = sorted(
        {str(row.get("source_recording_id") or "unknown") for row in examples}
    )
    for recording in recordings:
        indices = [
            index
            for index, row in enumerate(examples)
            if str(row.get("source_recording_id") or "unknown") == recording
        ]
        recording_truth = [truth[index] for index in indices]
        recording_predictions = [predictions[index] for index in indices]
        report["recordings"][recording] = {
            "example_count": len(indices),
            "coverage": sum(value is not None for value in recording_predictions)
            / len(indices),
            "accuracy": sum(
                left == right
                for left, right in zip(recording_truth, recording_predictions)
            )
            / len(indices),
            "classes": _class_metrics(
                recording_truth,
                recording_predictions,
                partition=partition,
            ),
        }
    return report


def extract_spectral_features(samples: np.ndarray) -> np.ndarray:
    """Deterministic short-time full-band features for the linear baseline."""
    signal = np.asarray(samples, dtype=np.float64)
    if signal.shape != (WINDOW_SAMPLES,):
        raise ValueError(f"expected {WINDOW_SAMPLES} samples")
    frame_length = 1_200  # 25 ms
    hop = 480  # 10 ms
    starts = range(0, WINDOW_SAMPLES - frame_length + 1, hop)
    frames = np.stack([signal[start : start + frame_length] for start in starts])
    windowed = frames * np.hanning(frame_length)
    magnitude = np.abs(np.fft.rfft(windowed, axis=1)) + 1e-10
    power = magnitude**2
    frequencies = np.fft.rfftfreq(frame_length, 1 / SAMPLE_RATE)

    edges = np.geomspace(60, SAMPLE_RATE / 2, 25)
    log_bands = []
    for lower, upper in zip(edges[:-1], edges[1:]):
        mask = (frequencies >= lower) & (frequencies < upper)
        log_bands.append(np.log1p(power[:, mask].mean(axis=1)))
    band_matrix = np.stack(log_bands, axis=1)
    spectral_sum = magnitude.sum(axis=1)
    centroid = (magnitude * frequencies).sum(axis=1) / spectral_sum
    bandwidth = np.sqrt(
        (magnitude * (frequencies[None, :] - centroid[:, None]) ** 2).sum(axis=1)
        / spectral_sum
    )
    cumulative = np.cumsum(power, axis=1)
    rolloff_indices = (cumulative >= cumulative[:, -1, None] * 0.85).argmax(axis=1)
    rolloff = frequencies[rolloff_indices]
    rms = np.sqrt(np.mean(frames**2, axis=1))
    zcr = np.mean(np.diff(np.signbit(frames), axis=1), axis=1)
    crest = np.max(np.abs(frames), axis=1) / (rms + 1e-10)
    descriptors = np.stack([centroid, bandwidth, rolloff, rms, zcr, crest], axis=1)
    summary = np.concatenate(
        [
            band_matrix.mean(axis=0),
            band_matrix.std(axis=0),
            band_matrix.max(axis=0),
            descriptors.mean(axis=0),
            descriptors.std(axis=0),
            descriptors.max(axis=0),
        ]
    )
    return summary.astype(np.float64)


def decode_audio(path: Path) -> np.ndarray:
    if not path.is_file():
        raise FileNotFoundError(f"missing frozen source media: {path}")
    completed = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"ffmpeg could not decode {path}: {completed.stderr.decode(errors='replace').strip()}"
        )
    return np.frombuffer(completed.stdout, dtype="<f4").copy()


def feature_matrix(examples: Sequence[Mapping[str, Any]]) -> np.ndarray:
    cache: dict[str, np.ndarray] = {}
    features = []
    for row in examples:
        path = str(row["media_path"])
        if path not in cache:
            cache[path] = decode_audio(Path(path))
        window = fixed_audio_window(
            cache[path],
            event_time_s=float(row["time_s"]),
            source_rate=SAMPLE_RATE,
        )
        features.append(extract_spectral_features(window.samples))
    if not features:
        raise ValueError("no labeled audio-impact examples are available")
    return np.stack(features)


def _fit_linear(
    features: np.ndarray,
    labels: Sequence[str],
    *,
    alpha: float = 4.0,
) -> dict[str, Any]:
    mean = features.mean(axis=0)
    scale = features.std(axis=0)
    scale[scale < 1e-8] = 1.0
    standardized = (features - mean) / scale
    design = np.column_stack([np.ones(len(features)), standardized])
    targets = np.zeros((len(features), len(AUDIO_IMPACT_CLASSES)), dtype=np.float64)
    counts = {kind: labels.count(kind) for kind in AUDIO_IMPACT_CLASSES}
    for row_index, kind in enumerate(labels):
        class_index = AUDIO_IMPACT_CLASSES.index(kind)
        targets[row_index, class_index] = len(labels) / max(1, counts[kind])
    penalty = np.eye(design.shape[1]) * alpha
    penalty[0, 0] = 0.0
    weights = np.linalg.pinv(design.T @ design + penalty) @ design.T @ targets
    return {
        "mean": mean,
        "scale": scale,
        "weights": weights,
    }


def _linear_probabilities(model: Mapping[str, Any], features: np.ndarray) -> np.ndarray:
    mean = np.asarray(model["mean"], dtype=np.float64)
    scale = np.asarray(model["scale"], dtype=np.float64)
    weights = np.asarray(model["weights"], dtype=np.float64)
    design = np.column_stack([np.ones(len(features)), (features - mean) / scale])
    scores = design @ weights
    scores -= scores.max(axis=1, keepdims=True)
    exponential = np.exp(scores)
    return exponential / exponential.sum(axis=1, keepdims=True)


def _predictions(probabilities: np.ndarray, threshold: float) -> list[str | None]:
    indices = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    return [
        AUDIO_IMPACT_CLASSES[index] if confidence[row] >= threshold else None
        for row, index in enumerate(indices)
    ]


def _select_threshold(
    examples: Sequence[Mapping[str, Any]], probabilities: np.ndarray
) -> float:
    candidates = np.linspace(0.0, 0.9, 91)
    ranked = []
    for threshold in candidates:
        report = evaluate_predictions(
            examples,
            _predictions(probabilities, float(threshold)),
            partition="development",
            probabilities=probabilities,
        )
        ranked.append((report["macro_f1"], report["coverage"], -threshold, threshold))
    return float(max(ranked)[3])


def train_linear_experiment(
    examples: Sequence[Mapping[str, Any]],
    features: np.ndarray,
    *,
    fold_count: int = 3,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if any(_round_for(row) not in DEVELOPMENT_ROUNDS for row in examples):
        raise ValueError("Round C may not enter model fitting or threshold selection")
    if len(examples) != len(features):
        raise ValueError("feature and example counts differ")
    folds = build_grouped_folds(examples, fold_count=fold_count)
    out_of_fold = np.zeros((len(examples), len(AUDIO_IMPACT_CLASSES)))
    labels = [str(row["kind"]) for row in examples]
    for fold in folds:
        train_indices = fold["train_indices"]
        validation_indices = fold["validation_indices"]
        model = _fit_linear(
            features[train_indices],
            [labels[index] for index in train_indices],
        )
        out_of_fold[validation_indices] = _linear_probabilities(
            model, features[validation_indices]
        )
    threshold = _select_threshold(examples, out_of_fold)
    report = evaluate_predictions(
        examples,
        _predictions(out_of_fold, threshold),
        partition="development",
        probabilities=out_of_fold,
    )
    report["validation"] = "source_recording_grouped"
    report["fold_count"] = len(folds)
    report["threshold"] = threshold

    fitted = _fit_linear(features, labels)
    model_payload = {
        "model_type": "spectral_ridge_v1",
        "classes": list(AUDIO_IMPACT_CLASSES),
        "feature_count": int(features.shape[1]),
        "mean": fitted["mean"].tolist(),
        "scale": fitted["scale"].tolist(),
        "weights": fitted["weights"].tolist(),
    }
    threshold_payload = {"abstention_threshold": threshold, "selected_on": "development_oof"}
    artifact = {
        "artifact_schema_version": 1,
        **model_payload,
        **threshold_payload,
        "training_source_ids": sorted({str(row["source_id"]) for row in examples}),
        "training_recording_ids": sorted(
            {str(row["source_recording_id"]) for row in examples}
        ),
        "training_event_ids": sorted(str(row["event_id"]) for row in examples),
        "training_data_sha256": canonical_hash(
            sorted(
                (
                    {
                        "event_id": str(row["event_id"]),
                        "kind": str(row["kind"]),
                        "round": _round_for(row),
                        "source_id": str(row["source_id"]),
                        "time_s": float(row["time_s"]),
                    }
                    for row in examples
                ),
                key=lambda item: (item["source_id"], item["event_id"]),
            )
        ),
        "model_sha256": canonical_hash(model_payload),
        "threshold_sha256": canonical_hash(threshold_payload),
    }
    return artifact, report


def _validate_hash(value: Any, name: str) -> str:
    text = str(value or "")
    if len(text) != 64 or any(character not in "0123456789abcdef" for character in text):
        raise ValueError(f"artifact is missing a frozen {name}")
    return text


def validate_sealed_artifact(
    artifact: Mapping[str, Any],
    sealed_examples: Sequence[Mapping[str, Any]],
) -> None:
    if any(_round_for(row) != SEALED_ROUND for row in sealed_examples):
        raise ValueError("sealed scoring input must contain only Round C")
    _validate_hash(artifact.get("model_sha256"), "model_sha256")
    _validate_hash(artifact.get("threshold_sha256"), "threshold_sha256")
    sealed_source_ids = {str(row["source_id"]) for row in sealed_examples}
    overlap = sealed_source_ids.intersection(
        str(value) for value in artifact.get("training_source_ids") or []
    )
    if overlap:
        raise ValueError(
            "Round C leakage: training source IDs intersect sealed sources: "
            + ", ".join(sorted(overlap))
        )


def score_sealed(
    artifact: Mapping[str, Any],
    examples: Sequence[Mapping[str, Any]],
    features: np.ndarray,
) -> dict[str, Any]:
    validate_sealed_artifact(artifact, examples)
    model_payload = {
        key: artifact[key]
        for key in ("model_type", "classes", "feature_count", "mean", "scale", "weights")
    }
    threshold_payload = {
        "abstention_threshold": artifact["abstention_threshold"],
        "selected_on": artifact["selected_on"],
    }
    if canonical_hash(model_payload) != artifact["model_sha256"]:
        raise ValueError("frozen model hash does not match artifact contents")
    if canonical_hash(threshold_payload) != artifact["threshold_sha256"]:
        raise ValueError("frozen threshold hash does not match artifact contents")
    probabilities = _linear_probabilities(
        {
            "mean": artifact["mean"],
            "scale": artifact["scale"],
            "weights": artifact["weights"],
        },
        features,
    )
    report = evaluate_predictions(
        examples,
        _predictions(probabilities, float(artifact["abstention_threshold"])),
        partition="sealed",
        probabilities=probabilities,
    )
    report["model_sha256"] = artifact["model_sha256"]
    report["threshold_sha256"] = artifact["threshold_sha256"]
    return report


def require_cnn_dependency(
    *, import_module: Callable[[str], Any] = import_module
) -> Any:
    try:
        return import_module("torch")
    except (ImportError, ModuleNotFoundError) as exc:
        raise RuntimeError(
            "The optional CNN experiment requires PyTorch; install it with "
            "`python -m pip install torch` in this worker environment. "
            "The linear baseline does not require PyTorch."
        ) from exc


def _read_examples(export_path: Path, media_dir: Path, partition: str) -> list[dict[str, Any]]:
    payload = json.loads(export_path.read_text())
    rows = normalize_research_export(payload, media_dir=media_dir)
    examples = prepare_gold_examples(rows, partition=partition)
    if not examples:
        raise ValueError(f"no completed {partition} labels found in export")
    return examples


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    train = subparsers.add_parser("train-linear", help="Fit the required A/B linear baseline")
    train.add_argument("--export", type=Path, required=True)
    train.add_argument("--media-dir", type=Path, required=True)
    train.add_argument("--artifact-out", type=Path, required=True)
    train.add_argument("--report-out", type=Path, required=True)

    sealed = subparsers.add_parser("score-sealed", help="Score Round C once with a frozen artifact")
    sealed.add_argument("--export", type=Path, required=True)
    sealed.add_argument("--media-dir", type=Path, required=True)
    sealed.add_argument("--artifact", type=Path, required=True)
    sealed.add_argument("--report-out", type=Path, required=True)

    fetch = subparsers.add_parser("fetch-media", help="Download frozen clips named by an export")
    fetch.add_argument("--export", type=Path, required=True)
    fetch.add_argument("--media-dir", type=Path, required=True)

    subparsers.add_parser("check-cnn", help="Check the optional CNN dependency")
    args = parser.parse_args()

    if args.command == "check-cnn":
        require_cnn_dependency()
        print("PyTorch is available for the optional CNN experiment.")
        return
    if args.command == "fetch-media":
        if __package__:
            from .build_research_pilot import Production
        else:
            from build_research_pilot import Production

        payload = json.loads(args.export.read_text())
        count = fetch_frozen_media(payload, args.media_dir, production=Production())
        print(json.dumps({"downloaded": count, "media_dir": str(args.media_dir)}))
        return
    if args.command == "train-linear":
        examples = _read_examples(args.export, args.media_dir, "development")
        artifact, report = train_linear_experiment(examples, feature_matrix(examples))
        _write_json(args.artifact_out, artifact)
        _write_json(args.report_out, report)
        print(json.dumps({"artifact": str(args.artifact_out), "report": str(args.report_out)}))
        return

    artifact = json.loads(args.artifact.read_text())
    examples = _read_examples(args.export, args.media_dir, "sealed")
    report = score_sealed(artifact, examples, feature_matrix(examples))
    _write_json(args.report_out, report)
    print(json.dumps({"sealed_report": str(args.report_out)}))


if __name__ == "__main__":
    main()
