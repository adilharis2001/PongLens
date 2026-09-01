"""Independent high-recall audio proposals for table-tennis research clips.

The detector intentionally proposes timing only. A high-frequency path catches
hard paddle/table/net transients, while a low-frequency path catches stomp,
floor, and body-like transients. Reviewers provide every semantic label.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any, Mapping, Sequence

import numpy as np
from scipy import signal


# Kept for the match-level card_audio importer, whose frozen detector runs at
# 44.1 kHz. Point research clips use their native 44.1/48 kHz rate.
TARGET_SAMPLE_RATE = 44_100
HIGHPASS_HZ = 10_000
LOW_BAND_HZ = (40, 700)
DISPLAY_FRAME_MS = 10
ENERGY_FRAME_MS = 1
MERGE_WINDOW_S = 0.035
MIN_REVIEW_CANDIDATES = 9
MAX_REVIEW_CANDIDATES = 14
DETECTOR_VERSION = "dual_band_impact_v1"


def probe_sample_rate(path: Path) -> int:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        sample_rate = int(completed.stdout.strip())
    except ValueError as error:
        detail = completed.stderr.strip() or "no audio stream"
        raise RuntimeError(f"FFprobe could not read audio from {path}: {detail}") from error
    if sample_rate <= 0:
        raise RuntimeError(f"Invalid audio sample rate for {path}: {sample_rate}")
    return sample_rate


def decode_audio(path: Path) -> tuple[np.ndarray, int]:
    sample_rate = probe_sample_rate(path)
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
            str(sample_rate),
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0 or not completed.stdout:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg could not decode {path}: {detail}")
    return np.frombuffer(completed.stdout, dtype="<f4").copy(), sample_rate


def frame_mean_absolute(samples: np.ndarray, frame_samples: int) -> np.ndarray:
    usable = len(samples) // frame_samples * frame_samples
    if usable == 0:
        return np.zeros(0, dtype=np.float64)
    return np.abs(samples[:usable]).reshape(-1, frame_samples).mean(
        axis=1, dtype=np.float64
    )


def normalized_envelope(
    samples: np.ndarray,
    sample_rate: int = TARGET_SAMPLE_RATE,
) -> list[float]:
    values = frame_mean_absolute(
        samples, round(sample_rate * DISPLAY_FRAME_MS / 1000)
    )
    if not len(values):
        return []
    scale = float(np.quantile(values, 0.995))
    if scale <= np.finfo(np.float64).eps:
        return [0.0] * len(values)
    return np.clip(values / scale, 0.0, 1.0).round(4).tolist()


def adaptive_threshold(
    energy: np.ndarray,
    *,
    baseline_multiplier: float = 4.0,
    mad_multiplier: float = 8.0,
) -> np.ndarray:
    if not len(energy):
        return np.zeros(0, dtype=np.float64)
    median = float(np.median(energy))
    mad = float(np.median(np.abs(energy - median)))
    robust_floor = median + mad_multiplier * max(mad, 1e-10)
    baseline = np.empty_like(energy, dtype=np.float64)
    baseline[0] = max(float(energy[0]), median, 1e-10)
    for index in range(1, len(energy)):
        previous = baseline[index - 1]
        capped = min(float(energy[index]), previous * 3.0)
        baseline[index] = 0.995 * previous + 0.005 * capped
    return np.maximum(baseline * baseline_multiplier, robust_floor)


def _band_detections(
    filtered: np.ndarray,
    sample_rate: int,
    detector: str,
    *,
    baseline_multiplier: float,
) -> tuple[list[dict[str, Any]], np.ndarray]:
    frame_samples = round(sample_rate * ENERGY_FRAME_MS / 1000)
    energy = frame_mean_absolute(filtered, frame_samples)
    threshold = adaptive_threshold(
        energy,
        baseline_multiplier=baseline_multiplier,
    )
    peaks, _ = signal.find_peaks(
        energy,
        height=threshold,
        distance=round(MERGE_WINDOW_S * 1000 / ENERGY_FRAME_MS),
    )
    detections = [
        {
            "time_s": round(index * frame_samples / sample_rate, 4),
            "detector": detector,
            "score": round(float(energy[index] / max(threshold[index], 1e-12)), 4),
            "energy": round(float(energy[index]), 8),
        }
        for index in peaks
    ]
    return detections, energy


def _candidate_id(
    time_s: float,
    origins: Sequence[str],
    *,
    source_id: str,
    detector_version: str,
) -> str:
    time_ms = round(time_s * 1000)
    identity = f"{source_id}:{detector_version}:{time_ms}:{','.join(origins)}"
    suffix = hashlib.sha256(identity.encode()).hexdigest()[:10]
    return f"impact-{time_ms:08d}-{suffix}"


def merge_detector_candidates(
    detections: Sequence[Mapping[str, Any]],
    *,
    tolerance_s: float = MERGE_WINDOW_S,
    source_id: str = "unbound-source",
    detector_version: str = DETECTOR_VERSION,
) -> list[dict[str, Any]]:
    clusters: list[list[Mapping[str, Any]]] = []
    for detection in sorted(
        detections,
        key=lambda item: (float(item["time_s"]), str(item["detector"])),
    ):
        if (
            not clusters
            or float(detection["time_s"])
            - float(clusters[-1][-1]["time_s"])
            > tolerance_s
        ):
            clusters.append([detection])
        else:
            clusters[-1].append(detection)

    merged = []
    origin_order = {"high_frequency": 0, "low_frequency": 1, "control": 2}
    for cluster in clusters:
        representative = max(
            cluster,
            key=lambda item: (
                float(item["score"]),
                -float(item["time_s"]),
            ),
        )
        scores: dict[str, float] = {}
        energies: dict[str, float] = {}
        for item in cluster:
            detector = str(item["detector"])
            scores[detector] = max(scores.get(detector, 0.0), float(item["score"]))
            energies[detector] = max(
                energies.get(detector, 0.0), float(item["energy"])
            )
        origins = sorted(scores, key=lambda value: (origin_order.get(value, 99), value))
        time_s = round(float(representative["time_s"]), 4)
        strength = round(max(scores.values()), 4)
        merged.append(
            {
                "id": _candidate_id(
                    time_s,
                    origins,
                    source_id=source_id,
                    detector_version=detector_version,
                ),
                "time_s": time_s,
                "detector_origins": origins,
                "strength": strength,
                "detector_scores": {
                    key: round(value, 4) for key, value in sorted(scores.items())
                },
                "detector_energies": {
                    key: round(value, 8) for key, value in sorted(energies.items())
                },
                # Backward-compatible fields consumed by the original fused pilot.
                "confidence": strength,
                "hf_energy": round(energies.get("high_frequency", 0.0), 8),
            }
        )
    return merged


def _control_candidate(
    time_s: float,
    *,
    source_id: str,
    detector_version: str,
) -> dict[str, Any]:
    rounded = round(time_s, 4)
    return {
        "id": _candidate_id(
            rounded,
            ["control"],
            source_id=source_id,
            detector_version=detector_version,
        ),
        "time_s": rounded,
        "detector_origins": ["control"],
        "strength": 0.0,
        "detector_scores": {"control": 0.0},
        "detector_energies": {"control": 0.0},
        "confidence": 0.0,
        "hf_energy": 0.0,
    }


def select_review_candidates(
    candidates: Sequence[Mapping[str, Any]],
    duration_s: float,
    *,
    minimum: int = MIN_REVIEW_CANDIDATES,
    maximum: int = MAX_REVIEW_CANDIDATES,
    source_id: str = "unbound-source",
    detector_version: str = DETECTOR_VERSION,
) -> list[dict[str, Any]]:
    if maximum < minimum or minimum < 0:
        raise ValueError("candidate bounds must satisfy 0 <= minimum <= maximum")
    selected = [dict(item) for item in candidates]
    desired_controls = min(2, maximum) if duration_s > 0 else 0
    real_limit = maximum - desired_controls
    if len(selected) > real_limit:
        # Score supplies precision; the small time bonus prevents every retained
        # proposal from coming from one dense rally exchange.
        bucket_width = max(duration_s / maximum, 0.001)
        selected.sort(
            key=lambda item: (
                -float(item.get("strength") or 0.0),
                int(float(item["time_s"]) / bucket_width),
                float(item["time_s"]),
            )
        )
        selected = selected[:real_limit]

    controls_needed = max(desired_controls, minimum - len(selected))
    if controls_needed > 0 and duration_s > 0:
        existing_times = [float(item["time_s"]) for item in selected]
        controls_added = 0
        for index in range(maximum * 8):
            if controls_added >= controls_needed or len(selected) >= maximum:
                break
            time_s = duration_s * (index + 1) / (maximum * 8 + 1)
            if any(abs(time_s - existing) < 0.08 for existing in existing_times):
                continue
            selected.append(
                _control_candidate(
                    time_s,
                    source_id=source_id,
                    detector_version=detector_version,
                )
            )
            existing_times.append(time_s)
            controls_added += 1

    return sorted(
        selected[:maximum],
        key=lambda item: (float(item["time_s"]), str(item["id"])),
    )


def analyze_samples(
    samples: np.ndarray,
    sample_rate: int,
    *,
    source_id: str = "unbound-source",
) -> dict[str, Any]:
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")
    mono = np.asarray(samples, dtype=np.float32).reshape(-1)
    duration_s = len(mono) / sample_rate
    if not len(mono):
        raise ValueError("audio samples cannot be empty")

    highpass = signal.sosfiltfilt(
        signal.butter(
            5,
            HIGHPASS_HZ,
            btype="highpass",
            fs=sample_rate,
            output="sos",
        ),
        mono,
    ).astype(np.float32)
    low_band = signal.sosfiltfilt(
        signal.butter(
            4,
            LOW_BAND_HZ,
            btype="bandpass",
            fs=sample_rate,
            output="sos",
        ),
        mono,
    ).astype(np.float32)

    high, _high_energy = _band_detections(
        highpass,
        sample_rate,
        "high_frequency",
        baseline_multiplier=4.0,
    )
    low, _low_energy = _band_detections(
        low_band,
        sample_rate,
        "low_frequency",
        baseline_multiplier=4.5,
    )
    uncapped = merge_detector_candidates(
        [*high, *low],
        source_id=source_id,
    )

    low_threshold_high, _ = _band_detections(
        highpass,
        sample_rate,
        "high_frequency",
        baseline_multiplier=2.5,
    )
    low_threshold_low, _ = _band_detections(
        low_band,
        sample_rate,
        "low_frequency",
        baseline_multiplier=3.0,
    )
    low_threshold = merge_detector_candidates(
        [*low_threshold_high, *low_threshold_low],
        source_id=source_id,
    )
    candidates = select_review_candidates(
        uncapped,
        duration_s,
        source_id=source_id,
    )

    return {
        "detector_version": DETECTOR_VERSION,
        "source_id": source_id,
        "sample_rate": sample_rate,
        "native_sample_rate": sample_rate,
        "duration_s": round(duration_s, 4),
        "waveform_bin_ms": DISPLAY_FRAME_MS,
        "waveform": normalized_envelope(mono, sample_rate),
        "high_frequency_envelope": normalized_envelope(highpass, sample_rate),
        "low_frequency_envelope": normalized_envelope(low_band, sample_rate),
        "candidates": candidates,
        "low_threshold_candidates": low_threshold,
        "uncapped_candidates": uncapped,
    }


def analyze(path: Path, *, source_id: str) -> dict[str, Any]:
    mono, sample_rate = decode_audio(path)
    return analyze_samples(mono, sample_rate, source_id=source_id)


def media_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("media", type=Path)
    parser.add_argument("--source-id")
    args = parser.parse_args()
    source_id = args.source_id or media_sha256(args.media)
    print(json.dumps(analyze(args.media, source_id=source_id), separators=(",", ":")))


if __name__ == "__main__":
    main()
