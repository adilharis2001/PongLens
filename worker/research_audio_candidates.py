"""Independent high-recall audio candidate extraction for research clips.

This is an original implementation of the general short-impact/high-frequency
method used in the TTVID experiment. It does not use TT Sounds code, data, or
weights.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
from scipy import signal


TARGET_SAMPLE_RATE = 44_100
HIGHPASS_HZ = 10_000
DISPLAY_FRAME_MS = 10
ENERGY_FRAME_MS = 1


def decode_audio(path: Path) -> np.ndarray:
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
            str(TARGET_SAMPLE_RATE),
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
    return np.frombuffer(completed.stdout, dtype="<f4").copy()


def frame_mean_absolute(samples: np.ndarray, frame_samples: int) -> np.ndarray:
    usable = len(samples) // frame_samples * frame_samples
    if usable == 0:
        return np.zeros(0, dtype=np.float64)
    return np.abs(samples[:usable]).reshape(-1, frame_samples).mean(
        axis=1, dtype=np.float64
    )


def normalized_envelope(samples: np.ndarray) -> list[float]:
    values = frame_mean_absolute(
        samples, round(TARGET_SAMPLE_RATE * DISPLAY_FRAME_MS / 1000)
    )
    if not len(values):
        return []
    scale = float(np.quantile(values, 0.995))
    if scale <= np.finfo(np.float64).eps:
        return [0.0] * len(values)
    return np.clip(values / scale, 0.0, 1.0).round(4).tolist()


def adaptive_threshold(energy: np.ndarray) -> np.ndarray:
    median = float(np.median(energy))
    mad = float(np.median(np.abs(energy - median)))
    robust_floor = median + 8.0 * max(mad, 1e-10)
    baseline = np.empty_like(energy, dtype=np.float64)
    baseline[0] = max(float(energy[0]), median, 1e-10)
    for index in range(1, len(energy)):
        previous = baseline[index - 1]
        capped = min(float(energy[index]), previous * 3.0)
        baseline[index] = 0.995 * previous + 0.005 * capped
    return np.maximum(baseline * 4.0, robust_floor)


def analyze(path: Path) -> dict:
    mono = decode_audio(path)
    highpass = signal.sosfiltfilt(
        signal.butter(
            5,
            HIGHPASS_HZ,
            btype="highpass",
            fs=TARGET_SAMPLE_RATE,
            output="sos",
        ),
        mono,
    ).astype(np.float32)
    energy = frame_mean_absolute(
        highpass, round(TARGET_SAMPLE_RATE * ENERGY_FRAME_MS / 1000)
    )
    threshold = adaptive_threshold(energy)
    peaks, _ = signal.find_peaks(
        energy,
        height=threshold,
        distance=round(60 / ENERGY_FRAME_MS),
    )
    candidates = []
    for number, index in enumerate(peaks, start=1):
        candidates.append(
            {
                "id": f"audio-{number:04d}",
                "time_s": round(index * ENERGY_FRAME_MS / 1000, 4),
                "confidence": round(
                    float(energy[index] / max(threshold[index], 1e-12)), 3
                ),
                "hf_energy": round(float(energy[index]), 8),
            }
        )
    return {
        "detector_version": "hf10k_ema_v1",
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_s": round(len(mono) / TARGET_SAMPLE_RATE, 4),
        "waveform_bin_ms": DISPLAY_FRAME_MS,
        "waveform": normalized_envelope(mono),
        "high_frequency_envelope": normalized_envelope(highpass),
        "candidates": candidates,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("media", type=Path)
    args = parser.parse_args()
    print(json.dumps(analyze(args.media), separators=(",", ":")))


if __name__ == "__main__":
    main()
