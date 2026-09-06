"""Onset strength measured against the WHOLE recording, not the last half second.

The previous study's detector normalised every frame against a robust
median and MAD of its own +/- 0.75 s neighbourhood. That is the right
choice when the question is "exactly when did this bounce happen", because
it lets a quiet booth and a loud hall be asked the same question.

It is the wrong choice when the question is "is a rally happening here at
all". A local reference divides out precisely the thing that separates a
rally from a gap: during a rally the local background IS the rally, so
real ball strikes get flattened, while in a genuinely quiet gap a single
shoe scuff towers over its neighbours and is promoted to an impact. That
is very likely why the between-point firing rate came out at 2-4 per
second — the same number as during play.

So: same spectral flux, referenced instead to a long window (30 s by
default, which is many points either way), with a global floor. Peaks now
mean "loud for this venue" rather than "loud for this instant".
"""
from __future__ import annotations

import numpy as np

WINDOW = 1024
HOP = 256
BALL_BAND = (2000.0, 8000.0)
HIGH_BAND = (10000.0, 20000.0)
LOW_BAND = (100.0, 700.0)


def spectrogram(samples, rate, window=WINDOW, hop=HOP):
    n = 1 + max(0, (len(samples) - window) // hop)
    win = np.hanning(window).astype(np.float32)
    frames = np.lib.stride_tricks.as_strided(
        samples, shape=(n, window),
        strides=(samples.strides[0] * hop, samples.strides[0]))
    mag = np.empty((n, window // 2 + 1), np.float32)
    for a in range(0, n, 8192):
        b = min(n, a + 8192)
        mag[a:b] = np.abs(np.fft.rfft(frames[a:b] * win, axis=1)).astype(np.float32)
    return mag, np.fft.rfftfreq(window, 1.0 / rate)


def flux(mag, freqs, band):
    lo, hi = band
    keep = (freqs >= lo) & (freqs <= min(hi, freqs[-1]))
    comp = np.log1p(mag[:, keep] * 1000.0)
    rise = np.diff(comp, axis=0, prepend=comp[:1])
    return np.maximum(rise, 0.0).sum(axis=1)


def global_z(signal, rate, hop=HOP, window_s=30.0):
    """Robust z against a LONG window, so the scale is the venue's, not the moment's."""
    span = max(1, int(round(window_s * rate / hop)))
    step = max(1, span // 12)
    starts = np.arange(0, len(signal), step)
    med, mad = [], []
    for s in starts:
        b = signal[max(0, s - span):s + span]
        if len(b) == 0:
            med.append(0.0); mad.append(0.0); continue
        m = np.median(b)
        med.append(m); mad.append(np.median(np.abs(b - m)))
    grid = np.arange(len(signal))
    m_full = np.interp(grid, starts, med)
    s_full = np.maximum(np.interp(grid, starts, mad) * 1.4826, 1e-6)
    s_full = np.maximum(s_full, np.percentile(s_full, 20))
    return (signal - m_full) / s_full


def peaks(z, rate, threshold, hop=HOP, min_sep_s=0.030):
    """Loudest first, each one blocking its neighbours.

    Written against a blocked-mask rather than a list scan: the list
    version is quadratic in the number of candidates and a forty-minute
    match offers hundreds of thousands of them.

    Because candidates are taken in descending order, the set picked at a
    higher threshold is exactly the set picked here restricted to peaks
    above it — so callers sweeping a threshold can pick once at the bottom
    and subset, instead of picking again.
    """
    sep = max(1, int(round(min_sep_s * rate / hop)))
    over = np.flatnonzero(z >= threshold)
    if len(over) == 0:
        return np.array([], int)
    blocked = np.zeros(len(z), bool)
    picked = []
    for i in over[np.argsort(-z[over], kind="stable")]:
        if blocked[i]:
            continue
        picked.append(int(i))
        blocked[max(0, i - sep + 1):i + sep] = True
    return np.array(sorted(picked), int)


def frame_times(n, rate, hop=HOP, window=WINDOW):
    return (np.arange(n) * hop + window / 2) / rate


def envelopes(samples, rate):
    """The three curves everything downstream reads."""
    mag, freqs = spectrogram(samples, rate)
    out = {}
    for name, band in (("ball", BALL_BAND), ("high", HIGH_BAND), ("low", LOW_BAND)):
        f = flux(mag, freqs, band)
        out[name] = {"raw": f, "z": global_z(f, rate)}
    out["times"] = frame_times(mag.shape[0], rate)
    out["rate"] = rate
    return out
