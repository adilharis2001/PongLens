"""Where the sharp knocks are, on the venue's own terms.

placement_reconstruction takes an `audio_impacts` list and has never been
given one: points_pipeline passes `[]` unconditionally. This produces that
list. It answers only "something struck at t, this confidently" — never
what struck, or whose serve it was. The 2026-08-13 serve study measured the
locator idea dead (99.1% recall, 1.045s median timing error), so nothing
here tries to find a serve.

The method, in order:

  1. mono 48 kHz, short-time Fourier transform, 21 ms window / 5.3 ms hop;
  2. spectral flux — how much energy ROSE since the last frame — summed
     over 1.5-8 kHz, where a celluloid ball on a table lives. Rise, not
     level, because a hall's continuous roar has no edges;
  3. compressed with log1p before differencing, so one loud strike does
     not set the scale for the whole file;
  4. LOCAL background subtraction: a robust z-score against the running
     median and MAD of a +/-0.75 s neighbourhood. This is the part that
     matters. A global threshold asks a quiet club and a tournament hall
     the same question, and only one of them can answer it;
  5. peaks, separated by at least 25 ms.

`confidence` is that z-score, floored at 0. It is not a probability, and
the consumer is built for exactly this: `_candidate_evidence` maps it
through 1 - exp(-c/2), and the standalone-impact rule inside
extract_candidates compares it against 2.5.

Reads WAV with the standard library. numpy does the arithmetic. No scipy,
no librosa: the point of a simple detector is that it can be explained.
"""
from __future__ import annotations

import json
import sys
import wave

import numpy as np

SR = 48000
WINDOW = 1024          # 21.3 ms
HOP = 256              # 5.33 ms
BALL_BAND = (1500.0, 8000.0)
# The Sony AI bounce pipeline (arXiv 2409.11760) high-passes at 10 kHz
# before looking for peaks. Measured here against production's own visual
# bounces, at matched impact density so the chance rate is held equal:
# 87% inside 30 ms against 72% for the band above, and the gap is widest
# on the two matches this study found hardest (Prabhas 58 -> 86, Ishan
# 56 -> 84). A hall's voices, shoes and rolling balls live below 10 kHz;
# a celluloid ball's strike does not.
HIGH_BAND = (10000.0, 24000.0)
STOMP_BAND = (40.0, 250.0)
BACKGROUND_S = 0.75
MIN_SEPARATION_S = 0.025
DEFAULT_THRESHOLD = 3.0


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        if handle.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM")
        rate = handle.getframerate()
        channels = handle.getnchannels()
        raw = handle.readframes(handle.getnframes())
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def spectrogram(samples: np.ndarray, rate: int):
    n = 1 + max(0, (len(samples) - WINDOW) // HOP)
    window = np.hanning(WINDOW).astype(np.float32)
    frames = np.lib.stride_tricks.as_strided(
        samples,
        shape=(n, WINDOW),
        strides=(samples.strides[0] * HOP, samples.strides[0]),
    )
    magnitude = np.empty((n, WINDOW // 2 + 1), dtype=np.float32)
    for start in range(0, n, 8192):        # chunked: 40 min of audio is 460k frames
        stop = min(n, start + 8192)
        block = np.abs(np.fft.rfft(frames[start:stop] * window, axis=1))
        magnitude[start:stop] = block.astype(np.float32)
    freqs = np.fft.rfftfreq(WINDOW, 1.0 / rate)
    return magnitude, freqs


def flux(magnitude: np.ndarray, freqs: np.ndarray,
         band: tuple[float, float]) -> np.ndarray:
    """Positive spectral change inside one band, per frame."""
    lo, hi = band
    keep = (freqs >= lo) & (freqs <= hi)
    compressed = np.log1p(magnitude[:, keep] * 1000.0)
    rise = np.diff(compressed, axis=0, prepend=compressed[:1])
    return np.maximum(rise, 0.0).sum(axis=1)


def local_z(signal: np.ndarray, rate: int) -> np.ndarray:
    """Robust z-score against a moving median and MAD.

    Written as a decimated envelope rather than a true sliding window: the
    median of a half-second does not move meaningfully between adjacent
    5 ms frames, and the exact version costs minutes per match for a
    difference below the peak-picking threshold.
    """
    span = max(1, int(round(BACKGROUND_S * rate / HOP)))
    step = max(1, span // 8)
    starts = np.arange(0, len(signal), step)
    blocks = [signal[max(0, s - span):s + span] for s in starts]
    median = np.array([np.median(b) if len(b) else 0.0 for b in blocks])
    mad = np.array([np.median(np.abs(b - m)) if len(b) else 0.0
                    for b, m in zip(blocks, median)])
    grid = np.arange(len(signal))
    median_full = np.interp(grid, starts, median)
    mad_full = np.interp(grid, starts, mad)
    scale = np.maximum(mad_full * 1.4826, 1e-6)
    floor = np.percentile(scale, 25)         # a near-silent stretch must not
    scale = np.maximum(scale, floor)         # turn its own hiss into peaks
    return (signal - median_full) / scale


def pick_peaks(z: np.ndarray, rate: int, threshold: float):
    separation = max(1, int(round(MIN_SEPARATION_S * rate / HOP)))
    over = np.flatnonzero(z >= threshold)
    if len(over) == 0:
        return []
    picked = []
    for index in over[np.argsort(-z[over])]:
        if all(abs(index - taken) >= separation for taken in picked):
            picked.append(int(index))
    return sorted(picked)


def frame_time(index: int, rate: int, offset_s: float = 0.0) -> float:
    """Seconds of the window's CENTRE, which is where its energy is measured."""
    return (index * HOP + WINDOW / 2) / rate + offset_s


def detect(path: str, threshold: float = DEFAULT_THRESHOLD,
           band: tuple[float, float] = BALL_BAND,
           offset_s: float = 0.0) -> list[dict]:
    samples, rate = read_wav(path)
    magnitude, freqs = spectrogram(samples, rate)
    z = local_z(flux(magnitude, freqs, band), rate)
    return [
        {"t": round(frame_time(index, rate, offset_s), 4),
         "confidence": round(float(z[index]), 3)}
        for index in pick_peaks(z, rate, threshold)
    ]


def main():
    path = sys.argv[1]
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_THRESHOLD
    out = detect(path, threshold)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
