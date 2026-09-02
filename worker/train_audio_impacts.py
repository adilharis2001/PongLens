#!/usr/bin/env python3
"""Train and evaluate PongLens audio-impact models without production writes.

Round A/B human labels are development data. Round C is accepted only by the
sealed scoring command and is never used for fitting, threshold selection, or
feature selection. The required baseline uses NumPy/SciPy; PyTorch is optional.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from importlib import import_module
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np
from scipy.signal import resample_poly, stft


SAMPLE_RATE = 48_000
WINDOW_SECONDS = 0.2
WINDOW_SAMPLES = 9_600
AUDIO_IMPACT_CLASSES = (
    "paddle",
    "table",
    "floor",
    "shoe",
    "shoe_squeak",
    "stomp",
    "net",
    "background",
    "other",
    "no_impact",
    "paddle_table",
)
EXCLUDED_CLASSES = {"unsure"}
DEVELOPMENT_ROUNDS = {"A", "B"}
SEALED_ROUND = "C"
MIN_DEVELOPMENT_EXAMPLES = 30
MIN_SEALED_EXAMPLES = 15
MEDIA_BUCKET = "ponglens-media"
MEDIA_PREFIX = "research/audio-impacts/v1/sources"
FEATURE_DEFINITION = {
    "version": "short_time_full_band_v1",
    "sample_rate": SAMPLE_RATE,
    "window_samples": WINDOW_SAMPLES,
    "frame_samples": 1_200,
    "hop_samples": 480,
    "spectral_bands": 24,
    "band_min_hz": 60,
    "band_max_hz": SAMPLE_RATE // 2,
    "summaries": ["mean", "std", "max"],
    "descriptors": ["centroid", "bandwidth", "rolloff85", "rms", "zcr", "crest"],
}


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


def feature_definition_sha256() -> str:
    return canonical_hash(FEATURE_DEFINITION)


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
                    "media_sha256": str(assignment.get("media_sha256") or ""),
                    "cohort_manifest_sha256": str(
                        prefill.get("cohort_manifest_sha256") or ""
                    ),
                    "detector_manifest_sha256": str(
                        assignment.get("detector_manifest_sha256")
                        or prefill.get("detector_manifest_sha256")
                        or ""
                    ),
                    "human_gold": True,
                    "point_id": prefill.get("point_id") or assignment.get("source_point_id"),
                }
            )
    return rows


def validate_export_bindings(
    payload: Mapping[str, Any],
    examples: Sequence[Mapping[str, Any]],
    *,
    partition: str,
) -> dict[str, str]:
    if partition not in {"development", "sealed"}:
        raise ValueError("partition must be development or sealed")
    study_state = payload.get("study_state") or {}
    phase = str(study_state.get("phase") or "")
    exported_rounds = {str(value) for value in payload.get("exported_rounds") or []}
    sealed_snapshot_sha256 = ""
    if partition == "development":
        if "C" in exported_rounds or phase not in {
            "development_a",
            "development_b",
            "frozen",
        }:
            raise ValueError("development export is not phase-scoped away from Round C")
        expected_rounds = {"A"} if phase == "development_a" else {"A", "B"}
        expected_count = 30 if phase == "development_a" else 60
        development_assignments = [
            row
            for row in payload.get("assignments") or []
            if str((row.get("prefill") or {}).get("round") or "")
            in expected_rounds
        ]
        source_ids = {
            str(row.get("source_id") or "") for row in development_assignments
        }
        if (
            len(development_assignments) != expected_count
            or len(source_ids) != expected_count
            or "" in source_ids
            or any(
                row.get("status") != "submitted"
                or (row.get("human_label") or {}).get("sequence_complete") is not True
                for row in development_assignments
            )
        ):
            raise ValueError(
                f"all {expected_count} development assignments must be complete"
            )
    else:
        if phase != "sealed_labeling" or "C" not in exported_rounds:
            raise ValueError("sealed export is not an unlocked Round C export")
        sealed_assignments = [
            row
            for row in payload.get("assignments") or []
            if str((row.get("prefill") or {}).get("round") or "") == "C"
        ]
        sealed_source_ids = {
            str(row.get("source_id") or "") for row in sealed_assignments
        }
        if (
            len(sealed_assignments) != 30
            or len(sealed_source_ids) != 30
            or "" in sealed_source_ids
            or any(
                row.get("status") != "submitted"
                or (row.get("human_label") or {}).get("sequence_complete") is not True
                for row in sealed_assignments
            )
        ):
            raise ValueError(
                "all 30 frozen Round C assignments must be submitted and complete"
            )
        sealed_snapshot_sha256 = sealed_label_snapshot(sealed_assignments)[
            "sha256"
        ]
    cohort_hash = _validate_hash(
        study_state.get("cohort_manifest_sha256"), "cohort_manifest_sha256"
    )
    detector_hash = _validate_hash(
        study_state.get("detector_manifest_sha256"), "detector_manifest_sha256"
    )
    if any(str(row.get("cohort_manifest_sha256") or "") != cohort_hash for row in examples):
        raise ValueError("export examples do not match the frozen cohort manifest")
    if any(
        not re.fullmatch(r"[0-9a-f]{64}", str(row.get("media_sha256") or ""))
        for row in examples
    ):
        raise ValueError("every export example needs a frozen media SHA-256")
    if any(
        not re.fullmatch(
            r"[0-9a-f]{64}",
            str(row.get("detector_manifest_sha256") or ""),
        )
        for row in examples
    ):
        raise ValueError("every export example needs a frozen proposal SHA-256")
    return {
        "export_sha256": canonical_hash(payload),
        "cohort_manifest_sha256": cohort_hash,
        "detector_manifest_sha256": detector_hash,
        "frozen_model_sha256": str(study_state.get("development_model_sha256") or ""),
        "frozen_threshold_sha256": str(
            study_state.get("development_threshold_sha256") or ""
        ),
        "sealed_label_snapshot_sha256": sealed_snapshot_sha256,
    }


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


def _validated_class_order(classes: Sequence[str]) -> tuple[str, ...]:
    class_order = tuple(map(str, classes))
    if not class_order or len(set(class_order)) != len(class_order):
        raise ValueError("audio-impact class order must be nonempty and unique")
    unknown = set(class_order).difference(AUDIO_IMPACT_CLASSES)
    if unknown:
        raise ValueError(
            "audio-impact class order contains unknown classes: "
            + ", ".join(sorted(unknown))
        )
    return class_order


def _class_metrics(
    truth: Sequence[str],
    predictions: Sequence[str | None],
    *,
    partition: str,
    classes: Sequence[str] = AUDIO_IMPACT_CLASSES,
) -> dict[str, dict[str, Any]]:
    minimum = (
        MIN_DEVELOPMENT_EXAMPLES
        if partition == "development"
        else MIN_SEALED_EXAMPLES
    )
    result = {}
    for kind in classes:
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
    truth: Sequence[str], probabilities: np.ndarray | None, classes: Sequence[str]
) -> float | None:
    if probabilities is None:
        return None
    paddle_index = tuple(classes).index("paddle")
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
    classes: Sequence[str] = AUDIO_IMPACT_CLASSES,
) -> dict[str, Any]:
    class_order = _validated_class_order(classes)
    if partition not in {"development", "sealed"}:
        raise ValueError("partition must be development or sealed")
    if len(examples) != len(predictions):
        raise ValueError("examples and predictions must have the same length")
    if probabilities is not None and probabilities.shape != (
        len(examples),
        len(class_order),
    ):
        raise ValueError("probability matrix has the wrong shape")
    truth = [str(row["kind"]) for row in examples]
    unknown_truth = set(truth).difference(class_order)
    unknown_predictions = {
        value for value in predictions if value is not None
    }.difference(class_order)
    if unknown_truth or unknown_predictions:
        raise ValueError("examples or predictions use classes absent from the model")
    accepted = sum(value is not None for value in predictions)
    class_metrics = _class_metrics(
        truth,
        predictions,
        partition=partition,
        classes=class_order,
    )
    supported_f1 = [
        value["f1"]
        for value in class_metrics.values()
        if value[f"{partition}_count"] > 0
    ]
    accepted_indices = [
        index for index, prediction in enumerate(predictions) if prediction is not None
    ]
    selective_truth = [truth[index] for index in accepted_indices]
    selective_predictions = [predictions[index] for index in accepted_indices]
    selective_classes = _class_metrics(
        selective_truth,
        selective_predictions,
        partition=partition,
        classes=class_order,
    )
    selective_supported_f1 = [
        value["f1"]
        for value in selective_classes.values()
        if value[f"{partition}_count"] > 0
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
        "selective_accuracy": (
            sum(left == right for left, right in zip(selective_truth, selective_predictions))
            / len(selective_truth)
            if selective_truth
            else 0.0
        ),
        "macro_f1": sum(supported_f1) / len(supported_f1) if supported_f1 else 0.0,
        "selective_macro_f1": (
            sum(selective_supported_f1) / len(selective_supported_f1)
            if selective_supported_f1
            else 0.0
        ),
        "paddle_table_balanced_accuracy": _paddle_table_balanced_accuracy(truth, predictions),
        "selective_paddle_table_balanced_accuracy": _paddle_table_balanced_accuracy(
            selective_truth,
            selective_predictions,
        ),
        "paddle_table_roc_auc": _paddle_table_roc_auc(
            truth, probabilities, class_order
        ),
        "classes": class_metrics,
        "confusion_matrix": {
            actual: {
                predicted: sum(
                    left == actual and (right or "abstain") == predicted
                    for left, right in zip(truth, predictions)
                )
                for predicted in (*class_order, "abstain")
            }
            for actual in class_order
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
            classes=class_order,
        )
        venue_supported_f1 = [
            value["f1"]
            for value in venue_classes.values()
            if value[f"{partition}_count"] > 0
        ]
        venue_accepted = [
            index for index, value in enumerate(venue_predictions) if value is not None
        ]
        venue_selective_truth = [venue_truth[index] for index in venue_accepted]
        venue_selective_predictions = [
            venue_predictions[index] for index in venue_accepted
        ]
        venue_selective_classes = _class_metrics(
            venue_selective_truth,
            venue_selective_predictions,
            partition=partition,
            classes=class_order,
        )
        venue_selective_supported_f1 = [
            value["f1"]
            for value in venue_selective_classes.values()
            if value[f"{partition}_count"] > 0
        ]
        report["venues"][venue] = {
            "example_count": len(indices),
            "coverage": (
                sum(value is not None for value in venue_predictions) / len(indices)
                if indices
                else 0.0
            ),
            "classes": venue_classes,
            "selective_classes": venue_selective_classes,
            "accuracy": sum(
                left == right
                for left, right in zip(venue_truth, venue_predictions)
            )
            / len(indices),
            "selective_accuracy": (
                sum(
                    left == right
                    for left, right in zip(
                        venue_selective_truth, venue_selective_predictions
                    )
                )
                / len(venue_selective_truth)
                if venue_selective_truth
                else 0.0
            ),
            "macro_f1": (
                sum(venue_supported_f1) / len(venue_supported_f1)
                if venue_supported_f1
                else 0.0
            ),
            "selective_macro_f1": (
                sum(venue_selective_supported_f1)
                / len(venue_selective_supported_f1)
                if venue_selective_supported_f1
                else 0.0
            ),
            "confusion_matrix": {
                actual: {
                    predicted: sum(
                        left == actual and (right or "abstain") == predicted
                        for left, right in zip(venue_truth, venue_predictions)
                    )
                    for predicted in (*class_order, "abstain")
                }
                for actual in class_order
            },
            "paddle_table_balanced_accuracy": _paddle_table_balanced_accuracy(
                venue_truth, venue_predictions
            ),
            "selective_paddle_table_balanced_accuracy": (
                _paddle_table_balanced_accuracy(
                    venue_selective_truth,
                    venue_selective_predictions,
                )
            ),
            "paddle_table_roc_auc": _paddle_table_roc_auc(
                venue_truth,
                probabilities[indices] if probabilities is not None else None,
                class_order,
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
                classes=class_order,
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


def log_spectrogram(samples: np.ndarray) -> np.ndarray:
    signal = np.asarray(samples, dtype=np.float32)
    if signal.shape != (WINDOW_SAMPLES,):
        raise ValueError(f"expected {WINDOW_SAMPLES} samples")
    _, _, values = stft(
        signal,
        fs=SAMPLE_RATE,
        window="hann",
        nperseg=512,
        noverlap=256,
        nfft=512,
        boundary=None,
        padded=False,
    )
    image = np.log1p(np.abs(values[:96]) * 100.0)
    mean = float(image.mean())
    scale = float(image.std()) or 1.0
    return ((image - mean) / scale).astype(np.float32)


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
            expected_media_sha = _validate_hash(
                row.get("media_sha256"), "media_sha256"
            )
            actual_media_sha = file_sha256(Path(path))
            if actual_media_sha != expected_media_sha:
                raise ValueError(f"frozen media SHA-256 mismatch for {path}")
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


def window_matrix(examples: Sequence[Mapping[str, Any]]) -> np.ndarray:
    cache: dict[str, np.ndarray] = {}
    windows = []
    for row in examples:
        path = str(row["media_path"])
        if path not in cache:
            expected = _validate_hash(row.get("media_sha256"), "media_sha256")
            if file_sha256(Path(path)) != expected:
                raise ValueError(f"frozen media SHA-256 mismatch for {path}")
            cache[path] = decode_audio(Path(path))
        windows.append(
            fixed_audio_window(
                cache[path],
                event_time_s=float(row["time_s"]),
                source_rate=SAMPLE_RATE,
            ).samples
        )
    if not windows:
        raise ValueError("no labeled audio-impact examples are available")
    return np.stack(windows)


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


def _predictions(
    probabilities: np.ndarray,
    threshold: float,
    *,
    classes: Sequence[str] = AUDIO_IMPACT_CLASSES,
) -> list[str | None]:
    class_order = _validated_class_order(classes)
    if probabilities.ndim != 2 or probabilities.shape[1] != len(class_order):
        raise ValueError("probability matrix does not match the model class order")
    indices = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    return [
        class_order[index] if confidence[row] >= threshold else None
        for row, index in enumerate(indices)
    ]


def pool_acquisition_components(
    probabilities: np.ndarray,
    candidates: Sequence[Mapping[str, Any]],
    *,
    low_threshold_candidates: Sequence[Mapping[str, Any]] = (),
    duration_s: float | None = None,
    classes: Sequence[str] = AUDIO_IMPACT_CLASSES,
) -> dict[str, float]:
    class_order = _validated_class_order(classes)
    if len(probabilities) != len(candidates):
        raise ValueError("candidate and probability counts differ")
    if probabilities.ndim != 2 or probabilities.shape[1] != len(class_order):
        raise ValueError("probability matrix does not match the model class order")
    uncertainty = (
        float(np.mean(1.0 - probabilities.max(axis=1)))
        if candidates
        else 1.0
    )
    confound_indices = [
        class_order.index(kind)
        for kind in (
            "floor",
            "shoe",
            "shoe_squeak",
            "stomp",
            "net",
            "background",
            "other",
            "no_impact",
        )
        if kind in class_order
    ]
    confound_probability = (
        float(np.mean(probabilities[:, confound_indices].sum(axis=1)))
        if candidates
        else 0.0
    )
    low_frequency_strength = (
        float(
            np.mean(
                [
                    min(
                        1.0,
                        float((candidate.get("detector_scores") or {}).get("low_frequency") or 0.0)
                        / 5.0,
                    )
                    for candidate in candidates
                ]
            )
        )
        if candidates
        else 0.0
    )
    duration = float(duration_s or 0.0)
    event_density = (
        min(1.0, len(low_threshold_candidates) / max(1.0, duration * 4.0))
        if duration > 0
        else 0.0
    )
    tail_candidates = [
        item
        for item in low_threshold_candidates
        if duration > 0
        and float(item.get("time_s") or 0.0) >= duration * 0.75
        and "low_frequency" in (item.get("detector_origins") or [])
    ]
    floor_tail_density = (
        len(tail_candidates) / len(low_threshold_candidates)
        if low_threshold_candidates
        else 0.0
    )
    confound_novelty = float(
        np.mean(
            [
                confound_probability,
                low_frequency_strength,
                event_density,
                floor_tail_density,
            ]
        )
    )
    return {
        "uncertainty": round(uncertainty, 8),
        "confound_probability": round(confound_probability, 8),
        "low_frequency_strength": round(low_frequency_strength, 8),
        "event_density": round(event_density, 8),
        "floor_tail_density": round(floor_tail_density, 8),
        "confound_novelty": round(confound_novelty, 8),
        "acquisition_score": round(0.6 * uncertainty + 0.4 * confound_novelty, 8),
    }


def _verified_pool_manifest(payload: Mapping[str, Any]) -> dict[str, Any]:
    manifest = dict(payload)
    supplied = str(manifest.pop("manifest_sha256", ""))
    if supplied != canonical_hash(manifest):
        raise ValueError("cohort manifest hash does not match its contents")
    if (
        manifest.get("batch_slug") != "audio-impact-labeling-recent-v1"
        or manifest.get("stage") != "initial"
    ):
        raise ValueError("Round B acquisition requires the initial audio-impact manifest")
    pool = list(manifest.get("round_b_pool") or [])
    if not pool or any(item.get("round") != "B" for item in pool):
        raise ValueError("cohort manifest has no valid Round B pool")
    manifest["manifest_sha256"] = supplied
    return manifest


def _verified_pool_audit(
    payload: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> dict[str, Any]:
    audit = dict(payload)
    supplied = str(audit.pop("audit_sha256", ""))
    if supplied != canonical_hash(audit):
        raise ValueError("Round B media audit hash does not match its contents")
    if audit.get("manifest_sha256") != manifest.get("manifest_sha256"):
        raise ValueError("Round B media audit belongs to another cohort manifest")
    entries = {
        str(item.get("point_id") or ""): dict(item)
        for item in audit.get("entries") or []
    }
    expected_ids = {
        str(item["point_id"])
        for item in [
            *(manifest.get("selected") or []),
            *(manifest.get("round_b_pool") or []),
        ]
    }
    if set(entries) != expected_ids:
        raise ValueError("Round B media audit does not cover the frozen inventory")
    pool_ids = {str(item["point_id"]) for item in manifest["round_b_pool"]}
    if not pool_ids.issubset(entries):
        raise ValueError("Round B media audit does not cover the frozen pool")
    for point_id in pool_ids:
        _validate_hash(
            entries[point_id].get("media_sha256"),
            f"pool media SHA-256 for {point_id}",
        )
        _validate_hash(
            entries[point_id].get("proposal_sha256"),
            f"pool proposal SHA-256 for {point_id}",
        )
    detector_hash = canonical_hash(
        {
            "detector_version": manifest["detector_version"],
            "proposal_sha256_by_point": {
                point_id: str(entries[point_id]["proposal_sha256"])
                for point_id in sorted(entries)
            },
        }
    )
    return {
        "audit_sha256": supplied,
        "detector_manifest_sha256": detector_hash,
        "entries": entries,
    }


def fetch_round_b_pool_media(
    manifest_payload: Mapping[str, Any],
    audit_payload: Mapping[str, Any],
    output_dir: Path,
    *,
    production: Any,
) -> int:
    manifest = _verified_pool_manifest(manifest_payload)
    audit = _verified_pool_audit(audit_payload, manifest)
    output_dir.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for item in manifest["round_b_pool"]:
        point_id = str(item["point_id"])
        destination = output_dir / f"{point_id}.mp4"
        if destination.is_file():
            pass
        else:
            uri = str(item["clip_path"])
            if not uri.startswith("r2://") or "/" not in uri[5:]:
                raise ValueError(f"invalid Round B clip path {uri!r}")
            bucket, key = uri[5:].split("/", 1)
            production.r2.download_file(bucket, key, str(destination))
            fetched += 1
        if file_sha256(destination) != audit["entries"][point_id]["media_sha256"]:
            raise ValueError(f"frozen Round B media SHA-256 mismatch for {point_id}")
    return fetched


def score_round_b_pool(
    manifest_payload: Mapping[str, Any],
    audit_payload: Mapping[str, Any],
    artifact: Mapping[str, Any],
    media_dir: Path,
) -> dict[str, Any]:
    manifest = _verified_pool_manifest(manifest_payload)
    audit = _verified_pool_audit(audit_payload, manifest)
    if artifact.get("cohort_manifest_sha256") != manifest["manifest_sha256"]:
        raise ValueError("A-model artifact does not belong to the frozen cohort")
    if artifact.get("feature_definition_sha256") != feature_definition_sha256():
        raise ValueError("A-model feature definition is not current")
    if artifact.get("detector_manifest_sha256") != audit["detector_manifest_sha256"]:
        raise ValueError("A-model detector binding differs from the audited proposals")
    class_order = _validated_class_order(artifact.get("classes") or ())
    model = {
        "mean": artifact["mean"],
        "scale": artifact["scale"],
        "weights": artifact["weights"],
    }
    model_payload = {
        "model_type": artifact["model_type"],
        "classes": artifact["classes"],
        "feature_count": artifact["feature_count"],
        **model,
    }
    if canonical_hash(model_payload) != artifact.get("model_sha256"):
        raise ValueError("A-model hash does not match artifact contents")
    scores: dict[str, dict[str, float]] = {}
    detector = Path(__file__).with_name("research_audio_candidates.py")
    if __package__:
        from .build_research_pilot import probe_video, stable_uuid
    else:
        from build_research_pilot import probe_video, stable_uuid
    for item in manifest["round_b_pool"]:
        point_id = str(item["point_id"])
        media_path = media_dir / f"{point_id}.mp4"
        if not media_path.is_file():
            raise FileNotFoundError(f"missing Round B pool media: {media_path}")
        if file_sha256(media_path) != audit["entries"][point_id]["media_sha256"]:
            raise ValueError(f"frozen Round B media SHA-256 mismatch for {point_id}")
        completed = subprocess.run(
            [
                sys.executable,
                str(detector),
                str(media_path),
                "--source-id",
                stable_uuid("audio-impact-labeling-recent-v1", point_id),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"candidate analysis failed for {point_id}: {completed.stderr.strip()}"
            )
        proposal = json.loads(completed.stdout)
        frozen_proposal = {
            "schema_version": 1,
            "automatic_prediction_withheld": True,
            "video": probe_video(media_path),
            "audio": proposal,
        }
        if canonical_hash(frozen_proposal) != audit["entries"][point_id][
            "proposal_sha256"
        ]:
            raise ValueError(f"frozen detector proposal mismatch for {point_id}")
        candidates = list(proposal.get("candidates") or [])
        samples = decode_audio(media_path)
        if candidates:
            features = np.stack(
                [
                    extract_spectral_features(
                        fixed_audio_window(
                            samples,
                            event_time_s=float(candidate["time_s"]),
                            source_rate=SAMPLE_RATE,
                        ).samples
                    )
                    for candidate in candidates
                ]
            )
            probabilities = _linear_probabilities(model, features)
        else:
            probabilities = np.empty((0, len(class_order)))
        scores[point_id] = pool_acquisition_components(
            probabilities,
            candidates,
            low_threshold_candidates=proposal.get("low_threshold_candidates") or [],
            duration_s=float(proposal.get("duration_s") or 0.0),
            classes=class_order,
        )
    envelope = {
        "schema_version": 1,
        "initial_manifest_sha256": manifest["manifest_sha256"],
        "media_audit_sha256": audit["audit_sha256"],
        "detector_manifest_sha256": audit["detector_manifest_sha256"],
        "model_sha256": artifact["model_sha256"],
        "feature_definition_sha256": feature_definition_sha256(),
        "scores": scores,
    }
    envelope["score_envelope_sha256"] = canonical_hash(envelope)
    return envelope


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
    bindings: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if any(_round_for(row) not in DEVELOPMENT_ROUNDS for row in examples):
        raise ValueError("Round C may not enter model fitting or threshold selection")
    if len(examples) != len(features):
        raise ValueError("feature and example counts differ")
    if bindings is None:
        raise ValueError("training requires frozen export and manifest bindings")
    for name in (
        "export_sha256",
        "cohort_manifest_sha256",
        "detector_manifest_sha256",
    ):
        _validate_hash(bindings.get(name), name)
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
    split_payload = {
        "strategy": "source_recording_grouped",
        "folds": [
            {
                "training_recording_ids": sorted(
                    {
                        str(examples[index]["source_recording_id"])
                        for index in fold["train_indices"]
                    }
                ),
                "validation_recording_ids": sorted(
                    {
                        str(examples[index]["source_recording_id"])
                        for index in fold["validation_indices"]
                    }
                ),
            }
            for fold in folds
        ],
    }
    split_hash = canonical_hash(split_payload)
    report["split_definition_sha256"] = split_hash
    report.update(
        {
            "development_export_sha256": bindings["export_sha256"],
            "cohort_manifest_sha256": bindings["cohort_manifest_sha256"],
            "detector_manifest_sha256": bindings["detector_manifest_sha256"],
        }
    )

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
        "development_export_sha256": bindings["export_sha256"],
        "cohort_manifest_sha256": bindings["cohort_manifest_sha256"],
        "detector_manifest_sha256": bindings["detector_manifest_sha256"],
        "feature_definition": FEATURE_DEFINITION,
        "feature_definition_sha256": feature_definition_sha256(),
        "split_definition": split_payload,
        "split_definition_sha256": split_hash,
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
    artifact["development_report_sha256"] = canonical_hash(report)
    return artifact, report


def train_grouped_cnn_experiment(
    examples: Sequence[Mapping[str, Any]],
    windows: np.ndarray,
    *,
    torch_module: Any,
    epochs: int = 20,
    fold_count: int = 3,
) -> dict[str, Any]:
    """Evaluate a small spectrogram CNN with the same recording-grouped folds."""
    if any(_round_for(row) not in DEVELOPMENT_ROUNDS for row in examples):
        raise ValueError("Round C may not enter the CNN experiment")
    if windows.shape != (len(examples), WINDOW_SAMPLES):
        raise ValueError("CNN windows have the wrong shape")
    if epochs < 1:
        raise ValueError("CNN epochs must be positive")
    torch = torch_module
    nn = torch.nn
    spectrograms = np.stack([log_spectrogram(window) for window in windows])
    labels = np.asarray(
        [AUDIO_IMPACT_CLASSES.index(str(row["kind"])) for row in examples],
        dtype=np.int64,
    )
    folds = build_grouped_folds(examples, fold_count=fold_count)
    out_of_fold = np.zeros((len(examples), len(AUDIO_IMPACT_CLASSES)))

    class TinyImpactCnn(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.network = nn.Sequential(
                nn.Conv2d(1, 8, kernel_size=3, padding=1),
                nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(8, 16, kernel_size=3, padding=1),
                nn.ReLU(),
                nn.AdaptiveAvgPool2d((1, 1)),
                nn.Flatten(),
                nn.Linear(16, len(AUDIO_IMPACT_CLASSES)),
            )

        def forward(self, values: Any) -> Any:
            return self.network(values)

    for fold_number, fold in enumerate(folds):
        torch.manual_seed(20_260_901 + fold_number)
        model = TinyImpactCnn()
        train_indices = np.asarray(fold["train_indices"])
        validation_indices = np.asarray(fold["validation_indices"])
        train_x = torch.tensor(
            spectrograms[train_indices, None, :, :],
            dtype=torch.float32,
        )
        train_y = torch.tensor(labels[train_indices], dtype=torch.long)
        counts = np.bincount(
            labels[train_indices],
            minlength=len(AUDIO_IMPACT_CLASSES),
        )
        weights = np.zeros(len(AUDIO_IMPACT_CLASSES), dtype=np.float32)
        present = counts > 0
        weights[present] = len(train_indices) / counts[present]
        loss_function = nn.CrossEntropyLoss(
            weight=torch.tensor(weights, dtype=torch.float32)
        )
        optimizer = torch.optim.Adam(model.parameters(), lr=0.003, weight_decay=0.001)
        model.train()
        for _ in range(epochs):
            optimizer.zero_grad()
            loss = loss_function(model(train_x), train_y)
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.no_grad():
            validation_x = torch.tensor(
                spectrograms[validation_indices, None, :, :],
                dtype=torch.float32,
            )
            probabilities = torch.softmax(model(validation_x), dim=1).cpu().numpy()
        out_of_fold[validation_indices] = probabilities

    threshold = _select_threshold(examples, out_of_fold)
    report = evaluate_predictions(
        examples,
        _predictions(out_of_fold, threshold),
        partition="development",
        probabilities=out_of_fold,
    )
    report.update(
        {
            "model_type": "tiny_log_spectrogram_cnn_v1",
            "validation": "source_recording_grouped",
            "fold_count": len(folds),
            "epochs": epochs,
            "threshold": threshold,
            "spectrogram_shape": list(spectrograms.shape[1:]),
            "feature_definition_sha256": canonical_hash(
                {
                    "window_feature": FEATURE_DEFINITION,
                    "spectrogram": {
                        "nperseg": 512,
                        "noverlap": 256,
                        "frequency_bins": 96,
                        "log_scale": 100.0,
                    },
                }
            ),
        }
    )
    return report


def compare_cnn_to_linear(
    cnn_report: Mapping[str, Any],
    linear_report: Mapping[str, Any],
) -> dict[str, Any]:
    for name in (
        "development_export_sha256",
        "cohort_manifest_sha256",
        "detector_manifest_sha256",
    ):
        _validate_hash(cnn_report.get(name), name)
        if cnn_report.get(name) != linear_report.get(name):
            raise ValueError(f"CNN and linear reports differ on {name}")
    macro_delta = float(cnn_report.get("selective_macro_f1") or 0.0) - float(
        linear_report.get("selective_macro_f1") or 0.0
    )
    venue_deltas = {}
    for venue, linear_venue in (linear_report.get("venues") or {}).items():
        cnn_venue = (cnn_report.get("venues") or {}).get(venue) or {}
        venue_deltas[str(venue)] = float(
            cnn_venue.get("selective_accuracy") or 0.0
        ) - float(linear_venue.get("selective_accuracy") or 0.0)
    accepted = macro_delta >= 0.03 and all(
        value >= -0.02 for value in venue_deltas.values()
    )
    return {
        "selective_macro_f1_delta": round(macro_delta, 8),
        "venue_selective_accuracy_deltas": venue_deltas,
        "accept_cnn_complexity": accepted,
        "rule": "at least +0.03 selective macro F1 and no venue worse by more than 0.02",
    }


def _validate_hash(value: Any, name: str) -> str:
    text = str(value or "")
    if len(text) != 64 or any(character not in "0123456789abcdef" for character in text):
        raise ValueError(f"artifact is missing a frozen {name}")
    return text


def validate_sealed_artifact(
    artifact: Mapping[str, Any],
    sealed_examples: Sequence[Mapping[str, Any]],
    *,
    sealed_bindings: Mapping[str, str],
) -> None:
    if any(_round_for(row) != SEALED_ROUND for row in sealed_examples):
        raise ValueError("sealed scoring input must contain only Round C")
    _validate_hash(artifact.get("model_sha256"), "model_sha256")
    _validate_hash(artifact.get("threshold_sha256"), "threshold_sha256")
    if artifact.get("feature_definition_sha256") != feature_definition_sha256():
        raise ValueError("feature definition differs from the frozen training artifact")
    if artifact.get("cohort_manifest_sha256") != sealed_bindings.get(
        "cohort_manifest_sha256"
    ):
        raise ValueError("sealed export belongs to a different cohort manifest")
    if artifact.get("model_sha256") != sealed_bindings.get("frozen_model_sha256"):
        raise ValueError("sealed study state does not freeze this model")
    if artifact.get("threshold_sha256") != sealed_bindings.get(
        "frozen_threshold_sha256"
    ):
        raise ValueError("sealed study state does not freeze this threshold")
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
    *,
    sealed_bindings: Mapping[str, str],
) -> dict[str, Any]:
    validate_sealed_artifact(
        artifact,
        examples,
        sealed_bindings=sealed_bindings,
    )
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
    class_order = _validated_class_order(artifact.get("classes") or ())
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
        _predictions(
            probabilities,
            float(artifact["abstention_threshold"]),
            classes=class_order,
        ),
        partition="sealed",
        probabilities=probabilities,
        classes=class_order,
    )
    report["model_sha256"] = artifact["model_sha256"]
    report["threshold_sha256"] = artifact["threshold_sha256"]
    report["sealed_label_snapshot_sha256"] = _validate_hash(
        sealed_bindings.get("sealed_label_snapshot_sha256"),
        "sealed_label_snapshot_sha256",
    )
    return report


def freeze_and_unlock_payload(
    export_payload: Mapping[str, Any],
    artifact: Mapping[str, Any],
    *,
    unlocked_at: str,
) -> dict[str, Any]:
    state = dict(export_payload.get("study_state") or {})
    if state.get("phase") != "development_b":
        raise ValueError("sealed unlock requires the completed Round A/B phase")
    if set(map(str, export_payload.get("exported_rounds") or [])) != {"A", "B"}:
        raise ValueError("sealed unlock requires an A/B-only development export")
    development_assignments = [
        row
        for row in export_payload.get("assignments") or []
        if str((row.get("prefill") or {}).get("round") or "") in {"A", "B"}
    ]
    development_source_ids = {
        str(row.get("source_id") or "") for row in development_assignments
    }
    if (
        len(development_assignments) != 60
        or len(development_source_ids) != 60
        or "" in development_source_ids
        or any(
            row.get("status") != "submitted"
            or (row.get("human_label") or {}).get("sequence_complete") is not True
            for row in development_assignments
        )
    ):
        raise ValueError(
            "all 60 Round A/B assignments must be submitted before unlock"
        )
    export_hash = canonical_hash(export_payload)
    expected = {
        "development_export_sha256": export_hash,
        "cohort_manifest_sha256": str(state.get("cohort_manifest_sha256") or ""),
        "detector_manifest_sha256": str(
            state.get("detector_manifest_sha256") or ""
        ),
        "feature_definition_sha256": feature_definition_sha256(),
    }
    for name, value in expected.items():
        _validate_hash(value, name)
        if artifact.get(name) != value:
            raise ValueError(f"artifact {name} does not match the development export")
    for name in (
        "model_sha256",
        "threshold_sha256",
        "training_data_sha256",
        "split_definition_sha256",
    ):
        _validate_hash(artifact.get(name), name)
    return {
        **state,
        "phase": "sealed_labeling",
        "development_export_sha256": export_hash,
        "development_model_sha256": artifact["model_sha256"],
        "development_threshold_sha256": artifact["threshold_sha256"],
        "development_training_data_sha256": artifact["training_data_sha256"],
        "feature_definition_sha256": artifact["feature_definition_sha256"],
        "split_definition_sha256": artifact["split_definition_sha256"],
        "unlocked_at": unlocked_at,
    }


def sealed_label_snapshot(
    assignments: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    sealed = [
        row
        for row in assignments
        if str((row.get("prefill") or {}).get("round") or "") == "C"
    ]
    versions = sorted(
        (
            {
                "assignment_id": str(row.get("assignment_id") or ""),
                "source_id": str(row.get("source_id") or ""),
                "updated_at": str(row.get("updated_at") or ""),
            }
            for row in sealed
        ),
        key=lambda row: (row["assignment_id"], row["source_id"]),
    )
    if (
        len(versions) != 30
        or len({row["assignment_id"] for row in versions}) != 30
        or len({row["source_id"] for row in versions}) != 30
        or any(not all(row.values()) for row in versions)
    ):
        raise ValueError(
            "sealed label snapshot requires 30 distinct assignment/source versions"
        )
    return {"assignments": versions, "sha256": canonical_hash(versions)}


def scored_state_payload(
    study_state: Mapping[str, Any],
    report: Mapping[str, Any],
    assignments: Sequence[Mapping[str, Any]],
    *,
    scored_at: str,
) -> dict[str, Any]:
    if study_state.get("phase") == "scored" or study_state.get("sealed_report_sha256"):
        raise ValueError("this sealed cohort has already been scored")
    if study_state.get("phase") != "sealed_labeling":
        raise ValueError("sealed scoring has not been unlocked")
    sealed = [
        row
        for row in assignments
        if str((row.get("prefill") or {}).get("round") or "") == "C"
    ]
    sealed_source_ids = {str(row.get("source_id") or "") for row in sealed}
    if (
        len(sealed) != 30
        or len(sealed_source_ids) != 30
        or "" in sealed_source_ids
        or any(
            row.get("status") != "submitted"
            or (row.get("human_label") or {}).get("sequence_complete") is not True
            for row in sealed
        )
    ):
        raise ValueError("all 30 sealed assignments must be complete before scoring")
    if report.get("model_sha256") != study_state.get("development_model_sha256"):
        raise ValueError("sealed report model differs from the frozen model")
    if report.get("threshold_sha256") != study_state.get(
        "development_threshold_sha256"
    ):
        raise ValueError("sealed report threshold differs from the frozen threshold")
    snapshot = sealed_label_snapshot(sealed)
    if report.get("sealed_label_snapshot_sha256") != snapshot["sha256"]:
        raise ValueError("sealed report labels differ from the exported label snapshot")
    return {
        **dict(study_state),
        "phase": "scored",
        "sealed_label_snapshot_sha256": snapshot["sha256"],
        "sealed_report_sha256": canonical_hash(report),
        "scored_at": scored_at,
    }


def _patch_study_state(
    production: Any,
    batch_id: str,
    payload: Mapping[str, Any],
    *,
    expected_phase: str,
) -> None:
    import requests

    response = requests.patch(
        f"{production.supabase_url}/rest/v1/audio_impact_research_state",
        headers={
            **production.headers,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        params={"batch_id": f"eq.{batch_id}", "phase": f"eq.{expected_phase}"},
        json=dict(payload),
        timeout=60,
    )
    response.raise_for_status()
    rows = response.json()
    if len(rows) != 1:
        raise RuntimeError("audio-impact lifecycle compare-and-swap changed no state row")
    stored = rows[0]
    for key, value in payload.items():
        if stored.get(key) != value:
            raise RuntimeError(f"audio-impact lifecycle did not persist {key}")


def _record_sealed_score(
    production: Any,
    batch_id: str,
    transition: Mapping[str, Any],
    snapshot: Mapping[str, Any],
) -> None:
    import requests

    response = requests.post(
        f"{production.supabase_url}/rest/v1/rpc/record_audio_impact_sealed_score",
        headers={
            **production.headers,
            "Content-Type": "application/json",
        },
        json={
            "target_batch_id": batch_id,
            "expected_assignments": snapshot["assignments"],
            "expected_snapshot_sha256": transition[
                "sealed_label_snapshot_sha256"
            ],
            "report_sha256": transition["sealed_report_sha256"],
            "score_time": transition["scored_at"],
        },
        timeout=60,
    )
    response.raise_for_status()
    stored = response.json()
    if isinstance(stored, list):
        stored = stored[0] if len(stored) == 1 else {}
    for key in (
        "phase",
        "sealed_label_snapshot_sha256",
        "sealed_report_sha256",
        "scored_at",
    ):
        if stored.get(key) != transition[key]:
            raise RuntimeError(f"sealed scoring did not persist {key}")


def recover_pending_sealed_report(
    production: Any,
    export_path: Path,
    report_out: Path,
    *,
    request_get: Callable[..., Any] | None = None,
) -> Path:
    """Promote a pending report only when its exact score is already committed."""
    if report_out.exists():
        raise FileExistsError(f"sealed report already exists at {report_out}")
    pending_report = report_out.with_suffix(report_out.suffix + ".pending")
    if not pending_report.exists():
        raise FileNotFoundError(f"no pending sealed report at {pending_report}")

    export_payload = json.loads(export_path.read_text())
    report = json.loads(pending_report.read_text())
    snapshot = sealed_label_snapshot(export_payload.get("assignments") or [])
    if report.get("sealed_label_snapshot_sha256") != snapshot["sha256"]:
        raise ValueError("pending report does not match the exported sealed labels")
    batch_id = str((export_payload.get("batch") or {}).get("id") or "")
    if not batch_id:
        raise ValueError("sealed export is missing its batch ID")

    if request_get is None:
        import requests

        request_get = requests.get
    response = request_get(
        f"{production.supabase_url}/rest/v1/audio_impact_research_state",
        headers=production.headers,
        params={
            "batch_id": f"eq.{batch_id}",
            "select": (
                "phase,sealed_label_snapshot_sha256,sealed_report_sha256"
            ),
        },
        timeout=60,
    )
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError("could not resolve one audio-impact lifecycle state row")
    stored = rows[0]
    if stored.get("phase") != "scored":
        raise RuntimeError(
            "the database has not committed this sealed score; pending report retained"
        )
    if stored.get("sealed_label_snapshot_sha256") != snapshot["sha256"]:
        raise RuntimeError("database sealed-label snapshot differs; pending report retained")
    if stored.get("sealed_report_sha256") != canonical_hash(report):
        raise RuntimeError("database sealed-report hash differs; pending report retained")

    pending_report.replace(report_out)
    return report_out


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


def _read_examples(
    export_path: Path,
    media_dir: Path,
    partition: str,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    payload = json.loads(export_path.read_text())
    rows = normalize_research_export(payload, media_dir=media_dir)
    examples = prepare_gold_examples(rows, partition=partition)
    if not examples:
        raise ValueError(f"no completed {partition} labels found in export")
    return examples, validate_export_bindings(
        payload,
        examples,
        partition=partition,
    )


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

    cnn = subparsers.add_parser(
        "train-cnn",
        help="Run the optional grouped tiny-CNN comparison against the linear baseline",
    )
    cnn.add_argument("--export", type=Path, required=True)
    cnn.add_argument("--media-dir", type=Path, required=True)
    cnn.add_argument("--linear-report", type=Path, required=True)
    cnn.add_argument("--report-out", type=Path, required=True)
    cnn.add_argument("--epochs", type=int, default=20)

    sealed = subparsers.add_parser("score-sealed", help="Score Round C once with a frozen artifact")
    sealed.add_argument("--export", type=Path, required=True)
    sealed.add_argument("--media-dir", type=Path, required=True)
    sealed.add_argument("--artifact", type=Path, required=True)
    sealed.add_argument("--report-out", type=Path, required=True)
    sealed.add_argument(
        "--record-score",
        action="store_true",
        required=True,
        help="Atomically close the database-backed sealed evaluation after scoring",
    )

    recover = subparsers.add_parser(
        "recover-sealed-report",
        help="Recover a pending report after an ambiguous scoring response",
    )
    recover.add_argument("--export", type=Path, required=True)
    recover.add_argument("--report-out", type=Path, required=True)

    unlock = subparsers.add_parser(
        "unlock-sealed",
        help="Freeze the A/B artifact hashes and unlock Round C",
    )
    unlock.add_argument("--export", type=Path, required=True)
    unlock.add_argument("--artifact", type=Path, required=True)
    unlock.add_argument("--apply", action="store_true")

    fetch = subparsers.add_parser("fetch-media", help="Download frozen clips named by an export")
    fetch.add_argument("--export", type=Path, required=True)
    fetch.add_argument("--media-dir", type=Path, required=True)

    fetch_pool = subparsers.add_parser(
        "fetch-pool-media",
        help="Download the immutable eligible Round B point pool",
    )
    fetch_pool.add_argument("--manifest", type=Path, required=True)
    fetch_pool.add_argument("--audit", type=Path, required=True)
    fetch_pool.add_argument("--media-dir", type=Path, required=True)

    score_pool = subparsers.add_parser(
        "score-pool",
        help="Score the Round B pool with the frozen Round A model",
    )
    score_pool.add_argument("--manifest", type=Path, required=True)
    score_pool.add_argument("--audit", type=Path, required=True)
    score_pool.add_argument("--artifact", type=Path, required=True)
    score_pool.add_argument("--media-dir", type=Path, required=True)
    score_pool.add_argument("--scores-out", type=Path, required=True)

    subparsers.add_parser("check-cnn", help="Check the optional CNN dependency")
    args = parser.parse_args()

    if args.command == "check-cnn":
        require_cnn_dependency()
        print("PyTorch is available for the optional CNN experiment.")
        return
    if args.command == "recover-sealed-report":
        if __package__:
            from .build_research_pilot import Production
        else:
            from build_research_pilot import Production
        recovered = recover_pending_sealed_report(
            Production(),
            args.export,
            args.report_out,
        )
        print(json.dumps({"sealed_report": str(recovered), "recovered": True}))
        return
    if args.command in {"fetch-media", "fetch-pool-media"}:
        if __package__:
            from .build_research_pilot import Production
        else:
            from build_research_pilot import Production

        if args.command == "fetch-media":
            payload = json.loads(args.export.read_text())
            count = fetch_frozen_media(
                payload,
                args.media_dir,
                production=Production(),
            )
        else:
            payload = json.loads(args.manifest.read_text())
            count = fetch_round_b_pool_media(
                payload,
                json.loads(args.audit.read_text()),
                args.media_dir,
                production=Production(),
            )
        print(json.dumps({"downloaded": count, "media_dir": str(args.media_dir)}))
        return
    if args.command == "score-pool":
        scores = score_round_b_pool(
            json.loads(args.manifest.read_text()),
            json.loads(args.audit.read_text()),
            json.loads(args.artifact.read_text()),
            args.media_dir,
        )
        _write_json(args.scores_out, scores)
        print(
            json.dumps(
                {"scores": str(args.scores_out), "points": len(scores["scores"])}
            )
        )
        return
    if args.command == "unlock-sealed":
        export_payload = json.loads(args.export.read_text())
        artifact = json.loads(args.artifact.read_text())
        transition = freeze_and_unlock_payload(
            export_payload,
            artifact,
            unlocked_at=datetime.now(timezone.utc).isoformat(),
        )
        if args.apply:
            if __package__:
                from .build_research_pilot import Production
            else:
                from build_research_pilot import Production
            batch_id = str((export_payload.get("batch") or {}).get("id") or "")
            _patch_study_state(
                Production(),
                batch_id,
                transition,
                expected_phase="development_b",
            )
        print(json.dumps({"apply": args.apply, "state": transition}, sort_keys=True))
        return
    if args.command == "train-linear":
        examples, bindings = _read_examples(
            args.export, args.media_dir, "development"
        )
        artifact, report = train_linear_experiment(
            examples,
            feature_matrix(examples),
            bindings=bindings,
        )
        _write_json(args.artifact_out, artifact)
        _write_json(args.report_out, report)
        print(json.dumps({"artifact": str(args.artifact_out), "report": str(args.report_out)}))
        return
    if args.command == "train-cnn":
        examples, bindings = _read_examples(
            args.export, args.media_dir, "development"
        )
        report = train_grouped_cnn_experiment(
            examples,
            window_matrix(examples),
            torch_module=require_cnn_dependency(),
            epochs=args.epochs,
        )
        report.update(
            {
                "development_export_sha256": bindings["export_sha256"],
                "cohort_manifest_sha256": bindings["cohort_manifest_sha256"],
                "detector_manifest_sha256": bindings["detector_manifest_sha256"],
            }
        )
        report["linear_comparison"] = compare_cnn_to_linear(
            report,
            json.loads(args.linear_report.read_text()),
        )
        report["report_sha256"] = canonical_hash(report)
        _write_json(args.report_out, report)
        print(
            json.dumps(
                {
                    "cnn_report": str(args.report_out),
                    "accept_cnn_complexity": report["linear_comparison"][
                        "accept_cnn_complexity"
                    ],
                }
            )
        )
        return

    artifact = json.loads(args.artifact.read_text())
    examples, bindings = _read_examples(args.export, args.media_dir, "sealed")
    report = score_sealed(
        artifact,
        examples,
        feature_matrix(examples),
        sealed_bindings=bindings,
    )
    payload = json.loads(args.export.read_text())
    snapshot = sealed_label_snapshot(payload.get("assignments") or [])
    transition = scored_state_payload(
        payload.get("study_state") or {},
        report,
        payload.get("assignments") or [],
        scored_at=datetime.now(timezone.utc).isoformat(),
    )
    if args.report_out.exists():
        raise FileExistsError(
            f"refusing to overwrite sealed report {args.report_out}"
        )
    pending_report = args.report_out.with_suffix(args.report_out.suffix + ".pending")
    if pending_report.exists():
        raise FileExistsError(
            f"pending sealed report already exists at {pending_report}; recover it before retrying"
        )
    _write_json(pending_report, report)
    if args.record_score:
        if __package__:
            from .build_research_pilot import Production
        else:
            from build_research_pilot import Production
        batch_id = str((payload.get("batch") or {}).get("id") or "")
        try:
            _record_sealed_score(
                Production(),
                batch_id,
                transition,
                snapshot,
            )
        except Exception as exc:
            raise RuntimeError(
                "sealed scoring response was ambiguous; the pending report was retained. "
                "Run recover-sealed-report with the same --export and --report-out "
                "to verify the committed database hashes before promotion"
            ) from exc
    pending_report.replace(args.report_out)
    print(json.dumps({"sealed_report": str(args.report_out)}))


if __name__ == "__main__":
    main()
