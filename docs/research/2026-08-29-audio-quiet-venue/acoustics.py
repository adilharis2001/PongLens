"""What a single knock sounds like, measured in ways that survive loudness.

The question this module exists for: the phone sits at one place in the
room, so a bounce on the far half of the table is two to three metres
further away than one on the near half. Distance changes a sound in ways
that have nothing to do with how hard the ball was hit —

  * high frequencies are absorbed by air and by grazing over the table,
    so a far bounce is duller;
  * the direct sound falls off with distance while the room's reflections
    do not, so a far bounce is relatively more reverberant;
  * the attack smears, because the reflections arrive closer behind.

Level is deliberately kept as one feature among many rather than the
feature, because level also tracks how hard the ball was struck, and that
is a real confound: a bounce on the near half is a ball the FAR player
hit. Everything here is measured against the recording's own local
background, so a quiet booth and a loud hall are asked the same question.
"""
from __future__ import annotations

import wave

import numpy as np

# The attack window. A celluloid strike is over in a few milliseconds; the
# tail out to 60 ms is where the room answers.
PRE_S = 0.012
ATTACK_S = 0.008
EARLY_S = 0.020
LATE_S = 0.060
BANDS = [(300, 1500), (1500, 4000), (4000, 8000), (8000, 12000), (12000, 20000)]


def read_wav(path, want_stereo=False):
    with wave.open(path, "rb") as h:
        if h.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit PCM")
        rate, ch = h.getframerate(), h.getnchannels()
        raw = h.readframes(h.getnframes())
    data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch)
        return (data if want_stereo else data.mean(axis=1)), rate
    return (data[:, None] if want_stereo else data), rate


def _band_energy(chunk, rate, bands):
    if len(chunk) < 16:
        return np.zeros(len(bands), np.float32)
    win = np.hanning(len(chunk)).astype(np.float32)
    spec = np.abs(np.fft.rfft(chunk * win)) ** 2
    freqs = np.fft.rfftfreq(len(chunk), 1.0 / rate)
    out = np.empty(len(bands), np.float32)
    for i, (lo, hi) in enumerate(bands):
        keep = (freqs >= lo) & (freqs < min(hi, rate / 2 - 200))
        out[i] = spec[keep].sum() if keep.any() else 0.0
    return out


def features_at(samples, rate, t, background_s=0.6):
    """Acoustic description of whatever happened at `t`. None if out of range."""
    i = int(round(t * rate))
    pre = int(PRE_S * rate)
    late = int(LATE_S * rate)
    bg = int(background_s * rate)
    if i - pre - bg < 0 or i + late + 1 >= len(samples):
        return None

    # Re-centre on the true peak inside +/- 12 ms: the video frame of a
    # bounce and the sample of its transient are not the same instant.
    search = samples[i - pre:i + pre]
    if len(search) == 0:
        return None
    k = int(np.argmax(np.abs(search)))
    i = i - pre + k

    if i - bg < 0 or i + late + 1 >= len(samples):
        return None
    attack = samples[i:i + int(ATTACK_S * rate)]
    early = samples[i + int(ATTACK_S * rate):i + int(EARLY_S * rate)]
    tail = samples[i + int(EARLY_S * rate):i + late]
    before = samples[i - int(0.010 * rate):i]
    floor = samples[i - bg:i - int(0.05 * rate)]

    def rms(x):
        return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if len(x) else 0.0

    a_rms, e_rms, t_rms = rms(attack), rms(early), rms(tail)
    f_rms = max(rms(floor), 1e-7)
    peak = float(np.max(np.abs(attack))) if len(attack) else 0.0

    eb = _band_energy(samples[i - int(0.002 * rate):i + int(0.014 * rate)], rate, BANDS)
    total = float(eb.sum()) + 1e-12

    def db(x):
        return float(20 * np.log10(max(x, 1e-7)))

    freqs_mid = np.array([(lo + hi) / 2 for lo, hi in BANDS], np.float64)
    centroid = float((eb * freqs_mid).sum() / total)

    return {
        # loudness, relative to this recording's own floor a moment earlier
        "snr_db": db(a_rms) - db(f_rms),
        "peak_db": db(peak),
        "floor_db": db(f_rms),
        # how much of the sound is direct versus the room answering back
        "decay_early_db": db(a_rms) - db(max(e_rms, 1e-7)),
        "decay_late_db": db(a_rms) - db(max(t_rms, 1e-7)),
        "tail_ratio": float(t_rms / max(a_rms, 1e-7)),
        # timbre — a distant sound loses its top end first
        "centroid_hz": centroid,
        "b_low": float(eb[0] / total), "b_mid": float(eb[1] / total),
        "b_high": float(eb[2] / total), "b_vhigh": float(eb[3] / total),
        "b_top": float(eb[4] / total),
        "bright": float((eb[3] + eb[4]) / max(eb[0] + eb[1], 1e-12)),
        "hf_lf": float((eb[2] + eb[3] + eb[4]) / max(eb[0] + eb[1], 1e-12)),
        # was there an attack at all, or is this just background
        "rise_db": db(a_rms) - db(max(rms(before), 1e-7)),
        "t_snap": float(i / rate),
    }


def auc(pos, neg):
    """Area under the ROC curve, by rank. 0.5 is chance, 1.0 is perfect."""
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    pos = pos[np.isfinite(pos)]; neg = neg[np.isfinite(neg)]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order), float)
    ranks[order] = np.arange(1, len(order) + 1)
    # average ranks for ties
    vals = np.concatenate([pos, neg])[order]
    i = 0
    r = ranks[order]
    while i < len(vals):
        j = i
        while j + 1 < len(vals) and vals[j + 1] == vals[i]:
            j += 1
        if j > i:
            r[i:j + 1] = r[i:j + 1].mean()
        i = j + 1
    ranks[order] = r
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2)
                 / (len(pos) * len(neg)))
