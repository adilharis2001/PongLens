"""Is there any direction information in the recording at all?

  ./venv/bin/python stereo_probe.py <work-dir> <slug> [slug ...]

The literature's one measure that actually separates your own court from
the next one along is a DIRECTIONAL microphone (US5908361). A phone has
two omnidirectional capsules a few centimetres apart, which is a far
weaker instrument, but not nothing, so it is worth measuring rather than
assuming.

For every impact the delay between the two channels is estimated by
cross-correlating a 10 ms window around it, to sub-sample precision by
parabolic interpolation of the correlation peak. If the room's sound is
arriving from two or more distinct directions, that delay is multi-modal.
If the capsules are too close together, or the two channels are a mono
signal in all but name, it collapses to one spike.

Nothing here needs a ball track, which is the point: it asks whether the
information EXISTS before anyone tries to use it.
"""
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_impacts as AUDIO

HALF_WINDOW = 0.005      # 10 ms around the impact
MAX_LAG_SAMPLES = 48     # 1 ms at 48 kHz: far more than any phone baseline


def read_stereo(path):
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        raw = handle.readframes(handle.getnframes())
    data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels < 2:
        raise SystemExit(f"{path}: not stereo")
    data = data.reshape(-1, channels)
    return np.ascontiguousarray(data[:, 0]), np.ascontiguousarray(data[:, 1]), rate


def lag_at(left, right, centre, rate):
    half = int(HALF_WINDOW * rate)
    i = int(centre * rate)
    if i - half - MAX_LAG_SAMPLES < 0 or i + half + MAX_LAG_SAMPLES >= len(left):
        return None, 0.0
    a = left[i - half:i + half]
    b = right[i - half - MAX_LAG_SAMPLES:i + half + MAX_LAG_SAMPLES]
    a = a - a.mean()
    b = b - b.mean()
    if np.allclose(a, 0) or np.allclose(b, 0):
        return None, 0.0
    corr = np.correlate(b, a, mode="valid")
    k = int(np.argmax(corr))
    if 0 < k < len(corr) - 1:
        y0, y1, y2 = corr[k - 1], corr[k], corr[k + 1]
        denom = y0 - 2 * y1 + y2
        k = k + (0.5 * (y0 - y2) / denom if denom else 0.0)
    lag = (k - MAX_LAG_SAMPLES) / rate
    energy_l = float(np.sqrt((a ** 2).mean()))
    window = b[MAX_LAG_SAMPLES:MAX_LAG_SAMPLES + len(a)]
    energy_r = float(np.sqrt((window ** 2).mean()))
    ild = 20 * np.log10((energy_r + 1e-9) / (energy_l + 1e-9))
    return lag, float(ild)


def main():
    work = sys.argv[1]
    for slug in sys.argv[2:]:
        path = os.path.join(work, slug, "stereo.wav")
        if not os.path.exists(path):
            print(f"{slug}: no stereo track (the source was mono)")
            continue
        left, right, rate = read_stereo(path)
        mono = (left + right) / 2.0
        magnitude, freqs = AUDIO.spectrogram(mono, rate)
        band = (AUDIO.HIGH_BAND if rate > 44000 else (8000.0, rate / 2 - 500))
        z = AUDIO.local_z(AUDIO.flux(magnitude, freqs, band), rate)
        peaks = AUDIO.pick_peaks(z, rate, 6.0)
        lags, ilds = [], []
        for index in peaks:
            lag, ild = lag_at(left, right, AUDIO.frame_time(index, rate), rate)
            if lag is not None:
                lags.append(lag * 1e6)      # microseconds
                ilds.append(ild)
        lags = np.array(lags)
        ilds = np.array(ilds)
        if len(lags) == 0:
            print(f"{slug}: no usable impacts")
            continue
        print(f"\n=== {slug} — {len(lags)} impacts, {rate} Hz, "
              f"band {band[0]/1000:.0f}-{band[1]/1000:.0f} kHz ===")
        print(f"  channel delay  median {np.median(lags):+8.1f} us"
              f"   p5 {np.percentile(lags, 5):+8.1f}"
              f"   p95 {np.percentile(lags, 95):+8.1f}"
              f"   MAD {np.median(np.abs(lags - np.median(lags))):6.1f} us")
        print(f"  level diff     median {np.median(ilds):+8.2f} dB"
              f"   p5 {np.percentile(ilds, 5):+8.2f}"
              f"   p95 {np.percentile(ilds, 95):+8.2f}")
        counts, edges = np.histogram(lags, bins=21, range=(-500, 500))
        tallest = counts.max()
        print("  delay histogram, -500 to +500 us:")
        for count, edge in zip(counts, edges):
            bar = "#" * int(round(38 * count / max(1, tallest)))
            print(f"    {edge:+6.0f} {bar} {count}")
        share = float(np.mean(np.abs(lags - np.median(lags)) <= 30))
        print(f"  {share * 100:.0f}% of impacts sit within 30 us of the median "
              f"delay")


if __name__ == "__main__":
    main()
